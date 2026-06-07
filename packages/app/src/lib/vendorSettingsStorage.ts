import { DEFAULT_VENDOR_CONFIG, type VendorConfig, type VendorMode } from '@lingua-live/core';

const STORAGE_KEY = 'lingua-live-vendor-settings-v1';
const MODES: VendorMode[] = ['mock', 'real'];

function readVendorModeFromBuildEnv(): VendorMode | undefined {
  // Must reference process.env.LINGUA_VENDOR_MODE directly so Vite define can inline it.
  const mode = process.env.LINGUA_VENDOR_MODE?.trim();
  return mode === 'real' || mode === 'mock' ? mode : undefined;
}

function settingsWithBuildEnvDefaults(
  settings: VendorConfig,
  options: { useEnvMode: boolean },
): VendorConfig {
  const mode = readVendorModeFromBuildEnv();
  const deepgramApiKey =
    settings.deepgramApiKey?.trim() ||
    // Must reference process.env.DEEPGRAM_API_KEY directly so Vite define can inline it.
    process.env.DEEPGRAM_API_KEY?.trim() ||
    undefined;
  const ttsApiKey =
    settings.ttsApiKey?.trim() ||
    // Must reference process.env.TTS_API_KEY / OPENAI_API_KEY directly for Vite env inlining.
    process.env.TTS_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    undefined;

  return {
    ...settings,
    mode: options.useEnvMode ? (mode ?? settings.mode) : settings.mode,
    deepgramApiKey,
    ttsApiKey,
    // Must reference process.env.TTS_BASE_URL / TTS_MODEL / TTS_VOICE directly for Vite env inlining.
    ttsBaseUrl:
      settings.ttsBaseUrl || process.env.TTS_BASE_URL?.trim() || DEFAULT_VENDOR_CONFIG.ttsBaseUrl,
    ttsModel: settings.ttsModel || process.env.TTS_MODEL?.trim() || DEFAULT_VENDOR_CONFIG.ttsModel,
    ttsVoice: settings.ttsVoice || process.env.TTS_VOICE?.trim() || DEFAULT_VENDOR_CONFIG.ttsVoice,
  };
}

function isVendorMode(value: unknown): value is VendorMode {
  return typeof value === 'string' && MODES.includes(value as VendorMode);
}

function normalizeVendorSettings(settings: Partial<VendorConfig>): VendorConfig {
  return {
    ...DEFAULT_VENDOR_CONFIG,
    mode: isVendorMode(settings.mode) ? settings.mode : DEFAULT_VENDOR_CONFIG.mode,
    deepgramApiKey:
      typeof settings.deepgramApiKey === 'string' ? settings.deepgramApiKey : undefined,
    ttsApiKey: typeof settings.ttsApiKey === 'string' ? settings.ttsApiKey : undefined,
    ttsBaseUrl:
      typeof settings.ttsBaseUrl === 'string'
        ? settings.ttsBaseUrl
        : DEFAULT_VENDOR_CONFIG.ttsBaseUrl,
    ttsModel:
      typeof settings.ttsModel === 'string' ? settings.ttsModel : DEFAULT_VENDOR_CONFIG.ttsModel,
    ttsVoice:
      typeof settings.ttsVoice === 'string' ? settings.ttsVoice : DEFAULT_VENDOR_CONFIG.ttsVoice,
  };
}

export function loadVendorSettings(): VendorConfig {
  if (typeof globalThis.localStorage === 'undefined') {
    return settingsWithBuildEnvDefaults(DEFAULT_VENDOR_CONFIG, { useEnvMode: true });
  }

  try {
    const raw = globalThis.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return settingsWithBuildEnvDefaults(DEFAULT_VENDOR_CONFIG, { useEnvMode: true });
    }

    return settingsWithBuildEnvDefaults(normalizeVendorSettings(JSON.parse(raw)), {
      useEnvMode: false,
    });
  } catch {
    return settingsWithBuildEnvDefaults(DEFAULT_VENDOR_CONFIG, { useEnvMode: true });
  }
}

export function saveVendorSettings(settings: VendorConfig): void {
  globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings));
}
