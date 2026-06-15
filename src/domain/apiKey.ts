import { type ApiProviderId } from './settings'

export interface ApiKeyRepository {
  has(provider: ApiProviderId): Promise<boolean>
  load(provider: ApiProviderId): Promise<string | undefined>
  save(provider: ApiProviderId, apiKey: string): Promise<void>
  delete(provider: ApiProviderId): Promise<void>
}

export class MemoryApiKeyRepository implements ApiKeyRepository {
  private readonly keys = new Map<ApiProviderId, string>()

  async has(provider: ApiProviderId): Promise<boolean> {
    return Boolean(this.keys.get(provider))
  }

  async load(provider: ApiProviderId): Promise<string | undefined> {
    return this.keys.get(provider)
  }

  async save(provider: ApiProviderId, apiKey: string): Promise<void> {
    const trimmedKey = apiKey.trim()
    if (!trimmedKey) throw new Error('API key cannot be empty.')
    this.keys.set(provider, trimmedKey)
  }

  async delete(provider: ApiProviderId): Promise<void> {
    this.keys.delete(provider)
  }
}

export function createMemoryApiKeyRepository(): MemoryApiKeyRepository {
  return new MemoryApiKeyRepository()
}
