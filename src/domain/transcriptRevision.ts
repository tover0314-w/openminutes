const MIN_REVISION_LENGTH = 3
const MIN_FUZZY_PREFIX_LENGTH = 4
const FUZZY_PREFIX_RATIO = 0.66

export function isTranscriptRevision(previous: string, next: string): boolean {
  const previousText = canonicalTranscriptText(previous)
  const nextText = canonicalTranscriptText(next)
  if (previousText.length < MIN_REVISION_LENGTH || nextText.length < MIN_REVISION_LENGTH) {
    return false
  }

  if (nextText.startsWith(previousText) || previousText.startsWith(nextText)) return true

  const sharedPrefix = commonPrefixLength(previousText, nextText)
  const shorterLength = Math.min(previousText.length, nextText.length)
  return (
    sharedPrefix >= MIN_FUZZY_PREFIX_LENGTH &&
    sharedPrefix / shorterLength >= FUZZY_PREFIX_RATIO
  )
}

export function canonicalTranscriptText(value: string): string {
  return Array.from(value.toLowerCase())
    .map((character) => canonicalCharacter(character))
    .filter((character): character is string => Boolean(character))
    .join('')
}

function canonicalCharacter(character: string): string | undefined {
  if (!/[\p{Letter}\p{Number}]/u.test(character)) return undefined
  return chineseNumberCharacters[character] ?? character
}

const chineseNumberCharacters: Record<string, string> = {
  零: '0',
  〇: '0',
  一: '1',
  二: '2',
  两: '2',
  三: '3',
  四: '4',
  五: '5',
  六: '6',
  七: '7',
  八: '8',
  九: '9',
}

function commonPrefixLength(left: string, right: string): number {
  const limit = Math.min(left.length, right.length)
  for (let index = 0; index < limit; index += 1) {
    if (left[index] !== right[index]) return index
  }
  return limit
}
