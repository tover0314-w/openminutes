import { type ApiKeyRepository } from './apiKey'
import { MissingApiKeyError, OpenAICompatibleAiNotesProvider } from './openAiProvider'
import { type AiNotesProvider } from './providers'
import { type AppSettings } from './settings'

export function createAiNotesProvider(
  settings: AppSettings,
  apiKeys: ApiKeyRepository,
): AiNotesProvider {
  return new OpenAICompatibleAiNotesProvider(settings, apiKeys)
}

export function isProviderConfigurationError(error: unknown): boolean {
  return error instanceof MissingApiKeyError
}
