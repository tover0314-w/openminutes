import { type ApiKeyRepository } from '../domain/apiKey'
import { type AiProviderId } from '../domain/settings'
import { getTauriInvoke, type TauriInvoke } from './tauri'

export class TauriApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly invoke: TauriInvoke) {}

  has(provider: AiProviderId): Promise<boolean> {
    return this.invoke<boolean>('has_provider_api_key', { provider })
  }

  async load(provider: AiProviderId): Promise<string | undefined> {
    const apiKey = await this.invoke<string | null>('load_provider_api_key', { provider })
    return apiKey ?? undefined
  }

  save(provider: AiProviderId, apiKey: string): Promise<void> {
    return this.invoke<void>('save_provider_api_key', { provider, apiKey })
  }

  delete(provider: AiProviderId): Promise<void> {
    return this.invoke<void>('delete_provider_api_key', { provider })
  }
}

export async function createTauriApiKeyRepository(): Promise<ApiKeyRepository | undefined> {
  const invoke = await getTauriInvoke()
  return invoke ? new TauriApiKeyRepository(invoke) : undefined
}
