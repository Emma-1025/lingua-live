import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DisplaySubtitleLine } from '../lib/subtitleState.js';
import { SubtitleView } from './SubtitleView.js';

const sampleLines: DisplaySubtitleLine[] = [
  {
    id: 'seg-1',
    spokenIndex: 0,
    sourceText: 'hello',
    zhText: '你好',
    status: 'final',
    untranslated: false,
    unrecognized: false,
  },
  {
    id: 'seg-2',
    spokenIndex: 1,
    sourceText: 'world',
    zhText: '',
    status: 'partial',
    untranslated: false,
    unrecognized: false,
  },
];

describe('SubtitleView', () => {
  it('renders lines in chronological order with an aria live region', () => {
    render(<SubtitleView lines={sampleLines} showSourceText={false} fontSizeLevel={2} />);

    const liveRegion = screen.getByRole('log');
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');

    const zhLines = screen.getAllByRole('article');
    expect(zhLines[0]).toHaveTextContent('你好');
    expect(zhLines[1]).toHaveTextContent('thinking...');
  });

  it('shows bilingual source lines when enabled', () => {
    render(<SubtitleView lines={sampleLines} showSourceText fontSizeLevel={2} />);
    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText('world')).toBeInTheDocument();
  });

  it('does not show the untranslated badge on partial lines', () => {
    render(
      <SubtitleView
        lines={[
          {
            id: 'seg-partial',
            spokenIndex: 0,
            sourceText: 'Welcome',
            zhText: 'Welcome',
            status: 'partial',
            untranslated: true,
            unrecognized: false,
          },
        ]}
        showSourceText={false}
        fontSizeLevel={2}
      />,
    );

    expect(screen.queryByText('未翻译')).not.toBeInTheDocument();
  });

  it('dims partial lines and shows fallback states', () => {
    const lines: DisplaySubtitleLine[] = [
      {
        id: 'seg-u',
        spokenIndex: 0,
        sourceText: '',
        zhText: '',
        status: 'final',
        untranslated: false,
        unrecognized: true,
      },
      {
        id: 'seg-t',
        spokenIndex: 1,
        sourceText: 'delay',
        zhText: 'delay',
        status: 'final',
        untranslated: true,
        unrecognized: false,
      },
      {
        id: 'seg-c',
        spokenIndex: 2,
        sourceText: 'corpus',
        zhText: '语料库',
        status: 'final',
        untranslated: false,
        unrecognized: false,
        showCorrectionHighlight: true,
      },
    ];

    const { container } = render(
      <SubtitleView lines={lines} showSourceText={false} fontSizeLevel={2} />,
    );

    expect(container.querySelector('.subtitle-view__line--partial')).toBeNull();
    expect(screen.getByText('（无法识别）')).toBeInTheDocument();
    expect(screen.getByText('未翻译')).toBeInTheDocument();
    expect(screen.getByText('✎已更正')).toBeInTheDocument();
  });

  it('announces finals through an assertive screen-reader region', () => {
    const { container, rerender } = render(
      <SubtitleView lines={[]} showSourceText={false} fontSizeLevel={2} />,
    );

    expect(container.querySelector('.sr-only')).toHaveAttribute('aria-live', 'assertive');

    rerender(
      <SubtitleView
        lines={[
          {
            id: 'seg-final',
            spokenIndex: 0,
            sourceText: 'hello',
            zhText: '你好',
            status: 'final',
            untranslated: false,
            unrecognized: false,
          },
        ]}
        showSourceText={false}
        fontSizeLevel={2}
      />,
    );

    expect(container.querySelector('.sr-only')).toHaveTextContent('你好');
  });

  it('applies the selected font-size level class', () => {
    const { container, rerender } = render(
      <SubtitleView lines={sampleLines} showSourceText={false} fontSizeLevel={1} />,
    );
    expect(container.firstChild).toHaveClass('subtitle-view--font-sm');

    rerender(<SubtitleView lines={sampleLines} showSourceText={false} fontSizeLevel={3} />);
    expect(container.firstChild).toHaveClass('subtitle-view--font-lg');
  });
});
