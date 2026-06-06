import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LATENCY_P95_TARGET_MS,
  LATENCY_WARNING_CLEAR_STABLE_MS,
  LATENCY_WARNING_RAISE_MAX_MS,
  LATENCY_WARNING_REMOVE_MAX_MS,
  LATENCY_WARNING_THRESHOLD_MS,
} from './constants.js';
import {
  LatencyMonitorImpl,
  createLatencyMonitor,
  percentile95,
} from './latencyMonitor.js';

describe('percentile95', () => {
  it('returns the 95th percentile of latency samples', () => {
    const values = Array.from({ length: 20 }, (_item, index) => (index + 1) * 100);
    expect(percentile95(values)).toBe(1_900);
  });
});

describe('LatencyMonitorImpl', () => {
  let nowMs = 0;

  beforeEach(() => {
    vi.useFakeTimers();
    nowMs = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createMonitor() {
    return new LatencyMonitorImpl({
      now: () => nowMs,
      windowSize: 20,
    });
  }

  it('tracks rolling p95 latency for partial subtitles', () => {
    const monitor = createMonitor();

    for (let index = 0; index < 20; index += 1) {
      const capturedAt = index * 1_000;
      monitor.recordPartial(capturedAt, capturedAt + 2_000);
    }

    expect(monitor.getP95LatencyMs()).toBe(2_000);
    expect(monitor.getP95LatencyMs()).toBeLessThanOrEqual(LATENCY_P95_TARGET_MS + 1_000);
  });

  it('raises a warning within two seconds of exceeding the threshold', () => {
    const monitor = createMonitor();
    const onWarningChange = vi.fn();
    monitor.onWarningChange(onWarningChange);

    const capturedAt = 1_000;
    const displayedAt = capturedAt + LATENCY_WARNING_THRESHOLD_MS + 500;
    nowMs = displayedAt;
    monitor.recordPartial(capturedAt, displayedAt);

    expect(monitor.isWarningActive()).toBe(false);
    vi.advanceTimersByTime(LATENCY_WARNING_RAISE_MAX_MS);
    expect(monitor.isWarningActive()).toBe(true);
    expect(onWarningChange).toHaveBeenCalledWith(true);
  });

  it('clears the warning only after five seconds of stable low latency', () => {
    const monitor = new LatencyMonitorImpl({
      now: () => nowMs,
      windowSize: 5,
    });
    const onWarningChange = vi.fn();
    monitor.onWarningChange(onWarningChange);

    const capturedAt = 1_000;
    nowMs = capturedAt + LATENCY_WARNING_THRESHOLD_MS + 500;
    monitor.recordPartial(capturedAt, nowMs);
    nowMs += LATENCY_WARNING_RAISE_MAX_MS;
    vi.advanceTimersByTime(LATENCY_WARNING_RAISE_MAX_MS);
    expect(monitor.isWarningActive()).toBe(true);

    for (let step = 0; step < 5; step += 1) {
      nowMs += 1_000;
      monitor.recordPartial(nowMs, nowMs + 2_000);
    }

    nowMs += LATENCY_WARNING_CLEAR_STABLE_MS;
    vi.advanceTimersByTime(LATENCY_WARNING_CLEAR_STABLE_MS);
    nowMs += LATENCY_WARNING_REMOVE_MAX_MS;
    vi.advanceTimersByTime(LATENCY_WARNING_REMOVE_MAX_MS);

    expect(monitor.isWarningActive()).toBe(false);
    expect(onWarningChange).toHaveBeenLastCalledWith(false);
  });

  it('creates a monitor via factory', () => {
    expect(createLatencyMonitor()).toBeInstanceOf(LatencyMonitorImpl);
  });
});
