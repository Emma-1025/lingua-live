import { VadSegmenter } from '../audio/segmenter.js';
import type { VadSegmenterConfig } from '../audio/segmenter.js';
import {
  DEFAULT_SOURCE_LANGUAGE,
  type AudioFrame,
  type SegmentStatus,
  type SourceSegment,
  type SupportedSourceLanguage,
} from '../models.js';
import { SpokenIndexAllocator } from '../utils/ids.js';
import {
  FINAL_RECOGNITION_LATENCY_MS,
  PARTIAL_RECOGNITION_LATENCY_MS,
} from './constants.js';

export type HypothesisText = string | Partial<Record<SupportedSourceLanguage, string>>;

export interface MockAsrHypothesis {
  text: HypothesisText;
  status: SegmentStatus;
  /** Delay from segment open before emitting this hypothesis. */
  delayMs: number;
}

export interface MockAsrSegmentScript {
  /** When true, emit onUnrecognized on segment close and no SourceSegment. */
  unrecognized?: boolean;
  hypotheses?: MockAsrHypothesis[];
}

export interface MockAsrDriver {
  getScript(segmentIndex: number): MockAsrSegmentScript;
}

export interface UnrecognizedEvent {
  sessionId: string;
  segmentId: string;
  spokenIndex: number;
  startedAt: number;
}

type SegmentHandler = (segment: SourceSegment) => void;
type UnrecognizedHandler = (event: UnrecognizedEvent) => void;

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;
type ScheduleFn = (fn: () => void, delayMs: number) => TimerHandle;
type CancelScheduleFn = (handle: TimerHandle) => void;

const defaultSchedule: ScheduleFn = (fn, delayMs) => globalThis.setTimeout(fn, delayMs);
const defaultCancelSchedule: CancelScheduleFn = (handle) => globalThis.clearTimeout(handle);

const DEFAULT_PARTIAL_SCRIPT: MockAsrHypothesis[] = [
  { text: '...', status: 'partial', delayMs: 500 },
  { text: '...', status: 'final', delayMs: 1_500 },
];

export interface SpeechRecognizer {
  setLanguage(lang: SupportedSourceLanguage): void;
  getLanguage(): SupportedSourceLanguage;
  pushAudio(frame: AudioFrame): void;
  flush(): void;
  reset(): void;
  onSegment(handler: SegmentHandler): () => void;
  onUnrecognized(handler: UnrecognizedHandler): () => void;
}

export interface MockSpeechRecognizerDeps {
  driver?: MockAsrDriver;
  segmenter?: VadSegmenter;
  segmenterConfig?: VadSegmenterConfig;
  spokenIndexAllocator?: SpokenIndexAllocator;
  setTimeoutFn?: ScheduleFn;
  clearTimeoutFn?: CancelScheduleFn;
}

interface ActiveSegment {
  segmentId: string;
  sessionId: string;
  startedAt: number;
  spokenIndex: number;
  script: MockAsrSegmentScript;
  timers: TimerHandle[];
}

/** Scripted mock ASR driver for deterministic partial→final sequences. */
export class ScriptedMockAsrDriver implements MockAsrDriver {
  constructor(private readonly scripts: MockAsrSegmentScript[]) {}

  getScript(segmentIndex: number): MockAsrSegmentScript {
    return this.scripts[segmentIndex] ?? { hypotheses: DEFAULT_PARTIAL_SCRIPT };
  }
}

function resolveHypothesisText(
  text: HypothesisText,
  language: SupportedSourceLanguage,
): string {
  if (typeof text === 'string') {
    return text;
  }

  return text[language] ?? text[DEFAULT_SOURCE_LANGUAGE] ?? '';
}

function clampHypothesisDelay(status: SegmentStatus, delayMs: number): number {
  const maxDelay =
    status === 'partial' ? PARTIAL_RECOGNITION_LATENCY_MS : FINAL_RECOGNITION_LATENCY_MS;
  return Math.min(Math.max(0, delayMs), maxDelay);
}

/**
 * Mock streaming ASR client that uses VAD boundaries and replays scripted hypotheses.
 */
export class MockSpeechRecognizer implements SpeechRecognizer {
  private readonly segmenter: VadSegmenter;
  private readonly driver: MockAsrDriver;
  private readonly spokenIndexAllocator: SpokenIndexAllocator;
  private readonly schedule: ScheduleFn;
  private readonly cancelSchedule: CancelScheduleFn;

