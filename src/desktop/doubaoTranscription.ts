import { MissingApiKeyError } from '../domain/openAiProvider'
import { type ApiKeyRepository } from '../domain/apiKey'
import {
  type AudioTranscriptionInput,
  type TranscriptionProvider,
} from '../domain/providers'
import { type TranscriptLine } from '../domain/meeting'
import { type AppSettings } from '../domain/settings'
import { getTauriInvoke, isTauriRuntime, type TauriInvoke } from './tauri'

interface DoubaoTranscriptLinePayload {
  id: string
  time: string
  speaker: string
  text: string
}

export class DoubaoDesktopTranscriptionProvider implements TranscriptionProvider {
  readonly id = 'doubao-desktop-transcription'
  readonly label = 'Doubao Realtime ASR'

  constructor(
    private readonly settings: AppSettings,
    private readonly apiKeys: ApiKeyRepository,
    private readonly invokeLoader: () => Promise<TauriInvoke | undefined> = getTauriInvoke,
  ) {}

  async transcribe(input: AudioTranscriptionInput): Promise<TranscriptLine[]> {
    if (!input.audioFile) {
      throw new Error('Audio file is required for Doubao transcription.')
    }
    if (!(await this.apiKeys.has('doubao'))) {
      throw new MissingApiKeyError('Doubao')
    }
    if (!isTauriRuntime()) {
      throw new Error('Doubao transcription is available in the desktop app.')
    }

    const invoke = await this.invokeLoader()
    if (!invoke) throw new Error('Desktop API is not available.')

    const bytes = await bytesFromBlob(input.audioFile)
    const lines = await invoke<DoubaoTranscriptLinePayload[]>('transcribe_audio_with_doubao', {
      meetingId: input.meetingId,
      fileName: input.audioFileName ?? input.audioUri,
      bytes,
      modelName: this.settings.sttModel,
    })

    if (!lines.length) {
      throw new Error('Doubao returned an empty transcript.')
    }

    return lines.map((line) => ({
      id: line.id,
      time: line.time,
      speaker: line.speaker,
      text: line.text,
    }))
  }
}

async function bytesFromBlob(blob: Blob): Promise<number[]> {
  const modernBlob = blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> }
  const arrayBuffer =
    typeof modernBlob.arrayBuffer === 'function'
      ? await modernBlob.arrayBuffer()
      : await new Response(blob).arrayBuffer()

  return Array.from(new Uint8Array(arrayBuffer))
}
