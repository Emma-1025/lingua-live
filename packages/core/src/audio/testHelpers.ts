import { TARGET_SAMPLE_RATE } from './constants.js';

/** Build a minimal mono 16-bit PCM WAV at 16 kHz for tests. */
export function createTestWav(durationMs: number, fill: (index: number) => number = (i) => i): ArrayBuffer {
  const sampleCount = Math.round((TARGET_SAMPLE_RATE * durationMs) / 1_000);
  const dataSize = sampleCount * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  for (let i = 0; i < sampleCount; i += 1) {
    const sample = Math.max(-1, Math.min(1, fill(i)));
    view.setInt16(44 + i * 2, Math.round(sample * 32_767), true);
  }

  return buffer;
}
