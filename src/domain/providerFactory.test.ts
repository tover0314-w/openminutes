import { describe, expect, it } from 'vitest'
import { createMemoryApiKeyRepository } from './apiKey'
import { createAiNotesProvider, createTranscriptionProvider } from './providerFactory'
import { defaultAppSettings } from './settings'

describe('provider factory', () => {
  it('uses local demo transcription without provider keys', async () => {
    const provider = createTranscriptionProvider(
      { ...defaultAppSettings, transcriptionMode: 'local-demo' },
      createMemoryApiKeyRepository(),
    )

    const transcript = await provider.transcribe({
      meetingId: 'meeting-1',
      audioUri: 'customer-call.wav',
      audioFileName: 'customer-call.wav',
    })

    expect(provider.id).toBe('mock-transcription')
    expect(transcript[0]?.text).toContain('customer-call')
  })

  it('uses local demo AI Notes without provider keys', async () => {
    const provider = createAiNotesProvider(
      { ...defaultAppSettings, notesMode: 'local-demo' },
      createMemoryApiKeyRepository(),
    )

    expect(provider.id).toBe('mock-ai-notes')
  })
})
