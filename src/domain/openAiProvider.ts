import { type ApiKeyRepository } from './apiKey'
import {
  type ActionItem,
  type AiNotes,
  type Meeting,
} from './meeting'
import { type AiNotesGenerationInput, type AiNotesProvider } from './providers'
import { type AppSettings } from './settings'

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string
    }
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
    const apiKey = await this.apiKeys.load(this.settings.aiProvider)
    if (this.settings.aiProvider === 'openai-compatible' && !apiKey) {
      throw new MissingApiKeyError()
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
    }

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

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
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
