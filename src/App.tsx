import { type ChangeEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  CircleUser,
  FileText,
  Home,
  Mic,
  Settings,
  Sparkles,
} from 'lucide-react'
import {
  type AiNotes,
  type Meeting,
  type MeetingPhase,
  type TranscriptLine,
  buildAiNotesContext,
  createDraftMeeting,
  getMeetingViewModel,
} from './domain/meeting'
import { type ApiKeyRepository, createMemoryApiKeyRepository } from './domain/apiKey'
import { createTauriApiKeyRepository } from './desktop/apiKeyRepository'
import {
  createTauriAudioCaptureSession,
  type AudioCaptureStartOptions,
} from './desktop/audioCapture'
import { selectTauriAudioFile } from './desktop/audioImport'
import { exportMarkdownFile } from './desktop/markdownExport'
import { createTauriMeetingRepository } from './desktop/meetingRepository'
import {
  testProviderConnection,
  type ProviderConnectionTestResult,
} from './desktop/providerConnection'
import { listenRealtimeTranscript } from './desktop/realtimeTranscript'
import { createTauriAppSettingsRepository } from './desktop/settingsRepository'
import { isTauriRuntime } from './desktop/tauri'
import { listenCapsuleCommand, publishCapsuleState } from './desktop/capsuleBridge'
import {
  findReviewCitations,
  getHumanNoteSources,
  type ReviewCitation,
} from './domain/citations'
import { createCapsuleStatePayload } from './domain/capsule'
import { formatAiNotesDocument, formatMeetingMarkdown } from './domain/markdown'
import {
  createAiNotesProvider,
  createTranscriptionProvider,
  isProviderConfigurationError,
} from './domain/providerFactory'
import { generateAiNotesForMeeting } from './domain/providers'
import {
  type ApiProviderId,
  type AppSettings,
  type AppSettingsRepository,
  type BatchTranscriptionProviderId,
  createBrowserAppSettingsRepository,
  loadBrowserAppSettings,
  type RealtimeTranscriptionProviderId,
} from './domain/settings'
import { type AsyncMeetingRepository, createDefaultMeetingRepository } from './domain/storage'

type Route = 'today' | 'meeting' | 'library' | 'settings'
type SettingsPane = 'general' | 'transcription' | 'aiNotes' | 'exports' | 'about'
type AiGenerationStatus = 'idle' | 'generating' | 'configuration_error' | 'error'
type TranscriptionStatus = 'idle' | 'importing' | 'configuration_error' | 'error'
type ApiKeyStatus = 'idle' | 'saving' | 'saved' | 'deleted' | 'error'
type ApiConnectionStatus = 'idle' | 'testing' | 'success' | 'error'
type ApiKeyConfiguredMap = Partial<Record<ApiProviderId, boolean>>

interface AudioImportRequest {
  meetingId: string
  title: string
  file: File
  baseMeeting?: Meeting
}

const navItems = [
  { id: 'today' as const, label: 'Today', icon: Home },
  { id: 'meeting' as const, label: 'Meeting', icon: Mic },
  { id: 'library' as const, label: 'Library', icon: BookOpen },
  { id: 'settings' as const, label: 'Settings', icon: Settings },
]

const settingsItems = [
  { id: 'general' as const, label: 'General', icon: Settings },
  { id: 'transcription' as const, label: 'Transcription', icon: Mic },
  { id: 'aiNotes' as const, label: 'AI Notes', icon: Sparkles },
  { id: 'exports' as const, label: 'Exports', icon: FileText },
  { id: 'about' as const, label: 'About', icon: CircleUser },
]

const apiKeyProviders: Array<{ id: ApiProviderId; label: string }> = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'groq', label: 'Groq' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'doubao', label: 'Doubao' },
  { id: 'deepgram', label: 'Deepgram' },
  { id: 'assemblyai', label: 'AssemblyAI' },
  { id: 'openai-compatible', label: 'Compatible' },
]

const realtimeProviderOptions: Array<{ id: RealtimeTranscriptionProviderId; label: string }> = [
  { id: 'doubao-realtime', label: 'Doubao' },
]

const batchSttProviderOptions: Array<{ id: BatchTranscriptionProviderId; label: string }> = [
  { id: 'openai', label: 'OpenAI' },
  { id: 'groq', label: 'Groq' },
  { id: 'doubao', label: 'Doubao' },
  { id: 'openai-compatible', label: 'Compatible' },
]

const aiNotesProviderOptions: Array<{ id: AppSettings['aiProvider']; label: string }> = [
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'groq', label: 'Groq' },
  { id: 'openai-compatible', label: 'Compatible' },
  { id: 'ollama', label: 'Ollama' },
]

const MEETING_GLOBAL_SHORTCUT = 'Alt+M'
const MEETING_GLOBAL_SHORTCUT_LABEL = 'Option+M'
const demoMeetingIds = new Set(['product-sync-alex', 'customer-acme', 'jamie-1on1', 'macos-audio'])

const routeTitles: Record<Route, string> = {
  today: 'Today',
  meeting: 'Meeting',
  library: 'Library',
  settings: 'Settings',
}

function createRecordingMeeting(now = new Date()): Meeting {
  return {
    id: `meeting-${now.getTime()}`,
    title: 'New Meeting',
    template: 'General meeting',
    participants: [],
    startedAt: now.toISOString(),
    duration: '00:00',
    phase: 'recording',
    manualNotes: '',
    markers: [],
    transcript: [],
    aiNotes: undefined,
  }
}

