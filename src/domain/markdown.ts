import { type ActionItem, type Meeting, type TranscriptLine } from './meeting'

export interface MeetingMarkdownOptions {
  includeTranscript?: boolean
}

export function formatMeetingMarkdown(
  meeting: Meeting,
  options: MeetingMarkdownOptions = {},
): string {
  const lines = [
    `# ${meeting.title}`,
    '',
    `- Template: ${meeting.template}`,
    `- Started: ${meeting.startedAt}`,
    `- Duration: ${meeting.duration}`,
    `- Participants: ${meeting.participants.join(', ') || 'Unknown'}`,
    '',
  ]

  if (!meeting.aiNotes) {
    lines.push('## Manual Notes', '', meeting.manualNotes.trim() || '_No manual notes._', '')
    return lines.join('\n').trimEnd()
  }

  lines.push(
    '## Summary',
    '',
    meeting.aiNotes.summary,
    '',
    '## Decisions',
    '',
    ...formatList(meeting.aiNotes.decisions),
    '',
    '## Action Items',
    '',
    ...formatActionItems(meeting.aiNotes.actionItems),
    '',
    '## Open Questions',
    '',
    ...formatList(meeting.aiNotes.openQuestions),
    '',
    '## Key Points',
    '',
    ...formatList(meeting.aiNotes.keyPoints),
    '',
    '## Follow-up Draft',
    '',
    meeting.aiNotes.followUpDraft,
    '',
  )

  if (options.includeTranscript) {
    lines.push('## Original Transcript', '', ...formatTranscript(meeting.transcript), '')
  }

  return lines.join('\n').trimEnd()
}

function formatList(items: string[]): string[] {
  if (items.length === 0) return ['_None._']
  return items.map((item) => `- ${item}`)
}

function formatActionItems(items: ActionItem[]): string[] {
  if (items.length === 0) return ['_None._']

  return items.map((item) => {
    const owner = item.owner ? ` (${item.owner})` : ''
    const due = item.due ? ` - due ${item.due}` : ''
    return `- [ ] ${item.text}${owner}${due}`
  })
}

function formatTranscript(transcript: TranscriptLine[]): string[] {
  if (transcript.length === 0) return ['_No transcript._']

  return transcript.map((line) => `- ${line.time} ${line.speaker}: ${line.text}`)
}
