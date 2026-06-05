import { describe, expect, it } from 'vitest';
import { TARGET_SAMPLE_RATE } from './constants.js';
import { createTestWav } from './testHelpers.js';
import { decodeWavToMono16k } from './wavDecoder.js';

describe('decodeWavToMono16k', () => {
  it('decodes mono 16 kHz WAV', () => {
    const wav = createTestWav(100);
    const pcm = decodeWavToMono16k(wav);
    expect(pcm.length).toBe(Math.round(TARGET_SAMPLE_RATE * 0.1));
  });
});
