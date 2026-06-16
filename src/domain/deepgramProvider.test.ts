import { describe, expect, it, vi } from 'vitest'
import { createMemoryApiKeyRepository } from './apiKey'
import { DeepgramTranscriptionProvider, parseDeepgramTranscriptionJson } from './deepgramProvider'
import { defaultAppSettings } from './settings'

describe('parseDeepgramTranscriptionJson', () => {
  it('groups diarized Chinese words into speaker transcript lines', () => {
    const transcript = parseDeepgramTranscriptionJson(
      {
        results: {
          channels: [
            {
              alternatives: [
                {
                  transcript:
                    '先确认实时转录不要重复显示。我补充第二个观点，必须录到电脑声音。',
                  words: [
                    word('先', 0.3, 0),
                    word('确认', 0.6, 0),
                    word('实时', 1.0, 0),
                    word('转', 1.4, 0),
                    word('录', 1.7, 0),
                    word('不要', 2.0, 0),
                    word('重复', 2.4, 0),
                    word('显示', 2.8, 0),
                    word('。我', 4.0, 1),
                    word('补充', 4.4, 1),
                    word('第二个', 4.8, 1),
                    word('观点，', 5.2, 1),
                    word('必须', 6.0, 1),
                    word('录到', 6.4, 1),
                    word('电脑', 6.8, 1),
                    word('声音。', 7.2, 1),
                  ],
                },
              ],
            },
          ],
        },
      },
      'meeting-1',
    )

    expect(transcript).toEqual([
      {
        id: 'meeting-1-deepgram-1',
        time: '00:00',
        speaker: 'Speaker 1',
        text: '先确认实时转录不要重复显示。',
      },
      {
        id: 'meeting-1-deepgram-2',
        time: '00:04',
        speaker: 'Speaker 2',
        text: '我补充第二个观点，必须录到电脑声音。',
      },
    ])
  })

  it('falls back to transcript text when word timing is missing', () => {
    expect(
      parseDeepgramTranscriptionJson(
        {
          results: {
            channels: [
              {
                alternatives: [{ transcript: 'Fallback transcript.' }],
              },
            ],
          },
        },
        'meeting-1',
      ),
    ).toEqual([
      {
        id: 'meeting-1-deepgram-1',
        time: '00:00',
        speaker: 'Speaker',
        text: 'Fallback transcript.',
      },
    ])
  })
})

describe('DeepgramTranscriptionProvider', () => {
  it('posts raw audio to Deepgram with diarization enabled', async () => {
    const apiKeys = createMemoryApiKeyRepository()
    await apiKeys.save('deepgram', 'test-key')
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          results: {
            channels: [
              {
                alternatives: [
                  {
                    words: [word('测试', 0, 0), word('完成。', 0.4, 0)],
                  },
                ],
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )
    const provider = new DeepgramTranscriptionProvider(
      { ...defaultAppSettings, transcriptionProvider: 'deepgram', sttModel: 'nova-3' },
      apiKeys,
      fetcher as unknown as typeof fetch,
    )

    const transcript = await provider.transcribe({
      meetingId: 'meeting-1',
      audioUri: 'meeting.wav',
      audioFileName: 'meeting.wav',
      audioFile: new Blob(['audio'], { type: 'audio/wav' }),
    })

    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('https://api.deepgram.com/v1/listen?'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Token test-key',
          'Content-Type': 'audio/wav',
        }),
      }),
    )
    const firstCall = fetcher.mock.calls[0]
    expect(firstCall).toBeDefined()
    const url = new URL(String(firstCall?.[0]))
    expect(url.searchParams.get('model')).toBe('nova-3')
    expect(url.searchParams.get('language')).toBe('zh')
    expect(url.searchParams.get('diarize_model')).toBe('latest')
    expect(transcript[0]?.text).toBe('测试完成。')
  })
})

function word(punctuated_word: string, start: number, speaker: number) {
  return {
    word: punctuated_word.replace(/[。！？.!?，,]/g, ''),
    punctuated_word,
    start,
    end: start + 0.2,
    speaker,
  }
}
