import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ContentModeToggleButton from '../ContentModeToggleButton';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      border: '#d1d5db',
      hoverBg: '#f3f4f6',
      textSecondary: '#666666',
    },
  }),
}));

describe('ContentModeToggleButton', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('keeps the existing rendered and markdown cycle by default', () => {
    const onSwitchToSource = vi.fn();
    const onSwitchToRendered = vi.fn();

    const { rerender } = render(
      <ContentModeToggleButton
        mode="rendered"
        onSwitchToSource={onSwitchToSource}
        onSwitchToRendered={onSwitchToRendered}
      />,
    );

    fireEvent.click(screen.getByLabelText('Switch to Markdown source'));
    expect(onSwitchToSource).toHaveBeenCalledTimes(1);

    rerender(
      <ContentModeToggleButton
        mode="markdown"
        onSwitchToSource={onSwitchToSource}
        onSwitchToRendered={onSwitchToRendered}
      />,
    );

    fireEvent.click(screen.getByLabelText('Switch to rendered view'));
    expect(onSwitchToRendered).toHaveBeenCalledTimes(1);
  });

  it('adds Typedown as the third cycle item only when enabled', () => {
    const onSwitchToSource = vi.fn();
    const onSwitchToRendered = vi.fn();
    const onSwitchToTypedown = vi.fn();

    const { rerender } = render(
      <ContentModeToggleButton
        mode="rendered"
        onSwitchToSource={onSwitchToSource}
        onSwitchToRendered={onSwitchToRendered}
        onSwitchToTypedown={onSwitchToTypedown}
        typedownEnabled
      />,
    );

    fireEvent.click(screen.getByLabelText('Switch to Markdown source'));
    expect(onSwitchToSource).toHaveBeenCalledTimes(1);

    rerender(
      <ContentModeToggleButton
        mode="markdown"
        onSwitchToSource={onSwitchToSource}
        onSwitchToRendered={onSwitchToRendered}
        onSwitchToTypedown={onSwitchToTypedown}
        typedownEnabled
      />,
    );

    fireEvent.click(screen.getByLabelText('Switch to Typedown'));
    expect(onSwitchToTypedown).toHaveBeenCalledTimes(1);

    rerender(
      <ContentModeToggleButton
        mode="typedown"
        onSwitchToSource={onSwitchToSource}
        onSwitchToRendered={onSwitchToRendered}
        onSwitchToTypedown={onSwitchToTypedown}
        typedownEnabled
      />,
    );

    fireEvent.click(screen.getByLabelText('Switch to rendered view'));
    expect(onSwitchToRendered).toHaveBeenCalledTimes(1);
  });
});
