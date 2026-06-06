export interface ConsentDialogProps {
  open: boolean;
  onAccept: () => void;
}

export function ConsentDialog({ open, onAccept }: ConsentDialogProps) {
  if (!open) {
    return null;
  }

  return (
    <dialog className="consent-dialog" open aria-label="隐私与数据使用说明">
      <h2>首次使用须知</h2>
      <p>
        LinguaLive 会将音频流发送至云端 ASR、DeepSeek 翻译与 TTS 服务以生成实时中文字幕。
        继续即表示你同意此处理方式。
      </p>
      <button type="button" onClick={onAccept}>
        同意并继续
      </button>
    </dialog>
  );
}
