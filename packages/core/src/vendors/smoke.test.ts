import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioIngestor } from '../audio/ingestor.js';
import { TARGET_SAMPLE_RATE } from '../audio/constants.js';
import type { DeepSeekClient } from '../llm/deepseekClient.js';
import type { AudioFrame, ZhSegment } from '../models.js';
import { createPipeline } from '../pipeline/pipeline.js';
import { TranslatorImpl } from '../translate/translator.js';
import type { AudioPlayer } from '../tts/audioPlayer.js';
import type { DeepgramSocket, DeepgramSocketFactory } from '../asr/deepgramClient.js';
import { createDeepgramSpeechRecognizer } from '../asr/deepgramRecognizer.js';
import { createRealAudioSynthesizer } from '../tts/realSynthesizer.js';
import { createWebAudioSourceMonitor } from '../audio/sourceDuck.js';

function createFrame(params: {
  seq: number;
  durationMs: number;
  capturedAt: number;
  amplitude: number;
}): AudioFrame {
  const sampleCount = Math.round((TARGET_SAMPLE_RATE * params.durationMs) / 1_000);
  const pcm = new Float32Array(sampleCount);
  pcm.fill(params.amplitude);

  return {
    sessionId: 'sess-smoke',
    seq: params.seq,
    capturedAt: params.capturedAt,
    pcm,
    durationMs: params.durationMs,
  };
}

function createSpeechFrames(): AudioFrame[] {
  const frames: AudioFrame[] = [];
  let capturedAt = 1_000;
  let seq = 0;

  for (let index = 0; index < 2; index += 1) {
    frames.push(createFrame({ seq, durationMs: 100, capturedAt, amplitude: 0.5 }));
    seq += 1;
    capturedAt += 100;
  }

  return frames;
}

function createMockIngestor(frames: AudioFrame[]): AudioIngestor {
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

function createDeepgramFactory(transcript: string): DeepgramSocketFactory {
  return {
    connect() {
      const listeners = new Map<string, Set<(event: unknown) => void>>();
      const socket: DeepgramSocket = {
        readyState: 0,
        send() {},
        close() {
          socket.readyState = 3;
        },
        addEventListener(type, listener) {
          if (!listeners.has(type)) {
            listeners.set(type, new Set());
          }
          listeners.get(type)!.add(listener);

          if (type === 'open') {
            queueMicrotask(() => {
              socket.readyState = 1;
              for (const handler of listeners.get('open') ?? []) {
                handler({});
              }

              const payloads = [
                {
                  type: 'Results',
                  channel: { alternatives: [{ transcript }] },
                  is_final: false,
                  speech_final: false,
                  start: 0,
                },
                {
                  type: 'Results',
                  channel: { alternatives: [{ transcript }] },
                  is_final: true,
                  speech_final: true,
                  start: 0,
                },
              ];

              for (const payload of payloads) {
                for (const handler of listeners.get('message') ?? []) {
                  handler({ data: JSON.stringify(payload) });
                }
              }
            });
          }
        },
        removeEventListener(type, listener) {
          listeners.get(type)?.delete(listener);
        },
      };

      return socket;
    },
  };
}

function createMockDeepSeekClient(): DeepSeekClient {
  return {
    async *streamChatCompletion(messages) {
      const content = messages.at(-1)?.content ?? '';
      yield `译:${content}`;
    },
    chatCompletion: async (messages) => `译:${messages.at(-1)?.content ?? ''}`,
  };
}

describe('vendor smoke test', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('drives English audio through real vendor drivers to Chinese subtitles', async () => {
    const frames = createSpeechFrames();
    const subtitles: ZhSegment[] = [];
    const playbackStates: boolean[] = [];
    const monitor = createWebAudioSourceMonitor({
      audioContext: {
        sampleRate: 16_000,
        currentTime: 0,
        createGain: () => ({ gain: { value: 1 }, connect: () => {}, disconnect: () => {} }),
        createBuffer: () => ({ copyToChannel: () => {} }),
        createBufferSource: () => ({
          buffer: null,
          connect: () => {},
          start: () => {},
        }),
        destination: {},
      } as unknown as AudioContext,
    });

    const player: AudioPlayer = {
      play: vi.fn(async () => {}),
      stop: vi.fn(),
    };

    const recognizer = createDeepgramSpeechRecognizer({
      apiKey: 'dg-test',
      socketFactory: createDeepgramFactory('We trained the model on a large corpus.'),
    });

    const synthesizer = createRealAudioSynthesizer({
      driver: {
        synthesize: vi.fn(async () => new ArrayBuffer(8)),
      },
      player,
    });
    synthesizer.setEnabled(true);
    synthesizer.onPlaybackStateChange((playing) => playbackStates.push(playing));

    const pipeline = createPipeline({
      ingestor: createMockIngestor(frames),
      recognizer,
      translator: new TranslatorImpl({ client: createMockDeepSeekClient() }),
      correctionEngine: createCorrectionEngineStub(),
      synthesizer,
      sourceMonitor: monitor,
    });

    pipeline.onSubtitle((update) => {
      subtitles.push(update.segment);
    });

    await pipeline.start({
      sessionId: 'sess-smoke',
      selection: { kind: 'file', filePath: '/audio/corpus.wav' },
    });

    await vi.runAllTimersAsync();
    await pipeline.stop();

    expect(subtitles.some((segment) => segment.status === 'partial')).toBe(true);
    expect(subtitles.some((segment) => segment.status === 'final')).toBe(true);
    expect(pipeline.getTranscriptStore().getEntries().length).toBeGreaterThan(0);
    expect(playbackStates).toContain(true);
  });
});

function createCorrectionEngineStub() {
  return {
    recordDisplayed: vi.fn(),
    handleSourceSegment: vi.fn(async () => [] as ZhSegment[]),
    reset: vi.fn(),
    onRevision: vi.fn(() => () => {}),
  };
}
