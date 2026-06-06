import type { DeepSeekClient, Translator } from '@lingua-live/core';
import { TranslatorImpl, createTranslator } from '@lingua-live/core';

function extractSourceText(content: string): string {
  const match = content.match(/<source>(.*)<\/source>/s);
  return match?.[1] ?? content;
}

function createMockDeepSeekClient(): DeepSeekClient {
  return {
    async *streamChatCompletion(messages) {
      const source = extractSourceText(messages.at(-1)?.content ?? '');
      for (const char of `译:${source}`) {
        yield char;
      }
    },
    chatCompletion: async (messages) => `译:${extractSourceText(messages.at(-1)?.content ?? '')}`,
  };
}

/** Use the real DeepSeek client when configured; otherwise fall back to a local mock. */
export function createDevTranslator(): Translator {
  try {
    return createTranslator();
  } catch {
    return new TranslatorImpl({ client: createMockDeepSeekClient() });
  }
}
