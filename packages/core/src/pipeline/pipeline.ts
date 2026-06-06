import {
  createSpeechRecognizer,
  type MockSpeechRecognizerDeps,
  type SpeechRecognizer,
  type UnrecognizedEvent,
} from '../asr/recognizer.js';
import { FileAudioIngestor, type AudioIngestor } from '../audio/ingestor.js';
import {
  createCorrectionEngine,
  type CorrectionEngine,
} from '../correct/correctionEngine.js';
import type {
  AudioSourceKind,
  AudioSourceSelection,
  ContextWindowEntry,
  SourceSegment,
  ZhSegment,
} from '../models.js';
import { createLatencyMonitor, type LatencyMonitor } from '../perf/latencyMonitor.js';
import { TUNED_CONTEXT_WINDOW_SIZE, TUNED_SEGMENT_MAP_RETENTION } from '../perf/tuning.js';
import {
  createTranscriptStore,
  type TranscriptStore,
} from '../transcript/store.js';
import { createTranslator, type Translator } from '../translate/translator.js';
import {
  shouldDuckSource,
  type SourceDuckController,
  type SourceMonitor,
} from '../audio/sourceDuck.js';
import { createAudioSynthesizer, type AudioSynthesizer } from '../tts/synthesizer.js';
import { BoundedAsyncQueue } from './boundedQueue.js';
import {
  DEFAULT_FRAME_QUEUE_SIZE,
  DEFAULT_PARTIAL_LOAD_THRESHOLD,
  DEFAULT_PARTIAL_THROTTLE_MS,
} from './constants.js';

export interface PipelineStartOptions {
  sessionId: string;
  selection: AudioSourceSelection;
  showSourceText?: boolean;
}

export interface SubtitleUpdate {
  segment: ZhSegment;
  capturedAt: number;
}

export interface PipelineConfig {
  ingestor?: AudioIngestor;
  recognizer?: SpeechRecognizer;
  recognizerDeps?: MockSpeechRecognizerDeps;
  translator?: Translator;
  correctionEngine?: CorrectionEngine;
  transcriptStore?: TranscriptStore;
  synthesizer?: AudioSynthesizer;
  latencyMonitor?: LatencyMonitor;
  sourceDuckController?: SourceDuckController;
  sourceMonitor?: SourceMonitor;
  frameQueueSize?: number;
  partialThrottleMs?: number;
  partialLoadThreshold?: number;
  contextWindowSize?: number;
  segmentMapRetention?: number;
  now?: () => number;
}

export interface PipelineMemorySnapshot {
  contextEntries: number;
  segmentMaps: number;
}

export interface Pipeline {
  start(options: PipelineStartOptions): Promise<void>;
  stop(): Promise<void>;
  onSubtitle(handler: (update: SubtitleUpdate) => void): () => void;
  onUnrecognized(handler: (event: UnrecognizedEvent) => void): () => void;
  onLatencyWarning(handler: (active: boolean) => void): () => void;
  getTranscriptStore(): TranscriptStore;
  getProcessedFrameCount(): number;
  getEnqueuedFrameCount(): number;
  getDroppedFrameCount(): number;
  getLatencyMonitor(): LatencyMonitor;
  getMemorySnapshot(): PipelineMemorySnapshot;
}

type SubtitleHandler = (update: SubtitleUpdate) => void;

export class PipelineImpl implements Pipeline {
  private readonly ingestor: AudioIngestor;
  private readonly recognizer: SpeechRecognizer;
  private readonly translator: Translator;
  private readonly correctionEngine: CorrectionEngine;
  private readonly transcriptStore: TranscriptStore;
  private readonly synthesizer: AudioSynthesizer;
  private readonly latencyMonitor: LatencyMonitor;
  private readonly sourceDuckController?: SourceDuckController;
  private readonly sourceMonitor?: SourceMonitor;
  private readonly frameQueue: BoundedAsyncQueue<import('../models.js').AudioFrame>;
  private readonly partialThrottleMs: number;
  private readonly partialLoadThreshold: number;
  private readonly contextWindowSize: number;
  private readonly segmentMapRetention: number;
  private readonly now: () => number;

  private readonly subtitleHandlers = new Set<SubtitleHandler>();
  private readonly partialLastEmittedAt = new Map<string, number>();
  private readonly capturedAtBySegment = new Map<string, number>();
  private readonly contextEntries: ContextWindowEntry[] = [];

  private running = false;
  private showSourceText = false;
  private audioSourceKind: AudioSourceKind = 'file';
  private enqueuedFrameCount = 0;
  private processedFrameCount = 0;
  private unsubscribeIngestor: (() => void) | undefined;
  private unsubscribeRecognizer: (() => void) | undefined;
  private unsubscribeUnrecognized: (() => void) | undefined;
  private unsubscribeCorrection: (() => void) | undefined;
  private unsubscribeLatency: (() => void) | undefined;

