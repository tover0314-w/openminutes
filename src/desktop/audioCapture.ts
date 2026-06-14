import { getTauriInvoke, isTauriRuntime, type TauriInvoke } from './tauri'

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
}

export class TauriAudioCaptureSession {
  constructor(private readonly invoke: TauriInvoke) {}

  start(meetingId: string): Promise<AudioCaptureStatus> {
    return this.invoke<AudioCaptureStatus>('start_audio_capture', { meetingId })
  }

  async stop(): Promise<File> {
    const payload = await this.invoke<CapturedAudioPayload>('stop_audio_capture')
    return new File([Uint8Array.from(payload.bytes)], payload.fileName, {
      type: payload.mimeType,
    })
  }

  status(): Promise<AudioCaptureStatus> {
    return this.invoke<AudioCaptureStatus>('audio_capture_status')
  }
}

export async function createTauriAudioCaptureSession(): Promise<
  TauriAudioCaptureSession | undefined
> {
  if (!isTauriRuntime()) return undefined

  const invoke = await getTauriInvoke()
  return invoke ? new TauriAudioCaptureSession(invoke) : undefined
}
