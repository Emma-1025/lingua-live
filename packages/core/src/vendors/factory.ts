import {
  createDeepgramSpeechRecognizer,
  type DeepgramSpeechRecognizerConfig,
} from '../asr/deepgramRecognizer.js';
import {
  createSpeechRecognizer,
  type MockSpeechRecognizerDeps,
  type SpeechRecognizer,
} from '../asr/recognizer.js';
import type { AudioSynthesizer } from '../tts/synthesizer.js';
import { createAudioSynthesizer, type MockAudioSynthesizerConfig } from '../tts/synthesizer.js';
import {
  createRealAudioSynthesizer,
  type RealAudioSynthesizerConfig,
} from '../tts/realSynthesizer.js';
import { createOpenAiTtsDriver } from '../tts/ttsDriver.js';
import {
  assertRealAsrConfig,
  assertRealTtsConfig,
  loadVendorConfig,
  type VendorConfig,
} from './config.js';

export interface VendorServices {
  config: VendorConfig;
  recognizer: SpeechRecognizer;
  synthesizer: AudioSynthesizer;
}

export interface CreateVendorServicesOptions {
  config?: VendorConfig;
  env?: Record<string, string | undefined>;
  mockRecognizerDeps?: MockSpeechRecognizerDeps;
  mockSynthesizerConfig?: MockAudioSynthesizerConfig;
  deepgramConfig?: Partial<DeepgramSpeechRecognizerConfig>;
  realSynthesizerConfig?: Partial<RealAudioSynthesizerConfig>;
}

export function createVendorSpeechRecognizer(
  config: VendorConfig,
  options: CreateVendorServicesOptions = {},
): SpeechRecognizer {
  if (config.mode === 'mock') {
    return createSpeechRecognizer(options.mockRecognizerDeps);
  }

  assertRealAsrConfig(config);
  return createDeepgramSpeechRecognizer({
    apiKey: config.deepgramApiKey!,
    ...options.deepgramConfig,
  });
}

export function createVendorAudioSynthesizer(
  config: VendorConfig,
  options: CreateVendorServicesOptions = {},
): AudioSynthesizer {
  if (config.mode === 'mock') {
    return createAudioSynthesizer(options.mockSynthesizerConfig);
  }

  if (!config.ttsApiKey) {
    return createAudioSynthesizer(options.mockSynthesizerConfig);
  }

  assertRealTtsConfig(config);
  const driver =
    options.realSynthesizerConfig?.driver ??
    createOpenAiTtsDriver({
      apiKey: config.ttsApiKey!,
      baseUrl: config.ttsBaseUrl,
      model: config.ttsModel,
      voice: config.ttsVoice,
    });

  return createRealAudioSynthesizer({
    driver,
    player: options.realSynthesizerConfig?.player,
    setTimeoutFn: options.realSynthesizerConfig?.setTimeoutFn,
    clearTimeoutFn: options.realSynthesizerConfig?.clearTimeoutFn,
  });
}

export function createVendorServices(options: CreateVendorServicesOptions = {}): VendorServices {
  const config = options.config ?? loadVendorConfig(options.env);
  return {
    config,
    recognizer: createVendorSpeechRecognizer(config, options),
    synthesizer: createVendorAudioSynthesizer(config, options),
  };
}
