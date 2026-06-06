import { describe, expect, it } from 'vitest';
import { TARGET_SAMPLE_RATE } from '../audio/constants.js';
import type { AudioFrame } from '../models.js';
import type { DeepgramSocket, DeepgramSocketFactory } from './deepgramClient.js';
import { createDeepgramSpeechRecognizer } from './deepgramRecognizer.js';

function createFrame(amplitude: number): AudioFrame {
  const pcm = new Float32Array(TARGET_SAMPLE_RATE / 10);
  pcm.fill(amplitude);
  return {
    sessionId: 'sess-1',
    seq: 0,
    capturedAt: 1_000,
    pcm,
    durationMs: 100,
  };
}

function createMockSocketFactory(messages: string[]): DeepgramSocketFactory {
  return {
    connect() {
      const listeners = new Map<string, Set<(event: unknown) => void>>();
      let openScheduled = false;

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

          if (type === 'open' && !openScheduled) {
            openScheduled = true;
            queueMicrotask(() => {
              socket.readyState = 1;
              for (const handler of listeners.get('open') ?? []) {
                handler({});
              }

              for (const payload of messages) {
                for (const handler of listeners.get('message') ?? []) {
                  handler({ data: payload });
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

describe('DeepgramSpeechRecognizer', () => {
  it('maps interim and final Deepgram results to SourceSegment events', async () => {
    const factory = createMockSocketFactory([
      JSON.stringify({
        type: 'Results',
        channel: { alternatives: [{ transcript: 'hello' }] },
        is_final: false,
        speech_final: false,
        start: 0,
      }),
      JSON.stringify({
        type: 'Results',
        channel: { alternatives: [{ transcript: 'hello world' }] },
        is_final: true,
        speech_final: true,
        start: 0,
      }),
    ]);

    const recognizer = createDeepgramSpeechRecognizer({
      apiKey: 'dg-test',
      socketFactory: factory,
    });

    const segments: Array<{ text: string; status: string }> = [];
    recognizer.onSegment((segment) => {
      segments.push({ text: segment.text, status: segment.status });
    });

    recognizer.pushAudio(createFrame(0.2));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(segments).toEqual([
      { text: 'hello', status: 'partial' },
      { text: 'hello world', status: 'final' },
    ]);
  });
});
