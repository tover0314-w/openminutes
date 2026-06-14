import { describe, expect, it, vi } from 'vitest'
import { MemoryApiKeyRepository } from './apiKey'
import { createDemoMeeting } from './meeting'
import {
  MissingApiKeyError,
  OpenAICompatibleAiNotesProvider,
  OpenAICompatibleTranscriptionProvider,
  parseAiNotesJson,
  parseTranscriptionJson,
} from './openAiProvider'
import { buildAiNotesContext } from './meeting'
import { defaultAppSettings } from './settings'

describe('OpenAICompatibleAiNotesProvider', () => {
  it('calls an OpenAI-compatible chat completions endpoint and parses AI Notes', async () => {
    const apiKeys = new MemoryApiKeyRepository()
    await apiKeys.save('openai-compatible', 'test-key')
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary: 'Summary',
                decisions: ['Decision'],
                actionItems: [{ text: 'Do work', owner: 'Tov' }],
                openQuestions: ['Question'],
                keyPoints: ['Point'],
                followUpDraft: 'Follow up',
              }),
            },
          },
        ],
      }),
    })) as unknown as typeof fetch
    const provider = new OpenAICompatibleAiNotesProvider(defaultAppSettings, apiKeys, fetcher)

    const notes = await provider.generateNotes({
      meeting: createDemoMeeting('ready'),
      context: buildAiNotesContext(createDemoMeeting('ready')),
    })

    expect(notes.summary).toBe('Summary')
    expect(notes.actionItems[0]).toMatchObject({ text: 'Do work', owner: 'Tov' })
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      }),
    )
  })

  it('parses JSON even when the provider wraps it in prose', () => {
    const notes = parseAiNotesJson('Here:\n{"summary":"S","decisions":[],"actionItems":[],"openQuestions":[],"keyPoints":[],"followUpDraft":""}')

    expect(notes.summary).toBe('S')
  })

  it('requires an API key for OpenAI-compatible providers', async () => {
    const apiKeys = new MemoryApiKeyRepository()
    const fetcher = vi.fn() as unknown as typeof fetch
    const provider = new OpenAICompatibleAiNotesProvider(defaultAppSettings, apiKeys, fetcher)

    await expect(
      provider.generateNotes({
        meeting: createDemoMeeting('ready'),
        context: buildAiNotesContext(createDemoMeeting('ready')),
      }),
    ).rejects.toBeInstanceOf(MissingApiKeyError)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('allows local Ollama-compatible providers without an Authorization header', async () => {
    const apiKeys = new MemoryApiKeyRepository()
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"summary":"Local","decisions":[],"actionItems":[],"openQuestions":[],"keyPoints":[],"followUpDraft":""}',
            },
          },
        ],
      }),
    })) as unknown as typeof fetch
    const provider = new OpenAICompatibleAiNotesProvider(
      {
        ...defaultAppSettings,
        aiProvider: 'ollama',
        aiBaseUrl: 'http://localhost:11434/v1',
      },
      apiKeys,
      fetcher,
    )

    const notes = await provider.generateNotes({
      meeting: createDemoMeeting('ready'),
      context: buildAiNotesContext(createDemoMeeting('ready')),
    })

    expect(notes.summary).toBe('Local')
    expect(fetcher).toHaveBeenCalledWith(
      'http://localhost:11434/v1/chat/completions',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
})

describe('OpenAICompatibleTranscriptionProvider', () => {
  it('uploads an audio file to an OpenAI-compatible transcription endpoint', async () => {
    const apiKeys = new MemoryApiKeyRepository()
    await apiKeys.save('openai-compatible', 'test-key')
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        segments: [
          { id: 1, start: 4.2, text: 'Hello there.' },
          { id: 2, start: 65.1, text: 'Next minute.' },
        ],
      }),
    })) as unknown as typeof fetch
    const provider = new OpenAICompatibleTranscriptionProvider(defaultAppSettings, apiKeys, fetcher)

    const transcript = await provider.transcribe({
      meetingId: 'meeting-1',
      audioUri: 'meeting.wav',
      audioFile: new Blob(['audio']),
      audioFileName: 'meeting.wav',
    })

    expect(transcript).toEqual([
      { id: 'meeting-1-stt-1', time: '00:04', speaker: 'Speaker', text: 'Hello there.' },
      { id: 'meeting-1-stt-2', time: '01:05', speaker: 'Speaker', text: 'Next minute.' },
    ])
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/transcriptions',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-key' },
        body: expect.any(FormData),
      }),
    )
  })

  it('requires an API key before uploading OpenAI-compatible audio', async () => {
    const apiKeys = new MemoryApiKeyRepository()
    const fetcher = vi.fn() as unknown as typeof fetch
    const provider = new OpenAICompatibleTranscriptionProvider(defaultAppSettings, apiKeys, fetcher)

    await expect(
      provider.transcribe({
        meetingId: 'meeting-1',
        audioUri: 'meeting.wav',
        audioFile: new Blob(['audio']),
        audioFileName: 'meeting.wav',
      }),
    ).rejects.toBeInstanceOf(MissingApiKeyError)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('parses text-only transcription responses as a single transcript line', () => {
    expect(parseTranscriptionJson({ text: 'One paragraph transcript.' }, 'meeting-1')).toEqual([
      {
        id: 'meeting-1-stt-1',
        time: '00:00',
        speaker: 'Speaker',
        text: 'One paragraph transcript.',
      },
    ])
  })
})
