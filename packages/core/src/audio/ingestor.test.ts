import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TARGET_SAMPLE_RATE } from './constants.js';
import {
  FileAudioIngestor,
  NoAudioSourceSelectedError,
  SourceInaccessibleError,
} from './ingestor.js';
import { createTestWav } from './testHelpers.js';

describe('FileAudioIngestor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createIngestor(overrides: {
    readFile?: (path: string) => Promise<ArrayBuffer>;
    isFileAccessible?: (path: string) => Promise<boolean>;
    now?: () => number;
  } = {}) {
    let clock = 1_000;
    const now = overrides.now ?? (() => clock);
    const advanceNow = (ms: number) => {
      clock += ms;
    };

    const wav500 = createTestWav(500);
    const ingestor = new FileAudioIngestor({
      now,
      readFile: overrides.readFile ?? (async () => wav500),
      isFileAccessible: overrides.isFileAccessible ?? (async () => true),
    });

    return { ingestor, advanceNow, now };
  }

  it('lists system and microphone device sources', async () => {
    const { ingestor } = createIngestor();
    const sources = await ingestor.listSources();
    expect(sources).toHaveLength(2);
    expect(sources.map((s) => s.kind)).toEqual(['system', 'microphone']);
  });

  it('rejects start without source selection', async () => {
    const { ingestor } = createIngestor();
    const rejected = vi.fn();
    ingestor.onStartRejected(rejected);

    await expect(
      ingestor.start({ sessionId: 'sess-1', selection: { kind: 'file' } }),
    ).rejects.toBeInstanceOf(NoAudioSourceSelectedError);

    expect(rejected).toHaveBeenCalledWith('no_source_selected');
    expect(ingestor.isRunning()).toBe(false);
  });

  it('rejects inaccessible file at start', async () => {
    const { ingestor } = createIngestor({
      isFileAccessible: async () => false,
    });
    const rejected = vi.fn();
    ingestor.onStartRejected(rejected);

    await expect(
      ingestor.start({
        sessionId: 'sess-1',
        selection: { kind: 'file', filePath: '/missing.wav' },
      }),
    ).rejects.toBeInstanceOf(SourceInaccessibleError);

    expect(rejected).toHaveBeenCalledWith('source_inaccessible');
  });

  it('rejects system/microphone sources until device capture is implemented', async () => {
    const { ingestor } = createIngestor();

    await expect(
      ingestor.start({
        sessionId: 'sess-1',
        selection: { kind: 'system', deviceId: 'system:default' },
      }),
    ).rejects.toBeInstanceOf(SourceInaccessibleError);
  });

  it('emits monotonic frames with duration at most 1000ms', async () => {
    const wav = createTestWav(2_500);
    const { ingestor } = createIngestor({
      readFile: async () => wav,
    });

    const frames: number[] = [];
    ingestor.onFrame((frame) => {
      frames.push(frame.seq);
      expect(frame.durationMs).toBeLessThanOrEqual(1_000);
      expect(frame.sessionId).toBe('sess-1');
      expect(frame.pcm.length).toBeLessThanOrEqual(TARGET_SAMPLE_RATE);
    });

    await ingestor.start({
      sessionId: 'sess-1',
      selection: { kind: 'file', filePath: '/audio.wav' },
    });

    await vi.runAllTimersAsync();

    expect(frames).toEqual([0, 1, 2]);
    expect(ingestor.isRunning()).toBe(false);
  });

  it('paces frames to real time', async () => {
    const wav = createTestWav(2_000);
    const { ingestor, advanceNow } = createIngestor({
      readFile: async () => wav,
    });

    const capturedAt: number[] = [];
    ingestor.onFrame((frame) => {
      capturedAt.push(frame.capturedAt);
    });

    await ingestor.start({
      sessionId: 'sess-1',
      selection: { kind: 'file', filePath: '/audio.wav' },
    });

    await vi.runOnlyPendingTimersAsync();
    expect(capturedAt).toHaveLength(1);

    advanceNow(1_000);
    await vi.runOnlyPendingTimersAsync();
    expect(capturedAt).toHaveLength(2);
    expect(capturedAt[1] - capturedAt[0]).toBeGreaterThanOrEqual(1_000);
  });

  it('emits onFileEnd when file playback completes', async () => {
    const { ingestor } = createIngestor();
    const onEnd = vi.fn();
    ingestor.onFileEnd(onEnd);

    await ingestor.start({
      sessionId: 'sess-1',
      selection: { kind: 'file', filePath: '/audio.wav' },
    });

    await vi.runAllTimersAsync();
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('stops capturing within one timer generation', async () => {
    const wav = createTestWav(3_000);
    const { ingestor } = createIngestor({
      readFile: async () => wav,
    });

    const frames: number[] = [];
    ingestor.onFrame((frame) => frames.push(frame.seq));

    await ingestor.start({
      sessionId: 'sess-1',
      selection: { kind: 'file', filePath: '/audio.wav' },
    });

    await vi.runOnlyPendingTimersAsync();
    await ingestor.stop();

    await vi.runAllTimersAsync();
    expect(frames.length).toBeLessThan(4);
    expect(ingestor.isRunning()).toBe(false);
  });

  it('emits onSourceLost when signalSourceLost is called', async () => {
    const { ingestor } = createIngestor();
    const lost = vi.fn();
    ingestor.onSourceLost(lost);

    await ingestor.start({
      sessionId: 'sess-1',
      selection: { kind: 'file', filePath: '/audio.wav' },
    });

    ingestor.signalSourceLost('file_unreadable');
    expect(lost).toHaveBeenCalledWith('file_unreadable');
    expect(ingestor.isRunning()).toBe(false);
  });

  it('rejects unreadable wav content at start', async () => {
    const { ingestor } = createIngestor({
      readFile: async () => new ArrayBuffer(8),
    });

    await expect(
      ingestor.start({
        sessionId: 'sess-1',
        selection: { kind: 'file', filePath: '/bad.wav' },
      }),
    ).rejects.toBeInstanceOf(SourceInaccessibleError);
  });
});
