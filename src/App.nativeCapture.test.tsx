import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  const deleteFile = vi.fn(async () => ({ path: '/tmp/native-recording.wav', deleted: true }))

  return {
    start,
    stop,
    status,
    deleteFile,
    create: vi.fn(async () => ({ start, stop, status, deleteFile })),
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
  beforeEach(() => {
    captureMocks.start.mockReset()
    captureMocks.start.mockResolvedValue({ recording: true })
    captureMocks.stop.mockClear()
    captureMocks.status.mockClear()
    captureMocks.deleteFile.mockClear()
    captureMocks.create.mockClear()
  })

  it('runs the desktop meeting flow from native capture through AI Notes and raw audio cleanup', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    render(<App />)

    await user.click(screen.getByRole('button', { name: /settings/i }))
    await user.click(screen.getByRole('switch', { name: /save raw audio/i }))

    await user.click(screen.getByRole('button', { name: /transcription/i }))
    await user.click(screen.getByRole('button', { name: /local demo stt/i }))
    await user.click(screen.getByRole('button', { name: /ai notes/i }))
    await user.click(screen.getByRole('button', { name: /local demo notes/i }))

    await user.click(screen.getByRole('button', { name: /start meeting/i }))
    await waitFor(() => {
      expect(captureMocks.start).toHaveBeenCalledWith(expect.stringMatching(/^meeting-/), {})
    })

    const meeting = screen.getByRole('region', { name: /meeting/i })
    await user.click(within(meeting).getByRole('button', { name: /stop recording from meeting/i }))

    await waitFor(() => {
      expect(captureMocks.stop).toHaveBeenCalledWith({ keepFile: true })
    })
    const transcriptPane = await screen.findByRole('complementary', { name: /original transcript/i })
    expect(
      within(transcriptPane).getByText(/local demo transcript generated for native-recording/i),
    ).toBeInTheDocument()
    expect(await screen.findByText(/local review confirms that new meeting/i)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /copy markdown/i }))
    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('This local review confirms that New Meeting'),
    )

    expect(await screen.findByText(/^raw audio$/i)).toBeInTheDocument()
    expect(screen.getAllByText(/native-recording.wav/i).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('button', { name: /delete raw audio/i }))

    await waitFor(() => {
      expect(captureMocks.deleteFile).toHaveBeenCalledWith('/tmp/native-recording.wav')
    })
    expect(screen.queryByText(/^raw audio$/i)).not.toBeInTheDocument()
  })

  it('shows string errors from native capture instead of a generic unknown error', async () => {
    const user = userEvent.setup()
    captureMocks.start.mockRejectedValueOnce('Microphone permission was denied.')

    render(<App />)

    await user.click(screen.getByRole('button', { name: /start meeting/i }))

    expect(await screen.findByText(/microphone permission was denied/i)).toBeInTheDocument()
    expect(screen.queryByText(/unknown error/i)).not.toBeInTheDocument()
  })
})
