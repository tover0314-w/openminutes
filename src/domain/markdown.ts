import { type ActionItem, type AiNotes, type Meeting, type TranscriptLine } from './meeting'
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

  const reviewDocument = meeting.aiNotes.document?.trim() || formatAiNotesDocument(meeting.aiNotes)
  lines.push(...formatReviewDocumentWithCitations(reviewDocument, meeting, includeCitations), '')

  if (options.includeTranscript) {
    lines.push('## Original Transcript', '', ...formatTranscript(meeting.transcript), '')
  }

  return lines.join('\n').trimEnd()
}

export function formatAiNotesDocument(notes: AiNotes): string {
  if (notes.document?.trim()) return notes.document.trim()

  const useChinese = containsCjk([
    notes.summary,
    ...notes.decisions,
    ...notes.actionItems.map((item) => item.text),
    ...notes.openQuestions,
    ...notes.keyPoints,
    notes.followUpDraft,
  ].join('\n'))
  const headings = useChinese
    ? {
        main: '## 这次真正重要的事',
        details: '## 值得保留的细节',
        next: '## 接下来',
        followUp: '## 可以发送的跟进',
        none: '暂时没有足够内容。',
      }
    : {
        main: '## What Mattered',
        details: '## Worth Keeping',
        next: '## Next',
        followUp: '## Follow-up Note',
        none: 'Nothing concrete yet.',
      }
  const detailItems = [...notes.keyPoints, ...notes.decisions, ...notes.openQuestions]
    .map((item) => item.trim())
    .filter(Boolean)

  const lines = [
    headings.main,
    '',
    notes.summary.trim() || headings.none,
    '',
    headings.details,
    '',
    ...formatStringListForDocument(detailItems, headings.none),
    '',
    headings.next,
    '',
    ...formatActionItemsForDocument(notes.actionItems, headings.none),
    '',
    headings.followUp,
    '',
    notes.followUpDraft.trim() || headings.none,
  ]

  return lines.join('\n').trim()
}

function formatStringListForDocument(items: string[], emptyText = 'None yet.'): string[] {
  const visibleItems = items.map((item) => item.trim()).filter(Boolean)
  if (visibleItems.length === 0) return [emptyText]
  return visibleItems.map((item) => `- ${item}`)
}

function formatActionItemsForDocument(items: ActionItem[], emptyText = 'None yet.'): string[] {
  const visibleItems = items.filter((item) => item.text.trim())
  if (visibleItems.length === 0) return [emptyText]

  return visibleItems.map((item) => {
    const owner = item.owner ? ` (${item.owner})` : ''
    const due = item.due ? ` - due ${item.due}` : ''
    return `- [ ] ${item.text}${owner}${due}`
  })
}

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value)
}

function formatReviewDocumentWithCitations(
  documentText: string,
  meeting: Meeting,
  includeCitations: boolean,
): string[] {
  return documentText.split('\n').flatMap((line) => {
    const sourceText = citationTextForDocumentLine(line)
    if (!sourceText) return [line]

    return [line, ...formatNestedCitationBlock(findCitations(meeting, sourceText, includeCitations))]
  })
}

function citationTextForDocumentLine(line: string): string {
  const text = line
    .trim()
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*•]\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/\*\*/g, '')
    .trim()
  if (!text || /^#{1,6}\s+/.test(line.trim())) return ''
  return text.length >= 18 ? text : ''
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
