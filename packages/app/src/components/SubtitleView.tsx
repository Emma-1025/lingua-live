import { useEffect, useRef } from 'react';
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

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [lines, showSourceText, fontSizeLevel]);

  return (
    <section
      className={`subtitle-view ${FONT_SIZE_CLASS[fontSizeLevel]}`}
      aria-label="实时字幕"
    >
      <div
        ref={scrollRef}
        className="subtitle-view__scroll"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
      >
        {lines.length === 0 ? (
          <p className="subtitle-view__empty">字幕将在此处显示…</p>
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
            >
              {showSourceText && line.sourceText ? (
                <p className="subtitle-view__source">{line.sourceText}</p>
              ) : null}
              <p className="subtitle-view__zh">
                {line.unrecognized ? (
                  <span className="subtitle-view__unrecognized">（无法识别）</span>
                ) : (
                  <>
                    {line.zhText}
                    {line.untranslated ? (
                      <span className="subtitle-view__untranslated">未翻译</span>
                    ) : null}
                  </>
                )}
              </p>
              {line.showCorrectionHighlight ? (
                <span className="subtitle-view__badge">✎已更正</span>
              ) : null}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
