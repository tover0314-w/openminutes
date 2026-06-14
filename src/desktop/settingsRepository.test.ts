import { describe, expect, it, vi } from 'vitest'
import { defaultAppSettings } from '../domain/settings'
import { TauriAppSettingsRepository } from './settingsRepository'
import { type TauriInvoke } from './tauri'

describe('TauriAppSettingsRepository', () => {
  it('loads and saves settings through Tauri commands', async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === 'load_app_settings') return defaultAppSettings
      return undefined
    }) as TauriInvoke
    const repository = new TauriAppSettingsRepository(invoke)

    await expect(repository.load()).resolves.toEqual(defaultAppSettings)
    await repository.save(defaultAppSettings)

    expect(invoke).toHaveBeenCalledWith('load_app_settings')
    expect(invoke).toHaveBeenCalledWith('save_app_settings', { settings: defaultAppSettings })
  })
})
