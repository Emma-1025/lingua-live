import type { AudioDeviceInfo, AudioSourceSelection } from '../models.js';
import type { NativeAudioCaptureBridge } from './captureBridge.js';
import {
  FileAudioIngestor,
  type AudioIngestor,
  type AudioIngestorDeps,
  type AudioIngestorStartOptions,
} from './ingestor.js';
import { StreamAudioIngestor } from './streamIngestor.js';

export interface SessionIngestorDeps extends AudioIngestorDeps {
  captureBridge?: NativeAudioCaptureBridge;
}

/**
 * Delegates to a file ingestor or stream ingestor depending on the selected source.
 */
export class SessionIngestor implements AudioIngestor {
  private readonly fileIngestor: FileAudioIngestor;
  private readonly streamIngestor: StreamAudioIngestor;
  private active: AudioIngestor | null = null;

  constructor(deps: SessionIngestorDeps = {}) {
    this.fileIngestor = new FileAudioIngestor(deps);
    this.streamIngestor = new StreamAudioIngestor({ bridge: deps.captureBridge });
  }

  async listSources(): Promise<AudioDeviceInfo[]> {
    const [fileSources, streamSources] = await Promise.all([
      this.fileIngestor.listSources(),
      this.streamIngestor.listSources(),
    ]);

    const merged = new Map<string, AudioDeviceInfo>();
    for (const source of [...fileSources, ...streamSources]) {
      merged.set(`${source.kind}:${source.id}`, source);
    }
    return [...merged.values()];
  }

  async start(options: AudioIngestorStartOptions): Promise<void> {
    this.active = this.pickIngestor(options.selection);
    await this.active.start(options);
  }

  async stop(): Promise<void> {
    await this.active?.stop();
    this.active = null;
  }

  isRunning(): boolean {
    return this.active?.isRunning() ?? false;
  }

  isPaused(): boolean {
    return this.active?.isPaused() ?? false;
  }

  async pause(): Promise<void> {
    await this.active?.pause();
  }

  async resume(): Promise<void> {
    await this.active?.resume();
  }

  onFrame(handler: Parameters<AudioIngestor['onFrame']>[0]): () => void {
    const unsubscribers = [this.fileIngestor.onFrame(handler), this.streamIngestor.onFrame(handler)];
    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }

  onSourceLost(handler: Parameters<AudioIngestor['onSourceLost']>[0]): () => void {
    const unsubscribers = [
      this.fileIngestor.onSourceLost(handler),
      this.streamIngestor.onSourceLost(handler),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }

  onFileEnd(handler: Parameters<AudioIngestor['onFileEnd']>[0]): () => void {
    const unsubscribers = [this.fileIngestor.onFileEnd(handler), this.streamIngestor.onFileEnd(handler)];
    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }

  onStartRejected(handler: Parameters<AudioIngestor['onStartRejected']>[0]): () => void {
    const unsubscribers = [
      this.fileIngestor.onStartRejected(handler),
      this.streamIngestor.onStartRejected(handler),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }

  private pickIngestor(selection: AudioSourceSelection): AudioIngestor {
    return selection.kind === 'file' ? this.fileIngestor : this.streamIngestor;
  }
}

export function createSessionIngestor(deps: SessionIngestorDeps = {}): SessionIngestor {
  return new SessionIngestor(deps);
}
