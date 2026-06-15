import { getTauriInvoke, isTauriRuntime, type TauriInvoke } from './tauri'
import { type RealtimeTranscriptionProviderId } from '../domain/settings'

export interface AudioCaptureStatus {
  recording: boolean
  outputPath?: string
  deviceName?: string
  startedAtUnixSeconds?: number
}

export interface CapturedAudioPayload {
  path: string
  fileName: string
  mimeType: string
  bytes: number[]
  durationMillis: number
  retained: boolean
}

export interface CapturedAudioResult {
  file: File
  path: string
  durationMillis: number
  retained: boolean
}

export interface DeletedAudioCaptureFile {
  path: string
  deleted: boolean
}

export interface AudioCaptureStartOptions {
  realtimeProvider?: RealtimeTranscriptionProviderId
  realtimeModel?: string
}

export class TauriAudioCaptureSession {
  constructor(private readonly invoke: TauriInvoke) {}

  start(meetingId: string, options: AudioCaptureStartOptions = {}): Promise<AudioCaptureStatus> {
    return this.invoke<AudioCaptureStatus>('start_audio_capture', {
      meetingId,
      realtimeProvider: options.realtimeProvider,
      realtimeModel: options.realtimeModel,
    })
  }

  async stop({ keepFile = false }: { keepFile?: boolean } = {}): Promise<CapturedAudioResult> {
    const payload = await this.invoke<CapturedAudioPayload>('stop_audio_capture', { keepFile })
    return {
      file: new File([Uint8Array.from(payload.bytes)], payload.fileName, {
        type: payload.mimeType,
      }),
      path: payload.path,
      durationMillis: payload.durationMillis,
      retained: payload.retained,
    }
  }

  status(): Promise<AudioCaptureStatus> {
    return this.invoke<AudioCaptureStatus>('audio_capture_status')
  }

  deleteFile(path: string): Promise<DeletedAudioCaptureFile> {
    return this.invoke<DeletedAudioCaptureFile>('delete_audio_capture_file', { path })
  }
}

export async function createTauriAudioCaptureSession(): Promise<
  TauriAudioCaptureSession | undefined
> {
  if (!isTauriRuntime()) return undefined

  const invoke = await getTauriInvoke()
  return invoke ? new TauriAudioCaptureSession(invoke) : undefined
}
