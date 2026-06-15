import { type ApiProviderId, type RealtimeTranscriptionProviderId } from '../domain/settings'
import { getTauriInvoke, isTauriRuntime } from './tauri'

export type ProviderConnectionTestProvider = ApiProviderId | RealtimeTranscriptionProviderId

export interface ProviderConnectionTestResult {
  provider: string
  ok: boolean
  message: string
  endpoint?: string
  status?: number
}

export async function testProviderConnection(
  provider: ProviderConnectionTestProvider,
  baseUrl?: string,
): Promise<ProviderConnectionTestResult> {
  if (!isTauriRuntime()) {
    throw new Error('Provider connection tests are available in the desktop app.')
  }

  const invoke = await getTauriInvoke()
  if (!invoke) throw new Error('Desktop API is not available.')

  return invoke<ProviderConnectionTestResult>('test_provider_connection', { provider, baseUrl })
}
