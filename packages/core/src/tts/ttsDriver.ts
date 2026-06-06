import {
  DEFAULT_TTS_BASE_URL,
  DEFAULT_TTS_MODEL,
  DEFAULT_TTS_VOICE,
} from '../vendors/constants.js';

export interface OpenAiTtsDriverConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  voice?: string;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export interface TtsDriver {
  synthesize(text: string): Promise<ArrayBuffer>;
}

export class OpenAiTtsDriver implements TtsDriver {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly voice: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: OpenAiTtsDriverConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_TTS_BASE_URL).replace(/\/$/, '');
    this.model = config.model ?? DEFAULT_TTS_MODEL;
    this.voice = config.voice ?? DEFAULT_TTS_VOICE;
    this.fetchFn = config.fetchFn ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  async synthesize(text: string): Promise<ArrayBuffer> {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(`${this.baseUrl}/audio/speech`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          input: text,
          voice: this.voice,
          response_format: 'mp3',
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`TTS request failed (${response.status}): ${body}`);
      }

      return await response.arrayBuffer();
    } finally {
      globalThis.clearTimeout(timeout);
    }
  }
}

export function createOpenAiTtsDriver(config: OpenAiTtsDriverConfig): TtsDriver {
  return new OpenAiTtsDriver(config);
}
