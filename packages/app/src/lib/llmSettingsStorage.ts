import {
  DEFAULT_LLM_SETTINGS,
  type LlmProvider,
  type LlmSettings,
} from '@lingua-live/core';

const STORAGE_KEY = 'lingua-live-llm-settings-v1';

const PROVIDERS: LlmProvider[] = ['mock', 'deepseek', 'openai'];

function readDeepSeekKeyFromBuildEnv(): string {
  // Must reference process.env.DEEPSEEK_API_KEY directly so Vite define can inline it.
  return process.env.DEEPSEEK_API_KEY?.trim() ?? '';
}

function settingsWithEnvDeepSeekDefaults(settings: LlmSettings): LlmSettings {
  const envKey = readDeepSeekKeyFromBuildEnv();
  if (!envKey || settings.apiKey.trim()) {
    return settings;
  }

  return {
    ...settings,
    provider: 'deepseek',
    apiKey: envKey,
  };
}

function isLlmProvider(value: unknown): value is LlmProvider {
  return typeof value === 'string' && PROVIDERS.includes(value as LlmProvider);
}

export function loadLlmSettings(): LlmSettings {
  if (typeof globalThis.localStorage === 'undefined') {
    return settingsWithEnvDeepSeekDefaults(DEFAULT_LLM_SETTINGS);
  }

  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return settingsWithEnvDeepSeekDefaults(DEFAULT_LLM_SETTINGS);
    }

    const parsed = JSON.parse(raw) as Partial<LlmSettings>;
    return settingsWithEnvDeepSeekDefaults({
      ...DEFAULT_LLM_SETTINGS,
      ...parsed,
      provider: isLlmProvider(parsed.provider) ? parsed.provider : DEFAULT_LLM_SETTINGS.provider,
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : undefined,
      translationModel:
        typeof parsed.translationModel === 'string' ? parsed.translationModel : undefined,
      correctionModel:
        typeof parsed.correctionModel === 'string' ? parsed.correctionModel : undefined,
    });
  } catch {
    return settingsWithEnvDeepSeekDefaults(DEFAULT_LLM_SETTINGS);
  }
}

export function saveLlmSettings(settings: LlmSettings): void {
  globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings));
}
