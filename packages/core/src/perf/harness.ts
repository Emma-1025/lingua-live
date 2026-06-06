import { ScriptedMockAsrDriver, type MockAsrSegmentScript } from '../asr/recognizer.js';
import type { AudioIngestor } from '../audio/ingestor.js';
import { TARGET_SAMPLE_RATE } from '../audio/constants.js';
import type { DeepSeekClient } from '../llm/deepseekClient.js';
import type { AudioFrame } from '../models.js';

export function createFrame(params: {
  seq: number;
  durationMs: number;
  capturedAt: number;
  amplitude: number;
  sessionId?: string;
}): AudioFrame {
  const sampleCount = Math.round((TARGET_SAMPLE_RATE * params.durationMs) / 1_000);
  const pcm = new Float32Array(sampleCount);
  pcm.fill(params.amplitude);

  return {
    sessionId: params.sessionId ?? 'sess-perf',
    seq: params.seq,
    capturedAt: params.capturedAt,
    pcm,
    durationMs: params.durationMs,
  };
}

/** One VAD segment: short speech burst followed by trailing silence. */
export function createSegmentFrames(params: {
  startSeq: number;
  startCapturedAt: number;
  sessionId?: string;
  speechFrames?: number;
  silenceFrames?: number;
}): AudioFrame[] {
  const speechFrames = params.speechFrames ?? 2;
  const silenceFrames = params.silenceFrames ?? 6;
  const frames: AudioFrame[] = [];
  let capturedAt = params.startCapturedAt;
  let seq = params.startSeq;

  for (let index = 0; index < speechFrames; index += 1) {
    frames.push(
      createFrame({
        seq,
        durationMs: 100,
        capturedAt,
        amplitude: 0.5,
        sessionId: params.sessionId,
      }),
    );
    seq += 1;
    capturedAt += 100;
  }

  for (let index = 0; index < silenceFrames; index += 1) {
    frames.push(
      createFrame({
        seq,
        durationMs: 100,
        capturedAt,
        amplitude: 0,
        sessionId: params.sessionId,
      }),
    );
    seq += 1;
    capturedAt += 100;
  }

  return frames;
}

export function createFramesForScripts(
  scripts: MockAsrSegmentScript[],
  sessionId = 'sess-perf',
): AudioFrame[] {
  const frames: AudioFrame[] = [];
  let capturedAt = 1_000;
  let seq = 0;

  for (let index = 0; index < scripts.length; index += 1) {
    const segmentFrames = createSegmentFrames({
      startSeq: seq,
      startCapturedAt: capturedAt,
      sessionId,
    });
    frames.push(...segmentFrames);
    const last = segmentFrames.at(-1);
    capturedAt = (last?.capturedAt ?? capturedAt) + (last?.durationMs ?? 100);
    seq += segmentFrames.length;
  }

  return frames;
}

export function createStreamingIngestor(frames: AudioFrame[]): AudioIngestor {
  let frameHandler: ((frame: AudioFrame) => void) | undefined;

  return {
    listSources: async () => [],
    start: async () => {
      for (const frame of frames) {
        frameHandler?.(frame);
      }
    },
    stop: async () => {},
    onFrame: (handler) => {
      frameHandler = handler;
      return () => {
        frameHandler = undefined;
      };
    },
    onSourceLost: () => () => {},
    onFileEnd: () => () => {},
    onStartRejected: () => () => {},
    isRunning: () => true,
  };
}

export function createFastDeepSeekClient(): DeepSeekClient {
  return {
    async *streamChatCompletion(messages) {
      const source = extractSourceText(messages.at(-1)?.content ?? '');
      yield `译:${source}`;
    },
    chatCompletion: async (messages) => `译:${extractSourceText(messages.at(-1)?.content ?? '')}`,
  };
}

export function createSlowDeepSeekClient(delayMs: number): DeepSeekClient {
  return {
    async *streamChatCompletion(messages) {
      await delay(delayMs);
      const source = extractSourceText(messages.at(-1)?.content ?? '');
      yield `译:${source}`;
    },
    chatCompletion: async (messages) => {
      await delay(delayMs);
      return `译:${extractSourceText(messages.at(-1)?.content ?? '')}`;
    },
  };
}

export function createGoldenClipScripts(): MockAsrSegmentScript[] {
  const lines = [
    'Welcome to the annual technology conference.',
    'Today we will discuss machine learning at scale.',
    'We trained the model on a large corpus of text.',
    'The system delivers partial subtitles within three seconds.',
    'Latency stays stable even during long sessions.',
    'Thank you for joining us today.',
  ];

  return lines.map((text) => ({
    hypotheses: [
      { text: text.slice(0, Math.max(8, Math.floor(text.length / 2))), status: 'partial' as const, delayMs: 450 },
      { text, status: 'final' as const, delayMs: 1_200 },
    ],
  }));
}

export function createGoldenClipDriver(): ScriptedMockAsrDriver {
  return new ScriptedMockAsrDriver(createGoldenClipScripts());
}

function extractSourceText(content: string): string {
  const match = content.match(/<source>(.*)<\/source>/s);
  return match?.[1] ?? content;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}
