import type {
  AudioDeviceInfo,
  AudioFrame,
  AudioSourceSelection,
  SourceLostReason,
} from '../models.js';
import { chunkPcm, buildAudioFrame, type PcmFrameChunk } from './frameUtils.js';
import { decodeWavToMono16k, WavDecodeError } from './wavDecoder.js';

export type StartRejectionReason = 'no_source_selected' | 'source_inaccessible';

export class NoAudioSourceSelectedError extends Error {
  readonly reason = 'no_source_selected' as const;

  constructor(message = 'No audio source selected') {
    super(message);
    this.name = 'NoAudioSourceSelectedError';
  }
}

export class SourceInaccessibleError extends Error {
  readonly reason = 'source_inaccessible' as const;

  constructor(message = 'Audio source is inaccessible') {
    super(message);
    this.name = 'SourceInaccessibleError';
  }
}

export class IngestorAlreadyRunningError extends Error {
  constructor(message = 'Audio ingestor is already running') {
    super(message);
    this.name = 'IngestorAlreadyRunningError';
  }
}

type FrameHandler = (frame: AudioFrame) => void;
type SourceLostHandler = (reason: SourceLostReason) => void;
type FileEndHandler = () => void;
type StartRejectedHandler = (reason: StartRejectionReason) => void;

export interface AudioIngestorStartOptions {
  sessionId: string;
  selection: AudioSourceSelection;
}

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;
type ScheduleFn = (fn: () => void, delayMs: number) => TimerHandle;
type CancelScheduleFn = (handle: TimerHandle) => void;

const defaultSchedule: ScheduleFn = (fn, delayMs) => globalThis.setTimeout(fn, delayMs);
const defaultCancelSchedule: CancelScheduleFn = (handle) => globalThis.clearTimeout(handle);

export interface AudioIngestorDeps {
  now?: () => number;
  setTimeoutFn?: ScheduleFn;
  clearTimeoutFn?: CancelScheduleFn;
  readFile?: (filePath: string) => Promise<ArrayBuffer>;
  isFileAccessible?: (filePath: string) => Promise<boolean>;
  listDeviceSources?: () => AudioDeviceInfo[];
}

const DEFAULT_DEVICES: AudioDeviceInfo[] = [
  { id: 'system:default', label: 'System playback', kind: 'system' },
  { id: 'microphone:default', label: 'Microphone', kind: 'microphone' },
];

export interface AudioIngestor {
  listSources(): Promise<AudioDeviceInfo[]>;
  start(options: AudioIngestorStartOptions): Promise<void>;
  stop(): Promise<void>;
  onFrame(handler: FrameHandler): () => void;
  onSourceLost(handler: SourceLostHandler): () => void;
  onFileEnd(handler: FileEndHandler): () => void;
  onStartRejected(handler: StartRejectedHandler): () => void;
  isRunning(): boolean;
}

export class FileAudioIngestor implements AudioIngestor {
  private readonly now: () => number;
  private readonly setTimeoutFn: ScheduleFn;
  private readonly clearTimeoutFn: CancelScheduleFn;
  private readonly readFile: (filePath: string) => Promise<ArrayBuffer>;
  private readonly isFileAccessible: (filePath: string) => Promise<boolean>;
  private readonly listDeviceSources: () => AudioDeviceInfo[];

  private running = false;
  private sessionId = '';
  private seq = 0;
  private pacingTimer: TimerHandle | null = null;
  private streamStartAt = 0;
  private frameQueue: PcmFrameChunk[] = [];
  private frameIndex = 0;

  private readonly frameHandlers = new Set<FrameHandler>();
  private readonly sourceLostHandlers = new Set<SourceLostHandler>();
  private readonly fileEndHandlers = new Set<FileEndHandler>();
  private readonly startRejectedHandlers = new Set<StartRejectedHandler>();

  constructor(deps: AudioIngestorDeps = {}) {
    this.now = deps.now ?? (() => Date.now());
    this.setTimeoutFn = deps.setTimeoutFn ?? defaultSchedule;
    this.clearTimeoutFn = deps.clearTimeoutFn ?? defaultCancelSchedule;
    this.readFile = deps.readFile ?? (async () => {
      throw new SourceInaccessibleError('File reading is not configured');
    });
    this.isFileAccessible =
      deps.isFileAccessible ?? (async () => {
        throw new SourceInaccessibleError('File accessibility check is not configured');
      });
    this.listDeviceSources = deps.listDeviceSources ?? (() => DEFAULT_DEVICES);
  }