  constructor(config: PipelineConfig = {}) {
    this.ingestor = config.ingestor ?? new FileAudioIngestor();
    this.recognizer =
      config.recognizer ?? createSpeechRecognizer(config.recognizerDeps ?? {});
    this.translator = config.translator ?? createTranslator();
    this.correctionEngine = config.correctionEngine ?? createCorrectionEngine();
    this.transcriptStore = config.transcriptStore ?? createTranscriptStore();
    this.synthesizer = config.synthesizer ?? createAudioSynthesizer();
    this.latencyMonitor = config.latencyMonitor ?? createLatencyMonitor();
    this.sourceDuckController = config.sourceDuckController;
    this.sourceMonitor = config.sourceMonitor;
    this.frameQueue = new BoundedAsyncQueue(config.frameQueueSize ?? DEFAULT_FRAME_QUEUE_SIZE);

    this.synthesizer.onPlaybackStateChange((playing) => {
      if (!shouldDuckSource(this.audioSourceKind)) {
        return;
      }

      this.sourceDuckController?.setSourceSuppressed(playing);
      this.sourceMonitor?.setSourceSuppressed(playing);
    });
    this.partialThrottleMs = config.partialThrottleMs ?? DEFAULT_PARTIAL_THROTTLE_MS;
    this.partialLoadThreshold = config.partialLoadThreshold ?? DEFAULT_PARTIAL_LOAD_THRESHOLD;
    this.contextWindowSize = config.contextWindowSize ?? TUNED_CONTEXT_WINDOW_SIZE;
    this.segmentMapRetention = config.segmentMapRetention ?? TUNED_SEGMENT_MAP_RETENTION;
    this.now = config.now ?? (() => Date.now());
  }

  async start(options: PipelineStartOptions): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    this.showSourceText = options.showSourceText ?? false;
    this.audioSourceKind = options.selection.kind;
    this.enqueuedFrameCount = 0;
    this.processedFrameCount = 0;
    this.partialLastEmittedAt.clear();
    this.capturedAtBySegment.clear();
    this.contextEntries.length = 0;
    this.frameQueue.clear();

    this.recognizer.reset();
    this.correctionEngine.reset();
    this.transcriptStore.reset();
    this.latencyMonitor.reset();

    this.unsubscribeIngestor = this.ingestor.onFrame((frame) => {
      this.enqueuedFrameCount += 1;
      if (this.sourceMonitor && shouldDuckSource(this.audioSourceKind)) {
        this.sourceMonitor.pushFrame(frame);
      }
      void this.frameQueue.enqueue(frame);
    });
    this.unsubscribeRecognizer = this.recognizer.onSegment((segment) => {
      void this.handleSourceSegment(segment);
    });
    this.unsubscribeUnrecognized = this.recognizer.onUnrecognized((event) => {
      for (const handler of this.unrecognizedHandlers) {
        handler(event);
      }
    });
    this.unsubscribeCorrection = this.correctionEngine.onRevision((segment) => {
      this.transcriptStore.applyCorrection(segment);
      this.emitSubtitle(segment, this.capturedAtBySegment.get(segment.id) ?? this.now());
    });
    this.unsubscribeLatency = this.latencyMonitor.onWarningChange((active) => {
      for (const handler of this.latencyWarningHandlers) {
        handler(active);
      }
    });

