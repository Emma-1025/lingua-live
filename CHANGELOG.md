# Changelog

## 0.3.0 - 2026-06-07

- Added media-file decoding for MP4, M4A, and MP3 audio tracks through the browser/WebView decoder while retaining direct WAV support.
- Fixed failed system-audio starts so they roll back cleanly and show an actionable error instead of leaving the app apparently idle.
- Tightened native system-capture startup handling so desktop capture failures are reported synchronously and system audio no longer falls back to microphone capture.
- Added app-side Deepgram ASR and TTS configuration in Settings, with saved local credentials and environment variables as first-run defaults.

## 0.2.0 - 2026-06-07

- Refreshed the LinguaLive web and desktop UI with a glass-style dashboard shell, summary cards, and responsive layout.
- Added subtitle counters, richer empty state messaging, and per-line status metadata while preserving screen reader announcements.
- Improved session controls, settings grouping, consent dialog styling, and stop/export dialog presentation.
- Bumped npm workspace, Tauri, and Rust desktop metadata to `0.2.0` for the `app-v0.2.0` release.
