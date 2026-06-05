/** Target capture format for ASR (mono 16 kHz PCM). */
export const TARGET_SAMPLE_RATE = 16_000;

/** Maximum audio per frame in milliseconds (Req 1.3). */
export const MAX_FRAME_DURATION_MS = 1_000;

export const MAX_FRAME_SAMPLES = (TARGET_SAMPLE_RATE * MAX_FRAME_DURATION_MS) / 1_000;
