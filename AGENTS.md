# AGENTS.md

## Cursor Cloud specific instructions

### Product overview

LinguaLive is an npm workspaces monorepo (`packages/core`, `packages/app`) for an AI simultaneous interpretation assistant. The core library has unit tests; the app is a React + Vite + Three.js UI shell placeholder.

### Prerequisites

- Node.js 18+ (tested with v22)
- npm (workspaces)

No Docker, database, or external API keys are required for current development.

### Standard commands

See `README.md` for the canonical dev workflow:

| Task | Command |
|------|---------|
| Install deps | `npm install` |
| Unit tests | `npm test` |
| Lint | `npm run lint` |
| Build | `npm run build` |
| Dev server | `npm run dev` |

### Dev server

- `npm run dev` builds `@lingua-live/core` first, then starts Vite on **http://localhost:5173**.
- Run the dev server in a tmux session if you need it to persist in the background.

### Lint note

`npm run lint` may report pre-existing `prefer-const` issues in test files under `packages/core/src/asr/recognizer.test.ts`. Tests and build still pass.

### What is not implemented yet

Full interpretation E2E (DeepSeek translation, cloud ASR/TTS, desktop shell for system audio) is spec'd but not wired. Current hello-world scope: unit tests + UI shell at port 5173.
