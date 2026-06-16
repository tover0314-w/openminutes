import { type ApiKeyRepository } from './apiKey'
import { DeepgramTranscriptionProvider } from './deepgramProvider'
import { DoubaoDesktopTranscriptionProvider } from '../desktop/doubaoTranscription'
import {
  MissingApiKeyError,
  OpenAICompatibleAiNotesProvider,
  OpenAICompatibleTranscriptionProvider,
} from './openAiProvider'
import {
  MockAiNotesProvider,
  MockTranscriptionProvider,
  type AiNotesProvider,
  type TranscriptionProvider,
} from './providers'
import { type AppSettings } from './settings'

export function createAiNotesProvider(
  settings: AppSettings,
  apiKeys: ApiKeyRepository,
): AiNotesProvider {
  if (settings.notesMode === 'local-demo') return new MockAiNotesProvider()

  return new OpenAICompatibleAiNotesProvider(settings, apiKeys)
}

export function createTranscriptionProvider(
  settings: AppSettings,
  apiKeys: ApiKeyRepository,
): TranscriptionProvider {
  if (settings.transcriptionMode === 'local-demo') return new MockTranscriptionProvider()
  if (settings.transcriptionProvider === 'doubao') {
    return new DoubaoDesktopTranscriptionProvider(settings, apiKeys)
  }
  if (settings.transcriptionProvider === 'deepgram') {
    return new DeepgramTranscriptionProvider(settings, apiKeys)
  }

  return new OpenAICompatibleTranscriptionProvider(settings, apiKeys)
}

export function isProviderConfigurationError(error: unknown): boolean {
  return error instanceof MissingApiKeyError
}
