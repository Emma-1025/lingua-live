export interface StopExportDialogProps {
  open: boolean;
  segmentCount: number;
  durationMs: number;
  canExport: boolean;
  exportError?: string;
  exportNotice?: string;
  onExport: () => void | Promise<void>;
  onClose: () => void;
}

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function StopExportDialog({
  open,
  segmentCount,
  durationMs,
  canExport,
  exportError,
  exportNotice,
  onExport,
  onClose,
}: StopExportDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <dialog className="stop-export-dialog" open aria-label="会话结束">
      <p className="dialog__eyebrow">Session Complete</p>
      <h2>本场会话已结束</h2>
      <p>
        共 {segmentCount} 条字幕，时长 {formatDuration(durationMs)}
      </p>
      {exportError ? <p className="stop-export-dialog__error">{exportError}</p> : null}
      {exportNotice ? <p className="stop-export-dialog__notice">{exportNotice}</p> : null}
      <div className="stop-export-dialog__actions">
        {canExport ? (
          <button type="button" className="dialog__primary" onClick={onExport}>
            导出文本 (.txt)
          </button>
        ) : (
          <p className="stop-export-dialog__empty">无可导出的字幕</p>
        )}
        <button type="button" onClick={onClose}>
          关闭
        </button>
      </div>
    </dialog>
  );
}
