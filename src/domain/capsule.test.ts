import { describe, expect, it } from 'vitest'
import {
  createCapsuleCommandPayload,
  createCapsuleStatePayload,
  getCapsuleContentSize,
  getCapsuleFocusable,
  getCapsuleVisualState,
  getCapsuleWindowSize,
  parseCapsuleCommandPayload,
  parseCapsuleStatePayload,
  shouldShowCapsuleWindow,
} from './capsule'

describe('capsule state helpers', () => {
  it('maps meeting phases to desktop capsule visual states', () => {
    expect(getCapsuleVisualState('draft')).toBe('idle')
    expect(getCapsuleVisualState('recording')).toBe('recording')
    expect(getCapsuleVisualState('finalizing_transcript')).toBe('processing')
    expect(getCapsuleVisualState('generating_ai_notes')).toBe('processing')
    expect(getCapsuleVisualState('ready')).toBe('idle')
    expect(getCapsuleVisualState('ready', true)).toBe('done')
    expect(getCapsuleVisualState('needs_review', true)).toBe('done')
    expect(getCapsuleVisualState('error')).toBe('error')
  })

  it('keeps OpenTypeless-style content sizes and padded window sizes', () => {
    expect(getCapsuleContentSize('idle')).toEqual({ width: 36, height: 36 })
    expect(getCapsuleContentSize('recording')).toEqual({ width: 200, height: 36 })
    expect(getCapsuleContentSize('processing')).toEqual({ width: 220, height: 36 })
    expect(getCapsuleContentSize('done')).toEqual({ width: 120, height: 36 })
    expect(getCapsuleContentSize('error')).toEqual({ width: 200, height: 36 })
    expect(getCapsuleWindowSize('recording')).toEqual({ width: 224, height: 60 })
  })

  it('keeps the desktop capsule visible until the user hides it and never focuses it', () => {
    expect(shouldShowCapsuleWindow('idle')).toBe(true)
    expect(shouldShowCapsuleWindow('recording')).toBe(true)
    expect(shouldShowCapsuleWindow('processing')).toBe(true)
    expect(shouldShowCapsuleWindow('done')).toBe(true)
    expect(shouldShowCapsuleWindow('error')).toBe(true)
    expect(shouldShowCapsuleWindow('recording', false)).toBe(false)
    expect(getCapsuleFocusable()).toBe(false)
  })

  it('serializes and validates capsule payloads', () => {
    const state = createCapsuleStatePayload({
      id: 'm1',
      title: 'Weekly sync',
      duration: '00:14',
      phase: 'recording',
    })
    expect(parseCapsuleStatePayload(JSON.stringify(state))).toMatchObject({
      meetingId: 'm1',
      title: 'Weekly sync',
      duration: '00:14',
      phase: 'recording',
      visible: true,
    })
    expect(parseCapsuleStatePayload('bad')).toBeUndefined()

    const command = createCapsuleCommandPayload('hide')
    expect(parseCapsuleCommandPayload(JSON.stringify(command))?.command).toBe('hide')
    expect(parseCapsuleCommandPayload(JSON.stringify({ command: 'bad' }))).toBeUndefined()
  })
})
