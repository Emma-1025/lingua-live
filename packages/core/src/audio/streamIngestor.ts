import type { AudioDeviceInfo, AudioFrame, AudioSourceSelection, SourceLostReason } from '../models.js';
import type { NativeAudioCaptureBridge } from './captureBridge.js';
import {
  IngestorAlreadyRunningError,
  NoAudioSourceSelectedError,
  SourceInaccessibleError,
  type StartRejectionReason,
} from './ingestor.js';

type FrameHandler = (frame: AudioFrame) => void;
type SourceLostHandler = (reason: SourceLostReason) => void;
type FileEndHandler = () => void;
type StartRejectedHandler = (reason: StartRejectionReason) => void;

const DEFAULT_DEVICES: AudioDeviceInfo[] = [
  { id: 'system:default', label: 'System playback', kind: 'system' },
  { id: 'microphone:default', label: 'Microphone', kind: 'microphone' },
];

export interface StreamAudioIngestorConfig {
  bridge?: NativeAudioCaptureBridge;
  listDeviceSources?: () => AudioDeviceInfo[];
}

/**
 * Audio ingestor for live device/system capture. Frames are pushed by a native
 * bridge (e.g. Tauri desktop shell) rather than read from a file.
 */
export class StreamAudioIngestor {
  private readonly bridge: NativeAudioCaptureBridge | undefined;
  private readonly listDeviceSources: () => AudioDeviceInfo[];

  private running = false;
  private unsubscribeBridgeFrame: (() => void) | undefined;
  private unsubscribeBridgeLost: (() => void) | undefined;

  private readonly frameHandlers = new Set<FrameHandler>();
  private readonly sourceLostHandlers = new Set<SourceLostHandler>();
  private readonly fileEndHandlers = new Set<FileEndHandler>();
  private readonly startRejectedHandlers = new Set<StartRejectedHandler>();

  constructor(config: StreamAudioIngestorConfig = {}) {
    this.bridge = config.bridge;
    this.listDeviceSources = config.listDeviceSources ?? (() => DEFAULT_DEVICES);
  }

  async listSources(): Promise<AudioDeviceInfo[]> {
    if (this.bridge) {
      return this.bridge.listSources();
    }
    return this.listDeviceSources();
  }

  async start(options: {
    sessionId: string;
    selection: AudioSourceSelection;
  }): Promise<void> {
    if (this.running) {
      throw new IngestorAlreadyRunningError();
    }

    const rejection = this.validateSelection(options.selection);
    if (rejection) {
      this.emitStartRejected(rejection);
      if (rejection === 'no_source_selected') {
        throw new NoAudioSourceSelectedError();
      }
      throw new SourceInaccessibleError();
    }

    if (options.selection.kind === 'file') {
      this.emitStartRejected('source_inaccessible');
      throw new SourceInaccessibleError('Stream ingestor cannot play file sources');
    }

    if (!this.bridge) {
      this.emitStartRejected('source_inaccessible');
      throw new SourceInaccessibleError('Native audio capture is not available in this build');
    }

    this.unsubscribeBridgeFrame = this.bridge.onFrame((frame) => {
      for (const handler of this.frameHandlers) {
        handler(frame);
      }
    });
    this.unsubscribeBridgeLost = this.bridge.onSourceLost((reason) => {
      this.signalSourceLost(reason);
    });

    try {
      await this.bridge.startCapture(options);
      this.running = true;
    } catch (error) {
      this.detachBridge();
      this.emitStartRejected('source_inaccessible');
      throw error instanceof SourceInaccessibleError
        ? error
        : new SourceInaccessibleError(
            error instanceof Error ? error.message : 'Failed to start native capture',
          );
    }
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;
    await this.bridge?.stopCapture();
    this.detachBridge();
  }

  isRunning(): boolean {
    return this.running;
  }

  onFrame(handler: FrameHandler): () => void {
    this.frameHandlers.add(handler);
    return () => this.frameHandlers.delete(handler);
  }

  onSourceLost(handler: SourceLostHandler): () => void {
    this.sourceLostHandlers.add(handler);
    return () => this.sourceLostHandlers.delete(handler);
  }

  onFileEnd(handler: FileEndHandler): () => void {
    this.fileEndHandlers.add(handler);
    return () => this.fileEndHandlers.delete(handler);
  }

  onStartRejected(handler: StartRejectedHandler): () => void {
    this.startRejectedHandlers.add(handler);
    return () => this.startRejectedHandlers.delete(handler);
  }

  signalSourceLost(reason: SourceLostReason): void {
    if (!this.running) {
      return;
    }

    void this.stop();
    for (const handler of this.sourceLostHandlers) {
      handler(reason);
    }
  }

  private validateSelection(
    selection: AudioSourceSelection | undefined,
  ): StartRejectionReason | null {
    if (!selection?.kind) {
      return 'no_source_selected';
    }

    if (selection.kind === 'file') {
      return 'source_inaccessible';
    }

    return null;
  }

  private detachBridge(): void {
    this.unsubscribeBridgeFrame?.();
    this.unsubscribeBridgeLost?.();
    this.unsubscribeBridgeFrame = undefined;
    this.unsubscribeBridgeLost = undefined;
  }

  private emitStartRejected(reason: StartRejectionReason): void {
    for (const handler of this.startRejectedHandlers) {
      handler(reason);
    }
  }
}
