import type { UnrecognizedEvent } from '@lingua-live/core';
import type { ZhSegment } from '@lingua-live/core';
import type { SubtitleLine } from '../types/subtitle.js';

export const MAX_SUBTITLE_SCROLLBACK = 200;
export const CORRECTION_HIGHLIGHT_MS = 2_000;

export function upsertZhSegment(
  lines: Map<string, SubtitleLine>,
  segment: ZhSegment,
): void {
  lines.set(segment.id, {
    id: segment.id,
    spokenIndex: segment.spokenIndex,
    sourceText: segment.sourceText,
    zhText: segment.zhText,
    status: segment.status,
    untranslated: segment.untranslated,
    unrecognized: false,
    revisedAt: segment.revisedAt,
  });
}

export function addUnrecognizedLine(
  lines: Map<string, SubtitleLine>,
  event: UnrecognizedEvent,
): void {
  lines.set(event.segmentId, {
    id: event.segmentId,
    spokenIndex: event.spokenIndex,
    sourceText: '',
    zhText: '',
    status: 'final',
    untranslated: false,
    unrecognized: true,
  });
}

export function toSortedSubtitleLines(
  lines: Map<string, SubtitleLine>,
  now = Date.now(),
): SubtitleLine[] {
  return [...lines.values()]
    .sort((left, right) => left.spokenIndex - right.spokenIndex)
    .slice(-MAX_SUBTITLE_SCROLLBACK)
    .map((line) => ({
      ...line,
      showCorrectionHighlight: shouldShowCorrectionHighlight(line, now),
    }));
}

export function shouldShowCorrectionHighlight(
  line: SubtitleLine,
  now: number,
): boolean {
  return line.revisedAt !== undefined && now - line.revisedAt < CORRECTION_HIGHLIGHT_MS;
}

export type DisplaySubtitleLine = SubtitleLine & {
  showCorrectionHighlight?: boolean;
};
