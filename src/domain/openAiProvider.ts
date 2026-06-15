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
import { type ApiProviderId, type AppSettings } from './settings'

interface OpenAICompatibleProviderConfig {
  providerId: ApiProviderId
  label: string
  baseUrl: string
  model: string
  apiKeyRequired: boolean
}

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
  constructor(providerLabel = 'Provider') {
    super(`${providerLabel} API key is not configured.`)
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
    const config = aiNotesConfig(this.settings)
    const headers = await buildProviderHeaders(config, this.apiKeys, 'json')

    const response = await this.fetcher(`${normalizeBaseUrl(config.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: [
              'You are a sharp meeting reviewer, not a transcription formatter.',
              'Synthesize what the meeting actually produced, what is still unclear, and what should happen next.',
              'Use manual notes as high-priority human emphasis, then use the transcript as source evidence.',
              'Do not invent facts. If the meeting is thin, say what is missing.',
              'Return only valid JSON with keys summary, decisions, actionItems, openQuestions, keyPoints, followUpDraft.',
            ].join(' '),
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
  readonly label = 'Cloud STT'

  constructor(
    private readonly settings: AppSettings,
    private readonly apiKeys: ApiKeyRepository,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  async transcribe(input: AudioTranscriptionInput): Promise<TranscriptLine[]> {
    if (!input.audioFile) {
      throw new Error('Audio file is required for transcription import.')
    }

    const config = transcriptionConfig(this.settings)
    const headers = await buildProviderHeaders(config, this.apiKeys)
    const formData = new FormData()
    formData.append('file', input.audioFile, input.audioFileName ?? 'meeting-audio.webm')
    formData.append('model', config.model)
    formData.append('response_format', 'verbose_json')

    const response = await this.fetcher(
      `${normalizeBaseUrl(config.baseUrl)}/audio/transcriptions`,
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
    'Write a useful Review result, not generic meeting notes.',
    '',
    'Field guidance:',
    '- summary: 2-4 sentences. Start with the real outcome or conclusion. Mention confidence and missing context when relevant.',
    '- decisions: only explicit decisions. If there was no decision, return an empty array.',
    '- actionItems: concrete next steps with owner and due date when present. Make the task text outcome-oriented. Leave owner/due empty when absent; never use TBD, unknown, or N/A.',
    '- openQuestions: risks, gaps, or follow-ups the user should confirm. Do not repeat action items.',
    '- keyPoints: high-value observations, tradeoffs, or important context. Prefer judgment over restating transcript lines.',
    '- followUpDraft: a concise message the user could send after the meeting.',
    '',
    'Priority rules:',
    '- Treat manual notes as human emphasis.',
    '- If manual notes conflict with the transcript, surface the conflict in openQuestions.',
    '- Cite only information supported by the supplied context.',
    '',
    'Return JSON in this exact shape:',
    '{"summary":"...","decisions":["..."],"actionItems":[{"id":"a1","text":"...","owner":"...","due":"..."}],"openQuestions":["..."],"keyPoints":["..."],"followUpDraft":"..."}',
    '',
    context,
  ].join('\n')
}

async function buildProviderHeaders(
  config: OpenAICompatibleProviderConfig,
  apiKeys: ApiKeyRepository,
  contentType?: 'json',
): Promise<Record<string, string>> {
  const apiKey = await apiKeys.load(config.providerId)
  if (config.apiKeyRequired && !apiKey) {
    throw new MissingApiKeyError(config.label)
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

function aiNotesConfig(settings: AppSettings): OpenAICompatibleProviderConfig {
  if (settings.aiProvider === 'ollama') {
    return {
      providerId: 'ollama',
      label: 'Ollama',
      baseUrl: settings.aiBaseUrl,
      model: settings.notesModel,
      apiKeyRequired: false,
    }
  }

  if (settings.aiProvider === 'openai-compatible') {
    return {
      providerId: 'openai-compatible',
      label: 'OpenAI-compatible',
      baseUrl: settings.aiBaseUrl,
      model: settings.notesModel,
      apiKeyRequired: true,
    }
  }

  if (settings.aiProvider === 'groq') {
    return {
      providerId: 'groq',
      label: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: settings.notesModel,
      apiKeyRequired: true,
    }
  }

  if (settings.aiProvider === 'openrouter') {
    return {
      providerId: 'openrouter',
      label: 'OpenRouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      model: settings.notesModel,
      apiKeyRequired: true,
    }
  }

  return {
    providerId: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: settings.notesModel,
    apiKeyRequired: true,
  }
}

function transcriptionConfig(settings: AppSettings): OpenAICompatibleProviderConfig {
  if (settings.transcriptionProvider === 'groq') {
    return {
      providerId: 'groq',
      label: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      model: settings.sttModel,
      apiKeyRequired: true,
    }
  }

  if (settings.transcriptionProvider === 'openai-compatible') {
    return {
      providerId: 'openai-compatible',
      label: 'OpenAI-compatible STT',
      baseUrl: settings.transcriptionBaseUrl,
      model: settings.sttModel,
      apiKeyRequired: true,
    }
  }

  return {
    providerId: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: settings.sttModel,
    apiKeyRequired: true,
  }
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
    .map((item, index) => {
      const externalItem = item as Record<string, unknown>

      return {
        id: typeof item.id === 'string' ? item.id : `a${index + 1}`,
        text: firstString(item.text, externalItem.task, externalItem.action, externalItem.title),
        owner: meaningfulOptional(firstString(item.owner, externalItem.responsible, externalItem.assignee)),
        due: meaningfulOptional(firstString(item.due, externalItem.deadline, externalItem.dueDate)),
      }
    })
    .filter((item) => item.text)
}

function meaningfulOptional(value: string): string | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined

  const normalized = trimmed.toLowerCase().replace(/[\s._-]+/g, '')
  if (normalized === 'tbd' || normalized === 'unknown' || normalized === 'na' || normalized === 'n/a') {
    return undefined
  }

  return trimmed
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }

  return ''
}
