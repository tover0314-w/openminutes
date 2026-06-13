import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'

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
})
