import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeAudioFileToMono16k } from './decodeAudioFile.js';

const originalAudioContext = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');

afterEach(() => {
  if (originalAudioContext) {
    Object.defineProperty(globalThis, 'AudioContext', originalAudioContext);
  } else {
    Reflect.deleteProperty(globalThis, 'AudioContext');
  }
});

describe('decodeAudioFileToMono16k', () => {
  it('decodes MP4-like media through Web Audio and converts it to mono 16 kHz PCM', async () => {
    const close = vi.fn(async () => {});
    const decodeAudioData = vi.fn(async () => ({
      length: 4,
      numberOfChannels: 2,
      sampleRate: 32_000,
      getChannelData: (channel: number) =>
        channel === 0 ? new Float32Array([1, 0.5, 0, -0.5]) : new Float32Array([0.5, 0, -0.5, -1]),
    }));

    Object.defineProperty(globalThis, 'AudioContext', {
      configurable: true,
      value: vi.fn(() => ({ close, decodeAudioData })),
    });

    const pcm = await decodeAudioFileToMono16k(new ArrayBuffer(16), '/movie.mp4');

    expect(decodeAudioData).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect([...pcm]).toEqual([0.75, -0.25]);
  });

  it('reports a useful error when the runtime has no media decoder', async () => {
    Reflect.deleteProperty(globalThis, 'AudioContext');

    await expect(decodeAudioFileToMono16k(new ArrayBuffer(16), '/movie.mp4')).rejects.toThrow(
      '当前环境无法解码',
    );
  });
});
