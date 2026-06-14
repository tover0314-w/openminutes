import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { APP_SETTINGS_STORAGE_KEY } from './domain/settings'

describe('App', () => {
  it('shows Meeting as a single sidebar entry without a separate Focus nav item', () => {
    render(<App />)
    const nav = screen.getByRole('navigation', { name: /main navigation/i })

    expect(within(nav).getByRole('button', { name: /^meeting$/i })).toBeInTheDocument()
    expect(within(nav).queryByRole('button', { name: /^focus$/i })).not.toBeInTheDocument()
  })

  it('shows live transcript while recording and AI Notes after stop', async () => {
    const user = userEvent.setup()
    render(<App />)
    const nav = screen.getByRole('navigation', { name: /main navigation/i })

    await user.click(within(nav).getByRole('button', { name: /^meeting$/i }))
    expect(screen.getByRole('complementary', { name: /live transcript/i })).toBeInTheDocument()
    expect(screen.queryByLabelText(/ai notes/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /stop recording from meeting/i }))
    expect(screen.getByLabelText(/ai notes/i)).toBeInTheDocument()
    expect(screen.getByText(/desktop-first meeting product/i)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /ai summary/i })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: /original transcript/i })).toBeInTheDocument()
  })

  it('highlights user notes and markers in Review', async () => {
    const user = userEvent.setup()
    render(<App />)
    const nav = screen.getByRole('navigation', { name: /main navigation/i })

    await user.click(within(nav).getByRole('button', { name: /^meeting$/i }))
    await user.click(screen.getByRole('button', { name: /stop recording from meeting/i }))

    const sourceContext = screen.getByRole('region', { name: /user recorded context/i })
    expect(within(sourceContext).getByText(/user notes/i)).toBeInTheDocument()
    expect(within(sourceContext).getAllByText(/ship macos-first/i).length).toBeGreaterThan(0)
    expect(within(sourceContext).getByText(/prototype focus and review modes/i)).toBeInTheDocument()
  })

  it('keeps Settings as a two-column preferences view', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /settings/i }))
    expect(screen.getByRole('button', { name: /general/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /audio/i })).toBeInTheDocument()
    expect(screen.getByText(/capture mode/i)).toBeInTheDocument()
  })

  it('shows provider and export settings in separate panes', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /settings/i }))
    await user.click(screen.getByRole('button', { name: /^ai$/i }))
    expect(screen.getByText(/openai compatible/i)).toBeInTheDocument()
    expect(screen.getByDisplayValue(/https:\/\/api.openai.com\/v1/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /exports/i }))
    expect(screen.getByDisplayValue(/documents\/openminutes/i)).toBeInTheDocument()
  })

  it('persists editable settings through the browser settings repository', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /settings/i }))
    await user.click(screen.getByRole('button', { name: /^ai$/i }))
    await user.click(screen.getByRole('button', { name: /ollama/i }))

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
    await user.click(screen.getByRole('button', { name: /^ai$/i }))

    const apiKeyInput = screen.getByLabelText(/api key/i)
    await user.type(apiKeyInput, 'test-provider-secret')
    await user.click(screen.getByRole('button', { name: /save key/i }))

    await waitFor(() => {
      expect(screen.getByText(/^configured$/i)).toBeInTheDocument()
    })
    expect(localStorage.getItem(APP_SETTINGS_STORAGE_KEY) ?? '').not.toContain('test-provider-secret')
  })

  it('shows a provider configuration error without clearing existing AI Notes', async () => {
    const user = userEvent.setup()
    render(<App />)
    const nav = screen.getByRole('navigation', { name: /main navigation/i })

    await user.click(within(nav).getByRole('button', { name: /^meeting$/i }))
    await user.click(screen.getByRole('button', { name: /stop recording from meeting/i }))
    expect(screen.getByText(/desktop-first meeting product/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /regenerate/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/api key is not configured/i)
    expect(screen.getByText(/desktop-first meeting product/i)).toBeInTheDocument()
  })

  it('copies edited Review AI Notes as Markdown', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    render(<App />)
    const nav = screen.getByRole('navigation', { name: /main navigation/i })

    await user.click(within(nav).getByRole('button', { name: /^meeting$/i }))
    await user.click(screen.getByRole('button', { name: /stop recording from meeting/i }))

    await user.click(screen.getByRole('button', { name: /edit review/i }))
    const summary = screen.getByRole('textbox', { name: /ai summary/i })
    await user.clear(summary)
    await user.type(summary, 'Edited customer-ready summary.')
    await user.click(screen.getByRole('button', { name: /copy markdown/i }))

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('Edited customer-ready summary.'))
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
    await user.click(screen.getByRole('button', { name: /^ai$/i }))
    await user.click(screen.getByRole('button', { name: /local demo stt/i }))
    await user.click(screen.getByRole('button', { name: /local demo notes/i }))
    expect(screen.queryByRole('textbox', { name: /base url/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /api key/i })).not.toBeInTheDocument()

    const input = container.querySelector('input[type="file"]')
    expect(input).toBeInstanceOf(HTMLInputElement)
    await user.upload(input as HTMLInputElement, new File(['audio'], 'customer-call.wav', { type: 'audio/wav' }))

    expect(await screen.findByDisplayValue(/local demo transcript generated for customer-call/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /^generate$/i }))

    expect(await screen.findByText(/local demo notes for customer-call/i)).toBeInTheDocument()
  })

  it('uses edited original transcript lines in the AI generation context', async () => {
    const user = userEvent.setup()
    render(<App />)
    const nav = screen.getByRole('navigation', { name: /main navigation/i })

    await user.click(within(nav).getByRole('button', { name: /^meeting$/i }))
    await user.click(screen.getByRole('button', { name: /stop recording from meeting/i }))

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

  it('links AI Notes back to cited transcript source lines', async () => {
    const user = userEvent.setup()
    render(<App />)
    const nav = screen.getByRole('navigation', { name: /main navigation/i })

    await user.click(within(nav).getByRole('button', { name: /^meeting$/i }))
    await user.click(screen.getByRole('button', { name: /stop recording from meeting/i }))

    await user.click(screen.getByRole('button', { name: /edit review/i }))
    const decision = screen.getByRole('textbox', { name: /decision 1/i })
    await user.clear(decision)
    await user.type(decision, 'During recording, show transcript. AI Notes come after stop.')

    const [sourceLink] = screen.getAllByRole('button', { name: /source 10:06 alex/i })
    await user.click(sourceLink)

    const transcriptPane = screen.getByRole('complementary', { name: /original transcript/i })
    const citedTranscript = within(transcriptPane).getByDisplayValue(/during recording, show transcript/i)
    expect(citedTranscript.closest('.transcript-line')).toHaveClass('selected-source')
  })

  it('can add and delete original transcript lines in Review', async () => {
    const user = userEvent.setup()
    render(<App />)
    const nav = screen.getByRole('navigation', { name: /main navigation/i })

    await user.click(within(nav).getByRole('button', { name: /^meeting$/i }))
    await user.click(screen.getByRole('button', { name: /stop recording from meeting/i }))

    await user.click(screen.getByRole('button', { name: /add line/i }))
    const addedLine = screen.getByRole('textbox', { name: /transcript text 5/i })
    await user.type(addedLine, 'Added missing transcript line.')

    await user.click(screen.getByRole('button', { name: /delete transcript line 1/i }))
    await user.click(screen.getByText(/generation context/i))

    expect(
      screen.getByText((_, node) =>
        Boolean(node?.tagName === 'PRE' && node.textContent?.includes('Added missing transcript line.')),
      ),
    ).toBeInTheDocument()
    expect(screen.queryByDisplayValue(/I think the meeting product should stay separate first/i)).not.toBeInTheDocument()
  })

  it('can rename and merge transcript speakers across Review source lines', async () => {
    const user = userEvent.setup()
    render(<App />)
    const nav = screen.getByRole('navigation', { name: /main navigation/i })

    await user.click(within(nav).getByRole('button', { name: /^meeting$/i }))
    await user.click(screen.getByRole('button', { name: /stop recording from meeting/i }))

    const transcriptPane = screen.getByRole('complementary', { name: /original transcript/i })
    await user.click(within(transcriptPane).getByText(/speakers/i))

    const alexRename = within(transcriptPane).getByRole('textbox', { name: /rename speaker alex/i })
    await user.clear(alexRename)
    await user.type(alexRename, 'Tov')
    await user.click(within(transcriptPane).getByRole('button', { name: /rename all alex/i }))

    const speakerInputs = within(transcriptPane).getAllByRole('textbox', {
      name: /transcript speaker/i,
    })
    expect(speakerInputs.map((input) => (input as HTMLInputElement).value)).toEqual([
      'Tov',
      'Tov',
      'Tov',
      'Tov',
    ])

    await user.click(screen.getByText(/generation context/i))

    const contextPreview = screen.getByText((_, node) => node?.tagName === 'PRE')?.textContent ?? ''
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

    render(<App />)
    const nav = screen.getByRole('navigation', { name: /main navigation/i })

    await user.click(within(nav).getByRole('button', { name: /^meeting$/i }))
    await user.click(screen.getByRole('button', { name: /stop recording from meeting/i }))
    await user.click(screen.getByRole('button', { name: /copy markdown/i }))

    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('# Product sync with Alex'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('## Summary'))
    expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument()
  })
})
