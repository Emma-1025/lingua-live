import type { DeepSeekClient } from '../llm/deepseekClient.js';
import { createDeepSeekClient } from '../llm/deepseekClient.js';
import type { SourceSegment, ZhSegment } from '../models.js';
import type { Translator } from '../translate/translator.js';
import { createTranslator } from '../translate/translator.js';
import {
  CORRECTION_EMIT_DEADLINE_MS,
  CORRECTION_FREEZE_AFTER_MS,
  DEFAULT_CORRECTION_MODEL,
  DEFAULT_CORRECTION_WINDOW_SIZE,
} from './constants.js';

interface TrackedSegment {
  id: string;
  sessionId: string;
  sourceText: string;
  zhText: string;
  status: 'partial' | 'final';
  spokenIndex: number;
  displayedAt: number;
}

export interface CorrectionRevision {
  id: string;
  sourceText: string;
  zhText: string;
  spokenIndex: number;
}

export interface CorrectionEngineConfig {
  client?: DeepSeekClient;
  translator?: Translator;
  correctionModel?: string;
  freezeAfterMs?: number;
  emitDeadlineMs?: number;
  windowSize?: number;
  now?: () => number;
}

export interface CorrectionEngine {
  recordDisplayed(zh: ZhSegment, displayedAt: number): void;
  handleSourceSegment(segment: SourceSegment, triggeredAt: number): Promise<ZhSegment[]>;
  reset(): void;
  onRevision(handler: (segment: ZhSegment) => void): () => void;
}

type RevisionHandler = (segment: ZhSegment) => void;

export class CorrectionEngineImpl implements CorrectionEngine {
  private readonly tracked = new Map<string, TrackedSegment>();
  private readonly sourceById = new Map<string, string>();
  private readonly revisionHandlers = new Set<RevisionHandler>();
  private readonly client: DeepSeekClient;
  private readonly translator: Translator;
  private readonly freezeAfterMs: number;
  private readonly emitDeadlineMs: number;
  private readonly windowSize: number;
  private readonly now: () => number;

  constructor(config: CorrectionEngineConfig = {}) {
    this.client =
      config.client ??
      createDeepSeekClient({
        model: config.correctionModel ?? DEFAULT_CORRECTION_MODEL,
      });
    this.translator = config.translator ?? createTranslator();
    this.freezeAfterMs = config.freezeAfterMs ?? CORRECTION_FREEZE_AFTER_MS;
    this.emitDeadlineMs = config.emitDeadlineMs ?? CORRECTION_EMIT_DEADLINE_MS;
    this.windowSize = config.windowSize ?? DEFAULT_CORRECTION_WINDOW_SIZE;
    this.now = config.now ?? (() => Date.now());
  }

  recordDisplayed(zh: ZhSegment, displayedAt: number): void {
    this.tracked.set(zh.id, {
      id: zh.id,
      sessionId: zh.sessionId,
      sourceText: zh.sourceText,
      zhText: zh.zhText,
      status: zh.status,
      spokenIndex: zh.spokenIndex,
      displayedAt,
    });
  }

  async handleSourceSegment(segment: SourceSegment, triggeredAt: number): Promise<ZhSegment[]> {
    const previousSource = this.sourceById.get(segment.id);
    this.sourceById.set(segment.id, segment.text);

    const revisions: ZhSegment[] = [];

    if (previousSource !== undefined && previousSource !== segment.text) {
      const asrRevision = await this.reviseAsrSegment(segment, triggeredAt);
      if (asrRevision) {
        revisions.push(asrRevision);
      }
    }

    if (segment.status === 'final') {
      const contextRevisions = await this.reviseContextWindow(segment, triggeredAt);
      revisions.push(...contextRevisions);
    }

    for (const revision of revisions) {
      this.emitRevision(revision);
    }

    return revisions;
  }

  reset(): void {
    this.tracked.clear();
    this.sourceById.clear();
  }

  onRevision(handler: RevisionHandler): () => void {
    this.revisionHandlers.add(handler);
    return () => {
      this.revisionHandlers.delete(handler);
    };
  }

  private async reviseAsrSegment(
    segment: SourceSegment,
    triggeredAt: number,
  ): Promise<ZhSegment | undefined> {
    if (!this.isEligible(segment.id)) {
      return undefined;
    }

    const tracked = this.tracked.get(segment.id);
    const context = this.buildContextWindow(segment.id);
    const translated = await this.withEmitDeadline(
      this.translator.translateFinal(segment, context),
      triggeredAt,
    );

    if (!translated || translated.zhText === tracked?.zhText) {
      return undefined;
    }

    return {
      ...translated,
      revisedAt: this.now(),
    };
  }