export function App() {
  const meetingRepository = useMemo(() => createDefaultMeetingRepository(), [])
  const browserSettingsRepository = useMemo(() => createBrowserAppSettingsRepository(), [])
  const audioImportInputRef = useRef<HTMLInputElement>(null)
  const [apiKeyRepository, setApiKeyRepository] = useState<ApiKeyRepository>(() =>
    createMemoryApiKeyRepository(),
  )
  const [desktopRepository, setDesktopRepository] = useState<AsyncMeetingRepository | undefined>()
  const [settingsRepository, setSettingsRepository] =
    useState<AppSettingsRepository>(browserSettingsRepository)
  const [storageMode, setStorageMode] = useState<'browser' | 'desktop'>('browser')
  const [route, setRoute] = useState<Route>('today')
  const [settingsPane, setSettingsPane] = useState<SettingsPane>('general')
  const [appSettings, setAppSettings] = useState<AppSettings>(() => loadBrowserAppSettings())
  const [meeting, setMeeting] = useState<Meeting>(
    () => latestRealMeeting(meetingRepository.list()) ?? createDraftMeeting(),
  )
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'ready'>('idle')
  const [exportStatus, setExportStatus] = useState<
    'idle' | 'saved' | 'downloaded' | 'unavailable' | 'error'
  >('idle')
  const [transcriptionStatus, setTranscriptionStatus] = useState<TranscriptionStatus>('idle')
  const [transcriptionError, setTranscriptionError] = useState('')
  const [lastAudioImport, setLastAudioImport] = useState<AudioImportRequest | undefined>()
  const [aiGenerationStatus, setAiGenerationStatus] = useState<AiGenerationStatus>('idle')
  const [aiGenerationError, setAiGenerationError] = useState('')
  const [apiKeyConfiguredByProvider, setApiKeyConfiguredByProvider] =
    useState<ApiKeyConfiguredMap>({})
  const [apiKeyProvider, setApiKeyProvider] = useState<ApiProviderId>(() =>
    recommendedApiKeyProvider(loadBrowserAppSettings()),
  )
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>('idle')
  const [apiKeyError, setApiKeyError] = useState('')
  const [apiConnectionStatus, setApiConnectionStatus] = useState<ApiConnectionStatus>('idle')
  const [apiConnectionResult, setApiConnectionResult] =
    useState<ProviderConnectionTestResult | undefined>()
  const [workflowError, setWorkflowError] = useState('')
  const capsuleCommandHandlersRef = useRef<{
    start: () => void | Promise<void>
    stop: () => void | Promise<void>
    hide: () => void | Promise<void>
  }>({
    start: () => {},
    stop: () => {},
    hide: () => {},
  })
  const view = getMeetingViewModel(meeting)
  const capsuleStatePayload = useMemo(
    () =>
      createCapsuleStatePayload(
        meeting,
        Date.now(),
        appSettings.desktopCapsuleEnabled && !appSettings.desktopCapsuleHidden,
      ),
    [
      appSettings.desktopCapsuleEnabled,
      appSettings.desktopCapsuleHidden,
      meeting.duration,
      meeting.id,
      meeting.phase,
      meeting.title,
    ],
  )

  const meetings = useMemo(
    () => (isEmptyDraftMeeting(meeting) ? [] : [meeting]),
    [meeting],
  )

  const updateSettings = (patch: Partial<AppSettings>) => {
    setWorkflowError('')
    setAppSettings((current) => ({ ...current, ...patch }))
  }

  const resolveApiKeyRepository = async (): Promise<ApiKeyRepository> => {
    if (isTauriRuntime()) {
      const repository = await createTauriApiKeyRepository()
      if (repository) {
        setApiKeyRepository(repository)
        setStorageMode('desktop')
        return repository
      }
    }

    return apiKeyRepository
  }

  const recoverEmptyErrorMeeting = () => {
    setMeeting((current) => (isEmptyErrorMeeting(current) ? createDraftMeeting() : current))
  }

  const startMeeting = async () => {
    const repository = await resolveApiKeyRepository()
    const setupError = await startMeetingSetupError(appSettings, repository)
    if (setupError) {
      setWorkflowError(setupError)
      setTranscriptionStatus('configuration_error')
      setTranscriptionError(setupError)
      setApiKeyProvider(providerKeyForRealtime(appSettings.realtimeTranscriptionProvider))
      setSettingsPane('transcription')
      setRoute('settings')
      return
    }

    const recordingMeeting = createRecordingMeeting()
    setMeeting(recordingMeeting)
    setTranscriptionStatus('idle')
    setTranscriptionError('')
    setLastAudioImport(undefined)
    setAiGenerationStatus('idle')
    setAiGenerationError('')
    setWorkflowError('')
    updateSettings({ desktopCapsuleEnabled: true, desktopCapsuleHidden: false })
    setRoute('meeting')

    try {
      const captureSession = await createTauriAudioCaptureSession()
      await captureSession?.start(
        recordingMeeting.id,
        await realtimeCaptureOptions(appSettings, repository),
      )
    } catch (error) {
      setMeeting((current) =>
        current.id === recordingMeeting.id
          ? {
              ...current,
              phase: 'error',
            }
          : current,
      )
      setTranscriptionStatus('error')
      setTranscriptionError(errorMessage(error))
    }
  }

  const startMeetingFromShortcut = async () => {
    if (
      meeting.phase === 'recording' ||
      meeting.phase === 'finalizing_transcript' ||
      meeting.phase === 'generating_ai_notes'
    ) {
      setRoute('meeting')
      return
    }

    await startMeeting()
  }

  const stopRecording = async () => {
    if (isTauriRuntime()) {
      try {
        const captureSession = await createTauriAudioCaptureSession()
        if (captureSession) {
          const capturedAudio = await captureSession.stop({
            keepFile: appSettings.saveRawAudio,
          })
          const baseMeeting = {
            ...meeting,
            transcript: finalizeTranscriptLines(meeting.transcript),
            rawAudio: capturedAudio.retained
              ? {
                  path: capturedAudio.path,
                  fileName: capturedAudio.file.name,
                  durationMillis: capturedAudio.durationMillis,
                  retainedAt: new Date().toISOString(),
                }
              : undefined,
          }
          if (baseMeeting.transcript.length) {
            setLastAudioImport(undefined)
            setTranscriptionStatus('idle')
            setTranscriptionError('')
            await generateAiNotesFromMeeting({
              ...baseMeeting,
              phase: 'generating_ai_notes',
            })
            return
          }
          const request = {
            meetingId: meeting.id,
            title: meeting.title,
            file: capturedAudio.file,
            baseMeeting,
          }
          setLastAudioImport(request)
          await transcribeAudioImport(request)
          return
        }
      } catch (error) {
        if (!isNoActiveAudioCaptureError(error)) {
          setMeeting((current) => ({
            ...current,
            phase: 'error',
          }))
          setTranscriptionStatus('error')
          setTranscriptionError(errorMessage(error))
          setRoute('meeting')
          return
        }
      }
    }

    const demoSource = {
      ...meeting,
      phase: 'generating_ai_notes' as const,
      transcript: finalizeTranscriptLines(meeting.transcript),
    }
    setTranscriptionStatus('idle')
    setTranscriptionError('')
    setLastAudioImport(undefined)
    setRoute('meeting')
    if (!hasMeetingSourceMaterial(demoSource)) {
      setMeeting({
        ...demoSource,
        phase: 'needs_review',
      })
      setAiGenerationStatus('idle')
      setAiGenerationError('')
      return
    }
    await generateAiNotesFromMeeting(demoSource, { localDemoFallback: true })
  }

  const openAudioImport = async () => {
    if (isTauriRuntime()) {
      try {
        const file = await selectTauriAudioFile()
        if (file) await beginAudioImport(file)
      } catch (error) {
        showAudioImportSetupError(error)
      }
      return
    }

    audioImportInputRef.current?.click()
  }

  const importAudioFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    await beginAudioImport(file)
  }

  const beginAudioImport = async (file: File) => {
    const request = {
      meetingId: `import-${Date.now()}`,
      title: audioTitleFromFileName(file.name),
      file,
    }
    setLastAudioImport(request)
    await transcribeAudioImport(request)
  }

  const showAudioImportSetupError = (error: unknown) => {
    const meetingId = `import-error-${Date.now()}`
    setRoute('meeting')
    setMeeting({
      ...createDraftMeeting(),
      id: meetingId,
      title: 'Audio import',
      phase: 'error',
    })
    setTranscriptionStatus('error')
    setTranscriptionError(errorMessage(error))
    setLastAudioImport(undefined)
  }

  const retryAudioImport = async () => {
    if (!lastAudioImport) return
    await transcribeAudioImport(lastAudioImport)
  }

  const transcribeAudioImport = async (request: AudioImportRequest) => {
      const importedMeeting: Meeting = request.baseMeeting
      ? {
          ...request.baseMeeting,
          phase: 'finalizing_transcript',
          aiNotes: undefined,
        }
      : {
          ...createDraftMeeting(),
          id: request.meetingId,
          title: request.title,
          phase: 'finalizing_transcript',
        }

    setRoute('meeting')
    setMeeting(importedMeeting)
    setTranscriptionStatus('importing')
    setTranscriptionError('')
    setAiGenerationStatus('idle')
    setAiGenerationError('')

    try {
      const provider = createTranscriptionProvider(appSettings, await resolveApiKeyRepository())
      const transcript = await provider.transcribe({
        meetingId: request.meetingId,
        audioUri: request.file.name,
        audioFile: request.file,
        audioFileName: request.file.name,
      })

      const transcriptMeeting: Meeting = {
        ...importedMeeting,
        phase: 'generating_ai_notes',
        transcript,
      }
      setMeeting((current) => (current.id === request.meetingId ? transcriptMeeting : current))
      setTranscriptionStatus('idle')
      await generateAiNotesFromMeeting(transcriptMeeting)
    } catch (error) {
      setMeeting((current) =>
        current.id === request.meetingId
          ? {
              ...current,
              phase: 'error',
            }
          : current,
      )
      setTranscriptionStatus(isProviderConfigurationError(error) ? 'configuration_error' : 'error')
      setTranscriptionError(errorMessage(error))
    }
  }

  const regenerateAiNotes = async () => {
    await generateAiNotesFromMeeting(meeting)
  }

  const generateAiNotesFromMeeting = async (
    sourceMeeting: Meeting,
    options: { localDemoFallback?: boolean } = {},
  ) => {
    if (!hasMeetingSourceMaterial(sourceMeeting)) {
      setAiGenerationStatus('idle')
      setAiGenerationError('')
      setMeeting((current) =>
        current.id === sourceMeeting.id
          ? {
              ...sourceMeeting,
              phase: sourceMeeting.phase === 'draft' ? 'draft' : 'needs_review',
              aiNotes: undefined,
            }
          : current,
      )
      return undefined
    }

    setAiGenerationStatus('generating')
    setAiGenerationError('')
    const generatingMeeting: Meeting = {
      ...sourceMeeting,
      phase: 'generating_ai_notes',
    }
    setMeeting((current) => (current.id === sourceMeeting.id ? generatingMeeting : current))

    try {
      const provider = createAiNotesProvider(
        options.localDemoFallback ? { ...appSettings, notesMode: 'local-demo' } : appSettings,
        await resolveApiKeyRepository(),
      )
      const generatedMeeting = await generateAiNotesForMeeting(provider, generatingMeeting)
      setMeeting(generatedMeeting)
      setCopyStatus('idle')
      setExportStatus('idle')
      setAiGenerationStatus('idle')
      return generatedMeeting
    } catch (error) {
      setAiGenerationStatus(isProviderConfigurationError(error) ? 'configuration_error' : 'error')
      setAiGenerationError(errorMessage(error))
      setMeeting((current) =>
        current.id === sourceMeeting.id
          ? {
              ...sourceMeeting,
              phase: 'needs_review',
            }
          : current,
      )
      return undefined
    }
  }

  const saveApiKey = async (provider = apiKeyProvider, draft = apiKeyDraft) => {
    setApiKeyStatus('saving')
    setApiKeyError('')
    setApiKeyProvider(provider)

    try {
      const repository = await resolveApiKeyRepository()
      await repository.save(provider, draft)
      setApiKeyDraft('')
      setApiKeyConfiguredByProvider((current) => ({
        ...current,
        [provider]: true,
      }))
      setWorkflowError('')
      setApiKeyStatus('saved')
      recoverEmptyErrorMeeting()
    } catch (error) {
      setApiKeyStatus('error')
      setApiKeyError(errorMessage(error))
    }
  }

  const testApiKeyConnection = async (provider = apiKeyProvider) => {
    setApiConnectionStatus('testing')
    setApiConnectionResult(undefined)
    setApiKeyError('')
    setApiKeyProvider(provider)

    try {
      const repository = await resolveApiKeyRepository()
      const configured = await repository.has(provider)
      setApiKeyConfiguredByProvider((current) => ({
        ...current,
        [provider]: configured,
      }))

      if (!configured) {
        throw new Error(`Save a ${providerLabel(provider)} API key before testing.`)
      }

      const result = await testProviderConnection(
        provider,
        providerTestBaseUrl(provider, appSettings),
      )
      setApiConnectionResult(result)
      setApiConnectionStatus(result.ok ? 'success' : 'error')
      if (result.ok) {
        setApiKeyConfiguredByProvider((current) => ({
          ...current,
          [provider]: true,
        }))
        setWorkflowError('')
        recoverEmptyErrorMeeting()
      }
    } catch (error) {
      setApiConnectionStatus('error')
      setApiConnectionResult({
        provider,
        ok: false,
        message: errorMessage(error),
      })
    }
  }

  const copyMarkdown = async () => {
    const markdown = formatMeetingMarkdown(meeting, {
      includeTranscript: appSettings.includeTranscriptInExport,
    })

    try {
      if (globalThis.navigator?.clipboard?.writeText) {
        await globalThis.navigator.clipboard.writeText(markdown)
        setCopyStatus('copied')
        return
      }
    } catch {
      setCopyStatus('ready')
      return
    }

    setCopyStatus('ready')
  }

  const saveMarkdown = async () => {
    const markdown = formatMeetingMarkdown(meeting, {
      includeTranscript: appSettings.includeTranscriptInExport,
    })

    try {
      const result = await exportMarkdownFile(meeting.title, markdown)
      if (result.mode === 'tauri-file') {
        setExportStatus('saved')
      } else if (result.mode === 'browser-download') {
        setExportStatus('downloaded')
      } else {
        setExportStatus('unavailable')
      }
    } catch {
      setExportStatus('error')
    }
  }

  const updateTranscript = (transcript: TranscriptLine[]) => {
    setMeeting((current) => ({
      ...current,
      transcript,
    }))
  }

  const updateManualNotes = (manualNotes: string) => {
    setMeeting((current) => ({
      ...current,
      manualNotes,
    }))
  }

  const updateAiNotes = (aiNotes: AiNotes) => {
    setMeeting((current) => ({
      ...current,
      aiNotes,
    }))
  }

  const deleteRawAudio = async () => {
    const rawAudio = meeting.rawAudio
    if (!rawAudio) return

    try {
      if (isTauriRuntime()) {
        const captureSession = await createTauriAudioCaptureSession()
        await captureSession?.deleteFile(rawAudio.path)
      }
      setMeeting((current) =>
        current.rawAudio?.path === rawAudio.path
          ? {
              ...current,
              rawAudio: undefined,
            }
          : current,
      )
    } catch (error) {
      setTranscriptionStatus('error')
      setTranscriptionError(errorMessage(error))
    }
  }

  useEffect(() => {
    capsuleCommandHandlersRef.current = {
      start: startMeetingFromShortcut,
      stop: stopRecording,
      hide: () => updateSettings({ desktopCapsuleHidden: true }),
    }
  })

  useEffect(() => {
    void publishCapsuleState(capsuleStatePayload)
  }, [capsuleStatePayload])

  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined

    listenCapsuleCommand((payload) => {
      const handler = capsuleCommandHandlersRef.current[payload.command]
      void handler()
    }).then((cleanup) => {
      if (disposed) cleanup()
      else unsubscribe = cleanup
    })

    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    if (!isTauriRuntime()) return

    let disposed = false
    let registered = false

    import('@tauri-apps/plugin-global-shortcut')
      .then(async ({ register, unregister }) => {
        await register(MEETING_GLOBAL_SHORTCUT, (event) => {
          if (event.state === 'Pressed') {
            void capsuleCommandHandlersRef.current.start()
          }
        })
        registered = true

        if (disposed) {
          registered = false
          await unregister(MEETING_GLOBAL_SHORTCUT)
        }
      })
      .catch(() => {
        registered = false
      })

    return () => {
      disposed = true
      if (registered) {
        void import('@tauri-apps/plugin-global-shortcut').then(({ unregister }) =>
          unregister(MEETING_GLOBAL_SHORTCUT),
        )
      }
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    createTauriMeetingRepository().then(async (repository) => {
      if (cancelled || !repository) return

      setDesktopRepository(repository)
      setStorageMode('desktop')

      const savedMeeting = latestRealMeeting(await repository.list())
      if (!cancelled && savedMeeting) {
        setMeeting(savedMeeting)
      }
    })

    createTauriAppSettingsRepository().then(async (repository) => {
      if (cancelled || !repository) return

      const savedSettings = await repository.load()
      if (cancelled) return

      setAppSettings(savedSettings)
      setSettingsRepository(repository)
      setStorageMode('desktop')
    })

    createTauriApiKeyRepository().then((repository) => {
      if (cancelled || !repository) return

      setApiKeyRepository(repository)
      setStorageMode('desktop')
    })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let disposed = false
    let unsubscribe: (() => void) | undefined

    listenRealtimeTranscript(
      (payload) => {
        if (disposed) return
        setMeeting((current) =>
          current.id === payload.meetingId
            ? {
                ...current,
                transcript: upsertTranscriptLine(current.transcript, payload.line),
              }
            : current,
        )
      },
      (payload) => {
        if (disposed) return
        setMeeting((current) =>
          current.id === payload.meetingId
            ? {
                ...current,
                phase: 'error',
              }
            : current,
        )
        setTranscriptionStatus('error')
        setTranscriptionError(payload.message)
      },
    ).then((cleanup) => {
      if (disposed) cleanup()
      else unsubscribe = cleanup
    })

    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    if (meeting.phase !== 'recording') return
    const startedAt = Date.parse(meeting.startedAt)
    if (!Number.isFinite(startedAt)) return

    const interval = window.setInterval(() => {
      setMeeting((current) =>
        current.id === meeting.id && current.phase === 'recording'
          ? {
              ...current,
              duration: formatClockDuration(Date.now() - startedAt),
            }
          : current,
      )
    }, 1000)

    return () => window.clearInterval(interval)
  }, [meeting.id, meeting.phase, meeting.startedAt])

  useEffect(() => {
    meetingRepository.save(meeting)
    desktopRepository?.save(meeting).catch(() => {
      setStorageMode('browser')
    })
  }, [desktopRepository, meeting, meetingRepository])

  useEffect(() => {
    setCopyStatus('idle')
    setExportStatus('idle')
  }, [meeting.id, meeting.phase])

  useEffect(() => {
    settingsRepository.save(appSettings).catch(() => {
      setStorageMode('browser')
    })
  }, [appSettings, settingsRepository])

  useEffect(() => {
    let cancelled = false
    const providers = apiKeyProviders.map((provider) => provider.id)

    Promise.allSettled(
      providers.map(async (provider) => [provider, await apiKeyRepository.has(provider)] as const),
    )
      .then((entries) => {
        if (cancelled) return
        setApiKeyConfiguredByProvider(
          Object.fromEntries(
            entries
              .filter((entry): entry is PromiseFulfilledResult<readonly [ApiProviderId, boolean]> =>
                entry.status === 'fulfilled',
              )
              .map((entry) => entry.value),
          ) as ApiKeyConfiguredMap,
        )
      })

    return () => {
      cancelled = true
    }
  }, [apiKeyRepository, apiKeyStatus])

  useEffect(() => {
    let cancelled = false

    setApiKeyDraft('')
    setApiKeyStatus('idle')
    setApiKeyError('')
    setApiConnectionStatus('idle')
    setApiConnectionResult(undefined)

    apiKeyRepository
      .has(apiKeyProvider)
        .then((configured) => {
          if (!cancelled) {
            setApiKeyConfiguredByProvider((current) => ({
              ...current,
              [apiKeyProvider]: configured,
          }))
        }
      })
      .catch((error) => {
        if (cancelled) return
        setApiKeyStatus('error')
        setApiKeyError(errorMessage(error))
      })

    return () => {
      cancelled = true
    }
  }, [apiKeyRepository, apiKeyProvider])

  return (
    <div className="app">
      <Sidebar route={route} onNavigate={setRoute} />
      <main className="workspace">
        <header className="titlebar" data-tauri-drag-region>
          <h2>{routeTitles[route]}</h2>
          <div className="title-actions">
            <button className="btn" onClick={openAudioImport} disabled={transcriptionStatus === 'importing'}>
              {transcriptionStatus === 'importing' ? 'Importing' : 'Import'}
            </button>
            <button className="btn btn-primary" onClick={startMeeting}>
              Start Meeting
            </button>
          </div>
          <input
            ref={audioImportInputRef}
            type="file"
            accept="audio/*,.m4a,.mp3,.mp4,.wav,.webm"
            hidden
            onChange={importAudioFile}
          />
        </header>
        {workflowError ? (
          <div className="workflow-alert" role="alert">
            {workflowError}
          </div>
        ) : null}

        {route === 'today' && (
          <TodayPage
            meetings={meetings}
            onOpenMeeting={() => setRoute('meeting')}
          />
        )}
        {route === 'meeting' && (
          <MeetingPage
            meeting={meeting}
            view={view}
            onStopRecording={stopRecording}
            onRegenerate={regenerateAiNotes}
            onCopyMarkdown={copyMarkdown}
            onSaveMarkdown={saveMarkdown}
            copyStatus={copyStatus}
            exportStatus={exportStatus}
            aiGenerationStatus={aiGenerationStatus}
            aiGenerationError={aiGenerationError}
            transcriptionStatus={transcriptionStatus}
            transcriptionError={transcriptionError}
            onRetryTranscriptImport={lastAudioImport ? retryAudioImport : undefined}
            onUpdateManualNotes={updateManualNotes}
            onUpdateTranscript={updateTranscript}
            onUpdateAiNotes={updateAiNotes}
            onDeleteRawAudio={deleteRawAudio}
          />
        )}
        {route === 'library' && <LibraryPage meetings={meetings} onOpenMeeting={() => setRoute('meeting')} />}
        {route === 'settings' && (
          <SettingsPage
            activePane={settingsPane}
            settings={appSettings}
            storageMode={storageMode}
            onSelectPane={setSettingsPane}
            onUpdateSettings={updateSettings}
            apiKeyConfiguredByProvider={apiKeyConfiguredByProvider}
            apiKeyProvider={apiKeyProvider}
            apiKeyDraft={apiKeyDraft}
            apiKeyStatus={apiKeyStatus}
            apiKeyError={apiKeyError}
            apiConnectionStatus={apiConnectionStatus}
            apiConnectionResult={apiConnectionResult}
            onApiKeyProviderChange={setApiKeyProvider}
            onApiKeyDraftChange={setApiKeyDraft}
            onSaveApiKey={saveApiKey}
            onTestApiKey={testApiKeyConnection}
          />
        )}
      </main>
    </div>
  )
}

