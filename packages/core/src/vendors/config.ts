import {
  DEEPGRAM_API_KEY_ENV,
  DEFAULT_TTS_BASE_URL,
  DEFAULT_TTS_MODEL,
  DEFAULT_TTS_VOICE,
  DEFAULT_VENDOR_MODE,
  OPENAI_API_KEY_ENV,
  TTS_API_KEY_ENV,
  TTS_BASE_URL_ENV,
  TTS_MODEL_ENV,
  TTS_VOICE_ENV,
  VENDOR_MODE_ENV,
} from './constants.js';

export type VendorMode = 'mock' | 'real';

export interface VendorConfig {
  mode: VendorMode;
  deepgramApiKey?: string;
  ttsApiKey?: string;
  ttsBaseUrl: string;
  ttsModel: string;
  ttsVoice: string;
}

export const DEFAULT_VENDOR_CONFIG: VendorConfig = {
  mode: DEFAULT_VENDOR_MODE,
  ttsBaseUrl: DEFAULT_TTS_BASE_URL,
  ttsModel: DEFAULT_TTS_MODEL,
  ttsVoice: DEFAULT_TTS_VOICE,
};

export class VendorConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VendorConfigError';
  }
}

function readEnv(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key]?.trim();
  return value ? value : undefined;
}

function parseVendorMode(raw: string | undefined): VendorMode {
  if (!raw || raw === DEFAULT_VENDOR_MODE) {
    return 'mock';
  }

  if (raw === 'real') {
    return 'real';
  }

  throw new VendorConfigError(`Invalid ${VENDOR_MODE_ENV}="${raw}". Expected "mock" or "real".`);
}

function defaultEnv(): Record<string, string | undefined> {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return proc?.env ?? {};
}

/** Loads vendor configuration from environment variables (backend / main process only). */
export function loadVendorConfig(
  env: Record<string, string | undefined> = defaultEnv(),
): VendorConfig {
  const mode = parseVendorMode(readEnv(env, VENDOR_MODE_ENV));
  const deepgramApiKey = readEnv(env, DEEPGRAM_API_KEY_ENV);
  const ttsApiKey = readEnv(env, TTS_API_KEY_ENV) ?? readEnv(env, OPENAI_API_KEY_ENV);

  return {
    mode,
    deepgramApiKey,
    ttsApiKey,
    ttsBaseUrl: readEnv(env, TTS_BASE_URL_ENV) ?? DEFAULT_VENDOR_CONFIG.ttsBaseUrl,
    ttsModel: readEnv(env, TTS_MODEL_ENV) ?? DEFAULT_VENDOR_CONFIG.ttsModel,
    ttsVoice: readEnv(env, TTS_VOICE_ENV) ?? DEFAULT_VENDOR_CONFIG.ttsVoice,
  };
}

export function assertRealAsrConfig(config: VendorConfig): void {
  if (config.mode !== 'real') {
    return;
  }

  if (!config.deepgramApiKey) {
    throw new VendorConfigError(
      `Real ASR requires ${DEEPGRAM_API_KEY_ENV} when ${VENDOR_MODE_ENV}=real.`,
    );
  }
}

export function assertRealTtsConfig(config: VendorConfig): void {
  if (config.mode !== 'real') {
    return;
  }

  if (!config.ttsApiKey) {
    throw new VendorConfigError(
      `Real TTS requires ${TTS_API_KEY_ENV} or ${OPENAI_API_KEY_ENV} when ${VENDOR_MODE_ENV}=real.`,
    );
  }
}

export function assertRealVendorConfig(config: VendorConfig): void {
  assertRealAsrConfig(config);
  assertRealTtsConfig(config);
}
