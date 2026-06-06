import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DeepSeekApiError,
  DeepSeekClientImpl,
  createDeepSeekClient,
} from './deepseekClient.js';

function sseResponse(chunks: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });

  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('DeepSeekClientImpl', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('streams chat completion tokens from SSE payloads', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      sseResponse([
        'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    );

    const client = new DeepSeekClientImpl({
      apiKey: 'test-key',
      fetchFn,
    });

    const tokens: string[] = [];
    for await (const token of client.streamChatCompletion([
      { role: 'user', content: 'hello' },
    ])) {
      tokens.push(token);
    }

    expect(tokens).toEqual(['你', '好']);
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.deepseek.com/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-key',
        }),
        body: JSON.stringify({
          model: 'deepseek-v4-flash',
          stream: true,
          temperature: 0.3,
          messages: [{ role: 'user', content: 'hello' }],
        }),
      }),
    );
  });

  it('returns non-streaming chat completion text', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        choices: [{ message: { content: '你好世界' } }],
      }),
    );

    const client = new DeepSeekClientImpl({
      apiKey: 'test-key',
      fetchFn,
    });

    await expect(
      client.chatCompletion([{ role: 'user', content: 'hello world' }]),
    ).resolves.toBe('你好世界');
  });

  it('retries rate-limit and 5xx responses with exponential backoff', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, 429))
      .mockResolvedValueOnce(jsonResponse({ error: 'server error' }, 500))
      .mockResolvedValue(
        jsonResponse({
          choices: [{ message: { content: '重试成功' } }],
        }),
      );

    const client = new DeepSeekClientImpl({
      apiKey: 'test-key',
      fetchFn,
      retryBaseMs: 100,
    });

    const promise = client.chatCompletion([{ role: 'user', content: 'retry me' }]);

    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(200);

    await expect(promise).resolves.toBe('重试成功');
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('does not log or embed the API key in error messages', async () => {
    const secretKey = 'super-secret-api-key';
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad request' }, 400));

    const client = new DeepSeekClientImpl({
      apiKey: secretKey,
      fetchFn,
    });

    await expect(client.chatCompletion([{ role: 'user', content: 'hello' }])).rejects.toSatisfy(
      (error: unknown) => {
        expect(error).toBeInstanceOf(DeepSeekApiError);
        const message = (error as Error).message;
        expect(message).not.toContain(secretKey);
        return true;
      },
    );
  });

  it('creates a client via factory', () => {
    expect(createDeepSeekClient({ apiKey: 'test-key' })).toBeInstanceOf(DeepSeekClientImpl);
  });
});
