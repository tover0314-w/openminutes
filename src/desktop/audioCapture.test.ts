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
          retained: false,
        }
      }
      if (command === 'audio_capture_status') {
        return { recording: false }
      }
      if (command === 'list_audio_input_devices') {
        return [
          { id: 'MacBook Microphone', name: 'MacBook Microphone', isDefault: true },
        ]
      }
      if (command === 'delete_audio_capture_file') {
        return { path: '/tmp/recording.wav', deleted: true }
      }
      return undefined
    }) as TauriInvoke
    const session = new TauriAudioCaptureSession(invoke)

    await expect(session.start('product-sync-alex')).resolves.toMatchObject({
      recording: true,
      deviceName: 'MacBook Microphone',
    })
    const result = await session.stop()
    await expect(session.listInputDevices()).resolves.toEqual([
      { id: 'MacBook Microphone', name: 'MacBook Microphone', isDefault: true },
    ])
    await expect(session.status()).resolves.toEqual({ recording: false })
    await expect(session.deleteFile('/tmp/recording.wav')).resolves.toEqual({
      path: '/tmp/recording.wav',
      deleted: true,
    })

    expect(invoke).toHaveBeenCalledWith('start_audio_capture', {
      meetingId: 'product-sync-alex',
    })
    expect(invoke).toHaveBeenCalledWith('stop_audio_capture', { keepFile: false })
    expect(invoke).toHaveBeenCalledWith('list_audio_input_devices')
    expect(invoke).toHaveBeenCalledWith('audio_capture_status')
    expect(invoke).toHaveBeenCalledWith('delete_audio_capture_file', {
      path: '/tmp/recording.wav',
    })
    expect(result.retained).toBe(false)
    expect(result.path).toBe('/tmp/recording.wav')
    expect(result.durationMillis).toBe(1250)
    expect(result.file.name).toBe('recording.wav')
    expect(result.file.type).toBe('audio/wav')
    expect(result.file.size).toBe(4)
  })

  it('can ask native capture to retain the raw audio file', async () => {
    const invoke = vi.fn(async () => ({
      path: '/tmp/recording.wav',
      fileName: 'recording.wav',
      mimeType: 'audio/wav',
      bytes: [82, 73, 70, 70],
      durationMillis: 1250,
      retained: true,
    })) as TauriInvoke
    const session = new TauriAudioCaptureSession(invoke)

    const result = await session.stop({ keepFile: true })

    expect(invoke).toHaveBeenCalledWith('stop_audio_capture', { keepFile: true })
    expect(result.retained).toBe(true)
  })

  it('passes realtime provider settings when starting capture', async () => {
    const invoke = vi.fn(async () => ({
      recording: true,
      outputPath: '/tmp/recording.wav',
      deviceName: 'MacBook Microphone',
      startedAtUnixSeconds: 1_797_154_400,
    })) as TauriInvoke
    const session = new TauriAudioCaptureSession(invoke)

    await session.start('meeting-1', {
      inputDeviceName: 'BlackHole 2ch',
      realtimeProvider: 'deepgram',
      realtimeModel: 'nova-3',
    })

    expect(invoke).toHaveBeenCalledWith('start_audio_capture', {
      meetingId: 'meeting-1',
      inputDeviceName: 'BlackHole 2ch',
      realtimeProvider: 'deepgram',
      realtimeModel: 'nova-3',
    })
  })
})
