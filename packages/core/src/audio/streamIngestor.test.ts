import { describe, expect, it, vi } from 'vitest';
import type { AudioFrame } from '../models.js';
import type { NativeAudioCaptureBridge } from './captureBridge.js';
import { SourceInaccessibleError } from './ingestor.js';
import { StreamAudioIngestor } from './streamIngestor.js';

function createFrame(seq: number): AudioFrame {
  return {
    sessionId: 'sess-1',
    seq,
    capturedAt: 1_000 + seq,
    pcm: new Float32Array([0.1]),
    durationMs: 100,
  };
}

function createBridge(overrides: Partial<NativeAudioCaptureBridge> = {}): NativeAudioCaptureBridge {
  let frameHandler: ((frame: AudioFrame) => void) | undefined;
  return {
    listSources: vi.fn().mockResolvedValue([
      { id: 'microphone:default', label: 'Mic', kind: 'microphone' },
    ]),
    startCapture: vi.fn().mockResolvedValue(undefined),
    stopCapture: vi.fn().mockResolvedValue(undefined),
    onFrame: vi.fn((handler) => {
      frameHandler = handler;
      return () => {
        frameHandler = undefined;
      };
    }),
    onSourceLost: vi.fn(() => () => {}),
    ...overrides,
    // expose for tests
    emitFrame: (frame: AudioFrame) => frameHandler?.(frame),
  } as NativeAudioCaptureBridge & { emitFrame: (frame: AudioFrame) => void };
}

describe('StreamAudioIngestor', () => {
  it('rejects file sources', async () => {
    const ingestor = new StreamAudioIngestor({ bridge: createBridge() });
    await expect(
      ingestor.start({
        sessionId: 'sess-1',
        selection: { kind: 'file', filePath: '/tmp/a.wav' },
      }),
    ).rejects.toBeInstanceOf(SourceInaccessibleError);
  });

  it('rejects device capture when no native bridge is configured', async () => {
    const ingestor = new StreamAudioIngestor();
    await expect(
      ingestor.start({
        sessionId: 'sess-1',
        selection: { kind: 'microphone', deviceId: 'microphone:default' },
      }),
    ).rejects.toBeInstanceOf(SourceInaccessibleError);
  });

  it('preserves native capture rejection messages from Tauri', async () => {
    const ingestor = new StreamAudioIngestor({
      bridge: createBridge({
        startCapture: vi
          .fn()
          .mockRejectedValue('No system loopback or monitor device available'),
      }),
    });

    await expect(
      ingestor.start({
        sessionId: 'sess-1',
        selection: { kind: 'system', deviceId: 'system:default' },
      }),
    ).rejects.toThrow('No system loopback or monitor device available');
  });

  it('forwards frames from the native bridge', async () => {
    const bridge = createBridge();
    const ingestor = new StreamAudioIngestor({ bridge });
    const onFrame = vi.fn();
    ingestor.onFrame(onFrame);

    await ingestor.start({
      sessionId: 'sess-1',
      selection: { kind: 'system', deviceId: 'system:default' },
    });

    (bridge as NativeAudioCaptureBridge & { emitFrame: (frame: AudioFrame) => void }).emitFrame(
      createFrame(0),
    );
    expect(onFrame).toHaveBeenCalledWith(createFrame(0));

    await ingestor.stop();
    expect(bridge.stopCapture).toHaveBeenCalled();
  });

  it('suppresses frames while paused and forwards them after resume', async () => {
    const bridge = createBridge();
    const ingestor = new StreamAudioIngestor({ bridge });
    const onFrame = vi.fn();
    ingestor.onFrame(onFrame);

    await ingestor.start({
      sessionId: 'sess-1',
      selection: { kind: 'microphone', deviceId: 'microphone:default' },
    });

    await ingestor.pause();
    (bridge as NativeAudioCaptureBridge & { emitFrame: (frame: AudioFrame) => void }).emitFrame(
      createFrame(0),
    );
    expect(onFrame).not.toHaveBeenCalled();

    await ingestor.resume();
    (bridge as NativeAudioCaptureBridge & { emitFrame: (frame: AudioFrame) => void }).emitFrame(
      createFrame(1),
    );
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onFrame).toHaveBeenCalledWith(createFrame(1));
  });
});
