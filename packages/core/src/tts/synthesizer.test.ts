import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZhSegment } from '../models.js';
import { STOP_PLAYBACK_MAX_MS } from './constants.js';
import { MockAudioSynthesizer, createAudioSynthesizer } from './synthesizer.js';

function createFinal(overrides: Partial<ZhSegment> = {}): ZhSegment {
  return {
    id: 'seg-1',
    sessionId: 'sess-1',
    sourceText: 'hello',
    zhText: '你好',
    status: 'final',
    spokenIndex: 0,
    untranslated: false,
    ...overrides,
  };
}

describe('MockAudioSynthesizer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is disabled by default and ignores non-final segments', async () => {
    const driver = { synthesize: vi.fn().mockResolvedValue(undefined) };
    const synth = new MockAudioSynthesizer({ driver });

    synth.enqueue({
      ...createFinal(),
      status: 'partial',
    });

    expect(synth.isEnabled()).toBe(false);
    await vi.runAllTimersAsync();
    expect(driver.synthesize).not.toHaveBeenCalled();
  });

  it('plays finals in spokenIndex order when enabled', async () => {
    const driver = { synthesize: vi.fn().mockResolvedValue(undefined) };
    const synth = new MockAudioSynthesizer({ driver, synthesisDurationMs: 100 });
    synth.setEnabled(true);

    synth.enqueue(createFinal({ id: 'seg-b', spokenIndex: 1, zhText: '第二句' }));
    synth.enqueue(createFinal({ id: 'seg-a', spokenIndex: 0, zhText: '第一句' }));

    await vi.advanceTimersByTimeAsync(100);
    expect(driver.synthesize).toHaveBeenCalledWith('第一句', 0);

    await vi.advanceTimersByTimeAsync(100);
    expect(driver.synthesize).toHaveBeenCalledWith('第二句', 1);
  });

  it('does not synthesize while volume is muted', async () => {
    const driver = { synthesize: vi.fn().mockResolvedValue(undefined) };
    const synth = new MockAudioSynthesizer({ driver });
    synth.setEnabled(true);
    synth.setVolume(0);

    synth.enqueue(createFinal());
    await vi.runAllTimersAsync();

    expect(driver.synthesize).not.toHaveBeenCalled();
  });

  it('stops in-progress playback within one second when disabled', async () => {
    const driver = {
      synthesize: vi.fn((): Promise<void> => new Promise(() => {})),
    };
    const synth = new MockAudioSynthesizer({ driver, synthesisDurationMs: 50 });
    synth.setEnabled(true);
    synth.enqueue(createFinal());

    await vi.advanceTimersByTimeAsync(50);
    synth.setEnabled(false);

    expect(driver.synthesize).toHaveBeenCalledTimes(1);
    synth.enqueue(createFinal({ id: 'seg-2', spokenIndex: 1, zhText: '下一句' }));
    await vi.advanceTimersByTimeAsync(STOP_PLAYBACK_MAX_MS);
    expect(driver.synthesize).toHaveBeenCalledTimes(1);
  });

  it('skips failed segments and emits a failure indicator', async () => {
    const driver = {
      synthesize: vi
        .fn()
        .mockRejectedValueOnce(new Error('tts down'))
        .mockResolvedValueOnce(undefined),
    };
    const synth = new MockAudioSynthesizer({ driver, synthesisDurationMs: 10 });
    const onFailure = vi.fn();
    synth.onSynthFailure(onFailure);
    synth.setEnabled(true);

    synth.enqueue(createFinal({ id: 'seg-fail', spokenIndex: 0 }));
    synth.enqueue(createFinal({ id: 'seg-ok', spokenIndex: 1, zhText: '继续' }));

    await vi.advanceTimersByTimeAsync(10);
    expect(onFailure).toHaveBeenCalledWith('seg-fail');

    await vi.advanceTimersByTimeAsync(10);
    expect(driver.synthesize).toHaveBeenLastCalledWith('继续', 1);
  });

  it('creates a synthesizer via factory', () => {
    expect(createAudioSynthesizer()).toBeInstanceOf(MockAudioSynthesizer);
  });
});
