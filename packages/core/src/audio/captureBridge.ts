import type { AudioDeviceInfo, AudioFrame, AudioSourceSelection, SourceLostReason } from '../models.js';

export interface NativeAudioCaptureBridge {
  listSources(): Promise<AudioDeviceInfo[]>;
  startCapture(options: {
    sessionId: string;
    selection: AudioSourceSelection;
  }): Promise<void>;
  stopCapture(): Promise<void>;
  onFrame(handler: (frame: AudioFrame) => void): () => void;
  onSourceLost(handler: (reason: SourceLostReason) => void): () => void;
}
