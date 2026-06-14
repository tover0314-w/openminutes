# OpenMinutes Product Spec

Date: 2026-06-14
Status: Accepted UI direction plus initial implementation contract
License: MIT

## 1. Executive Summary

OpenMinutes is an open-source, local-first AI meeting notepad for people who want useful meeting outcomes without inviting a bot into every call. It captures microphone and system audio on the user's desktop, lets the user add lightweight notes and markers during the meeting, then turns the meeting into summaries, decisions, action items, follow-ups, and exportable work artifacts.

This is a separate product from OpenTypeless, but it should share compatible engineering patterns so selected modules can later be merged back into OpenTypeless. The first product should feel much simpler than OpenTypeless: fewer screens, less configuration visible up front, and a quiet meeting-focused workspace.

## 2. Product Positioning

### One-line Positioning

Open-source, local-first AI meeting notes.

### Customer Promise

Stay present in meetings. Keep rough notes. Get finished, actionable meeting notes afterward.

### Differentiation

1. Local-first by default.
2. MIT open source.
3. No meeting bot by default.
4. BYOK and self-host friendly.
5. Private sharing by default.
6. No model training by default.
7. Minimal UI, not a productivity dashboard.
8. Compatible with a future OpenTypeless merge path.

## 3. Target Users

### Primary Users

1. Founders and indie hackers
   - Have many customer calls, sales calls, investor calls, and product discussions.
   - Need follow-ups, decisions, and action items quickly.
   - Care about low cost and privacy.

2. Product managers and builders
   - Need clean notes from product syncs, user interviews, roadmap calls, and bug triage.
   - Need to turn conversations into PRDs, GitHub issues, Slack updates, and decisions.

3. Consultants and solo operators
   - Need reusable notes, client follow-ups, and project memory.
   - Often cannot invite random bots into client meetings.

### Secondary Users

1. Developers who want a local-first meeting assistant.
2. Teams that want self-hostable meeting notes later.
3. Open-source users who distrust closed meeting recorders.

## 4. Problem Statement

People already have meeting audio, but they lose value after the call. They either take incomplete notes, spend time rewriting notes afterward, or use bot-based tools that can feel intrusive, privacy-sensitive, or difficult to approve in work meetings.

The painful moments:

1. During meetings, taking detailed notes distracts from the conversation.
2. After meetings, raw transcripts are too long and rarely useful.
3. Action items get lost or are not assigned clearly.
4. Follow-up emails and Slack updates are repetitive.
5. Users do not want a bot to visibly join every meeting.
6. Sensitive meetings require stronger local-first privacy defaults.

## 5. Core Product Principles

1. Capture quietly, never surprise the user.
2. Keep the meeting UI calmer than the meeting itself.
3. Let users guide the AI with rough notes and markers.
4. Show finished notes first, transcript second.
5. Make exports explicit and previewable.
6. Treat privacy as a product feature, not a settings footnote.
7. Avoid deep integrations until the core note quality is excellent.
8. Preserve an architectural path back to OpenTypeless.

## 6. MVP Scope

### In Scope

1. Manual meeting creation.
2. macOS-first meeting capture.
3. Microphone capture.
4. System audio capture architecture.
5. Meeting recording state.
6. Live notes editor.
7. Markers: Decision, Action, Question, Quote.
8. Stop meeting and enhance notes.
9. AI-generated output:
   - Summary
   - Decisions
   - Action items
   - Open questions
   - Follow-up draft
   - Transcript access
10. Recipes:
   - Follow-up email
   - Slack update
   - PRD draft
   - GitHub issue
   - Customer pain points
   - Weekly summary
11. Local meeting library.
12. Markdown copy/export.
13. Notion page export placeholder.
14. Slack webhook export placeholder.
15. Settings for audio, AI provider, privacy, and exports.

### Out of Scope for MVP

1. Calendar auto-join.
2. Bot joining meetings.
3. Full team workspace.
4. CRM integrations.
5. Speaker diarization as a required feature.
6. Real-time AI note generation.
7. Mobile app.
8. Public sharing links.
9. Cloud sync by default.
10. Windows/Linux full parity in v1.

## 7. Desktop UI Direction

