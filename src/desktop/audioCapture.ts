import { getTauriInvoke, isTauriRuntime, type TauriInvoke } from './tauri'
import { type RealtimeTranscriptionProviderId } from '../domain/settings'

export interface AudioCaptureStatus {
  recording: boolean
  outputPath?: string
  deviceName?: string
  startedAtUnixSeconds?: number
}

export interface AudioInputDevice {
  id: string
  name: string
  isDefault: boolean
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
  inputDeviceName?: string
  realtimeProvider?: RealtimeTranscriptionProviderId
  realtimeModel?: string
}

export class TauriAudioCaptureSession {
  constructor(private readonly invoke: TauriInvoke) {}

  start(meetingId: string, options: AudioCaptureStartOptions = {}): Promise<AudioCaptureStatus> {
    const payload: {
      meetingId: string
      inputDeviceName?: string
      realtimeProvider?: RealtimeTranscriptionProviderId
      realtimeModel?: string
    } = { meetingId }
    if (options.inputDeviceName) payload.inputDeviceName = options.inputDeviceName
    if (options.realtimeProvider) payload.realtimeProvider = options.realtimeProvider
    if (options.realtimeModel) payload.realtimeModel = options.realtimeModel

    return this.invoke<AudioCaptureStatus>('start_audio_capture', payload)
  }

  listInputDevices(): Promise<AudioInputDevice[]> {
    return this.invoke<AudioInputDevice[]>('list_audio_input_devices')
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

export async function listTauriAudioInputDevices(): Promise<AudioInputDevice[]> {
  if (!isTauriRuntime()) return []

  const invoke = await getTauriInvoke()
  if (!invoke) return []

  return new TauriAudioCaptureSession(invoke).listInputDevices()
}
