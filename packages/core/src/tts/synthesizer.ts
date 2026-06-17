import type { ZhSegment } from '../models.js';
import {
  MAX_VOLUME_LEVEL,
  MIN_VOLUME_LEVEL,
  STOP_PLAYBACK_MAX_MS,
} from './constants.js';

export interface MockTtsDriver {
  synthesize(text: string, spokenIndex: number): Promise<void>;
}

export interface AudioSynthesizer {
  setEnabled(on: boolean): void;
  isEnabled(): boolean;
  setVolume(level: number): void;
  getVolume(): number;
  enqueue(segment: ZhSegment): void;
  stop(): void;
  onSynthFailure(handler: (segmentId: string) => void): () => void;
  onPlaybackStateChange(handler: (playing: boolean) => void): () => void;
}

type SynthFailureHandler = (segmentId: string) => void;
type PlaybackStateHandler = (playing: boolean) => void;

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;
type ScheduleFn = (fn: () => void, delayMs: number) => TimerHandle;
type CancelScheduleFn = (handle: TimerHandle) => void;

const defaultSchedule: ScheduleFn = (fn, delayMs) => globalThis.setTimeout(fn, delayMs);
const defaultCancelSchedule: CancelScheduleFn = (handle) => globalThis.clearTimeout(handle);

interface QueuedSegment {
  segment: ZhSegment;
}

export interface MockAudioSynthesizerConfig {
  driver?: MockTtsDriver;
  synthesisDurationMs?: number;
  setTimeoutFn?: ScheduleFn;
  clearTimeoutFn?: CancelScheduleFn;
}

export class MockAudioSynthesizer implements AudioSynthesizer {
  private enabled = false;
  private volume = 5;
  private readonly queue: QueuedSegment[] = [];
  private processing = false;
  private processScheduled = false;
  private stopHandle: TimerHandle | undefined;
  private activeSegmentId: string | undefined;
  private readonly failureHandlers = new Set<SynthFailureHandler>();
  private readonly playbackHandlers = new Set<PlaybackStateHandler>();
  private playing = false;
  private readonly driver: MockTtsDriver;
  private readonly synthesisDurationMs: number;
  private readonly schedule: ScheduleFn;
  private readonly cancelSchedule: CancelScheduleFn;

  constructor(config: MockAudioSynthesizerConfig = {}) {
    this.driver = config.driver ?? {
      synthesize: async () => {},
    };
    this.synthesisDurationMs = config.synthesisDurationMs ?? 200;
    this.schedule = config.setTimeoutFn ?? defaultSchedule;
    this.cancelSchedule = config.clearTimeoutFn ?? defaultCancelSchedule;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.stopActivePlayback();
    } else {
      this.scheduleProcessQueue();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setVolume(level: number): void {
    this.volume = clampVolume(level);
  }

  getVolume(): number {
    return this.volume;
  }

  enqueue(segment: ZhSegment): void {
    if (segment.status !== 'final') {
      return;
    }

    this.queue.push({ segment });
    this.queue.sort((left, right) => left.segment.spokenIndex - right.segment.spokenIndex);
    this.scheduleProcessQueue();
  }

  stop(): void {
    this.stopActivePlayback();
  }

  onSynthFailure(handler: SynthFailureHandler): () => void {
    this.failureHandlers.add(handler);
    return () => {
      this.failureHandlers.delete(handler);
    };
  }

  onPlaybackStateChange(handler: PlaybackStateHandler): () => void {
    this.playbackHandlers.add(handler);
    return () => {
      this.playbackHandlers.delete(handler);
    };
  }

  private scheduleProcessQueue(): void {
    if (this.processScheduled) {
      return;
    }

    this.processScheduled = true;
    this.schedule(() => {
      this.processScheduled = false;
      void this.processQueue();
    }, 0);
  }

  private stopActivePlayback(): void {
    if (this.stopHandle !== undefined) {
      this.cancelSchedule(this.stopHandle);
      this.stopHandle = undefined;
    }

    this.processing = false;
    this.activeSegmentId = undefined;
    this.queue.length = 0;
    this.setPlaying(false);
  }

  private async processQueue(): Promise<void> {
    if (!this.enabled || this.processing || this.volume === MIN_VOLUME_LEVEL) {
      return;
    }

    const next = this.queue.shift();
    if (!next) {
      return;
    }

    this.processing = true;
    this.activeSegmentId = next.segment.id;

    try {
      await new Promise<void>((resolve, reject) => {
        this.stopHandle = this.schedule(async () => {
          this.stopHandle = undefined;
          try {
            if (!this.enabled || this.volume === MIN_VOLUME_LEVEL) {
              resolve();
              return;
            }

            this.setPlaying(true);
            await this.driver.synthesize(next.segment.zhText, next.segment.spokenIndex);
            this.setPlaying(false);
            resolve();
          } catch (error) {
            reject(error);
          }
        }, this.synthesisDurationMs);
      });
    } catch {
      this.setPlaying(false);
      this.emitFailure(next.segment.id);
    } finally {
      this.processing = false;
      this.activeSegmentId = undefined;
      void this.processQueue();
    }
  }

  private emitFailure(segmentId: string): void {
    for (const handler of this.failureHandlers) {
      handler(segmentId);
    }
  }

  private setPlaying(playing: boolean): void {
    if (this.playing === playing) {
      return;
    }

    this.playing = playing;
    for (const handler of this.playbackHandlers) {
      handler(playing);
    }
  }
}

export function createAudioSynthesizer(
  config: MockAudioSynthesizerConfig = {},
): AudioSynthesizer {
  return new MockAudioSynthesizer(config);
}

function clampVolume(level: number): number {
  return Math.min(MAX_VOLUME_LEVEL, Math.max(MIN_VOLUME_LEVEL, Math.round(level)));
}

export { STOP_PLAYBACK_MAX_MS };
