import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScriptedMockAsrDriver } from '../asr/recognizer.js';
import type { AudioIngestor } from '../audio/ingestor.js';
import { TARGET_SAMPLE_RATE } from '../audio/constants.js';
import type { AudioFrame } from '../models.js';
import { TranslatorImpl } from '../translate/translator.js';
import { createFastDeepSeekClient } from '../perf/harness.js';
import { PAUSE_RESUME_MAX_MS } from './constants.js';
import { createPipeline } from './pipeline.js';

function createPacedIngestor(frames: AudioFrame[]): AudioIngestor {
  let frameHandler: ((frame: AudioFrame) => void) | undefined;
  let running = false;
  let paused = false;
  let index = 0;
  let timer: ReturnType<typeof globalThis.setTimeout> | undefined;

  const schedule = () => {
    if (!running || paused || index >= frames.length) {
      return;
    }

    timer = globalThis.setTimeout(() => {
      frameHandler?.(frames[index]!);
      index += 1;
      schedule();
    }, frames[index]!.durationMs);
  };

  return {
    listSources: async () => [],
    start: async () => {
      running = true;
      paused = false;
      index = 0;
      schedule();
    },
    stop: async () => {
      running = false;
      paused = false;
      if (timer !== undefined) {
        globalThis.clearTimeout(timer);
      }
    },
    onFrame: (handler) => {
      frameHandler = handler;
      return () => {
        frameHandler = undefined;
      };
    },
    onSourceLost: () => () => {},
    onFileEnd: () => () => {},
    onStartRejected: () => () => {},
    isRunning: () => running,
    isPaused: () => paused,
    pause: async () => {
      paused = true;
      if (timer !== undefined) {
        globalThis.clearTimeout(timer);
        timer = undefined;
      }
    },
    resume: async () => {
      if (!running || !paused) {
        return;
      }
      paused = false;
      schedule();
    },
  };
}

function createFrame(seq: number, durationMs: number): AudioFrame {
  const sampleCount = Math.round((TARGET_SAMPLE_RATE * durationMs) / 1_000);
  return {
    sessionId: 'sess-pause',
    seq,
    capturedAt: 1_000 + seq * durationMs,
    pcm: new Float32Array(sampleCount).fill(0.2),
    durationMs,
  };
}

describe('Pipeline pause and resume', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops enqueueing and processing frames while paused', async () => {
    const frames = [0, 1, 2, 3, 4].map((seq) => createFrame(seq, 200));
    const ingestor = createPacedIngestor(frames);
    const pipeline = createPipeline({
      ingestor,
      recognizerDeps: { driver: new ScriptedMockAsrDriver([]) },
      translator: new TranslatorImpl({ client: createFastDeepSeekClient() }),
      correctionEngine: createCorrectionEngineStub(),
    });

    await pipeline.start({
      sessionId: 'sess-pause',
      selection: { kind: 'file', filePath: '/audio.wav' },
    });

    await vi.advanceTimersByTimeAsync(250);
    expect(pipeline.getEnqueuedFrameCount()).toBe(1);

    const pauseStartedAt = Date.now();
    await pipeline.pause();
    expect(Date.now() - pauseStartedAt).toBeLessThanOrEqual(PAUSE_RESUME_MAX_MS);
    expect(pipeline.isPaused()).toBe(true);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(pipeline.getEnqueuedFrameCount()).toBe(1);
    expect(pipeline.getProcessedFrameCount()).toBe(1);

    await pipeline.resume();
    expect(pipeline.isPaused()).toBe(false);

    await vi.advanceTimersByTimeAsync(1_000);
    await pipeline.stop();

    expect(pipeline.getEnqueuedFrameCount()).toBe(frames.length);
    expect(pipeline.getProcessedFrameCount()).toBe(frames.length);
    expect(pipeline.getDroppedFrameCount()).toBe(0);
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
