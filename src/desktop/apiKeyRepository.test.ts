import { describe, expect, it, vi } from 'vitest'
import { TauriApiKeyRepository } from './apiKeyRepository'
import { type TauriInvoke } from './tauri'

describe('TauriApiKeyRepository', () => {
  it('delegates key operations to Tauri commands', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'has_provider_api_key') return true
      if (command === 'load_provider_api_key') return 'secret'
      return undefined
    }) as TauriInvoke
    const repository = new TauriApiKeyRepository(invoke)

    await expect(repository.has('openai-compatible')).resolves.toBe(true)
    await expect(repository.load('openai-compatible')).resolves.toBe('secret')
    await repository.save('openai-compatible', 'secret')
    await repository.delete('openai-compatible')

    expect(invoke).toHaveBeenCalledWith('has_provider_api_key', { provider: 'openai-compatible' })
    expect(invoke).toHaveBeenCalledWith('load_provider_api_key', { provider: 'openai-compatible' })
    expect(invoke).toHaveBeenCalledWith('save_provider_api_key', {
      provider: 'openai-compatible',
      apiKey: 'secret',
    })
    expect(invoke).toHaveBeenCalledWith('delete_provider_api_key', { provider: 'openai-compatible' })
  })
})
