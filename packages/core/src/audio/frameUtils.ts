import { MAX_FRAME_DURATION_MS, MAX_FRAME_SAMPLES, TARGET_SAMPLE_RATE } from './constants.js';
import type { AudioFrame } from '../models.js';

export interface PcmFrameChunk {
  pcm: Float32Array;
  durationMs: number;
}

/** Split mono PCM into frames of at most MAX_FRAME_DURATION_MS. */
export function chunkPcm(pcm: Float32Array): PcmFrameChunk[] {
  if (pcm.length === 0) {
    return [];
  }

  const chunks: PcmFrameChunk[] = [];
  let offset = 0;

  while (offset < pcm.length) {
    const sampleCount = Math.min(MAX_FRAME_SAMPLES, pcm.length - offset);
    chunks.push({
      pcm: pcm.subarray(offset, offset + sampleCount),
      durationMs: (sampleCount / TARGET_SAMPLE_RATE) * 1_000,
    });
    offset += sampleCount;
  }

  return chunks;
}

export function buildAudioFrame(params: {
  sessionId: string;
  seq: number;
  capturedAt: number;
  pcm: Float32Array;
  durationMs: number;
}): AudioFrame {
  if (params.durationMs > MAX_FRAME_DURATION_MS + 0.001) {
    throw new Error(`Frame duration ${params.durationMs}ms exceeds ${MAX_FRAME_DURATION_MS}ms limit`);
  }

  return {
    sessionId: params.sessionId,
    seq: params.seq,
    capturedAt: params.capturedAt,
    pcm: params.pcm,
    durationMs: params.durationMs,
  };
}
