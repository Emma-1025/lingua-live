import { TARGET_SAMPLE_RATE, WavDecodeError, decodeWavToMono16k } from '@lingua-live/core';

type AudioContextConstructor = typeof AudioContext;

interface AudioContextGlobal {
  AudioContext?: AudioContextConstructor;
  webkitAudioContext?: AudioContextConstructor;
}

function isLikelyWav(filePath: string, buffer: ArrayBuffer): boolean {
  const extension = filePath.split('.').pop()?.toLowerCase();
  if (extension === 'wav') {
    return true;
  }

  if (buffer.byteLength < 12) {
    return false;
  }

  const view = new DataView(buffer);
  return view.getUint32(0, false) === 0x52494646 && view.getUint32(8, false) === 0x57415645;
}

function getAudioContextConstructor(): AudioContextConstructor | undefined {
  const audioGlobal = globalThis as typeof globalThis & AudioContextGlobal;
  return audioGlobal.AudioContext ?? audioGlobal.webkitAudioContext;
}

function mixToMono(audioBuffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(audioBuffer.length);
  const channelCount = audioBuffer.numberOfChannels;

  for (let channel = 0; channel < channelCount; channel += 1) {
    const data = audioBuffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      mono[index] += data[index] / channelCount;
    }
  }

  return mono;
}

function resampleTo16kMono(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === TARGET_SAMPLE_RATE) {
    return input;
  }

  const ratio = inputRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(left + 1, input.length - 1);
    const fraction = sourceIndex - left;
    output[index] = input[left] * (1 - fraction) + input[right] * fraction;
  }

  return output;
}

export async function decodeAudioFileToMono16k(
  buffer: ArrayBuffer,
  filePath: string,
): Promise<Float32Array> {
  if (isLikelyWav(filePath, buffer)) {
    return decodeWavToMono16k(buffer);
  }

  const AudioContextCtor = getAudioContextConstructor();
  if (!AudioContextCtor) {
    throw new Error('当前环境无法解码 MP4/M4A/MP3，请改用 WAV 文件或桌面版。');
  }

  const audioContext = new AudioContextCtor();
  try {
    const decoded = await audioContext.decodeAudioData(buffer.slice(0));
    return resampleTo16kMono(mixToMono(decoded), decoded.sampleRate);
  } catch (error) {
    if (error instanceof WavDecodeError) {
      throw error;
    }
    const extension = filePath.split('.').pop()?.toUpperCase() || '媒体';
    throw new Error(`无法解码 ${extension} 文件，请确认文件包含浏览器/WebView 支持的音频轨。`);
  } finally {
    await audioContext.close().catch(() => undefined);
  }
}
