import { DEFAULT_CORRECTION_WINDOW_SIZE } from '../correct/constants.js';
import {
  DEFAULT_FRAME_QUEUE_SIZE,
  DEFAULT_PARTIAL_LOAD_THRESHOLD,
  DEFAULT_PARTIAL_THROTTLE_MS,
} from '../pipeline/constants.js';
import { DEFAULT_CONTEXT_WINDOW_SIZE } from '../translate/constants.js';
import { LATENCY_P95_TARGET_MS } from './constants.js';

/**
 * Production-oriented pipeline tuning chosen to meet p95 partial e2e ≤3 s (Req 9.1)
 * while preserving every captured frame under load (Req 9.4).
 */
export const TUNED_FRAME_QUEUE_SIZE = DEFAULT_FRAME_QUEUE_SIZE;

export const TUNED_PARTIAL_THROTTLE_MS = DEFAULT_PARTIAL_THROTTLE_MS;

export const TUNED_PARTIAL_LOAD_THRESHOLD = DEFAULT_PARTIAL_LOAD_THRESHOLD;

/** Sliding context sent to DeepSeek for finals; capped in the pipeline for memory stability. */
export const TUNED_CONTEXT_WINDOW_SIZE = DEFAULT_CONTEXT_WINDOW_SIZE;

export const TUNED_CORRECTION_WINDOW_SIZE = DEFAULT_CORRECTION_WINDOW_SIZE;

/** Retain segment timing maps for recent ids only during long sessions. */
export const TUNED_SEGMENT_MAP_RETENTION = 64;

export const PARTIAL_LATENCY_TARGET_MS = LATENCY_P95_TARGET_MS;

/** Simulated soak duration (120 minutes). */
export const SOAK_TARGET_DURATION_MS = 120 * 60 * 1_000;

/** Each soak loop represents one simulated minute of conference audio. */
export const SOAK_LOOP_DURATION_MS = 60 * 1_000;

export const SOAK_LOOP_COUNT = SOAK_TARGET_DURATION_MS / SOAK_LOOP_DURATION_MS;

export interface TunedPipelineOptions {
  frameQueueSize: number;
  partialThrottleMs: number;
  partialLoadThreshold: number;
  contextWindowSize: number;
}

export function createTunedPipelineOptions(): TunedPipelineOptions {
  return {
    frameQueueSize: TUNED_FRAME_QUEUE_SIZE,
    partialThrottleMs: TUNED_PARTIAL_THROTTLE_MS,
    partialLoadThreshold: TUNED_PARTIAL_LOAD_THRESHOLD,
    contextWindowSize: TUNED_CONTEXT_WINDOW_SIZE,
  };
}
