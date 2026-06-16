import { type ApiKeyRepository } from './apiKey'
import { type TranscriptLine } from './meeting'
import {
  type AudioTranscriptionInput,
  type TranscriptionProvider,
} from './providers'
import { type AppSettings } from './settings'
import { MissingApiKeyError } from './openAiProvider'

const DEEPGRAM_BATCH_ENDPOINT = 'https://api.deepgram.com/v1/listen'
const DEFAULT_DEEPGRAM_BATCH_MODEL = 'nova-3'
const DEFAULT_DEEPGRAM_BATCH_LANGUAGE = 'zh'

interface DeepgramTranscriptionResponse {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string
        words?: DeepgramWord[]
      }>
    }>
  }
}

interface DeepgramWord {
  word?: string
  punctuated_word?: string
  start?: number
  end?: number
  speaker?: number | string
}

interface WordGroup {
  speakerKey?: string
  start: number
  text: string
}

export class DeepgramTranscriptionProvider implements TranscriptionProvider {
  readonly id = 'deepgram-transcription'
  readonly label = 'Deepgram STT'

  constructor(
    private readonly settings: AppSettings,
    private readonly apiKeys: ApiKeyRepository,
    private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  async transcribe(input: AudioTranscriptionInput): Promise<TranscriptLine[]> {
    if (!input.audioFile) {
      throw new Error('Audio file is required for Deepgram transcription.')
    }

    const apiKey = await this.apiKeys.load('deepgram')
    if (!apiKey) throw new MissingApiKeyError('Deepgram')

    const response = await this.fetcher(deepgramBatchUrl(this.settings.sttModel), {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': input.audioFile.type || 'audio/wav',
      },
      body: input.audioFile,
    })

    if (!response.ok) {
      throw new Error(`Deepgram STT request failed with status ${response.status}.`)
    }

    return parseDeepgramTranscriptionJson(
      (await response.json()) as DeepgramTranscriptionResponse,
      input.meetingId,
    )
  }
}

export function parseDeepgramTranscriptionJson(
  response: DeepgramTranscriptionResponse,
  meetingId: string,
): TranscriptLine[] {
  const alternative = response.results?.channels?.[0]?.alternatives?.[0]
  const words = Array.isArray(alternative?.words) ? alternative.words : []
  if (words.length) {
    const labels = new SpeakerLabels()
    return groupDeepgramWords(words)
      .map((group, index) => ({
        id: `${meetingId}-deepgram-${index + 1}`,
        time: formatTimestamp(group.start),
        speaker: labels.label(group.speakerKey),
        text: group.text,
      }))
      .filter((line) => line.text)
  }

  const transcript = typeof alternative?.transcript === 'string' ? alternative.transcript.trim() : ''
  if (!transcript) throw new Error('Deepgram returned an empty transcript.')

  return [
    {
      id: `${meetingId}-deepgram-1`,
      time: '00:00',
      speaker: 'Speaker',
      text: transcript,
    },
  ]
}

function deepgramBatchUrl(model: string): string {
  const params = new URLSearchParams({
    model: model.trim() || DEFAULT_DEEPGRAM_BATCH_MODEL,
    language: DEFAULT_DEEPGRAM_BATCH_LANGUAGE,
    diarize_model: 'latest',
    punctuate: 'true',
    smart_format: 'true',
  })

  return `${DEEPGRAM_BATCH_ENDPOINT}?${params.toString()}`
}

function groupDeepgramWords(words: DeepgramWord[]): WordGroup[] {
  const groups: WordGroup[] = []
  let current: WordGroup | undefined

  for (const word of words) {
    const rawText = wordText(word)
    if (!rawText) continue

    const speakerKey = speakerKeyFromWord(word)
    const start = typeof word.start === 'number' && Number.isFinite(word.start) ? word.start : 0
    const shouldStartNewGroup =
      !current ||
      current.speakerKey !== speakerKey ||
      (current.text.length > 0 && start - current.start > 30)

    let nextText = rawText
    if (shouldStartNewGroup && current) {
      const split = splitLeadingSentencePunctuation(nextText)
      if (split.leading) {
        current.text = appendTranscriptToken(current.text, split.leading)
        nextText = split.rest
      }
      pushGroup(groups, current)
      current = undefined
    }

    if (!nextText) continue
    if (!current) {
      current = {
        speakerKey,
        start,
        text: '',
      }
    }
    current.text = appendTranscriptToken(current.text, nextText)
  }

  if (current) pushGroup(groups, current)
  return groups
}

function pushGroup(groups: WordGroup[], group: WordGroup) {
  const text = normalizeTranscriptText(group.text)
  if (!text) return
  groups.push({ ...group, text })
}

function wordText(word: DeepgramWord): string {
  const text =
    typeof word.punctuated_word === 'string' && word.punctuated_word.trim()
      ? word.punctuated_word
      : word.word

  return typeof text === 'string' ? text.trim() : ''
}

function speakerKeyFromWord(word: DeepgramWord): string | undefined {
  if (typeof word.speaker === 'number' && Number.isFinite(word.speaker)) {
    return String(word.speaker)
  }
  if (typeof word.speaker === 'string' && word.speaker.trim()) {
    return word.speaker.trim()
  }
  return undefined
}

function splitLeadingSentencePunctuation(text: string): { leading: string; rest: string } {
  const match = text.match(/^([。！？.!?]+)(.*)$/)
  return match
    ? { leading: match[1] ?? '', rest: (match[2] ?? '').trim() }
    : { leading: '', rest: text }
}

function appendTranscriptToken(existing: string, token: string): string {
  const next = token.trim()
  if (!next) return existing
  if (!existing) return next
  if (shouldJoinWithoutSpace(existing, next)) return `${existing}${next}`
  return `${existing} ${next}`
}

function shouldJoinWithoutSpace(existing: string, next: string): boolean {
  const previous = existing.at(-1) ?? ''
  const first = next.at(0) ?? ''
  return isLeadingPunctuation(first) || isCjk(previous) || isCjk(first)
}

function normalizeTranscriptText(text: string): string {
  return text.replace(/\s+([,.;:!?，。！？；：、])/g, '$1').trim()
}

function isLeadingPunctuation(value: string): boolean {
  return /^[,.;:!?，。！？；：、]/.test(value)
}

function isCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value)
}

function formatTimestamp(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safeSeconds / 60)
  const remainingSeconds = safeSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
}

class SpeakerLabels {
  private readonly labels = new Map<string, string>()

  label(speakerKey?: string): string {
    if (!speakerKey) return 'Speaker'
    const existing = this.labels.get(speakerKey)
    if (existing) return existing

    const label = `Speaker ${this.labels.size + 1}`
    this.labels.set(speakerKey, label)
    return label
  }
}
