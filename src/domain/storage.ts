import { type Meeting } from './meeting'

export const MEETINGS_STORAGE_KEY = 'openminutes.meetings.v1'

export interface StorageAdapter {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface MeetingRepository {
  list(): Meeting[]
  get(id: string): Meeting | undefined
  save(meeting: Meeting): void
  delete(id: string): void
}

interface MeetingEnvelope {
  version: 1
  savedAt: string
  meetings: Meeting[]
}

export class JsonMeetingRepository implements MeetingRepository {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly key = MEETINGS_STORAGE_KEY,
  ) {}

  list(): Meeting[] {
    return this.readEnvelope().meetings
  }

  get(id: string): Meeting | undefined {
    return this.list().find((meeting) => meeting.id === id)
  }

  save(meeting: Meeting): void {
    const envelope = this.readEnvelope()
    const existingIndex = envelope.meetings.findIndex((saved) => saved.id === meeting.id)
    const nextMeeting = cloneMeeting(meeting)

    const nextMeetings =
      existingIndex >= 0
        ? envelope.meetings.map((saved, index) => (index === existingIndex ? nextMeeting : saved))
        : [nextMeeting, ...envelope.meetings]

    this.writeEnvelope({
      version: 1,
      savedAt: new Date().toISOString(),
      meetings: nextMeetings,
    })
  }

  delete(id: string): void {
    const envelope = this.readEnvelope()
    this.writeEnvelope({
      version: 1,
      savedAt: new Date().toISOString(),
      meetings: envelope.meetings.filter((meeting) => meeting.id !== id),
    })
  }

  private readEnvelope(): MeetingEnvelope {
    const emptyEnvelope: MeetingEnvelope = { version: 1, savedAt: '', meetings: [] }
    const rawValue = this.storage.getItem(this.key)

    if (!rawValue) return emptyEnvelope

    try {
      const parsed = JSON.parse(rawValue) as Partial<MeetingEnvelope>

      if (parsed.version !== 1 || !Array.isArray(parsed.meetings)) {
        return emptyEnvelope
      }

      return {
        version: 1,
        savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
        meetings: parsed.meetings.map(cloneMeeting),
      }
    } catch {
      return emptyEnvelope
    }
  }

  private writeEnvelope(envelope: MeetingEnvelope): void {
    this.storage.setItem(this.key, JSON.stringify(envelope))
  }
}

export class MemoryStorageAdapter implements StorageAdapter {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

export function createDefaultMeetingRepository(): MeetingRepository {
  const storage = getBrowserStorage()
  return new JsonMeetingRepository(storage ?? new MemoryStorageAdapter())
}

function getBrowserStorage(): StorageAdapter | undefined {
  if (typeof globalThis === 'undefined') return undefined
  const maybeStorage = (globalThis as { localStorage?: StorageAdapter }).localStorage
  return maybeStorage ?? undefined
}

function cloneMeeting(meeting: Meeting): Meeting {
  return JSON.parse(JSON.stringify(meeting)) as Meeting
}
