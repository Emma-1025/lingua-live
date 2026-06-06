import { describe, expect, it } from 'vitest';
import { MAX_FRAME_DURATION_MS, TARGET_SAMPLE_RATE } from './constants.js';
import { buildAudioFrame, chunkPcm } from './frameUtils.js';

describe('chunkPcm', () => {
  it('splits audio into frames of at most 1000ms', () => {
    const halfSecondSamples = (TARGET_SAMPLE_RATE * 500) / 1_000;
    const totalSamples = TARGET_SAMPLE_RATE * 2 + halfSecondSamples;
    const pcm = new Float32Array(totalSamples);
    const chunks = chunkPcm(pcm);

    expect(chunks).toHaveLength(3);
    expect(chunks[0].durationMs).toBe(MAX_FRAME_DURATION_MS);
    expect(chunks[1].durationMs).toBe(MAX_FRAME_DURATION_MS);
    expect(chunks[2].durationMs).toBe(500);
    expect(chunks[0].pcm.length + chunks[1].pcm.length + chunks[2].pcm.length).toBe(totalSamples);
  });

  it('returns empty array for empty pcm', () => {
    expect(chunkPcm(new Float32Array(0))).toEqual([]);
  });
});

describe('buildAudioFrame', () => {
  it('rejects frames longer than 1000ms', () => {
    expect(() =>
      buildAudioFrame({
        sessionId: 's1',
        seq: 0,
        capturedAt: 0,
        pcm: new Float32Array(10),
        durationMs: 1001,
      }),
    ).toThrow(/exceeds/);
  });
});
