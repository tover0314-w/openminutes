import { type ApiKeyRepository } from '../domain/apiKey'
import { type ApiProviderId } from '../domain/settings'
import { getTauriInvoke, type TauriInvoke } from './tauri'

export class TauriApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly invoke: TauriInvoke) {}

  has(provider: ApiProviderId): Promise<boolean> {
    return this.invoke<boolean>('has_provider_api_key', { provider })
  }

  async load(provider: ApiProviderId): Promise<string | undefined> {
    const apiKey = await this.invoke<string | null>('load_provider_api_key', { provider })
    return apiKey ?? undefined
  }

  save(provider: ApiProviderId, apiKey: string): Promise<void> {
    return this.invoke<void>('save_provider_api_key', { provider, apiKey })
  }

  delete(provider: ApiProviderId): Promise<void> {
    return this.invoke<void>('delete_provider_api_key', { provider })
  }
}

export async function createTauriApiKeyRepository(): Promise<ApiKeyRepository | undefined> {
  const invoke = await getTauriInvoke()
  return invoke ? new TauriApiKeyRepository(invoke) : undefined
}
