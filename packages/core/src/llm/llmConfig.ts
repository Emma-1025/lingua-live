import { DEFAULT_CORRECTION_MODEL } from '../correct/constants.js';
import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
} from './constants.js';
import {
  createDeepSeekClient,
  createDeepSeekClientIfConfigured,
  createMockDeepSeekClient,
  type DeepSeekClient,
} from './deepseekClient.js';

export type LlmProvider = 'mock' | 'deepseek' | 'openai';

export interface LlmProviderPreset {
  label: string;
  baseUrl: string;
  translationModel: string;
  correctionModel: string;
}

export const LLM_PROVIDER_PRESETS: Record<
  Exclude<LlmProvider, 'mock'>,
  LlmProviderPreset
> = {
  deepseek: {
    label: 'DeepSeek',
    baseUrl: DEFAULT_DEEPSEEK_BASE_URL,
    translationModel: DEFAULT_DEEPSEEK_MODEL,
    correctionModel: DEFAULT_CORRECTION_MODEL,
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    translationModel: 'gpt-4o-mini',
    correctionModel: 'gpt-4o-mini',
  },
};

export const LLM_PROVIDER_OPTIONS: Array<{
  value: LlmProvider;
  label: string;
}> = [
  { value: 'mock', label: '本地模拟（无需密钥）' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'openai', label: 'OpenAI' },
];

export interface LlmSettings {
  provider: LlmProvider;
  apiKey: string;
  /** Optional override for OpenAI-compatible endpoints. */
  baseUrl?: string;
  translationModel?: string;
  correctionModel?: string;
}

export const DEFAULT_LLM_SETTINGS: LlmSettings = {
  provider: 'mock',
  apiKey: '',
};

export type LlmClientRole = 'translation' | 'correction';

export interface LlmClientOptions {
  fetchFn?: typeof fetch;
}

function resolvePreset(provider: Exclude<LlmProvider, 'mock'>): LlmProviderPreset {
  return LLM_PROVIDER_PRESETS[provider];
}

function resolveModel(
  settings: LlmSettings,
  role: LlmClientRole,
): string | undefined {
  if (role === 'translation') {
    return settings.translationModel?.trim() || undefined;
  }
  return settings.correctionModel?.trim() || undefined;
}

/** Builds a chat-completion client from user settings (mock when provider is mock or key is empty). */
export function createLlmClientFromSettings(
  settings: LlmSettings,
  role: LlmClientRole = 'translation',
  options?: LlmClientOptions,
): DeepSeekClient {
  if (settings.provider === 'mock') {
    return createMockDeepSeekClient();
  }

  const apiKey = settings.apiKey.trim();
  if (!apiKey) {
    return createMockDeepSeekClient();
  }

  const preset = resolvePreset(settings.provider);
  const model =
    resolveModel(settings, role) ??
    (role === 'translation' ? preset.translationModel : preset.correctionModel);
  const baseUrl = settings.baseUrl?.trim() || preset.baseUrl;

  return createDeepSeekClient({
    apiKey,
    baseUrl,
    model,
    fetchFn: options?.fetchFn,
  });
}

/** Uses UI settings first; DeepSeek env key is a fallback when the UI key is empty. */
export function createLlmClientWithEnvFallback(
  settings: LlmSettings,
  role: LlmClientRole = 'translation',
  options?: LlmClientOptions,
): DeepSeekClient {
  if (settings.provider !== 'mock' && settings.apiKey.trim()) {
    return createLlmClientFromSettings(settings, role, options);
  }

  if (settings.provider === 'openai') {
    return createMockDeepSeekClient();
  }

  const model =
    settings.provider === 'deepseek'
      ? (resolveModel(settings, role) ??
        (role === 'translation' ? DEFAULT_DEEPSEEK_MODEL : DEFAULT_CORRECTION_MODEL))
      : role === 'translation'
        ? DEFAULT_DEEPSEEK_MODEL
        : DEFAULT_CORRECTION_MODEL;
  const baseUrl =
    settings.provider === 'deepseek'
      ? settings.baseUrl?.trim() || DEFAULT_DEEPSEEK_BASE_URL
      : DEFAULT_DEEPSEEK_BASE_URL;

  return createDeepSeekClientIfConfigured({
    baseUrl,
    model,
    fetchFn: options?.fetchFn,
  });
}
