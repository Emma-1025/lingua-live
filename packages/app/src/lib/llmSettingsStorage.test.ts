import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LLM_SETTINGS } from '@lingua-live/core';
import { loadLlmSettings, saveLlmSettings } from './llmSettingsStorage.js';

describe('llmSettingsStorage', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear();
    vi.stubEnv('DEEPSEEK_API_KEY', '');
  });

  afterEach(() => {
    globalThis.localStorage?.clear();
    vi.unstubAllEnvs();
  });

  it('loads defaults when nothing is saved', () => {
    expect(loadLlmSettings()).toEqual(DEFAULT_LLM_SETTINGS);
  });

  it('migrates the old hidden DeepSeek correction model to flash', () => {
    saveLlmSettings({
      provider: 'deepseek',
      apiKey: 'sk-test',
      translationModel: 'deepseek-v4-flash',
      correctionModel: 'deepseek-v4-pro',
    });

    expect(loadLlmSettings()).toMatchObject({
      provider: 'deepseek',
      translationModel: 'deepseek-v4-flash',
      correctionModel: 'deepseek-v4-flash',
    });
  });
});