    void this.runFrameProcessor();
    await this.ingestor.start({
      sessionId: options.sessionId,
      selection: options.selection,
    });
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }

    this.running = false;
    this.sourceMonitor?.stop();
    await this.ingestor.stop();
    this.recognizer.flush();
    this.frameQueue.clear();
    this.unsubscribeIngestor?.();
    this.unsubscribeRecognizer?.();
    this.unsubscribeUnrecognized?.();
    this.unsubscribeCorrection?.();
    this.unsubscribeLatency?.();
  }

  onSubtitle(handler: SubtitleHandler): () => void {
    this.subtitleHandlers.add(handler);
    return () => {
      this.subtitleHandlers.delete(handler);
    };
  }

  private readonly unrecognizedHandlers = new Set<(event: UnrecognizedEvent) => void>();

  onUnrecognized(handler: (event: UnrecognizedEvent) => void): () => void {
    this.unrecognizedHandlers.add(handler);
    return () => {
      this.unrecognizedHandlers.delete(handler);
    };
  }

  private readonly latencyWarningHandlers = new Set<(active: boolean) => void>();

  onLatencyWarning(handler: (active: boolean) => void): () => void {
    this.latencyWarningHandlers.add(handler);
    return () => {
      this.latencyWarningHandlers.delete(handler);
    };
  }

  getTranscriptStore(): TranscriptStore {
    return this.transcriptStore;
  }

  getProcessedFrameCount(): number {
    return this.processedFrameCount;
  }

  getEnqueuedFrameCount(): number {
    return this.enqueuedFrameCount;
  }

  getDroppedFrameCount(): number {
    return Math.max(0, this.enqueuedFrameCount - this.processedFrameCount);
  }

  getLatencyMonitor(): LatencyMonitor {
    return this.latencyMonitor;
  }

  getMemorySnapshot(): PipelineMemorySnapshot {
    return {
      contextEntries: this.contextEntries.length,
      segmentMaps: this.capturedAtBySegment.size + this.partialLastEmittedAt.size,
    };
  }

  private async runFrameProcessor(): Promise<void> {
    while (this.running) {
      const frame = await this.frameQueue.dequeue();
      if (!this.running) {
        break;
      }

      this.recognizer.pushAudio(frame);
      this.processedFrameCount += 1;
    }
  }

  private async handleSourceSegment(segment: SourceSegment): Promise<void> {
    this.capturedAtBySegment.set(segment.id, segment.startedAt);

    if (segment.status === 'partial') {
      if (!this.shouldEmitPartial(segment.id)) {
        return;
      }

      await this.translateAndEmitPartial(segment);
      return;
    }

    const zh = await this.translator.translateFinal(segment, { entries: this.contextEntries });
    await this.emitSubtitleWithSideEffects(zh, segment.startedAt);

    const revisions = await this.correctionEngine.handleSourceSegment(segment, this.now());
    for (const revision of revisions) {
      this.transcriptStore.applyCorrection(revision);
      await this.emitSubtitleWithSideEffects(revision, segment.startedAt);
    }

    this.contextEntries.push({
      id: segment.id,
      sourceText: segment.text,
      zhText: zh.zhText,
      spokenIndex: segment.spokenIndex,
    });
    this.trimContextWindow();
    this.trimSegmentMaps();
  }

  private async translateAndEmitPartial(segment: SourceSegment): Promise<void> {
    let zhText = '';
    try {
      for await (const token of this.translator.translatePartial(segment)) {
        zhText += token;
        const partial: ZhSegment = {
          id: segment.id,
          sessionId: segment.sessionId,
          sourceText: segment.text,
          zhText,
          status: 'partial',
          spokenIndex: segment.spokenIndex,
          untranslated: false,
        };
        await this.emitSubtitleWithSideEffects(partial, segment.startedAt);
      }
    } catch {
      const fallback = {
        id: segment.id,
        sessionId: segment.sessionId,
        sourceText: segment.text,
        zhText: segment.text,
        status: 'partial' as const,
        spokenIndex: segment.spokenIndex,
        untranslated: true,
      };
      await this.emitSubtitleWithSideEffects(fallback, segment.startedAt);
    }
  }

  private async emitSubtitleWithSideEffects(
    segment: ZhSegment,
    capturedAt: number,
  ): Promise<void> {
    const displayedAt = this.now();
    this.correctionEngine.recordDisplayed(segment, displayedAt);

    if (segment.status === 'partial') {
      this.latencyMonitor.recordPartial(capturedAt, displayedAt);
    }

    if (segment.status === 'final') {
      this.transcriptStore.appendFinal(segment, { showSourceText: this.showSourceText });
      this.synthesizer.enqueue(segment);
    }

    this.emitSubtitle(segment, capturedAt);
  }

  private emitSubtitle(segment: ZhSegment, capturedAt: number): void {
    for (const handler of this.subtitleHandlers) {
      handler({ segment, capturedAt });
    }
  }

  private shouldEmitPartial(segmentId: string): boolean {
    const occupancy = this.frameQueue.size / this.frameQueue.capacity;
    const throttleMs =
      occupancy >= this.partialLoadThreshold
        ? this.partialThrottleMs * 2
        : this.partialThrottleMs;
    const lastEmittedAt = this.partialLastEmittedAt.get(segmentId) ?? 0;
    const current = this.now();

    if (current - lastEmittedAt < throttleMs) {
      return false;
    }

    this.partialLastEmittedAt.set(segmentId, current);
    this.trimSegmentMaps();
    return true;
  }

  private trimContextWindow(): void {
    while (this.contextEntries.length > this.contextWindowSize) {
      const removed = this.contextEntries.shift();
      if (removed) {
        this.capturedAtBySegment.delete(removed.id);
        this.partialLastEmittedAt.delete(removed.id);
      }
    }
  }

  private trimSegmentMaps(): void {
    const maxEntries = this.segmentMapRetention;
    while (this.capturedAtBySegment.size > maxEntries) {
      const oldestKey = this.capturedAtBySegment.keys().next().value;
      if (!oldestKey) {
        break;
      }
      this.capturedAtBySegment.delete(oldestKey);
      this.partialLastEmittedAt.delete(oldestKey);
    }
  }
}

export function createPipeline(config: PipelineConfig = {}): Pipeline {
  return new PipelineImpl(config);
}
