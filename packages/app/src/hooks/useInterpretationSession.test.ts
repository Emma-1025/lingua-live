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
const pipelineStart = vi.fn(async () => {});

const transcriptStore = {
  getEntries: vi.fn(() => [{ spokenIndex: 0, zhText: '你好', status: 'final' as const }]),
  canExport: vi.fn(() => true),
  exportToText: vi.fn(() => '你好'),
};

vi.mock('@lingua-live/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@lingua-live/core')>();
  return {
    ...actual,
    createPipeline: vi.fn(() => ({
      start: pipelineStart,
      pause: pipelinePause,
      resume: pipelineResume,
      stop: vi.fn(async () => {}),
      isPaused: vi.fn(() => false),
      onSubtitle: vi.fn(() => () => {}),
      onUnrecognized: vi.fn(() => () => {}),
      onLatencyWarning: vi.fn(() => () => {}),
      getTranscriptStore: vi.fn(() => transcriptStore),
    })),
    createSessionIngestor: vi.fn(() => ({})),
    SessionManager: actual.SessionManager,
  };
});

import { useInterpretationSession } from './useInterpretationSession.js';

describe('useInterpretationSession audio wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pipelineStart.mockReset();
    pipelineStart.mockResolvedValue(undefined);
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

  it('starts with the selected browser media file instead of a typed path', async () => {
    const { result } = renderHook(() => useInterpretationSession());
    const mediaFile = new File(['media-bytes'], 'clip.mp4', { type: 'video/mp4' });

    act(() => {
      result.current.setMediaFile(mediaFile);
    });

    expect(result.current.sourceKind).toBe('file');
    expect(result.current.selectedMediaFile).toEqual(
      expect.objectContaining({ name: 'clip.mp4', size: mediaFile.size, type: 'video/mp4' }),
    );
    expect(result.current.filePath).toMatch(/^selected-media:\/\//);

    await act(async () => {
      await result.current.start();
    });

    expect(pipelineStart).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: {
          kind: 'file',
          filePath: expect.stringMatching(/^selected-media:\/\/.*clip\.mp4$/),
        },
      }),
    );
  });

  it('blocks system audio before native capture when no monitor source is available', async () => {
    const { result } = renderHook(() => useInterpretationSession());

    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.setSourceKind('system');
    });

    await act(async () => {
      await result.current.start();
    });

    expect(pipelineStart).not.toHaveBeenCalled();
    expect(result.current.startError).toBe(
      '系统声音捕获需要桌面版。请启动桌面应用，或改用媒体文件。',
    );
  });

  it('preserves transcript count for the stop dialog after stopping', async () => {
    const { result } = renderHook(() => useInterpretationSession());

    act(() => {
      result.current.setFilePath('/demo.wav');
      result.current.setSourceKind('file');
    });

    await act(async () => {
      await result.current.start();
    });

    await act(async () => {
      await result.current.stop();
    });

    expect(result.current.transcriptCount).toBe(1);
    expect(result.current.canExport).toBe(true);
    expect(result.current.stopDialogOpen).toBe(true);
  });

  it('surfaces start failures and rolls the session back to stopped', async () => {
    pipelineStart.mockRejectedValueOnce(
      new Error('No system loopback or monitor device available'),
    );
    const { result } = renderHook(() => useInterpretationSession());

    act(() => {
      result.current.setFilePath('/movie.mp4');
      result.current.setSourceKind('file');
    });

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.sessionState).toBe('stopped');
    expect(result.current.startError).toBe('No system loopback or monitor device available');
  });

  it('syncs recognizer language when source language changes', () => {
    const { result } = renderHook(() => useInterpretationSession());

    act(() => {
      result.current.setSourceLanguage('ja');
    });

    expect(recognizer.setLanguage).toHaveBeenCalledWith('ja');
  });
});