  async listSources(): Promise<AudioDeviceInfo[]> {
    return this.listDeviceSources();
  }

  async start(options: AudioIngestorStartOptions): Promise<void> {
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

    if (options.selection.kind !== 'file') {
      this.emitStartRejected('source_inaccessible');
      throw new SourceInaccessibleError(
        `Audio source kind "${options.selection.kind}" is not available in this build`,
      );
    }

    const filePath = options.selection.filePath!;
    const accessible = await this.isFileAccessible(filePath);
    if (!accessible) {
      this.emitStartRejected('source_inaccessible');
      throw new SourceInaccessibleError(`Cannot access file: ${filePath}`);
    }

    let pcm: Float32Array;
    try {
      const buffer = await this.readFile(filePath);
      pcm = decodeWavToMono16k(buffer);
    } catch (error) {
      this.emitStartRejected('source_inaccessible');
      if (error instanceof WavDecodeError) {
        throw new SourceInaccessibleError(error.message);
      }
      throw error;
    }

    this.sessionId = options.sessionId;
    this.seq = 0;
    this.frameIndex = 0;
    this.frameQueue = chunkPcm(pcm);
    this.streamStartAt = this.now();
    this.running = true;

    if (this.frameQueue.length === 0) {
      this.finishFile();
      return;
    }

    this.scheduleNextFrame();
  }

  async stop(): Promise<void> {
    this.clearPacingTimer();
    this.running = false;
    this.frameQueue = [];
    this.frameIndex = 0;
    this.sessionId = '';
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

  /** Signals source loss while capturing (e.g. unreadable file mid-stream). */
  signalSourceLost(reason: SourceLostReason): void {
    if (!this.running) {
      return;
    }
    void this.stop();
    for (const handler of this.sourceLostHandlers) {
      handler(reason);
    }
  }

  private validateSelection(selection: AudioSourceSelection | undefined): StartRejectionReason | null {
    if (!selection?.kind) {
      return 'no_source_selected';
    }

    if (selection.kind === 'file' && !selection.filePath?.trim()) {
      return 'no_source_selected';
    }

    return null;
  }

  private scheduleNextFrame(): void {
    if (!this.running || this.frameIndex >= this.frameQueue.length) {
      this.finishFile();
      return;
    }

    const chunk = this.frameQueue[this.frameIndex];
    const scheduledAt = this.streamStartAt + this.frameIndex * chunk.durationMs;
    const delay = Math.max(0, scheduledAt - this.now());

    this.pacingTimer = this.setTimeoutFn(() => {
      this.emitFrame(chunk);
      this.frameIndex += 1;
      this.scheduleNextFrame();
    }, delay);
  }

  private emitFrame(chunk: PcmFrameChunk): void {
    const frame = buildAudioFrame({
      sessionId: this.sessionId,
      seq: this.seq,
      capturedAt: this.now(),
      pcm: chunk.pcm,
      durationMs: chunk.durationMs,
    });
    this.seq += 1;

    for (const handler of this.frameHandlers) {
      handler(frame);
    }
  }

  private finishFile(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    this.clearPacingTimer();

    for (const handler of this.fileEndHandlers) {
      handler();
    }
  }

  private clearPacingTimer(): void {
    if (this.pacingTimer !== null) {
      this.clearTimeoutFn(this.pacingTimer);
      this.pacingTimer = null;
    }
  }

  private emitStartRejected(reason: StartRejectionReason): void {
    for (const handler of this.startRejectedHandlers) {
      handler(reason);
    }
  }
}

/** Factory for the default file-capable audio ingestor. */
export function createAudioIngestor(deps?: AudioIngestorDeps): AudioIngestor {
  return new FileAudioIngestor(deps);
}

export type { NativeAudioCaptureBridge } from './captureBridge.js';
export { StreamAudioIngestor } from './streamIngestor.js';
export { SessionIngestor, createSessionIngestor, type SessionIngestorDeps } from './sessionIngestor.js';
