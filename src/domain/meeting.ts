export type MeetingPhase =
  | 'draft'
  | 'recording'
  | 'finalizing_transcript'
  | 'generating_ai_notes'
  | 'ready'
  | 'needs_review'
  | 'error'

export type MeetingMode = 'focus' | 'review'
export type MainPaneKind = 'manual_notes' | 'ai_notes' | 'ai_generation'
export type RightPaneKind = 'live_transcript' | 'source_transcript'
export type MarkerKind = 'Decision' | 'Action' | 'Question' | 'Quote'

export interface TranscriptLine {
  id: string
  time: string
  speaker: string
  text: string
  partial?: boolean
}

export interface Marker {
  id: string
  kind: MarkerKind
  time: string
  text: string
}

export interface ActionItem {
  id: string
  text: string
  owner?: string
  due?: string
}

export interface AiNotes {
  summary: string
  decisions: string[]
  actionItems: ActionItem[]
  openQuestions: string[]
  keyPoints: string[]
  followUpDraft: string
}

export interface Meeting {
  id: string
  title: string
  template: string
  participants: string[]
  startedAt: string
  duration: string
  phase: MeetingPhase
  manualNotes: string
  markers: Marker[]
  transcript: TranscriptLine[]
  aiNotes?: AiNotes
}

export interface MeetingViewModel {
  mode: MeetingMode
  mainPane: MainPaneKind
  rightPane: RightPaneKind
  canRecord: boolean
  canStop: boolean
  canGenerateAiNotes: boolean
  canExport: boolean
}

export function getMeetingMode(phase: MeetingPhase): MeetingMode {
  if (phase === 'recording' || phase === 'draft') return 'focus'
  return 'review'
}

export function getMeetingViewModel(meeting: Meeting): MeetingViewModel {
  const mode = getMeetingMode(meeting.phase)
  const hasFinalTranscript = meeting.transcript.length > 0 && meeting.phase !== 'recording'
  const hasAiNotes = Boolean(meeting.aiNotes)

  if (mode === 'focus') {
    return {
      mode,
      mainPane: 'manual_notes',
      rightPane: 'live_transcript',
      canRecord: meeting.phase === 'draft',
      canStop: meeting.phase === 'recording',
      canGenerateAiNotes: false,
      canExport: false,
    }
  }

  return {
    mode,
    mainPane: hasAiNotes ? 'ai_notes' : 'ai_generation',
    rightPane: 'source_transcript',
    canRecord: false,
    canStop: false,
    canGenerateAiNotes: hasFinalTranscript,
    canExport: hasAiNotes,
  }
}

export function buildAiNotesContext(meeting: Meeting): string {
  const markerContext = meeting.markers
    .map((marker) => `[${marker.kind} ${marker.time}] ${marker.text}`)
    .join('\n')
  const transcriptContext = meeting.transcript
    .map((line) => `${line.time} ${line.speaker}: ${line.text}`)
    .join('\n')

  return [
    `Meeting: ${meeting.title}`,
    `Template: ${meeting.template}`,
    `Participants: ${meeting.participants.join(', ') || 'Unknown'}`,
    '',
    'Manual notes:',
    meeting.manualNotes.trim() || '(none)',
    '',
    'Markers:',
    markerContext || '(none)',
    '',
    'Transcript:',
    transcriptContext || '(none)',
  ].join('\n')
}

export function createDemoMeeting(phase: MeetingPhase = 'recording'): Meeting {
  const aiNotes: AiNotes = {
    summary:
      'OpenMinutes should ship as a desktop-first meeting product that uses OpenTypeless design tokens while clearly separating capture, transcript, and AI Notes.',
    decisions: [
      'Keep Settings as a two-column desktop preference view.',
      'Use one Meeting sidebar item with Focus and Review modes.',
      'Show realtime transcript during recording and AI Notes after stop.',
    ],
    actionItems: [
      {
        id: 'a1',
        text: 'Implement the token-compatible desktop meeting shell.',
        owner: 'Tov',
      },
      {
        id: 'a2',
        text: 'Validate transcript-to-AI-notes flow with sample data.',
        owner: 'Alex',
      },
    ],
    openQuestions: ['Should AI Notes generate automatically after stop or wait for a click?'],
    keyPoints: [
      'Manual notes and markers should influence AI Notes more strongly than raw transcript text.',
      'Original transcript remains visible as source material in Review.',
    ],
    followUpDraft:
      'Alex, we agreed that Review should be the AI Notes workspace, with the original transcript available on the right as source context.',
  }

  return {
    id: 'product-sync-alex',
    title: 'Product sync with Alex',
    template: 'Product sync',
    participants: ['Alex', 'Tov'],
    startedAt: '2026-06-14T10:30:00+08:00',
    duration: phase === 'recording' ? '12:48' : '32:16',
    phase,
    manualNotes:
      'Goal: decide whether meeting mode should ship as a separate product first.\n\n[Decision] Ship macOS-first.\n[Action] Prototype desktop token-compatible UI.\n[Question] Should transcript stay as the right-side source in Review?\n\nNotes:\n- design tokens should match OpenTypeless\n- Review content is AI Notes\n- right side is original transcript/source',
    markers: [
      {
        id: 'm1',
        kind: 'Decision',
        time: '04:18',
        text: 'Ship macOS-first and keep a future OpenTypeless merge path.',
      },
      {
        id: 'm2',
        kind: 'Action',
        time: '09:12',
        text: 'Prototype Focus and Review modes.',
      },
      {
        id: 'm3',
        kind: 'Question',
        time: '12:04',
        text: 'Decide whether AI Notes auto-generate after stop.',
      },
    ],
    transcript: [
      {
        id: 't1',
        time: '08:42',
        speaker: 'Alex',
        text: 'I think the meeting product should stay separate first.',
      },
      {
        id: 't2',
        time: '09:18',
        speaker: 'Tov',
        text: 'The visual system should use OpenTypeless tokens.',
      },
      {
        id: 't3',
        time: '10:06',
        speaker: 'Alex',
        text: 'During recording, show transcript. AI Notes come after stop.',
      },
      {
        id: 't4',
        time: '12:04',
        speaker: 'Tov',
        text: 'In Review, the AI-generated notes should be the main content and transcript should remain as source.',
      },
    ],
    aiNotes: phase === 'ready' || phase === 'needs_review' ? aiNotes : undefined,
  }
}
