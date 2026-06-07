import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportTranscriptText } from './exportTranscript.js';

describe('exportTranscriptText', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('downloads transcript text in browser environments', async () => {
    const click = vi.fn();
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL,
    });
    vi.stubGlobal(
      'document',
      {
        createElement: vi.fn(() => ({ click, download: '', href: '' })),
      } as unknown as Document,
    );

    const result = await exportTranscriptText('你好\n\nHello');

    expect(result).toEqual({ ok: true });
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');
  });

  it('rejects empty transcript text', async () => {
    await expect(exportTranscriptText('   ')).resolves.toEqual({
      ok: false,
      error: '无可导出的字幕',
    });
  });
});
