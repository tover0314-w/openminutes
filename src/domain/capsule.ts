import type { Meeting, MeetingPhase } from './meeting'

export const CAPSULE_STATE_EVENT = 'openminutes:capsule-state'
export const CAPSULE_COMMAND_EVENT = 'openminutes:capsule-command'
export const CAPSULE_STATE_STORAGE_KEY = 'openminutes.capsule.state.v1'
export const CAPSULE_COMMAND_STORAGE_KEY = 'openminutes.capsule.command.v1'

export type CapsuleCommand = 'start' | 'stop' | 'hide'
export type CapsuleVisualState = 'idle' | 'recording' | 'processing' | 'done' | 'error'

export interface CapsuleStatePayload {
  meetingId: string
  title: string
  duration: string
  phase: MeetingPhase
  visible: boolean
  updatedAt: number
}

export interface CapsuleCommandPayload {
  id: string
  command: CapsuleCommand
  createdAt: number
}

export interface CapsuleSize {
  width: number
  height: number
}

export function createCapsuleStatePayload(
  meeting: Pick<Meeting, 'id' | 'title' | 'duration' | 'phase'>,
  updatedAt = Date.now(),
  visible = true,
): CapsuleStatePayload {
  return {
    meetingId: meeting.id,
    title: meeting.title,
    duration: meeting.duration,
    phase: meeting.phase,
    visible,
    updatedAt,
  }
}

export function getCapsuleVisualState(
  phase: MeetingPhase,
  showDone = false,
): CapsuleVisualState {
  if (phase === 'recording') return 'recording'
  if (phase === 'finalizing_transcript' || phase === 'generating_ai_notes') return 'processing'
  if (phase === 'error') return 'error'
  if ((phase === 'ready' || phase === 'needs_review') && showDone) return 'done'
  return 'idle'
}

export function getCapsuleContentSize(state: CapsuleVisualState): CapsuleSize {
  switch (state) {
    case 'recording':
      return { width: 200, height: 36 }
    case 'processing':
      return { width: 220, height: 36 }
    case 'done':
      return { width: 120, height: 36 }
    case 'error':
      return { width: 200, height: 36 }
    case 'idle':
    default:
      return { width: 36, height: 36 }
  }
}

export function getCapsuleWindowSize(state: CapsuleVisualState): CapsuleSize {
  const contentSize = getCapsuleContentSize(state)
  return {
    width: contentSize.width + 24,
    height: contentSize.height + 24,
  }
}

export function getCapsuleFocusable(): boolean {
  return false
}

export function shouldShowCapsuleWindow(
  _state: CapsuleVisualState,
  visible = true,
): boolean {
  return visible
}

export function createCapsuleCommandPayload(command: CapsuleCommand): CapsuleCommandPayload {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    command,
    createdAt: Date.now(),
  }
}

export function parseCapsuleStatePayload(raw: string | null): CapsuleStatePayload | undefined {
  if (!raw) return undefined

  try {
    const parsed = JSON.parse(raw) as Partial<CapsuleStatePayload>
    if (
      typeof parsed.meetingId !== 'string' ||
      typeof parsed.title !== 'string' ||
      typeof parsed.duration !== 'string' ||
      typeof parsed.phase !== 'string' ||
      typeof parsed.updatedAt !== 'number'
    ) {
      return undefined
    }

    return {
      meetingId: parsed.meetingId,
      title: parsed.title,
      duration: parsed.duration,
      phase: parsed.phase as MeetingPhase,
      visible: typeof parsed.visible === 'boolean' ? parsed.visible : true,
      updatedAt: parsed.updatedAt,
    }
  } catch {
    return undefined
  }
}

export function parseCapsuleCommandPayload(raw: string | null): CapsuleCommandPayload | undefined {
  if (!raw) return undefined

  try {
    const parsed = JSON.parse(raw) as Partial<CapsuleCommandPayload>
    if (
      typeof parsed.id !== 'string' ||
      (parsed.command !== 'start' && parsed.command !== 'stop' && parsed.command !== 'hide') ||
      typeof parsed.createdAt !== 'number'
    ) {
      return undefined
    }

    return parsed as CapsuleCommandPayload
  } catch {
    return undefined
  }
}
