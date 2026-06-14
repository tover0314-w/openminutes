import { type ActionItem, type Meeting, type TranscriptLine } from './meeting'
import { findTranscriptCitations, type TranscriptCitation } from './citations'

export interface MeetingMarkdownOptions {
  includeCitations?: boolean
  includeTranscript?: boolean
}

export function formatMeetingMarkdown(
  meeting: Meeting,
  options: MeetingMarkdownOptions = {},
): string {
  const includeCitations = options.includeCitations ?? true
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
    ...formatCitationBlock(findCitations(meeting, meeting.aiNotes.summary, includeCitations)),
    '',
    '## Decisions',
    '',
    ...formatList(meeting.aiNotes.decisions, meeting, includeCitations),
    '',
    '## Action Items',
    '',
    ...formatActionItems(meeting.aiNotes.actionItems, meeting, includeCitations),
    '',
    '## Open Questions',
    '',
    ...formatList(meeting.aiNotes.openQuestions, meeting, includeCitations),
    '',
    '## Key Points',
    '',
    ...formatList(meeting.aiNotes.keyPoints, meeting, includeCitations),
    '',
    '## Follow-up Draft',
    '',
    meeting.aiNotes.followUpDraft,
    ...formatCitationBlock(findCitations(meeting, meeting.aiNotes.followUpDraft, includeCitations)),
    '',
  )

  if (options.includeTranscript) {
    lines.push('## Original Transcript', '', ...formatTranscript(meeting.transcript), '')
  }

  return lines.join('\n').trimEnd()
}

function formatList(items: string[], meeting: Meeting, includeCitations: boolean): string[] {
  if (items.length === 0) return ['_None._']

  return items.flatMap((item) => [
    `- ${item}`,
    ...formatNestedCitationBlock(findCitations(meeting, item, includeCitations)),
  ])
}

function formatActionItems(
  items: ActionItem[],
  meeting: Meeting,
  includeCitations: boolean,
): string[] {
  if (items.length === 0) return ['_None._']

  return items.flatMap((item) => {
    const owner = item.owner ? ` (${item.owner})` : ''
    const due = item.due ? ` - due ${item.due}` : ''
    return [
      `- [ ] ${item.text}${owner}${due}`,
      ...formatNestedCitationBlock(findCitations(meeting, item.text, includeCitations)),
    ]
  })
}

function formatTranscript(transcript: TranscriptLine[]): string[] {
  if (transcript.length === 0) return ['_No transcript._']

  return transcript.map((line) => `- ${line.time} ${line.speaker}: ${line.text}`)
}

function findCitations(
  meeting: Meeting,
  text: string,
  includeCitations: boolean,
): TranscriptCitation[] {
  if (!includeCitations) return []
  return findTranscriptCitations(meeting.transcript, text)
}

function formatCitationBlock(citations: TranscriptCitation[]): string[] {
  const citationText = formatCitations(citations)
  return citationText ? ['', citationText] : []
}

function formatNestedCitationBlock(citations: TranscriptCitation[]): string[] {
  const citationText = formatCitations(citations)
  return citationText ? [`  ${citationText}`] : []
}

function formatCitations(citations: TranscriptCitation[]): string {
  if (citations.length === 0) return ''

  const label = citations.length === 1 ? 'Source' : 'Sources'
  const sources = citations
    .map(({ line }) => `${line.time} ${line.speaker} - ${line.text}`)
    .join('; ')

  return `_${label}: ${sources}_`
}
