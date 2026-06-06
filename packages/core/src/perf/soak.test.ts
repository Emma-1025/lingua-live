import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SOAK_LOOP_COUNT,
  SOAK_TARGET_DURATION_MS,
  TUNED_CONTEXT_WINDOW_SIZE,
  TUNED_SEGMENT_MAP_RETENTION,
} from './tuning.js';
import { assertSoakInvariants, runSoakTest } from './soak.js';

describe('120-minute soak simulation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it(
    'sustains latency target with zero dropped frames and bounded memory',
    async () => {
      const scriptCount = 6 * SOAK_LOOP_COUNT;
      const soakPromise = runSoakTest();
      await vi.advanceTimersByTimeAsync(scriptCount * 2_500);
      const result = await soakPromise;

    expect(result.loopCount).toBe(SOAK_LOOP_COUNT);
    expect(result.simulatedDurationMs).toBe(SOAK_TARGET_DURATION_MS);
    expect(result.droppedFrames).toBe(0);
    expect(result.peakMemory.contextEntries).toBeLessThanOrEqual(TUNED_CONTEXT_WINDOW_SIZE);
    expect(result.peakMemory.segmentMaps).toBeLessThanOrEqual(TUNED_SEGMENT_MAP_RETENTION);
      expect(() => assertSoakInvariants(result)).not.toThrow();
    },
    60_000,
  );
});
