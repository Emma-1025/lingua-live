import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeepSeekClient } from '../llm/deepseekClient.js';
import type { SourceSegment, ZhSegment } from '../models.js';
import type { Translator } from '../translate/translator.js';
import {
  CORRECTION_EMIT_DEADLINE_MS,
  CORRECTION_FREEZE_AFTER_MS,
} from './constants.js';
import {
  CorrectionEngineImpl,
  createCorrectionEngine,
  parseCorrectionResponse,
} from './correctionEngine.js';

function createSource(overrides: Partial<SourceSegment> = {}): SourceSegment {
  return {
    id: 'seg-1',
    sessionId: 'sess-1',
    text: 'large corps',
    status: 'partial',
    startedAt: 1_000,
    spokenIndex: 0,
    recognizable: true,
    ...overrides,
  };
}

function createZh(overrides: Partial<ZhSegment> = {}): ZhSegment {
  return {
    id: 'seg-1',
    sessionId: 'sess-1',
    sourceText: 'large corps',
    zhText: '大型军团',
    status: 'partial',
    spokenIndex: 0,
    untranslated: false,
    ...overrides,
  };
}

describe('parseCorrectionResponse', () => {
  it('parses array and wrapped JSON payloads', () => {
    expect(
      parseCorrectionResponse('[{"id":"seg-1","zhText":"大型语料库"}]'),
    ).toEqual([{ id: 'seg-1', zhText: '大型语料库', sourceText: '', spokenIndex: 0 }]);

    expect(
      parseCorrectionResponse('{"revisions":[{"id":"seg-2","zhText":"修正"}]}'),
    ).toEqual([{ id: 'seg-2', zhText: '修正', sourceText: '', spokenIndex: 0 }]);
  });

  it('discards malformed JSON without throwing', () => {
    expect(parseCorrectionResponse('not-json')).toBeUndefined();
    expect(parseCorrectionResponse('[{"id":1,"zhText":"x"}]')).toBeUndefined();
  });
});

