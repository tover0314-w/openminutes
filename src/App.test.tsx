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
    expect(screen.getByRole('complementary', { name: /original transcript/i })).toBeInTheDocument()
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
