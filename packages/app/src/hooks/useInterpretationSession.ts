import {
  SessionManager,
  createPipeline,
  createSessionId,
  createSessionIngestor,
  type AudioSourceKind,
  type SessionSettings,
  type SupportedSourceLanguage,
} from '@lingua-live/core';
import { DEFAULT_SOURCE_LANGUAGE } from '@lingua-live/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_UI_SETTINGS } from '../components/SettingsPanel.js';
import {
  createTauriCaptureBridge,
  createTauriFileAccess,
} from '../desktop/tauriCaptureBridge.js';
import {
  addUnrecognizedLine,
  toSortedSubtitleLines,
  upsertZhSegment,
  type DisplaySubtitleLine,
} from '../lib/subtitleState.js';
import type { SessionControl, SessionState } from '../types/session.js';
import { createDevTranslator } from './createDevTranslator.js';
import { createVendorPipelineParts } from './createVendorPipeline.js';

const CONSENT_STORAGE_KEY = 'lingua-live-consent-v1';

function hasConsent(): boolean {
  return globalThis.localStorage?.getItem(CONSENT_STORAGE_KEY) === 'accepted';
}

export function useInterpretationSession() {
  const sessionManager = useMemo(() => new SessionManager(), []);
  const vendorParts = useMemo(() => createVendorPipelineParts(), []);
  const [pipeline, setPipeline] = useState(() =>
    createPipeline({
      ingestor: createSessionIngestor(),
      translator: createDevTranslator(),
      recognizer: vendorParts.recognizer,
      synthesizer: vendorParts.synthesizer,
      sourceMonitor: vendorParts.sourceMonitor,
    }),
  );
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [captureBridge, fileAccess] = await Promise.all([
        createTauriCaptureBridge(),
        createTauriFileAccess(),
      ]);

      if (cancelled) {
        return;
      }

      setIsDesktop(Boolean(captureBridge));
      setPipeline(
        createPipeline({
          ingestor: createSessionIngestor({
            captureBridge: captureBridge ?? undefined,
            readFile: fileAccess?.readFile,
            isFileAccessible: fileAccess?.isFileAccessible,
          }),
          translator: createDevTranslator(),
          recognizer: vendorParts.recognizer,
          synthesizer: vendorParts.synthesizer,
          sourceMonitor: vendorParts.sourceMonitor,
        }),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [vendorParts]);
  const linesMapRef = useRef(new Map<string, DisplaySubtitleLine>());
  const sessionIdRef = useRef(createSessionId());
  const sessionStartedAtRef = useRef<number | null>(null);

  const [lines, setLines] = useState<DisplaySubtitleLine[]>([]);
  const [sessionState, setSessionState] = useState<SessionState>('stopped');
  const [latencyWarning, setLatencyWarning] = useState(false);
  const [settings, setSettings] = useState<SessionSettings>(DEFAULT_UI_SETTINGS);
  const [sourceKind, setSourceKind] = useState<AudioSourceKind>('file');
  const [filePath, setFilePath] = useState('');
  const [sourceLanguage, setSourceLanguage] = useState<SupportedSourceLanguage>(
    DEFAULT_SOURCE_LANGUAGE,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [exportError, setExportError] = useState<string>();
  const [consentOpen, setConsentOpen] = useState(() => !hasConsent());
  const [unavailableControl, setUnavailableControl] = useState<SessionControl | null>(null);
  const [, setHighlightTick] = useState(0);

  const refreshLines = useCallback(() => {
    setLines(toSortedSubtitleLines(linesMapRef.current));
  }, []);

  useEffect(() => {
    const unsubscribeSubtitle = pipeline.onSubtitle((update) => {
      upsertZhSegment(linesMapRef.current, update.segment);
      refreshLines();
    });
    const unsubscribeUnrecognized = pipeline.onUnrecognized((event) => {
      addUnrecognizedLine(linesMapRef.current, event);
      refreshLines();
    });
    const unsubscribeLatency = pipeline.onLatencyWarning(setLatencyWarning);
    const unsubscribeState = sessionManager.onStateChange(({ newState }) => {
      setSessionState(newState);
    });
    const unsubscribeUnavailable = sessionManager.onUnavailableControl(({ control }) => {
      setUnavailableControl(control);
    });

    return () => {
      unsubscribeSubtitle();
      unsubscribeUnrecognized();
      unsubscribeLatency();
      unsubscribeState();
      unsubscribeUnavailable();
    };
  }, [pipeline, refreshLines, sessionManager]);

  useEffect(() => {
    const interval = globalThis.setInterval(() => {
      setHighlightTick((value) => value + 1);
      refreshLines();
    }, 250);
    return () => globalThis.clearInterval(interval);
  }, [refreshLines]);

  useEffect(() => {
    vendorParts.recognizer.setLanguage(sourceLanguage);
  }, [sourceLanguage, vendorParts.recognizer]);

  useEffect(() => {
    vendorParts.synthesizer.setEnabled(settings.audioOutputEnabled);
    vendorParts.synthesizer.setVolume(settings.volumeLevel);
  }, [settings.audioOutputEnabled, settings.volumeLevel, vendorParts.synthesizer]);

  const acceptConsent = useCallback(() => {
    globalThis.localStorage?.setItem(CONSENT_STORAGE_KEY, 'accepted');
    setConsentOpen(false);
  }, []);

  const start = useCallback(async () => {
    if (consentOpen) {
      return;
    }

    setUnavailableControl(null);
    setExportError(undefined);
    linesMapRef.current.clear();
    refreshLines();
    sessionIdRef.current = createSessionId();
    sessionStartedAtRef.current = Date.now();

    const selection =
      sourceKind === 'file'
        ? { kind: 'file' as const, filePath }
        : sourceKind === 'system'
          ? { kind: 'system' as const, deviceId: 'system:default' }
          : { kind: 'microphone' as const, deviceId: 'microphone:default' };

    const hasAudioSource = sourceKind === 'file' ? filePath.trim().length > 0 : true;
    const transition = sessionManager.start({ hasAudioSource });
    if (!transition.ok) {
      return;
    }

    try {
      await pipeline.start({
        sessionId: sessionIdRef.current,
        selection,
        showSourceText: settings.showSourceText,
      });
    } catch {
      sessionManager.stop();
    }
  }, [consentOpen, filePath, pipeline, refreshLines, sessionManager, settings.showSourceText, sourceKind]);

  const pause = useCallback(() => {
    setUnavailableControl(null);
    sessionManager.pause();
  }, [sessionManager]);

  const resume = useCallback(() => {
    setUnavailableControl(null);
    sessionManager.resume();
  }, [sessionManager]);

  const stop = useCallback(async () => {
    setUnavailableControl(null);
    sessionManager.stop();
    await pipeline.stop();
    setStopDialogOpen(true);
  }, [pipeline, sessionManager]);

  const closeStopDialog = useCallback(() => {
    setStopDialogOpen(false);
    setExportError(undefined);
  }, []);

  const exportTranscript = useCallback(() => {
    const store = pipeline.getTranscriptStore();
    if (!store.canExport()) {
      setExportError('无可导出的字幕');
      return;
    }

    try {
      const text = store.exportToText();
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'lingua-live-transcript.txt';
      anchor.click();
      URL.revokeObjectURL(url);
      setExportError(undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : '导出失败';
      setExportError(`导出失败：${message}`);
    }
  }, [pipeline]);

  const durationMs =
    sessionStartedAtRef.current === null ? 0 : Date.now() - sessionStartedAtRef.current;

  return {
    lines,
    sessionState,
    latencyWarning,
    settings,
    setSettings,
    sourceKind,
    setSourceKind,
    filePath,
    setFilePath,
    sourceLanguage,
    setSourceLanguage,
    settingsOpen,
    setSettingsOpen,
    stopDialogOpen,
    exportError,
    consentOpen,
    unavailableControl,
    acceptConsent,
    start,
    pause,
    resume,
    stop,
    closeStopDialog,
    exportTranscript,
    transcriptCount: pipeline.getTranscriptStore().getEntries().length,
    durationMs,
    canExport: pipeline.getTranscriptStore().canExport(),
    isDesktop,
  };
}
