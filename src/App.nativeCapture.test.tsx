import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'

const captureMocks = vi.hoisted(() => {
  const start = vi.fn(async () => ({ recording: true }))
  const stop = vi.fn(async () => ({
    file: new File(['native wav'], 'native-recording.wav', { type: 'audio/wav' }),
    path: '/tmp/native-recording.wav',
    durationMillis: 1200,
    retained: true,
  }))
  const status = vi.fn(async () => ({ recording: false }))

  return {
    start,
    stop,
    status,
    create: vi.fn(async () => ({ start, stop, status })),
  }
})

vi.mock('./desktop/audioCapture', () => ({
  createTauriAudioCaptureSession: captureMocks.create,
}))

vi.mock('./desktop/tauri', () => ({
  isTauriRuntime: () => true,
  getTauriInvoke: vi.fn(async () => undefined),
}))

describe('App native microphone capture', () => {
  it('passes the Save raw audio setting into native stop capture', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: /settings/i }))
    await user.click(screen.getByRole('button', { name: /^audio$/i }))
    await user.click(screen.getByRole('switch', { name: /save raw audio/i }))

    await user.click(screen.getByRole('button', { name: /^ai$/i }))
    await user.click(screen.getByRole('button', { name: /local demo stt/i }))

    await user.click(screen.getByRole('button', { name: /start meeting/i }))
    await waitFor(() => {
      expect(captureMocks.start).toHaveBeenCalledWith('product-sync-alex')
    })

    const meeting = screen.getByRole('region', { name: /meeting/i })
    await user.click(within(meeting).getByRole('button', { name: /stop recording from meeting/i }))

    await waitFor(() => {
      expect(captureMocks.stop).toHaveBeenCalledWith({ keepFile: true })
    })
    expect(
      await screen.findByDisplayValue(/local demo transcript generated for native-recording/i),
    ).toBeInTheDocument()
  })
})
