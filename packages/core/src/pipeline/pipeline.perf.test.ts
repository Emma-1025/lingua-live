import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScriptedMockAsrDriver } from '../asr/recognizer.js';
import { LATENCY_WARNING_THRESHOLD_MS } from '../perf/constants.js';
import { createLatencyMonitor } from '../perf/latencyMonitor.js';
import {
  createFramesForScripts,
  createGoldenClipScripts,
  createSlowDeepSeekClient,
  createStreamingIngestor,
} from '../perf/harness.js';
import { TranslatorImpl } from '../translate/translator.js';
import { createPipeline } from './pipeline.js';

describe('Pipeline performance behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('raises and clears latency warning under induced translation load', async () => {
    const scripts = createGoldenClipScripts().slice(0, 1);
    const frames = createFramesForScripts(scripts);
    const driver = new ScriptedMockAsrDriver(scripts);
    const monitor = createLatencyMonitor();
    const warnings: boolean[] = [];

    const pipeline = createPipeline({
      ingestor: createStreamingIngestor(frames),
      recognizerDeps: { driver },
      translator: new TranslatorImpl({
        client: createSlowDeepSeekClient(LATENCY_WARNING_THRESHOLD_MS + 1_000),
        translationTimeoutMs: 15_000,
      }),
      correctionEngine: createCorrectionEngineStub(),
      latencyMonitor: monitor,
    });

    pipeline.onLatencyWarning((active) => {
      warnings.push(active);
    });

    const runPromise = (async () => {
      await pipeline.start({
        sessionId: 'sess-load',
        selection: { kind: 'file', filePath: '/audio/load.wav' },
      });
      await vi.advanceTimersByTimeAsync(20_000);
      await pipeline.stop();
    })();

    await runPromise;

    expect(warnings).toContain(true);
    expect(monitor.getP95LatencyMs()).toBeGreaterThan(LATENCY_WARNING_THRESHOLD_MS);
  });

  it('caps context and segment maps during long sessions', async () => {
    const scripts = createGoldenClipScripts();
    const frames = createFramesForScripts(scripts);
    const driver = new ScriptedMockAsrDriver(scripts);

    const pipeline = createPipeline({
      ingestor: createStreamingIngestor(frames),
      recognizerDeps: { driver },
      translator: new TranslatorImpl({ client: createFastDeepSeekClient() }),
      correctionEngine: createCorrectionEngineStub(),
      contextWindowSize: 3,
      segmentMapRetention: 8,
    });

    const runPromise = (async () => {
      await pipeline.start({
        sessionId: 'sess-memory',
        selection: { kind: 'file', filePath: '/audio/memory.wav' },
      });
      await vi.advanceTimersByTimeAsync(20_000);
      await pipeline.stop();
    })();

    await runPromise;

    const snapshot = pipeline.getMemorySnapshot();
    expect(snapshot.contextEntries).toBeLessThanOrEqual(3);
    expect(snapshot.segmentMaps).toBeLessThanOrEqual(16);
  });
});

function createCorrectionEngineStub() {
  return {
    recordDisplayed: vi.fn(),
    handleSourceSegment: vi.fn(async () => []),
    reset: vi.fn(),
    onRevision: vi.fn(() => () => {}),
  };
}

function createFastDeepSeekClient() {
  return {
    async *streamChatCompletion(messages: { content: string }[]) {
      yield `译:${messages.at(-1)?.content ?? ''}`;
    },
    chatCompletion: async (messages: { content: string }[]) =>
      `译:${messages.at(-1)?.content ?? ''}`,
  };
}
