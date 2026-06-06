/** Maximum number of captured frames buffered before applying back-pressure. */
export const DEFAULT_FRAME_QUEUE_SIZE = 32;

/** Minimum interval between partial subtitle updates under normal load. */
export const DEFAULT_PARTIAL_THROTTLE_MS = 200;

/** Queue occupancy ratio above which partial cadence is reduced. */
export const DEFAULT_PARTIAL_LOAD_THRESHOLD = 0.75;

/** Pause/resume must take effect within this window (Req 7.2, 7.3). */
export const PAUSE_RESUME_MAX_MS = 1_000;
