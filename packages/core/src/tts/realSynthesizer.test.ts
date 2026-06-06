import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZhSegment } from '../models.js';
import type { AudioPlayer } from './audioPlayer.js';
import { createRealAudioSynthesizer } from './realSynthesizer.js';

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

describe('RealAudioSynthesizer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('plays finals in order and reports playback state', async () => {
    const driver = {
      synthesize: vi.fn(async (text: string) => new ArrayBuffer(text.length)),
    };
    const player: AudioPlayer = {
      play: vi.fn(async () => {}),
      stop: vi.fn(),
    };

    const playbackStates: boolean[] = [];
    const synth = createRealAudioSynthesizer({ driver, player });
    synth.onPlaybackStateChange((playing) => playbackStates.push(playing));
    synth.setEnabled(true);
    synth.enqueue(createFinal({ id: 'seg-a', spokenIndex: 1, zhText: '第二句' }));
    synth.enqueue(createFinal({ id: 'seg-b', spokenIndex: 0, zhText: '第一句' }));

    await vi.runAllTimersAsync();

    expect(driver.synthesize).toHaveBeenNthCalledWith(1, '第一句');
    expect(driver.synthesize).toHaveBeenNthCalledWith(2, '第二句');
    expect(playbackStates).toContain(true);
    expect(playbackStates.at(-1)).toBe(false);
  });
});
