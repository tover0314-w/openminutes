import { type ApiKeyRepository } from './apiKey'
import {
  MissingApiKeyError,
  OpenAICompatibleAiNotesProvider,
  OpenAICompatibleTranscriptionProvider,
} from './openAiProvider'
import { type AiNotesProvider, type TranscriptionProvider } from './providers'
import { type AppSettings } from './settings'

export function createAiNotesProvider(
  settings: AppSettings,
  apiKeys: ApiKeyRepository,
): AiNotesProvider {
  return new OpenAICompatibleAiNotesProvider(settings, apiKeys)
}

export function createTranscriptionProvider(
  settings: AppSettings,
  apiKeys: ApiKeyRepository,
): TranscriptionProvider {
  return new OpenAICompatibleTranscriptionProvider(settings, apiKeys)
}

export function isProviderConfigurationError(error: unknown): boolean {
  return error instanceof MissingApiKeyError
}
