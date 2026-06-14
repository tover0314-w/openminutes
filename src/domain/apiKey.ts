import { type AiProviderId } from './settings'

export interface ApiKeyRepository {
  has(provider: AiProviderId): Promise<boolean>
  load(provider: AiProviderId): Promise<string | undefined>
  save(provider: AiProviderId, apiKey: string): Promise<void>
  delete(provider: AiProviderId): Promise<void>
}

export class MemoryApiKeyRepository implements ApiKeyRepository {
  private readonly keys = new Map<AiProviderId, string>()

  async has(provider: AiProviderId): Promise<boolean> {
    return Boolean(this.keys.get(provider))
  }

  async load(provider: AiProviderId): Promise<string | undefined> {
    return this.keys.get(provider)
  }

  async save(provider: AiProviderId, apiKey: string): Promise<void> {
    const trimmedKey = apiKey.trim()
    if (!trimmedKey) throw new Error('API key cannot be empty.')
    this.keys.set(provider, trimmedKey)
  }

  async delete(provider: AiProviderId): Promise<void> {
    this.keys.delete(provider)
  }
}

export function createMemoryApiKeyRepository(): MemoryApiKeyRepository {
  return new MemoryApiKeyRepository()
}
