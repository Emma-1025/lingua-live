import { describe, expect, it } from 'vitest';
import { loadVendorConfig, VendorConfigError, assertRealVendorConfig } from './config.js';

describe('loadVendorConfig', () => {
  it('defaults to mock mode without API keys', () => {
    const config = loadVendorConfig({});
    expect(config.mode).toBe('mock');
    expect(config.ttsBaseUrl).toContain('openai.com');
  });

  it('parses real mode and keys from env', () => {
    const config = loadVendorConfig({
      LINGUA_VENDOR_MODE: 'real',
      DEEPGRAM_API_KEY: 'dg-test',
      OPENAI_API_KEY: 'sk-test',
      TTS_VOICE: 'nova',
    });

    expect(config.mode).toBe('real');
    expect(config.deepgramApiKey).toBe('dg-test');
    expect(config.ttsApiKey).toBe('sk-test');
    expect(config.ttsVoice).toBe('nova');
  });

  it('rejects unknown vendor mode', () => {
    expect(() =>
      loadVendorConfig({ LINGUA_VENDOR_MODE: 'staging' }),
    ).toThrow(VendorConfigError);
  });
});

describe('assertRealVendorConfig', () => {
  it('requires Deepgram and TTS keys in real mode', () => {
    expect(() =>
      assertRealVendorConfig({
        mode: 'real',
        ttsBaseUrl: 'https://api.openai.com/v1',
        ttsModel: 'tts-1',
        ttsVoice: 'alloy',
      }),
    ).toThrow(/DEEPGRAM_API_KEY/);
  });
});
