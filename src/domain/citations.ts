import { type TranscriptLine } from './meeting'

export interface TranscriptCitation {
  line: TranscriptLine
  score: number
}

export interface HumanNoteSource {
  id: string
  label: string
  text: string
  index: number
}

export interface HumanNoteCitation {
  source: HumanNoteSource
  score: number
}

export type ReviewCitation =
  | {
      type: 'human'
      id: string
      label: string
      source: HumanNoteSource
    }
  | {
      type: 'transcript'
      id: string
      label: string
      line: TranscriptLine
    }

export function findTranscriptCitations(
  transcript: TranscriptLine[],
  text: string,
  limit = 2,
): TranscriptCitation[] {
  const textTokens = keywordTokens(text)
  if (!textTokens.size) return []

  return transcript
    .map((line) => {
      const lineTokens = keywordTokens(`${line.speaker} ${line.text}`)
      const overlap = Array.from(textTokens).filter((token) => lineTokens.has(token)).length
      const score = overlap / Math.max(textTokens.size, 1)
      return { line, score }
    })
    .filter((citation) => citation.score >= 0.16)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
}

export function getHumanNoteSources(manualNotes: string): HumanNoteSource[] {
  return manualNotes
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => isHumanNoteSourceLine(line))
    .map((line, index) => ({
      id: `human-note-${index + 1}`,
      label: `H${index + 1}`,
      text: normalizeHumanNoteLine(line),
      index,
    }))
}

export function findHumanNoteCitations(
  manualNotes: string,
  text: string,
  limit = 1,
): HumanNoteCitation[] {
  const textTokens = keywordTokens(text)
  if (!textTokens.size) return []

  return getHumanNoteSources(manualNotes)
    .map((source) => {
      const sourceTokens = keywordTokens(source.text)
      const overlap = Array.from(textTokens).filter((token) => sourceTokens.has(token)).length
      const score = overlap / Math.max(Math.min(textTokens.size, sourceTokens.size), 1)
      return { source, score }
    })
    .filter((citation) => citation.score >= 0.2)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
}

export function findReviewCitations({
  manualNotes,
  transcript,
  text,
  includeHumanFallback = false,
}: {
  manualNotes: string
  transcript: TranscriptLine[]
  text: string
  includeHumanFallback?: boolean
}): ReviewCitation[] {
  const humanSources = getHumanNoteSources(manualNotes)
  const humanCitations = findHumanNoteCitations(manualNotes, text, 1)
  const transcriptCitations = findTranscriptCitations(transcript, text, 2)
  const citations: ReviewCitation[] = [
    ...humanCitations.map(({ source }) => ({
      type: 'human' as const,
      id: source.id,
      label: source.label,
      source,
    })),
    ...transcriptCitations.map(({ line }) => ({
      type: 'transcript' as const,
      id: line.id,
      label: `T ${line.time}`,
      line,
    })),
  ]

  if (includeHumanFallback && humanSources.length && !citations.some((item) => item.type === 'human')) {
    const source = humanSources[0]
    citations.unshift({
      type: 'human',
      id: source.id,
      label: source.label,
      source,
    })
  }

  return dedupeReviewCitations(citations).slice(0, 3)
}

function isHumanNoteSourceLine(line: string): boolean {
  if (!line) return false
  if (/^notes?:?$/i.test(line)) return false
  return (
    /^\[[^\]]+\]/.test(line) ||
    /^[-*]\s+/.test(line) ||
    /^goal:/i.test(line) ||
    line.length >= 24
  )
}

function normalizeHumanNoteLine(line: string): string {
  return line.replace(/^[-*]\s+/, '').trim()
}

function dedupeReviewCitations(citations: ReviewCitation[]): ReviewCitation[] {
  const seen = new Set<string>()
  return citations.filter((citation) => {
    const key = `${citation.type}:${citation.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const citationStopWords = new Set([
  'about',
  'after',
  'before',
  'during',
  'from',
  'into',
  'should',
  'that',
  'their',
  'there',
  'this',
  'with',
])

function keywordTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 3 && !citationStopWords.has(token)),
  )
}
