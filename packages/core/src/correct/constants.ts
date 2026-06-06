/** Finals displayed longer than this are frozen and cannot be corrected. */
export const CORRECTION_FREEZE_AFTER_MS = 10_000;

/** Revised subtitles must be emitted within this window after triggering audio. */
export const CORRECTION_EMIT_DEADLINE_MS = 2_000;

export const DEFAULT_CORRECTION_MODEL = 'deepseek-v4-pro';

export const DEFAULT_CORRECTION_WINDOW_SIZE = 5;
