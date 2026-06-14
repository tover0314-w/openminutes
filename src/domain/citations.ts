import { type TranscriptLine } from './meeting'

export interface TranscriptCitation {
  line: TranscriptLine
  score: number
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

const citationStopWords = new Set([
  'about',
  'after',
  'before',
  'during',
  'from',
  'into',
  'notes',
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
