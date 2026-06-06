export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';

export const DEFAULT_DEEPSEEK_TEMPERATURE = 0.3;

/** Per-request HTTP timeout for DeepSeek API calls. */
export const DEFAULT_DEEPSEEK_TIMEOUT_MS = 30_000;

export const DEFAULT_DEEPSEEK_MAX_RETRIES = 3;

/** Initial backoff before the first retry on rate-limit / 5xx responses. */
export const DEFAULT_DEEPSEEK_RETRY_BASE_MS = 500;

export const DEEPSEEK_API_KEY_ENV = 'DEEPSEEK_API_KEY';
