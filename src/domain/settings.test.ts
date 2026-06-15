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
      transcriptionMode: 'bad',
      notesMode: 'bad',
    })

    expect(settings.captureSource).toBe(defaultAppSettings.captureSource)
    expect(settings.aiProvider).toBe(defaultAppSettings.aiProvider)
    expect(settings.meetingPreference).toBe(defaultAppSettings.meetingPreference)
    expect(settings.transcriptionMode).toBe(defaultAppSettings.transcriptionMode)
    expect(settings.notesMode).toBe(defaultAppSettings.notesMode)
  })

  it('normalizes local demo provider run modes', () => {
    const settings = normalizeAppSettings({
      transcriptionMode: 'local-demo',
      notesMode: 'local-demo',
    })

    expect(settings.transcriptionMode).toBe('local-demo')
    expect(settings.notesMode).toBe('local-demo')
  })

  it('keeps cloud provider selections for transcription and AI Notes', () => {
    const settings = normalizeAppSettings({
      aiProvider: 'openrouter',
      transcriptionProvider: 'doubao',
      realtimeTranscriptionProvider: 'doubao-realtime',
    })

    expect(settings.aiProvider).toBe('openrouter')
    expect(settings.transcriptionProvider).toBe('doubao')
    expect(settings.realtimeTranscriptionProvider).toBe('doubao-realtime')
  })

  it('does not allow realtime-only providers as AI Notes providers', () => {
    const settings = normalizeAppSettings({
      aiProvider: 'doubao',
    })

    expect(settings.aiProvider).toBe(defaultAppSettings.aiProvider)
  })
})
