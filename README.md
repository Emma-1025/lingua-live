# LinguaLive

AI simultaneous interpretation assistant with real-time Chinese subtitles. Captures English (or other source-language) audio, streams it through ASR → DeepSeek translation → optional Chinese TTS, and displays live subtitles with self-correction.

## Quick start

```bash
npm install
npm test                  # 137 unit/integration tests (Vitest)
npm run build             # build core + app
npm run dev               # web UI at http://localhost:5173
npm run dev:desktop       # Tauri desktop (system/mic capture)
npm run build:desktop     # desktop release binary + installers (.deb, .AppImage, .msi, .dmg)
```

Mock drivers are used by default — no API keys required for local development and CI.

## Environment variables

| Variable                         | Required             | Description                                          |
| -------------------------------- | -------------------- | ---------------------------------------------------- |
| `DEEPSEEK_API_KEY`               | For real translation | DeepSeek chat completions (translation + correction) |
| `LINGUA_VENDOR_MODE`             | No                   | `mock` (default) or `real` for cloud ASR/TTS         |
| `DEEPGRAM_API_KEY`               | When `real`          | Streaming ASR (Deepgram)                             |
| `OPENAI_API_KEY` / `TTS_API_KEY` | When `real`          | Chinese TTS (OpenAI-compatible `/audio/speech`)      |

Example for a full live session on desktop:

```bash
export DEEPSEEK_API_KEY=sk-...
export LINGUA_VENDOR_MODE=real
export DEEPGRAM_API_KEY=...
export OPENAI_API_KEY=sk-...
npm run dev:desktop
```

Keys must live in the desktop backend process or your shell environment — never commit them or embed them in client bundles.

You can also configure real ASR/TTS in the app without shell variables:
open **设置 → 语音服务 (ASR/TTS)**, choose **真实云服务（Deepgram ASR）**, then enter the
Deepgram API key. TTS settings in the same section are optional unless Chinese voice output is enabled.

## Monorepo layout

| Package                | Description                                                         |
| ---------------------- | ------------------------------------------------------------------- |
| `@lingua-live/core`    | Pipeline: ingest → VAD → ASR → translate → correct → transcript/TTS |
| `@lingua-live/app`     | React UI: subtitles, controls, settings, consent, export            |
| `@lingua-live/desktop` | Tauri 2 shell with Rust/cpal system & microphone capture            |

## Architecture (high level)

```
Audio Ingestor → Speech Recognizer → Translator (DeepSeek)
                         ↓                    ↓
                  Correction Engine    Subtitle stream
                         ↓                    ↓
                  Transcript store     Audio Synthesizer (optional)
```

- **File / system / microphone** sources via `SessionIngestor`
- **Media files** support WAV directly and MP4/M4A/MP3 through the browser/WebView media decoder when the audio track codec is available on the platform
- **Partial subtitles** throttled under load; frames are never dropped (bounded queue + back-pressure)
- **Self-correction** when ASR revises an earlier hypothesis (e.g. corps → corpus)
- **Latency monitor** warns when p95 partial e2e exceeds 5 s

## Manual acceptance checklist

1. `npm run dev:desktop` on your target OS
2. Accept the consent dialog, select **系统声音**, start a session while playing English audio
3. Confirm Chinese partial/final subtitles appear within ~3 s
4. Toggle **显示原文**, font size, and **中文语音** + volume in settings
5. Stop and export transcript when finals exist

## Desktop build

Requires Rust stable and platform WebKit/GTK deps (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)):

```bash
npm run build:desktop
```

Artifacts land under `packages/desktop/src-tauri/target/release/bundle/`:

| Platform | Installers                  |
| -------- | --------------------------- |
| Linux    | `.deb`, `.rpm`, `.AppImage` |
| macOS    | `.dmg`                      |
| Windows  | `.msi` (NSIS)               |

For a faster CI-style compile without packaging:

```bash
npm run build:desktop:smoke
```

To regenerate icons after changing `packages/desktop/app-icon.png`:

```bash
cd packages/desktop && npx tauri icon app-icon.png
```

### GitHub Releases

Push a version tag to build installers for macOS (Intel + Apple Silicon), Windows, and Linux:

```bash
git tag app-v0.3.0
git push origin app-v0.3.0
```

The `release-desktop` workflow uploads draft release assets. For signed/notarized macOS or Windows builds, configure the signing secrets documented in [Tauri’s GitHub pipeline guide](https://v2.tauri.app/distribute/pipelines/github/).