  private async reviseContextWindow(
    segment: SourceSegment,
    triggeredAt: number,
  ): Promise<ZhSegment[]> {
    const eligible = this.getEligibleWindow(segment.id);
    if (eligible.length === 0) {
      return [];
    }

    const response = await this.withEmitDeadline(
      this.requestContextRevisions(eligible, segment),
      triggeredAt,
    );
    if (!response) {
      return [];
    }

    const revisions: ZhSegment[] = [];
    for (const item of response) {
      const tracked = this.tracked.get(item.id);
      if (!tracked || item.zhText === tracked.zhText) {
        continue;
      }

      revisions.push({
        id: tracked.id,
        sessionId: tracked.sessionId,
        sourceText: tracked.sourceText,
        zhText: item.zhText,
        status: tracked.status,
        spokenIndex: tracked.spokenIndex,
        untranslated: false,
        revisedAt: this.now(),
      });
    }

    return revisions;
  }

  private async requestContextRevisions(
    window: TrackedSegment[],
    latestFinal: SourceSegment,
  ): Promise<CorrectionRevision[] | undefined> {
    const windowText = window
      .map(
        (entry) =>
          `{"id":"${entry.id}","sourceText":"${entry.sourceText}","currentZh":"${entry.zhText}"}`,
      )
      .join('\n');

    const content = await this.client.chatCompletion([
      {
        role: 'system',
        content:
          'You are revising live interpretation subtitles. Given prior Chinese segments and newly clarified source context, return corrected Chinese for ONLY the segments whose meaning changed. Respond as JSON: [{"id":"...","zhText":"..."}]. If nothing changed, return [].',
      },
      {
        role: 'user',
        content: `<window>\n${windowText}\n</window>\n<new_context>${latestFinal.text}</new_context>`,
      },
    ]);

    return parseCorrectionResponse(content);
  }

  private buildContextWindow(excludeId: string) {
    const entries = [...this.tracked.values()]
      .filter((entry) => entry.id !== excludeId && entry.status === 'final')
      .sort((left, right) => left.spokenIndex - right.spokenIndex)
      .slice(-this.windowSize)
      .map((entry) => ({
        id: entry.id,
        sourceText: entry.sourceText,
        zhText: entry.zhText,
        spokenIndex: entry.spokenIndex,
      }));

    return { entries };
  }

  private getEligibleWindow(latestId: string): TrackedSegment[] {
    const current = this.now();
    return [...this.tracked.values()]
      .filter((entry) => entry.id !== latestId && this.isEligible(entry.id, current))
      .sort((left, right) => left.spokenIndex - right.spokenIndex)
      .slice(-this.windowSize);
  }

  private isEligible(segmentId: string, at = this.now()): boolean {
    const tracked = this.tracked.get(segmentId);
    if (!tracked) {
      return false;
    }

    if (tracked.status === 'partial') {
      return true;
    }

    return at - tracked.displayedAt <= this.freezeAfterMs;
  }

  private async withEmitDeadline<T>(
    promise: Promise<T>,
    triggeredAt: number,
  ): Promise<T | undefined> {
    const remaining = triggeredAt + this.emitDeadlineMs - this.now();
    if (remaining <= 0) {
      return undefined;
    }

    let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<undefined>((resolve) => {
          timeoutHandle = globalThis.setTimeout(() => resolve(undefined), remaining);
        }),
      ]);
    } finally {
      if (timeoutHandle !== undefined) {
        globalThis.clearTimeout(timeoutHandle);
      }
    }
  }

  private emitRevision(segment: ZhSegment): void {
    this.recordDisplayed(segment, this.now());
    for (const handler of this.revisionHandlers) {
      handler(segment);
    }
  }
}

export function createCorrectionEngine(config: CorrectionEngineConfig = {}): CorrectionEngine {
  return new CorrectionEngineImpl(config);
}

export function parseCorrectionResponse(content: string): CorrectionRevision[] | undefined {
  const trimmed = content.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const items = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { revisions?: unknown }).revisions)
        ? (parsed as { revisions: unknown[] }).revisions
        : undefined;

    if (!items) {
      return undefined;
    }

    const revisions: CorrectionRevision[] = [];
    for (const item of items) {
      if (
        typeof item !== 'object' ||
        item === null ||
        typeof (item as { id?: unknown }).id !== 'string' ||
        typeof (item as { zhText?: unknown }).zhText !== 'string'
      ) {
        return undefined;
      }

      const revision = item as { id: string; zhText: string; sourceText?: string; spokenIndex?: number };
      revisions.push({
        id: revision.id,
        zhText: revision.zhText,
        sourceText: revision.sourceText ?? '',
        spokenIndex: revision.spokenIndex ?? 0,
      });
    }

    return revisions;
  } catch {
    return undefined;
  }
}