function Sidebar({ route, onNavigate }: { route: Route; onNavigate: (route: Route) => void }) {
  return (
    <aside className="sidebar jelly-surface-flat">
      <div className="brand">
        <h1>OpenMinutes</h1>
        <p>AI Meeting Notes</p>
      </div>
      <nav className="nav" aria-label="Main navigation">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={route === id ? 'active jelly-nav-active' : ''}
            onClick={() => onNavigate(id)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </nav>
      <div className="account">
        <button>
          <CircleUser size={16} />
          Account
        </button>
      </div>
    </aside>
  )
}

function TodayPage({
  meetings,
  onOpenMeeting,
}: {
  meetings: Meeting[]
  onOpenMeeting: () => void
}) {
  const activeMeeting = meetings[0]

  return (
    <section className="content today-grid" aria-label="Today">
      <div className="pane jelly-card">
        <PaneHeader
          title="Today"
          subtitle={formatTodayLabel()}
          aside={activeMeeting ? <StatusLabel phase={activeMeeting.phase} /> : null}
        />
        <div className="meeting-list">
          {meetings.length ? (
            meetings.map((meeting) => (
              <button
                key={meeting.id}
                className={`meeting-row ${meeting.id === activeMeeting?.id ? 'selected' : ''}`}
                onClick={onOpenMeeting}
              >
                <time>{meeting.phase === 'recording' ? 'Live' : meeting.phase === 'ready' ? 'Ready' : '13:00'}</time>
                <span className="meeting-copy">
                  <strong>{meeting.title}</strong>
                  <small>{meetingSubtitle(meeting)}</small>
                </span>
                <StatusLabel phase={meeting.phase} compact />
              </button>
            ))
          ) : (
            <div className="empty-list-state">
              <strong>No meetings yet</strong>
              <span>Start a meeting to capture live transcript and notes.</span>
            </div>
          )}
        </div>
      </div>
      <aside className="pane jelly-card">
        <PaneHeader title="Current Meeting" subtitle="Default microphone" />
        <div className="summary-card">
          <h3>{activeMeeting?.title ?? 'Ready when you are'}</h3>
          <p>
            {activeMeeting
              ? 'Focus keeps attention on your key notes while the right panel captures the live transcript. Review turns those notes and transcript into AI Notes after stop.'
              : 'OpenMinutes will keep this screen empty until you start or import a real meeting.'}
          </p>
        </div>
      </aside>
    </section>
  )
}

function MeetingPage({
  meeting,
  view,
  onStopRecording,
  onRegenerate,
  onCopyMarkdown,
  onSaveMarkdown,
  copyStatus,
  exportStatus,
  aiGenerationStatus,
  aiGenerationError,
  transcriptionStatus,
  transcriptionError,
  onRetryTranscriptImport,
  onUpdateManualNotes,
  onUpdateTranscript,
  onUpdateAiNotes,
  onDeleteRawAudio,
}: {
  meeting: Meeting
  view: ReturnType<typeof getMeetingViewModel>
  onStopRecording: () => void | Promise<void>
  onRegenerate: () => void | Promise<void>
  onCopyMarkdown: () => void
  onSaveMarkdown: () => void
  copyStatus: 'idle' | 'copied' | 'ready'
  exportStatus: 'idle' | 'saved' | 'downloaded' | 'unavailable' | 'error'
  aiGenerationStatus: AiGenerationStatus
  aiGenerationError: string
  transcriptionStatus: TranscriptionStatus
  transcriptionError: string
  onRetryTranscriptImport?: () => void | Promise<void>
  onUpdateManualNotes: (manualNotes: string) => void
  onUpdateTranscript: (transcript: TranscriptLine[]) => void
  onUpdateAiNotes: (aiNotes: AiNotes) => void
  onDeleteRawAudio: () => void | Promise<void>
}) {
  const contextPreview = buildAiNotesContext(meeting)
  const [reviewSource, setReviewSource] = useState<'review' | 'manual'>('review')
  const [selectedTranscriptLineId, setSelectedTranscriptLineId] = useState<string | undefined>()
  const [selectedHumanSourceId, setSelectedHumanSourceId] = useState<string | undefined>()

  useEffect(() => {
    setReviewSource('review')
    setSelectedHumanSourceId(undefined)
    setSelectedTranscriptLineId(undefined)
  }, [meeting.id, view.mode])

  const selectReviewCitation = (citation: ReviewCitation) => {
    if (citation.type === 'human') {
      setSelectedHumanSourceId(citation.source.id)
      setSelectedTranscriptLineId(undefined)
      setReviewSource('review')
      return
    }

    setReviewSource('review')
    setSelectedHumanSourceId(undefined)
    setSelectedTranscriptLineId(citation.line.id)
  }

  return (
    <section className="content meeting-layout" aria-label="Meeting">
      {view.mode === 'focus' ? (
        <>
          <ManualNotesPane
            meeting={meeting}
            onUpdateManualNotes={onUpdateManualNotes}
            onStopRecording={view.canStop ? onStopRecording : undefined}
          />
          <TranscriptPane
            title={meeting.phase === 'recording' ? 'Live Transcript' : 'Transcript'}
            subtitle={
              meeting.phase === 'recording'
                ? 'Realtime STT while recording'
                : 'Realtime transcript appears after you start'
            }
            meeting={meeting}
            live={meeting.phase === 'recording'}
          />
        </>
      ) : (
        <>
          {reviewSource === 'manual' ? (
            <ManualNotesPane
              meeting={meeting}
              onUpdateManualNotes={onUpdateManualNotes}
              readOnly
              sourceMode
              selectedHumanSourceId={selectedHumanSourceId}
              onBackToReview={() => setReviewSource('review')}
            />
          ) : (
            <AiNotesPane
              meeting={meeting}
              onRegenerate={onRegenerate}
              onCopyMarkdown={onCopyMarkdown}
              onSaveMarkdown={onSaveMarkdown}
              copyStatus={copyStatus}
              exportStatus={exportStatus}
              aiGenerationStatus={aiGenerationStatus}
              aiGenerationError={aiGenerationError}
              transcriptionStatus={transcriptionStatus}
              transcriptionError={transcriptionError}
              onRetryTranscriptImport={onRetryTranscriptImport}
              contextPreview={contextPreview}
              onSelectCitation={selectReviewCitation}
              onUpdateAiNotes={onUpdateAiNotes}
              onDeleteRawAudio={onDeleteRawAudio}
              onOpenFocusSource={() => setReviewSource('manual')}
            />
          )}
          <TranscriptPane
            title="Sources"
            subtitle="Human notes + original transcript"
            meeting={meeting}
            editable
            manualNotes={meeting.manualNotes}
            selectedHumanSourceId={selectedHumanSourceId}
            selectedLineId={selectedTranscriptLineId}
            onUpdateTranscript={onUpdateTranscript}
          />
        </>
      )}
    </section>
  )
}

function ManualNotesPane({
  meeting,
  onUpdateManualNotes,
  onStopRecording,
  readOnly = false,
  sourceMode = false,
  selectedHumanSourceId,
  onBackToReview,
}: {
  meeting: Meeting
  onUpdateManualNotes: (manualNotes: string) => void
  onStopRecording?: () => void | Promise<void>
  readOnly?: boolean
  sourceMode?: boolean
  selectedHumanSourceId?: string
  onBackToReview?: () => void
}) {
  return (
    <div className={`pane jelly-card ${sourceMode ? 'manual-source-pane' : ''}`}>
      <PaneHeader
        title={meeting.title}
        subtitle={
          sourceMode
            ? 'Focus source used by AI Notes'
            : `${meeting.phase === 'recording' ? 'Recording' : 'Ready'} - Focus mode - microphone input`
        }
        aside={
          <div className="status-row">
            <ModeSwitch
              active="focus"
              canReview={sourceMode}
              onReview={sourceMode ? onBackToReview : undefined}
            />
            <StatusLabel phase={meeting.phase} />
          </div>
        }
      />
      {sourceMode ? (
        <ManualSourceText
          manualNotes={meeting.manualNotes}
          selectedHumanSourceId={selectedHumanSourceId}
        />
      ) : (
        <div className="editor-shell">
          <textarea
            className="note-editor"
            value={meeting.manualNotes}
            aria-label="Manual notes"
            placeholder="Write the important points you want AI Notes to pay attention to..."
            readOnly={readOnly}
            onChange={(event) => onUpdateManualNotes(event.target.value)}
          />
        </div>
      )}
      {sourceMode ? (
        <div className="recording-action-bar">
          <button onClick={onBackToReview}>Back to Review</button>
        </div>
      ) : onStopRecording ? (
        <div className="recording-action-bar">
          <button className="stop-button" aria-label="Stop recording from meeting" onClick={onStopRecording}>
            Stop Recording
          </button>
        </div>
      ) : null}
    </div>
  )
}

function ManualSourceText({
  manualNotes,
  selectedHumanSourceId,
}: {
  manualNotes: string
  selectedHumanSourceId?: string
}) {
  const selectedSourceRef = useRef<HTMLParagraphElement | null>(null)
  const sources = getHumanNoteSources(manualNotes)
  const sourceByLineIndex = new Map(sources.map((source) => [source.lineIndex, source]))
  const lines = manualNotes.split('\n')

  useEffect(() => {
    selectedSourceRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [selectedHumanSourceId])

  if (!manualNotes.trim()) {
    return (
      <div className="manual-source-text" aria-label="Human note text">
        <p>No human notes captured.</p>
      </div>
    )
  }

  return (
    <div className="manual-source-text" aria-label="Human note text">
      {lines.map((line, lineIndex) => {
        const source = sourceByLineIndex.get(lineIndex)
        const isSelected = Boolean(selectedHumanSourceId && source?.id === selectedHumanSourceId)

        return (
          <p
            key={`${lineIndex}-${line}`}
            ref={(node) => {
              if (isSelected) selectedSourceRef.current = node
            }}
            className={`manual-source-text-line ${isSelected ? 'selected-source' : ''} ${
              line.trim() ? '' : 'empty-line'
            }`}
          >
            {line}
          </p>
        )
      })}
    </div>
  )
}

function AiNotesPane({
  meeting,
  onRegenerate,
  onCopyMarkdown,
  onSaveMarkdown,
  copyStatus,
  exportStatus,
  aiGenerationStatus,
  aiGenerationError,
  transcriptionStatus,
  transcriptionError,
  onRetryTranscriptImport,
  contextPreview,
  onSelectCitation,
  onUpdateAiNotes,
  onDeleteRawAudio,
  onOpenFocusSource,
}: {
  meeting: Meeting
  onRegenerate: () => void | Promise<void>
  onCopyMarkdown: () => void
  onSaveMarkdown: () => void
  copyStatus: 'idle' | 'copied' | 'ready'
  exportStatus: 'idle' | 'saved' | 'downloaded' | 'unavailable' | 'error'
  aiGenerationStatus: AiGenerationStatus
  aiGenerationError: string
  transcriptionStatus: TranscriptionStatus
  transcriptionError: string
  onRetryTranscriptImport?: () => void | Promise<void>
  contextPreview: string
  onSelectCitation: (citation: ReviewCitation) => void
  onUpdateAiNotes: (aiNotes: AiNotes) => void
  onDeleteRawAudio: () => void | Promise<void>
  onOpenFocusSource: () => void
}) {
  const [editing, setEditing] = useState(false)
  const notes = meeting.aiNotes
  const isGenerating = aiGenerationStatus === 'generating'
  const isImportingTranscript = transcriptionStatus === 'importing'
  const generationFailed =
    aiGenerationStatus === 'configuration_error' || aiGenerationStatus === 'error'
  const transcriptionFailed =
    transcriptionStatus === 'configuration_error' || transcriptionStatus === 'error'
  const copyLabel =
    copyStatus === 'copied'
      ? 'Copied'
      : copyStatus === 'ready'
        ? 'Markdown Ready'
        : 'Copy Markdown'
  const exportLabel =
    exportStatus === 'saved'
      ? 'Saved'
      : exportStatus === 'downloaded'
        ? 'Downloaded'
        : exportStatus === 'unavailable'
          ? 'Desktop Only'
          : exportStatus === 'error'
            ? 'Save Failed'
            : 'Save Markdown'
  const hasGenerationContext =
    meeting.transcript.length > 0 || Boolean(meeting.manualNotes.trim())
  const canGenerateAiNotes = Boolean(notes) || hasGenerationContext
  const regenerateLabel = isGenerating
    ? 'Generating...'
    : generationFailed
      ? 'Retry Generate'
      : notes
        ? 'Regenerate'
        : 'Generate'
  const generationErrorMessage =
    aiGenerationStatus === 'configuration_error'
      ? 'API key is not configured. Add one in Settings > AI.'
      : aiGenerationError
  const transcriptionErrorMessage =
    transcriptionStatus === 'configuration_error'
      ? 'API key is not configured. Add one in Settings > AI.'
      : transcriptionError
  const emptyTitle = isImportingTranscript
    ? 'Finalizing Transcript'
    : isGenerating
      ? 'Writing AI Notes'
      : meeting.phase === 'recording'
        ? 'AI Notes After Stop'
        : 'No AI Notes Yet'
  const emptyCopy = isImportingTranscript
    ? 'OpenMinutes is turning the recording into source text.'
    : isGenerating
      ? 'OpenMinutes is using your Focus notes and transcript to write the Review.'
      : meeting.phase === 'recording'
        ? 'Review stays empty while recording. Stop recording to generate AI Notes.'
        : hasGenerationContext
          ? 'Generate AI Notes from the captured Focus notes and transcript.'
          : 'Capture human notes or transcript before generating a Review.'
  const reviewDocument = notes ? notes.document ?? formatAiNotesDocument(notes) : ''

  return (
    <div className="pane jelly-card ai-main">
      <PaneHeader
        title={meeting.title}
        subtitle="Review mode - AI Notes generated from notes + transcript"
        aside={
          <div className="status-row">
            <ModeSwitch active="review" onFocus={onOpenFocusSource} />
            <StatusLabel phase={meeting.phase} />
          </div>
        }
      />
      {notes ? (
        <div className="ai-notes review-document" aria-label="AI Notes">
          {generationFailed ? (
            <div className="generation-alert" role="alert">
              <strong>AI Notes were not updated.</strong>
              <span>{generationErrorMessage}</span>
            </div>
          ) : null}
          <ReviewReferenceBar meeting={meeting} onDeleteRawAudio={onDeleteRawAudio} />
          {editing ? (
            <textarea
              className="review-document-textarea"
              aria-label="AI Notes document"
              value={reviewDocument}
              rows={autoRows(reviewDocument, 18, 72)}
              onChange={(event) => onUpdateAiNotes({ ...notes, document: event.target.value })}
            />
          ) : (
            <ReviewReadableDocument
              documentText={reviewDocument}
              meeting={meeting}
              onSelectCitation={onSelectCitation}
            />
          )}
          <details className="context-preview">
            <summary>Generation context</summary>
            <pre>{contextPreview}</pre>
          </details>
        </div>
      ) : (
        <div className="ai-notes" aria-label="AI Notes">
          <ReviewReferenceBar meeting={meeting} onDeleteRawAudio={onDeleteRawAudio} />
          <div className={`empty-generation ${isGenerating || isImportingTranscript ? 'loading-generation' : ''}`}>
            <Sparkles size={22} />
            <h3>{emptyTitle}</h3>
            <p>{emptyCopy}</p>
            {transcriptionFailed ? (
              <div className="generation-alert" role="alert">
                <strong>Transcript import failed.</strong>
                <span>{transcriptionErrorMessage}</span>
                {onRetryTranscriptImport ? (
                  <button className="alert-action" onClick={onRetryTranscriptImport}>
                    Retry Import
                  </button>
                ) : null}
              </div>
            ) : null}
            {generationFailed ? (
              <div className="generation-alert" role="alert">
                <strong>AI Notes were not generated.</strong>
                <span>{generationErrorMessage}</span>
              </div>
            ) : null}
          </div>
        </div>
      )}
      <div className="pane-action-bar">
        {notes ? (
          <button onClick={() => setEditing((current) => !current)}>
            {editing ? 'Done Editing' : 'Edit'}
          </button>
        ) : null}
        <button
          onClick={onRegenerate}
          disabled={isGenerating || isImportingTranscript || !canGenerateAiNotes}
        >
          {regenerateLabel}
        </button>
        <button onClick={onCopyMarkdown} disabled={!notes}>
          {copyLabel}
        </button>
        <button onClick={onSaveMarkdown} disabled={!notes}>
          {exportLabel}
        </button>
      </div>
    </div>
  )
}

function ReviewReadableDocument({
  documentText,
  meeting,
  onSelectCitation,
}: {
  documentText: string
  meeting: Meeting
  onSelectCitation: (citation: ReviewCitation) => void
}) {
  const lines = documentText.split('\n')
  const firstCitableIndex = lines.findIndex((line) => isCitableReviewLine(line))
  let usedHumanFallback = false

  return (
    <div className="review-readable-document" aria-label="AI Notes readable document">
      {lines.map((line, index) => {
        const trimmedLine = line.trim()

        if (!trimmedLine) return <div key={`blank-${index}`} className="review-readable-gap" />

        const heading = reviewHeadingText(trimmedLine)
        if (heading) {
          return <h3 key={`heading-${index}`}>{renderReviewInlineText(heading)}</h3>
        }

        const citableText = reviewCitationText(trimmedLine)
        const includeHumanFallback = index === firstCitableIndex && !usedHumanFallback
        const citations = findReviewCitations({
          manualNotes: meeting.manualNotes,
          transcript: meeting.transcript,
          text: citableText,
          includeHumanFallback,
        })
        if (citations.some((citation) => citation.type === 'human')) usedHumanFallback = true

        return (
          <p
            key={`line-${index}`}
            className={`review-readable-line ${isReviewBulletLine(trimmedLine) ? 'bullet' : ''}`}
          >
            <span>{renderReviewInlineText(trimmedLine)}</span>
            <ReviewCitationChips citations={citations} onSelectCitation={onSelectCitation} />
          </p>
        )
      })}
    </div>
  )
}

function ReviewCitationChips({
  citations,
  onSelectCitation,
}: {
  citations: ReviewCitation[]
  onSelectCitation: (citation: ReviewCitation) => void
}) {
  if (!citations.length) return null

  return (
    <span className="review-inline-citations" aria-label="Line sources">
      {citations.map((citation) => (
        <button
          key={`${citation.type}-${citation.id}`}
          className={`review-inline-citation ${citation.type}`}
          onClick={() => onSelectCitation(citation)}
          title={citation.type === 'human' ? citation.source.text : citation.line.text}
        >
          [{citation.label}]
        </button>
      ))}
    </span>
  )
}

function isCitableReviewLine(line: string): boolean {
  const trimmedLine = line.trim()
  if (reviewHeadingText(trimmedLine)) return false

  const text = reviewCitationText(trimmedLine)
  return text.length >= 18
}

function isReviewBulletLine(line: string): boolean {
  return /^[-*•]\s+/.test(line) || /^\[[ xX]\]\s+/.test(line)
}

function reviewCitationText(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*•]\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/\*\*/g, '')
    .trim()
}

