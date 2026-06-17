import {
  SessionManager,
  createSessionId,
  type AudioDeviceInfo,
  type AudioSourceKind,
  type LlmSettings,
  type SessionSettings,
  type SupportedSourceLanguage,
  type VendorConfig,
} from '@lingua-live/core';
import { DEFAULT_SOURCE_LANGUAGE } from '@lingua-live/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_UI_SETTINGS,
  type SelectedMediaFileInfo,
} from '../components/SettingsPanel.js';
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

interface NativeSourceAvailability {
  system: boolean;
  microphone: boolean;
}

const SELECTED_MEDIA_FILE_SCHEME = 'selected-media://';
const NO_NATIVE_SOURCE_AVAILABILITY: NativeSourceAvailability = {
  system: false,
  microphone: false,
};

function createSelectedMediaFilePath(file: File): string {
  const safeName = encodeURIComponent(file.name || 'media-file');
  return `${SELECTED_MEDIA_FILE_SCHEME}${file.lastModified}-${file.size}/${safeName}`;
}

function toNativeSourceAvailability(sources: AudioDeviceInfo[]): NativeSourceAvailability {
  return {
    system: sources.some((source) => source.kind === 'system'),
    microphone: sources.some((source) => source.kind === 'microphone'),
  };
}

export function useInterpretationSession() {
  const sessionManager = useMemo(() => new SessionManager(), []);
  const [vendorSettings, setVendorSettingsState] = useState<VendorConfig>(loadVendorSettings);
  const vendorParts = useMemo(
    () => createVendorPipelineParts({ config: vendorSettings }),
    [vendorSettings],
  );
  const ingestorDepsRef = useRef<IngestorBridgeDeps>({});
  const selectedMediaFileRef = useRef<File | null>(null);
  const selectedMediaFilePathRef = useRef('');
  const readMediaFile = useCallback(async (filePath: string) => {
    const selectedFile = selectedMediaFileRef.current;
    if (selectedFile && filePath === selectedMediaFilePathRef.current) {
      return selectedFile.arrayBuffer();
    }

    const readNativeFile = ingestorDepsRef.current.readFile;
    if (readNativeFile) {
      return readNativeFile(filePath);
    }

    throw new Error('请使用“选择媒体文件”按钮选择 WAV、MP4、M4A 或 MP3 文件。');
  }, []);
  const isMediaFileAccessible = useCallback(async (filePath: string) => {
    if (selectedMediaFileRef.current && filePath === selectedMediaFilePathRef.current) {
      return true;
    }

    const isNativeFileAccessible = ingestorDepsRef.current.isFileAccessible;
    if (isNativeFileAccessible) {
      return isNativeFileAccessible(filePath);
    }

    return false;
  }, []);
  const [ingestorReady, setIngestorReady] = useState(false);
  const [llmSettings, setLlmSettingsState] = useState<LlmSettings>(loadLlmSettings);
  const [pipeline, setPipeline] = useState(() =>
    createAppPipeline({
      llmSettings: loadLlmSettings(),
      vendorParts,
      readFile: readMediaFile,
      isFileAccessible: isMediaFileAccessible,
    }),
  );
  const [isDesktop, setIsDesktop] = useState(false);
  const [nativeSourceAvailability, setNativeSourceAvailability] =
    useState<NativeSourceAvailability>(NO_NATIVE_SOURCE_AVAILABILITY);
  const [nativeCaptureError, setNativeCaptureError] = useState<string>();

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
      let availableSources: AudioDeviceInfo[] = [];
      let sourceListError: string | undefined;
      if (captureBridge) {
        try {
          availableSources = await captureBridge.listSources();
        } catch (error) {
          sourceListError = error instanceof Error ? error.message : String(error);
        }
      }

      if (cancelled) {
        return;
      }

      ingestorDepsRef.current = {
        captureBridge: captureBridge ?? undefined,
        readFile: fileAccess?.readFile,
        isFileAccessible: fileAccess?.isFileAccessible,
      };
      setIsDesktop(Boolean(captureBridge));
      setNativeSourceAvailability(toNativeSourceAvailability(availableSources));
      setNativeCaptureError(sourceListError);
      setIngestorReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const linesMapRef = useRef(new Map<string, DisplaySubtitleLine>());
  const sessionIdRef = useRef(createSessionId());
  const sessionStartedAtRef = useRef<number | null>(null);
  const accumulatedDurationMsRef = useRef(0);

  const [lines, setLines] = useState<DisplaySubtitleLine[]>([]);
  const [sessionState, setSessionState] = useState<SessionState>('stopped');
  const [durationMs, setDurationMs] = useState(0);
  const [latencyWarning, setLatencyWarning] = useState(false);
  const [settings, setSettings] = useState<SessionSettings>(DEFAULT_UI_SETTINGS);
  const [sourceKind, setSourceKindState] = useState<AudioSourceKind>('file');
  const [filePath, setFilePathState] = useState('');
  const [selectedMediaFile, setSelectedMediaFileInfo] =
    useState<SelectedMediaFileInfo | null>(null);
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

  const refreshDuration = useCallback(() => {
    const startedAt = sessionStartedAtRef.current;
    setDurationMs(
      startedAt === null
        ? accumulatedDurationMsRef.current
        : accumulatedDurationMsRef.current + Date.now() - startedAt,
    );
  }, []);

  const startDuration = useCallback(() => {
    accumulatedDurationMsRef.current = 0;
    sessionStartedAtRef.current = Date.now();
    setDurationMs(0);
  }, []);

  const pauseDuration = useCallback(() => {
    const startedAt = sessionStartedAtRef.current;
    if (startedAt !== null) {
      accumulatedDurationMsRef.current += Date.now() - startedAt;
      sessionStartedAtRef.current = null;
    }
    setDurationMs(accumulatedDurationMsRef.current);
  }, []);

  const resumeDuration = useCallback(() => {
    sessionStartedAtRef.current = Date.now();
    setDurationMs(accumulatedDurationMsRef.current);
  }, []);

  const resetDuration = useCallback(() => {
    accumulatedDurationMsRef.current = 0;
    sessionStartedAtRef.current = null;
    setDurationMs(0);
  }, []);

  const clearStartWarning = useCallback(() => {
    setStartError(undefined);
    setUnavailableControl(null);
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
        readFile: readMediaFile,
        isFileAccessible: isMediaFileAccessible,
      }),
    );
    // sessionState is intentionally omitted: rebuilding when a session ends would
    // reset the transcript before the stop/export dialog can read it.
  }, [ingestorReady, isMediaFileAccessible, llmSettings, readMediaFile, vendorParts]);

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
      refreshDuration();
    }, 250);
    return () => globalThis.clearInterval(interval);
  }, [refreshDuration, refreshLines, settingsOpen]);

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

  const setSourceKind = useCallback(
    (nextSourceKind: AudioSourceKind) => {
      setSourceKindState(nextSourceKind);
      clearStartWarning();
    },
    [clearStartWarning],
  );

  const setFilePath = useCallback((nextFilePath: string) => {
    selectedMediaFileRef.current = null;
    selectedMediaFilePathRef.current = '';
    setSelectedMediaFileInfo(null);
    setFilePathState(nextFilePath);
    clearStartWarning();
  }, [clearStartWarning]);

  const setMediaFile = useCallback((file: File | null) => {
    if (!file) {
      selectedMediaFileRef.current = null;
      selectedMediaFilePathRef.current = '';
      setSelectedMediaFileInfo(null);
      setFilePathState('');
      clearStartWarning();
      return;
    }

    const nextFilePath = createSelectedMediaFilePath(file);
    selectedMediaFileRef.current = file;
    selectedMediaFilePathRef.current = nextFilePath;
    setSelectedMediaFileInfo({
      name: file.name || '媒体文件',
      size: file.size,
      type: file.type,
      lastModified: file.lastModified,
    });
    setFilePathState(nextFilePath);
    setSourceKindState('file');
    clearStartWarning();
  }, [clearStartWarning]);

  const start = useCallback(async () => {
    if (consentOpen) {
      return;
    }

    setUnavailableControl(null);
    setStartError(undefined);
    setExportError(undefined);
    setExportNotice(undefined);
    setLatencyWarning(false);

    if (!ingestorReady && sourceKind !== 'file') {
      setStartError('音频设备仍在初始化，请稍后再试。');
      return;
    }

    if (sourceKind === 'system' && !nativeSourceAvailability.system) {
      setStartError(
        isDesktop
          ? '未找到系统声音监视设备。请在系统音频设置中启用 monitor/loopback 输入，或改用媒体文件。'
          : '系统声音捕获需要桌面版。请启动桌面应用，或改用媒体文件。',
      );
      return;
    }

    if (sourceKind === 'microphone' && !nativeSourceAvailability.microphone) {
      setStartError(
        isDesktop ? '未检测到可用麦克风输入设备。' : '麦克风捕获需要桌面版。请启动桌面应用。',
      );
      return;
    }

    if (vendorParts.setupError) {
      setStartError(vendorParts.setupError);
      return;
    }

    const hasAudioSource = sourceKind === 'file' ? filePath.trim().length > 0 : true;
    if (!hasAudioSource) {
      setStartError('请先选择媒体文件，或切换到系统声音/麦克风。');
      return;
    }

    linesMapRef.current.clear();
    refreshLines();
    sessionIdRef.current = createSessionId();
    startDuration();

    const selection =
      sourceKind === 'file'
        ? { kind: 'file' as const, filePath }
        : sourceKind === 'system'
          ? { kind: 'system' as const, deviceId: 'system:default' }
          : { kind: 'microphone' as const, deviceId: 'microphone:default' };

    const transition = sessionManager.start({ hasAudioSource });
    if (!transition.ok) {
      if (transition.reason === 'no_audio_source') {
        setStartError('请先选择媒体文件，或切换到系统声音/麦克风。');
      }
      resetDuration();
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
      resetDuration();
      setStartError(formatStartError(error, sourceKind, isDesktop));
    }
  }, [
    consentOpen,
    filePath,
    ingestorReady,
    isDesktop,
    nativeSourceAvailability.microphone,
    nativeSourceAvailability.system,
    pipeline,
    refreshLines,
    resetDuration,
    sessionManager,
    settings.showSourceText,
    sourceKind,
    startDuration,
    vendorParts.setupError,
  ]);

  const pause = useCallback(async () => {
    setUnavailableControl(null);
    const transition = sessionManager.pause();
    if (!transition.ok) {
      return;
    }

    pauseDuration();
    setLatencyWarning(false);
    await pipeline.pause();
  }, [pauseDuration, pipeline, sessionManager]);

  const resume = useCallback(async () => {
    setUnavailableControl(null);
    const transition = sessionManager.resume();
    if (!transition.ok) {
      return;
    }

    resumeDuration();
    await pipeline.resume();
  }, [pipeline, resumeDuration, sessionManager]);

  const stop = useCallback(async () => {
    setUnavailableControl(null);
    const transition = sessionManager.stop();
    if (!transition.ok) {
      return;
    }

    pauseDuration();
    setLatencyWarning(false);
    await pipeline.stop();
    const store = pipeline.getTranscriptStore();
    stoppedTranscriptStoreRef.current = store;
    setStoppedTranscriptCount(store.getEntries().length);
    setStoppedCanExport(store.canExport());
    setStopDialogOpen(true);
  }, [pauseDuration, pipeline, sessionManager]);

  const closeStopDialog = useCallback(() => {
    setStopDialogOpen(false);
    setExportError(undefined);
    setExportNotice(undefined);
  }, []);

  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  const clearCaptions = useCallback(() => {
    linesMapRef.current.clear();
    refreshLines();
  }, [refreshLines]);

  const dismissStartError = useCallback(() => {
    clearStartWarning();
  }, [clearStartWarning]);

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

  const hasSelectedAudioSource = sourceKind !== 'file' || filePath.trim().length > 0;

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
    selectedMediaFile,
    setMediaFile,
    systemAudioAvailable: nativeSourceAvailability.system,
    microphoneAvailable: nativeSourceAvailability.microphone,
    nativeCaptureError,
    sourceLanguage,
    setSourceLanguage,
    settingsOpen,
    setSettingsOpen,
    closeSettings,
    clearCaptions,
    stopDialogOpen,
    exportError,
    exportNotice,
    startError,
    consentOpen,
    unavailableControl,
    canStart: hasSelectedAudioSource,
    acceptConsent,
    dismissStartError,
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
