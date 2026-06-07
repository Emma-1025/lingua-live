import { describe, expect, it, vi } from 'vitest';
import { DeepgramStreamingClient } from './deepgramClient.js';

describe('DeepgramStreamingClient browser auth', () => {
  it('connects with Sec-WebSocket-Protocol token subprotocol instead of query token', async () => {
    const connect = vi.fn(() => {
      const listeners = new Map<string, Set<(event: unknown) => void>>();
      const socket = {
        readyState: 0,
        send: vi.fn(),
        close: vi.fn(),
        addEventListener(type: string, listener: (event: unknown) => void) {
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
            });
          }
        },
        removeEventListener(type: string, listener: (event: unknown) => void) {
          listeners.get(type)?.delete(listener);
        },
      };

      return socket;
    });

    const client = new DeepgramStreamingClient({
      apiKey: 'dg-browser-key',
      socketFactory: { connect },
    });

    await client.sendPcm(new Float32Array(160));

    expect(connect).toHaveBeenCalledWith(
      expect.stringContaining('wss://api.deepgram.com/v1/listen'),
      { apiKey: 'dg-browser-key' },
    );
    expect(connect.mock.calls[0]?.[0]).not.toContain('token=');
  });
});
