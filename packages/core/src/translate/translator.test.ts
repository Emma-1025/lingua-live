import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeepSeekClient } from '../llm/deepseekClient.js';
import type { ContextWindow, SourceSegment } from '../models.js';
import { TRANSLATION_TIMEOUT_MS } from './constants.js';
import {
  TranslationTimeoutError,
  TranslatorImpl,
  createTranslator,
  createUntranslatedZhSegment,
} from './translator.js';

function createSourceSegment(
  overrides: Partial<SourceSegment> = {},
): SourceSegment {
  return {
    id: 'seg-1',
    sessionId: 'sess-1',
    text: 'hello world',
    status: 'final',
    startedAt: 1_000,
    spokenIndex: 0,
    recognizable: true,
    ...overrides,
  };
}

function createMockClient(overrides: Partial<DeepSeekClient> = {}): DeepSeekClient {
  return {
    streamChatCompletion: vi.fn(async function* () {
      yield '你';
      yield '好';
    }),
    chatCompletion: vi.fn().mockResolvedValue('你好世界'),
    ...overrides,
  };
}

describe('TranslatorImpl', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('streams partial translation tokens', async () => {
    const client = createMockClient();
    const translator = new TranslatorImpl({ client });
    const segment = createSourceSegment({ status: 'partial', text: 'hello' });

    const tokens: string[] = [];
    for await (const token of translator.translatePartial(segment)) {
      tokens.push(token);
    }

    expect(tokens).toEqual(['你', '好']);
    expect(client.streamChatCompletion).toHaveBeenCalledWith([
      expect.objectContaining({ role: 'system' }),
      { role: 'user', content: '<source>hello</source>' },
    ]);
  });

  it('preserves partial/final classification on final translation', async () => {
    const client = createMockClient();
    const translator = new TranslatorImpl({ client });

    const partial = await translator.translateFinal(
      createSourceSegment({ status: 'partial' }),
      { entries: [] },
    );
    const final = await translator.translateFinal(
      createSourceSegment({ status: 'final', id: 'seg-2', spokenIndex: 1 }),
      { entries: [] },
    );

    expect(partial.status).toBe('partial');
    expect(final.status).toBe('final');
  });

  it('includes recent context pairs in the final translation prompt', async () => {
    const client = createMockClient();
    const translator = new TranslatorImpl({ client, contextWindowSize: 2 });
    const context: ContextWindow = {
      entries: [
        {
          id: 'seg-a',
          sourceText: 'first sentence',
          zhText: '第一句',
          spokenIndex: 0,
        },
        {
          id: 'seg-b',
          sourceText: 'second sentence',
          zhText: '第二句',
          spokenIndex: 1,
        },
        {
          id: 'seg-c',
          sourceText: 'third sentence',
          zhText: '第三句',
          spokenIndex: 2,
        },
      ],
    };

    await translator.translateFinal(
      createSourceSegment({ text: 'fourth sentence', spokenIndex: 3 }),
      context,
    );

    const messages = vi.mocked(client.chatCompletion).mock.calls[0]?.[0];
    const userMessage = messages?.[1]?.content ?? '';

    expect(userMessage).toContain('second sentence');
    expect(userMessage).toContain('第三句');
    expect(userMessage).not.toContain('first sentence');
    expect(userMessage).toContain('<source>fourth sentence</source>');
  });

  it('prepends glossary text to the system prompt', async () => {
    const client = createMockClient();
    const translator = new TranslatorImpl({
      client,
      glossary: 'corpus => 语料库',
    });

    await translator.translateFinal(createSourceSegment(), { entries: [] });

    const messages = vi.mocked(client.chatCompletion).mock.calls[0]?.[0];
    expect(messages?.[0]?.content).toContain('corpus => 语料库');
  });

  it('returns an untranslated fallback segment on timeout or failure', async () => {
    const client = createMockClient({
      chatCompletion: vi.fn((): Promise<string> => new Promise(() => {})),
    });
    const translator = new TranslatorImpl({
      client,
      translationTimeoutMs: TRANSLATION_TIMEOUT_MS,
    });
    const segment = createSourceSegment({ text: 'delayed phrase' });

    const promise = translator.translateFinal(segment, { entries: [] });
    await vi.advanceTimersByTimeAsync(TRANSLATION_TIMEOUT_MS + 1);

    await expect(promise).resolves.toEqual({
      id: 'seg-1',
      sessionId: 'sess-1',
      sourceText: 'delayed phrase',
      zhText: 'delayed phrase',
      status: 'final',
      spokenIndex: 0,
      untranslated: true,
    });
  });

  it('returns an untranslated fallback when the client throws', async () => {
    const client = createMockClient({
      chatCompletion: vi.fn().mockRejectedValue(new Error('network down')),
    });
    const translator = new TranslatorImpl({ client });

    await expect(
      translator.translateFinal(createSourceSegment({ text: 'broken request' }), {
        entries: [],
      }),
    ).resolves.toEqual(
      createUntranslatedZhSegment(createSourceSegment({ text: 'broken request' })),
    );
  });

  it('aborts partial streaming when translation exceeds the timeout', async () => {
    vi.useRealTimers();

    const client = createMockClient({
      streamChatCompletion: vi.fn(() => ({
        async next() {
          await new Promise(() => {});
          return { done: true as const, value: undefined };
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      })),
    });
    const translator = new TranslatorImpl({
      client,
      translationTimeoutMs: 20,
    });

    const partialIterator = translator.translatePartial(
      createSourceSegment({ status: 'partial' }),
    )[Symbol.asyncIterator]();

    await expect(partialIterator.next()).rejects.toBeInstanceOf(TranslationTimeoutError);

    vi.useFakeTimers();
  });

  it('creates a translator via factory', () => {
    expect(createTranslator({ client: createMockClient() })).toBeInstanceOf(TranslatorImpl);
  });
});
