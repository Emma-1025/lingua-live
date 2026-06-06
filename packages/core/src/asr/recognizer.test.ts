import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioFrame } from '../models.js';
import { TARGET_SAMPLE_RATE } from '../audio/constants.js';
import {
  FINAL_RECOGNITION_LATENCY_MS,
  PARTIAL_RECOGNITION_LATENCY_MS,
} from './constants.js';
import {
  MockSpeechRecognizer,
  ScriptedMockAsrDriver,
  createSpeechRecognizer,
} from './recognizer.js';

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

function pushSpeech(
  recognizer: MockSpeechRecognizer,
  durationMs: number,
  startAt = 1_000,
  startSeq = 0,
): number {
  const capturedAt = startAt;
  const seq = startSeq;

  recognizer.pushAudio(
    createFrame({ seq, durationMs, capturedAt, amplitude: 0.5 }),
  );

  return capturedAt + durationMs;
}

function pushSilence(
  recognizer: MockSpeechRecognizer,
  durationMs: number,
  startAt: number,
  startSeq: number,
): { nextAt: number; nextSeq: number } {
  recognizer.pushAudio(
    createFrame({ seq: startSeq, durationMs, capturedAt: startAt, amplitude: 0 }),
  );

  return { nextAt: startAt + durationMs, nextSeq: startSeq + 1 };
}

function openAndCloseSegment(recognizer: MockSpeechRecognizer): void {
  const at = pushSpeech(recognizer, 200);
  const afterSpeech = pushSilence(recognizer, 600, at, 1);
  void afterSpeech;
}