  private language: SupportedSourceLanguage = DEFAULT_SOURCE_LANGUAGE;
  private segmentScriptIndex = 0;
  private readonly activeSegments = new Map<string, ActiveSegment>();
  private readonly segmentHandlers = new Set<SegmentHandler>();
  private readonly unrecognizedHandlers = new Set<UnrecognizedHandler>();

  constructor(deps: MockSpeechRecognizerDeps = {}) {
    this.segmenter = deps.segmenter ?? new VadSegmenter(deps.segmenterConfig);
    this.driver = deps.driver ?? new ScriptedMockAsrDriver([]);
    this.spokenIndexAllocator = deps.spokenIndexAllocator ?? new SpokenIndexAllocator();
    this.schedule = deps.setTimeoutFn ?? defaultSchedule;
    this.cancelSchedule = deps.clearTimeoutFn ?? defaultCancelSchedule;

    this.segmenter.onSegmentOpen((event) => this.handleSegmentOpen(event));
    this.segmenter.onSegmentClose((event) => this.handleSegmentClose(event));
  }

  setLanguage(lang: SupportedSourceLanguage): void {
    this.language = lang;
  }

  getLanguage(): SupportedSourceLanguage {
    return this.language;
  }

  pushAudio(frame: AudioFrame): void {
    this.segmenter.pushFrame(frame);
  }

  flush(): void {
    this.segmenter.flush();
  }

  reset(): void {
    this.clearActiveSegments();
    this.segmenter.reset();
    this.spokenIndexAllocator.reset();
    this.segmentScriptIndex = 0;
  }

  onSegment(handler: SegmentHandler): () => void {
    this.segmentHandlers.add(handler);
    return () => this.segmentHandlers.delete(handler);
  }

  onUnrecognized(handler: UnrecognizedHandler): () => void {
    this.unrecognizedHandlers.add(handler);
    return () => this.unrecognizedHandlers.delete(handler);
  }

  private handleSegmentOpen(event: {
    segmentId: string;
    sessionId: string;
    startedAt: number;
  }): void {
    const script = this.driver.getScript(this.segmentScriptIndex);
    this.segmentScriptIndex += 1;

    const active: ActiveSegment = {
      segmentId: event.segmentId,
      sessionId: event.sessionId,
      startedAt: event.startedAt,
      spokenIndex: this.spokenIndexAllocator.allocate(),
      script,
      timers: [],
    };

    this.activeSegments.set(event.segmentId, active);

    if (script.unrecognized) {
      return;
    }

    for (const hypothesis of script.hypotheses ?? DEFAULT_PARTIAL_SCRIPT) {
      const delayMs = clampHypothesisDelay(hypothesis.status, hypothesis.delayMs);
      const handle = this.schedule(() => {
        this.emitSegment(active, hypothesis);
      }, delayMs);
      active.timers.push(handle);
    }
  }

  private handleSegmentClose(event: { segmentId: string }): void {
    const active = this.activeSegments.get(event.segmentId);
    if (!active) {
      return;
    }

    if (active.script.unrecognized) {
      this.emitUnrecognized(active);
      this.clearSegment(active);
    }

    // Keep scheduled hypotheses alive after close so finals can still arrive.
    this.activeSegments.delete(event.segmentId);
  }

  private emitSegment(active: ActiveSegment, hypothesis: MockAsrHypothesis): void {
    const segment: SourceSegment = {
      id: active.segmentId,
      sessionId: active.sessionId,
      text: resolveHypothesisText(hypothesis.text, this.language),
      status: hypothesis.status,
      startedAt: active.startedAt,
      spokenIndex: active.spokenIndex,
      recognizable: true,
    };

    for (const handler of this.segmentHandlers) {
      handler(segment);
    }
  }

  private emitUnrecognized(active: ActiveSegment): void {
    const event: UnrecognizedEvent = {
      sessionId: active.sessionId,
      segmentId: active.segmentId,
      spokenIndex: active.spokenIndex,
      startedAt: active.startedAt,
    };

    for (const handler of this.unrecognizedHandlers) {
      handler(event);
    }
  }

  private clearSegment(active: ActiveSegment): void {
    for (const handle of active.timers) {
      this.cancelSchedule(handle);
    }
    active.timers.length = 0;
  }

  private clearActiveSegments(): void {
    for (const active of this.activeSegments.values()) {
      this.clearSegment(active);
    }
    this.activeSegments.clear();
  }
}

export function createSpeechRecognizer(
  deps: MockSpeechRecognizerDeps = {},
): SpeechRecognizer {
  return new MockSpeechRecognizer(deps);
}
