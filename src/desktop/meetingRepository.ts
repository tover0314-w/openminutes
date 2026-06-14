import { type Meeting } from '../domain/meeting'
import { type AsyncMeetingRepository } from '../domain/storage'
import { getTauriInvoke, type TauriInvoke } from './tauri'

export class TauriMeetingRepository implements AsyncMeetingRepository {
  constructor(private readonly invoke: TauriInvoke) {}

  list(): Promise<Meeting[]> {
    return this.invoke<Meeting[]>('load_meetings')
  }

  async get(id: string): Promise<Meeting | undefined> {
    const meetings = await this.list()
    return meetings.find((meeting) => meeting.id === id)
  }

  save(meeting: Meeting): Promise<void> {
    return this.invoke<void>('save_meeting', { meeting })
  }

  delete(id: string): Promise<void> {
    return this.invoke<void>('delete_meeting', { id })
  }
}

export async function createTauriMeetingRepository(): Promise<AsyncMeetingRepository | undefined> {
  const invoke = await getTauriInvoke()
  return invoke ? new TauriMeetingRepository(invoke) : undefined
}
