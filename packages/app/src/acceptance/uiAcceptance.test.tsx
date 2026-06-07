import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_LLM_SETTINGS } from '@lingua-live/core';
import { DEFAULT_UI_SETTINGS } from '../components/SettingsPanel.js';
import { SettingsPanel } from '../components/SettingsPanel.js';
import { SubtitleView } from '../components/SubtitleView.js';
import type { DisplaySubtitleLine } from '../lib/subtitleState.js';

describe('UI acceptance pass', () => {
  it('supports bilingual toggle, font sizes, and audio controls for each source kind', async () => {
    const user = userEvent.setup();
    const onSettingsChange = vi.fn();
    const onSourceKindChange = vi.fn();
    const onLlmSettingsChange = vi.fn();

    const { rerender } = render(
      <SettingsPanel
        open
        sourceKind="system"
        sourceLanguage="en"
        filePath=""
        settings={DEFAULT_UI_SETTINGS}
        llmSettings={DEFAULT_LLM_SETTINGS}
        sessionState="stopped"
        onClose={vi.fn()}
        onSourceKindChange={onSourceKindChange}
        onFilePathChange={vi.fn()}
        onSourceLanguageChange={vi.fn()}
        onSettingsChange={onSettingsChange}
        onLlmSettingsChange={onLlmSettingsChange}
      />,
    );

    await user.click(screen.getByLabelText('显示原文（双语）'));
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...DEFAULT_UI_SETTINGS,
      showSourceText: true,
    });

    await user.click(screen.getByRole('button', { name: '大' }));
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...DEFAULT_UI_SETTINGS,
      fontSizeLevel: 3,
    });

    await user.click(screen.getByLabelText('启用'));
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...DEFAULT_UI_SETTINGS,
      audioOutputEnabled: true,
    });

    await user.click(screen.getByLabelText('麦克风'));
    expect(onSourceKindChange).toHaveBeenCalledWith('microphone');

    await user.selectOptions(screen.getByLabelText('提供商'), 'deepseek');
    expect(onLlmSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'deepseek' }),
    );

    rerender(
      <SettingsPanel
        open
        sourceKind="file"
        sourceLanguage="en"
        filePath="/talk.wav"
        settings={DEFAULT_UI_SETTINGS}
        llmSettings={{ ...DEFAULT_LLM_SETTINGS, provider: 'deepseek', apiKey: 'sk-test' }}
        sessionState="stopped"
        onClose={vi.fn()}
        onSourceKindChange={onSourceKindChange}
        onFilePathChange={vi.fn()}
        onSourceLanguageChange={vi.fn()}
        onSettingsChange={onSettingsChange}
        onLlmSettingsChange={onLlmSettingsChange}
      />,
    );

    expect(screen.getByDisplayValue('/talk.wav')).toBeInTheDocument();
    await user.click(screen.getByLabelText('系统声音'));
    expect(onSourceKindChange).toHaveBeenCalledWith('system');
  });

  it('does not steal focus from provider select when parent re-renders', async () => {
    const user = userEvent.setup();
    const onLlmSettingsChange = vi.fn();
    const baseProps = {
      open: true,
      sourceKind: 'file' as const,
      sourceLanguage: 'en' as const,
      filePath: '',
      settings: DEFAULT_UI_SETTINGS,
      llmSettings: DEFAULT_LLM_SETTINGS,
      sessionState: 'stopped' as const,
      onSourceKindChange: vi.fn(),
      onFilePathChange: vi.fn(),
      onSourceLanguageChange: vi.fn(),
      onSettingsChange: vi.fn(),
      onLlmSettingsChange,
    };

    const { rerender } = render(<SettingsPanel {...baseProps} onClose={vi.fn()} />);
    const providerSelect = screen.getByLabelText('提供商');
    await user.click(providerSelect);

    rerender(<SettingsPanel {...baseProps} onClose={vi.fn()} />);

    expect(document.activeElement).toBe(providerSelect);
    await user.selectOptions(providerSelect, 'deepseek');
    expect(onLlmSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'deepseek' }),
    );
  });

  it('closes the settings dialog with Escape and exposes keyboard focus', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <SettingsPanel
        open
        sourceKind="file"
        sourceLanguage="en"
        filePath=""
        settings={DEFAULT_UI_SETTINGS}
        llmSettings={DEFAULT_LLM_SETTINGS}
        sessionState="stopped"
        onClose={onClose}
        onSourceKindChange={vi.fn()}
        onFilePathChange={vi.fn()}
        onSourceLanguageChange={vi.fn()}
        onSettingsChange={vi.fn()}
        onLlmSettingsChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: '设置' })).toHaveAttribute('aria-modal', 'true');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('announces new finals to screen readers and marks corrections without color alone', () => {
    const lines: DisplaySubtitleLine[] = [
      {
        id: 'seg-final',
        spokenIndex: 0,
        sourceText: 'large corpus',
        zhText: '大型语料库',
        status: 'final',
        untranslated: false,
        unrecognized: false,
      },
      {
        id: 'seg-corrected',
        spokenIndex: 1,
        sourceText: 'large corpus',
        zhText: '大型语料库',
        status: 'final',
        untranslated: false,
        unrecognized: false,
        revisedAt: Date.now(),
        showCorrectionHighlight: true,
      },
    ];

    const { container } = render(
      <SubtitleView lines={lines} showSourceText fontSizeLevel={2} />,
    );

    expect(container.querySelector('.sr-only')).toHaveTextContent('大型语料库');
    expect(screen.getByLabelText('已更正字幕：大型语料库')).toBeInTheDocument();
    expect(container.querySelector('.subtitle-view__line--corrected')).toBeTruthy();
    expect(screen.getByText('✎已更正')).toBeInTheDocument();
  });
});