Revision 2 decision:

OpenMinutes is a desktop app, not a website. The product may be independent, but its design tokens and desktop interaction language must stay compatible with OpenTypeless.

### 7.1 Token Compatibility

Use OpenTypeless design tokens as the baseline:

| Token category | OpenTypeless baseline | OpenMinutes usage |
| --- | --- | --- |
| App background | `#f5f5f5` | Main desktop window background |
| Secondary surface | `#ebebeb` | Input fields, inactive controls |
| Tertiary surface | `#e0e0e0` | Segmented control rails, subtle dividers |
| Elevated surface | `#fafafa` | Window/title surfaces where needed |
| Primary text | `#1a1a1a` | Main copy |
| Secondary text | `#666666` | Metadata, helper labels |
| Tertiary text | `#999999` | Section labels and empty states |
| Accent | `#2abba7` | Active nav, primary actions, progress |
| Accent hover | `#22a08e` | Hover/pressed primary actions |
| Success | `#34c759` | Ready/exported states |
| Warning | `#ff9500` | Needs review/attention states |
| Error | `#ff3b30` | Recording stop/error states |
| Border | `rgba(0,0,0,0.08)` | Hairline borders |
| Radius xs/sm | `6px / 10px` | Inputs, rows, controls |
| Radius md/lg | `14px / 22px` | Jelly buttons and feature panels |
| Radius full | `9999px` | Capsule, segmented pills, status pills |

Rules:

1. Reuse OpenTypeless CSS variable names when possible.
2. Reuse `jelly-surface-flat`, `jelly-card`, `jelly-btn`, `jelly-btn-accent`, `jelly-capsule`, and `jelly-capsule-active` concepts.
3. Keep the accent color `#2abba7`; do not introduce a separate product palette unless there is a strong reason.
4. Use the same density as OpenTypeless: 13px labels, 15px body, 17px panel headings, 22px title scale.
5. Prefer desktop panes, inspectors, segmented controls, toggles, sliders, and compact rows over web-style cards and marketing sections.

### 7.2 Product Structure

The app should have four desktop areas:

1. Today
   - Start meeting
   - Today's meetings
   - Draft/review states

2. Meeting
   - Live notes
   - Recording status
   - Markers
   - Focus mode during recording
   - Review mode after recording
   - Live Transcript during recording
   - AI Notes after recording stops

3. Library
   - Search past meetings
   - Filter by date, project, person, template

4. Settings
   - Audio
   - AI provider
   - Privacy
   - Integrations

The outer frame should use a compact OpenTypeless-style desktop sidebar, not a website top navigation bar. The sidebar is acceptable because it is part of the existing desktop app pattern; what we must avoid is a SaaS dashboard feeling.

### 7.3 Desktop Window Model

Use a native-desktop mental model:

1. Main window
   - Left sidebar: Today, Meeting, Library, Settings.
   - Main pane: current meeting or selected list.
   - Optional right inspector: AI note, exports, transcript.

2. Floating capsule
   - Separate capture surface.
   - Uses OpenTypeless jelly capsule states.
   - Remains visible when the main window is closed or minimized.

3. Preferences
   - Use the same two-column settings structure as OpenTypeless.
   - First column: app navigation.
   - Second column inside Settings: General, Audio, AI, Exports, About.
   - Right pane: selected settings content.
   - Avoid web account/admin page patterns.

4. Meeting mode
   - Meeting is one sidebar destination.
   - Focus and Review are modes inside Meeting, not separate app-level navigation items.
   - Default during recording is Focus.
   - After recording stops, the app moves to Review.
   - The transcript is visible during recording and secondary after AI Notes are generated.

### 7.4 Accepted UI Prototype

Accepted review prototype:

1. `prototypes/desktop-ui.html`
2. Recording screenshot: `output/openminutes-v3-recording-transcript.png`
3. Review screenshot: `output/openminutes-v3-review-ai-notes.png`
4. Settings screenshot: `output/openminutes-v3-settings-two-column.png`

Accepted UI decisions:

