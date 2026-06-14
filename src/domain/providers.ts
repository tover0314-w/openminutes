import {
  type AiNotes,
  type Meeting,
  type TranscriptLine,
  buildAiNotesContext,
} from './meeting'

export interface AudioTranscriptionInput {
  meetingId: string
  audioUri: string
  audioFile?: Blob
  audioFileName?: string
  startedAt?: string
}

export interface TranscriptionProvider {
  id: string
  label: string
  transcribe(input: AudioTranscriptionInput): Promise<TranscriptLine[]>
}

export interface AiNotesGenerationInput {
  meeting: Meeting
  context: string
}

export interface AiNotesProvider {
  id: string
  label: string
  generateNotes(input: AiNotesGenerationInput): Promise<AiNotes>
}

export interface ProviderRegistry {
  transcription: TranscriptionProvider[]
  aiNotes: AiNotesProvider[]
}

export async function generateAiNotesForMeeting(
  provider: AiNotesProvider,
  meeting: Meeting,
): Promise<Meeting> {
  const aiNotes = await provider.generateNotes({
    meeting,
    context: buildAiNotesContext(meeting),
  })

  return {
    ...meeting,
    phase: 'ready',
    aiNotes,
  }
}

export class MockTranscriptionProvider implements TranscriptionProvider {
  readonly id = 'mock-transcription'
  readonly label = 'Mock Transcription'

  async transcribe(input: AudioTranscriptionInput): Promise<TranscriptLine[]> {
    const title = audioTitle(input.audioFileName ?? input.audioUri)

    return [
      {
        id: `${input.meetingId}-mock-1`,
        time: '00:04',
        speaker: 'Alex',
        text: `This is a local demo transcript generated for ${title}.`,
      },
      {
        id: `${input.meetingId}-mock-2`,
        time: '00:28',
        speaker: 'Tov',
        text: 'It lets us validate the import, transcript review, and AI Notes flow without a provider key.',
      },
      {
        id: `${input.meetingId}-mock-3`,
        time: '00:54',
        speaker: 'Alex',
        text: 'Before using the notes externally, replace demo transcription with a real STT provider.',
      },
      {
        id: `${input.meetingId}-mock-4`,
        time: '01:18',
        speaker: 'Tov',
        text: 'The important product behavior is that imported audio lands in Review with editable source text.',
      },
    ]
  }
}

export class MockAiNotesProvider implements AiNotesProvider {
  readonly id = 'mock-ai-notes'
  readonly label = 'Mock AI Notes'

  async generateNotes(input: AiNotesGenerationInput): Promise<AiNotes> {
    const decisions = input.meeting.markers
      .filter((marker) => marker.kind === 'Decision')
      .map((marker) => marker.text)
    const actionItems = input.meeting.markers
      .filter((marker) => marker.kind === 'Action')
      .map((marker, index) => ({
        id: `mock-action-${index + 1}`,
        text: marker.text,
      }))
    const openQuestions = input.meeting.markers
      .filter((marker) => marker.kind === 'Question')
      .map((marker) => marker.text)

    return {
      summary: `Local demo notes for ${input.meeting.title}. Review the imported transcript, edit the source text, then switch to a real provider for production-quality notes.`,
      decisions: decisions.length ? decisions : ['Use local demo mode only for product walkthroughs and offline testing.'],
      actionItems: actionItems.length
        ? actionItems
        : [
            {
              id: 'mock-action-1',
              text: 'Replace demo transcription with provider STT before sharing externally.',
              owner: input.meeting.participants[0] ?? 'Owner',
            },
          ],
      openQuestions: openQuestions.length
        ? openQuestions
        : ['Which real STT and AI Notes providers should this workspace use?'],
      keyPoints: [
        `${input.meeting.transcript.length} transcript lines are available as editable source text.`,
        input.context.split('\n').find(Boolean) ?? input.meeting.title,
      ],
      followUpDraft: `Follow up on ${input.meeting.title}: the local demo flow is working, and the next step is to configure real provider keys for production use.`,
    }
  }
}

export function createDefaultProviderRegistry(): ProviderRegistry {
  return {
    transcription: [new MockTranscriptionProvider()],
    aiNotes: [new MockAiNotesProvider()],
  }
}

function audioTitle(value: string): string {
  const fileName = value.split(/[\\/]/).pop() ?? value
  const withoutExtension = fileName.replace(/\.[^/.]+$/, '').trim()
  return withoutExtension || 'imported audio'
}
