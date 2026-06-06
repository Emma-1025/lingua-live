import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { DEFAULT_UI_SETTINGS } from '../components/SettingsPanel.js';

const synthesizer = {
  setEnabled: vi.fn(),
  setVolume: vi.fn(),
  isEnabled: vi.fn(() => false),
  getVolume: vi.fn(() => 5),
  enqueue: vi.fn(),
  onSynthFailure: vi.fn(() => () => {}),
  onPlaybackStateChange: vi.fn(() => () => {}),
};

const recognizer = {
  setLanguage: vi.fn(),
  getLanguage: vi.fn(() => 'en' as const),
  pushAudio: vi.fn(),
  flush: vi.fn(),
  reset: vi.fn(),
  onSegment: vi.fn(() => () => {}),
  onUnrecognized: vi.fn(() => () => {}),
};

vi.mock('../desktop/tauriCaptureBridge.js', () => ({
  createTauriCaptureBridge: vi.fn(async () => null),
  createTauriFileAccess: vi.fn(async () => null),
}));

vi.mock('./createVendorPipeline.js', () => ({
  createVendorPipelineParts: () => ({
    config: { mode: 'mock' },
    recognizer,
    synthesizer,
    sourceMonitor: { pushFrame: vi.fn(), setSourceSuppressed: vi.fn(), stop: vi.fn() },
  }),
}));

const pipelinePause = vi.fn(async () => {});
const pipelineResume = vi.fn(async () => {});

vi.mock('@lingua-live/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lingua-live/core')>();
  return {
    ...actual,
    createPipeline: vi.fn(() => ({
      start: vi.fn(async () => {}),
      pause: pipelinePause,
      resume: pipelineResume,
      stop: vi.fn(async () => {}),
      isPaused: vi.fn(() => false),
      onSubtitle: vi.fn(() => () => {}),
      onUnrecognized: vi.fn(() => () => {}),
      onLatencyWarning: vi.fn(() => () => {}),
      getTranscriptStore: vi.fn(() => ({
        getEntries: () => [],
        canExport: () => false,
      })),
    })),
    createSessionIngestor: vi.fn(() => ({})),
    SessionManager: actual.SessionManager,
  };
});

import { useInterpretationSession } from './useInterpretationSession.js';

describe('useInterpretationSession audio wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pipelinePause.mockClear();
    pipelineResume.mockClear();
    globalThis.localStorage?.setItem('lingua-live-consent-v1', 'accepted');
  });

  it('syncs synthesizer enablement and volume from settings', () => {
    const { result } = renderHook(() => useInterpretationSession());

    act(() => {
      result.current.setSettings({
        ...DEFAULT_UI_SETTINGS,
        audioOutputEnabled: true,
        volumeLevel: 8,
      });
    });

    expect(synthesizer.setEnabled).toHaveBeenCalledWith(true);
    expect(synthesizer.setVolume).toHaveBeenCalledWith(8);
  });

  it('pauses and resumes the pipeline with session controls', async () => {
    const { result } = renderHook(() => useInterpretationSession());

    act(() => {
      result.current.setFilePath('/demo.wav');
      result.current.setSourceKind('file');
    });

    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      await result.current.pause();
    });
    expect(pipelinePause).toHaveBeenCalled();

    await act(async () => {
      await result.current.resume();
    });
    expect(pipelineResume).toHaveBeenCalled();
  });

  it('syncs recognizer language when source language changes', () => {
    const { result } = renderHook(() => useInterpretationSession());

    act(() => {
      result.current.setSourceLanguage('ja');
    });

    expect(recognizer.setLanguage).toHaveBeenCalledWith('ja');
  });
});
