import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, Square, X } from 'lucide-react'
import {
  getCapsuleFocusable,
  getCapsuleVisualState,
  getCapsuleWindowSize,
  shouldShowCapsuleWindow,
  type CapsuleStatePayload,
  type CapsuleVisualState,
} from './domain/capsule'
import { emitCapsuleCommand, listenCapsuleState, readCapsuleState } from './desktop/capsuleBridge'
import { isTauriRuntime } from './desktop/tauri'

const DRAG_THRESHOLD = 5

const fallbackCapsuleState: CapsuleStatePayload = {
  meetingId: 'openminutes',
  title: 'OpenMinutes',
  duration: '00:00',
  phase: 'draft',
  visible: true,
  updatedAt: 0,
}

export function CapsuleApp() {
  const [payload, setPayload] = useState<CapsuleStatePayload>(
    () => readCapsuleState() ?? fallbackCapsuleState,
  )
  const [showDone, setShowDone] = useState(false)
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const isDragging = useRef(false)

  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined

    listenCapsuleState((nextPayload) => {
      if (!disposed) setPayload(nextPayload)
    }).then((cleanup) => {
      if (disposed) cleanup()
      else unsubscribe = cleanup
    })

    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    if (payload.phase !== 'ready' && payload.phase !== 'needs_review') {
      setShowDone(false)
      return
    }

    setShowDone(true)
    const timeout = window.setTimeout(() => setShowDone(false), 1400)
    return () => window.clearTimeout(timeout)
  }, [payload.phase, payload.updatedAt])

  const visualState = getCapsuleVisualState(payload.phase, showDone)
  useCapsuleWindow(visualState, payload.visible)

  const handlePointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return
    dragStart.current = { x: event.clientX, y: event.clientY }
    isDragging.current = false
  }

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!dragStart.current || isDragging.current) return
    const dx = event.clientX - dragStart.current.x
    const dy = event.clientY - dragStart.current.y

    if (Math.abs(dx) <= DRAG_THRESHOLD && Math.abs(dy) <= DRAG_THRESHOLD) return

    isDragging.current = true
    dragStart.current = null
    if (!isTauriRuntime()) return

    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().startDragging())
      .catch(() => {})
  }

  const handlePointerUp = (event: React.PointerEvent) => {
    if (event.button !== 0) return
    if (isDragging.current) {
      isDragging.current = false
      dragStart.current = null
      return
    }

    dragStart.current = null
    if (visualState === 'recording') {
      void emitCapsuleCommand('stop')
    } else if (visualState === 'idle') {
      void emitCapsuleCommand('start')
    }
  }

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault()
    void emitCapsuleCommand('hide')
  }

  return (
    <div className="capsule-window" onContextMenu={(event) => event.preventDefault()}>
      <div
        className={`openminutes-capsule-shell ${
          visualState === 'idle' ? 'jelly-capsule' : 'jelly-capsule-active'
        } ${visualState === 'error' ? 'capsule-error' : ''}`}
        onContextMenu={handleContextMenu}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <CapsuleContent payload={payload} visualState={visualState} />
      </div>
    </div>
  )
}

function CapsuleContent({
  payload,
  visualState,
}: {
  payload: CapsuleStatePayload
  visualState: CapsuleVisualState
}) {
  if (visualState === 'idle') {
    return (
      <div className="capsule-content capsule-content-idle" aria-label="Start meeting">
        <img className="capsule-logo" src="/icon.png" alt="" />
      </div>
    )
  }

  if (visualState === 'recording') {
    return (
      <div className="capsule-content capsule-content-recording" aria-label="Recording meeting">
        <span className="capsule-pulse" />
        <CapsuleWaveform />
        <span className="capsule-duration">{payload.duration}</span>
        <button
          className="capsule-icon-button"
          aria-label="Stop recording"
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            void emitCapsuleCommand('stop')
          }}
        >
          <Square size={10} />
        </button>
      </div>
    )
  }

  if (visualState === 'processing') {
    return (
      <div className="capsule-content capsule-content-processing" aria-label="Processing meeting">
        <span className="capsule-spinner" />
        <span className="capsule-label">{processingLabel(payload.phase)}</span>
      </div>
    )
  }

  if (visualState === 'done') {
    return (
      <div className="capsule-content capsule-content-done" aria-label="Meeting ready">
        <Check size={15} />
        <span className="capsule-label">Ready</span>
      </div>
    )
  }

  return (
    <div className="capsule-content capsule-content-error" aria-label="Meeting error">
      <AlertTriangle size={15} />
      <span className="capsule-label">Check app</span>
      <button
        className="capsule-icon-button"
        aria-label="Dismiss"
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation()
          void emitCapsuleCommand('stop')
        }}
      >
        <X size={12} />
      </button>
    </div>
  )
}

function CapsuleWaveform() {
  return (
    <div className="capsule-waveform" aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
      <i />
    </div>
  )
}

function processingLabel(phase: CapsuleStatePayload['phase']): string {
  if (phase === 'generating_ai_notes') return 'Writing notes'
  return 'Transcribing'
}

function useCapsuleWindow(visualState: CapsuleVisualState, visible: boolean) {
  const initialized = useRef(false)
  const previousWindowSize = useRef<{ width: number; height: number } | null>(null)
  const size = useMemo(() => getCapsuleWindowSize(visualState), [visualState])
  const shouldShow = shouldShowCapsuleWindow(visualState, visible)

  useEffect(() => {
    if (!isTauriRuntime()) return
    let cancelled = false

    import('@tauri-apps/api/window')
      .then(async ({ LogicalPosition, LogicalSize, currentMonitor, getCurrentWindow }) => {
        if (cancelled) return

        const win = getCurrentWindow()
        await win.setFocusable(getCapsuleFocusable()).catch(() => {})

        if (!initialized.current) {
          await win.setSize(new LogicalSize(size.width, size.height)).catch(() => {})

          try {
            const monitor = await currentMonitor()
            if (monitor) {
              const scale = monitor.scaleFactor || 1
              const screenX = monitor.position.x / scale
              const screenY = monitor.position.y / scale
              const screenWidth = monitor.size.width / scale
              const screenHeight = monitor.size.height / scale
              const x = Math.round(screenX + screenWidth / 2 - size.width / 2)
              const y = Math.round(screenY + screenHeight - size.height - 80)
              await win.setPosition(new LogicalPosition(x, y)).catch(() => {})
            }
          } catch {
            /* monitor details are best-effort */
          }

          if (shouldShow) await win.show().catch(() => {})
          else await win.hide().catch(() => {})

          initialized.current = true
          previousWindowSize.current = size
          return
        }

        const previous = previousWindowSize.current
        if (previous) {
          const position = await win.outerPosition().catch(() => null)
          if (position) {
            const monitor = await currentMonitor().catch(() => null)
            const scale = monitor?.scaleFactor || 1
            const oldLeftX = position.x / scale
            const oldCenterY = position.y / scale + previous.height / 2
            const nextX = Math.round(oldLeftX)
            const nextY = Math.round(oldCenterY - size.height / 2)
            await win.setPosition(new LogicalPosition(nextX, nextY)).catch(() => {})
          }
        }

        await win.setSize(new LogicalSize(size.width, size.height)).catch(() => {})
        previousWindowSize.current = size

        if (shouldShow) await win.show().catch(() => {})
        else await win.hide().catch(() => {})
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [size, shouldShow])
}
