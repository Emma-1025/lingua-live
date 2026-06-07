import type { DeepSeekClient, ChatMessage } from '../llm/deepseekClient.js';
import { createDeepSeekClientIfConfigured } from '../llm/deepseekClient.js';
import type {
  ContextWindow,
  SourceSegment,
  SupportedSourceLanguage,
  ZhSegment,
} from '../models.js';
import { DEFAULT_SOURCE_LANGUAGE } from '../models.js';
import {
  DEFAULT_CONTEXT_WINDOW_SIZE,
  TRANSLATION_TIMEOUT_MS,
} from './constants.js';

const SOURCE_LANGUAGE_LABELS: Record<SupportedSourceLanguage, string> = {
  en: 'English',
  ja: 'Japanese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  zh: 'Chinese',
};

export interface TranslatorConfig {
  client?: DeepSeekClient;
  glossary?: string;
  sourceLanguage?: SupportedSourceLanguage;
  contextWindowSize?: number;
  translationTimeoutMs?: number;
}

export interface Translator {
  setGlossary(glossary: string | undefined): void;
  setSourceLanguage(language: SupportedSourceLanguage): void;
  translatePartial(segment: SourceSegment): AsyncIterable<string>;
  translateFinal(segment: SourceSegment, context: ContextWindow): Promise<ZhSegment>;
}

export class TranslatorImpl implements Translator {
  private readonly client: DeepSeekClient;
  private glossary?: string;
  private sourceLanguage: SupportedSourceLanguage;
  private readonly contextWindowSize: number;
  private readonly translationTimeoutMs: number;

  constructor(config: TranslatorConfig = {}) {
    this.client = config.client ?? createDeepSeekClientIfConfigured();
    this.glossary = config.glossary;
    this.sourceLanguage = config.sourceLanguage ?? DEFAULT_SOURCE_LANGUAGE;
    this.contextWindowSize = config.contextWindowSize ?? DEFAULT_CONTEXT_WINDOW_SIZE;
    this.translationTimeoutMs = config.translationTimeoutMs ?? TRANSLATION_TIMEOUT_MS;
  }

  setGlossary(glossary: string | undefined): void {
    this.glossary = glossary;
  }

  setSourceLanguage(language: SupportedSourceLanguage): void {
    this.sourceLanguage = language;
  }

  async *translatePartial(segment: SourceSegment): AsyncIterable<string> {
    const messages = this.buildMessages({
      segmentText: segment.text,
      includeContext: false,
    });

    const iterator = this.client.streamChatCompletion(messages)[Symbol.asyncIterator]();
    const deadline = Date.now() + this.translationTimeoutMs;

    while (true) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        throw new TranslationTimeoutError(segment.id);
      }

      const next = await raceWithTimeout(iterator.next(), remainingMs, segment.id);
      if (next.done) {
        break;
      }

      yield next.value;
    }
  }

  async translateFinal(segment: SourceSegment, context: ContextWindow): Promise<ZhSegment> {
    const messages = this.buildMessages({
      segmentText: segment.text,
      includeContext: true,
      context,
    });

    try {
      const zhText = await withTimeout(
        this.client.chatCompletion(messages),
        this.translationTimeoutMs,
      );

      return this.buildZhSegment(segment, zhText.trim(), false);
    } catch {
      return createUntranslatedZhSegment(segment);
    }
  }

  private buildMessages(params: {
    segmentText: string;
    includeContext: boolean;
    context?: ContextWindow;
  }): ChatMessage[] {
    const sourceLabel = SOURCE_LANGUAGE_LABELS[this.sourceLanguage];
    const systemPrompt = buildSystemPrompt(sourceLabel, this.glossary);
    const userContent = params.includeContext
      ? formatFinalUserContent(params.segmentText, params.context, this.contextWindowSize)
      : formatPartialUserContent(params.segmentText);

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];
  }

  private buildZhSegment(
    segment: SourceSegment,
    zhText: string,
    untranslated: boolean,
  ): ZhSegment {
    return {
      id: segment.id,
      sessionId: segment.sessionId,
      sourceText: segment.text,
      zhText,
      status: segment.status,
      spokenIndex: segment.spokenIndex,
      untranslated,
    };
  }
}

export class TranslationTimeoutError extends Error {
  constructor(readonly segmentId: string) {
    super(`Translation timed out for segment ${segmentId}`);
    this.name = 'TranslationTimeoutError';
  }
}

export function createTranslator(config: TranslatorConfig = {}): Translator {
  return new TranslatorImpl(config);
}

export function createUntranslatedZhSegment(segment: SourceSegment): ZhSegment {
  return {
    id: segment.id,
    sessionId: segment.sessionId,
    sourceText: segment.text,
    zhText: segment.text,
    status: segment.status,
    spokenIndex: segment.spokenIndex,
    untranslated: true,
  };
}

function buildSystemPrompt(sourceLabel: string, glossary?: string): string {
  const glossaryBlock = glossary?.trim()
    ? `Domain glossary:\n${glossary.trim()}\n\n`
    : '';

  return `${glossaryBlock}You are a simultaneous interpreter. Translate the user's complete ${sourceLabel} sentence(s) into fluent, natural Simplified Chinese. Wait for full sentences—never translate isolated words or fragments. Preserve technical terms and the full meaning of each sentence. Output ONLY the Chinese translation, no notes.`;
}

function formatPartialUserContent(segmentText: string): string {
  return `<source>${segmentText}</source>`;
}

function formatFinalUserContent(
  segmentText: string,
  context: ContextWindow | undefined,
  contextWindowSize: number,
): string {
  const entries = (context?.entries ?? [])
    .slice(-contextWindowSize)
    .map(
      (entry) =>
        `[${entry.spokenIndex}] source="${entry.sourceText}" zh="${entry.zhText}"`,
    );

  const contextBlock =
    entries.length > 0 ? `<context>\n${entries.join('\n')}\n</context>\n` : '';

  return `${contextBlock}<source>${segmentText}</source>`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return raceWithTimeout(promise, timeoutMs, 'unknown');
}

async function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  segmentId: string,
): Promise<T> {
  let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutHandle = globalThis.setTimeout(() => {
          reject(new TranslationTimeoutError(segmentId));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle !== undefined) {
      globalThis.clearTimeout(timeoutHandle);
    }
  }
}
