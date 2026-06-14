import { describe, expect, it, vi } from 'vitest'
import { createDemoMeeting } from '../domain/meeting'
import { TauriMeetingRepository } from './meetingRepository'
import { type TauriInvoke } from './tauri'

describe('TauriMeetingRepository', () => {
  it('delegates meeting operations to Tauri commands', async () => {
    const meeting = createDemoMeeting('ready')
    const invoke = vi.fn(async (command: string) => {
      if (command === 'load_meetings') return [meeting]
      return undefined
    }) as TauriInvoke

    const repository = new TauriMeetingRepository(invoke)

    await expect(repository.list()).resolves.toEqual([meeting])
    await expect(repository.get(meeting.id)).resolves.toEqual(meeting)
    await repository.save(meeting)
    await repository.delete(meeting.id)

    expect(invoke).toHaveBeenCalledWith('load_meetings')
    expect(invoke).toHaveBeenCalledWith('save_meeting', { meeting })
    expect(invoke).toHaveBeenCalledWith('delete_meeting', { id: meeting.id })
  })
})
