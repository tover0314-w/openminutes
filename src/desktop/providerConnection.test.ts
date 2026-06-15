import { describe, expect, it, vi } from 'vitest'
import { testProviderConnection } from './providerConnection'

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(async () => ({
    provider: 'groq',
    ok: true,
    message: 'Groq key accepted.',
    endpoint: 'https://api.groq.com/openai/v1/models',
    status: 200,
  })),
}))

vi.mock('./tauri', () => ({
  isTauriRuntime: () => true,
  getTauriInvoke: vi.fn(async () => tauriMocks.invoke),
}))

describe('testProviderConnection', () => {
  it('delegates provider connection tests to Tauri', async () => {
    await expect(testProviderConnection('groq')).resolves.toMatchObject({
      provider: 'groq',
      ok: true,
      status: 200,
    })

    expect(tauriMocks.invoke).toHaveBeenCalledWith('test_provider_connection', {
      provider: 'groq',
      baseUrl: undefined,
    })
  })

  it('passes custom provider base URLs through to Tauri', async () => {
    await testProviderConnection('openai-compatible', 'https://example.test/v1')

    expect(tauriMocks.invoke).toHaveBeenCalledWith('test_provider_connection', {
      provider: 'openai-compatible',
      baseUrl: 'https://example.test/v1',
    })
  })
})
