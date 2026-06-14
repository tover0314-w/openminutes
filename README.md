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
- JSON-backed local meeting repository with Tauri app data persistence and browser fallback.
- Provider interfaces for transcription and AI Notes generation.
- Mock STT and AI Notes providers for local development and tests.
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

Settings keeps the OpenTypeless-compatible two-column desktop preference layout:

![OpenMinutes Settings](output/playwright/openminutes-settings.png)

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
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```
