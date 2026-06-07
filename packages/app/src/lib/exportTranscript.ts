import { isTauriRuntime } from '../desktop/isTauri.js';

export type ExportTranscriptResult =
  | { ok: true; path?: string }
  | { ok: false; error: string; cancelled?: boolean };

function formatExportError(error: unknown): string {
  const message = error instanceof Error ? error.message : '未知错误';
  return message.startsWith('导出失败') ? message : `导出失败：${message}`;
}

export async function exportTranscriptText(
  text: string,
  defaultFileName = 'lingua-live-transcript.txt',
): Promise<ExportTranscriptResult> {
  if (!text.trim()) {
    return { ok: false, error: '无可导出的字幕' };
  }

  if (isTauriRuntime()) {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { invoke } = await import('@tauri-apps/api/core');
      const path = await save({
        defaultPath: defaultFileName,
        filters: [{ name: 'Text', extensions: ['txt'] }],
      });

      if (!path) {
        return { ok: false, error: '已取消导出', cancelled: true };
      }

      await invoke('write_transcript_file', { path, content: text });
      return { ok: true, path };
    } catch (error) {
      return { ok: false, error: formatExportError(error) };
    }
  }

  try {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = defaultFileName;
    anchor.click();
    URL.revokeObjectURL(url);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: formatExportError(error) };
  }
}