function reviewHeadingText(line: string): string | undefined {
  const match = /^#{2,3}\s+(.+)$/.exec(line)
  return match?.[1]?.trim() || undefined
}

function renderReviewInlineText(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={`strong-${index}`}>{part.slice(2, -2)}</strong>
    }

    return part
  })
}

function ReviewReferenceBar({
  meeting,
  onDeleteRawAudio,
}: {
  meeting: Meeting
  onDeleteRawAudio: () => void | Promise<void>
}) {
  const rawAudio = meeting.rawAudio

  if (!rawAudio) return null

  return (
    <div className="review-reference-bar" aria-label="Review references">
      <div className="review-raw-audio">
        <strong>Raw audio</strong>
        <span>{rawAudio.fileName} · {formatDurationMillis(rawAudio.durationMillis)}</span>
        <button onClick={onDeleteRawAudio}>Delete Raw Audio</button>
      </div>
    </div>
  )
}

function TranscriptPane({
  title,
  subtitle,
  meeting,
  live = false,
  editable = false,
  manualNotes,
  selectedHumanSourceId,
  selectedLineId,
  onUpdateTranscript,
}: {
  title: string
  subtitle: string
  meeting: Meeting
  live?: boolean
  editable?: boolean
  manualNotes?: string
  selectedHumanSourceId?: string
  selectedLineId?: string
  onUpdateTranscript?: (transcript: TranscriptLine[]) => void
}) {
  const [speakerDrafts, setSpeakerDrafts] = useState<Record<string, string>>({})
  const [editingLineId, setEditingLineId] = useState<string | undefined>()
  const selectedLineRef = useRef<HTMLElement | null>(null)
  const speakers = uniqueTranscriptSpeakers(meeting.transcript)

  useEffect(() => {
    selectedLineRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [selectedLineId])

  const updateLine = (index: number, patch: Partial<TranscriptLine>) => {
    onUpdateTranscript?.(
      meeting.transcript.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...patch } : line,
      ),
    )
  }
  const addLine = () => {
    const lastLine = meeting.transcript.at(-1)
    const nextLine: TranscriptLine = {
      id: `${meeting.id}-manual-transcript-${Date.now()}`,
      time: nextTranscriptTime(lastLine?.time),
      speaker: lastLine?.speaker || 'Speaker',
      text: '',
    }
    onUpdateTranscript?.([
      ...meeting.transcript,
      nextLine,
    ])
    setEditingLineId(nextLine.id)
  }
  const deleteLine = (index: number) => {
    setEditingLineId(undefined)
    onUpdateTranscript?.(meeting.transcript.filter((_, lineIndex) => lineIndex !== index))
  }
  const updateSpeakerDraft = (speaker: string, value: string) => {
    setSpeakerDrafts((current) => ({ ...current, [speaker]: value }))
  }
  const renameSpeaker = (speaker: string) => {
    const nextSpeaker = normalizeSpeakerName(speakerDrafts[speaker] ?? speaker)
    if (!nextSpeaker || nextSpeaker === speaker) return

    onUpdateTranscript?.(
      meeting.transcript.map((line) =>
        normalizeSpeakerName(line.speaker) === speaker ? { ...line, speaker: nextSpeaker } : line,
      ),
    )
    setSpeakerDrafts((current) => {
      const next = { ...current }
      delete next[speaker]
      return next
    })
  }

  return (
    <aside className="pane jelly-card transcript-pane" aria-label={title}>
      <PaneHeader
        title={title}
        subtitle={subtitle}
        aside={live ? <span className="chip">Live</span> : editable ? <span className="chip">Source</span> : null}
      />
      {manualNotes !== undefined ? (
        <SourceNotesBlock manualNotes={manualNotes} selectedHumanSourceId={selectedHumanSourceId} />
      ) : null}
      <div className="transcript-list">
        {meeting.transcript.map((line, index) => {
          const isEditing = editable && editingLineId === line.id
          const lineClass = `transcript-line ${
            line.id === selectedLineId ? 'selected-source' : ''
          }`

          if (isEditing) {
            return (
            <div
              key={line.id}
              ref={(node) => {
                if (line.id === selectedLineId) selectedLineRef.current = node
              }}
              className={`transcript-line transcript-edit-line ${
                line.id === selectedLineId ? 'selected-source' : ''
              }`}
            >
              <time>{line.time}</time>
              <div className="transcript-edit-fields">
                <input
                  className="transcript-speaker-input"
                  aria-label={`Transcript speaker ${index + 1}`}
                  value={line.speaker}
                  onChange={(event) => updateLine(index, { speaker: event.target.value })}
                />
                <textarea
                  className="transcript-textarea"
                  aria-label={`Transcript text ${index + 1}`}
                  rows={autoRows(line.text, 2, 34)}
                  value={line.text}
                  onChange={(event) => updateLine(index, { text: event.target.value })}
                />
                <button
                  className="transcript-delete"
                  aria-label={`Delete transcript line ${index + 1}`}
                  onClick={() => deleteLine(index)}
                >
                  Delete
                </button>
                <button className="transcript-done" onClick={() => setEditingLineId(undefined)}>
                  Done
                </button>
              </div>
            </div>
            )
          }

          if (editable) {
            return (
              <button
                key={line.id}
                type="button"
                ref={(node) => {
                  if (line.id === selectedLineId) selectedLineRef.current = node
                }}
                className={`${lineClass} transcript-readable-line`}
                aria-label={`Edit transcript line ${index + 1}`}
                onClick={() => setEditingLineId(line.id)}
              >
                <time>{line.time}</time>
                <p>
                  <strong>{line.speaker}:</strong> {line.text}
                </p>
              </button>
            )
          }

          return (
            <div
              key={line.id}
              ref={(node) => {
                if (line.id === selectedLineId) selectedLineRef.current = node
              }}
              className={lineClass}
            >
              <time>{line.time}</time>
              <p>
                <strong>{line.speaker}:</strong> {line.text}
              </p>
            </div>
          )
        })}
      </div>
      {editable ? (
        <div className="transcript-actions">
          <button onClick={addLine}>Add Line</button>
          {speakers.length ? (
            <details className="speaker-tools">
              <summary>Speakers</summary>
              <div className="speaker-rename-list">
                {speakers.map((speaker) => {
                  const draft = speakerDrafts[speaker] ?? speaker
                  const canRename = normalizeSpeakerName(draft) !== speaker

                  return (
                    <div className="speaker-rename-row" key={speaker}>
                      <span>{speaker}</span>
                      <input
                        aria-label={`Rename speaker ${speaker}`}
                        value={draft}
                        onChange={(event) => updateSpeakerDraft(speaker, event.target.value)}
                      />
                      <button
                        aria-label={`Rename all ${speaker}`}
                        disabled={!canRename}
                        onClick={() => renameSpeaker(speaker)}
                      >
                        Rename
                      </button>
                    </div>
                  )
                })}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </aside>
  )
}

function SourceNotesBlock({
  manualNotes,
  selectedHumanSourceId,
}: {
  manualNotes: string
  selectedHumanSourceId?: string
}) {
  const selectedSourceRef = useRef<HTMLParagraphElement | null>(null)
  const sources = getHumanNoteSources(manualNotes)
  const sourceByLineIndex = new Map(sources.map((source) => [source.lineIndex, source]))
  const lines = manualNotes.trim() ? manualNotes.split('\n') : []

  useEffect(() => {
    selectedSourceRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [selectedHumanSourceId])

  return (
    <section className="source-notes-block" aria-label="Human notes source">
      <div className="source-notes-title">
        <strong>Human Notes</strong>
        <span>{lines.length ? `${sources.length || lines.length} lines` : 'Empty'}</span>
      </div>
      {lines.length ? (
        <div className="source-notes-list">
          {lines.map((line, lineIndex) => {
            const source = sourceByLineIndex.get(lineIndex)
            const isSelected = Boolean(selectedHumanSourceId && source?.id === selectedHumanSourceId)

            return (
              <p
                key={`${lineIndex}-${line}`}
                ref={(node) => {
                  if (isSelected) selectedSourceRef.current = node
                }}
                className={`source-note-line ${isSelected ? 'selected-source' : ''} ${
                  line.trim() ? '' : 'empty-line'
                }`}
              >
                {line}
              </p>
            )
          })}
        </div>
      ) : (
        <p className="source-notes-empty">No human notes captured.</p>
      )}
    </section>
  )
}

function LibraryPage({
  meetings,
  onOpenMeeting,
}: {
  meetings: Meeting[]
  onOpenMeeting: () => void
}) {
  return (
    <section className="content library-layout" aria-label="Library">
      <input className="search" value="pricing decision" aria-label="Search meetings" readOnly />
      <div className="pane jelly-card">
        <PaneHeader title="Library" subtitle="Search by meeting, person, project, decision" />
        <div className="meeting-list">
          {meetings.slice(0, 3).map((meeting) => (
            <button key={meeting.id} className="meeting-row" onClick={onOpenMeeting}>
              <time>{meeting.phase === 'recording' ? 'Live' : 'Jun 14'}</time>
              <span className="meeting-copy">
                <strong>{meeting.title}</strong>
                <small>{meetingSubtitle(meeting)}</small>
              </span>
              <StatusLabel phase={meeting.phase} compact />
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}

function SettingsPage({
  activePane,
  settings,
  storageMode,
  onSelectPane,
  onUpdateSettings,
  apiKeyConfiguredByProvider,
  apiKeyProvider,
  apiKeyDraft,
  apiKeyStatus,
  apiKeyError,
  apiConnectionStatus,
  apiConnectionResult,
  onApiKeyProviderChange,
  onApiKeyDraftChange,
  onSaveApiKey,
  onTestApiKey,
}: {
  activePane: SettingsPane
  settings: AppSettings
  storageMode: 'browser' | 'desktop'
  onSelectPane: (pane: SettingsPane) => void
  onUpdateSettings: (patch: Partial<AppSettings>) => void
  apiKeyConfiguredByProvider: ApiKeyConfiguredMap
  apiKeyProvider: ApiProviderId
  apiKeyDraft: string
  apiKeyStatus: ApiKeyStatus
  apiKeyError: string
  apiConnectionStatus: ApiConnectionStatus
  apiConnectionResult?: ProviderConnectionTestResult
  onApiKeyProviderChange: (provider: ApiProviderId) => void
  onApiKeyDraftChange: (value: string) => void
  onSaveApiKey: (provider?: ApiProviderId, draft?: string) => void | Promise<void>
  onTestApiKey: (provider?: ApiProviderId) => void | Promise<void>
}) {
  return (
    <section className="settings-layout" aria-label="Settings">
      <aside className="settings-sidebar jelly-surface-flat">
        <h3>Settings</h3>
        {settingsItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={activePane === id ? 'active jelly-nav-active' : ''}
            onClick={() => onSelectPane(id)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </aside>
      <div className="settings-pane">
        <div className="settings-title">{settingsItems.find((item) => item.id === activePane)?.label}</div>
        <SettingsContent
          activePane={activePane}
          settings={settings}
          storageMode={storageMode}
          onUpdateSettings={onUpdateSettings}
          apiKeyConfiguredByProvider={apiKeyConfiguredByProvider}
          apiKeyProvider={apiKeyProvider}
          apiKeyDraft={apiKeyDraft}
          apiKeyStatus={apiKeyStatus}
          apiKeyError={apiKeyError}
          apiConnectionStatus={apiConnectionStatus}
          apiConnectionResult={apiConnectionResult}
          onApiKeyProviderChange={onApiKeyProviderChange}
          onApiKeyDraftChange={onApiKeyDraftChange}
          onSaveApiKey={onSaveApiKey}
          onTestApiKey={onTestApiKey}
        />
      </div>
    </section>
  )
}

function SettingsContent({
  activePane,
  settings,
  storageMode,
  onUpdateSettings,
  apiKeyConfiguredByProvider,
  apiKeyProvider,
  apiKeyDraft,
  apiKeyStatus,
  apiKeyError,
  apiConnectionStatus,
  apiConnectionResult,
  onApiKeyProviderChange,
  onApiKeyDraftChange,
  onSaveApiKey,
  onTestApiKey,
}: {
  activePane: SettingsPane
  settings: AppSettings
  storageMode: 'browser' | 'desktop'
  onUpdateSettings: (patch: Partial<AppSettings>) => void
  apiKeyConfiguredByProvider: ApiKeyConfiguredMap
  apiKeyProvider: ApiProviderId
  apiKeyDraft: string
  apiKeyStatus: ApiKeyStatus
  apiKeyError: string
  apiConnectionStatus: ApiConnectionStatus
  apiConnectionResult?: ProviderConnectionTestResult
  onApiKeyProviderChange: (provider: ApiProviderId) => void
  onApiKeyDraftChange: (value: string) => void
  onSaveApiKey: (provider?: ApiProviderId, draft?: string) => void | Promise<void>
  onTestApiKey: (provider?: ApiProviderId) => void | Promise<void>
}) {
  const realtimeKeyProvider = providerKeyForRealtime(settings.realtimeTranscriptionProvider)
  const audioImportKeyProvider = providerKeyForBatch(settings.transcriptionProvider)
  const aiNotesKeyProvider = providerKeyForAiNotes(settings.aiProvider)

  if (activePane === 'general') {
    return (
      <div className="settings-form">
        <FieldGroup label="Capture mode">
          <SegmentedControl
            left="Focus first"
            right="Split view"
            value={settings.meetingPreference === 'focus-first' ? 'left' : 'right'}
            onChange={(value) =>
              onUpdateSettings({ meetingPreference: value === 'left' ? 'focus-first' : 'split-view' })
            }
          />
        </FieldGroup>
        <FieldGroup label="Recording input">
          <SettingsInput label="Active source" value="Default microphone" readOnly />
          <p className="settings-hint">
            System meeting audio is not captured in this build. ScreenCaptureKit support is required
            for headphone meetings.
          </p>
        </FieldGroup>
        <FieldGroup label="Desktop controls">
          <ToggleRow
            title="Desktop capsule"
            description="Show the floating logo for one-click meeting capture."
            checked={settings.desktopCapsuleEnabled && !settings.desktopCapsuleHidden}
            onToggle={() =>
              onUpdateSettings(
                settings.desktopCapsuleEnabled && !settings.desktopCapsuleHidden
                  ? { desktopCapsuleHidden: true }
                  : { desktopCapsuleEnabled: true, desktopCapsuleHidden: false },
              )
            }
          />
          {settings.desktopCapsuleHidden ? (
            <button
              className="settings-action restore-capsule"
              onClick={() => onUpdateSettings({ desktopCapsuleEnabled: true, desktopCapsuleHidden: false })}
            >
              Restore Capsule
            </button>
          ) : null}
          <SettingsInput label="Start shortcut" value={MEETING_GLOBAL_SHORTCUT_LABEL} readOnly />
        </FieldGroup>
        <FieldGroup label="Recording files">
          <ToggleRow
            title="Save raw audio"
            description="Off by default after transcription."
            checked={settings.saveRawAudio}
            onToggle={() => onUpdateSettings({ saveRawAudio: !settings.saveRawAudio })}
          />
        </FieldGroup>
        <FieldGroup label="Privacy">
          <ToggleRow
            title="Hide transcript"
            description="Show original transcript only in Review."
            checked={settings.hideTranscriptByDefault}
            onToggle={() => onUpdateSettings({ hideTranscriptByDefault: !settings.hideTranscriptByDefault })}
          />
          <ToggleRow
            title="No public links"
            description="Keep exported notes local by default."
            checked={settings.noPublicLinks}
            onToggle={() => onUpdateSettings({ noPublicLinks: !settings.noPublicLinks })}
          />
        </FieldGroup>
        <FieldGroup label="Security">
          <ToggleRow
            title="Use OS keychain"
            description="Keep API keys outside regular app settings."
            checked={settings.useKeychain}
            onToggle={() => onUpdateSettings({ useKeychain: !settings.useKeychain })}
          />
        </FieldGroup>
      </div>
    )
  }

  if (activePane === 'transcription') {
    return (
      <div className="settings-form">
        <FieldGroup label="Realtime transcript">
          <SettingsSelect
            label="Provider"
            options={realtimeProviderOptions}
            value={settings.realtimeTranscriptionProvider}
            onChange={(realtimeTranscriptionProvider) => {
              onUpdateSettings({
                realtimeTranscriptionProvider,
                realtimeModel: defaultRealtimeModel(realtimeTranscriptionProvider),
              })
              onApiKeyProviderChange(providerKeyForRealtime(realtimeTranscriptionProvider))
            }}
          />
          <ApiKeySettingField
            provider={realtimeKeyProvider}
            configured={Boolean(apiKeyConfiguredByProvider[realtimeKeyProvider])}
            selected={apiKeyProvider === realtimeKeyProvider}
            draft={apiKeyDraft}
            status={apiKeyStatus}
            error={apiKeyError}
            connectionStatus={apiConnectionStatus}
            connectionResult={apiConnectionResult}
            onSelect={() => onApiKeyProviderChange(realtimeKeyProvider)}
            onDraftChange={onApiKeyDraftChange}
            onSave={onSaveApiKey}
            onTest={onTestApiKey}
          />
          <SettingsInput
            label="Model"
            value={settings.realtimeModel}
            onChange={(realtimeModel) => onUpdateSettings({ realtimeModel })}
          />
        </FieldGroup>
        <FieldGroup label="Audio import">
          <SegmentedControl
            left="Provider STT"
            right="Local Demo STT"
            value={settings.transcriptionMode === 'provider' ? 'left' : 'right'}
            onChange={(value) =>
              onUpdateSettings({ transcriptionMode: value === 'left' ? 'provider' : 'local-demo' })
            }
          />
          {settings.transcriptionMode === 'provider' ? (
            <>
              <SettingsSelect
                label="Provider"
                options={batchSttProviderOptions}
                value={settings.transcriptionProvider}
                onChange={(transcriptionProvider) => {
                  onUpdateSettings({
                    transcriptionProvider,
                    transcriptionBaseUrl: defaultTranscriptionBaseUrl(transcriptionProvider),
                    sttModel: defaultTranscriptionModel(transcriptionProvider),
                  })
                  onApiKeyProviderChange(providerKeyForBatch(transcriptionProvider))
                }}
              />
              {audioImportKeyProvider === realtimeKeyProvider ? (
                <p className="settings-hint">
                  Uses the same {providerLabel(audioImportKeyProvider)} API key as realtime transcript.
                </p>
              ) : (
                <ApiKeySettingField
                  provider={audioImportKeyProvider}
                  configured={Boolean(apiKeyConfiguredByProvider[audioImportKeyProvider])}
                  selected={apiKeyProvider === audioImportKeyProvider}
                  draft={apiKeyDraft}
                  status={apiKeyStatus}
                  error={apiKeyError}
                  connectionStatus={apiConnectionStatus}
                  connectionResult={apiConnectionResult}
                  onSelect={() => onApiKeyProviderChange(audioImportKeyProvider)}
                  onDraftChange={onApiKeyDraftChange}
                  onSave={onSaveApiKey}
                  onTest={onTestApiKey}
                />
              )}
              <SettingsInput
                label="Model"
                value={settings.sttModel}
                onChange={(sttModel) => onUpdateSettings({ sttModel })}
              />
              {settings.transcriptionProvider === 'openai-compatible' ? (
                <SettingsInput
                  label="Base URL"
                  value={settings.transcriptionBaseUrl}
                  onChange={(transcriptionBaseUrl) => onUpdateSettings({ transcriptionBaseUrl })}
                />
              ) : null}
            </>
          ) : null}
        </FieldGroup>
      </div>
    )
  }

  if (activePane === 'aiNotes') {
    return (
      <div className="settings-form">
        <FieldGroup label="AI Notes">
          <SegmentedControl
            left="Provider LLM"
            right="Local Demo Notes"
            value={settings.notesMode === 'provider' ? 'left' : 'right'}
            onChange={(value) =>
              onUpdateSettings({ notesMode: value === 'left' ? 'provider' : 'local-demo' })
            }
          />
          {settings.notesMode === 'provider' ? (
            <>
              <SettingsSelect
                label="Provider"
                options={aiNotesProviderOptions}
                value={settings.aiProvider}
                onChange={(aiProvider) => {
                  onUpdateSettings({
                    aiProvider,
                    aiBaseUrl: defaultNotesBaseUrl(aiProvider),
                    notesModel: defaultNotesModel(aiProvider),
                  })
                  const keyProvider = providerKeyForAiNotes(aiProvider)
                  if (keyProvider) onApiKeyProviderChange(keyProvider)
                }}
              />
              <ApiKeySettingField
                provider={aiNotesKeyProvider}
                configured={aiNotesKeyProvider ? Boolean(apiKeyConfiguredByProvider[aiNotesKeyProvider]) : false}
                selected={aiNotesKeyProvider ? apiKeyProvider === aiNotesKeyProvider : false}
                draft={apiKeyDraft}
                status={apiKeyStatus}
                error={apiKeyError}
                connectionStatus={apiConnectionStatus}
                connectionResult={apiConnectionResult}
                onSelect={() => {
                  if (aiNotesKeyProvider) onApiKeyProviderChange(aiNotesKeyProvider)
                }}
                onDraftChange={onApiKeyDraftChange}
                onSave={onSaveApiKey}
                onTest={onTestApiKey}
              />
              <SettingsInput
                label="Model"
                value={settings.notesModel}
                onChange={(notesModel) => onUpdateSettings({ notesModel })}
              />
              {settings.aiProvider === 'openai-compatible' || settings.aiProvider === 'ollama' ? (
                <SettingsInput
                  label="Base URL"
                  value={settings.aiBaseUrl}
                  onChange={(aiBaseUrl) => onUpdateSettings({ aiBaseUrl })}
                />
              ) : null}
            </>
          ) : null}
        </FieldGroup>
      </div>
    )
  }

  if (activePane === 'exports') {
    return (
      <div className="settings-form">
        <FieldGroup label="Markdown">
          <SettingsInput label="Default folder" value={settings.exportFolder} readOnly />
          <ToggleRow
            title="Include transcript"
            description="Off by default for exported AI Notes."
            checked={settings.includeTranscriptInExport}
            onToggle={() =>
              onUpdateSettings({ includeTranscriptInExport: !settings.includeTranscriptInExport })
            }
          />
        </FieldGroup>
        <FieldGroup label="Integrations">
          <div className="integration-grid">
            <IntegrationTile
              provider="slack"
              title="Slack"
              status="Webhook"
              description="Send AI Notes to a channel after Review."
            >
              <SettingsInput
                label="Destination"
                value={settings.slackWebhookLabel}
                onChange={(slackWebhookLabel) => onUpdateSettings({ slackWebhookLabel })}
              />
            </IntegrationTile>
            <IntegrationTile
              provider="notion"
              title="Notion"
              status="Page"
              description="Export Review notes to a workspace page."
            >
              <SettingsInput
                label="Destination"
                value={settings.notionExportLabel}
                onChange={(notionExportLabel) => onUpdateSettings({ notionExportLabel })}
              />
            </IntegrationTile>
            <IntegrationTile
              provider="zoom"
              title="Zoom"
              status="Coming soon"
              description="Detect meetings and attach notes later."
            />
            <IntegrationTile
              provider="teams"
              title="Teams"
              status="Coming soon"
              description="Attach notes to Microsoft Teams meetings."
            />
          </div>
        </FieldGroup>
      </div>
    )
  }

  return (
    <div className="settings-form">
      <FieldGroup label="Build">
        <SettingsInput label="Version" value="0.1.0" readOnly />
        <SettingsInput label="Storage" value={storageMode === 'desktop' ? 'Desktop store' : 'Browser preview'} readOnly />
      </FieldGroup>
      <FieldGroup label="License">
        <SettingsInput label="Type" value="MIT" readOnly />
      </FieldGroup>
    </div>
  )
}

function PaneHeader({
  title,
  subtitle,
  aside,
}: {
  title: string
  subtitle: string
  aside?: React.ReactNode
}) {
  return (
    <div className="pane-header">
      <div className="pane-title">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      {aside}
    </div>
  )
}

function ModeSwitch({
  active,
  canReview = true,
  onFocus,
  onReview,
}: {
  active: 'focus' | 'review'
  canReview?: boolean
  onFocus?: () => void
  onReview?: () => void
}) {
  return (
    <div className="mode-switch" aria-label="Meeting mode">
      <button
        type="button"
        className={active === 'focus' ? 'active jelly-nav-active' : ''}
        disabled={active === 'focus' || !onFocus}
        onClick={onFocus}
      >
        Focus
      </button>
      <button
        type="button"
        className={active === 'review' ? 'active jelly-nav-active' : ''}
        disabled={active === 'review' || !canReview || !onReview}
        onClick={onReview}
      >
        Review
      </button>
    </div>
  )
}

function StatusLabel({ phase, compact = false }: { phase: MeetingPhase; compact?: boolean }) {
  if (phase === 'recording') return null

  const label = statusLabel(phase, compact)
  return <span className={`status ${statusClass(phase)}`}>{label}</span>
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }

  try {
    const serialized = JSON.stringify(error)
    if (serialized && serialized !== '{}') return serialized
  } catch {
    // Fall through to the generic message.
  }

  return 'Unknown error.'
}

async function realtimeCaptureOptions(
  settings: AppSettings,
  apiKeyRepository: ApiKeyRepository,
): Promise<AudioCaptureStartOptions> {
  const realtimeProvider = settings.realtimeTranscriptionProvider
  const keyProvider = providerKeyForRealtime(realtimeProvider)

  try {
    const hasApiKey = await apiKeyRepository.has(keyProvider)
    if (!hasApiKey) return {}
  } catch {
    return {}
  }

  return {
    realtimeProvider,
    realtimeModel: settings.realtimeModel,
  }
}

async function startMeetingSetupError(
  settings: AppSettings,
  apiKeyRepository: ApiKeyRepository,
): Promise<string | undefined> {
  if (!isTauriRuntime()) return undefined
  if (settings.transcriptionMode !== 'provider') return undefined

  const keyProvider = providerKeyForRealtime(settings.realtimeTranscriptionProvider)

  try {
    if (await apiKeyRepository.has(keyProvider)) return undefined
  } catch (error) {
    return `Cannot read ${providerLabel(keyProvider)} API key status: ${errorMessage(error)}`
  }

  return `Realtime transcript needs a ${providerLabel(keyProvider)} API key before recording.`
}

function upsertTranscriptLine(transcript: TranscriptLine[], line: TranscriptLine): TranscriptLine[] {
  const existingIndex = transcript.findIndex((existing) => existing.id === line.id)
  if (existingIndex >= 0) {
    return transcript.map((existing, index) => (index === existingIndex ? line : existing))
  }

  const revisionIndex = findTranscriptRevisionIndex(transcript, line)
  if (revisionIndex >= 0) {
    return transcript.map((existing, index) =>
      index === revisionIndex
        ? {
            ...existing,
            speaker: line.speaker || existing.speaker,
            text: longerTranscriptText(existing.text, line.text),
            partial: line.partial,
          }
        : existing,
    )
  }

  if (transcript.some((existing) => existing.text.trim() === line.text.trim() && existing.text.trim())) {
    return transcript
  }

  return [...transcript, line]
}

function findTranscriptRevisionIndex(transcript: TranscriptLine[], line: TranscriptLine): number {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const existing = transcript[index]
    if ((existing.partial || line.partial) && isTranscriptRevision(existing.text, line.text)) {
      return index
    }
  }

  return -1
}

function isTranscriptRevision(previous: string, next: string): boolean {
  const previousText = canonicalTranscriptText(previous)
  const nextText = canonicalTranscriptText(next)
  return (
    previousText.length >= 3 &&
    nextText.length >= 3 &&
    (nextText.startsWith(previousText) || previousText.startsWith(nextText))
  )
}

function canonicalTranscriptText(value: string): string {
  return Array.from(value.toLowerCase())
    .filter((character) => /[\p{Letter}\p{Number}]/u.test(character))
    .join('')
}

function longerTranscriptText(left: string, right: string): string {
  return canonicalTranscriptText(right).length >= canonicalTranscriptText(left).length ? right : left
}

function finalizeTranscriptLines(transcript: TranscriptLine[]): TranscriptLine[] {
  return transcript.map((line) => (line.partial ? { ...line, partial: false } : line))
}

function isNoActiveAudioCaptureError(error: unknown): boolean {
  return errorMessage(error).toLowerCase().includes('no active microphone recording')
}

function autoRows(value: string, minimum: number, charsPerLine: number): number {
  const hardLines = value.split('\n').length
  const softLines = Math.ceil(value.length / charsPerLine)
  return Math.max(minimum, hardLines, softLines || 1)
}

function formatDurationMillis(durationMillis: number): string {
  const totalSeconds = Math.max(0, Math.round(durationMillis / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (minutes === 0) return `${seconds}s`
  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
}

function formatClockDuration(durationMillis: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMillis / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}

function uniqueTranscriptSpeakers(transcript: TranscriptLine[]): string[] {
  return Array.from(new Set(transcript.map((line) => normalizeSpeakerName(line.speaker))))
}

function normalizeSpeakerName(value: string): string {
  return value.trim() || 'Speaker'
}

function audioTitleFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^/.]+$/, '').trim()
  return withoutExtension || 'Imported audio'
}

function nextTranscriptTime(time?: string): string {
  const [minutes = '0', seconds = '0'] = time?.split(':') ?? []
  const totalSeconds = Number(minutes) * 60 + Number(seconds) + 30
  if (!Number.isFinite(totalSeconds)) return '00:30'

  const nextMinutes = Math.floor(totalSeconds / 60)
  const nextSeconds = totalSeconds % 60
  return `${nextMinutes.toString().padStart(2, '0')}:${nextSeconds.toString().padStart(2, '0')}`
}

function defaultRealtimeModel(provider: RealtimeTranscriptionProviderId): string {
  if (provider === 'doubao-realtime') return 'bigmodel'
  if (provider === 'deepgram') return 'nova-3'
  if (provider === 'assemblyai') return 'universal-streaming'
  return 'gpt-realtime-whisper'
}

function defaultTranscriptionBaseUrl(provider: BatchTranscriptionProviderId): string {
  if (provider === 'groq') return 'https://api.groq.com/openai/v1'
  return 'https://api.openai.com/v1'
}

function defaultTranscriptionModel(provider: BatchTranscriptionProviderId): string {
  if (provider === 'groq') return 'whisper-large-v3-turbo'
  if (provider === 'doubao') return 'bigmodel'
  if (provider === 'openai-compatible') return 'whisper-1'
  return 'gpt-4o-mini-transcribe'
}

function defaultNotesBaseUrl(provider: AppSettings['aiProvider']): string {
  if (provider === 'groq') return 'https://api.groq.com/openai/v1'
  if (provider === 'openrouter') return 'https://openrouter.ai/api/v1'
  if (provider === 'ollama') return 'http://localhost:11434/v1'
  return 'https://api.openai.com/v1'
}

function defaultNotesModel(provider: AppSettings['aiProvider']): string {
  if (provider === 'groq') return 'llama-3.3-70b-versatile'
  if (provider === 'openrouter') return 'openai/gpt-4o-mini'
  if (provider === 'ollama') return 'llama3.1:8b'
  return 'gpt-4.1-mini'
}

function providerTestBaseUrl(provider: ApiProviderId, settings: AppSettings): string | undefined {
  if (provider === 'ollama') return settings.aiBaseUrl
  if (provider === 'openai-compatible') {
    return settings.aiProvider === 'openai-compatible'
      ? settings.aiBaseUrl
      : settings.transcriptionBaseUrl
  }
  return undefined
}

function recommendedApiKeyProvider(settings: AppSettings): ApiProviderId {
  return providerKeyForRealtime(settings.realtimeTranscriptionProvider)
}

function providerKeyForRealtime(provider: RealtimeTranscriptionProviderId): ApiProviderId {
  if (provider === 'doubao-realtime') return 'doubao'
  if (provider === 'deepgram') return 'deepgram'
  if (provider === 'assemblyai') return 'assemblyai'
  return 'openai'
}

function providerKeyForBatch(provider: BatchTranscriptionProviderId): ApiProviderId {
  return provider
}

function providerKeyForAiNotes(provider: AppSettings['aiProvider']): ApiProviderId | undefined {
  return provider === 'ollama' ? undefined : provider
}

function providerLabel(provider: string): string {
  if (provider === 'openai') return 'OpenAI'
  if (provider === 'openai-compatible') return 'Compatible'
  if (provider === 'openai-realtime') return 'OpenAI RT'
  if (provider === 'groq') return 'Groq'
  if (provider === 'openrouter') return 'OpenRouter'
  if (provider === 'doubao' || provider === 'doubao-realtime') return 'Doubao'
  if (provider === 'deepgram') return 'Deepgram'
  if (provider === 'assemblyai') return 'AssemblyAI'
  if (provider === 'ollama') return 'Ollama'
  if (provider === 'slack') return 'Slack'
  if (provider === 'notion') return 'Notion'
  if (provider === 'zoom') return 'Zoom'
  if (provider === 'teams') return 'Teams'
  return provider
}

function providerLogoText(provider: string): string {
  if (provider === 'openrouter') return 'OR'
  if (provider === 'openai-compatible') return '{}'
  if (provider === 'assemblyai') return 'A'
  if (provider === 'deepgram') return 'D'
  if (provider === 'doubao' || provider === 'doubao-realtime') return '豆'
  if (provider === 'slack') return '#'
  if (provider === 'notion') return 'N'
  if (provider === 'zoom') return 'Z'
  if (provider === 'teams') return 'T'
  return providerLabel(provider).slice(0, 2)
}

function brandClass(provider: string): string {
  return provider.replace(/[^a-z0-9]/gi, '-').toLowerCase()
}

function BrandLogo({ provider }: { provider: string }) {
  return (
    <span className={`brand-logo brand-${brandClass(provider)}`} aria-hidden="true">
      {providerLogoText(provider)}
    </span>
  )
}

function ApiKeySettingField({
  provider,
  configured,
  selected,
  draft,
  status,
  error,
  connectionStatus,
  connectionResult,
  onSelect,
  onDraftChange,
  onSave,
  onTest,
}: {
  provider?: ApiProviderId
  configured: boolean
  selected: boolean
  draft: string
  status: ApiKeyStatus
  error: string
  connectionStatus: ApiConnectionStatus
  connectionResult?: ProviderConnectionTestResult
  onSelect: () => void
  onDraftChange: (value: string) => void
  onSave: (provider?: ApiProviderId, draft?: string) => void | Promise<void>
  onTest: (provider?: ApiProviderId) => void | Promise<void>
}) {
  if (!provider) {
    return <p className="settings-hint">Local provider, no API key required.</p>
  }

  const inputId = `api-key-${provider}`
  const showStatus = selected
  const connectionStatusLabel =
    showStatus && connectionStatus === 'testing'
      ? 'Testing'
      : showStatus && connectionStatus === 'success'
        ? 'Connected'
        : showStatus && connectionStatus === 'error'
          ? 'Failed'
          : undefined

  return (
    <div className="api-key-setting">
      <div className="readonly-input api-key-input-row">
        <label htmlFor={inputId}>API Key</label>
        <div className="api-key-control">
          <input
            id={inputId}
            aria-label={`${providerLabel(provider)} API key`}
            type="password"
            value={selected ? draft : ''}
            placeholder={configured ? 'Stored locally' : `Enter ${providerLabel(provider)} key`}
            onFocus={onSelect}
            onChange={(event) => {
              if (!selected) onSelect()
              onDraftChange(event.target.value)
            }}
          />
          <button
            className="settings-action primary"
            onClick={() => onSave(provider, draft)}
            disabled={!selected || !draft.trim() || status === 'saving'}
          >
            {selected && status === 'saving' ? 'Saving' : 'Save'}
          </button>
          <button
            className="settings-action"
            onClick={() => onTest(provider)}
            disabled={selected && connectionStatus === 'testing'}
          >
            {selected && connectionStatus === 'testing' ? 'Testing' : 'Test'}
          </button>
        </div>
      </div>
      <div className="api-key-meta">
        <span className={`key-status ${configured ? 'configured' : ''}`}>
          {configured ? 'Configured' : 'Not configured'}
        </span>
        <span>Stored locally, outside normal settings.</span>
      </div>
      {showStatus && status === 'saved' ? (
        <p className="settings-connection success" role="status">
          Saved locally.
        </p>
      ) : null}
      {showStatus && status === 'error' ? (
        <p className="settings-error" role="alert">
          {error || 'Could not update API key.'}
        </p>
      ) : null}
      {connectionStatusLabel ? (
        <p
          className={`settings-connection ${connectionStatus}`}
          role={connectionStatus === 'error' ? 'alert' : 'status'}
        >
          {connectionStatusLabel}
          {connectionResult?.message ? `: ${connectionResult.message}` : ''}
        </p>
      ) : null}
    </div>
  )
}

function IntegrationTile({
  provider,
  title,
  description,
  status,
  children,
}: {
  provider: string
  title: string
  description: string
  status: string
  children?: React.ReactNode
}) {
  return (
    <div className="integration-tile">
      <div className="integration-head">
        <BrandLogo provider={provider} />
        <div>
          <strong>{title}</strong>
          <span>{status}</span>
        </div>
      </div>
      <p>{description}</p>
      {children ? <div className="integration-control">{children}</div> : null}
    </div>
  )
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field-group">
      <label>{label}</label>
      {children}
    </div>
  )
}

function SettingsSelect<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: Array<{ id: T; label: string }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <label className="readonly-input settings-select-row">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function SegmentedControl({
  left,
  right,
  value = 'left',
  onChange,
}: {
  left: string
  right: string
  value?: 'left' | 'right'
  onChange?: (value: 'left' | 'right') => void
}) {
  return (
    <div className="segmented">
      <button
        className={value === 'left' ? 'active jelly-nav-active' : ''}
        onClick={() => onChange?.('left')}
      >
        {left}
      </button>
      <button
        className={value === 'right' ? 'active jelly-nav-active' : ''}
        onClick={() => onChange?.('right')}
      >
        {right}
      </button>
    </div>
  )
}

function SettingsInput({
  label,
  value,
  type = 'text',
  readOnly = false,
  onChange,
}: {
  label: string
  value: string
  type?: 'text' | 'password'
  readOnly?: boolean
  onChange?: (value: string) => void
}) {
  return (
    <label className="readonly-input">
      <span>{label}</span>
      <input
        aria-label={label}
        type={type}
        value={value}
        readOnly={readOnly}
        onChange={(event) => onChange?.(event.target.value)}
      />
    </label>
  )
}

function ToggleRow({
  title,
  description,
  checked = true,
  onToggle,
}: {
  title: string
  description: string
  checked?: boolean
  onToggle?: () => void
}) {
  return (
    <div className="toggle-row">
      <div className="toggle-copy">
        <strong>{title}</strong>
        <span>{description}</span>
      </div>
      <button
        className={`toggle ${checked ? '' : 'off'}`}
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={onToggle}
        disabled={!onToggle}
      />
    </div>
  )
}

function latestRealMeeting(meetings: Meeting[]): Meeting | undefined {
  return meetings.find(
    (meeting) =>
      !isSeedMeeting(meeting) &&
      !isEmptyDraftMeeting(meeting) &&
      !isEmptyErrorMeeting(meeting) &&
      !isSourcelessGeneratedMeeting(meeting) &&
      !isLegacyLocalDemoGeneratedMeeting(meeting),
  )
}

function isSeedMeeting(meeting: Meeting): boolean {
  return demoMeetingIds.has(meeting.id)
}

function isEmptyDraftMeeting(meeting: Meeting): boolean {
  return (
    meeting.phase === 'draft' &&
    !meeting.manualNotes.trim() &&
    !meeting.transcript.length &&
    !meeting.aiNotes
  )
}

function isEmptyErrorMeeting(meeting: Meeting): boolean {
  return (
    meeting.phase === 'error' &&
    !meeting.manualNotes.trim() &&
    !meeting.transcript.length &&
    !meeting.aiNotes &&
    !meeting.rawAudio
  )
}

function isSourcelessGeneratedMeeting(meeting: Meeting): boolean {
  return Boolean(meeting.aiNotes) && !hasMeetingSourceMaterial(meeting)
}

function isLegacyLocalDemoGeneratedMeeting(meeting: Meeting): boolean {
  if (!meeting.aiNotes) return false

  const aiNotesText = [
    meeting.aiNotes.summary,
    meeting.aiNotes.document,
    meeting.aiNotes.followUpDraft,
    ...meeting.aiNotes.keyPoints,
    ...meeting.aiNotes.decisions,
    ...meeting.aiNotes.openQuestions,
    ...meeting.aiNotes.actionItems.map((item) => item.text),
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase()
  const transcriptText = meeting.transcript
    .map((line) => line.text)
    .join('\n')
    .toLowerCase()

  return (
    aiNotesText.includes('this local review confirms') ||
    aiNotesText.includes('local demo') ||
    transcriptText.includes('local demo transcript generated')
  )
}

function hasMeetingSourceMaterial(meeting: Meeting): boolean {
  return Boolean(meeting.manualNotes.trim() || meeting.transcript.length)
}

function formatTodayLabel(now = new Date()): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(now)
}

function statusLabel(phase: MeetingPhase, compact: boolean): string {
  if (phase === 'recording') return 'Recording'
  if (phase === 'ready') return 'Ready'
  if (phase === 'needs_review') return compact ? 'Review' : 'Needs review'
  if (phase === 'draft') return 'Draft'
  if (phase === 'generating_ai_notes') return 'Generating'
  if (phase === 'finalizing_transcript') return 'Finalizing'
  return 'Error'
}

function statusClass(phase: MeetingPhase): string {
  if (phase === 'recording') return 'recording'
  if (phase === 'ready') return 'ready'
  if (phase === 'needs_review') return 'warning'
  if (phase === 'error') return 'error'
  return ''
}

function meetingSubtitle(meeting: Meeting): string {
  if (meeting.phase === 'recording') return 'Focus: notes + live transcript'
  if (meeting.phase === 'ready') return 'Review: AI Notes + original transcript'
  if (meeting.phase === 'needs_review') return 'AI Notes ready, waiting for review'
  return 'Draft agenda from last notes'
}
