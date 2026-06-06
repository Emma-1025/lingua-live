import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScriptedMockAsrDriver } from '../asr/recognizer.js';
import { CorrectionEngineImpl } from '../correct/correctionEngine.js';
import type { DeepSeekClient } from '../llm/deepseekClient.js';
import type { ZhSegment } from '../models.js';
import { createSegmentFrames, createStreamingIngestor } from '../perf/harness.js';
import { createPipeline } from '../pipeline/pipeline.js';
import { TranslatorImpl } from '../translate/translator.js';

const CORPUS_SEGMENT_SCRIPT = [
  {
    hypotheses: [
      {
        text: 'We trained the model on a large corps',
        status: 'partial' as const,
        delayMs: 450,
      },
      {
        text: 'We trained the model on a large corpus',
        status: 'partial' as const,
        delayMs: 900,
      },
      {
        text: 'We trained the model on a large corpus.',
        status: 'final' as const,
        delayMs: 1_200,
      },
    ],
  },
];

/**
 * Bilibili-style acceptance: English system audio → Chinese subtitles with a
 * visible self-correction when ASR revises an early homophone mistake.
 */
describe('Bilibili-style acceptance scenario', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_000));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('streams Chinese subtitles and replaces an early corps/corpus mistake', async () => {
    const client = createCorpusTranslatorClient();
    const driver = new ScriptedMockAsrDriver(CORPUS_SEGMENT_SCRIPT);
    const frames = createSegmentFrames({
      startSeq: 0,
      startCapturedAt: 1_000,
      sessionId: 'sess-bilibili',
    });

    const subtitles: ZhSegment[] = [];
    const pipeline = createPipeline({
      ingestor: createStreamingIngestor(frames),
      recognizerDeps: { driver },
      translator: new TranslatorImpl({ client }),
      correctionEngine: new CorrectionEngineImpl({
        client,
        translator: new TranslatorImpl({ client }),
      }),
    });

    pipeline.onSubtitle((update) => {
      subtitles.push({ ...update.segment });
    });

    await pipeline.start({
      sessionId: 'sess-bilibili',
      selection: { kind: 'system', deviceId: 'system:default' },
      showSourceText: true,
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await pipeline.stop();

    expect(pipeline.getDroppedFrameCount()).toBe(0);
    expect(pipeline.getEnqueuedFrameCount()).toBe(pipeline.getProcessedFrameCount());
    expect(subtitles.some((segment) => segment.status === 'partial')).toBe(true);
    expect(subtitles.some((segment) => segment.status === 'final')).toBe(true);

    const finals = subtitles.filter((segment) => segment.status === 'final');
    expect(finals.at(-1)?.zhText).toContain('语料库');

    const segmentId = subtitles[0]?.id;
    const sameSegment = subtitles.filter((segment) => segment.id === segmentId);
    expect(sameSegment.some((segment) => segment.zhText.includes('军团'))).toBe(true);
    expect(sameSegment.some((segment) => segment.zhText.includes('语料库'))).toBe(true);
  });
});

function createCorpusTranslatorClient(): DeepSeekClient {
  return {
    async *streamChatCompletion(messages) {
      const source = extractSourceText(messages.at(-1)?.content ?? '');
      yield translateEnglishSnippet(source);
    },
    chatCompletion: async (messages) =>
      translateEnglishSnippet(extractSourceText(messages.at(-1)?.content ?? '')),
  };
}

function translateEnglishSnippet(source: string): string {
  if (source.includes('corps')) {
    return '我们在一个大型军团上训练了该模型';
  }

  if (source.includes('corpus')) {
    return '我们在一个大型语料库上训练了该模型。';
  }

  return `译:${source}`;
}

function extractSourceText(content: string): string {
  const match = content.match(/<source>(.*)<\/source>/s);
  return match?.[1] ?? content;
}
