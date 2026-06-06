/** Supported source languages for ASR and translation. English is the default. */
export type SupportedSourceLanguage = 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'zh';

export const DEFAULT_SOURCE_LANGUAGE: SupportedSourceLanguage = 'en';

export type AudioSourceKind = 'system' | 'microphone' | 'file';

export interface AudioSourceSelection {
  kind: AudioSourceKind;
  deviceId?: string;
  filePath?: string;
}

export interface AudioDeviceInfo {
  id: string;
  label: string;
  kind: 'system' | 'microphone';
}

export type SourceLostReason = 'device_disconnect' | 'permission_revoked' | 'file_unreadable';

export interface AudioFrame {
  sessionId: string;
  seq: number;
  capturedAt: number;
  pcm: Float32Array;
  durationMs: number;
}

export type SegmentStatus = 'partial' | 'final';

export interface SourceSegment {
  id: string;
  sessionId: string;
  text: string;
  status: SegmentStatus;
  startedAt: number;
  spokenIndex: number;
  recognizable: boolean;
}

export interface ZhSegment {
  id: string;
  sessionId: string;
  sourceText: string;
  zhText: string;
  status: SegmentStatus;
  spokenIndex: number;
  untranslated: boolean;
  revisedAt?: number;
}

export interface ContextWindowEntry {
  id: string;
  sourceText: string;
  zhText: string;
  spokenIndex: number;
}

export interface ContextWindow {
  entries: ContextWindowEntry[];
}

export type SessionState = 'capturing' | 'paused' | 'stopped';

export interface SessionSettings {
  showSourceText: boolean;
  fontSizeLevel: 1 | 2 | 3;
  audioOutputEnabled: boolean;
  volumeLevel: number;
}

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  showSourceText: false,
  fontSizeLevel: 2,
  audioOutputEnabled: false,
  volumeLevel: 5,
};

export interface Session {
  id: string;
  sourceLanguage: SupportedSourceLanguage;
  audioSource: AudioSourceSelection;
  state: SessionState;
  startedAt: number;
  settings: SessionSettings;
}

export interface TranscriptEntry {
  spokenIndex: number;
  sourceText?: string;
  zhText: string;
  status: 'final';
  revisedAt?: number;
}
