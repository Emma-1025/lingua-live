export interface AudioPlayer {
  play(buffer: ArrayBuffer, volumeLevel: number): Promise<void>;
  stop(): void;
}

export interface WebAudioPlayerConfig {
  audioContext?: AudioContext;
  maxVolumeLevel?: number;
}

/**
 * Plays synthesized audio through the Web Audio API with discrete volume levels.
 */
export class WebAudioPlayer implements AudioPlayer {
  private readonly audioContext: AudioContext;
  private readonly maxVolumeLevel: number;
  private activeSource: AudioBufferSourceNode | null = null;
  private activeGain: GainNode | null = null;
  private playPromise: Promise<void> | null = null;
  private resolvePlayback: (() => void) | null = null;

  constructor(config: WebAudioPlayerConfig = {}) {
    this.audioContext = config.audioContext ?? new AudioContext();
    this.maxVolumeLevel = config.maxVolumeLevel ?? 10;
  }

  async play(buffer: ArrayBuffer, volumeLevel: number): Promise<void> {
    this.stop();

    const audioBuffer = await this.audioContext.decodeAudioData(buffer.slice(0));
    const source = this.audioContext.createBufferSource();
    const gain = this.audioContext.createGain();

    source.buffer = audioBuffer;
    gain.gain.value = volumeLevel / this.maxVolumeLevel;
    source.connect(gain);
    gain.connect(this.audioContext.destination);

    this.activeSource = source;
    this.activeGain = gain;

    this.playPromise = new Promise<void>((resolve) => {
      this.resolvePlayback = resolve;
      source.onended = () => {
        this.clearActive();
        resolve();
      };
      source.start();
    });

    await this.playPromise;
  }

  stop(): void {
    if (this.activeSource) {
      try {
        this.activeSource.stop();
      } catch {
        // Already stopped.
      }
    }

    this.clearActive();
    this.resolvePlayback?.();
    this.resolvePlayback = null;
    this.playPromise = null;
  }

  private clearActive(): void {
    this.activeSource = null;
    this.activeGain = null;
  }
}

export function createWebAudioPlayer(config?: WebAudioPlayerConfig): AudioPlayer {
  return new WebAudioPlayer(config);
}
