/** End-to-end latency threshold that triggers a warning indicator. */
export const LATENCY_WARNING_THRESHOLD_MS = 5_000;

/** Target p95 partial end-to-end latency during a session. */
export const LATENCY_P95_TARGET_MS = 3_000;

/** Warning must appear within this window after the threshold is exceeded. */
export const LATENCY_WARNING_RAISE_MAX_MS = 2_000;

/** Latency must stay at or below the threshold for this duration before clearing. */
export const LATENCY_WARNING_CLEAR_STABLE_MS = 5_000;

/** Warning must be removed within this window after recovery is confirmed. */
export const LATENCY_WARNING_REMOVE_MAX_MS = 2_000;

/** Rolling sample window size for p95 calculation. */
export const DEFAULT_LATENCY_WINDOW_SIZE = 100;
