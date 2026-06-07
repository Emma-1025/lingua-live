import type { SessionControl, SessionState } from '../types/session.js';

export interface ControlPanelProps {
  sessionState: SessionState;
  latencyWarning: boolean;
  unavailableControl?: SessionControl | null;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onOpenSettings: () => void;
}

const STATE_LABEL: Record<SessionState, string> = {
  capturing: '正在收听',
  paused: '已暂停',
  stopped: '已停止',
};

export function ControlPanel({
  sessionState,
  latencyWarning,
  unavailableControl,
  onStart,
  onPause,
  onResume,
  onStop,
  onOpenSettings,
}: ControlPanelProps) {
  const isCapturing = sessionState === 'capturing';
  const isPaused = sessionState === 'paused';
  const isStopped = sessionState === 'stopped';

  return (
    <footer className="control-panel" aria-label="会话控制">
      <div className="control-panel__status">
        <span
          className={`control-panel__dot control-panel__dot--${sessionState}`}
          aria-hidden="true"
        />
        <span className="control-panel__status-copy">
          <span>会话状态</span>
          <strong>{STATE_LABEL[sessionState]}</strong>
        </span>
        {latencyWarning ? (
          <span className="control-panel__latency-warning" role="status">
            延迟过高
          </span>
        ) : (
          <span className="control-panel__latency-ok">延迟正常</span>
        )}
      </div>

      <div className="control-panel__actions">
        <button
          type="button"
          className="control-panel__button control-panel__button--primary"
          onClick={onStart}
          disabled={!isStopped || unavailableControl === 'start'}
        >
          开始
        </button>
        <button
          type="button"
          className="control-panel__button"
          onClick={onPause}
          disabled={!isCapturing || unavailableControl === 'pause'}
        >
          暂停
        </button>
        <button
          type="button"
          className="control-panel__button"
          onClick={onResume}
          disabled={!isPaused || unavailableControl === 'resume'}
        >
          继续
        </button>
        <button
          type="button"
          className="control-panel__button control-panel__button--danger"
          onClick={onStop}
          disabled={isStopped || unavailableControl === 'stop'}
        >
          停止
        </button>
        <button
          type="button"
          className="control-panel__button control-panel__settings"
          onClick={onOpenSettings}
        >
          设置
        </button>
      </div>
    </footer>
  );
}
