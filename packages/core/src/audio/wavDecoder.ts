import { TARGET_SAMPLE_RATE } from './constants.js';

export class WavDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WavDecodeError';
  }
}

function readString(view: DataView, offset: number, length: number): string {
  let value = '';
  for (let i = 0; i < length; i += 1) {
    value += String.fromCharCode(view.getUint8(offset + i));
  }
  return value;
}

function resampleTo16kMono(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === TARGET_SAMPLE_RATE) {
    return input;
  }

  const ratio = inputRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i += 1) {
    const sourceIndex = i * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(left + 1, input.length - 1);
    const fraction = sourceIndex - left;
    output[i] = input[left] * (1 - fraction) + input[right] * fraction;
  }

  return output;
}

function decodePcm16Interleaved(
  data: ArrayBuffer,
  channels: number,
  bitsPerSample: number,
): Float32Array {
  if (bitsPerSample !== 16) {
    throw new WavDecodeError(`Unsupported bits per sample: ${bitsPerSample}`);
  }

  const view = new DataView(data);
  const sampleCount = view.byteLength / 2;
  const frameCount = Math.floor(sampleCount / channels);
  const mono = new Float32Array(frameCount);

  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const index = frame * channels + channel;
      const sample = view.getInt16(index * 2, true);
      sum += sample / 32_768;
    }
    mono[frame] = sum / channels;
  }

  return mono;
}

/** Decode a PCM WAV buffer to mono 16 kHz Float32 samples. */
export function decodeWavToMono16k(buffer: ArrayBuffer): Float32Array {
  if (buffer.byteLength < 44) {
    throw new WavDecodeError('WAV file is too short');
  }

  const view = new DataView(buffer);
  if (readString(view, 0, 4) !== 'RIFF' || readString(view, 8, 4) !== 'WAVE') {
    throw new WavDecodeError('Invalid WAV header');
  }

  let offset = 12;
  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = 0;
  let dataSize = 0;

  while (offset + 8 <= buffer.byteLength) {
    const chunkId = readString(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;

    if (chunkId === 'fmt ') {
      audioFormat = view.getUint16(chunkStart, true);
      channels = view.getUint16(chunkStart + 2, true);
      sampleRate = view.getUint32(chunkStart + 4, true);
      bitsPerSample = view.getUint16(chunkStart + 14, true);
    } else if (chunkId === 'data') {
      dataOffset = chunkStart;
      dataSize = chunkSize;
      break;
    }

    offset = chunkStart + chunkSize + (chunkSize % 2);
  }

  if (audioFormat !== 1 || dataSize === 0) {
    throw new WavDecodeError('Unsupported WAV format (PCM data chunk required)');
  }

  const pcmBytes = buffer.slice(dataOffset, dataOffset + dataSize);
  const mono = decodePcm16Interleaved(pcmBytes, channels, bitsPerSample);
  return resampleTo16kMono(mono, sampleRate);
}
