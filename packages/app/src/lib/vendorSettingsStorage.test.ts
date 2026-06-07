import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VENDOR_CONFIG } from '@lingua-live/core';
import { loadVendorSettings, saveVendorSettings } from './vendorSettingsStorage.js';

describe('vendorSettingsStorage', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
    vi.stubEnv('LINGUA_VENDOR_MODE', '');
    vi.stubEnv('DEEPGRAM_API_KEY', '');
    vi.stubEnv('TTS_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('TTS_BASE_URL', '');
    vi.stubEnv('TTS_MODEL', '');
    vi.stubEnv('TTS_VOICE', '');
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
    vi.unstubAllEnvs();
  });

  it('loads defaults when nothing is saved', () => {
    expect(loadVendorSettings()).toEqual(DEFAULT_VENDOR_CONFIG);
  });

  it('saves and reloads real ASR/TTS settings', () => {
    const settings = {
      ...DEFAULT_VENDOR_CONFIG,
      mode: 'real' as const,
      deepgramApiKey: 'dg-test',
      ttsApiKey: 'sk-test',
      ttsVoice: 'nova',
    };

    saveVendorSettings(settings);

    expect(loadVendorSettings()).toEqual(settings);
  });

  it('does not let env mode override a saved app mode', () => {
    vi.stubEnv('LINGUA_VENDOR_MODE', 'real');
    saveVendorSettings(DEFAULT_VENDOR_CONFIG);

    expect(loadVendorSettings().mode).toBe('mock');
  });

  it('prefills Deepgram from build env and enables real mode like DeepSeek', () => {
    vi.stubEnv('DEEPGRAM_API_KEY', 'dg-from-env');
    saveVendorSettings(DEFAULT_VENDOR_CONFIG);

    expect(loadVendorSettings()).toEqual({
      ...DEFAULT_VENDOR_CONFIG,
      mode: 'real',
      deepgramApiKey: 'dg-from-env',
    });
  });
});
