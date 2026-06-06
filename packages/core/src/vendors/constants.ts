/** Feature flag: `mock` uses scripted drivers; `real` uses cloud ASR/TTS. */
export const VENDOR_MODE_ENV = 'LINGUA_VENDOR_MODE';

export const DEEPGRAM_API_KEY_ENV = 'DEEPGRAM_API_KEY';

export const TTS_API_KEY_ENV = 'TTS_API_KEY';

/** Alias accepted for OpenAI-compatible TTS endpoints. */
export const OPENAI_API_KEY_ENV = 'OPENAI_API_KEY';

export const TTS_BASE_URL_ENV = 'TTS_BASE_URL';

export const TTS_MODEL_ENV = 'TTS_MODEL';

export const TTS_VOICE_ENV = 'TTS_VOICE';

export const DEFAULT_VENDOR_MODE = 'mock' as const;

export const DEFAULT_DEEPGRAM_BASE_URL = 'wss://api.deepgram.com/v1/listen';

export const DEFAULT_TTS_BASE_URL = 'https://api.openai.com/v1';

export const DEFAULT_TTS_MODEL = 'tts-1';

export const DEFAULT_TTS_VOICE = 'alloy';

/** Gain applied to optional source monitor playback while Chinese TTS is active (Req 6.6). */
export const DUCKED_SOURCE_GAIN = 0.05;

export const NORMAL_SOURCE_GAIN = 1;