1. Keep OpenTypeless-compatible design tokens.
2. Keep the desktop sidebar and jelly active states.
3. Keep Settings as two columns, matching OpenTypeless.
4. Remove Focus as a separate sidebar destination.
5. Keep one Meeting destination with Focus and Review modes.
6. During recording, the main pane is manual notes and the right inspector is Live Transcript.
7. After recording stops, Review's main pane is AI Notes and the right inspector is Original Transcript.

Initial implementation:

1. React/Vite/TypeScript app in `src/`.
2. Tauri v2 shell in `src-tauri/`.
3. Meeting state rules in `src/domain/meeting.ts`.
4. Unit/UI tests verify Focus/Review, transcript, AI Notes, and Settings behavior.

## 8. UI Flow

### 8.0 UI Baseline

Do not copy Granola's visual identity. The product can learn from the workflow, but the UI language should feel like an OpenTypeless sibling:

1. Neutral jelly surfaces.
2. Compact desktop sidebar.
3. Accent active states.
4. Floating capsule as the strongest visual anchor.
5. Local-first privacy visible in preferences and capture state, not as marketing text.
6. No website-style top navigation.
7. No hero sections.
8. No large explanatory cards on first screen.
9. No separate one-off design token set.

### 8.1 First Launch

Goal: Get to the first meeting quickly.

Steps:

1. Welcome
   - "Open-source AI meeting notes, local-first by default."

2. Privacy defaults
   - Notes stay local by default.
   - No public links by default.
   - No model training by default.

3. Audio mode
   - Microphone only
   - Microphone + system audio

4. AI provider
   - OpenAI compatible
   - Ollama/local
   - Configure later

5. Finish
   - Start first meeting

### 8.2 Today

Primary action: Start Meeting.

UI:

```text
Today

[ Start Meeting ]

10:30  Product Sync          Ready
13:00  Customer Call         Needs review
15:30  1:1 with Alex         Draft
```

States:

1. Draft: Meeting exists but not recorded/enhanced.
2. Recording: Active capture.
3. Processing: STT/AI is running.
4. Ready: AI note generated.
5. Needs review: AI note generated but user has not accepted/exported.

### 8.3 New Meeting

Use a compact sheet, not a full page.

Fields:

1. Title
2. Template
3. Audio source
4. Optional participants

Templates:

1. General
2. 1:1
3. Product sync
4. Customer call
5. User interview
6. Standup
7. Bug triage
8. Hiring interview

### 8.4 Meeting Room

The meeting room is the product's core experience.

Focus layout:

```text
Product Sync                    Recording 12:48

Manual Notes                    Live Transcript
- typed key notes               Realtime STT while recording
- markers                       Raw, updating text
- decisions
- questions
```

Review layout:

```text
Product Sync                    Ready

AI Notes                        Original Transcript
- summary                       Raw transcript source
- decisions                     Timestamped lines
- action items
- follow-up draft
```

Focus main pane:

1. Notes editor.
2. Marker buttons:
   - Decision
   - Action
   - Question
   - Quote
3. Voice marker timeline.
4. Recording status.

Focus right panel:

1. During recording:
   - Show Live Transcript from realtime STT.
   - Do not label this panel "AI Note".
   - Do not show generated summaries as if they are final.

Review main pane:

1. Show AI Notes as the primary content.
2. AI Notes are generated from:
   - Manual notes
   - Markers
   - Finalized transcript
   - Template instructions
3. AI Notes sections:
   - Summary
   - Decisions
   - Action items
   - Open questions
   - Key points
   - Follow-up draft

Review right panel:

1. Show Original Transcript as source material.
2. Keep transcript timestamped and searchable.
3. Allow transcript collapse, but keep it available for trust/review.
4. Do not put AI Notes in the right panel; AI Notes are the main Review content.

Important UX decision:

Do not generate AI notes live in MVP. Live generation adds complexity, cost, and risk. Meeting quality is better if the app enhances after stop. During recording, realtime output means transcription only, not final AI notes.

### 8.4.1 Meeting Modes: Focus vs Review

Meeting has one app-level entry in the sidebar. Focus and Review are internal states of the selected meeting.

