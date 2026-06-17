import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLlmClientFromSettings,
  createLlmClientWithEnvFallback,
  DEFAULT_LLM_SETTINGS,
  LLM_PROVIDER_PRESETS,
} from './llmConfig.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function getRequestBody(fetchFn: ReturnType<typeof vi.fn>, index = 0): Record<string, unknown> {
  return JSON.parse(fetchFn.mock.calls[index][1].body as string) as Record<string, unknown>;
}

describe('createLlmClientFromSettings', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

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

  it('uses DeepSeek flash without thinking for translation and correction defaults', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: 'ok' } }],
      }),
    );

    const translationClient = createLlmClientFromSettings(
      { provider: 'deepseek', apiKey: 'sk-test' },
      'translation',
      { fetchFn },
    );
    const correctionClient = createLlmClientFromSettings(
      { provider: 'deepseek', apiKey: 'sk-test' },
      'correction',
      { fetchFn },
    );

    await translationClient.chatCompletion([{ role: 'user', content: 'translate' }]);
    await correctionClient.chatCompletion([{ role: 'user', content: 'correct' }]);

    expect(getRequestBody(fetchFn, 0)).toMatchObject({
      model: 'deepseek-v4-flash',
      thinking: { type: 'disabled' },
    });
    expect(getRequestBody(fetchFn, 1)).toMatchObject({
      model: 'deepseek-v4-flash',
      thinking: { type: 'disabled' },
    });
  });

  it('honors the DeepSeek UI model when falling back to an env API key', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'sk-from-env');
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: 'ok' } }],
      }),
    );

    const client = createLlmClientWithEnvFallback(
      {
        provider: 'deepseek',
        apiKey: '',
        translationModel: 'custom-translation-model',
      },
      'translation',
      { fetchFn },
    );

    await client.chatCompletion([{ role: 'user', content: 'translate' }]);

    expect(getRequestBody(fetchFn)).toMatchObject({
      model: 'custom-translation-model',
      thinking: { type: 'disabled' },
    });
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
