# LinguaLive

AI simultaneous interpretation assistant with real-time Chinese subtitles.

## Development

```bash
npm install
npm test          # run unit tests (Vitest)
npm run build     # build core + app
npm run dev       # start Vite dev server for the UI shell
npm run dev:desktop  # Tauri desktop shell (system/mic capture via Rust backend)
```

Set `DEEPSEEK_API_KEY` for real translation, or rely on the built-in mock translator in development.

### Monorepo layout

| Package | Description |
|---------|-------------|
| `@lingua-live/core` | Pipeline domain types and shared utilities |
| `@lingua-live/app` | React interpretation UI |
| `@lingua-live/desktop` | Tauri desktop shell with native audio capture |