| Dimension | Focus | Review |
| --- | --- | --- |
| When used | During recording | After recording stops |
| Primary job | Help the user stay present | Help the user finish useful meeting output |
| Main pane | Manual notes, markers, rough thoughts | AI Notes generated from notes + transcript |
| Right pane | Live Transcript | Original Transcript / Source |
| Transcript | Realtime raw transcript | Finalized original transcript |
| AI summary | Not shown | Shown after generation |
| Primary actions | Add marker, type note, stop recording | Edit AI Notes, regenerate, copy Markdown, export |
| Capsule state | Recording timer and controls | Ready/idle state |
| User mental model | "Capture the meeting without distraction" | "Turn the meeting into decisions and follow-up" |

Focus mode rules:

1. Focus starts automatically when the user starts recording.
2. Focus must not show final AI sections such as Summary, Decisions, Action Items, or Follow-up.
3. Focus can show realtime transcript because transcript is raw capture, not final AI output.
4. Focus should keep visual weight on the manual note editor.
5. The user can add markers from the marker bar or capsule.
6. The user can switch the internal mode control to Review only after the meeting has stopped or when viewing an already completed meeting.
7. If realtime transcription fails, Focus remains usable with manual notes and markers; the transcript panel shows a short error or reconnect state.

Review mode rules:

1. Review starts automatically after recording stops and transcript finalization completes.
2. Review's main content is AI Notes.
3. If AI generation is automatic, Review opens with AI Notes ready.
4. If AI generation is manual, Review opens with a Generate AI Notes action in the main pane.
5. Review must clearly separate AI Notes from raw transcript.
6. Transcript belongs in the right source panel, not the main Review content.
7. Export actions live in Review, not Focus.
8. Review is where the user accepts, edits, copies, regenerates, or exports meeting output.

State transition:

```text
Draft meeting
  -> Start Recording
Recording / Focus
  -> Stop Recording
Processing transcript
  -> Transcript finalized
Review / Generate or show AI Notes
  -> Export / copy / archive
```

Implementation states:

1. `draft`: meeting exists, recording has not started.
2. `recording`: audio capture active; UI mode is Focus; inspector shows Live Transcript.
3. `finalizing_transcript`: recording stopped; transcript chunks are being merged, deduped, and punctuated.
4. `generating_ai_notes`: AI summary/decisions/actions/follow-up are being generated.
5. `ready`: AI Notes are available; UI mode is Review.
6. `needs_review`: AI Notes are available but the user has not accepted/exported.
7. `error`: recording, transcript, or AI generation failed; preserve manual notes and partial transcript.

Default behavior:

1. New meeting opens in Focus when recording starts.
2. Completed meeting opens in Review.
3. Sidebar only shows Meeting, not Focus.
4. The mode switch inside Meeting can show Focus and Review, but disabled/unavailable states must be clear.
5. Live Transcript is never called AI Notes.
6. In Review, AI Notes are the main content and Original Transcript is the right-side source panel.

### 8.4.2 Review Workspace vs AI Notes

Review is the post-meeting mode for editing and approving AI Notes. In normal use, the content the user reviews is the AI Notes result.

Review workspace content:

1. Meeting metadata
   - Title
   - Date/time
   - Duration
   - Participants, if known
   - Template
   - Capture source

2. User-owned source material
   - Manual notes written during Focus
   - Markers: Decision, Action, Question, Quote
   - Final transcript
   - Optional audio reference, if user chose to save audio

3. Main generated content
   - AI Notes

4. Review actions
   - Generate/regenerate AI Notes
   - Edit AI Notes
   - Open/collapse transcript
   - Copy Markdown
   - Export to Notion or Slack
   - Mark as reviewed

5. Secondary generated content
   - Recipe outputs
   - Alternate follow-up drafts
   - Template-specific derived artifacts

AI Notes content:

1. Summary
   - Short meeting overview.
   - What changed or was agreed.

2. Decisions
   - Explicit decisions made in the meeting.
   - Include owner or rationale when present.

3. Action items
   - Task
   - Owner, if identifiable
   - Due date, if mentioned
   - Source marker or transcript reference when possible

4. Open questions
   - Questions that remain unresolved.
   - Questions that need follow-up outside the meeting.

5. Key points
   - Important discussion points that are not decisions or tasks.

6. Follow-up draft
   - A ready-to-edit message for email, Slack, or Notion.

