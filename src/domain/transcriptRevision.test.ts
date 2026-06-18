import { describe, expect, it } from 'vitest'
import { canonicalTranscriptText, isTranscriptRevision } from './transcriptRevision'

describe('transcript revision detection', () => {
  it('treats strict realtime prefixes as revisions', () => {
    expect(isTranscriptRevision('我已经', '我已经把它打开了')).toBe(true)
    expect(isTranscriptRevision('hello there', 'hello')).toBe(true)
  })

  it('treats close Chinese ASR corrections as the same realtime line', () => {
    expect(isTranscriptRevision('先确认实时转录不要重复行', '先确认实时转录不要重复显示。')).toBe(true)
    expect(isTranscriptRevision('我补充第二个观点用户带', '我补充第二个观点用户戴耳机的时候')).toBe(true)
    expect(isTranscriptRevision('我补充第二个观点用户戴耳机的时候', '我补充第2个观点用户戴耳机的')).toBe(true)
  })

  it('keeps unrelated sentences separate', () => {
    expect(isTranscriptRevision('我已经把它打开了', '但是新的句子')).toBe(false)
    expect(isTranscriptRevision('必须录到电脑声音', '我们先确认实时转录')).toBe(false)
  })

  it('canonicalizes punctuation and spacing before comparing', () => {
    expect(canonicalTranscriptText('来，有请第二位人士说话。可是我现在')).toBe(
      '来有请第2位人士说话可是我现在',
    )
  })
})