describe('CorrectionEngineImpl', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('revises an eligible segment when ASR text changes', async () => {
    const translator: Translator = {
      setGlossary: vi.fn(),
      setSourceLanguage: vi.fn(),
      translatePartial: vi.fn(),
      translateFinal: vi.fn().mockResolvedValue({
        ...createZh({ sourceText: 'large corpus', zhText: '大型语料库', status: 'final' }),
      }),
    };
    const engine = new CorrectionEngineImpl({
      translator,
      client: createIdleClient(),
      now: () => 2_000,
    });

    engine.recordDisplayed(createZh(), 1_500);
    await engine.handleSourceSegment(createSource({ text: 'large corps' }), 1_600);
    const revisions = await engine.handleSourceSegment(
      createSource({ text: 'large corpus', status: 'final' }),
      1_800,
    );

    expect(revisions).toHaveLength(1);
    expect(revisions[0]?.zhText).toBe('大型语料库');
    expect(revisions[0]?.revisedAt).toBe(2_000);
  });

  it('drops identical retranslations to prevent flicker', async () => {
    const translator: Translator = {
      setGlossary: vi.fn(),
      setSourceLanguage: vi.fn(),
      translatePartial: vi.fn(),
      translateFinal: vi.fn().mockResolvedValue(createZh({ zhText: '大型军团' })),
    };
    const engine = new CorrectionEngineImpl({
      translator,
      client: createIdleClient(),
      now: () => 2_000,
    });

    engine.recordDisplayed(createZh(), 1_500);
    const revisions = await engine.handleSourceSegment(
      createSource({ text: 'large corps revised' }),
      1_800,
    );

    expect(revisions).toEqual([]);
  });

  it('freezes finals displayed more than ten seconds ago', async () => {
    const translator: Translator = {
      setGlossary: vi.fn(),
      setSourceLanguage: vi.fn(),
      translatePartial: vi.fn(),
      translateFinal: vi.fn(),
    };
    const engine = new CorrectionEngineImpl({
      translator,
      client: createIdleClient(),
      now: () => 12_000,
    });

    engine.recordDisplayed(
      createZh({ id: 'seg-old', status: 'final', spokenIndex: 0 }),
      1_000,
    );

    const revisions = await engine.handleSourceSegment(
      createSource({
        id: 'seg-old',
        text: 'updated text',
        status: 'final',
        spokenIndex: 0,
      }),
      11_500,
    );

    expect(revisions).toEqual([]);
    expect(translator.translateFinal).not.toHaveBeenCalled();
    expect(12_000 - 1_000).toBeGreaterThan(CORRECTION_FREEZE_AFTER_MS);
  });

  it('applies context revisions only to targeted ids with changed text', async () => {
    const client: DeepSeekClient = {
      streamChatCompletion: vi.fn(),
      chatCompletion: vi.fn().mockResolvedValue(
        '[{"id":"seg-1","zhText":"大型语料库"}]',
      ),
    };
    const engine = new CorrectionEngineImpl({
      client,
      translator: createIdleTranslator(),
      now: () => 3_000,
    });

    engine.recordDisplayed(createZh(), 2_500);
    engine.recordDisplayed(
      createZh({ id: 'seg-2', spokenIndex: 1, sourceText: 'next', zhText: '下一句', status: 'final' }),
      2_800,
    );

    const revisions = await engine.handleSourceSegment(
      createSource({
        id: 'seg-3',
        text: 'final sentence',
        status: 'final',
        spokenIndex: 2,
      }),
      2_900,
    );

    expect(revisions).toEqual([
      expect.objectContaining({ id: 'seg-1', zhText: '大型语料库', revisedAt: 3_000 }),
    ]);
  });

  it('discards malformed correction responses without regressing displayed text', async () => {
    const client: DeepSeekClient = {
      streamChatCompletion: vi.fn(),
      chatCompletion: vi.fn().mockResolvedValue('{"broken":true}'),
    };
    const engine = new CorrectionEngineImpl({
      client,
      translator: createIdleTranslator(),
      now: () => 2_000,
    });

    engine.recordDisplayed(createZh(), 1_500);
    const revisions = await engine.handleSourceSegment(
      createSource({ status: 'final', text: 'final context' }),
      1_800,
    );

    expect(revisions).toEqual([]);
    expect(engine).toBeDefined();
  });

  it('skips emission when correction exceeds the two second deadline', async () => {
    const client: DeepSeekClient = {
      streamChatCompletion: vi.fn(),
      chatCompletion: vi.fn(
        (): Promise<string> =>
          new Promise((resolve) => {
            globalThis.setTimeout(
              () => resolve('[{"id":"seg-1","zhText":"迟到修正"}]'),
              CORRECTION_EMIT_DEADLINE_MS + 100,
            );
          }),
      ),
    };
    const engine = new CorrectionEngineImpl({
      client,
      translator: createIdleTranslator(),
      now: () => 5_000,
    });

    engine.recordDisplayed(createZh(), 4_900);
    const promise = engine.handleSourceSegment(
      createSource({ status: 'final', text: 'late final' }),
      4_950,
    );

    await vi.advanceTimersByTimeAsync(CORRECTION_EMIT_DEADLINE_MS + 200);
    await expect(promise).resolves.toEqual([]);
  });

  it('creates an engine via factory', () => {
    expect(
      createCorrectionEngine({
        client: createIdleClient(),
        translator: createIdleTranslator(),
      }),
    ).toBeInstanceOf(CorrectionEngineImpl);
  });

  it('creates without DEEPSEEK_API_KEY using a mock client', () => {
    const env = (
      globalThis as { process?: { env?: Record<string, string | undefined> } }
    ).process?.env;
    const previous = env?.DEEPSEEK_API_KEY;
    if (env) {
      delete env.DEEPSEEK_API_KEY;
    }

    try {
      expect(createCorrectionEngine()).toBeInstanceOf(CorrectionEngineImpl);
    } finally {
      if (env && previous !== undefined) {
        env.DEEPSEEK_API_KEY = previous;
      }
    }
  });
});

function createIdleClient(): DeepSeekClient {
  return {
    streamChatCompletion: vi.fn(),
    chatCompletion: vi.fn().mockResolvedValue('[]'),
  };
}

function createIdleTranslator(): Translator {
  return {
    setGlossary: vi.fn(),
    setSourceLanguage: vi.fn(),
    translatePartial: vi.fn(),
    translateFinal: vi.fn(),
  };
}
