import { describe, expect, it } from 'vitest';
import { MockSpeechRecognizer } from '../asr/recognizer.js';
import { MockAudioSynthesizer } from '../tts/synthesizer.js';
import { DeepgramSpeechRecognizer } from '../asr/deepgramRecognizer.js';
import { RealAudioSynthesizer } from '../tts/realSynthesizer.js';
import {
  createVendorAudioSynthesizer,
  createVendorServices,
  createVendorSpeechRecognizer,
} from './factory.js';

describe('vendor factory', () => {
  it('creates mock drivers by default', () => {
    const services = createVendorServices({
      config: {
        mode: 'mock',
        ttsBaseUrl: 'https://api.openai.com/v1',
        ttsModel: 'tts-1',
        ttsVoice: 'alloy',
      },
    });

    expect(services.recognizer).toBeInstanceOf(MockSpeechRecognizer);
    expect(services.synthesizer).toBeInstanceOf(MockAudioSynthesizer);
  });

  it('creates real drivers when configured', () => {
    const config = {
      mode: 'real' as const,
      deepgramApiKey: 'dg-test',
      ttsApiKey: 'sk-test',
      ttsBaseUrl: 'https://api.openai.com/v1',
      ttsModel: 'tts-1',
      ttsVoice: 'alloy',
    };

    expect(createVendorSpeechRecognizer(config)).toBeInstanceOf(DeepgramSpeechRecognizer);
    expect(
      createVendorAudioSynthesizer(config, {
        realSynthesizerConfig: {
          player: { play: async () => {}, stop: () => {} },
        },
      }),
    ).toBeInstanceOf(RealAudioSynthesizer);
  });

  it('uses real ASR and mock TTS when only Deepgram is configured', () => {
    const services = createVendorServices({
      config: {
        mode: 'real',
        deepgramApiKey: 'dg-test',
        ttsBaseUrl: 'https://api.openai.com/v1',
        ttsModel: 'tts-1',
        ttsVoice: 'alloy',
      },
    });

    expect(services.recognizer).toBeInstanceOf(DeepgramSpeechRecognizer);
    expect(services.synthesizer).toBeInstanceOf(MockAudioSynthesizer);
  });
});
