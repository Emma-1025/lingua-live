/** Converts mono float32 PCM in [-1, 1] to signed 16-bit linear PCM for streaming ASR. */
export function float32ToLinear16(pcm: Float32Array): ArrayBuffer {
  const out = new Int16Array(pcm.length);

  for (let index = 0; index < pcm.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, pcm[index] ?? 0));
    out[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return out.buffer;
}
