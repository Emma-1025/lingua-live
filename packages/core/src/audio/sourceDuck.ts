import type { AudioFrame, AudioSourceKind } from '../models.js';
import {
  DUCKED_SOURCE_GAIN,
  NORMAL_SOURCE_GAIN,
} from '../vendors/constants.js';

export interface SourceDuckController {
  setSourceSuppressed(suppressed: boolean): void;
}

export interface SourceMonitor extends SourceDuckController {
  pushFrame(frame: AudioFrame): void;
  stop(): void;
}

export interface WebAudioSourceMonitorConfig {
  audioContext?: AudioContext;
  sampleRate?: number;
}

/**
 * Optional monitor that plays captured source audio locally (file/system preview).
 * Gain is reduced while Chinese TTS is playing (Req 6.6).
 */
export class WebAudioSourceMonitor implements SourceMonitor {
  private readonly audioContext: AudioContext;
  private readonly sampleRate: number;
  private readonly gainNode: GainNode;
  private nextStartTime = 0;
  private suppressed = false;

  constructor(config: WebAudioSourceMonitorConfig = {}) {
    this.audioContext = config.audioContext ?? new AudioContext();
    this.sampleRate = config.sampleRate ?? this.audioContext.sampleRate;
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = NORMAL_SOURCE_GAIN;
    this.gainNode.connect(this.audioContext.destination);
  }

  pushFrame(frame: AudioFrame): void {
    const buffer = this.audioContext.createBuffer(1, frame.pcm.length, this.sampleRate);
    buffer.copyToChannel(new Float32Array(frame.pcm), 0);

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gainNode);

    const startAt = Math.max(this.audioContext.currentTime, this.nextStartTime);
    source.start(startAt, 0, frame.durationMs / 1_000);
    this.nextStartTime = startAt + frame.durationMs / 1_000;
  }

  setSourceSuppressed(suppressed: boolean): void {
    this.suppressed = suppressed;
    this.gainNode.gain.value = suppressed ? DUCKED_SOURCE_GAIN : NORMAL_SOURCE_GAIN;
  }

  stop(): void {
    this.gainNode.disconnect();
    this.nextStartTime = 0;
    this.setSourceSuppressed(false);
  }
}

export function createWebAudioSourceMonitor(
  config?: WebAudioSourceMonitorConfig,
): SourceMonitor {
  return new WebAudioSourceMonitor(config);
}

export function shouldDuckSource(kind: AudioSourceKind): boolean {
  return kind === 'system' || kind === 'file';
}

export class CompositeSourceDuckController implements SourceDuckController {
  private readonly targets: SourceDuckController[];

  constructor(targets: SourceDuckController[]) {
    this.targets = targets;
  }

  setSourceSuppressed(suppressed: boolean): void {
    for (const target of this.targets) {
      target.setSourceSuppressed(suppressed);
    }
  }
}
