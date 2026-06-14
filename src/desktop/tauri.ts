export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>

export function isTauriRuntime(): boolean {
  const runtime = globalThis as {
    __TAURI__?: unknown
    __TAURI_INTERNALS__?: unknown
  }

  return Boolean(runtime.__TAURI__ || runtime.__TAURI_INTERNALS__)
}

export async function getTauriInvoke(): Promise<TauriInvoke | undefined> {
  if (!isTauriRuntime()) return undefined

  const { invoke } = await import('@tauri-apps/api/core')
  return invoke as TauriInvoke
}
