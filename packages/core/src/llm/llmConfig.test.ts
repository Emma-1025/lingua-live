import { describe, expect, it } from 'vitest';
import {
  createLlmClientFromSettings,
  createLlmClientWithEnvFallback,
  DEFAULT_LLM_SETTINGS,
  LLM_PROVIDER_PRESETS,
} from './llmConfig.js';

describe('createLlmClientFromSettings', () => {
  it('returns mock client for mock provider', async () => {
    const client = createLlmClientFromSettings(DEFAULT_LLM_SETTINGS);
    const text = await client.chatCompletion([{ role: 'user', content: 'hello' }]);
    expect(text).toBe('hello');
  });

  it('returns mock client when api key is missing for cloud providers', async () => {
    const client = createLlmClientFromSettings({
      provider: 'deepseek',
      apiKey: '',
    });
    const text = await client.chatCompletion([{ role: 'user', content: 'test' }]);
    expect(text).toBe('test');
  });

  it('builds a client when api key is present', () => {
    const client = createLlmClientFromSettings(
      {
        provider: 'deepseek',
        apiKey: 'sk-test',
        translationModel: 'deepseek-v4-flash',
      },
      'translation',
    );
    expect(client).toBeDefined();
  });

  it('uses OpenAI preset defaults', () => {
    expect(LLM_PROVIDER_PRESETS.openai.baseUrl).toBe('https://api.openai.com/v1');
    expect(
      createLlmClientFromSettings({ provider: 'openai', apiKey: 'sk-openai' }, 'translation'),
    ).toBeDefined();
  });

  it('falls back to env-configured DeepSeek when UI key is empty', () => {
    const env = (
      globalThis as { process?: { env?: Record<string, string | undefined> } }
    ).process?.env;
    const previous = env?.DEEPSEEK_API_KEY;
    if (env) {
      env.DEEPSEEK_API_KEY = 'sk-from-env';
    }

    try {
      expect(
        createLlmClientWithEnvFallback({ provider: 'deepseek', apiKey: '' }),
      ).toBeDefined();
    } finally {
      if (env) {
        if (previous === undefined) {
          delete env.DEEPSEEK_API_KEY;
        } else {
          env.DEEPSEEK_API_KEY = previous;
        }
      }
    }
  });
});
