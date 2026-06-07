import {
  SessionManager,
  createSessionId,
  type AudioSourceKind,
  type LlmSettings,
  type SessionSettings,
  type SupportedSourceLanguage,
  type VendorConfig,
} from '@lingua-live/core';
import { DEFAULT_SOURCE_LANGUAGE } from '@lingua-live/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_UI_SETTINGS } from '../components/SettingsPanel.js';
import { initTauriHttpFetch } from '../desktop/tauriHttpFetch.js';
import { createTauriCaptureBridge, createTauriFileAccess } from '../desktop/tauriCaptureBridge.js';
import { exportTranscriptText } from '../lib/exportTranscript.js';
import { loadLlmSettings, saveLlmSettings } from '../lib/llmSettingsStorage.js';
import {
  addUnrecognizedLine,
  toSortedSubtitleLines,
  upsertZhSegment,
  type DisplaySubtitleLine,
} from '../lib/subtitleState.js';
import { loadVendorSettings, saveVendorSettings } from '../lib/vendorSettingsStorage.js';
import type { SessionControl, SessionState } from '../types/session.js';
import { createAppPipeline } from './createAppPipeline.js';
import { createVendorPipelineParts } from './createVendorPipeline.js';

const CONSENT_STORAGE_KEY = 'lingua-live-consent-v1';

function hasConsent(): boolean {
  return globalThis.localStorage?.getItem(CONSENT_STORAGE_KEY) === 'accepted';
}

function formatStartError(error: unknown, sourceKind: AudioSourceKind, isDesktop: boolean): string {
  const message = error instanceof Error ? error.message : String(error);

  if (sourceKind === 'system' && !isDesktop) {
    return '系统声音捕获需要桌面版。请启动桌面应用，或改用媒体文件。';
  }

  if (sourceKind === 'system' && /loopback|monitor/i.test(message)) {
    return '未找到系统声音监视设备。请确认系统提供 monitor/loopback 输入，或改用媒体文件。';
  }

  if (sourceKind === 'file') {
    return message || '无法读取或解码媒体文件。请确认文件路径和音频格式。';
  }

  return message || '无法启动音频捕获。请检查音频来源后重试。';
}

interface IngestorBridgeDeps {
  captureBridge?: Awaited<ReturnType<typeof createTauriCaptureBridge>>;
  readFile?: (filePath: string) => Promise<ArrayBuffer>;
  isFileAccessible?: (filePath: string) => Promise<boolean>;
}

export function useInterpretationSession() {
  const sessionManager = useMemo(() => new SessionManager(), []);
  const [vendorSettings, setVendorSettingsState] = useState<VendorConfig>(loadVendorSettings);
  const vendorParts = useMemo(
    () => createVendorPipelineParts({ config: vendorSettings }),
    [vendorSettings],
  );
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

  const setVendorSettings = useCallback((next: VendorConfig) => {
    setVendorSettingsState(next);
    saveVendorSettings(next);
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
  const [sourceLanguage, setSourceLanguage] =
    useState<SupportedSourceLanguage>(DEFAULT_SOURCE_LANGUAGE);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stopDialogOpen, setStopDialogOpen] = useState(false);
  const [exportError, setExportError] = useState<string>();
  const [exportNotice, setExportNotice] = useState<string>();
  const [consentOpen, setConsentOpen] = useState(() => !hasConsent());
  const [unavailableControl, setUnavailableControl] = useState<SessionControl | null>(null);
  const [startError, setStartError] = useState<string>();
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
    setStartError(undefined);
    setExportError(undefined);
    setExportNotice(undefined);

    if (!ingestorReady && sourceKind !== 'file') {
      setStartError('音频设备仍在初始化，请稍后再试。');
      return;
    }

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
      if (transition.reason === 'no_audio_source') {
        setStartError('请先选择媒体文件，或切换到系统声音/麦克风。');
      }
      return;
    }

    try {
      await pipeline.start({
        sessionId: sessionIdRef.current,
        selection,
        showSourceText: settings.showSourceText,
      });
    } catch (error) {
      await pipeline.stop();
      sessionManager.stop();
      setStartError(formatStartError(error, sourceKind, isDesktop));
    }
  }, [
    consentOpen,
    filePath,
    ingestorReady,
    isDesktop,
    pipeline,
    refreshLines,
    sessionManager,
    settings.showSourceText,
    sourceKind,
  ]);

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
    setExportNotice(undefined);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  const exportTranscript = useCallback(async () => {
    const store = stoppedTranscriptStoreRef.current ?? pipeline.getTranscriptStore();
    if (!store.canExport()) {
      setExportError('无可导出的字幕');
      setExportNotice(undefined);
      return;
    }

    const result = await exportTranscriptText(store.exportToText());
    if (!result.ok) {
      if (result.cancelled) {
        setExportError(undefined);
        return;
      }
      setExportError(result.error);
      setExportNotice(undefined);
      return;
    }

    setExportError(undefined);
    setExportNotice(result.path ? `已保存到 ${result.path}` : '导出成功');
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
    vendorSettings,
    setVendorSettings,
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
    exportNotice,
    startError,
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
