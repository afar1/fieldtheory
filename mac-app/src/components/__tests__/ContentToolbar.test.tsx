import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ContentToolbar, { ContentToolbarMaxwellButton } from '../ContentToolbar';

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
    vi.useFakeTimers();
    const onCopyPath = vi.fn(async () => {});

    try {
      render(
        <ContentToolbar
          showCopy={false}
          onCopyPath={onCopyPath}
        />
      );

      await act(async () => {
        fireEvent.click(screen.getByLabelText('Copy file path (⌘C)'));
        await Promise.resolve();
      });

      expect(onCopyPath).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText('Copied')).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(1700);
      });

      expect(screen.getByLabelText('Copy file path (⌘C)')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
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

  it('can keep the center spacer in the renderer hit-test path', () => {
    const { container } = render(
      <ContentToolbar
        showCopy={false}
        dragSpacer={false}
      />
    );

    const spacer = container.querySelector('[data-content-toolbar-spacer]') as HTMLDivElement | null;
    expect((spacer?.style as CSSStyleDeclaration & { WebkitAppRegion?: string }).WebkitAppRegion).toBe('no-drag');
  });

  it('uses the Field Theory icon for Field Theory commands', () => {
    const { container } = render(
      <ContentToolbarMaxwellButton
        canAddCurrent
        items={[{
          id: 'maxwell-page',
          title: 'Maxwell Page',
          subtitle: 'Commands/Maxwell Page',
        }]}
      />
    );

    const fieldTheoryButton = screen.getByRole('button', { name: 'Field Theory' });
    expect(fieldTheoryButton.textContent).toBe('');
    expect(container.querySelector('img[src="/field-theory-icon-black.png"]')).toBeTruthy();
  });

  it('shows local command controls and can remove saved Field Theory pages', () => {
    const onRunItem = vi.fn();
    const onRemoveItem = vi.fn();
    const onVisitItem = vi.fn();

    render(
      <ContentToolbarMaxwellButton
        canAddCurrent
        items={[
          {
            id: 'z-page',
            title: 'Z Maxwell Page',
            subtitle: 'Commands/Z Maxwell Page',
          },
          {
            id: 'a-page',
            title: 'A Maxwell Page',
            subtitle: 'Commands/A Maxwell Page',
          },
        ]}
        onRunItem={onRunItem}
        onRemoveItem={onRemoveItem}
        onVisitItem={onVisitItem}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Field Theory' }));
    expect(screen.getByText('Run a local command')).toBeTruthy();
    expect(screen.getByText('Run a local command').parentElement?.style.width).toBe('max-content');
    expect(screen.getByText('A Maxwell Page').compareDocumentPosition(screen.getByText('Z Maxwell Page')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByText('Commands/A Maxwell Page')).toBeNull();
    fireEvent.click(screen.getAllByText('Run')[0]);
    expect(onRunItem).toHaveBeenCalledWith('a-page');

    fireEvent.click(screen.getByRole('button', { name: 'Field Theory' }));
    fireEvent.click(screen.getByLabelText('Open A Maxwell Page'));
    expect(onVisitItem).toHaveBeenCalledWith('a-page');

    fireEvent.click(screen.getByRole('button', { name: 'Field Theory' }));
    fireEvent.click(screen.getByLabelText('Remove A Maxwell Page from Field Theory'));
    expect(onRemoveItem).toHaveBeenCalledWith('a-page');
  });

  it('shows a lowercase add action without closing Field Theory commands', () => {
    const onAddCurrent = vi.fn();

    render(
      <ContentToolbarMaxwellButton
        canAddCurrent
        items={[]}
        onAddCurrent={onAddCurrent}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Field Theory' }));
    fireEvent.click(screen.getByText('add current page'));
    expect(onAddCurrent).toHaveBeenCalledTimes(1);
    expect(screen.getByText('No saved Field Theory pages yet.')).toBeTruthy();
  });

  it('shows remove-current when the current page is already saved in Field Theory commands', () => {
    const onRemoveItem = vi.fn();

    render(
      <ContentToolbarMaxwellButton
        canAddCurrent
        currentItemId="current-page"
        items={[{
          id: 'current-page',
          title: 'Current Page',
          subtitle: 'Commands/Current Page',
        }]}
        onRemoveItem={onRemoveItem}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Field Theory' }));
    fireEvent.click(screen.getByText('remove current page from Field Theory'));
    expect(onRemoveItem).toHaveBeenCalledWith('current-page');
  });
});
