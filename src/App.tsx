import { type ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import {
  BookOpen,
  CircleUser,
  FileText,
  Home,
  Mic,
  Settings,
  Sparkles,
  Square,
} from 'lucide-react'
import {
  type ActionItem,
  type AiNotes,
  type Meeting,
  type MeetingPhase,
  type TranscriptLine,
  buildAiNotesContext,
  createDemoMeeting,
  getMeetingViewModel,
} from './domain/meeting'
import { type ApiKeyRepository, createMemoryApiKeyRepository } from './domain/apiKey'
import { createTauriApiKeyRepository } from './desktop/apiKeyRepository'
import { selectTauriAudioFile } from './desktop/audioImport'
import { exportMarkdownFile } from './desktop/markdownExport'
import { createTauriMeetingRepository } from './desktop/meetingRepository'
import { createTauriAppSettingsRepository } from './desktop/settingsRepository'
import { isTauriRuntime } from './desktop/tauri'
import { formatMeetingMarkdown } from './domain/markdown'
import {
  createAiNotesProvider,
  createTranscriptionProvider,
  isProviderConfigurationError,
} from './domain/providerFactory'
import { generateAiNotesForMeeting } from './domain/providers'
import {
  type AppSettings,
  type AppSettingsRepository,
  createBrowserAppSettingsRepository,
  loadBrowserAppSettings,
} from './domain/settings'
import { type AsyncMeetingRepository, createDefaultMeetingRepository } from './domain/storage'

type Route = 'today' | 'meeting' | 'library' | 'settings'
type SettingsPane = 'general' | 'audio' | 'ai' | 'exports' | 'about'
type AiGenerationStatus = 'idle' | 'generating' | 'configuration_error' | 'error'
type TranscriptionStatus = 'idle' | 'importing' | 'configuration_error' | 'error'
type ApiKeyStatus = 'idle' | 'saving' | 'saved' | 'deleted' | 'error'

interface AudioImportRequest {
  meetingId: string
  title: string
  file: File
}

const navItems = [
  { id: 'today' as const, label: 'Today', icon: Home },
  { id: 'meeting' as const, label: 'Meeting', icon: Mic },
  { id: 'library' as const, label: 'Library', icon: BookOpen },
  { id: 'settings' as const, label: 'Settings', icon: Settings },
]

const settingsItems = [
  { id: 'general' as const, label: 'General', icon: Settings },
  { id: 'audio' as const, label: 'Audio', icon: Mic },
  { id: 'ai' as const, label: 'AI', icon: Sparkles },
  { id: 'exports' as const, label: 'Exports', icon: FileText },
  { id: 'about' as const, label: 'About', icon: CircleUser },
]

const routeTitles: Record<Route, string> = {
  today: 'Today',
  meeting: 'Meeting',
  library: 'Library',
  settings: 'Settings',
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
    () => meetingRepository.get('product-sync-alex') ?? createDemoMeeting('recording'),
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
  const [apiKeyConfigured, setApiKeyConfigured] = useState(false)
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>('idle')
  const [apiKeyError, setApiKeyError] = useState('')
  const view = getMeetingViewModel(meeting)

  const meetings = useMemo(
    () => [
      meeting,
      createListMeeting('customer-acme', 'Customer call: Acme onboarding', 'needs_review'),
      createListMeeting('jamie-1on1', '1:1 with Jamie', 'draft'),
      createListMeeting('macos-audio', 'Bug triage: macOS audio', 'ready'),
    ],
    [meeting],
  )

  const updateSettings = (patch: Partial<AppSettings>) => {
    setAppSettings((current) => ({ ...current, ...patch }))
  }

  const startMeeting = () => {
    setMeeting(createDemoMeeting('recording'))
    setTranscriptionStatus('idle')
    setTranscriptionError('')
    setLastAudioImport(undefined)
    setAiGenerationStatus('idle')
    setAiGenerationError('')
    setRoute('meeting')
  }

  const stopRecording = () => {
    setMeeting((current) => ({
      ...createDemoMeeting('ready'),
      manualNotes: current.manualNotes,
    }))
    setTranscriptionStatus('idle')
    setTranscriptionError('')
    setLastAudioImport(undefined)
    setAiGenerationStatus('idle')
    setAiGenerationError('')
    setRoute('meeting')
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
      ...createDemoMeeting('error'),
      id: meetingId,
      title: 'Audio import',
      duration: '00:00',
      manualNotes: '',
      markers: [],
      transcript: [],
      aiNotes: undefined,
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
    const importedMeeting: Meeting = {
      ...createDemoMeeting('finalizing_transcript'),
      id: request.meetingId,
      title: request.title,
      duration: '00:00',
      phase: 'finalizing_transcript',
      manualNotes: '',
      markers: [],
      transcript: [],
      aiNotes: undefined,
    }

    setRoute('meeting')
    setMeeting(importedMeeting)
    setTranscriptionStatus('importing')
    setTranscriptionError('')
    setAiGenerationStatus('idle')
    setAiGenerationError('')

    try {
      const provider = createTranscriptionProvider(appSettings, apiKeyRepository)
      const transcript = await provider.transcribe({
        meetingId: request.meetingId,
        audioUri: request.file.name,
        audioFile: request.file,
        audioFileName: request.file.name,
      })

      setMeeting((current) =>
        current.id === request.meetingId
          ? {
              ...current,
              phase: 'needs_review',
              transcript,
            }
          : current,
      )
      setTranscriptionStatus('idle')
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
    setAiGenerationStatus('generating')
    setAiGenerationError('')

    try {
      const provider = createAiNotesProvider(appSettings, apiKeyRepository)
      const generatedMeeting = await generateAiNotesForMeeting(provider, meeting)
      setMeeting(generatedMeeting)
      setCopyStatus('idle')
      setExportStatus('idle')
      setAiGenerationStatus('idle')
    } catch (error) {
      setAiGenerationStatus(isProviderConfigurationError(error) ? 'configuration_error' : 'error')
      setAiGenerationError(errorMessage(error))
    }
  }

  const saveApiKey = async () => {
    setApiKeyStatus('saving')
    setApiKeyError('')

    try {
      await apiKeyRepository.save(appSettings.aiProvider, apiKeyDraft)
      setApiKeyDraft('')
      setApiKeyConfigured(true)
      setApiKeyStatus('saved')
    } catch (error) {
      setApiKeyStatus('error')
      setApiKeyError(errorMessage(error))
    }
  }

  const deleteApiKey = async () => {
    setApiKeyStatus('saving')
    setApiKeyError('')

    try {
      await apiKeyRepository.delete(appSettings.aiProvider)
      setApiKeyDraft('')
      setApiKeyConfigured(false)
      setApiKeyStatus('deleted')
    } catch (error) {
      setApiKeyStatus('error')
      setApiKeyError(errorMessage(error))
    }
  }

  const copyMarkdown = async () => {
    const markdown = formatMeetingMarkdown(meeting)

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
    const markdown = formatMeetingMarkdown(meeting)

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

  const updateAiNotes = (aiNotes: AiNotes) => {
    setMeeting((current) => ({
      ...current,
      aiNotes,
    }))
  }

  const updateTranscript = (transcript: TranscriptLine[]) => {
    setMeeting((current) => ({
      ...current,
      transcript,
    }))
  }

  useEffect(() => {
    let cancelled = false

    createTauriMeetingRepository().then(async (repository) => {
      if (cancelled || !repository) return

      setDesktopRepository(repository)
      setStorageMode('desktop')

      const savedMeeting = await repository.get('product-sync-alex')
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

    setApiKeyDraft('')
    setApiKeyStatus('idle')
    setApiKeyError('')

    apiKeyRepository
      .has(appSettings.aiProvider)
      .then((configured) => {
        if (!cancelled) setApiKeyConfigured(configured)
      })
      .catch((error) => {
        if (cancelled) return
        setApiKeyConfigured(false)
        setApiKeyStatus('error')
        setApiKeyError(errorMessage(error))
      })

    return () => {
      cancelled = true
    }
  }, [apiKeyRepository, appSettings.aiProvider])

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
            <input
              ref={audioImportInputRef}
              type="file"
              accept="audio/*,.m4a,.mp3,.mp4,.wav,.webm"
              hidden
              onChange={importAudioFile}
            />
            <button className="btn btn-primary" onClick={startMeeting}>
              Start Meeting
            </button>
          </div>
        </header>

        {route === 'today' && <TodayPage meetings={meetings} onOpenMeeting={() => setRoute('meeting')} />}
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
            onUpdateAiNotes={updateAiNotes}
            onUpdateTranscript={updateTranscript}
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
            apiKeyConfigured={apiKeyConfigured}
            apiKeyDraft={apiKeyDraft}
            apiKeyStatus={apiKeyStatus}
            apiKeyError={apiKeyError}
            onApiKeyDraftChange={setApiKeyDraft}
            onSaveApiKey={saveApiKey}
            onDeleteApiKey={deleteApiKey}
          />
        )}
      </main>
      <FloatingCapsule phase={meeting.phase} duration={meeting.duration} onStop={stopRecording} />
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
  return (
    <section className="content today-grid" aria-label="Today">
      <div className="pane jelly-card">
        <PaneHeader
          title="Today"
          subtitle="June 14, 2026"
          aside={<StatusLabel phase={meetings[0].phase} />}
        />
        <div className="meeting-list">
          {meetings.map((meeting) => (
            <button
              key={meeting.id}
              className={`meeting-row ${meeting.id === meetings[0].id ? 'selected' : ''}`}
              onClick={onOpenMeeting}
            >
              <time>{meeting.phase === 'recording' ? 'Live' : meeting.phase === 'ready' ? 'Ready' : '13:00'}</time>
              <span className="meeting-copy">
                <strong>{meeting.title}</strong>
                <small>{meetingSubtitle(meeting)}</small>
              </span>
              <StatusLabel phase={meeting.phase} compact />
            </button>
          ))}
        </div>
      </div>
      <aside className="pane jelly-card">
        <PaneHeader title="Current Meeting" subtitle="Mic + system audio" />
        <div className="summary-card">
          <h3>{meetings[0].title}</h3>
          <p>
            Focus keeps attention on your key notes while the right panel captures the live
            transcript. Review turns those notes and transcript into AI Notes after stop.
          </p>
        </div>
        <div className="marker-bar">
          <button>Decision</button>
          <button>Action</button>
          <button>Question</button>
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
  onUpdateAiNotes,
  onUpdateTranscript,
}: {
  meeting: Meeting
  view: ReturnType<typeof getMeetingViewModel>
  onStopRecording: () => void
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
  onUpdateAiNotes: (aiNotes: AiNotes) => void
  onUpdateTranscript: (transcript: TranscriptLine[]) => void
}) {
  const contextPreview = buildAiNotesContext(meeting)

  return (
    <section className="content meeting-layout" aria-label="Meeting">
      {view.mode === 'focus' ? (
        <>
          <ManualNotesPane meeting={meeting} onStopRecording={onStopRecording} />
          <TranscriptPane title="Live Transcript" subtitle="Realtime STT while recording" meeting={meeting} live />
        </>
      ) : (
        <>
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
            onUpdateAiNotes={onUpdateAiNotes}
            contextPreview={contextPreview}
          />
          <TranscriptPane
            title="Original Transcript"
            subtitle="Source for AI Notes"
            meeting={meeting}
            editable
            onUpdateTranscript={onUpdateTranscript}
          />
        </>
      )}
    </section>
  )
}

function ManualNotesPane({
  meeting,
  onStopRecording,
}: {
  meeting: Meeting
  onStopRecording: () => void
}) {
  return (
    <div className="pane jelly-card">
      <PaneHeader
        title={meeting.title}
        subtitle="Recording - Focus mode - Mic + system audio"
        aside={
          <div className="status-row">
            <ModeSwitch active="focus" />
            <StatusLabel phase={meeting.phase} />
          </div>
        }
      />
      <div className="editor-shell">
        <textarea className="note-editor" value={meeting.manualNotes} readOnly aria-label="Manual notes" />
      </div>
      <div className="marker-bar">
        {(['Decision', 'Action', 'Question', 'Quote'] as const).map((kind) => (
          <button key={kind}>{kind}</button>
        ))}
        <span className="bar-spacer" />
        <button className="stop-button" aria-label="Stop recording from meeting" onClick={onStopRecording}>
          Stop Recording
        </button>
      </div>
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
  onUpdateAiNotes,
  contextPreview,
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
  onUpdateAiNotes: (aiNotes: AiNotes) => void
  contextPreview: string
}) {
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
    meeting.transcript.length > 0 || Boolean(meeting.manualNotes.trim()) || meeting.markers.length > 0
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
  const emptyTitle = isImportingTranscript ? 'Importing Audio' : 'Generate AI Notes'
  const emptyCopy = isImportingTranscript
    ? 'Transcription is running through the configured STT provider.'
    : 'Use manual notes, markers, and finalized transcript to create the Review content.'
  const updateNotes = (patch: Partial<AiNotes>) => {
    if (!notes) return
    onUpdateAiNotes({ ...notes, ...patch })
  }

  return (
    <div className="pane jelly-card ai-main">
      <PaneHeader
        title={meeting.title}
        subtitle="Review mode - AI Notes generated from notes + transcript"
        aside={
          <div className="status-row">
            <ModeSwitch active="review" />
            <StatusLabel phase={meeting.phase} />
          </div>
        }
      />
      {notes ? (
        <div className="ai-notes" aria-label="AI Notes">
          {generationFailed ? (
            <div className="generation-alert" role="alert">
              <strong>AI Notes were not updated.</strong>
              <span>{generationErrorMessage}</span>
            </div>
          ) : null}
          <AiSection title="Summary">
            <AiTextArea
              label="AI summary"
              value={notes.summary}
              rows={3}
              onChange={(summary) => updateNotes({ summary })}
            />
          </AiSection>
          <EditableStringListSection
            title="Decisions"
            itemLabel="Decision"
            items={notes.decisions}
            onChange={(decisions) => updateNotes({ decisions })}
          />
          <EditableActionItemsSection
            items={notes.actionItems}
            onChange={(actionItems) => updateNotes({ actionItems })}
          />
          <EditableStringListSection
            title="Open Questions"
            itemLabel="Open question"
            items={notes.openQuestions}
            onChange={(openQuestions) => updateNotes({ openQuestions })}
          />
          <EditableStringListSection
            title="Key Points"
            itemLabel="Key point"
            items={notes.keyPoints}
            onChange={(keyPoints) => updateNotes({ keyPoints })}
          />
          <AiSection title="Follow-up Draft">
            <AiTextArea
              label="Follow-up draft"
              value={notes.followUpDraft}
              rows={4}
              onChange={(followUpDraft) => updateNotes({ followUpDraft })}
            />
          </AiSection>
          <details className="context-preview">
            <summary>Generation context</summary>
            <pre>{contextPreview}</pre>
          </details>
        </div>
      ) : (
        <div className="empty-generation">
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
      )}
      <div className="marker-bar">
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

function TranscriptPane({
  title,
  subtitle,
  meeting,
  live = false,
  editable = false,
  onUpdateTranscript,
}: {
  title: string
  subtitle: string
  meeting: Meeting
  live?: boolean
  editable?: boolean
  onUpdateTranscript?: (transcript: TranscriptLine[]) => void
}) {
  const updateLine = (index: number, patch: Partial<TranscriptLine>) => {
    onUpdateTranscript?.(
      meeting.transcript.map((line, lineIndex) =>
        lineIndex === index ? { ...line, ...patch } : line,
      ),
    )
  }

  return (
    <aside className="pane jelly-card transcript-pane" aria-label={title}>
      <PaneHeader title={title} subtitle={subtitle} aside={live ? <span className="chip">Live</span> : <span className="chip">Source</span>} />
      <div className="transcript-list">
        {meeting.transcript.map((line, index) =>
          editable ? (
            <div key={line.id} className="transcript-line transcript-edit-line">
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
                  rows={2}
                  value={line.text}
                  onChange={(event) => updateLine(index, { text: event.target.value })}
                />
              </div>
            </div>
          ) : (
            <div key={line.id} className="transcript-line">
              <time>{line.time}</time>
              <p>
                <strong>{line.speaker}:</strong> {line.text}
              </p>
            </div>
          ),
        )}
      </div>
    </aside>
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
  apiKeyConfigured,
  apiKeyDraft,
  apiKeyStatus,
  apiKeyError,
  onApiKeyDraftChange,
  onSaveApiKey,
  onDeleteApiKey,
}: {
  activePane: SettingsPane
  settings: AppSettings
  storageMode: 'browser' | 'desktop'
  onSelectPane: (pane: SettingsPane) => void
  onUpdateSettings: (patch: Partial<AppSettings>) => void
  apiKeyConfigured: boolean
  apiKeyDraft: string
  apiKeyStatus: ApiKeyStatus
  apiKeyError: string
  onApiKeyDraftChange: (value: string) => void
  onSaveApiKey: () => void | Promise<void>
  onDeleteApiKey: () => void | Promise<void>
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
          apiKeyConfigured={apiKeyConfigured}
          apiKeyDraft={apiKeyDraft}
          apiKeyStatus={apiKeyStatus}
          apiKeyError={apiKeyError}
          onApiKeyDraftChange={onApiKeyDraftChange}
          onSaveApiKey={onSaveApiKey}
          onDeleteApiKey={onDeleteApiKey}
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
  apiKeyConfigured,
  apiKeyDraft,
  apiKeyStatus,
  apiKeyError,
  onApiKeyDraftChange,
  onSaveApiKey,
  onDeleteApiKey,
}: {
  activePane: SettingsPane
  settings: AppSettings
  storageMode: 'browser' | 'desktop'
  onUpdateSettings: (patch: Partial<AppSettings>) => void
  apiKeyConfigured: boolean
  apiKeyDraft: string
  apiKeyStatus: ApiKeyStatus
  apiKeyError: string
  onApiKeyDraftChange: (value: string) => void
  onSaveApiKey: () => void | Promise<void>
  onDeleteApiKey: () => void | Promise<void>
}) {
  if (activePane === 'audio') {
    return (
      <div className="settings-form">
        <FieldGroup label="Capture source">
          <SegmentedControl
            left="Mic + System"
            right="Microphone Only"
            value={settings.captureSource === 'mic-system' ? 'left' : 'right'}
            onChange={(value) =>
              onUpdateSettings({ captureSource: value === 'left' ? 'mic-system' : 'microphone-only' })
            }
          />
        </FieldGroup>
        <FieldGroup label="System audio">
          <ToggleRow
            title="ScreenCaptureKit"
            description="macOS system audio capture target."
            checked={settings.systemAudioEnabled}
            onToggle={() => onUpdateSettings({ systemAudioEnabled: !settings.systemAudioEnabled })}
          />
          <ToggleRow
            title="Save raw audio"
            description="Off by default after transcription."
            checked={settings.saveRawAudio}
            onToggle={() => onUpdateSettings({ saveRawAudio: !settings.saveRawAudio })}
          />
        </FieldGroup>
      </div>
    )
  }

  if (activePane === 'ai') {
    return (
      <div className="settings-form">
        <FieldGroup label="Provider">
          <SegmentedControl
            left="OpenAI Compatible"
            right="Ollama"
            value={settings.aiProvider === 'openai-compatible' ? 'left' : 'right'}
            onChange={(value) =>
              onUpdateSettings({ aiProvider: value === 'left' ? 'openai-compatible' : 'ollama' })
            }
          />
        </FieldGroup>
        <FieldGroup label="Connection">
          <SettingsInput
            label="Base URL"
            value={settings.aiBaseUrl}
            onChange={(aiBaseUrl) => onUpdateSettings({ aiBaseUrl })}
          />
          <SettingsInput
            label="STT model"
            value={settings.sttModel}
            onChange={(sttModel) => onUpdateSettings({ sttModel })}
          />
          <SettingsInput
            label="Notes model"
            value={settings.notesModel}
            onChange={(notesModel) => onUpdateSettings({ notesModel })}
          />
        </FieldGroup>
        <FieldGroup label="Keys">
          <ToggleRow
            title="Use OS keychain"
            description="API keys stay outside meeting records."
            checked={settings.useKeychain}
            onToggle={() => onUpdateSettings({ useKeychain: !settings.useKeychain })}
          />
          <SettingsInput
            label="API key"
            type="password"
            value={apiKeyDraft}
            onChange={onApiKeyDraftChange}
          />
          <div className="key-actions">
            <span className={`key-status ${apiKeyConfigured ? 'configured' : ''}`}>
              {apiKeyConfigured ? 'Configured' : 'Not configured'}
            </span>
            <button className="settings-action" onClick={onSaveApiKey} disabled={apiKeyStatus === 'saving'}>
              {apiKeyStatus === 'saving' ? 'Saving' : 'Save Key'}
            </button>
            <button
              className="settings-action"
              onClick={onDeleteApiKey}
              disabled={!apiKeyConfigured || apiKeyStatus === 'saving'}
            >
              Delete Key
            </button>
          </div>
          {apiKeyStatus === 'error' ? (
            <p className="settings-error" role="alert">
              {apiKeyError || 'Could not update API key.'}
            </p>
          ) : null}
        </FieldGroup>
      </div>
    )
  }

  if (activePane === 'exports') {
    return (
      <div className="settings-form">
        <FieldGroup label="Markdown">
          <SettingsInput
            label="Default folder"
            value={settings.exportFolder}
            onChange={(exportFolder) => onUpdateSettings({ exportFolder })}
          />
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
          <SettingsInput
            label="Slack"
            value={settings.slackWebhookLabel}
            onChange={(slackWebhookLabel) => onUpdateSettings({ slackWebhookLabel })}
          />
          <SettingsInput
            label="Notion"
            value={settings.notionExportLabel}
            onChange={(notionExportLabel) => onUpdateSettings({ notionExportLabel })}
          />
        </FieldGroup>
      </div>
    )
  }

  if (activePane === 'about') {
    return (
      <div className="settings-form">
        <FieldGroup label="Build">
          <SettingsInput
            label="Storage"
            value={storageMode === 'desktop' ? 'SQLite app data' : 'Browser storage'}
            readOnly
          />
          <SettingsInput label="License" value="MIT" readOnly />
        </FieldGroup>
      </div>
    )
  }

  return (
    <div className="settings-form">
      <FieldGroup label="Capture mode">
        <SegmentedControl
          left="Mic + System"
          right="Microphone Only"
          value={settings.captureSource === 'mic-system' ? 'left' : 'right'}
          onChange={(value) =>
            onUpdateSettings({ captureSource: value === 'left' ? 'mic-system' : 'microphone-only' })
          }
        />
      </FieldGroup>
      <FieldGroup label="Meeting mode">
        <SegmentedControl
          left="Focus First"
          right="Split View"
          value={settings.meetingPreference === 'focus-first' ? 'left' : 'right'}
          onChange={(value) =>
            onUpdateSettings({ meetingPreference: value === 'left' ? 'focus-first' : 'split-view' })
          }
        />
      </FieldGroup>
      <FieldGroup label="Privacy">
        <ToggleRow
          title="Local notes"
          description="Meetings stay on this device unless exported."
          checked
        />
        <ToggleRow
          title="Hide transcript by default in Review"
          description="AI Notes are primary; transcript stays as source."
          checked={settings.hideTranscriptByDefault}
          onToggle={() => onUpdateSettings({ hideTranscriptByDefault: !settings.hideTranscriptByDefault })}
        />
        <ToggleRow
          title="No public links"
          description="Sharing starts private."
          checked={settings.noPublicLinks}
          onToggle={() => onUpdateSettings({ noPublicLinks: !settings.noPublicLinks })}
        />
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

function ModeSwitch({ active }: { active: 'focus' | 'review' }) {
  return (
    <div className="mode-switch" aria-label="Meeting mode">
      <button className={active === 'focus' ? 'active jelly-nav-active' : ''}>Focus</button>
      <button className={active === 'review' ? 'active jelly-nav-active' : ''}>Review</button>
    </div>
  )
}

function AiSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="ai-section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function AiTextArea({
  label,
  value,
  rows = 2,
  onChange,
  onBlur,
}: {
  label: string
  value: string
  rows?: number
  onChange: (value: string) => void
  onBlur?: () => void
}) {
  return (
    <textarea
      className="ai-edit-field"
      aria-label={label}
      rows={rows}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onBlur}
    />
  )
}

function EditableStringListSection({
  title,
  itemLabel,
  items,
  onChange,
}: {
  title: string
  itemLabel: string
  items: string[]
  onChange: (items: string[]) => void
}) {
  const visibleItems = items.length ? items : ['']

  const updateItem = (index: number, value: string) => {
    onChange(visibleItems.map((item, itemIndex) => (itemIndex === index ? value : item)))
  }
  const compactItems = () => {
    onChange(visibleItems.map((item) => item.trim()).filter(Boolean))
  }

  return (
    <AiSection title={title}>
      <div className="editable-list">
        {visibleItems.map((item, index) => (
          <AiTextArea
            key={`${itemLabel}-${index}`}
            label={`${itemLabel} ${index + 1}`}
            value={item}
            rows={1}
            onChange={(value) => updateItem(index, value)}
            onBlur={compactItems}
          />
        ))}
        <button className="inline-add" onClick={() => onChange([...items, ''])}>
          Add
        </button>
      </div>
    </AiSection>
  )
}

function EditableActionItemsSection({
  items,
  onChange,
}: {
  items: ActionItem[]
  onChange: (items: ActionItem[]) => void
}) {
  const visibleItems = items.length ? items : [{ id: 'a1', text: '' }]

  const updateItem = (index: number, patch: Partial<ActionItem>) => {
    onChange(
      visibleItems.map((item, itemIndex) =>
        itemIndex === index ? normalizeActionItem({ ...item, ...patch }, index) : item,
      ),
    )
  }
  const compactItems = () => {
    onChange(
      visibleItems
        .map((item, index) => normalizeActionItem(item, index))
        .filter((item) => item.text.trim()),
    )
  }

  return (
    <AiSection title="Action Items">
      <div className="editable-list">
        {visibleItems.map((item, index) => (
          <div className="action-edit-row" key={item.id || `action-${index}`}>
            <AiTextArea
              label={`Action item ${index + 1}`}
              value={item.text}
              rows={2}
              onChange={(text) => updateItem(index, { text })}
              onBlur={compactItems}
            />
            <input
              className="ai-edit-input"
              aria-label={`Action owner ${index + 1}`}
              value={item.owner ?? ''}
              onChange={(event) => updateItem(index, { owner: event.target.value })}
              onBlur={compactItems}
            />
          </div>
        ))}
        <button
          className="inline-add"
          onClick={() => onChange([...items, { id: `a${items.length + 1}`, text: '' }])}
        >
          Add
        </button>
      </div>
    </AiSection>
  )
}

function normalizeActionItem(item: ActionItem, index: number): ActionItem {
  return {
    id: item.id || `a${index + 1}`,
    text: item.text,
    owner: item.owner?.trim() ? item.owner : undefined,
    due: item.due?.trim() ? item.due : undefined,
  }
}

function StatusLabel({ phase, compact = false }: { phase: MeetingPhase; compact?: boolean }) {
  const label = statusLabel(phase, compact)
  return <span className={`status ${statusClass(phase)}`}>{label}</span>
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error.'
}

function audioTitleFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^/.]+$/, '').trim()
  return withoutExtension || 'Imported audio'
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field-group">
      <label>{label}</label>
      {children}
    </div>
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

function FloatingCapsule({
  phase,
  duration,
  onStop,
}: {
  phase: MeetingPhase
  duration: string
  onStop: () => void
}) {
  const recording = phase === 'recording'

  return (
    <div className={`floating-capsule ${recording ? 'jelly-capsule-active' : 'jelly-capsule ready'}`}>
      <span className="pulse-dot" />
      {recording ? (
        <div className="waveform" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      ) : null}
      <span>{recording ? duration : phase === 'ready' ? 'AI Notes Ready' : 'Idle'}</span>
      <span className="capsule-spacer" />
      {recording ? (
        <>
          <button className="capsule-btn" aria-label="Add marker">
            +
          </button>
          <button className="capsule-btn" aria-label="Stop recording" onClick={onStop}>
            <Square size={10} />
          </button>
        </>
      ) : null}
    </div>
  )
}

function createListMeeting(id: string, title: string, phase: MeetingPhase): Meeting {
  return {
    ...createDemoMeeting(phase),
    id,
    title,
  }
}

function statusLabel(phase: MeetingPhase, compact: boolean): string {
  if (phase === 'recording') return compact ? '12:48' : 'Recording 12:48'
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
