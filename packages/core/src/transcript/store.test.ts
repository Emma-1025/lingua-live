import { describe, expect, it, vi } from 'vitest';
import type { ZhSegment } from '../models.js';
import {
  TranscriptStoreImpl,
  createTranscriptStore,
  type TextFileWriter,
} from './store.js';

function createZh(overrides: Partial<ZhSegment> = {}): ZhSegment {
  return {
    id: 'seg-1',
    sessionId: 'sess-1',
    sourceText: 'hello',
    zhText: '你好',
    status: 'final',
    spokenIndex: 0,
    untranslated: false,
    ...overrides,
  };
}

describe('TranscriptStoreImpl', () => {
  it('appends finals in spokenIndex order', () => {
    const store = new TranscriptStoreImpl();

    store.appendFinal(createZh({ id: 'seg-b', spokenIndex: 1, zhText: '第二句' }), {
      showSourceText: false,
    });
    store.appendFinal(createZh({ id: 'seg-a', spokenIndex: 0, zhText: '第一句' }), {
      showSourceText: false,
    });

    expect(store.getEntries().map((entry) => entry.zhText)).toEqual(['第一句', '第二句']);
  });

  it('updates an existing final in place on correction', () => {
    const store = new TranscriptStoreImpl();
    store.appendFinal(createZh(), { showSourceText: false });

    const updated = store.applyCorrection({
      ...createZh(),
      zhText: '你好世界',
      revisedAt: 2_000,
    });

    expect(updated).toBe(true);
    expect(store.getEntries()).toEqual([
      {
        spokenIndex: 0,
        zhText: '你好世界',
        status: 'final',
        revisedAt: 2_000,
      },
    ]);
  });

  it('includes source text when bilingual display is enabled', () => {
    const store = new TranscriptStoreImpl();
    store.appendFinal(createZh({ sourceText: 'hello world' }), { showSourceText: true });

    expect(store.getEntries()[0]).toEqual({
      spokenIndex: 0,
      sourceText: 'hello world',
      zhText: '你好',
      status: 'final',
    });
  });

  it('reports empty state and blocks export when no finals exist', async () => {
    const store = new TranscriptStoreImpl();
    const writer: TextFileWriter = { writeFile: vi.fn() };

    expect(store.getState()).toBe('empty');
    expect(store.canExport()).toBe(false);
    await expect(store.exportToFile('out.txt', writer)).resolves.toEqual({
      ok: false,
      error: '无可导出的字幕',
    });
    expect(writer.writeFile).not.toHaveBeenCalled();
  });

  it('exports transcript text on success and retains entries on failure', async () => {
    const store = new TranscriptStoreImpl();
    store.appendFinal(createZh({ sourceText: 'hello', zhText: '你好' }), {
      showSourceText: true,
    });

    const writer: TextFileWriter = {
      writeFile: vi.fn().mockResolvedValue(undefined),
    };

    await expect(store.exportToFile('transcript.txt', writer)).resolves.toEqual({
      ok: true,
      path: 'transcript.txt',
    });
    expect(writer.writeFile).toHaveBeenCalledWith('transcript.txt', 'hello\n你好');

    const failingWriter: TextFileWriter = {
      writeFile: vi.fn().mockRejectedValue(new Error('disk full')),
    };
    await expect(store.exportToFile('transcript.txt', failingWriter)).resolves.toEqual({
      ok: false,
      error: 'disk full',
    });
    expect(store.getEntries()).toHaveLength(1);
  });

  it('creates a store via factory', () => {
    expect(createTranscriptStore()).toBeInstanceOf(TranscriptStoreImpl);
  });
});
