import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScriptedMockAsrDriver } from '../asr/recognizer.js';
import type { AudioIngestor } from '../audio/ingestor.js';
import { TARGET_SAMPLE_RATE } from '../audio/constants.js';
import type { DeepSeekClient } from '../llm/deepseekClient.js';
import type { AudioFrame, ZhSegment } from '../models.js';
import { TranslatorImpl } from '../translate/translator.js';
import { createPipeline } from './pipeline.js';

function createFrame(params: {
  seq: number;
  durationMs: number;
  capturedAt: number;
  amplitude: number;
  sessionId?: string;
}): AudioFrame {
  const sampleCount = Math.round((TARGET_SAMPLE_RATE * params.durationMs) / 1_000);
  const pcm = new Float32Array(sampleCount);
  pcm.fill(params.amplitude);

  return {
    sessionId: params.sessionId ?? 'sess-1',
    seq: params.seq,
    capturedAt: params.capturedAt,
    pcm,
    durationMs: params.durationMs,
  };
}

function createSpeechFrames(): AudioFrame[] {
  const frames: AudioFrame[] = [];
  let capturedAt = 1_000;
  let seq = 0;

  for (let index = 0; index < 2; index += 1) {
    frames.push(createFrame({ seq, durationMs: 100, capturedAt, amplitude: 0.5 }));
    seq += 1;
    capturedAt += 100;
  }

  for (let index = 0; index < 6; index += 1) {
    frames.push(createFrame({ seq, durationMs: 100, capturedAt, amplitude: 0 }));
    seq += 1;
    capturedAt += 100;
  }

  return frames;
}

function createMockIngestor(frames: AudioFrame[]): AudioIngestor {
  let frameHandler: ((frame: AudioFrame) => void) | undefined;
  let running = false;

  return {
    listSources: async () => [],
    start: async () => {
      running = true;
      for (const frame of frames) {
        frameHandler?.(frame);
      }
    },
    stop: async () => {
      running = false;
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
    isPaused: () => false,
    pause: async () => {},
    resume: async () => {},
  };
}

function createMockDeepSeekClient(): DeepSeekClient {
  return {
    async *streamChatCompletion(messages) {
      const source = extractSourceText(messages.at(-1)?.content ?? '');
      yield `译:${source}`;
    },
    chatCompletion: async (messages) => `译:${extractSourceText(messages.at(-1)?.content ?? '')}`,
  };
}

function extractSourceText(content: string): string {
  const match = content.match(/<source>(.*)<\/source>/s);
  return match?.[1] ?? content;
}

describe('Pipeline integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('drives audio through mock ASR and translator without dropping frames', async () => {
    const clock = 1_000;
    const driver = new ScriptedMockAsrDriver([
      {
        hypotheses: [
          { text: 'hello', status: 'partial', delayMs: 100 },
          { text: 'hello world', status: 'final', delayMs: 300 },
        ],
      },
    ]);

    const translator = new TranslatorImpl({ client: createMockDeepSeekClient() });
    const subtitles: ZhSegment[] = [];
    const frames = createSpeechFrames();

    const pipeline = createPipeline({
      ingestor: createMockIngestor(frames),
      recognizerDeps: { driver },
      translator,
      correctionEngine: createCorrectionEngineStub(),
      now: () => clock,
    });

    pipeline.onSubtitle((update) => {
      subtitles.push(update.segment);
    });

    const startPromise = pipeline.start({
      sessionId: 'sess-1',
      selection: { kind: 'file', filePath: '/audio/hello.wav' },
      showSourceText: true,
    });

    await startPromise;
    await vi.advanceTimersByTimeAsync(500);
    await pipeline.stop();

    expect(pipeline.getEnqueuedFrameCount()).toBe(frames.length);
    expect(pipeline.getProcessedFrameCount()).toBe(frames.length);
    expect(subtitles.some((segment) => segment.status === 'partial')).toBe(true);
    expect(subtitles.some((segment) => segment.status === 'final')).toBe(true);
    expect(pipeline.getTranscriptStore().getEntries()).toHaveLength(1);
    expect(pipeline.getTranscriptStore().getEntries()[0]?.sourceText).toBe('hello world');
  });
});

function createCorrectionEngineStub() {
  return {
    recordDisplayed: vi.fn(),
    handleSourceSegment: vi.fn(async () => [] as ZhSegment[]),
    reset: vi.fn(),
    onRevision: vi.fn(() => () => {}),
  };
}
