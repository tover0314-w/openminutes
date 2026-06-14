export type CaptureSource = 'mic-system' | 'microphone-only'
export type MeetingPreference = 'focus-first' | 'split-view'
export type AiProviderId = 'openai-compatible' | 'ollama'
export type ProviderRunMode = 'provider' | 'local-demo'

export interface AppSettings {
  captureSource: CaptureSource
  meetingPreference: MeetingPreference
  systemAudioEnabled: boolean
  saveRawAudio: boolean
  hideTranscriptByDefault: boolean
  noPublicLinks: boolean
  aiProvider: AiProviderId
  transcriptionMode: ProviderRunMode
  notesMode: ProviderRunMode
  aiBaseUrl: string
  sttModel: string
  notesModel: string
  useKeychain: boolean
  exportFolder: string
  includeTranscriptInExport: boolean
  slackWebhookLabel: string
  notionExportLabel: string
}

export interface AppSettingsRepository {
  load(): Promise<AppSettings>
  save(settings: AppSettings): Promise<void>
}

export const APP_SETTINGS_STORAGE_KEY = 'openminutes.settings.v1'

export const defaultAppSettings: AppSettings = {
  captureSource: 'mic-system',
  meetingPreference: 'focus-first',
  systemAudioEnabled: true,
  saveRawAudio: false,
  hideTranscriptByDefault: true,
  noPublicLinks: true,
  aiProvider: 'openai-compatible',
  transcriptionMode: 'provider',
  notesMode: 'provider',
  aiBaseUrl: 'https://api.openai.com/v1',
  sttModel: 'whisper-1',
  notesModel: 'gpt-4.1-mini',
  useKeychain: true,
  exportFolder: 'Documents/OpenMinutes',
  includeTranscriptInExport: false,
  slackWebhookLabel: 'Webhook placeholder',
  notionExportLabel: 'Page export placeholder',
}

export class BrowserAppSettingsRepository implements AppSettingsRepository {
  constructor(private readonly key = APP_SETTINGS_STORAGE_KEY) {}

  async load(): Promise<AppSettings> {
    return loadBrowserAppSettings(this.key)
  }

  async save(settings: AppSettings): Promise<void> {
    globalThis.localStorage?.setItem(this.key, JSON.stringify(settings))
  }
}

export function createBrowserAppSettingsRepository(): BrowserAppSettingsRepository {
  return new BrowserAppSettingsRepository()
}

export function loadBrowserAppSettings(key = APP_SETTINGS_STORAGE_KEY): AppSettings {
  const raw = globalThis.localStorage?.getItem(key)

  if (!raw) return defaultAppSettings

  try {
    return normalizeAppSettings(JSON.parse(raw))
  } catch {
    return defaultAppSettings
  }
}

export function normalizeAppSettings(value: unknown): AppSettings {
  const partial = typeof value === 'object' && value !== null ? (value as Partial<AppSettings>) : {}

  return {
    captureSource: isCaptureSource(partial.captureSource)
      ? partial.captureSource
      : defaultAppSettings.captureSource,
    meetingPreference: isMeetingPreference(partial.meetingPreference)
      ? partial.meetingPreference
      : defaultAppSettings.meetingPreference,
    systemAudioEnabled: booleanOrDefault(partial.systemAudioEnabled, defaultAppSettings.systemAudioEnabled),
    saveRawAudio: booleanOrDefault(partial.saveRawAudio, defaultAppSettings.saveRawAudio),
    hideTranscriptByDefault: booleanOrDefault(
      partial.hideTranscriptByDefault,
      defaultAppSettings.hideTranscriptByDefault,
    ),
    noPublicLinks: booleanOrDefault(partial.noPublicLinks, defaultAppSettings.noPublicLinks),
    aiProvider: isAiProvider(partial.aiProvider) ? partial.aiProvider : defaultAppSettings.aiProvider,
    transcriptionMode: isProviderRunMode(partial.transcriptionMode)
      ? partial.transcriptionMode
      : defaultAppSettings.transcriptionMode,
    notesMode: isProviderRunMode(partial.notesMode)
      ? partial.notesMode
      : defaultAppSettings.notesMode,
    aiBaseUrl: stringOrDefault(partial.aiBaseUrl, defaultAppSettings.aiBaseUrl),
    sttModel: stringOrDefault(partial.sttModel, defaultAppSettings.sttModel),
    notesModel: stringOrDefault(partial.notesModel, defaultAppSettings.notesModel),
    useKeychain: booleanOrDefault(partial.useKeychain, defaultAppSettings.useKeychain),
    exportFolder: stringOrDefault(partial.exportFolder, defaultAppSettings.exportFolder),
    includeTranscriptInExport: booleanOrDefault(
      partial.includeTranscriptInExport,
      defaultAppSettings.includeTranscriptInExport,
    ),
    slackWebhookLabel: stringOrDefault(partial.slackWebhookLabel, defaultAppSettings.slackWebhookLabel),
    notionExportLabel: stringOrDefault(partial.notionExportLabel, defaultAppSettings.notionExportLabel),
  }
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function stringOrDefault(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function isCaptureSource(value: unknown): value is CaptureSource {
  return value === 'mic-system' || value === 'microphone-only'
}

function isMeetingPreference(value: unknown): value is MeetingPreference {
  return value === 'focus-first' || value === 'split-view'
}

function isAiProvider(value: unknown): value is AiProviderId {
  return value === 'openai-compatible' || value === 'ollama'
}

function isProviderRunMode(value: unknown): value is ProviderRunMode {
  return value === 'provider' || value === 'local-demo'
}
