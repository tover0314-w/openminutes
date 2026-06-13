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

This first version locks the desktop product model before adding real audio, STT, LLM, and export providers.

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

## Verification

```bash
npm test -- --run
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```
