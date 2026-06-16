import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { APP_SETTINGS_STORAGE_KEY, defaultAppSettings } from './domain/settings'

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

const realtimeMocks = vi.hoisted(() => {
  const handlers: {
    onLine?: Parameters<typeof import('./desktop/realtimeTranscript').listenRealtimeTranscript>[0]
    onError?: Parameters<typeof import('./desktop/realtimeTranscript').listenRealtimeTranscript>[1]
  } = {}

  return {
    handlers,
    listen: vi.fn(async (onLine, onError) => {
      handlers.onLine = onLine
      handlers.onError = onError
      return vi.fn()
    }),
  }
})

vi.mock('./desktop/audioCapture', () => ({
  createTauriAudioCaptureSession: captureMocks.create,
}))

vi.mock('./desktop/realtimeTranscript', () => ({
  listenRealtimeTranscript: realtimeMocks.listen,
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
    realtimeMocks.listen.mockClear()
    realtimeMocks.handlers.onLine = undefined
    realtimeMocks.handlers.onError = undefined
  })

  it('replaces realtime partial transcript updates instead of appending every revision', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        ...defaultAppSettings,
        transcriptionMode: 'local-demo',
        notesMode: 'local-demo',
      }),
    )

    render(<App />)

    await user.click(screen.getByRole('button', { name: /start meeting/i }))
    await waitFor(() => {
      expect(captureMocks.start).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(realtimeMocks.handlers.onLine).toBeDefined()
    })
    const meetingId = String((captureMocks.start.mock.calls[0] as unknown[])[0])

    await act(async () => {
      realtimeMocks.handlers.onLine?.({
        meetingId,
        line: {
          id: `${meetingId}-live-1`,
          time: '00:03',
          speaker: 'Speaker',
          text: '我已经',
          partial: true,
        },
      })
      realtimeMocks.handlers.onLine?.({
        meetingId,
        line: {
          id: `${meetingId}-live-2`,
          time: '00:17',
          speaker: 'Speaker 0',
          text: '我已经把它打开了。可是我现在在刷牙',
          partial: true,
        },
      })
    })

    const transcriptPane = screen.getByRole('complementary', { name: /live transcript/i })
    expect(within(transcriptPane).getByText(/我已经把它打开了。可是我现在在刷牙/i)).toBeInTheDocument()
    expect(within(transcriptPane).getByText(/Speaker 1:/i)).toBeInTheDocument()
    expect(within(transcriptPane).queryByText(/Speaker 0:/i)).not.toBeInTheDocument()
    expect(within(transcriptPane).queryByText(/^Speaker: 我已经$/i)).not.toBeInTheDocument()
  })

  it('uses the final transcript after stop instead of keeping an inaccurate live draft', async () => {
    const user = userEvent.setup()
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        ...defaultAppSettings,
        transcriptionMode: 'local-demo',
        notesMode: 'local-demo',
      }),
    )

    render(<App />)

    await user.click(screen.getByRole('button', { name: /start meeting/i }))
    await waitFor(() => {
      expect(captureMocks.start).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(realtimeMocks.handlers.onLine).toBeDefined()
    })
    const meetingId = String((captureMocks.start.mock.calls[0] as unknown[])[0])

    await act(async () => {
      realtimeMocks.handlers.onLine?.({
        meetingId,
        line: {
          id: `${meetingId}-live-1`,
          time: '00:08',
          speaker: 'Speaker 0',
          text: '这是错误很多的实时草稿',
          partial: true,
        },
      })
    })
    expect(screen.getByText(/这是错误很多的实时草稿/i)).toBeInTheDocument()

    const meeting = screen.getByRole('region', { name: /meeting/i })
    await user.click(within(meeting).getByRole('button', { name: /stop recording from meeting/i }))

    const transcriptPane = await screen.findByRole('complementary', { name: /sources/i })
    expect(
      within(transcriptPane).getByText(/local demo transcript generated for native-recording/i),
    ).toBeInTheDocument()
    expect(within(transcriptPane).queryByText(/这是错误很多的实时草稿/i)).not.toBeInTheDocument()
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
    const transcriptPane = await screen.findByRole('complementary', { name: /sources/i })
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
    localStorage.setItem(
      APP_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        ...defaultAppSettings,
        transcriptionMode: 'local-demo',
        notesMode: 'local-demo',
      }),
    )

    render(<App />)

    await user.click(screen.getByRole('button', { name: /start meeting/i }))

    expect(await screen.findByText(/microphone permission was denied/i)).toBeInTheDocument()
    expect(screen.queryByText(/unknown error/i)).not.toBeInTheDocument()
  })
})
