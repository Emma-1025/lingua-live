/** Target capture format for ASR (mono 16 kHz PCM). */
export const TARGET_SAMPLE_RATE = 16_000;

/** Maximum audio per frame in milliseconds (Req 1.3). */
export const MAX_FRAME_DURATION_MS = 1_000;

export const MAX_FRAME_SAMPLES = (TARGET_SAMPLE_RATE * MAX_FRAME_DURATION_MS) / 1_000;

/** Continuous speech required before opening a segment (Req 2.2). */
export const SPEECH_OPEN_THRESHOLD_MS = 200;

/** Trailing silence that closes an open segment (Req 2.2). */
export const SILENCE_CLOSE_THRESHOLD_MS = 600;

/** Maximum segment duration before forced close (Req 2.2). */
export const MAX_SEGMENT_DURATION_MS = 15_000;
