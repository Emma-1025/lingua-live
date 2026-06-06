import { describe, expect, it } from 'vitest';
import {
  CompositeSourceDuckController,
  shouldDuckSource,
  WebAudioSourceMonitor,
} from './sourceDuck.js';
import { DUCKED_SOURCE_GAIN, NORMAL_SOURCE_GAIN } from '../vendors/constants.js';

describe('source ducking', () => {
  it('only ducks system and file sources', () => {
    expect(shouldDuckSource('system')).toBe(true);
    expect(shouldDuckSource('file')).toBe(true);
    expect(shouldDuckSource('microphone')).toBe(false);
  });

  it('reduces monitor gain while suppressed', () => {
    const monitor = new WebAudioSourceMonitor({
      audioContext: {
        sampleRate: 16_000,
        currentTime: 0,
        createGain: () => ({ gain: { value: NORMAL_SOURCE_GAIN }, connect: () => {} }),
        createBuffer: () => ({ copyToChannel: () => {} }),
        createBufferSource: () => ({
          buffer: null,
          connect: () => {},
          start: () => {},
        }),
        destination: {},
      } as unknown as AudioContext,
    });

    monitor.setSourceSuppressed(true);
    expect((monitor as unknown as { gainNode: GainNode }).gainNode.gain.value).toBe(
      DUCKED_SOURCE_GAIN,
    );
  });

  it('fans out suppression to composite targets', () => {
    const states: boolean[] = [];
    const controller = new CompositeSourceDuckController([
      { setSourceSuppressed: (value) => states.push(value) },
      { setSourceSuppressed: (value) => states.push(value) },
    ]);

    controller.setSourceSuppressed(true);
    expect(states).toEqual([true, true]);
  });
});
