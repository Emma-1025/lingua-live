# AGENTS.md

## Cursor Cloud specific instructions

### Product overview

LinguaLive is an npm workspaces monorepo for an AI simultaneous interpretation assistant:

| Package | Role |
|---------|------|
| `packages/core` | Pipeline orchestrator (ingest → ASR → translate → correct → TTS/transcript) |
| `packages/app` | React + Vite UI (subtitles, controls, settings, consent, export) |
| `packages/desktop` | Tauri 2 desktop shell with Rust/cpal audio capture |

Tasks 1–18 from `.kiro/specs/ai-interpretation-assistant/tasks.md` are implemented on `main`.

### Prerequisites

- Node.js 18+ (CI uses v22)
- npm (workspaces)
- For desktop: Rust stable + platform deps for Tauri (see README)

No API keys are required for `npm test` / `npm run build` — mocks are used by default.

### Standard commands

| Task | Command |
|------|---------|
| Install deps | `npm install` |
| Unit tests | `npm test` (137 tests) |
| Lint | `npm run lint` |
| Build | `npm run build` |
| Web dev | `npm run dev` → http://localhost:5173 |
| Desktop dev | `npm run dev:desktop` |
| Desktop release | `npm run build:desktop` (installers in `packages/desktop/src-tauri/target/release/bundle/`) |
| Desktop smoke build | `npm run build:desktop:smoke` (`tauri build --no-bundle`) |

### Dev server

- `npm run dev` builds `@lingua-live/core` first, then starts Vite on port **5173**.
- `npm run dev:desktop` builds core + app and launches the Tauri shell.
- Use tmux for long-running dev servers in cloud environments.

### Environment variables

- `DEEPSEEK_API_KEY` — real translation/correction (falls back to mock in dev if unset)
- `LINGUA_VENDOR_MODE=mock|real` — ASR/TTS driver selection (default `mock`)
- `DEEPGRAM_API_KEY`, `OPENAI_API_KEY` / `TTS_API_KEY` — required when `LINGUA_VENDOR_MODE=real`

### Key test suites

| Path | Covers |
|------|--------|
| `packages/core/src/pipeline/pipeline.test.ts` | End-to-end pipeline with mock ASR |
| `packages/core/src/acceptance/bilibiliScenario.test.ts` | Bilibili-style corps→corpus correction |
| `packages/core/src/perf/benchmark.test.ts` | Golden-clip p95 latency ≤ 3 s |
| `packages/core/src/perf/soak.test.ts` | 120-min simulated soak, zero dropped frames |
| `packages/app/src/acceptance/uiAcceptance.test.tsx` | Settings, a11y, keyboard |

### CI

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `.github/workflows/ci.yml` | push/PR `main` | lint, test, web build |
| `.github/workflows/desktop.yml` | push/PR `main` | Linux Tauri smoke build (`--no-bundle`) |
| `.github/workflows/release-desktop.yml` | tag `app-v*` or manual | multi-OS installers via `tauri-action` |

### Common pitfalls

- Pipeline tests use `vi.useFakeTimers()` — call `vi.setSystemTime(new Date(1_000))` when measuring latency.
- `createCorrectionEngine()` requires `DEEPSEEK_API_KEY` unless a stub is injected in tests.
- Desktop system-audio capture only works inside the Tauri shell, not the web dev server alone.
