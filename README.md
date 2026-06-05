# LinguaLive

AI simultaneous interpretation assistant with real-time Chinese subtitles.

## Development

```bash
npm install
npm test          # run unit tests (Vitest)
npm run build     # build core + app
npm run dev       # start Vite dev server for the UI shell
```

### Monorepo layout

| Package | Description |
|---------|-------------|
| `@lingua-live/core` | Pipeline domain types and shared utilities |
| `@lingua-live/app` | React + Three.js desktop UI shell |
