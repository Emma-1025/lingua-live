import type { AudioFrame } from '../models.js';
import { createSegmentId } from '../utils/ids.js';
import {
  MAX_SEGMENT_DURATION_MS,
  SILENCE_CLOSE_THRESHOLD_MS,
  SPEECH_OPEN_THRESHOLD_MS,
} from './constants.js';

export type SegmentCloseReason = 'silence' | 'max_length' | 'flush';

export interface SegmentOpenEvent {
  segmentId: string;
  sessionId: string;
  startedAt: number;
  startedSeq: number;
}

export interface SegmentCloseEvent {
  segmentId: string;
  sessionId: string;
  closedAt: number;
  closedSeq: number;
  durationMs: number;
  reason: SegmentCloseReason;
}

export interface VadSegmenterConfig {
  speechOpenThresholdMs?: number;
  silenceCloseThresholdMs?: number;
  maxSegmentDurationMs?: number;
  speechEnergyThreshold?: number;
}

type SegmentOpenHandler = (event: SegmentOpenEvent) => void;
type SegmentCloseHandler = (event: SegmentCloseEvent) => void;

function computeRms(pcm: Float32Array): number {
  if (pcm.length === 0) {
    return 0;
  }

  let sumSquares = 0;
  for (let i = 0; i < pcm.length; i += 1) {
    sumSquares += pcm[i] * pcm[i];
  }
  return Math.sqrt(sumSquares / pcm.length);
}

/**
 * Lightweight energy-based VAD that emits segment-open/close boundaries
 * for downstream partial→final handling (Req 2.2).
 */
export class VadSegmenter {
  private readonly speechOpenThresholdMs: number;
  private readonly silenceCloseThresholdMs: number;
  private readonly maxSegmentDurationMs: number;
  private readonly speechEnergyThreshold: number;

  private state: 'idle' | 'open' = 'idle';
  private speechStreakMs = 0;
  private speechStreakStartAt = 0;
  private speechStreakStartSeq = 0;
  private silenceStreakMs = 0;
  private segmentElapsedMs = 0;
  private currentSegmentId = '';
  private segmentSessionId = '';
  private segmentStartedAt = 0;
  private segmentStartedSeq = 0;

  private readonly openHandlers = new Set<SegmentOpenHandler>();
  private readonly closeHandlers = new Set<SegmentCloseHandler>();

  constructor(config: VadSegmenterConfig = {}) {
    this.speechOpenThresholdMs = config.speechOpenThresholdMs ?? SPEECH_OPEN_THRESHOLD_MS;
    this.silenceCloseThresholdMs = config.silenceCloseThresholdMs ?? SILENCE_CLOSE_THRESHOLD_MS;
    this.maxSegmentDurationMs = config.maxSegmentDurationMs ?? MAX_SEGMENT_DURATION_MS;
    this.speechEnergyThreshold = config.speechEnergyThreshold ?? 0.02;
  }

  pushFrame(frame: AudioFrame): void {
    const isSpeech = computeRms(frame.pcm) >= this.speechEnergyThreshold;

    if (this.state === 'idle') {
      this.handleIdleFrame(frame, isSpeech);
      return;
    }

    this.handleOpenFrame(frame, isSpeech);
  }

  /** Close any open segment at end-of-stream. */
  flush(): void {
    if (this.state !== 'open') {
      return;
    }

    this.closeSegment(this.segmentStartedAt, this.segmentStartedSeq, 'flush');
  }

  reset(): void {
    this.state = 'idle';
    this.speechStreakMs = 0;
    this.silenceStreakMs = 0;
    this.segmentElapsedMs = 0;
    this.currentSegmentId = '';
    this.segmentSessionId = '';
    this.segmentStartedAt = 0;
    this.segmentStartedSeq = 0;
  }

  isSegmentOpen(): boolean {
    return this.state === 'open';
  }

  onSegmentOpen(handler: SegmentOpenHandler): () => void {
    this.openHandlers.add(handler);
    return () => this.openHandlers.delete(handler);
  }

  onSegmentClose(handler: SegmentCloseHandler): () => void {
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  private handleIdleFrame(frame: AudioFrame, isSpeech: boolean): void {
    if (isSpeech) {
      if (this.speechStreakMs === 0) {
        this.speechStreakStartAt = frame.capturedAt;
        this.speechStreakStartSeq = frame.seq;
      }
      this.speechStreakMs += frame.durationMs;
      if (this.speechStreakMs >= this.speechOpenThresholdMs) {
        this.openSegment(frame.sessionId);
        this.handleOpenFrame(frame, isSpeech);
      }
      return;
    }

    this.speechStreakMs = 0;
    this.speechStreakStartAt = 0;
    this.speechStreakStartSeq = 0;
  }

  private handleOpenFrame(frame: AudioFrame, isSpeech: boolean): void {
    this.segmentElapsedMs += frame.durationMs;

    if (isSpeech) {
      this.silenceStreakMs = 0;
    } else {
      this.silenceStreakMs += frame.durationMs;
    }

    if (this.silenceStreakMs >= this.silenceCloseThresholdMs) {
      this.closeSegment(frame.capturedAt, frame.seq, 'silence');
      return;
    }

    if (this.segmentElapsedMs >= this.maxSegmentDurationMs) {
      this.closeSegment(frame.capturedAt, frame.seq, 'max_length');
    }
  }

  private openSegment(sessionId: string): void {
    this.state = 'open';
    this.currentSegmentId = createSegmentId();
    this.segmentSessionId = sessionId;
    this.segmentStartedAt = this.speechStreakStartAt;
    this.segmentStartedSeq = this.speechStreakStartSeq;
    this.segmentElapsedMs = 0;
    this.silenceStreakMs = 0;
    this.speechStreakMs = 0;

    const event: SegmentOpenEvent = {
      segmentId: this.currentSegmentId,
      sessionId: this.segmentSessionId,
      startedAt: this.segmentStartedAt,
      startedSeq: this.segmentStartedSeq,
    };

    for (const handler of this.openHandlers) {
      handler(event);
    }
  }

  private closeSegment(closedAt: number, closedSeq: number, reason: SegmentCloseReason): void {
    const event: SegmentCloseEvent = {
      segmentId: this.currentSegmentId,
      sessionId: this.segmentSessionId,
      closedAt,
      closedSeq,
      durationMs: this.segmentElapsedMs,
      reason,
    };

    this.state = 'idle';
    this.speechStreakMs = 0;
    this.speechStreakStartAt = 0;
    this.speechStreakStartSeq = 0;
    this.silenceStreakMs = 0;
    this.segmentElapsedMs = 0;
    this.currentSegmentId = '';
    this.segmentSessionId = '';

    for (const handler of this.closeHandlers) {
      handler(event);
    }
  }
}
