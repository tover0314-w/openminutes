import { type TranscriptLine } from '../domain/meeting'
import { isTauriRuntime } from './tauri'

export const REALTIME_TRANSCRIPT_EVENT = 'openminutes:realtime-transcript'
export const REALTIME_TRANSCRIPT_ERROR_EVENT = 'openminutes:realtime-transcript-error'

export interface RealtimeTranscriptPayload {
  meetingId: string
  line: TranscriptLine
}

export interface RealtimeTranscriptErrorPayload {
  meetingId: string
  message: string
}

export async function listenRealtimeTranscript(
  onLine: (payload: RealtimeTranscriptPayload) => void,
  onError: (payload: RealtimeTranscriptErrorPayload) => void,
): Promise<() => void> {
  if (!isTauriRuntime()) return () => {}

  let unlistenLine: () => void
  let unlistenError: () => void
  try {
    const { listen } = await import('@tauri-apps/api/event')
    unlistenLine = await listen<RealtimeTranscriptPayload>(REALTIME_TRANSCRIPT_EVENT, (event) => {
      onLine(event.payload)
    })
    unlistenError = await listen<RealtimeTranscriptErrorPayload>(
      REALTIME_TRANSCRIPT_ERROR_EVENT,
      (event) => {
        onError(event.payload)
      },
    )
  } catch {
    return () => {}
  }

  return () => {
    unlistenLine()
    unlistenError()
  }
}
