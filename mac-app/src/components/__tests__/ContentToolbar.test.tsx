import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ContentToolbar from '../ContentToolbar';
import { PROSE_RENDERER_OPTIONS } from '../../utils/proseRenderer';

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

  it('shows prose renderer choices in the text style menu', () => {
    const onProseRendererChange = vi.fn();

    render(
      <ContentToolbar
        showCopy={false}
        proseRenderer="field-theory"
        proseRendererOptions={PROSE_RENDERER_OPTIONS}
        onProseRendererChange={onProseRendererChange}
      />
    );

    fireEvent.click(screen.getByLabelText('Text style'));
    fireEvent.click(screen.getByText('Prose'));

    expect(onProseRendererChange).toHaveBeenCalledWith('prose-ui');
  });

  it('reports when the text style menu opens and closes', async () => {
    const onTypographyMenuOpenChange = vi.fn();

    render(
      <ContentToolbar
        showCopy={false}
        showTextSize
        textSize="normal"
        onTextSizeChange={vi.fn()}
        onTypographyMenuOpenChange={onTypographyMenuOpenChange}
      />
    );

    onTypographyMenuOpenChange.mockClear();
    fireEvent.click(screen.getByLabelText('Text style'));

    await waitFor(() => {
      expect(onTypographyMenuOpenChange).toHaveBeenCalledWith(true);
    });

    fireEvent.mouseDown(document.body);

    await waitFor(() => {
      expect(onTypographyMenuOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('shows todo marker choices in the text style menu', () => {
    const onTodoMarkerChange = vi.fn();

    render(
      <ContentToolbar
        showCopy={false}
        todoMarker="circle"
        onTodoMarkerChange={onTodoMarkerChange}
      />
    );

    fireEvent.click(screen.getByLabelText('Text style'));
    fireEvent.click(screen.getByTitle('Square todo checkboxes'));

    expect(onTodoMarkerChange).toHaveBeenCalledWith('square');
  });
});
