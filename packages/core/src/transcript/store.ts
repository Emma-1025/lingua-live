import type { TranscriptEntry, ZhSegment } from '../models.js';

export type TranscriptState = 'empty' | 'ready';

export interface TextFileWriter {
  writeFile(path: string, content: string): Promise<void>;
}

export type ExportResult =
  | { ok: true; path: string }
  | { ok: false; error: string };

interface StoredEntry extends TranscriptEntry {
  id: string;
}

export interface TranscriptStore {
  appendFinal(zh: ZhSegment, options: { showSourceText: boolean }): void;
  applyCorrection(zh: ZhSegment): boolean;
  getEntries(): readonly TranscriptEntry[];
  getState(): TranscriptState;
  canExport(): boolean;
  exportToText(): string;
  exportToFile(path: string, writer: TextFileWriter): Promise<ExportResult>;
  reset(): void;
}

export class TranscriptStoreImpl implements TranscriptStore {
  private entries: StoredEntry[] = [];
  private readonly idToIndex = new Map<string, number>();

  appendFinal(zh: ZhSegment, options: { showSourceText: boolean }): void {
    if (zh.status !== 'final') {
      return;
    }

    const entry: StoredEntry = {
      id: zh.id,
      spokenIndex: zh.spokenIndex,
      zhText: zh.zhText,
      status: 'final',
      ...(options.showSourceText ? { sourceText: zh.sourceText } : {}),
    };

    const existingIndex = this.idToIndex.get(zh.id);
    if (existingIndex !== undefined) {
      this.entries[existingIndex] = {
        ...this.entries[existingIndex],
        ...entry,
      };
      return;
    }

    const insertAt = this.entries.findIndex((item) => item.spokenIndex > zh.spokenIndex);
    if (insertAt === -1) {
      this.idToIndex.set(zh.id, this.entries.length);
      this.entries.push(entry);
      return;
    }

    this.entries.splice(insertAt, 0, entry);
    this.rebuildIdIndex();
  }

  applyCorrection(zh: ZhSegment): boolean {
    const index = this.idToIndex.get(zh.id);
    if (index === undefined) {
      return false;
    }

    const current = this.entries[index];
    if (!current) {
      return false;
    }

    this.entries[index] = {
      ...current,
      zhText: zh.zhText,
      revisedAt: zh.revisedAt,
      ...(current.sourceText !== undefined
        ? { sourceText: zh.sourceText ?? current.sourceText }
        : {}),
    };
    return true;
  }

  getEntries(): readonly TranscriptEntry[] {
    return this.entries.map(toPublicEntry);
  }

  getState(): TranscriptState {
    return this.entries.length === 0 ? 'empty' : 'ready';
  }

  canExport(): boolean {
    return this.entries.length > 0;
  }

  exportToText(): string {
    if (!this.canExport()) {
      return '';
    }

    return this.entries
      .map((entry) => {
        if (entry.sourceText) {
          return `${entry.sourceText}\n${entry.zhText}`;
        }
        return entry.zhText;
      })
      .join('\n\n');
  }

  async exportToFile(path: string, writer: TextFileWriter): Promise<ExportResult> {
    if (!this.canExport()) {
      return { ok: false, error: '无可导出的字幕' };
    }

    try {
      await writer.writeFile(path, this.exportToText());
      return { ok: true, path };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'export failed';
      return { ok: false, error: message };
    }
  }

  reset(): void {
    this.entries = [];
    this.idToIndex.clear();
  }

  private rebuildIdIndex(): void {
    this.idToIndex.clear();
    this.entries.forEach((entry, index) => {
      this.idToIndex.set(entry.id, index);
    });
  }
}

export function createTranscriptStore(): TranscriptStore {
  return new TranscriptStoreImpl();
}

function toPublicEntry(entry: StoredEntry): TranscriptEntry {
  return {
    spokenIndex: entry.spokenIndex,
    zhText: entry.zhText,
    status: entry.status,
    ...(entry.sourceText !== undefined ? { sourceText: entry.sourceText } : {}),
    ...(entry.revisedAt !== undefined ? { revisedAt: entry.revisedAt } : {}),
  };
}
