import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StopExportDialog } from './StopExportDialog.js';

describe('StopExportDialog', () => {
  it('shows export for populated transcripts', async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();

    render(
      <StopExportDialog
        open
        segmentCount={12}
        durationMs={125_000}
        canExport
        onExport={onExport}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(/共 12 条字幕/)).toBeInTheDocument();
    expect(screen.getByText(/2:05/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '导出文本 (.txt)' }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('shows empty state when no finals exist', () => {
    render(
      <StopExportDialog
        open
        segmentCount={0}
        durationMs={0}
        canExport={false}
        onExport={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('无可导出的字幕')).toBeInTheDocument();
  });

  it('keeps the dialog open and shows an error on export failure', () => {
    render(
      <StopExportDialog
        open
        segmentCount={3}
        durationMs={30_000}
        canExport
        exportError="导出失败：磁盘已满"
        onExport={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('导出失败：磁盘已满')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导出文本 (.txt)' })).toBeInTheDocument();
  });
});
