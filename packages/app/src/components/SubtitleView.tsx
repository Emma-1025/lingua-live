import { useEffect, useRef, useState } from 'react';
import type { DisplaySubtitleLine } from '../lib/subtitleState.js';

export interface SubtitleViewProps {
  lines: DisplaySubtitleLine[];
  showSourceText: boolean;
  fontSizeLevel: 1 | 2 | 3;
}

const FONT_SIZE_CLASS: Record<1 | 2 | 3, string> = {
  1: 'subtitle-view--font-sm',
  2: 'subtitle-view--font-md',
  3: 'subtitle-view--font-lg',
};

export function SubtitleView({ lines, showSourceText, fontSizeLevel }: SubtitleViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const announcedFinalsRef = useRef(new Set<string>());
  const [finalAnnouncement, setFinalAnnouncement] = useState('');
  const finalCount = lines.filter((line) => line.status === 'final').length;
  const partialCount = lines.length - finalCount;

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [lines, showSourceText, fontSizeLevel]);

  useEffect(() => {
    for (const line of lines) {
      if (line.status !== 'final' || line.unrecognized || announcedFinalsRef.current.has(line.id)) {
        continue;
      }

      announcedFinalsRef.current.add(line.id);
      setFinalAnnouncement(line.zhText);
    }
  }, [lines]);

  return (
    <section className={`subtitle-view ${FONT_SIZE_CLASS[fontSizeLevel]}`} aria-label="实时字幕">
      <header className="subtitle-view__header">
        <div>
          <p className="subtitle-view__eyebrow">Live Captions</p>
          <h2>实时字幕</h2>
        </div>
        <dl className="subtitle-view__metrics" aria-label="字幕统计">
          <div>
            <dt>已确认</dt>
            <dd>{finalCount}</dd>
          </div>
          <div>
            <dt>识别中</dt>
            <dd>{partialCount}</dd>
          </div>
        </dl>
      </header>

      <div className="sr-only" aria-live="assertive" aria-atomic="true">
        {finalAnnouncement}
      </div>

      <div
        ref={scrollRef}
        className="subtitle-view__scroll"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {lines.length === 0 ? (
          <div className="subtitle-view__empty">
            <p className="subtitle-view__empty-title">准备接收音频</p>
            <p>字幕将在此处显示…</p>
            <span>选择来源并点击开始，LinguaLive 会自动滚动最新字幕。</span>
          </div>
        ) : (
          lines.map((line) => (
            <article
              key={line.id}
              className={[
                'subtitle-view__line',
                line.status === 'partial' ? 'subtitle-view__line--partial' : '',
                line.showCorrectionHighlight ? 'subtitle-view__line--corrected' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-spoken-index={line.spokenIndex}
              data-status={line.status}
              aria-label={
                line.showCorrectionHighlight
                  ? `已更正字幕：${line.zhText}`
                  : line.status === 'final'
                    ? `最终字幕：${line.zhText}`
                    : `临时字幕：${line.zhText}`
              }
            >
              <div className="subtitle-view__line-meta" aria-hidden="true">
                <span>#{line.spokenIndex + 1}</span>
                <span>{line.status === 'final' ? '已确认' : '识别中'}</span>
              </div>
              {showSourceText && line.sourceText ? (
                <p className="subtitle-view__source">{line.sourceText}</p>
              ) : null}
              <p className="subtitle-view__zh">
                {line.unrecognized ? (
                  <span className="subtitle-view__unrecognized">（无法识别）</span>
                ) : (
                  <>
                    {line.zhText}
                    {line.untranslated && line.status === 'final' ? (
                      <span className="subtitle-view__untranslated">未翻译</span>
                    ) : null}
                  </>
                )}
              </p>
              {line.showCorrectionHighlight ? (
                <span className="subtitle-view__badge" aria-hidden="true">
                  ✎已更正
                </span>
              ) : null}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