7. Optional template sections
   - Customer pain points for customer calls.
   - PRD notes for product syncs.
   - Risks/blockers for project meetings.
   - Interview signal for hiring calls.

Rules:

1. Review can exist before AI Notes are generated.
2. AI Notes cannot exist before transcript finalization.
3. AI Notes should be editable or regeneratable, but the raw transcript and manual notes remain preserved.
4. Export defaults to AI Notes, with transcript included only when the user explicitly selects it.
5. Manual notes and markers should influence AI Notes generation more strongly than raw transcript text.
6. The right panel in Review is the original transcript/source, not AI Notes.
7. If there is not enough transcript, AI Notes can still be generated from manual notes and markers, but the UI must show that source confidence is lower.

### 8.5 Capsule / Floating Pill

The floating pill should be compatible with OpenTypeless but simpler.

Collapsed:

```text
● 12:48
```

Expanded:

```text
● Recording 12:48    [Pause] [Marker] [Stop]
```

Marker menu:

```text
Decision
Action
Question
Quote
```

Rules:

1. The pill never shows long transcript text.
2. The pill does not replace the meeting room.
3. The pill only controls capture and markers.
4. If the user closes the main window, recording state remains visible.

### 8.6 Enhance Notes

After stopping, the app leaves Focus and enters Review.

```text
Meeting stopped

Transcript finalized

[ Generate AI Notes ]
[ Review transcript ]
```

If automatic AI generation is enabled:

```text
Generating AI Notes...

Summary
Decisions
Action Items
Open Questions
Follow-up Draft
```

Enhance output:

1. Summary
2. Decisions
3. Action items
4. Open questions
5. Follow-up draft
6. Transcript, collapsed by default

Rules:

1. The user must be able to edit manual notes before regenerating AI Notes.
2. Regenerate must preserve the previous AI output until the new output succeeds.
3. Copy/export actions are disabled until transcript finalization is complete.
4. Transcript is a source artifact; AI Notes are the finished artifact.

### 8.7 Recipes

Recipes are reusable prompts that turn a meeting into a specific work artifact.

MVP recipes:

1. Follow-up email
2. Slack update
3. PRD draft
4. GitHub issue
5. Customer pain points
6. Weekly summary

Recipe flow:

1. User opens a meeting note.
2. Clicks Run Recipe.
3. Selects recipe.
4. App generates output.
5. User can copy/export.

### 8.8 Exports

MVP:

1. Copy Markdown
2. Save Markdown file
3. Export to Notion page
4. Send Slack webhook message

Later:

1. Notion database mapping
2. Slack OAuth channel picker
3. Teams channel export
4. Google Calendar context
5. Outlook Calendar context

## 9. Privacy Model

### Defaults

1. Meetings are local by default.
2. No public links by default.
3. No cloud sync by default.
4. No model training by default.
5. User must explicitly enable hosted features.

### Data Classes

1. Audio buffer
   - Temporary by default.
   - Deleted after transcription unless user explicitly saves it.

2. Transcript
   - Stored locally.
   - Can be deleted per meeting.

3. AI note
   - Stored locally.
   - Export only by explicit user action.

4. Integration tokens
   - Stored in OS keychain where possible.
   - Never exported in backup by default.

## 10. Technical Architecture

### Desktop Shell

Use Tauri + React + Rust.

Rationale:

1. OpenTypeless compatibility.
2. Native audio capture in Rust.
3. Smaller app footprint than Electron.
4. Good path for signed desktop builds.

### Frontend

1. React
2. Zustand or equivalent local store
3. OpenTypeless-compatible token system
4. No heavy component library in MVP

Frontend implementation rule:

The first implementation should import or duplicate a small OpenTypeless-compatible token layer before building custom OpenMinutes components. Do not let the meeting product drift into a separate visual system. If a new component is required, first decide whether it is a generic desktop component that could later move back into OpenTypeless.

### Backend Core Modules

1. audio_capture
2. stt
3. llm
4. meetings_storage
5. recipes
6. exports
7. privacy/settings

### Audio Capture

macOS-first:

1. Microphone capture.
2. System audio capture with ScreenCaptureKit.
3. Mix streams into one meeting session.
4. Persist temporary chunks until transcription.

Windows later:

1. WASAPI loopback for system audio.
2. Microphone capture via cpal or native WASAPI.

Linux later:

1. PipeWire-first.
2. Fallback to microphone-only where system audio is unavailable.

### STT

MVP should support:

1. OpenAI-compatible Whisper endpoint.
2. Groq Whisper.
3. Local/custom Whisper endpoint.
4. Optional official hosted STT later.

### LLM

MVP should support:

1. OpenAI-compatible API.
2. OpenRouter.
3. Ollama.
4. Optional official hosted LLM later.

### Current Provider Boundary

The current implementation includes provider interfaces before real provider calls:

1. `TranscriptionProvider`
   - Input: meeting id, local audio URI, optional start timestamp.
   - Output: timestamped transcript lines.
   - Current implementation: mock provider for local tests.

2. `AiNotesProvider`
   - Input: meeting object plus generation context.
   - Output: structured AI Notes.
   - Current implementation: mock provider based on markers and transcript length.

Rules:

1. UI code should not call provider-specific APIs directly.
2. Real OpenAI/Groq/Ollama adapters should implement these provider interfaces.
3. Provider credentials must live in settings/keychain storage, not in meeting records.
4. Mock providers must remain available for offline tests and demos.

## 11. Local Data Model

Suggested SQLite tables:

Current implementation status:

1. A SQLite-backed Tauri meeting repository exists for the desktop scaffold.
2. Browser development and tests use localStorage through the repository contract.
3. Desktop runtime uses Tauri commands to store meeting records in `openminutes.sqlite3` in the app data directory.
4. This is intentionally a bridge implementation, not the final normalized storage layer.
5. The current SQLite table stores indexed metadata plus complete `raw_json` meeting content.
6. UI code should depend on the repository contract, not on localStorage, raw Tauri invoke calls, or SQLite directly.
7. The final desktop implementation should split raw meeting JSON into normalized tables using the tables below.

### meetings

```sql
id TEXT PRIMARY KEY;
title TEXT NOT NULL;
template TEXT NOT NULL;
status TEXT NOT NULL;
started_at TEXT;
updated_at TEXT NOT NULL;
raw_json TEXT NOT NULL;
```

### meeting_notes

```sql
id TEXT PRIMARY KEY;
meeting_id TEXT NOT NULL;
kind TEXT NOT NULL; -- typed, marker, transcript, ai_output, recipe_output
content TEXT NOT NULL;
timestamp_seconds INTEGER;
metadata_json TEXT;
created_at TEXT NOT NULL;
```

### action_items

```sql
id TEXT PRIMARY KEY;
meeting_id TEXT NOT NULL;
text TEXT NOT NULL;
owner TEXT;
due_date TEXT;
done INTEGER NOT NULL DEFAULT 0;
created_at TEXT NOT NULL;
```

### recipes

```sql
id TEXT PRIMARY KEY;
name TEXT NOT NULL;
description TEXT;
prompt TEXT NOT NULL;
is_builtin INTEGER NOT NULL DEFAULT 0;
created_at TEXT NOT NULL;
updated_at TEXT NOT NULL;
```

### integrations

```sql
id TEXT PRIMARY KEY;
provider TEXT NOT NULL;
status TEXT NOT NULL;
config_json TEXT;
created_at TEXT NOT NULL;
updated_at TEXT NOT NULL;
```

## 12. OpenTypeless Compatibility

The new project should remain independent, but design modules that can be merged later.

Shared-compatible modules:

1. STT provider abstraction.
2. LLM provider abstraction.
3. Dictionary/personal vocabulary later.
4. Floating capsule/pill concept.
5. Error model.
6. Settings storage patterns.

OpenMinutes-specific modules:

1. Meeting storage.
2. System audio capture.
3. Recipes.
4. Meeting exports.
5. Meeting library.

## 13. Pricing and Commercial Model

License:

1. MIT.

Open-source product:

1. Local desktop app.
2. BYOK providers.
3. Local storage.
4. Markdown export.

Paid official product later:

