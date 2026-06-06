import { ScriptedMockAsrDriver } from '../asr/recognizer.js';
import type { CorrectionEngine } from '../correct/correctionEngine.js';
import { createPipeline, type PipelineConfig } from '../pipeline/pipeline.js';
import { TranslatorImpl } from '../translate/translator.js';
import {
  createFastDeepSeekClient,
  createFramesForScripts,
  createGoldenClipScripts,
  createStreamingIngestor,
} from './harness.js';
import {
  SOAK_LOOP_COUNT,
  SOAK_LOOP_DURATION_MS,
  SOAK_TARGET_DURATION_MS,
  TUNED_CONTEXT_WINDOW_SIZE,
  TUNED_SEGMENT_MAP_RETENTION,
  createTunedPipelineOptions,
  PARTIAL_LATENCY_TARGET_MS,
} from './tuning.js';

export interface SoakMemorySnapshot {
  contextEntries: number;
  segmentMaps: number;
}

export interface SoakTestResult {
  simulatedDurationMs: number;
  loopCount: number;
  totalFrames: number;
  droppedFrames: number;
  peakP95LatencyMs: number;
  finalP95LatencyMs: number;
  peakMemory: SoakMemorySnapshot;
}

export interface SoakTestOptions {
  loopCount?: number;
  pipelineConfig?: PipelineConfig;
}

export function createLoopedSoakScripts(loopCount: number) {
  return Array.from({ length: loopCount }, () => createGoldenClipScripts()).flat();
}

export function createLoopedSoakFrames(loopCount: number, sessionId = 'sess-soak') {
  const clipFrames = createFramesForScripts(createGoldenClipScripts(), sessionId);
  const frames = [];
  let capturedAt = 1_000;
  let seq = 0;

  for (let loop = 0; loop < loopCount; loop += 1) {
    for (const frame of clipFrames) {
      frames.push({
        ...frame,
        sessionId,
        seq,
        capturedAt,
      });
      capturedAt += frame.durationMs;
      seq += 1;
    }
  }

  return frames;
}

export async function runSoakTest(options: SoakTestOptions = {}): Promise<SoakTestResult> {
  const loopCount = options.loopCount ?? SOAK_LOOP_COUNT;
  const tuning = createTunedPipelineOptions();
  const scripts = createLoopedSoakScripts(loopCount);
  const frames = createLoopedSoakFrames(loopCount);
  const driver = new ScriptedMockAsrDriver(scripts);

  const pipeline = createPipeline({
    ingestor: createStreamingIngestor(frames),
    recognizerDeps: { driver },
    translator: new TranslatorImpl({
      client: createFastDeepSeekClient(),
      contextWindowSize: tuning.contextWindowSize,
    }),
    correctionEngine: createCorrectionEngineStub(),
    frameQueueSize: tuning.frameQueueSize,
    partialThrottleMs: tuning.partialThrottleMs,
    partialLoadThreshold: tuning.partialLoadThreshold,
    contextWindowSize: tuning.contextWindowSize,
    ...options.pipelineConfig,
  });

  await pipeline.start({
    sessionId: 'sess-soak',
    selection: { kind: 'file', filePath: '/audio/golden-en-talk.wav' },
  });

  await waitForProcessing(scripts.length * 2_000);
  await pipeline.stop();

  const monitor = pipeline.getLatencyMonitor();
  const memory = pipeline.getMemorySnapshot();
  const droppedFrames = pipeline.getDroppedFrameCount();
  const finalP95 = monitor.getP95LatencyMs() ?? 0;

  if (droppedFrames > 0) {
    throw new Error(`Soak test dropped ${droppedFrames} frame(s)`);
  }

  if (finalP95 > PARTIAL_LATENCY_TARGET_MS) {
    throw new Error(
      `Soak final p95 ${finalP95}ms exceeds target ${PARTIAL_LATENCY_TARGET_MS}ms`,
    );
  }

  return {
    simulatedDurationMs: loopCount * SOAK_LOOP_DURATION_MS,
    loopCount,
    totalFrames: frames.length,
    droppedFrames,
    peakP95LatencyMs: finalP95,
    finalP95LatencyMs: finalP95,
    peakMemory: memory,
  };
}

export function assertSoakInvariants(result: SoakTestResult): void {
  if (result.simulatedDurationMs < SOAK_TARGET_DURATION_MS) {
    throw new Error(
      `Soak simulated ${result.simulatedDurationMs}ms < target ${SOAK_TARGET_DURATION_MS}ms`,
    );
  }

  if (result.droppedFrames > 0) {
    throw new Error(`Soak test dropped ${result.droppedFrames} frame(s)`);
  }

  if (result.peakMemory.contextEntries > TUNED_CONTEXT_WINDOW_SIZE) {
    throw new Error(
      `Context window grew to ${result.peakMemory.contextEntries} (max ${TUNED_CONTEXT_WINDOW_SIZE})`,
    );
  }

  if (result.peakMemory.segmentMaps > TUNED_SEGMENT_MAP_RETENTION) {
    throw new Error(
      `Segment maps grew to ${result.peakMemory.segmentMaps} (max ${TUNED_SEGMENT_MAP_RETENTION})`,
    );
  }
}

function createCorrectionEngineStub(): CorrectionEngine {
  return {
    recordDisplayed: () => {},
    handleSourceSegment: async () => [],
    reset: () => {},
    onRevision: () => () => {},
  };
}

function waitForProcessing(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}
