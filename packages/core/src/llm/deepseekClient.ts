import {
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MAX_RETRIES,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_DEEPSEEK_RETRY_BASE_MS,
  DEFAULT_DEEPSEEK_TEMPERATURE,
  DEFAULT_DEEPSEEK_TIMEOUT_MS,
  DEEPSEEK_API_KEY_ENV,
} from './constants.js';

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface DeepSeekClientConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  thinkingMode?: DeepSeekThinkingMode;
  temperature?: number;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  fetchFn?: typeof fetch;
}

export interface DeepSeekClient {
  streamChatCompletion(messages: ChatMessage[]): AsyncIterable<string>;
  chatCompletion(messages: ChatMessage[]): Promise<string>;
}

export type DeepSeekThinkingMode = 'enabled' | 'disabled';

type FetchFn = typeof fetch;

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;
type ScheduleFn = (fn: () => void, delayMs: number) => TimerHandle;
type CancelScheduleFn = (handle: TimerHandle) => void;

const defaultSchedule: ScheduleFn = (fn, delayMs) => globalThis.setTimeout(fn, delayMs);
const defaultCancelSchedule: CancelScheduleFn = (handle) => globalThis.clearTimeout(handle);

export class DeepSeekApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'DeepSeekApiError';
  }
}

export class DeepSeekClientImpl implements DeepSeekClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly thinkingMode: DeepSeekThinkingMode | undefined;
  private readonly temperature: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  private readonly fetchFn: FetchFn;
  private readonly schedule: ScheduleFn;
  private readonly cancelSchedule: CancelScheduleFn;

  constructor(
    config: DeepSeekClientConfig = {},
    schedule: ScheduleFn = defaultSchedule,
    cancelSchedule: CancelScheduleFn = defaultCancelSchedule,
  ) {
    this.apiKey = config.apiKey ?? readApiKeyFromEnv();
    this.baseUrl = (config.baseUrl ?? DEFAULT_DEEPSEEK_BASE_URL).replace(/\/$/, '');
    this.model = config.model ?? DEFAULT_DEEPSEEK_MODEL;
    this.thinkingMode = config.thinkingMode ?? resolveDefaultThinkingMode(this.baseUrl);
    this.temperature = config.temperature ?? DEFAULT_DEEPSEEK_TEMPERATURE;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_DEEPSEEK_TIMEOUT_MS;
    this.maxRetries = config.maxRetries ?? DEFAULT_DEEPSEEK_MAX_RETRIES;
    this.retryBaseMs = config.retryBaseMs ?? DEFAULT_DEEPSEEK_RETRY_BASE_MS;
    this.fetchFn = config.fetchFn ?? fetch;
    this.schedule = schedule;
    this.cancelSchedule = cancelSchedule;
  }

  async *streamChatCompletion(messages: ChatMessage[]): AsyncIterable<string> {
    const response = await this.requestWithRetry('/chat/completions', this.withThinkingMode({
      model: this.model,
      stream: true,
      temperature: this.temperature,
      messages,
    }));

    if (!response.body) {
      throw new DeepSeekApiError('DeepSeek stream response has no body', response.status);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) {
            continue;
          }

          const payload = trimmed.slice('data:'.length).trim();
          if (!payload || payload === '[DONE]') {
            continue;
          }

          const token = extractStreamToken(payload);
          if (token) {
            yield token;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async chatCompletion(messages: ChatMessage[]): Promise<string> {
    const response = await this.requestWithRetry('/chat/completions', this.withThinkingMode({
      model: this.model,
      stream: false,
      temperature: this.temperature,
      messages,
    }));

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new DeepSeekApiError('DeepSeek response missing message content', response.status);
    }

    return content;
  }

  private async requestWithRetry(path: string, body: Record<string, unknown>): Promise<Response> {
    let attempt = 0;

    while (true) {
      try {
        return await this.request(path, body);
      } catch (error) {
        const shouldRetry =
          error instanceof DeepSeekApiError &&
          (error.status === 429 || error.status >= 500) &&
          attempt < this.maxRetries;

        if (!shouldRetry) {
          throw error;
        }

        const delayMs = this.retryBaseMs * 2 ** attempt;
        attempt += 1;
        await wait(delayMs, this.schedule);
      }
    }
  }

  private async request(path: string, body: Record<string, unknown>): Promise<Response> {
    const controller = new AbortController();
    const timeoutHandle = this.schedule(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new DeepSeekApiError(
          `DeepSeek request failed with status ${response.status}`,
          response.status,
          errorBody,
        );
      }

      return response;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new DeepSeekApiError('DeepSeek request timed out', 408);
      }
      throw error;
    } finally {
      this.cancelSchedule(timeoutHandle);
    }
  }

  private withThinkingMode(body: Record<string, unknown>): Record<string, unknown> {
    if (!this.thinkingMode) {
      return body;
    }

    return {
      ...body,
      thinking: { type: this.thinkingMode },
    };
  }
}

export function createDeepSeekClient(config: DeepSeekClientConfig = {}): DeepSeekClient {
  return new DeepSeekClientImpl(config);
}

/** Local mock for dev/desktop when DEEPSEEK_API_KEY is not configured. */
export function createMockDeepSeekClient(): DeepSeekClient {
  return {
    async *streamChatCompletion(messages) {
      const source = messages.at(-1)?.content ?? '';
      for (const char of source) {
        yield char;
      }
    },
    chatCompletion: async (messages) => messages.at(-1)?.content ?? '',
  };
}

/** Returns a real client when configured; otherwise a non-throwing mock. */
export function createDeepSeekClientIfConfigured(
  config: DeepSeekClientConfig = {},
): DeepSeekClient {
  if (config.apiKey) {
    return createDeepSeekClient(config);
  }

  try {
    return createDeepSeekClient(config);
  } catch {
    return createMockDeepSeekClient();
  }
}

function readApiKeyFromEnv(): string {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const apiKey = env?.[DEEPSEEK_API_KEY_ENV];
  if (!apiKey) {
    throw new Error(`Missing DeepSeek API key. Set ${DEEPSEEK_API_KEY_ENV} in the environment.`);
  }
  return apiKey;
}

function extractStreamToken(payload: string): string | undefined {
  try {
    const parsed = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: string } }>;
    };
    const content = parsed.choices?.[0]?.delta?.content;
    return typeof content === 'string' && content.length > 0 ? content : undefined;
  } catch {
    return undefined;
  }
}

function resolveDefaultThinkingMode(baseUrl: string): DeepSeekThinkingMode | undefined {
  try {
    const hostname = new URL(baseUrl).hostname;
    return hostname === 'api.deepseek.com' || hostname.endsWith('.deepseek.com')
      ? 'disabled'
      : undefined;
  } catch {
    return undefined;
  }
}

function wait(delayMs: number, schedule: ScheduleFn): Promise<void> {
  return new Promise((resolve) => {
    schedule(resolve, delayMs);
  });
}
