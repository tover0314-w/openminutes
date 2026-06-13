import {
  type AiNotes,
  type Meeting,
  type TranscriptLine,
  buildAiNotesContext,
} from './meeting'

export interface AudioTranscriptionInput {
  meetingId: string
  audioUri: string
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
    return [
      {
        id: `${input.meetingId}-mock-1`,
        time: '00:04',
        speaker: 'Speaker',
        text: 'This is a mock transcript line for local development.',
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
      summary: `Generated from ${input.meeting.transcript.length} transcript lines and ${input.meeting.markers.length} markers.`,
      decisions,
      actionItems,
      openQuestions,
      keyPoints: [input.context.split('\n').find(Boolean) ?? input.meeting.title],
      followUpDraft: `Follow up on ${input.meeting.title}.`,
    }
  }
}

export function createDefaultProviderRegistry(): ProviderRegistry {
  return {
    transcription: [new MockTranscriptionProvider()],
    aiNotes: [new MockAiNotesProvider()],
  }
}
