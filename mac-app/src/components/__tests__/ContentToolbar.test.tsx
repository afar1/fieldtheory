import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ContentToolbar, { ContentToolbarMaxwellButton, getContentToolbarProximityOpacity } from '../ContentToolbar';

const themeMock = vi.hoisted(() => ({
  value: {
    accent: '#0f766e',
    border: '#d1d5db',
    background: '#faf9f7',
    bgSecondary: '#f5f4f2',
    surface1: '#f5f4f2',
    surface2: '#ffffff',
    surface3: '#ffffff',
    text: '#111111',
    textSecondary: '#666666',
    success: '#16a34a',
    isDark: false,
  },
}));

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: themeMock.value,
  }),
}));

describe('ContentToolbar', () => {
  beforeEach(() => {
    themeMock.value = {
      accent: '#0f766e',
      border: '#d1d5db',
      background: '#faf9f7',
      bgSecondary: '#f5f4f2',
      surface1: '#f5f4f2',
      surface2: '#ffffff',
      surface3: '#ffffff',
      text: '#111111',
      textSecondary: '#666666',
      success: '#16a34a',
      isDark: false,
    };
  });

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

  it('dismisses toolbar dropdowns when their trigger is clicked again', () => {
    render(
      <ContentToolbar
        showCopy={false}
        showTextSize
        textSize="normal"
        onTextSizeChange={vi.fn()}
        onCopyPath={vi.fn()}
        maxwellCanAddCurrent
      />
    );

    const textStyleButton = screen.getByLabelText('Text style');
    fireEvent.click(textStyleButton);
    expect(document.querySelector('[data-content-toolbar-typography-menu]')).toBeTruthy();
    fireEvent.mouseDown(textStyleButton);
    fireEvent.click(textStyleButton);
    expect(document.querySelector('[data-content-toolbar-typography-menu]')).toBeNull();

    const customizeButton = screen.getByRole('button', { name: 'Customize toolbar' });
    fireEvent.click(customizeButton);
    expect(document.querySelector('[data-content-toolbar-customize-menu]')).toBeTruthy();
    fireEvent.mouseDown(customizeButton);
    fireEvent.click(customizeButton);
    expect(document.querySelector('[data-content-toolbar-customize-menu]')).toBeNull();

    const fieldTheoryButton = screen.getByRole('button', { name: 'Field Theory' });
    fireEvent.click(fieldTheoryButton);
    expect(screen.getByText('Local commands')).toBeTruthy();
    fireEvent.mouseDown(fieldTheoryButton);
    fireEvent.click(fieldTheoryButton);
    expect(screen.queryByText('Local commands')).toBeNull();
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

  it('dims the toolbar pill until the pointer gets close', () => {
    const rect = { left: 100, right: 200, top: 50, bottom: 90 };

    expect(getContentToolbarProximityOpacity({ pointerX: -20, pointerY: -20, rect })).toBe(0.6);
    expect(getContentToolbarProximityOpacity({ pointerX: 150, pointerY: 45, rect })).toBe(1);
    expect(getContentToolbarProximityOpacity({ pointerX: 150, pointerY: 140, rect })).toBeGreaterThan(0.6);
    expect(getContentToolbarProximityOpacity({ pointerX: 150, pointerY: 140, rect })).toBeLessThan(1);
  });

  it('renders the toolbar pill at reduced resting opacity without a border', () => {
    const { container } = render(
      <ContentToolbar
        showCopy={false}
        onCopyPath={vi.fn()}
      />
    );

    const pill = container.querySelector('[data-content-toolbar-pill]') as HTMLDivElement | null;
    expect(pill).not.toBeNull();
    expect(pill?.style.opacity).toBe('0.6');
    expect(pill?.style.border).toBe('1px solid transparent');
    expect(pill?.style.transform).toBe('scale(0.88)');

    fireEvent.pointerEnter(pill as HTMLDivElement);
    expect(pill?.style.opacity).toBe('1');
    expect(pill?.style.border).toBe('1px solid #d1d5db');
  });

  it('groups visible toolbar actions with fewer dividers when fewer groups are shown', () => {
    const { container, rerender } = render(
      <ContentToolbar
        showCopy={false}
        showTextSize
        textSize="normal"
        onTextSizeChange={vi.fn()}
        onCopyPath={vi.fn()}
        onToggleTerminal={vi.fn()}
        onMeetingClick={vi.fn()}
        maxwellCanAddCurrent
        onOpenAgent={vi.fn()}
        onOpenInNewWindow={vi.fn()}
        onSwitchContentMode={vi.fn()}
        onToggleFullScreen={vi.fn()}
      />
    );

    expect(container.querySelectorAll('[data-content-toolbar-divider]')).toHaveLength(3);

    rerender(
      <ContentToolbar
        showCopy={false}
        showTextSize
        textSize="normal"
        onTextSizeChange={vi.fn()}
        onCopyPath={vi.fn()}
      />
    );

    expect(container.querySelectorAll('[data-content-toolbar-divider]')).toHaveLength(1);
  });

  it('places the terminal button directly before immersive view', () => {
    render(
      <ContentToolbar
        showCopy={false}
        onToggleTerminal={vi.fn()}
        onToggleFullScreen={vi.fn()}
      />
    );

    const terminalButton = screen.getByRole('button', { name: 'Open Terminal' });
    const immersiveButton = screen.getByRole('button', { name: 'Enter immersive view' });
    expect(terminalButton.compareDocumentPosition(immersiveButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(terminalButton.nextElementSibling).toBe(immersiveButton);
  });

  it('keeps the active terminal button visible in dark mode', () => {
    themeMock.value = {
      ...themeMock.value,
      bgSecondary: '#151922',
      surface2: '#1f2937',
      surface3: '#111827',
      text: '#e5e7eb',
      textSecondary: '#9ca3af',
      border: '#374151',
      isDark: true,
    };

    render(
      <ContentToolbar
        showCopy={false}
        onToggleTerminal={vi.fn()}
        terminalVisible
      />
    );

    const terminalButton = screen.getByRole('button', { name: 'Close Terminal' });
    expect(terminalButton.style.backgroundColor).toBe('#111827');
    expect(terminalButton.style.color).toBe('#e5e7eb');
  });

  it('shows the content mode icon as a true rendered/markdown toggle', () => {
    const { rerender } = render(
      <ContentToolbar
        showCopy={false}
        onSwitchContentMode={vi.fn()}
        contentMode="rendered"
        contentModeTitle="Switch to Markdown source"
      />
    );

    const renderedButton = screen.getByRole('button', { name: 'Switch to Markdown source' });
    expect(renderedButton.querySelector('polyline')).toBeTruthy();
    expect(renderedButton.querySelectorAll('path')).toHaveLength(0);
    expect(renderedButton.style.backgroundColor).toBe('transparent');

    rerender(
      <ContentToolbar
        showCopy={false}
        onSwitchContentMode={vi.fn()}
        contentMode="markdown"
        contentModeTitle="Switch to rendered view"
      />
    );

    const markdownButton = screen.getByRole('button', { name: 'Switch to rendered view' });
    expect(markdownButton.querySelectorAll('path')).toHaveLength(3);
    expect(markdownButton.querySelector('polyline')).toBeNull();
    expect(markdownButton.style.backgroundColor).not.toBe('transparent');
  });

  it('aligns the Field Theory dropdown to the toolbar instead of its icon', async () => {
    const { container } = render(
      <ContentToolbar
        showCopy={false}
        maxwellCanAddCurrent
      />
    );

    const fieldTheoryButton = screen.getByRole('button', { name: 'Field Theory' });
    fireEvent.click(fieldTheoryButton);

    expect(fieldTheoryButton.parentElement?.style.position).toBe('');
    const menu = document.querySelector('[data-content-toolbar-maxwell-menu]') as HTMLDivElement;
    expect(menu.style.right).toBe('0px');
    await waitFor(() => {
      expect(container.querySelector('[data-content-toolbar-pill]')?.getAttribute('style')).toContain('opacity: 1');
    });
    expect(menu.style.zIndex).toBe('1002');
  });

  it('keeps delete in the overflow menu instead of the toolbar', () => {
    const onDelete = vi.fn();

    render(
      <ContentToolbar
        showCopy={false}
        onCopyPath={vi.fn()}
        showDelete
        onDelete={onDelete}
      />
    );

    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Customize toolbar' }));

    expect(screen.queryByRole('button', { name: 'Add Delete' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('keeps the customize dropdown surface fully opaque', () => {
    render(
      <ContentToolbar
        showCopy={false}
        onCopyPath={vi.fn()}
        onToggleTerminal={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Customize toolbar' }));

    const menu = document.querySelector('[data-content-toolbar-customize-menu]') as HTMLDivElement | null;
    expect(menu).not.toBeNull();
    expect(menu?.style.opacity).toBe('1');
    expect(menu?.style.backgroundColor).toBe('#f8f7f4');
    expect(menu?.style.zIndex).toBe('1002');
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

  it('keeps the Field Theory icon visible in dark mode', () => {
    themeMock.value = {
      ...themeMock.value,
      border: '#333842',
      background: '#15181e',
      bgSecondary: '#1c1f26',
      surface1: '#1c1f26',
      surface2: '#22262e',
      surface3: '#2a2e38',
      text: '#e8e8e8',
      textSecondary: '#a8a8a8',
      isDark: true,
    };

    const { container } = render(
      <ContentToolbarMaxwellButton
        canAddCurrent
        items={[]}
      />
    );

    const icon = container.querySelector('img[src="/field-theory-icon-black.png"]') as HTMLImageElement | null;
    expect(icon?.style.opacity).toBe('0.88');
    expect(icon?.style.filter).toBe('invert(1) brightness(1.35) contrast(1.08)');

    fireEvent.click(screen.getByRole('button', { name: 'Field Theory' }));
    expect(icon?.style.opacity).toBe('1');
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
    expect(screen.getByText('Local commands')).toBeTruthy();
    const menu = screen.getByText('Local commands').parentElement as HTMLDivElement;
    expect(menu.style.width).toBe('252px');
    expect(menu.style.maxWidth).toBe('min(252px, calc(100vw - 24px))');
    expect(menu.style.top).toBe('calc(100% + 10px)');
    expect(menu.style.right).toBe('0px');
    expect(menu.style.padding).toBe('5px');
    expect(menu.style.gap).toBe('2px');
    expect(menu.style.backgroundColor).toBe('#f8f7f4');
    expect(menu.style.borderRadius).toBe('8px');
    expect(menu.style.boxShadow).toBe('none');
    expect(screen.getByText('Local commands').style.textTransform).toBe('uppercase');
    expect(screen.getByText('A Maxwell Page').style.fontSize).toBe('13px');
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

  it('keeps text style controls inside a bounded menu grid', () => {
    const onBlinkTextCursorChange = vi.fn();
    const onRenderedTextCursorStyleChange = vi.fn();

    render(
      <ContentToolbar
        showCopy={false}
        typographyPreset="note"
        typographyPresetOptions={[
          { id: 'book', label: 'Book', title: 'Book font', fontFamily: 'Georgia, serif' },
          { id: 'note', label: 'Note', title: 'Note font', fontFamily: 'system-ui' },
          { id: 'draft', label: 'Draft', title: 'Draft font', fontFamily: 'monospace' },
        ]}
        onTypographyPresetChange={vi.fn()}
        showTextSize
        textSize="small"
        onTextSizeChange={vi.fn()}
        lineHeight="tight"
        lineHeightOptions={[
          { id: 'tight', label: 'Tight', title: 'Tight lines' },
          { id: 'normal', label: 'Normal', title: 'Normal lines' },
          { id: 'loose', label: 'Loose', title: 'Loose lines' },
        ]}
        onLineHeightChange={vi.fn()}
        unorderedListMarker="dash"
        onUnorderedListMarkerChange={vi.fn()}
        todoMarker="square"
        onTodoMarkerChange={vi.fn()}
        blinkTextCursor
        onBlinkTextCursorChange={onBlinkTextCursorChange}
        renderedTextCursorStyle="block"
        onRenderedTextCursorStyleChange={onRenderedTextCursorStyleChange}
      />
    );

    fireEvent.click(screen.getByLabelText('Text style'));

    const menu = document.querySelector('[data-content-toolbar-typography-menu]') as HTMLDivElement | null;
    const pill = document.querySelector('[data-content-toolbar-pill]') as HTMLDivElement | null;
    expect(menu).toBeTruthy();
    expect(pill?.contains(menu)).toBe(true);
    expect(menu?.style.top).toBe('calc(100% + 10px)');
    expect(menu?.style.right).toBe('0px');
    expect(menu?.style.width).toBe('286px');
    expect(menu?.style.padding).toBe('5px');
    expect(menu?.style.gap).toBe('2px');
    expect(menu?.style.transform).toBe('');
    expect(menu?.style.zIndex).toBe('1002');
    const control = screen.getByTitle('Book font').parentElement as HTMLDivElement;
    expect(control.style.display).toBe('grid');
    expect(control.style.gridAutoColumns).toBe('minmax(0, 1fr)');
    expect(control.closest('div[style*="grid-template-columns"]')?.getAttribute('style')).toContain('grid-template-columns: 52px minmax(0, 1fr)');
    expect((screen.getByTitle('Draft font') as HTMLButtonElement).style.minWidth).toBe('0');

    fireEvent.click(screen.getByTitle('Bar cursor'));
    expect(onRenderedTextCursorStyleChange).toHaveBeenCalledWith('bar');
    fireEvent.click(screen.getByTitle('Blinking cursor off'));
    expect(onBlinkTextCursorChange).toHaveBeenCalledWith(false);
  });
});
