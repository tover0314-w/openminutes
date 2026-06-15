import { describe, expect, it } from 'vitest'
import { buildAiNotesContext, createDemoMeeting, getMeetingMode, getMeetingViewModel } from './meeting'

describe('meeting view model', () => {
  it('uses Focus with manual notes and live transcript while recording', () => {
    const meeting = createDemoMeeting('recording')
    const view = getMeetingViewModel(meeting)

    expect(getMeetingMode(meeting.phase)).toBe('focus')
    expect(view.mainPane).toBe('manual_notes')
    expect(view.rightPane).toBe('live_transcript')
    expect(view.canStop).toBe(true)
    expect(view.canGenerateAiNotes).toBe(false)
  })

  it('uses Review with AI Notes as main content and transcript as source after stop', () => {
    const meeting = createDemoMeeting('ready')
    const view = getMeetingViewModel(meeting)

    expect(getMeetingMode(meeting.phase)).toBe('review')
    expect(view.mainPane).toBe('ai_notes')
    expect(view.rightPane).toBe('source_transcript')
    expect(view.canExport).toBe(true)
  })

  it('builds AI context with manual notes before transcript', () => {
    const context = buildAiNotesContext(createDemoMeeting('ready'))

    expect(context.indexOf('Manual notes:')).toBeLessThan(context.indexOf('Transcript:'))
    expect(context).not.toContain('Markers:')
    expect(context).toContain('Alex: I think the meeting product should stay separate first.')
  })
})
