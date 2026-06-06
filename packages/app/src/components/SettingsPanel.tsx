import type {
  AudioSourceKind,
  LlmProvider,
  LlmSettings,
  SessionSettings,
  SupportedSourceLanguage,
} from '@lingua-live/core';
import {
  DEFAULT_SOURCE_LANGUAGE,
  LLM_PROVIDER_OPTIONS,
  LLM_PROVIDER_PRESETS,
} from '@lingua-live/core';
import { useEffect, useRef } from 'react';
import type { SessionState } from '../types/session.js';

export interface SettingsPanelProps {
  open: boolean;
  sourceKind: AudioSourceKind;
  sourceLanguage: SupportedSourceLanguage;
  filePath?: string;
  settings: SessionSettings;
  llmSettings: LlmSettings;
  sessionState: SessionState;
  onClose: () => void;
  onSourceKindChange: (kind: AudioSourceKind) => void;
  onFilePathChange: (filePath: string) => void;
  onSourceLanguageChange: (language: SupportedSourceLanguage) => void;
  onSettingsChange: (settings: SessionSettings) => void;
  onLlmSettingsChange: (settings: LlmSettings) => void;
}

const SOURCE_LANGUAGES: SupportedSourceLanguage[] = [
  'en',
  'ja',
  'ko',
  'fr',
  'de',
  'es',
  'zh',
];

export function SettingsPanel({
  open,
  sourceKind,
  sourceLanguage,
  filePath,
  settings,
  llmSettings,
  sessionState,
  onClose,
  onSourceKindChange,
  onFilePathChange,
  onSourceLanguageChange,
  onSettingsChange,
  onLlmSettingsChange,
}: SettingsPanelProps) {
  const llmLocked = sessionState !== 'stopped';
  const cloudProvider = llmSettings.provider !== 'mock';
  const preset =
    llmSettings.provider === 'mock' ? undefined : LLM_PROVIDER_PRESETS[llmSettings.provider];

  const updateLlm = (patch: Partial<LlmSettings>) => {
    onLlmSettingsChange({ ...llmSettings, ...patch });
  };

  const onProviderChange = (provider: LlmProvider) => {
    const nextPreset = provider === 'mock' ? undefined : LLM_PROVIDER_PRESETS[provider];
    updateLlm({
      provider,
      baseUrl: nextPreset?.baseUrl,
      translationModel: nextPreset?.translationModel,
      correctionModel: nextPreset?.correctionModel,
      ...(provider === 'mock' ? { apiKey: '' } : {}),
    });
  };
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    globalThis.addEventListener('keydown', onKeyDown);
    return () => globalThis.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <aside
      className="settings-panel"
      role="dialog"
      aria-modal="true"
      aria-label="设置"
    >
      <header className="settings-panel__header">
        <h2>设置</h2>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="关闭设置"
        >
          ✕
        </button>
      </header>

      <section>
        <h3>音频来源</h3>
        <label>
          <input
            type="radio"
            name="source-kind"
            checked={sourceKind === 'system'}
            onChange={() => onSourceKindChange('system')}
          />
          系统声音
        </label>
        <label>
          <input
            type="radio"
            name="source-kind"
            checked={sourceKind === 'microphone'}
            onChange={() => onSourceKindChange('microphone')}
          />
          麦克风
        </label>
        <label>
          <input
            type="radio"
            name="source-kind"
            checked={sourceKind === 'file'}
            onChange={() => onSourceKindChange('file')}
          />
          媒体文件
        </label>
        {sourceKind === 'file' ? (
          <input
            type="text"
            className="settings-panel__file"
            value={filePath ?? ''}
            placeholder="/path/to/audio.wav"
            onChange={(event) => onFilePathChange(event.target.value)}
          />
        ) : null}
      </section>

      <section>
        <h3>源语言</h3>
        <select
          value={sourceLanguage}
          onChange={(event) =>
            onSourceLanguageChange(event.target.value as SupportedSourceLanguage)
          }
        >
          {SOURCE_LANGUAGES.map((language) => (
            <option key={language} value={language}>
              {language.toUpperCase()}
            </option>
          ))}
        </select>
      </section>

      <section>
        <h3>显示</h3>
        <label>
          <input
            type="checkbox"
            checked={settings.showSourceText}
            onChange={(event) =>
              onSettingsChange({ ...settings, showSourceText: event.target.checked })
            }
          />
          显示原文（双语）
        </label>
        <div className="settings-panel__font-levels">
          {([1, 2, 3] as const).map((level) => (
            <button
              key={level}
              type="button"
              className={
                settings.fontSizeLevel === level ? 'settings-panel__font--active' : undefined
              }
              onClick={() => onSettingsChange({ ...settings, fontSizeLevel: level })}
            >
              {level === 1 ? '小' : level === 2 ? '中' : '大'}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>中文语音输出</h3>
        <label>
          <input
            type="checkbox"
            checked={settings.audioOutputEnabled}
            onChange={(event) =>
              onSettingsChange({ ...settings, audioOutputEnabled: event.target.checked })
            }
          />
          启用
        </label>
        <label>
          音量
          <input
            type="range"
            min={0}
            max={10}
            value={settings.volumeLevel}
            aria-valuemin={0}
            aria-valuemax={10}
            aria-valuenow={settings.volumeLevel}
            aria-label="中文语音音量"
            onChange={(event) =>
              onSettingsChange({
                ...settings,
                volumeLevel: Number(event.target.value),
              })
            }
          />
        </label>
      </section>

      <section>
        <h3>翻译模型 (LLM)</h3>
        {llmLocked ? (
          <p className="settings-panel__hint">会话进行中时无法更改模型设置，请先停止会话。</p>
        ) : (
          <p className="settings-panel__hint">
            源语言默认 {DEFAULT_SOURCE_LANGUAGE.toUpperCase()} · 密钥仅保存在本机浏览器/桌面应用中
          </p>
        )}
        <label>
          提供商
          <select
            value={llmSettings.provider}
            disabled={llmLocked}
            onChange={(event) => onProviderChange(event.target.value as LlmProvider)}
          >
            {LLM_PROVIDER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {cloudProvider ? (
          <>
            <label>
              API 密钥
              <input
                type="password"
                className="settings-panel__file"
                autoComplete="off"
                disabled={llmLocked}
                value={llmSettings.apiKey}
                placeholder={llmSettings.provider === 'deepseek' ? 'sk-...' : 'sk-...'}
                onChange={(event) => updateLlm({ apiKey: event.target.value })}
              />
            </label>
            <label>
              API 地址（可选）
              <input
                type="text"
                className="settings-panel__file"
                disabled={llmLocked}
                value={llmSettings.baseUrl ?? preset?.baseUrl ?? ''}
                placeholder={preset?.baseUrl}
                onChange={(event) => updateLlm({ baseUrl: event.target.value })}
              />
            </label>
            <label>
              翻译模型（可选）
              <input
                type="text"
                className="settings-panel__file"
                disabled={llmLocked}
                value={llmSettings.translationModel ?? preset?.translationModel ?? ''}
                placeholder={preset?.translationModel}
                onChange={(event) => updateLlm({ translationModel: event.target.value })}
              />
            </label>
          </>
        ) : null}
      </section>
    </aside>
  );
}

export const DEFAULT_UI_SETTINGS: SessionSettings = {
  showSourceText: false,
  fontSizeLevel: 2,
  audioOutputEnabled: false,
  volumeLevel: 5,
};
