import type { ZhSegment } from '../models.js';
import {
  MAX_VOLUME_LEVEL,
  MIN_VOLUME_LEVEL,
  STOP_PLAYBACK_MAX_MS,
} from './constants.js';
import type { AudioPlayer } from './audioPlayer.js';
import { createWebAudioPlayer } from './audioPlayer.js';
import type { AudioSynthesizer } from './synthesizer.js';
import type { TtsDriver } from './ttsDriver.js';

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

export interface RealAudioSynthesizerConfig {
  driver: TtsDriver;
  player?: AudioPlayer;
  setTimeoutFn?: ScheduleFn;
  clearTimeoutFn?: CancelScheduleFn;
}

export class RealAudioSynthesizer implements AudioSynthesizer {
  private enabled = false;
  private volume = 5;
  private readonly queue: QueuedSegment[] = [];
  private processing = false;
  private processScheduled = false;
  private stopHandle: TimerHandle | undefined;
  private readonly failureHandlers = new Set<SynthFailureHandler>();
  private readonly playbackHandlers = new Set<PlaybackStateHandler>();
  private readonly driver: TtsDriver;
  private readonly player: AudioPlayer;
  private readonly schedule: ScheduleFn;
  private readonly cancelSchedule: CancelScheduleFn;
  private playing = false;

  constructor(config: RealAudioSynthesizerConfig) {
    this.driver = config.driver;
    this.player = config.player ?? createWebAudioPlayer();
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

    this.player.stop();
    this.processing = false;
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

    try {
      const audio = await this.driver.synthesize(next.segment.zhText);
      if (!this.enabled || this.volume === MIN_VOLUME_LEVEL) {
        return;
      }

      this.setPlaying(true);
      await this.player.play(audio, this.volume);
    } catch {
      this.emitFailure(next.segment.id);
    } finally {
      this.setPlaying(false);
      this.processing = false;
      void this.processQueue();
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

  private emitFailure(segmentId: string): void {
    for (const handler of this.failureHandlers) {
      handler(segmentId);
    }
  }
}

export function createRealAudioSynthesizer(config: RealAudioSynthesizerConfig): AudioSynthesizer {
  return new RealAudioSynthesizer(config);
}

function clampVolume(level: number): number {
  return Math.min(MAX_VOLUME_LEVEL, Math.max(MIN_VOLUME_LEVEL, Math.round(level)));
}

export { STOP_PLAYBACK_MAX_MS };
