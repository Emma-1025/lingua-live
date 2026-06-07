import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ControlPanel } from './ControlPanel.js';

describe('ControlPanel', () => {
  it('shows the live session state and latency warning chip', () => {
    const { rerender } = render(
      <ControlPanel
        sessionState="capturing"
        latencyWarning={false}
        onStart={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStop={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(screen.getByText('正在收听')).toBeInTheDocument();
    expect(screen.getByText('延迟正常')).toBeInTheDocument();

    rerender(
      <ControlPanel
        sessionState="capturing"
        latencyWarning
        onStart={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStop={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    expect(screen.getByText('延迟过高')).toBeInTheDocument();
  });

  it('disables invalid controls for the current state', () => {
    render(
      <ControlPanel
        sessionState="capturing"
        latencyWarning={false}
        onStart={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStop={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: '开始' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '暂停' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '继续' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '停止' })).toBeEnabled();
  });

  it('fires control handlers for enabled buttons', async () => {
    const user = userEvent.setup();
    const onPause = vi.fn();
    const onOpenSettings = vi.fn();

    render(
      <ControlPanel
        sessionState="capturing"
        latencyWarning={false}
        onStart={vi.fn()}
        onPause={onPause}
        onResume={vi.fn()}
        onStop={vi.fn()}
        onOpenSettings={onOpenSettings}
      />,
    );

    await user.click(screen.getByRole('button', { name: '暂停' }));
    await user.click(screen.getByRole('button', { name: '设置' }));
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('shows start errors as an alert', () => {
    render(
      <ControlPanel
        sessionState="stopped"
        latencyWarning={false}
        startError="未找到系统声音监视设备"
        onStart={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStop={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('未找到系统声音监视设备');
  });
});
