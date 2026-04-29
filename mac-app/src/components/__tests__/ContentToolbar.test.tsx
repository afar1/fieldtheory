import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ContentToolbar from '../ContentToolbar';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      accent: '#0f766e',
      border: '#d1d5db',
      text: '#111111',
      textSecondary: '#666666',
      success: '#16a34a',
      isDark: false,
    },
  }),
}));

describe('ContentToolbar', () => {
  it('shows a clicked state after copying the path', async () => {
    const onCopyPath = vi.fn(async () => {});

    render(
      <ContentToolbar
        showCopy={false}
        onCopyPath={onCopyPath}
      />
    );

    fireEvent.click(screen.getByLabelText('Copy file path (⌘C)'));

    await waitFor(() => {
      expect(onCopyPath).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText('Copied')).toBeTruthy();
    });
  });
});
