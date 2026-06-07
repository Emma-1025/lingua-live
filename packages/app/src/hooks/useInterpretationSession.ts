import {
  SessionManager,
  createSessionId,
  type AudioSourceKind,
  type LlmSettings,
  type SessionSettings,
  type SupportedSourceLanguage,
} from '@lingua-live/core';
import { DEFAULT_SOURCE_LANGUAGE } from '@lingua-live/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_UI_SETTINGS } from '../components/SettingsPanel.js';
import { initTauriHttpFetch } from '../desktop/tauriHttpFetch.js';
import {
  createTauriCaptureBridge,
  createTauriFileAccess,
} from '../desktop/tauriCaptureBridge.js';
import { loadLlmSettings, saveLlmSettings } from '../lib/llmSettingsStorage.js';
import {
  addUnrecognizedLine,
  toSortedSubtitleLines,
  upsertZhSegment,
  type DisplaySubtitleLine,
} from '../lib/subtitleState.js';
import type { SessionControl, SessionState } from '../types/session.js';
import { createAppPipeline } from './createAppPipeline.js';
import { createVendorPipelineParts } from './createVendorPipeline.js';

const CONSENT_STORAGE_KEY = 'lingua-live-consent-v1';

function hasConsent(): boolean {
  return globalThis.localStorage?.getItem(CONSENT_STORAGE_KEY) === 'accepted';
}

interface IngestorBridgeDeps {
  captureBridge?: Awaited<ReturnType<typeof createTauriCaptureBridge>>;
  readFile?: (filePath: string) => Promise<ArrayBuffer>;
  isFileAccessible?: (filePath: string) => Promise<boolean>;
}

export function useInterpretationSession() {
  const sessionManager = useMemo(() => new SessionManager(), []);
  const vendorParts = useMemo(() => createVendorPipelineParts(), []);
  const ingestorDepsRef = useRef<IngestorBridgeDeps>({});
  const [ingestorReady, setIngestorReady] = useState(false);
  const [llmSettings, setLlmSettingsState] = useState<LlmSettings>(loadLlmSettings);
  const [pipeline, setPipeline] = useState(() =>
    createAppPipeline({
      llmSettings: loadLlmSettings(),
      vendorParts,
    }),
  );
  const [isDesktop, setIsDesktop] = useState(false);

  const setLlmSettings = useCallback((next: LlmSettings) => {
    setLlmSettingsState(next);
    saveLlmSettings(next);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [captureBridge, fileAccess] = await Promise.all([
        createTauriCaptureBridge(),
        createTauriFileAccess(),
        initTauriHttpFetch(),
      ]);

      if (cancelled) {
        return;
      }

      ingestorDepsRef.current = {
        captureBridge: captureBridge ?? undefined,
        readFile: fileAccess?.readFile,
        isFileAccessible: fileAccess?.isFileAccessible,
      };
      setIsDesktop(Boolean(captureBridge));
      setIngestorReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

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
  const [stoppedTranscriptCount, setStoppedTranscriptCount] = useState(0);
  const [stoppedCanExport, setStoppedCanExport] = useState(false);
  const stoppedTranscriptStoreRef = useRef(
    null as ReturnType<typeof pipeline.getTranscriptStore> | null,
  );

  const refreshLines = useCallback(() => {
    setLines(toSortedSubtitleLines(linesMapRef.current));
  }, []);

  useEffect(() => {
    if (!ingestorReady || sessionState !== 'stopped') {
      return;
    }

    setPipeline(
      createAppPipeline({
        llmSettings,
        vendorParts,
        captureBridge: ingestorDepsRef.current.captureBridge,
        readFile: ingestorDepsRef.current.readFile,
        isFileAccessible: ingestorDepsRef.current.isFileAccessible,
      }),
    );
    // sessionState is intentionally omitted: rebuilding when a session ends would
    // reset the transcript before the stop/export dialog can read it.
  }, [ingestorReady, llmSettings, vendorParts]);

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
    if (settingsOpen) {
      return;
    }

    const interval = globalThis.setInterval(() => {
      setHighlightTick((value) => value + 1);
      refreshLines();
    }, 250);
    return () => globalThis.clearInterval(interval);
  }, [refreshLines, settingsOpen]);

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

  const pause = useCallback(async () => {
    setUnavailableControl(null);
    const transition = sessionManager.pause();
    if (!transition.ok) {
      return;
    }

    await pipeline.pause();
  }, [pipeline, sessionManager]);

  const resume = useCallback(async () => {
    setUnavailableControl(null);
    const transition = sessionManager.resume();
    if (!transition.ok) {
      return;
    }

    await pipeline.resume();
  }, [pipeline, sessionManager]);

  const stop = useCallback(async () => {
    setUnavailableControl(null);
    await pipeline.stop();
    const store = pipeline.getTranscriptStore();
    stoppedTranscriptStoreRef.current = store;
    setStoppedTranscriptCount(store.getEntries().length);
    setStoppedCanExport(store.canExport());
    sessionManager.stop();
    setStopDialogOpen(true);
  }, [pipeline, sessionManager]);

  const closeStopDialog = useCallback(() => {
    setStopDialogOpen(false);
    setExportError(undefined);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  const exportTranscript = useCallback(() => {
    const store = stoppedTranscriptStoreRef.current ?? pipeline.getTranscriptStore();
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
    llmSettings,
    setLlmSettings,
    sourceKind,
    setSourceKind,
    filePath,
    setFilePath,
    sourceLanguage,
    setSourceLanguage,
    settingsOpen,
    setSettingsOpen,
    closeSettings,
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
    transcriptCount: stopDialogOpen
      ? stoppedTranscriptCount
      : pipeline.getTranscriptStore().getEntries().length,
    durationMs,
    canExport: stopDialogOpen ? stoppedCanExport : pipeline.getTranscriptStore().canExport(),
    isDesktop,
  };
}
