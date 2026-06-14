import { describe, expect, it } from 'vitest'
import { createDemoMeeting } from './meeting'
import { formatMeetingMarkdown } from './markdown'

describe('formatMeetingMarkdown', () => {
  it('exports AI Notes without transcript by default', () => {
    const markdown = formatMeetingMarkdown(createDemoMeeting('ready'))

    expect(markdown).toContain('# Product sync with Alex')
    expect(markdown).toContain('## Summary')
    expect(markdown).toContain('- [ ] Implement the token-compatible desktop meeting shell. (Tov)')
    expect(markdown).toContain(
      '_Sources: 10:06 Alex - During recording, show transcript. AI Notes come after stop.',
    )
    expect(markdown).not.toContain('## Original Transcript')
  })

  it('can omit source citations when requested', () => {
    const markdown = formatMeetingMarkdown(createDemoMeeting('ready'), {
      includeCitations: false,
    })

    expect(markdown).toContain('- Show realtime transcript during recording and AI Notes after stop.')
    expect(markdown).not.toContain('_Sources:')
    expect(markdown).not.toContain('_Source:')
  })

  it('can include original transcript when requested', () => {
    const markdown = formatMeetingMarkdown(createDemoMeeting('ready'), {
      includeTranscript: true,
    })

    expect(markdown).toContain('## Original Transcript')
    expect(markdown).toContain('08:42 Alex: I think the meeting product should stay separate first.')
  })
})
