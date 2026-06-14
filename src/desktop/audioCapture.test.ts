import { describe, expect, it, vi } from 'vitest'
import { TauriAudioCaptureSession } from './audioCapture'
import { type TauriInvoke } from './tauri'

describe('TauriAudioCaptureSession', () => {
  it('delegates start, stop, and status to native audio capture commands', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'start_audio_capture') {
        return {
          recording: true,
          outputPath: '/tmp/recording.wav',
          deviceName: 'MacBook Microphone',
          startedAtUnixSeconds: 1_797_154_400,
        }
      }
      if (command === 'stop_audio_capture') {
        return {
          path: '/tmp/recording.wav',
          fileName: 'recording.wav',
          mimeType: 'audio/wav',
          bytes: [82, 73, 70, 70],
          durationMillis: 1250,
        }
      }
      if (command === 'audio_capture_status') {
        return { recording: false }
      }
      return undefined
    }) as TauriInvoke
    const session = new TauriAudioCaptureSession(invoke)

    await expect(session.start('product-sync-alex')).resolves.toMatchObject({
      recording: true,
      deviceName: 'MacBook Microphone',
    })
    const file = await session.stop()
    await expect(session.status()).resolves.toEqual({ recording: false })

    expect(invoke).toHaveBeenCalledWith('start_audio_capture', {
      meetingId: 'product-sync-alex',
    })
    expect(invoke).toHaveBeenCalledWith('stop_audio_capture')
    expect(invoke).toHaveBeenCalledWith('audio_capture_status')
    expect(file.name).toBe('recording.wav')
    expect(file.type).toBe('audio/wav')
    expect(file.size).toBe(4)
  })
})
