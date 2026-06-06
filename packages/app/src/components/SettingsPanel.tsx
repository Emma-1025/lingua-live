import type {
  AudioSourceKind,
  SessionSettings,
  SupportedSourceLanguage,
} from '@lingua-live/core';
import { DEFAULT_SOURCE_LANGUAGE } from '@lingua-live/core';

export interface SettingsPanelProps {
  open: boolean;
  sourceKind: AudioSourceKind;
  sourceLanguage: SupportedSourceLanguage;
  filePath?: string;
  settings: SessionSettings;
  onClose: () => void;
  onSourceKindChange: (kind: AudioSourceKind) => void;
  onFilePathChange: (filePath: string) => void;
  onSourceLanguageChange: (language: SupportedSourceLanguage) => void;
  onSettingsChange: (settings: SessionSettings) => void;
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
  onClose,
  onSourceKindChange,
  onFilePathChange,
  onSourceLanguageChange,
  onSettingsChange,
}: SettingsPanelProps) {
  if (!open) {
    return null;
  }

  return (
    <aside className="settings-panel" aria-label="设置">
      <header className="settings-panel__header">
        <h2>设置</h2>
        <button type="button" onClick={onClose} aria-label="关闭设置">
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
        <h3>模型 (DeepSeek)</h3>
        <p className="settings-panel__hint">
          翻译默认 {DEFAULT_SOURCE_LANGUAGE.toUpperCase()} · 在桌面后端配置 API 密钥
        </p>
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
