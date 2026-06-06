import { describe, expect, it } from 'vitest';
import {
  CORRECTION_HIGHLIGHT_MS,
  MAX_SUBTITLE_SCROLLBACK,
  addUnrecognizedLine,
  shouldShowCorrectionHighlight,
  toSortedSubtitleLines,
  upsertZhSegment,
} from './subtitleState.js';

describe('subtitleState', () => {
  it('orders lines by spokenIndex and caps scrollback', () => {
    const lines = new Map();
    for (let index = 0; index < MAX_SUBTITLE_SCROLLBACK + 5; index += 1) {
      upsertZhSegment(lines, {
        id: `seg-${index}`,
        sessionId: 'sess-1',
        sourceText: `source-${index}`,
        zhText: `第${index}句`,
        status: 'final',
        spokenIndex: index,
        untranslated: false,
      });
    }

    const sorted = toSortedSubtitleLines(lines);
    expect(sorted).toHaveLength(MAX_SUBTITLE_SCROLLBACK);
    expect(sorted[0]?.spokenIndex).toBe(5);
    expect(sorted.at(-1)?.spokenIndex).toBe(MAX_SUBTITLE_SCROLLBACK + 4);
  });

  it('resolves partial updates in place for the same segment id', () => {
    const lines = new Map();
    upsertZhSegment(lines, {
      id: 'seg-1',
      sessionId: 'sess-1',
      sourceText: 'hello',
      zhText: '你',
      status: 'partial',
      spokenIndex: 0,
      untranslated: false,
    });
    upsertZhSegment(lines, {
      id: 'seg-1',
      sessionId: 'sess-1',
      sourceText: 'hello world',
      zhText: '你好世界',
      status: 'final',
      spokenIndex: 0,
      untranslated: false,
    });

    const sorted = toSortedSubtitleLines(lines);
    expect(sorted).toHaveLength(1);
    expect(sorted[0]?.status).toBe('final');
    expect(sorted[0]?.zhText).toBe('你好世界');
  });

  it('shows correction highlight within two seconds of revision', () => {
    const line = {
      id: 'seg-1',
      spokenIndex: 0,
      sourceText: 'corpus',
      zhText: '语料库',
      status: 'final' as const,
      untranslated: false,
      unrecognized: false,
      revisedAt: 10_000,
    };

    expect(shouldShowCorrectionHighlight(line, 10_000)).toBe(true);
    expect(shouldShowCorrectionHighlight(line, 10_000 + CORRECTION_HIGHLIGHT_MS - 1)).toBe(
      true,
    );
    expect(shouldShowCorrectionHighlight(line, 10_000 + CORRECTION_HIGHLIGHT_MS)).toBe(false);
  });

  it('adds unrecognized placeholder lines', () => {
    const lines = new Map();
    addUnrecognizedLine(lines, {
      sessionId: 'sess-1',
      segmentId: 'seg-u',
      spokenIndex: 2,
      startedAt: 1_000,
    });

    expect(toSortedSubtitleLines(lines)[0]).toMatchObject({
      unrecognized: true,
      zhText: '',
    });
  });
});