1. Signed builds.
2. Managed STT/LLM quota.
3. Cloud sync.
4. Notion/Slack hosted integrations.
5. Team folders.
6. Admin/privacy controls.
7. Priority support.

Suggested price:

1. Individual: $19.99/month.
2. Team later: $14-19/user/month.
3. Enterprise later: custom or $35+/user/month.

## 14. Milestones

### Milestone 0: Spec and UI Prototype

1. Product spec.
2. Static UI mockups.
3. User flow review.
4. Technical architecture review.

### Milestone 1: App Shell

1. New Tauri app.
2. Today page.
3. Meeting room page.
4. Library page.
5. Settings page.
6. Local SQLite schema.

### Milestone 2: Recording MVP

1. Microphone capture.
2. Recording state.
3. Floating pill.
4. Stop/save meeting.
5. Focus mode.
6. Live Transcript panel.
7. Local transcript persistence.

### Milestone 3: AI Notes

1. STT provider.
2. LLM provider.
3. Review mode.
4. Generate AI Notes flow.
5. Summary/decisions/actions/questions/follow-up.

### Milestone 4: System Audio

1. macOS ScreenCaptureKit implementation.
2. Mic + system audio mixing.
3. Permission UX.
4. Stability testing.

### Milestone 5: Exports and Recipes

1. Built-in recipes.
2. Markdown copy/export.
3. Slack webhook.
4. Notion page export.

## 15. Initial Implementation Contract

This section defines the first repository push. It is intentionally a useful desktop product skeleton, not a fake marketing prototype.

### 15.1 Repository Boundary

1. Repository name: `openminutes`.
2. License: MIT.
3. The project is independent from OpenTypeless.
4. The project may reuse OpenTypeless-compatible design tokens, UI density, and architectural patterns.
5. The project must not require OpenTypeless as a runtime dependency.
6. Future shared modules should be extracted only after the meeting product proves its workflow.

### 15.2 First Code Version

The first code version must include:

1. React + TypeScript frontend.
2. Vite build pipeline.
3. Tauri v2 desktop shell.
4. OpenTypeless-compatible token layer in CSS.
5. Today, Meeting, Library, and Settings routes.
6. One Meeting sidebar entry only.
7. Focus mode during recording.
8. Review mode after recording stops.
9. Realtime transcript panel in Focus.
10. AI Notes main panel in Review.
11. Original transcript right panel in Review.
12. Two-column Settings structure.
13. Floating capsule compatible with the OpenTypeless capsule concept.
14. Domain tests for meeting mode/view rules.
15. UI tests for navigation, Focus/Review behavior, and Settings structure.

### 15.3 Current Non-Goals

The first push does not need production audio or AI integration yet.

Explicit non-goals:

1. No real microphone capture.
2. No real system audio capture.
3. No real STT provider call.
4. No real LLM provider call.
5. No real Slack/Notion export.
6. No authentication.
7. No billing.
8. No updater.
9. No signed release build.

The goal is to lock the product model and UI architecture before adding expensive native/audio/provider work.

### 15.4 Acceptance Criteria

Product acceptance:

1. Sidebar shows Today, Meeting, Library, Settings.
2. Sidebar does not show Focus.
3. Starting or opening an active meeting shows Focus mode.
4. Focus main pane is manual notes and markers.
5. Focus right pane is Live Transcript.
6. Stopping recording moves the meeting into Review.
7. Review main pane is AI Notes.
8. Review right pane is Original Transcript.
9. Settings keeps OpenTypeless-style two-column layout.
10. Capsule never shows long transcript or AI output text.

Technical acceptance:

1. `npm test -- --run` passes.
2. `npm run build` passes.
3. `cargo check --manifest-path src-tauri/Cargo.toml` passes.
4. No generated build directories are committed.
5. The new repository pushes to GitHub as a separate repo.

### 15.5 Next Engineering Slice

After the initial push, the next meaningful slice should be local persistence plus provider interfaces:

1. Add SQLite storage.
2. Persist meetings, notes, markers, transcript lines, and AI Notes.
3. Add a provider-neutral STT interface.
4. Add a provider-neutral LLM interface.
5. Add mocked provider implementations for tests.
6. Add copy Markdown export.
7. Add a first real local file export.

