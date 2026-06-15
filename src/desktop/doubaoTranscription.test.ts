import { describe, expect, it } from 'vitest'
import { createMemoryApiKeyRepository } from '../domain/apiKey'
import { MissingApiKeyError } from '../domain/openAiProvider'
import { defaultAppSettings } from '../domain/settings'
import { DoubaoDesktopTranscriptionProvider } from './doubaoTranscription'
import { type TauriInvoke } from './tauri'

describe('DoubaoDesktopTranscriptionProvider', () => {
  it('transcribes through the Tauri Doubao command', async () => {
    const runtime = globalThis as typeof globalThis & { __TAURI__?: unknown }
    runtime.__TAURI__ = {}

    try {
      const apiKeys = createMemoryApiKeyRepository()
      await apiKeys.save('doubao', 'doubao-key')
      const invoke = (async (command: string, args?: Record<string, unknown>) => {
        expect(command).toBe('transcribe_audio_with_doubao')
        expect(args).toMatchObject({
          meetingId: 'meeting-1',
          fileName: 'case.wav',
          bytes: [1, 2, 3],
          modelName: 'bigmodel',
        })
        return [
          {
            id: 'meeting-1-doubao-1',
            time: '00:00',
            speaker: 'Speaker',
            text: 'Doubao transcript.',
          },
        ]
      }) as TauriInvoke
      const provider = new DoubaoDesktopTranscriptionProvider(
        { ...defaultAppSettings, transcriptionProvider: 'doubao', sttModel: 'bigmodel' },
        apiKeys,
        async () => invoke,
      )

      const transcript = await provider.transcribe({
        meetingId: 'meeting-1',
        audioUri: 'case.wav',
        audioFileName: 'case.wav',
        audioFile: {
          arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
        } as Blob,
      })

      expect(transcript).toEqual([
        {
          id: 'meeting-1-doubao-1',
          time: '00:00',
          speaker: 'Speaker',
          text: 'Doubao transcript.',
        },
      ])
    } finally {
      delete runtime.__TAURI__
    }
  })

  it('requires a Doubao key before invoking the desktop command', async () => {
    const runtime = globalThis as typeof globalThis & { __TAURI__?: unknown }
    runtime.__TAURI__ = {}

    try {
      const provider = new DoubaoDesktopTranscriptionProvider(
        { ...defaultAppSettings, transcriptionProvider: 'doubao' },
        createMemoryApiKeyRepository(),
        async () => undefined,
      )

      await expect(
        provider.transcribe({
          meetingId: 'meeting-1',
          audioUri: 'case.wav',
          audioFileName: 'case.wav',
          audioFile: new Blob(['audio'], { type: 'audio/wav' }),
        }),
      ).rejects.toBeInstanceOf(MissingApiKeyError)
    } finally {
      delete runtime.__TAURI__
    }
  })
})
