import type { CorrectionEngine } from '../correct/correctionEngine.js';
import type { LatencyMonitor } from './latencyMonitor.js';
import { percentile95 } from './latencyMonitor.js';
import { createPipeline, type PipelineConfig } from '../pipeline/pipeline.js';
import { TranslatorImpl } from '../translate/translator.js';
import {
  createFastDeepSeekClient,
  createFramesForScripts,
  createGoldenClipDriver,
  createGoldenClipScripts,
  createStreamingIngestor,
} from './harness.js';
import { PARTIAL_LATENCY_TARGET_MS, createTunedPipelineOptions } from './tuning.js';

export interface GoldenClipBenchmarkResult {
  p95PartialLatencyMs: number;
  partialSampleCount: number;
  droppedFrames: number;
  enqueuedFrames: number;
  processedFrames: number;
}

export interface GoldenClipBenchmarkOptions {
  pipelineConfig?: PipelineConfig;
  waitMs?: number;
}

export async function runGoldenClipBenchmark(
  options: GoldenClipBenchmarkOptions = {},
): Promise<GoldenClipBenchmarkResult> {
  const scripts = createGoldenClipScripts();
  const frames = createFramesForScripts(scripts);
  const tuning = createTunedPipelineOptions();
  const driver = createGoldenClipDriver();

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
    sessionId: 'sess-benchmark',
    selection: { kind: 'file', filePath: '/audio/golden-en-talk.wav' },
  });

  await waitForProcessing(options.waitMs ?? scripts.length * 2_000);
  await pipeline.stop();

  const monitor = pipeline.getLatencyMonitor();
  const samples = monitor.getSamples().map((sample) => sample.latencyMs);
  const p95 = samples.length > 0 ? percentile95(samples) : 0;

  return {
    p95PartialLatencyMs: p95,
    partialSampleCount: samples.length,
    droppedFrames: pipeline.getDroppedFrameCount(),
    enqueuedFrames: pipeline.getEnqueuedFrameCount(),
    processedFrames: pipeline.getProcessedFrameCount(),
  };
}

export function assertGoldenClipBenchmark(result: GoldenClipBenchmarkResult): void {
  if (result.droppedFrames > 0) {
    throw new Error(`Golden clip dropped ${result.droppedFrames} frame(s)`);
  }

  if (result.enqueuedFrames !== result.processedFrames) {
    throw new Error(
      `Frame mismatch: enqueued=${result.enqueuedFrames}, processed=${result.processedFrames}`,
    );
  }

  if (result.partialSampleCount === 0) {
    throw new Error('Golden clip produced no partial latency samples');
  }

  if (result.p95PartialLatencyMs > PARTIAL_LATENCY_TARGET_MS) {
    throw new Error(
      `Golden clip p95 partial latency ${result.p95PartialLatencyMs}ms exceeds target ${PARTIAL_LATENCY_TARGET_MS}ms`,
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