This keeps the next step small while moving the app from static demo data toward a real local-first tool.

### 15.6 Implementation Slice 2: Local Foundation

Completed in the second push:

1. Added `JsonMeetingRepository` and `MemoryStorageAdapter`.
2. Added a default meeting repository for browser/Tauri WebView storage.
3. Wired the current meeting state to local persistence.
4. Added provider interfaces for STT and AI Notes.
5. Added mock STT and AI Notes providers.
6. Added `formatMeetingMarkdown`.
7. Wired Review's Copy Markdown action to generated AI Notes.
8. Added unit tests for storage, providers, Markdown export, and UI copy behavior.

Still intentionally not completed:

1. Normalized SQLite storage.
2. Real microphone/system audio capture.
3. Real OpenAI/Groq/Ollama provider calls.
4. File save dialog and local Markdown file export.
5. Slack/Notion export adapters.

Next recommended slice:

1. Move repository calls behind Tauri commands.
2. Add SQLite migrations.
3. Persist meetings, notes, markers, transcript lines, and AI Notes separately.
4. Add a local Markdown file export command.
5. Add settings forms for provider base URL, model, and API key location.

### 15.7 Implementation Slice 3: Desktop Persistence and File Export

Completed in the third push:

1. Added Tauri commands:
   - `load_meetings`
   - `save_meeting`
   - `delete_meeting`
   - `export_meeting_markdown`
2. Added desktop runtime detection and Tauri invoke wrapper.
3. Added `TauriMeetingRepository` implementing the async repository contract.
4. Wired the app to prefer Tauri app data persistence in desktop runtime.
5. Kept browser/localStorage fallback for web development and tests.
6. Added Markdown file export to `Documents/OpenMinutes`.
7. Expanded Settings panes:
   - Audio capture settings
   - AI provider/base URL/model placeholders
   - Export destination/integration placeholders
   - About storage mode
8. Added frontend and Rust tests for the new boundaries.

Still intentionally not completed:

1. Normalized SQLite tables.
2. OS keychain storage for provider credentials.
3. Real provider HTTP calls.
4. Native save dialog.
5. Native audio capture.

Next recommended slice:

1. Add a settings repository for provider configuration.
2. Store provider secrets through the OS keychain.
3. Normalize meetings into separate note, marker, transcript, and AI output tables.
4. Add a native save dialog.
5. Add the first real OpenAI-compatible provider adapter behind the existing provider interface.

### 15.8 Implementation Slice 4: SQLite Persistence

Completed in the fourth push:

1. Added `rusqlite` with bundled SQLite.
2. Added `src-tauri/src/storage.rs`.
3. Added `openminutes.sqlite3` as the desktop app data store.
4. Added a schema migration table.
5. Added first migration for `meetings`.
6. Rewired existing Tauri commands to SQLite:
   - `load_meetings`
   - `save_meeting`
   - `delete_meeting`
7. Kept the front-end repository boundary unchanged.
8. Added Rust tests for save/update/load/delete and missing ids.

Storage tradeoff:

The current SQLite schema stores indexed metadata plus full meeting `raw_json`. This is deliberate. It moves the app off ad hoc JSON files while preserving rapid schema evolution. The next storage slice should normalize transcript lines, markers, AI Notes, and action items into separate tables.

Still intentionally not completed:

1. Settings persistence.
2. Keychain-backed provider secrets.
3. Normalized meeting artifacts.
4. Data migration from the previous `meetings.json` bridge file.
5. Real provider calls.

## 16. Open Questions

1. Final product name: OpenMinutes or another name?
2. Should Review auto-generate AI Notes after stop, or wait for an explicit Generate action?
3. Should meeting audio be saved at all, or always deleted after transcription?
4. Should system audio capture be mandatory for launch, or can mic-only launch first?
5. Should the app support calendar import before public launch?
6. Should official hosted cloud exist at launch, or after local BYOK MVP?
7. How close should the floating pill feel to the OpenTypeless capsule?
8. Should transcript be a collapsed drawer, a tab, or an inspector section in Review?
9. What is the first target user: founders, PMs, or consultants?
10. Should the public repo start with a minimal useful app or a polished prototype first?
