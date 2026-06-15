import {
  CAPSULE_COMMAND_EVENT,
  CAPSULE_COMMAND_STORAGE_KEY,
  CAPSULE_STATE_EVENT,
  CAPSULE_STATE_STORAGE_KEY,
  createCapsuleCommandPayload,
  type CapsuleCommand,
  type CapsuleCommandPayload,
  type CapsuleStatePayload,
  parseCapsuleCommandPayload,
  parseCapsuleStatePayload,
} from '../domain/capsule'
import { isTauriRuntime } from './tauri'

type Unsubscribe = () => void

function readStorage(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value))
  } catch {
    /* storage can be unavailable in restricted webviews */
  }
}

function dispatchLocalEvent<T>(name: string, payload: T) {
  try {
    globalThis.window?.dispatchEvent(new CustomEvent(name, { detail: payload }))
  } catch {
    /* ignore non-browser test environments */
  }
}

async function emitTauriEvent<T>(name: string, payload: T) {
  if (!isTauriRuntime()) return

  try {
    const { emit } = await import('@tauri-apps/api/event')
    await emit(name, payload)
  } catch {
    /* the browser fallback has already been written */
  }
}

export function readCapsuleState(): CapsuleStatePayload | undefined {
  return parseCapsuleStatePayload(readStorage(CAPSULE_STATE_STORAGE_KEY))
}

export async function publishCapsuleState(payload: CapsuleStatePayload): Promise<void> {
  writeStorage(CAPSULE_STATE_STORAGE_KEY, payload)
  dispatchLocalEvent(CAPSULE_STATE_EVENT, payload)
  await emitTauriEvent(CAPSULE_STATE_EVENT, payload)
}

export async function emitCapsuleCommand(command: CapsuleCommand): Promise<void> {
  const payload = createCapsuleCommandPayload(command)
  writeStorage(CAPSULE_COMMAND_STORAGE_KEY, payload)
  dispatchLocalEvent(CAPSULE_COMMAND_EVENT, payload)
  await emitTauriEvent(CAPSULE_COMMAND_EVENT, payload)
}

export async function listenCapsuleState(
  onPayload: (payload: CapsuleStatePayload) => void,
): Promise<Unsubscribe> {
  let lastRaw = readStorage(CAPSULE_STATE_STORAGE_KEY)
  const cleanups: Unsubscribe[] = []

  const handlePayload = (payload: CapsuleStatePayload | undefined) => {
    if (payload) onPayload(payload)
  }

  const handleLocalEvent = (event: Event) => {
    handlePayload((event as CustomEvent<CapsuleStatePayload>).detail)
  }
  globalThis.window?.addEventListener(CAPSULE_STATE_EVENT, handleLocalEvent)
  cleanups.push(() => globalThis.window?.removeEventListener(CAPSULE_STATE_EVENT, handleLocalEvent))

  const handleStorage = (event: StorageEvent) => {
    if (event.key === CAPSULE_STATE_STORAGE_KEY) {
      lastRaw = event.newValue
      handlePayload(parseCapsuleStatePayload(event.newValue))
    }
  }
  globalThis.window?.addEventListener('storage', handleStorage)
  cleanups.push(() => globalThis.window?.removeEventListener('storage', handleStorage))

  const interval = globalThis.window?.setInterval(() => {
    const raw = readStorage(CAPSULE_STATE_STORAGE_KEY)
    if (raw === lastRaw) return
    lastRaw = raw
    handlePayload(parseCapsuleStatePayload(raw))
  }, 250)
  if (interval !== undefined) cleanups.push(() => globalThis.window?.clearInterval(interval))

  if (isTauriRuntime()) {
    try {
      const { listen } = await import('@tauri-apps/api/event')
      const unlisten = await listen<CapsuleStatePayload>(CAPSULE_STATE_EVENT, (event) => {
        handlePayload(event.payload)
      })
      cleanups.push(unlisten)
    } catch {
      /* polling fallback is enough */
    }
  }

  return () => cleanups.forEach((cleanup) => cleanup())
}

export async function listenCapsuleCommand(
  onPayload: (payload: CapsuleCommandPayload) => void,
): Promise<Unsubscribe> {
  let lastRaw = readStorage(CAPSULE_COMMAND_STORAGE_KEY)
  const cleanups: Unsubscribe[] = []

  const handlePayload = (payload: CapsuleCommandPayload | undefined) => {
    if (payload) onPayload(payload)
  }

  const handleLocalEvent = (event: Event) => {
    handlePayload((event as CustomEvent<CapsuleCommandPayload>).detail)
  }
  globalThis.window?.addEventListener(CAPSULE_COMMAND_EVENT, handleLocalEvent)
  cleanups.push(() => globalThis.window?.removeEventListener(CAPSULE_COMMAND_EVENT, handleLocalEvent))

  const handleStorage = (event: StorageEvent) => {
    if (event.key === CAPSULE_COMMAND_STORAGE_KEY) {
      lastRaw = event.newValue
      handlePayload(parseCapsuleCommandPayload(event.newValue))
    }
  }
  globalThis.window?.addEventListener('storage', handleStorage)
  cleanups.push(() => globalThis.window?.removeEventListener('storage', handleStorage))

  const interval = globalThis.window?.setInterval(() => {
    const raw = readStorage(CAPSULE_COMMAND_STORAGE_KEY)
    if (raw === lastRaw) return
    lastRaw = raw
    handlePayload(parseCapsuleCommandPayload(raw))
  }, 250)
  if (interval !== undefined) cleanups.push(() => globalThis.window?.clearInterval(interval))

  if (isTauriRuntime()) {
    try {
      const { listen } = await import('@tauri-apps/api/event')
      const unlisten = await listen<CapsuleCommandPayload>(CAPSULE_COMMAND_EVENT, (event) => {
        handlePayload(event.payload)
      })
      cleanups.push(unlisten)
    } catch {
      /* polling fallback is enough */
    }
  }

  return () => cleanups.forEach((cleanup) => cleanup())
}
