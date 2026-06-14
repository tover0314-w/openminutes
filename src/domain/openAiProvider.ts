import { type ApiKeyRepository } from './apiKey'
import {
  type ActionItem,
  type AiNotes,
  type Meeting,
  type TranscriptLine,
} from './meeting'
import {
  type AiNotesGenerationInput,
  type AiNotesProvider,
  type AudioTranscriptionInput,
  type TranscriptionProvider,
} from './providers'
import { type AppSettings } from './settings'

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
}

interface TranscriptionResponse {
  text?: string
  segments?: Array<{
    id?: number
    start?: number
    text?: string
  }>
}

export class MissingApiKeyError extends Error {
  constructor() {
    super('Provider API key is not configured.')
    this.name = 'MissingApiKeyError'
  }
}

export class OpenAICompatibleAiNotesProvider implements AiNotesProvider {
  readonly id = 'openai-compatible-ai-notes'
  readonly label = 'OpenAI Compatible'

  constructor(
    private readonly settings: AppSettings,
    private readonly apiKeys: ApiKeyRepository,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  async generateNotes(input: AiNotesGenerationInput): Promise<AiNotes> {
    const headers = await buildProviderHeaders(this.settings, this.apiKeys, 'json')

    const response = await this.fetcher(`${normalizeBaseUrl(this.settings.aiBaseUrl)}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.settings.notesModel,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You generate concise structured meeting notes. Return only valid JSON with keys summary, decisions, actionItems, openQuestions, keyPoints, followUpDraft.',
          },
          {
            role: 'user',
            content: buildPrompt(input.meeting, input.context),
          },
        ],
      }),
    })

    if (!response.ok) {
      throw new Error(`AI provider request failed with status ${response.status}.`)
    }

    const body = (await response.json()) as ChatCompletionResponse
    const content = body.choices?.[0]?.message?.content
    if (!content) throw new Error('AI provider returned an empty response.')

    return parseAiNotesJson(content)
  }
}

export class OpenAICompatibleTranscriptionProvider implements TranscriptionProvider {
  readonly id = 'openai-compatible-transcription'
  readonly label = 'OpenAI Compatible STT'

  constructor(
    private readonly settings: AppSettings,
    private readonly apiKeys: ApiKeyRepository,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  async transcribe(input: AudioTranscriptionInput): Promise<TranscriptLine[]> {
    if (!input.audioFile) {
      throw new Error('Audio file is required for transcription import.')
    }

    const headers = await buildProviderHeaders(this.settings, this.apiKeys)
    const formData = new FormData()
    formData.append('file', input.audioFile, input.audioFileName ?? 'meeting-audio.webm')
    formData.append('model', this.settings.sttModel)
    formData.append('response_format', 'verbose_json')

    const response = await this.fetcher(
      `${normalizeBaseUrl(this.settings.aiBaseUrl)}/audio/transcriptions`,
      {
        method: 'POST',
        headers,
        body: formData,
      },
    )

    if (!response.ok) {
      throw new Error(`STT provider request failed with status ${response.status}.`)
    }

    return parseTranscriptionJson((await response.json()) as TranscriptionResponse, input.meetingId)
  }
}

export function parseAiNotesJson(content: string): AiNotes {
  const parsed = JSON.parse(extractJson(content)) as Partial<AiNotes>

  return {
    summary: stringOrDefault(parsed.summary, 'No summary generated.'),
    decisions: stringListOrEmpty(parsed.decisions),
    actionItems: actionItemsOrEmpty(parsed.actionItems),
    openQuestions: stringListOrEmpty(parsed.openQuestions),
    keyPoints: stringListOrEmpty(parsed.keyPoints),
    followUpDraft: stringOrDefault(parsed.followUpDraft, ''),
  }
}

export function parseTranscriptionJson(
  response: TranscriptionResponse,
  meetingId: string,
): TranscriptLine[] {
  const segments = Array.isArray(response.segments) ? response.segments : []

  if (segments.length) {
    return segments
      .map((segment, index) => ({
        id: `${meetingId}-stt-${segment.id ?? index + 1}`,
        time: formatTimestamp(segment.start ?? 0),
        speaker: 'Speaker',
        text: typeof segment.text === 'string' ? segment.text.trim() : '',
      }))
      .filter((line) => line.text)
  }

  const text = typeof response.text === 'string' ? response.text.trim() : ''
  if (!text) throw new Error('STT provider returned an empty transcript.')

  return [
    {
      id: `${meetingId}-stt-1`,
      time: '00:00',
      speaker: 'Speaker',
      text,
    },
  ]
}

function buildPrompt(meeting: Meeting, context: string): string {
  return [
    `Meeting title: ${meeting.title}`,
    '',
    'Use manual notes and markers as higher-priority signal than transcript text.',
    'Return JSON in this exact shape:',
    '{"summary":"...","decisions":["..."],"actionItems":[{"id":"a1","text":"...","owner":"...","due":"..."}],"openQuestions":["..."],"keyPoints":["..."],"followUpDraft":"..."}',
    '',
    context,
  ].join('\n')
}

async function buildProviderHeaders(
  settings: AppSettings,
  apiKeys: ApiKeyRepository,
  contentType?: 'json',
): Promise<Record<string, string>> {
  const apiKey = await apiKeys.load(settings.aiProvider)
  if (settings.aiProvider === 'openai-compatible' && !apiKey) {
    throw new MissingApiKeyError()
  }

  const headers: Record<string, string> = {}
  if (contentType === 'json') {
    headers['Content-Type'] = 'application/json'
  }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  return headers
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function formatTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safeSeconds / 60)
  const remainingSeconds = safeSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
}

function extractJson(content: string): string {
  const trimmed = content.trim()
  if (trimmed.startsWith('{')) return trimmed

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1)
  }

  throw new Error('AI provider response did not contain JSON.')
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function stringListOrEmpty(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function actionItemsOrEmpty(value: unknown): ActionItem[] {
  if (!Array.isArray(value)) return []

  return value
    .filter((item): item is Partial<ActionItem> => typeof item === 'object' && item !== null)
    .map((item, index) => ({
      id: typeof item.id === 'string' ? item.id : `a${index + 1}`,
      text: typeof item.text === 'string' ? item.text : '',
      owner: typeof item.owner === 'string' ? item.owner : undefined,
      due: typeof item.due === 'string' ? item.due : undefined,
    }))
    .filter((item) => item.text)
}
