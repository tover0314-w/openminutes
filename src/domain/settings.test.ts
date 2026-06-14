import { describe, expect, it } from 'vitest'
import { defaultAppSettings, normalizeAppSettings } from './settings'

describe('normalizeAppSettings', () => {
  it('fills missing fields from defaults', () => {
    expect(normalizeAppSettings({ aiBaseUrl: 'http://localhost:11434/v1' })).toEqual({
      ...defaultAppSettings,
      aiBaseUrl: 'http://localhost:11434/v1',
    })
  })

  it('rejects invalid enum values', () => {
    const settings = normalizeAppSettings({
      captureSource: 'bad',
      aiProvider: 'bad',
      meetingPreference: 'bad',
    })

    expect(settings.captureSource).toBe(defaultAppSettings.captureSource)
    expect(settings.aiProvider).toBe(defaultAppSettings.aiProvider)
    expect(settings.meetingPreference).toBe(defaultAppSettings.meetingPreference)
  })
})
