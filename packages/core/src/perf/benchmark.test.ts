import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LATENCY_P95_TARGET_MS } from './constants.js';
import { assertGoldenClipBenchmark, runGoldenClipBenchmark } from './benchmark.js';

describe('golden clip benchmark', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('meets the p95 partial e2e latency target without dropping frames', async () => {
    const benchmarkPromise = runGoldenClipBenchmark();
    await vi.advanceTimersByTimeAsync(20_000);
    const result = await benchmarkPromise;

    expect(result.droppedFrames).toBe(0);
    expect(result.enqueuedFrames).toBe(result.processedFrames);
    expect(result.partialSampleCount).toBeGreaterThan(0);
    expect(result.p95PartialLatencyMs).toBeLessThanOrEqual(LATENCY_P95_TARGET_MS);
    expect(() => assertGoldenClipBenchmark(result)).not.toThrow();
  });
});
