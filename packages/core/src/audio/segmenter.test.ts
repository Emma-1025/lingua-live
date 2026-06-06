import { describe, expect, it, vi } from 'vitest';
import type { AudioFrame } from '../models.js';
import { TARGET_SAMPLE_RATE } from './constants.js';
import { VadSegmenter } from './segmenter.js';

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

function pushPattern(
  segmenter: VadSegmenter,
  pattern: Array<{ durationMs: number; amplitude: number }>,
  startAt = 1_000,
): void {
  let seq = 0;
  let capturedAt = startAt;

  for (const chunk of pattern) {
    segmenter.pushFrame(
      createFrame({
        seq,
        durationMs: chunk.durationMs,
        capturedAt,
        amplitude: chunk.amplitude,
      }),
    );
    seq += 1;
    capturedAt += chunk.durationMs;
  }
}

describe('VadSegmenter', () => {
  it('opens a segment after 200ms continuous speech', () => {
    const segmenter = new VadSegmenter();
    const onOpen = vi.fn();
    segmenter.onSegmentOpen(onOpen);

    pushPattern(segmenter, [
      { durationMs: 100, amplitude: 0.5 },
      { durationMs: 100, amplitude: 0.5 },
    ]);

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0]).toMatchObject({
      sessionId: 'sess-1',
      startedSeq: 0,
    });
    expect(segmenter.isSegmentOpen()).toBe(true);
  });

  it('does not open a segment for speech shorter than 200ms', () => {
    const segmenter = new VadSegmenter();
    const onOpen = vi.fn();
    segmenter.onSegmentOpen(onOpen);

    pushPattern(segmenter, [{ durationMs: 150, amplitude: 0.5 }]);

    expect(onOpen).not.toHaveBeenCalled();
    expect(segmenter.isSegmentOpen()).toBe(false);
  });

  it('resets speech streak when silence appears before 200ms threshold', () => {
    const segmenter = new VadSegmenter();
    const onOpen = vi.fn();
    segmenter.onSegmentOpen(onOpen);

    pushPattern(segmenter, [
      { durationMs: 150, amplitude: 0.5 },
      { durationMs: 50, amplitude: 0 },
      { durationMs: 150, amplitude: 0.5 },
    ]);

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('closes a segment after 600ms trailing silence', () => {
    const segmenter = new VadSegmenter();
    const onClose = vi.fn();
    segmenter.onSegmentClose(onClose);

    pushPattern(segmenter, [
      { durationMs: 200, amplitude: 0.5 },
      { durationMs: 300, amplitude: 0.5 },
      { durationMs: 300, amplitude: 0 },
      { durationMs: 300, amplitude: 0 },
    ]);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.calls[0][0]).toMatchObject({
      reason: 'silence',
      closedSeq: 3,
    });
    expect(segmenter.isSegmentOpen()).toBe(false);
  });

  it('closes a segment when max length of 15s is reached', () => {
    const segmenter = new VadSegmenter({ maxSegmentDurationMs: 1_500 });
    const onClose = vi.fn();
    segmenter.onSegmentClose(onClose);

    pushPattern(segmenter, [
      { durationMs: 200, amplitude: 0.5 },
      { durationMs: 800, amplitude: 0.5 },
      { durationMs: 800, amplitude: 0.5 },
    ]);

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.calls[0][0]).toMatchObject({
      reason: 'max_length',
      durationMs: 1_800,
    });
  });

  it('uses the same segment id for open and close events', () => {
    const segmenter = new VadSegmenter();
    const opens: string[] = [];
    const closes: string[] = [];

    segmenter.onSegmentOpen((event) => opens.push(event.segmentId));
    segmenter.onSegmentClose((event) => closes.push(event.segmentId));

    pushPattern(segmenter, [
      { durationMs: 200, amplitude: 0.5 },
      { durationMs: 700, amplitude: 0 },
    ]);

    expect(opens).toHaveLength(1);
    expect(closes).toHaveLength(1);
    expect(opens[0]).toBe(closes[0]);
  });

  it('emits multiple segment cycles in a speech/silence sequence', () => {
    const segmenter = new VadSegmenter();
    const onOpen = vi.fn();
    const onClose = vi.fn();
    segmenter.onSegmentOpen(onOpen);
    segmenter.onSegmentClose(onClose);

    pushPattern(segmenter, [
      { durationMs: 200, amplitude: 0.5 },
      { durationMs: 700, amplitude: 0 },
      { durationMs: 200, amplitude: 0.5 },
      { durationMs: 700, amplitude: 0 },
    ]);

    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('closes an open segment on flush', () => {
    const segmenter = new VadSegmenter();
    const onClose = vi.fn();
    segmenter.onSegmentClose(onClose);

    pushPattern(segmenter, [
      { durationMs: 200, amplitude: 0.5 },
      { durationMs: 100, amplitude: 0.5 },
    ]);

    segmenter.flush();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onClose.mock.calls[0][0].reason).toBe('flush');
  });

  it('reset clears open state without emitting close', () => {
    const segmenter = new VadSegmenter();
    const onClose = vi.fn();
    segmenter.onSegmentClose(onClose);

    pushPattern(segmenter, [{ durationMs: 250, amplitude: 0.5 }]);
    segmenter.reset();

    expect(onClose).not.toHaveBeenCalled();
    expect(segmenter.isSegmentOpen()).toBe(false);
  });
});
