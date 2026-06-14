import {
  type AppSettings,
  type AppSettingsRepository,
  normalizeAppSettings,
} from '../domain/settings'
import { getTauriInvoke, type TauriInvoke } from './tauri'

export class TauriAppSettingsRepository implements AppSettingsRepository {
  constructor(private readonly invoke: TauriInvoke) {}

  async load(): Promise<AppSettings> {
    const settings = await this.invoke<unknown>('load_app_settings')
    return normalizeAppSettings(settings)
  }

  save(settings: AppSettings): Promise<void> {
    return this.invoke<void>('save_app_settings', { settings })
  }
}

export async function createTauriAppSettingsRepository(): Promise<AppSettingsRepository | undefined> {
  const invoke = await getTauriInvoke()
  return invoke ? new TauriAppSettingsRepository(invoke) : undefined
}
