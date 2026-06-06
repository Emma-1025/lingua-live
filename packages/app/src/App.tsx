import { ConsentDialog } from './components/ConsentDialog.js';
import { ControlPanel } from './components/ControlPanel.js';
import { SettingsPanel } from './components/SettingsPanel.js';
import { StopExportDialog } from './components/StopExportDialog.js';
import { SubtitleView } from './components/SubtitleView.js';
import { useInterpretationSession } from './hooks/useInterpretationSession.js';

export function App() {
  const session = useInterpretationSession();

  return (
    <div className="app">
      <ConsentDialog open={session.consentOpen} onAccept={session.acceptConsent} />

      <header className="app__header">
        <div>
          <h1>LinguaLive</h1>
          <p className="app__subtitle">AI 同声传译助手</p>
        </div>
        <p className="app__source">
          {session.isDesktop ? '桌面版' : 'Web 版'}
          {' · '}
          来源：
          {session.sourceKind === 'file'
            ? '媒体文件'
            : session.sourceKind === 'system'
              ? '系统声音'
              : '麦克风'}
          {' · '}
          语言：{session.sourceLanguage.toUpperCase()}
        </p>
      </header>

      <main className="app__main">
        <SubtitleView
          lines={session.lines}
          showSourceText={session.settings.showSourceText}
          fontSizeLevel={session.settings.fontSizeLevel}
        />
      </main>

      <ControlPanel
        sessionState={session.sessionState}
        latencyWarning={session.latencyWarning}
        unavailableControl={session.unavailableControl}
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
        settings={session.settings}
        llmSettings={session.llmSettings}
        sessionState={session.sessionState}
        onClose={() => session.setSettingsOpen(false)}
        onSourceKindChange={session.setSourceKind}
        onFilePathChange={session.setFilePath}
        onSourceLanguageChange={session.setSourceLanguage}
        onSettingsChange={session.setSettings}
        onLlmSettingsChange={session.setLlmSettings}
      />

      <StopExportDialog
        open={session.stopDialogOpen}
        segmentCount={session.transcriptCount}
        durationMs={session.durationMs}
        canExport={session.canExport}
        exportError={session.exportError}
        onExport={session.exportTranscript}
        onClose={session.closeStopDialog}
      />
    </div>
  );
}
