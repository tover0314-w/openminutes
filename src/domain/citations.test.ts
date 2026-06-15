import { describe, expect, it } from 'vitest'
import {
  findHumanNoteCitations,
  findReviewCitations,
  findTranscriptCitations,
  getHumanNoteSources,
} from './citations'
import { createDemoMeeting } from './meeting'

describe('citation helpers', () => {
  it('extracts human note sources from focus notes', () => {
    const sources = getHumanNoteSources(createDemoMeeting('ready').manualNotes)

    expect(sources.map((source) => source.label)).toEqual([
      'H1',
      'H2',
      'H3',
      'H4',
      'H5',
      'H6',
      'H7',
    ])
    expect(sources[1].text).toContain('Ship macOS-first')
  })

  it('matches AI text back to human note and transcript sources', () => {
    const meeting = createDemoMeeting('ready')
    const human = findHumanNoteCitations(
      meeting.manualNotes,
      'Ship macOS-first as the initial desktop target.',
    )
    const transcript = findTranscriptCitations(
      meeting.transcript,
      'AI Notes should be generated after recording stops.',
    )

    expect(human[0].source.label).toBe('H2')
    expect(transcript[0].line.time).toBe('10:06')
  })

  it('builds mixed review citations for UI chips', () => {
    const meeting = createDemoMeeting('ready')
    const citations = findReviewCitations({
      manualNotes: meeting.manualNotes,
      transcript: meeting.transcript,
      text: 'Review content is AI Notes and the transcript should remain as source.',
      includeHumanFallback: true,
    })

    expect(citations.some((citation) => citation.type === 'human')).toBe(true)
    expect(citations.some((citation) => citation.type === 'transcript')).toBe(true)
  })
})