describe('MockSpeechRecognizer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('defaults to English source language', () => {
    const recognizer = createSpeechRecognizer();
    expect(recognizer.getLanguage()).toBe('en');
  });

  it('emits partial then final with a stable segment id', () => {
    const driver = new ScriptedMockAsrDriver([
      {
        hypotheses: [
          { text: 'hello', status: 'partial', delayMs: 100 },
          { text: 'hello world', status: 'final', delayMs: 300 },
        ],
      },
    ]);
    const recognizer = new MockSpeechRecognizer({ driver });
    const onSegment = vi.fn();
    recognizer.onSegment(onSegment);

    openAndCloseSegment(recognizer);
    vi.advanceTimersByTime(500);

    expect(onSegment).toHaveBeenCalledTimes(2);

    const partial = onSegment.mock.calls[0][0];
    const final = onSegment.mock.calls[1][0];

    expect(partial).toMatchObject({
      text: 'hello',
      status: 'partial',
      spokenIndex: 0,
      recognizable: true,
      sessionId: 'sess-1',
    });
    expect(final).toMatchObject({
      id: partial.id,
      text: 'hello world',
      status: 'final',
      spokenIndex: 0,
      startedAt: partial.startedAt,
    });
  });

  it('replays revised partial hypotheses before final', () => {
    const driver = new ScriptedMockAsrDriver([
      {
        hypotheses: [
          { text: 'a large corps', status: 'partial', delayMs: 100 },
          { text: 'a large corpus', status: 'partial', delayMs: 250 },
          { text: 'a large corpus of data', status: 'final', delayMs: 400 },
        ],
      },
    ]);
    const recognizer = new MockSpeechRecognizer({ driver });
    const onSegment = vi.fn();
    recognizer.onSegment(onSegment);

    openAndCloseSegment(recognizer);
    vi.advanceTimersByTime(500);

    expect(onSegment).toHaveBeenCalledTimes(3);
    expect(onSegment.mock.calls[0][0].text).toBe('a large corps');
    expect(onSegment.mock.calls[1][0].text).toBe('a large corpus');
    expect(onSegment.mock.calls[2][0]).toMatchObject({
      text: 'a large corpus of data',
      status: 'final',
      id: onSegment.mock.calls[0][0].id,
    });
  });

  it('delivers partial within 2s and final within 5s of segment open', () => {
    const driver = new ScriptedMockAsrDriver([
      {
        hypotheses: [
          { text: 'partial', status: 'partial', delayMs: PARTIAL_RECOGNITION_LATENCY_MS },
          { text: 'final', status: 'final', delayMs: FINAL_RECOGNITION_LATENCY_MS },
        ],
      },
    ]);
    const recognizer = new MockSpeechRecognizer({ driver });
    const onSegment = vi.fn();
    recognizer.onSegment(onSegment);

    openAndCloseSegment(recognizer);

    vi.advanceTimersByTime(PARTIAL_RECOGNITION_LATENCY_MS - 1);
    expect(onSegment).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onSegment).toHaveBeenCalledTimes(1);
    expect(onSegment.mock.calls[0][0].status).toBe('partial');

    vi.advanceTimersByTime(FINAL_RECOGNITION_LATENCY_MS - PARTIAL_RECOGNITION_LATENCY_MS);
    expect(onSegment).toHaveBeenCalledTimes(2);
    expect(onSegment.mock.calls[1][0].status).toBe('final');
  });

  it('uses the selected source language for multilingual scripts', () => {
    const driver = new ScriptedMockAsrDriver([
      {
        hypotheses: [
          {
            text: { en: 'hello', ja: 'こんにちは' },
            status: 'final',
            delayMs: 100,
          },
        ],
      },
    ]);
    const recognizer = new MockSpeechRecognizer({ driver });
    const onSegment = vi.fn();
    recognizer.onSegment(onSegment);

    recognizer.setLanguage('ja');
    openAndCloseSegment(recognizer);
    vi.advanceTimersByTime(200);

    expect(onSegment).toHaveBeenCalledTimes(1);
    expect(onSegment.mock.calls[0][0].text).toBe('こんにちは');
  });

  it('emits onUnrecognized without a segment and retains prior segments', () => {
    const driver = new ScriptedMockAsrDriver([
      {
        hypotheses: [{ text: 'first', status: 'final', delayMs: 100 }],
      },
      { unrecognized: true },
    ]);
    const recognizer = new MockSpeechRecognizer({ driver });
    const onSegment = vi.fn();
    const onUnrecognized = vi.fn();
    recognizer.onSegment(onSegment);
    recognizer.onUnrecognized(onUnrecognized);

    openAndCloseSegment(recognizer);
    vi.advanceTimersByTime(200);

    expect(onSegment).toHaveBeenCalledTimes(1);
    expect(onSegment.mock.calls[0][0].text).toBe('first');

    openAndCloseSegment(recognizer);
    vi.advanceTimersByTime(200);

    expect(onSegment).toHaveBeenCalledTimes(1);
    expect(onUnrecognized).toHaveBeenCalledTimes(1);
    expect(onUnrecognized.mock.calls[0][0]).toMatchObject({
      sessionId: 'sess-1',
      spokenIndex: 1,
    });
  });

  it('allocates monotonically increasing spokenIndex values', () => {
    const driver = new ScriptedMockAsrDriver([
      { hypotheses: [{ text: 'one', status: 'final', delayMs: 50 }] },
      { hypotheses: [{ text: 'two', status: 'final', delayMs: 50 }] },
    ]);
    const recognizer = new MockSpeechRecognizer({ driver });
    const onSegment = vi.fn();
    recognizer.onSegment(onSegment);

    openAndCloseSegment(recognizer);
    openAndCloseSegment(recognizer);
    vi.advanceTimersByTime(200);

    expect(onSegment.mock.calls[0][0].spokenIndex).toBe(0);
    expect(onSegment.mock.calls[1][0].spokenIndex).toBe(1);
  });

  it('classifies each emitted segment as partial or final', () => {
    const driver = new ScriptedMockAsrDriver([
      {
        hypotheses: [
          { text: 'live', status: 'partial', delayMs: 50 },
          { text: 'live text', status: 'final', delayMs: 150 },
        ],
      },
    ]);
    const recognizer = new MockSpeechRecognizer({ driver });
    const onSegment = vi.fn();
    recognizer.onSegment(onSegment);

    openAndCloseSegment(recognizer);
    vi.advanceTimersByTime(300);

    expect(onSegment.mock.calls.map((call) => call[0].status)).toEqual(['partial', 'final']);
  });
});
