# OpenMinutes

OpenMinutes is an open-source, local-first AI meeting notes desktop app.

Status: early implementation scaffold.
License: MIT.

## Current Scope

- Product spec: `docs/2026-06-14-openminutes-product-spec.md`
- App source: `src/`
- Tauri shell: `src-tauri/`
- Desktop UI prototype for review: `prototypes/desktop-ui.html`
- Earlier web-style prototype for comparison: `prototypes/ui.html`

This first version locks the desktop product model before adding real audio, STT, LLM, and hosted export providers.

Implemented foundation:

- Meeting mode domain rules for Focus and Review.
- SQLite-backed desktop meeting repository with browser fallback for development/tests.
- SQLite-backed app settings for editable provider/export preferences.
- Provider interfaces for transcription and AI Notes generation.
- Mock STT and AI Notes providers for local development and tests.
- OS keychain-backed provider API key commands in the desktop shell.
- OpenAI-compatible AI Notes provider adapter behind the provider boundary.
- OpenAI-compatible STT provider adapter for imported audio files.
- Explicit local demo modes for STT import and AI Notes generation without provider keys.
- Editable AI Notes in Review, including key points and action item owners.
- Editable original transcript source lines in Review.
- Native desktop audio file picker with browser fallback for testing STT before native capture.
- Retry affordance for failed audio import/STT setup.
- Add/delete controls for original transcript source lines.
- Speaker rename/merge controls for original transcript source lines.
- Source citation chips from AI Notes back to original transcript lines.
- Review generate/regenerate failure states that preserve existing AI Notes.
- Markdown formatting for AI Notes export.
- Copy Markdown action in the Review workspace.
- Save Markdown action for desktop exports to `Documents/OpenMinutes`.

## Positioning

Stay present in meetings. Keep rough notes. Get finished, actionable meeting notes afterward.

## Screenshots

Focus keeps manual notes in the main pane and the live transcript on the right:

![OpenMinutes Focus](output/playwright/openminutes-focus.png)

Review turns the meeting into AI Notes, with the original transcript kept as source:

![OpenMinutes Review](output/playwright/openminutes-review.png)

Review reads like a document while emphasizing user notes and markers as source signals. AI Notes can also link back to cited original transcript lines:

![OpenMinutes Review Document UI](output/playwright/openminutes-review-document-ui.png)

Settings keeps the OpenTypeless-compatible two-column desktop preference layout:

![OpenMinutes Settings](output/playwright/openminutes-settings.png)

AI provider keys are configured without displaying stored secrets:

![OpenMinutes AI Settings](output/playwright/openminutes-settings-ai-keychain.png)

Local demo modes let audio import and AI Notes run without provider keys:

![OpenMinutes Local Demo Mode Settings](output/playwright/openminutes-settings-local-demo-mode.png)

Imported demo audio lands in Review with editable transcript source and generated notes:

![OpenMinutes Local Demo Import Review](output/playwright/openminutes-local-demo-import-review.png)

Provider errors preserve the existing AI Notes in Review:

![OpenMinutes Provider Error](output/playwright/openminutes-review-provider-error.png)

Review AI Notes are editable before copy/export:

![OpenMinutes Editable Review](output/playwright/openminutes-review-editable-ai-notes.png)

Imported audio uses the STT provider path and surfaces configuration errors:

![OpenMinutes Import Error](output/playwright/openminutes-import-transcript-error.png)

Original transcript lines are editable in Review:

![OpenMinutes Editable Transcript](output/playwright/openminutes-editable-transcript.png)

Transcript source lines can be added or removed during Review:

![OpenMinutes Transcript Line Controls](output/playwright/openminutes-transcript-line-controls.png)

Speaker labels can be renamed or merged across the transcript before regenerating notes:

![OpenMinutes Speaker Rename Tools](output/playwright/openminutes-speaker-rename-tools.png)

Failed audio imports can be retried after configuration is fixed:

![OpenMinutes Retry Import](output/playwright/openminutes-retry-import.png)

## Development

```bash
npm install
npm run dev
npm test
npm run build
npm run tauri -- dev
```

## Product Logic

- Focus mode is for live capture: manual notes and markers in the main pane, live transcript on the right.
- Review mode is for AI Notes: AI-generated notes in the main pane, original transcript on the right as source.
- Settings keeps the two-column desktop preference structure used by OpenTypeless.
- AI Notes exports default to the generated notes; transcript is included only when requested.

## Verification

```bash
npm test -- --run
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```
