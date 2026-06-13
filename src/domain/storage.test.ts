import { describe, expect, it } from 'vitest'
import { createDemoMeeting } from './meeting'
import { JsonMeetingRepository, MemoryStorageAdapter } from './storage'

describe('JsonMeetingRepository', () => {
  it('saves, lists, and updates meetings without mutating the saved copy', () => {
    const storage = new MemoryStorageAdapter()
    const repository = new JsonMeetingRepository(storage)
    const meeting = createDemoMeeting('recording')

    repository.save(meeting)
    meeting.title = 'Changed outside repository'

    expect(repository.list()).toHaveLength(1)
    expect(repository.get('product-sync-alex')?.title).toBe('Product sync with Alex')

    repository.save({ ...createDemoMeeting('ready'), title: 'Updated meeting' })
    expect(repository.list()).toHaveLength(1)
    expect(repository.get('product-sync-alex')?.title).toBe('Updated meeting')
  })

  it('ignores malformed storage and starts empty', () => {
    const storage = new MemoryStorageAdapter()
    storage.setItem('openminutes.meetings.v1', '{not-json')
    const repository = new JsonMeetingRepository(storage)

    expect(repository.list()).toEqual([])
  })
})
