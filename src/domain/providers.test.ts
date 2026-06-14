import { describe, expect, it } from 'vitest'
import { createDemoMeeting } from './meeting'
import {
  MockAiNotesProvider,
  MockTranscriptionProvider,
  generateAiNotesForMeeting,
} from './providers'

describe('provider abstractions', () => {
  it('generates AI Notes through a provider boundary', async () => {
    const provider = new MockAiNotesProvider()
    const meeting = createDemoMeeting('recording')

    const nextMeeting = await generateAiNotesForMeeting(provider, meeting)

    expect(nextMeeting.phase).toBe('ready')
    expect(nextMeeting.aiNotes?.decisions).toContain(
      'Ship macOS-first and keep a future OpenTypeless merge path.',
    )
    expect(nextMeeting.aiNotes?.actionItems[0]?.text).toBe('Prototype Focus and Review modes.')
  })

  it('transcribes through a provider boundary', async () => {
    const provider = new MockTranscriptionProvider()
    const transcript = await provider.transcribe({
      meetingId: 'meeting-1',
      audioUri: 'file:///tmp/mock.wav',
    })

    expect(transcript[0]).toMatchObject({
      id: 'meeting-1-mock-1',
      speaker: 'Alex',
      text: 'This is a local demo transcript generated for mock.',
    })
    expect(transcript).toHaveLength(4)
  })
})
