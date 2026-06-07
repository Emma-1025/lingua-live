import { ConsentDialog } from './components/ConsentDialog.js';
import { ControlPanel } from './components/ControlPanel.js';
import { SettingsPanel } from './components/SettingsPanel.js';
import { StopExportDialog } from './components/StopExportDialog.js';
import { SubtitleView } from './components/SubtitleView.js';
import { useInterpretationSession } from './hooks/useInterpretationSession.js';

const SOURCE_LABEL = {
  file: '媒体文件',
  microphone: '麦克风',
  system: '系统声音',
} as const;

const STATE_LABEL = {
  capturing: '正在收听',
  paused: '已暂停',
  stopped: '待开始',
} as const;

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function App() {
  const session = useInterpretationSession();
  const platformLabel = session.isDesktop ? '桌面版' : 'Web 版';
  const sourceLabel = SOURCE_LABEL[session.sourceKind];
  const languageLabel = session.sourceLanguage.toUpperCase();
  const durationLabel = formatDuration(session.durationMs);
  const exportLabel = session.canExport ? '可导出' : '等待字幕';

  return (
    <div className="app">
      <div className="app__ambient app__ambient--primary" aria-hidden="true" />
      <div className="app__ambient app__ambient--secondary" aria-hidden="true" />

      <ConsentDialog open={session.consentOpen} onAccept={session.acceptConsent} />

      <header className="app__header">
        <div className="app__brand">
          <span className="app__logo" aria-hidden="true">
            LL
          </span>
          <div>
            <p className="app__eyebrow">AI Interpretation Console</p>
            <h1>LinguaLive</h1>
            <p className="app__subtitle">面向直播、会议与桌面音频的实时中文传译工作台</p>
          </div>
        </div>

        <dl className="app__summary" aria-label="当前会话概览">
          <div className="app__summary-card">
            <dt>运行环境</dt>
            <dd>{platformLabel}</dd>
          </div>
          <div className="app__summary-card">
            <dt>音频来源</dt>
            <dd>{sourceLabel}</dd>
          </div>
          <div className="app__summary-card">
            <dt>源语言</dt>
            <dd>{languageLabel}</dd>
          </div>
        </dl>
      </header>

      <main className="app__main">
        <div className="app__stage">
          <SubtitleView
            lines={session.lines}
            showSourceText={session.settings.showSourceText}
            fontSizeLevel={session.settings.fontSizeLevel}
          />
        </div>

        <aside className="app__insights" aria-label="会话指标">
          <section className="insight-card insight-card--live">
            <p className="insight-card__label">当前状态</p>
            <div className="insight-card__status">
              <span
                className={`insight-card__pulse insight-card__pulse--${session.sessionState}`}
                aria-hidden="true"
              />
              <strong>{STATE_LABEL[session.sessionState]}</strong>
            </div>
            <p className="insight-card__meta">
              {session.latencyWarning ? '延迟升高，请关注网络或模型响应' : '延迟正常，字幕流稳定'}
            </p>
          </section>

          <section className="insight-card">
            <p className="insight-card__label">字幕产出</p>
            <strong>{session.lines.length}</strong>
            <span>屏幕中字幕</span>
          </section>

          <section className="insight-card">
            <p className="insight-card__label">转写归档</p>
            <strong>{session.transcriptCount}</strong>
            <span>{exportLabel}</span>
          </section>

          <section className="insight-card">
            <p className="insight-card__label">会话时长</p>
            <strong>{durationLabel}</strong>
            <span>
              {sourceLabel} · {languageLabel}
            </span>
          </section>
        </aside>
      </main>

      <ControlPanel
        sessionState={session.sessionState}
        latencyWarning={session.latencyWarning}
        unavailableControl={session.unavailableControl}
        startError={session.startError}
        onStart={() => void session.start()}
        onPause={session.pause}
        onResume={session.resume}
        onStop={() => void session.stop()}
        onOpenSettings={() => session.setSettingsOpen(true)}
      />

      <SettingsPanel
        open={session.settingsOpen}
        sourceKind={session.sourceKind}
        sourceLanguage={session.sourceLanguage}
        filePath={session.filePath}
        selectedMediaFile={session.selectedMediaFile}
        systemAudioAvailable={session.systemAudioAvailable}
        microphoneAvailable={session.microphoneAvailable}
        nativeCaptureError={session.nativeCaptureError}
        settings={session.settings}
        llmSettings={session.llmSettings}
        vendorSettings={session.vendorSettings}
        sessionState={session.sessionState}
        onClose={session.closeSettings}
        onSourceKindChange={session.setSourceKind}
        onFilePathChange={session.setFilePath}
        onMediaFileChange={session.setMediaFile}
        onSourceLanguageChange={session.setSourceLanguage}
        onSettingsChange={session.setSettings}
        onLlmSettingsChange={session.setLlmSettings}
        onVendorSettingsChange={session.setVendorSettings}
      />

      <StopExportDialog
        open={session.stopDialogOpen}
        segmentCount={session.transcriptCount}
        durationMs={session.durationMs}
        canExport={session.canExport}
        exportError={session.exportError}
        exportNotice={session.exportNotice}
        onExport={session.exportTranscript}
        onClose={session.closeStopDialog}
      />
    </div>
  );
}
