import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import {
  createDemoMeeting,
  createDraftMeeting,
  type AiNotes,
  type Meeting,
  type MeetingPhase,
} from './domain/meeting'
import { CAPSULE_STATE_STORAGE_KEY } from './domain/capsule'
import { APP_SETTINGS_STORAGE_KEY, defaultAppSettings } from './domain/settings'
import { MEETINGS_STORAGE_KEY } from './domain/storage'

function seedStoredMeetings(meetings: Meeting[]) {
  localStorage.setItem(
    MEETINGS_STORAGE_KEY,
    JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      meetings,
    }),
  )
}

function seedDemoMeeting(phase: MeetingPhase = 'recording'): Meeting {
  const meeting = {
    ...createDemoMeeting(phase),
    id: 'test-product-sync',
  }
  seedStoredMeetings([meeting])
  return meeting
}

describe('App', () => {
  it('shows Meeting as a single sidebar entry without a separate Focus nav item', () => {
    render(<App />)
    const nav = screen.getByRole('navigation', { name: /main navigation/i })

    expect(within(nav).getByRole('button', { name: /^meeting$/i })).toBeInTheDocument()
    expect(within(nav).queryByRole('button', { name: /^focus$/i })).not.toBeInTheDocument()
  })

  it('opens without seeded demo Review content', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByText(/no meetings yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/product sync with alex/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^ai notes$/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^meeting$/i }))
    expect(screen.getByRole('complementary', { name: /^transcript$/i })).toBeInTheDocument()
    expect(screen.queryByText(/^live$/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /stop recording from meeting/i })).not.toBeInTheDocument()
  })

  it('ignores a stale empty error meeting so the capsule can recover', async () => {
    const staleErrorMeeting: Meeting = {
      ...createDraftMeeting(),
      id: 'stale-empty-error',
      phase: 'error',
    }
    seedStoredMeetings([staleErrorMeeting])

    render(<App />)

    expect(screen.getByText(/no meetings yet/i)).toBeInTheDocument()
    await waitFor(() => {
      const payload = JSON.parse(localStorage.getItem(CAPSULE_STATE_STORAGE_KEY) ?? '{}')
      expect(payload.phase).toBe('draft')
    })
  })

  it('ignores old AI Notes that have no transcript, human notes, or raw audio source', () => {
    const sourcelessNotes: AiNotes = {
      summary: 'This local review confirms that New Meeting has enough source material.',
      decisions: [],
      actionItems: [],
      openQuestions: [],
      keyPoints: [],
      followUpDraft: '',
      document: '## What Mattered\n\nThis local review confirms that New Meeting has enough source material.',
    }
    const staleGeneratedMeeting: Meeting = {
      ...createDraftMeeting(),
      id: 'stale-sourceless-review',
      phase: 'ready',
      aiNotes: sourcelessNotes,
      rawAudio: {
        path: '/tmp/old-openminutes.wav',
        fileName: 'old-openminutes.wav',
        durationMillis: 1000,
        retainedAt: new Date().toISOString(),
      },
    }
    seedStoredMeetings([staleGeneratedMeeting])

    render(<App />)

    expect(screen.getByText(/no meetings yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/this local review confirms/i)).not.toBeInTheDocument()
  })

  it('does not restore legacy local demo meetings as real meetings', () => {
    const demoNotes: AiNotes = {
      summary: 'This local review confirms that New Meeting has enough source material.',
      decisions: ['Use local demo mode only for product walkthroughs and offline testing.'],
      actionItems: [],
      openQuestions: [],
      keyPoints: ['1 transcript lines are available as editable source text.'],
      followUpDraft: 'The local demo flow is working end to end.',
      document: '## What Mattered\n\nThis local review confirms that New Meeting has enough source material.',
    }
    const staleDemoMeeting: Meeting = {
      ...createDraftMeeting(),
      id: 'stale-local-demo-review',
      phase: 'ready',
      transcript: [
        {
          id: 'stale-local-demo-review-mock-1',
          time: '00:04',
          speaker: 'Alex',
          text: 'This is a local demo transcript generated for native-recording.',
        },
      ],
      aiNotes: demoNotes,
    }
    seedStoredMeetings([staleDemoMeeting])

    render(<App />)

    expect(screen.getByText(/no meetings yet/i)).toBeInTheDocument()
    expect(screen.queryByText(/this local review confirms/i)).not.toBeInTheDocument()
  })

  it('does not generate fake Review content when stopping an empty browser recording', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /start meeting/i }))
    await user.click(screen.getByRole('button', { name: /stop recording from meeting/i }))

    expect(await screen.findByText(/no ai notes yet/i)).toBeInTheDocument()
    expect(screen.getByText(/capture human notes or transcript before generating a review/i)).toBeInTheDocument()
    expect(screen.queryByText(/this local review confirms/i)).not.toBeInTheDocument()
  })

  it('shows live transcript while recording and AI Notes after stop', async () => {
    const user = userEvent.setup()
    seedDemoMeeting('recording')
    render(<App />)
    const nav = screen.getByRole('navigation', { name: /main navigation/i })

    await user.click(within(nav).getByRole('button', { name: /^meeting$/i }))
    expect(screen.getByRole('complementary', { name: /live transcript/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/^ai notes$/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /stop recording from meeting/i }))
    expect(await screen.findByLabelText(/^ai notes$/i)).toBeInTheDocument()
    expect(await screen.findByText(/local review confirms that product sync with alex/i)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /ai summary/i })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: /sources/i })).toBeInTheDocument()
  })

  it('links the Review document to the human note source', async () => {
    const user = userEvent.setup()
    seedDemoMeeting('recording')
    render(<App />)
    const nav = screen.getByRole('navigation', { name: /main navigation/i })

    await user.click(within(nav).getByRole('button', { name: /^meeting$/i }))
    await user.click(screen.getByRole('button', { name: /stop recording from meeting/i }))

    expect(screen.queryByRole('button', { name: /human note/i })).not.toBeInTheDocument()

    const humanCitation = screen.getAllByRole('button').find((button) => /\[H\d+\]/.test(button.textContent ?? ''))
    expect(humanCitation).toBeDefined()
    const expectedSourceText = humanCitation?.getAttribute('title') ?? ''
    await user.click(humanCitation as HTMLElement)

    const sourcesPane = screen.getByRole('complementary', { name: /sources/i })
    expect(within(sourcesPane).getByText(/ship macos-first/i)).toBeInTheDocument()
    expect(within(sourcesPane).getByText(/prototype desktop token-compatible ui/i)).toBeInTheDocument()
    expect(
      within(sourcesPane).getByLabelText(/human notes source/i).querySelector('.selected-source'),
    ).toHaveTextContent(expectedSourceText)
    expect(screen.queryByRole('button', { name: /back to review/i })).not.toBeInTheDocument()
    expect(screen.getByLabelText(/ai notes readable document/i)).toBeInTheDocument()
  })

  it('keeps Settings as a two-column preferences view', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /settings/i }))
    expect(screen.getByRole('button', { name: /general/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /transcription/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ai notes/i })).toBeInTheDocument()
    expect(screen.getByText(/capture mode/i)).toBeInTheDocument()
    expect(screen.getByText(/desktop controls/i)).toBeInTheDocument()
    expect(screen.getByDisplayValue(/option\+m/i)).toBeInTheDocument()
  })

  it('shows provider and export settings in separate panes', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /settings/i }))
    await user.click(screen.getByRole('button', { name: /transcription/i }))
    expect(screen.getAllByText(/realtime transcript/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/doubao/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/audio import/i).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: /ai notes/i }))
    expect(screen.getAllByText(/provider llm/i).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/openrouter/i).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: /exports/i }))
    expect(screen.getByDisplayValue(/documents\/openminutes/i)).toBeInTheDocument()
    expect(screen.getByText(/^slack$/i)).toBeInTheDocument()
    expect(screen.getByText(/^notion$/i)).toBeInTheDocument()
    expect(screen.getByText(/^zoom$/i)).toBeInTheDocument()
    expect(screen.getByText(/^teams$/i)).toBeInTheDocument()
  })

  it('persists editable settings through the browser settings repository', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /settings/i }))
    await user.click(screen.getByRole('button', { name: /ai notes/i }))
    await user.selectOptions(screen.getByRole('combobox', { name: /^provider$/i }), 'ollama')

    const baseUrl = screen.getByRole('textbox', { name: /base url/i })
    await user.clear(baseUrl)
    await user.type(baseUrl, 'http://localhost:11434/v1')

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '{}')
      expect(saved.aiProvider).toBe('ollama')
      expect(saved.aiBaseUrl).toBe('http://localhost:11434/v1')
    })
  })

  it('keeps provider API keys out of persisted app settings', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /settings/i }))
    await user.click(screen.getByRole('button', { name: /ai notes/i }))

    const apiKeyInput = screen.getByLabelText(/api key/i)
    await user.type(apiKeyInput, 'test-provider-secret')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      expect(screen.getAllByText(/^configured$/i).length).toBeGreaterThan(0)
    })
    expect(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '').not.toContain('test-provider-secret')
  })

  it('shows a provider configuration error without clearing existing AI Notes', async () => {
    const user = userEvent.setup()
    seedDemoMeeting('recording')
    render(<App />)
    const nav = screen.getByRole('navigation', { name: /main navigation/i })

    await user.click(within(nav).getByRole('button', { name: /^meeting$/i }))
    await user.click(screen.getByRole('button', { name: /stop recording from meeting/i }))
    expect(await screen.findByText(/local review confirms that product sync with alex/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /regenerate/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/api key is not configured/i)
    expect(screen.getByText(/local review confirms that product sync with alex/i)).toBeInTheDocument()
  })

  it('keeps Review AI Notes in one editable document before Markdown export', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    seedDemoMeeting('recording')
    render(<App />)
    const nav = screen.getByRole('navigation', { name: /main navigation/i })

    await user.click(within(nav).getByRole('button', { name: /^meeting$/i }))
    await user.click(screen.getByRole('button', { name: /stop recording from meeting/i }))

    expect(await screen.findByLabelText(/ai notes readable document/i)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /ai notes document/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /ai summary/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^edit$/i }))
    expect(screen.getByRole('textbox', { name: /ai notes document/i })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /done editing/i }))
    await user.click(screen.getByRole('button', { name: /copy markdown/i }))

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('This local review confirms'))
  })

  it('shows a transcript import configuration error when an audio file is imported without a key', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    const input = container.querySelector('input[type="file"]')

    expect(input).toBeInstanceOf(HTMLInputElement)
    await user.upload(input as HTMLInputElement, new File(['audio'], 'customer-call.wav', { type: 'audio/wav' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/api key is not configured/i)
    expect(screen.getByRole('button', { name: /retry import/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /meeting/i })).toBeInTheDocument()
    expect(screen.getByText(/customer-call/i)).toBeInTheDocument()
  })

  it('imports audio and generates notes in local demo mode without provider keys', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)

    await user.click(screen.getByRole('button', { name: /settings/i }))
    await user.click(screen.getByRole('button', { name: /transcription/i }))
    await user.click(screen.getByRole('button', { name: /local demo stt/i }))
    await user.click(screen.getByRole('button', { name: /ai notes/i }))
    await user.click(screen.getByRole('button', { name: /local demo notes/i }))
    expect(screen.queryByRole('textbox', { name: /base url/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /api key/i })).not.toBeInTheDocument()

    const input = container.querySelector('input[type="file"]')
    expect(input).toBeInstanceOf(HTMLInputElement)
    await user.upload(input as HTMLInputElement, new File(['audio'], 'customer-call.wav', { type: 'audio/wav' }))

    const transcriptPane = await screen.findByRole('complementary', { name: /sources/i })
    expect(
      within(transcriptPane).getByText(/local demo transcript generated for customer-call/i),
    ).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    expect(await screen.findByText(/local review confirms that customer-call/i)).toBeInTheDocument()
  })

  it('runs the provider-backed audio import to AI Notes flow with a configured OpenAI key', async () => {
    const user = userEvent.setup()
    const originalFetch = globalThis.fetch
    let resolveChatResponse: ((response: Response) => void) | undefined
    const chatResponse = new Promise<Response>((resolve) => {
      resolveChatResponse = resolve
    })
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString()
      if (url.endsWith('/audio/transcriptions')) {
        return new Response(
          JSON.stringify({
            segments: [{ id: 1, start: 3.4, text: 'Provider transcript line.' }],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      }

      if (url.endsWith('/chat/completions')) {
        expect(init?.body?.toString()).toContain('Provider transcript line.')
        return chatResponse
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    }) as unknown as typeof fetch

    Object.defineProperty(globalThis, 'fetch', {
      value: fetcher,
      configurable: true,
    })

    try {
      localStorage.setItem(
        APP_SETTINGS_STORAGE_KEY,
        JSON.stringify({
          ...defaultAppSettings,
          aiProvider: 'openai',
          transcriptionProvider: 'openai',
          realtimeTranscriptionProvider: 'openai-realtime',
          transcriptionMode: 'provider',
          notesMode: 'provider',
          realtimeModel: 'gpt-realtime-whisper',
          sttModel: 'gpt-4o-mini-transcribe',
          notesModel: 'gpt-4.1-mini',
        }),
      )
      const { container } = render(<App />)

      await user.click(screen.getByRole('button', { name: /settings/i }))
      await user.click(screen.getByRole('button', { name: /ai notes/i }))

      const apiKeyInput = screen.getByLabelText(/api key/i)
      await user.type(apiKeyInput, 'test-openai-key')
      await user.click(screen.getByRole('button', { name: /^save$/i }))
      await waitFor(() => {
        expect(screen.getAllByText(/^configured$/i).length).toBeGreaterThan(0)
      })

      const input = container.querySelector('input[type="file"]')
      expect(input).toBeInstanceOf(HTMLInputElement)
      await user.upload(input as HTMLInputElement, new File(['audio'], 'provider-call.wav', { type: 'audio/wav' }))

      const transcriptPane = await screen.findByRole('complementary', {
        name: /sources/i,
      })
      expect(within(transcriptPane).getByText(/provider transcript line/i)).toBeInTheDocument()
      expect(await screen.findByText(/writing ai notes/i)).toBeInTheDocument()
      expect(screen.queryByLabelText(/ai notes readable document/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/provider generated summary/i)).not.toBeInTheDocument()

      await act(async () => {
        resolveChatResponse?.(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      summary: 'Provider generated summary.',
                      decisions: ['Use provider path for real testing.'],
                      actionItems: [{ id: 'a1', text: 'Compare cloud providers.' }],
                      openQuestions: ['Which provider wins on latency?'],
                      keyPoints: ['Provider transcript line was used as context.'],
                      followUpDraft: 'Follow up with the provider benchmark.',
                    }),
                  },
                },
              ],
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          ),
        )
      })

      expect(await screen.findByText(/provider generated summary/i)).toBeInTheDocument()
      expect(fetcher).toHaveBeenCalledWith(
        'https://api.openai.com/v1/audio/transcriptions',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-openai-key',
          }),
        }),
      )
      expect(fetcher).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-openai-key',
          }),
        }),
      )
    } finally {
      Object.defineProperty(globalThis, 'fetch', {
        value: originalFetch,
        configurable: true,
      })
    }
  })

  it('uses edited original transcript lines in the AI generation context', async () => {
    const user = userEvent.setup()
    seedDemoMeeting('recording')
    render(<App />)
    const nav = screen.getByRole('navigation', { name: /main navigation/i })

    await user.click(within(nav).getByRole('button', { name: /^meeting$/i }))
    await user.click(screen.getByRole('button', { name: /stop recording from meeting/i }))

    await user.click(screen.getByRole('button', { name: /edit transcript line 1/i }))
    const transcriptText = screen.getByRole('textbox', { name: /transcript text 1/i })
    await user.clear(transcriptText)
    await user.type(transcriptText, 'Edited source transcript line.')
    await user.click(screen.getByText(/generation context/i))

    expect(
      screen.getByText((_, node) =>
        Boolean(node?.tagName === 'PRE' && node.textContent?.includes('Edited source transcript line.')),
      ),
    ).toBeInTheDocument()
  })

  it('highlights Review sources from citation markers and can open the Focus source', async () => {
    const user = userEvent.setup()
    seedDemoMeeting('recording')
    render(<App />)
    const nav = screen.getByRole('navigation', { name: /main navigation/i })

    await user.click(within(nav).getByRole('button', { name: /^meeting$/i }))
    await user.click(screen.getByRole('button', { name: /stop recording from meeting/i }))

    const humanCitation = screen
      .getAllByRole('button')
      .find((button) => /right side is original transcript\/source/i.test(button.getAttribute('title') ?? ''))
    expect(humanCitation).toBeDefined()
    await user.click(humanCitation as HTMLElement)

    const sourcesPane = screen.getByRole('complementary', { name: /sources/i })
    expect(within(sourcesPane).getByText(/right side is original transcript\/source/i)).toBeInTheDocument()
    expect(
      within(sourcesPane).getByLabelText(/human notes source/i).querySelector('.selected-source'),
    ).toHaveTextContent(/right side is original transcript\/source/i)

    await user.click(screen.getByRole('button', { name: /^focus$/i }))
    expect(screen.getByLabelText(/human note text/i).querySelector('.selected-source')).toHaveTextContent(
      /right side is original transcript\/source/i,
    )

    await user.click(screen.getByRole('button', { name: /back to review/i }))
    const transcriptCitation = screen
      .getAllByRole('button')
      .find((button) => /\[T \d{2}:\d{2}\]/.test(button.textContent ?? ''))
    expect(transcriptCitation).toBeDefined()
    await user.click(transcriptCitation as HTMLElement)

    const transcriptPane = screen.getByRole('complementary', { name: /sources/i })
    expect(transcriptPane.querySelector('.transcript-line.selected-source')).toBeInTheDocument()
  })

  it('can add and delete original transcript lines in Review', async () => {
    const user = userEvent.setup()
    seedDemoMeeting('recording')
    render(<App />)
    const nav = screen.getByRole('navigation', { name: /main navigation/i })

    await user.click(within(nav).getByRole('button', { name: /^meeting$/i }))
    await user.click(screen.getByRole('button', { name: /stop recording from meeting/i }))

    await user.click(screen.getByRole('button', { name: /add line/i }))
    const addedLine = screen.getByRole('textbox', { name: /transcript text 5/i })
    await user.type(addedLine, 'Added missing transcript line.')

    await user.click(screen.getByRole('button', { name: /edit transcript line 1/i }))
    await user.click(screen.getByRole('button', { name: /delete transcript line 1/i }))
    await user.click(screen.getByText(/generation context/i))

    expect(
      screen.getByText((_, node) =>
        Boolean(node?.tagName === 'PRE' && node.textContent?.includes('Added missing transcript line.')),
      ),
    ).toBeInTheDocument()
    const contextPreview =
      screen.getByText(/generation context/i).parentElement?.querySelector('pre')?.textContent ?? ''
    expect(contextPreview).not.toContain('I think the meeting product should stay separate first')
  })

  it('can rename and merge transcript speakers across Review source lines', async () => {
    const user = userEvent.setup()
    seedDemoMeeting('recording')
    render(<App />)
    const nav = screen.getByRole('navigation', { name: /main navigation/i })

    await user.click(within(nav).getByRole('button', { name: /^meeting$/i }))
    await user.click(screen.getByRole('button', { name: /stop recording from meeting/i }))

    const transcriptPane = screen.getByRole('complementary', { name: /sources/i })
    await user.click(within(transcriptPane).getByText(/speakers/i))

    const alexRename = within(transcriptPane).getByRole('textbox', { name: /rename speaker alex/i })
    await user.clear(alexRename)
    await user.type(alexRename, 'Tov')
    await user.click(within(transcriptPane).getByRole('button', { name: /rename all alex/i }))

    expect(within(transcriptPane).queryByRole('textbox', { name: /rename speaker alex/i })).not.toBeInTheDocument()

    await user.click(screen.getByText(/generation context/i))

    const contextPreview =
      screen.getByText(/generation context/i).parentElement?.querySelector('pre')?.textContent ?? ''
    expect(contextPreview).toContain('10:06 Tov: During recording')
    expect(contextPreview).not.toContain('10:06 Alex:')
  })

  it('copies Review AI Notes as Markdown', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    seedDemoMeeting('recording')
    render(<App />)
    const nav = screen.getByRole('navigation', { name: /main navigation/i })

    await user.click(within(nav).getByRole('button', { name: /^meeting$/i }))
    await user.click(screen.getByRole('button', { name: /stop recording from meeting/i }))
    await user.click(screen.getByRole('button', { name: /copy markdown/i }))

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('# Product sync with Alex'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('## What Mattered'))
    expect(writeText).not.toHaveBeenCalledWith(expect.stringContaining('## Decisions'))
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining(
        '_Source: 12:04 Tov - In Review, the AI-generated notes should be the main content',
      ),
    )
    expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument()
  })

  it('honors the export setting for including transcript in copied Markdown', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    seedDemoMeeting('recording')
    render(<App />)

    await user.click(screen.getByRole('button', { name: /settings/i }))
    await user.click(screen.getByRole('button', { name: /exports/i }))
    await user.click(screen.getByRole('switch', { name: /include transcript/i }))

    const nav = screen.getByRole('navigation', { name: /main navigation/i })
    await user.click(within(nav).getByRole('button', { name: /^meeting$/i }))
    await user.click(screen.getByRole('button', { name: /stop recording from meeting/i }))
    await user.click(screen.getByRole('button', { name: /copy markdown/i }))

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('## Original Transcript'))
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('10:06 Alex: During recording, show transcript. AI Notes come after stop.'),
    )
  })
})
