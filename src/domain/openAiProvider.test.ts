import { describe, expect, it, vi } from 'vitest'
import { MemoryApiKeyRepository } from './apiKey'
import { createDemoMeeting } from './meeting'
import { MissingApiKeyError, OpenAICompatibleAiNotesProvider, parseAiNotesJson } from './openAiProvider'
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
