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
    await apiKeys.save('openai', 'test-key')
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                document: '## What changed\n\n**This is the main readable note.**',
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
    const provider = new OpenAICompatibleAiNotesProvider(
      {
        ...defaultAppSettings,
        aiProvider: 'openai',
        notesModel: 'gpt-4.1-mini',
      },
      apiKeys,
      fetcher,
    )

    const notes = await provider.generateNotes({
      meeting: createDemoMeeting('ready'),
      context: buildAiNotesContext(createDemoMeeting('ready')),
    })

    expect(notes.summary).toBe('Summary')
    expect(notes.document).toContain('## What changed')
    expect(notes.actionItems[0]).toMatchObject({ text: 'Do work', owner: 'Tov' })
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
      }),
    )
    const requestBody = JSON.parse(String(vi.mocked(fetcher).mock.calls[0]?.[1]?.body))
    expect(requestBody.messages[0].content).toContain('Match the primary language of the meeting')
    expect(requestBody.messages[0].content).toContain('document field')
    expect(requestBody.messages[1].content).toContain('For long Chinese conversations, write the document in Chinese')
    expect(requestBody.messages[1].content).toContain('Do not include headings like Summary, Goal, Decision')
  })

  it('parses JSON even when the provider wraps it in prose', () => {
    const notes = parseAiNotesJson('Here:\n{"document":"## 自然标题\\n\\n**重点**内容","summary":"S","decisions":[],"actionItems":[],"openQuestions":[],"keyPoints":[],"followUpDraft":""}')

    expect(notes.summary).toBe('S')
    expect(notes.document).toBe('## 自然标题\n\n**重点**内容')
  })

  it('keeps action items when providers use common alternate field names', () => {
    const notes = parseAiNotesJson(
      JSON.stringify({
        summary: 'S',
        decisions: [],
        actionItems: [{ task: 'Prepare the launch checklist', responsible: 'Alice', deadline: 'Friday' }],
        openQuestions: [],
        keyPoints: [],
        followUpDraft: '',
      }),
    )

    expect(notes.actionItems).toEqual([
      {
        id: 'a1',
        text: 'Prepare the launch checklist',
        owner: 'Alice',
        due: 'Friday',
      },
    ])
  })

  it('drops placeholder owner and due values from action items', () => {
    const notes = parseAiNotesJson(
      JSON.stringify({
        summary: 'S',
        decisions: [],
        actionItems: [{ text: 'Prepare the launch checklist', owner: 'Unknown', due: 'TBD' }],
        openQuestions: [],
        keyPoints: [],
        followUpDraft: '',
      }),
    )

    expect(notes.actionItems).toEqual([
      {
        id: 'a1',
        text: 'Prepare the launch checklist',
        owner: undefined,
        due: undefined,
      },
    ])
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

  it('can generate AI Notes through Groq chat completions', async () => {
    const apiKeys = new MemoryApiKeyRepository()
    await apiKeys.save('groq', 'groq-key')
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"summary":"Groq","decisions":[],"actionItems":[],"openQuestions":[],"keyPoints":[],"followUpDraft":""}',
            },
          },
        ],
      }),
    })) as unknown as typeof fetch
    const provider = new OpenAICompatibleAiNotesProvider(
      {
        ...defaultAppSettings,
        aiProvider: 'groq',
        notesModel: 'llama-3.3-70b-versatile',
      },
      apiKeys,
      fetcher,
    )

    const notes = await provider.generateNotes({
      meeting: createDemoMeeting('ready'),
      context: buildAiNotesContext(createDemoMeeting('ready')),
    })

    expect(notes.summary).toBe('Groq')
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer groq-key',
        }),
      }),
    )
  })

  it('can generate AI Notes through OpenRouter chat completions', async () => {
    const apiKeys = new MemoryApiKeyRepository()
    await apiKeys.save('openrouter', 'openrouter-key')
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"summary":"OpenRouter","decisions":[],"actionItems":[],"openQuestions":[],"keyPoints":[],"followUpDraft":""}',
            },
          },
        ],
      }),
    })) as unknown as typeof fetch
    const provider = new OpenAICompatibleAiNotesProvider(
      {
        ...defaultAppSettings,
        aiProvider: 'openrouter',
        notesModel: 'openai/gpt-4o-mini',
      },
      apiKeys,
      fetcher,
    )

    const notes = await provider.generateNotes({
      meeting: createDemoMeeting('ready'),
      context: buildAiNotesContext(createDemoMeeting('ready')),
    })

    expect(notes.summary).toBe('OpenRouter')
    expect(fetcher).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer openrouter-key',
        }),
      }),
    )
  })
})

describe('OpenAICompatibleTranscriptionProvider', () => {
  it('uploads an audio file to an OpenAI-compatible transcription endpoint', async () => {
    const apiKeys = new MemoryApiKeyRepository()
    await apiKeys.save('openai', 'test-key')
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
