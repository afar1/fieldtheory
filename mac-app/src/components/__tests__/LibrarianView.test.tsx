import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetBookmarksCacheForTests } from '../../services/bookmarksCache';
import LibrarianView, {
  getInlineGemmaLocalCommandRequest,
  getMaxwellToolbarRunMode,
  getLibraryDocumentDefaultContentMode,
  getLibraryDocumentViewKind,
  getHtmlPreviewSrcDoc,
  getLocalFileUrl,
  LIBRARIAN_HTML_LAYOUT_STORAGE_KEY,
  persistLibrarianHtmlLayoutByPath,
  restoreLibrarianHtmlLayoutByPath,
  resolveCurrentWikiCreateFolder,
  resolveLibrarianInitialSelection,
  getFocusChromeContentCenterX,
  getEditorSelectionBackgroundRect,
  getRenderedMarkdownDeleteShortcutEdit,
  getResponsivePanelState,
  hasActiveLibraryFileSelectionContext,
  shouldOpenMarkdownEditorLinkFromMouseDown,
  shouldSuppressRenderedMarkdownBoundaryDelete,
  shouldAnimateResponsiveSidebar,
  isLiveLibrarianRendererStoragePreferenceKey,
  restoreLibrarianLineNumbersMode,
  restoreLibrarianSidebarWidth,
  restoreLibrarianTextSize,
  shouldReportActiveLibraryFileContextForSelection,
  shouldPreserveEditorSelectionPastePopover,
} from '../LibrarianView';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      accent: '#0f766e',
      border: '#d1d5db',
      text: '#111111',
      textSecondary: '#666666',
      bg: '#ffffff',
      bgSecondary: '#f9fafb',
      bgTertiary: '#f3f4f6',
      surface1: '#ffffff',
      surface2: '#f9fafb',
      hoverBg: '#f3f4f6',
      inputBg: '#ffffff',
      isDark: false,
      glassEnabled: false,
    },
  }),
}));

vi.mock('../../supabaseClient', () => ({
  supabase: null,
}));

vi.mock('../AgentKickoffModal', () => ({
  default: () => null,
}));

vi.mock('../SketchView', () => ({
  default: ({ onSave, backgroundImage }: {
    onSave: (imageData: { dataUrl: string; width: number; height: number }) => void;
    backgroundImage?: { dataUrl: string; width: number; height: number } | null;
  }) => (
    <div data-testid="sketch-view" data-has-background={backgroundImage ? 'true' : 'false'}>
      <button
        type="button"
        onClick={() => onSave({ dataUrl: 'data:image/png;base64,drawn', width: 640, height: 480 })}
      >
        Save drawing
      </button>
    </div>
  ),
}));

describe('LibrarianView render', () => {
  type EditorSelectionSnapshot = Parameters<typeof shouldPreserveEditorSelectionPastePopover>[0]['latestEditorSnapshot'];
  const testLibraryRootPath = '/Users/afar/.fieldtheory/library';
  const expandedScratchpadFolders = JSON.stringify([
    `root:${testLibraryRootPath}`,
    `${testLibraryRootPath}::scratchpad`,
  ]);
  let toggleLineNumbersFromLauncher: (() => void) | null = null;

  it('keeps the selection paste popover alive for CodeMirror editor selections', () => {
    const editor = document.createElement('div');
    editor.className = 'cm-editor';
    const content = document.createElement('div');
    editor.appendChild(content);
    document.body.appendChild(editor);

    expect(shouldPreserveEditorSelectionPastePopover({
      activeElement: content,
      latestEditorSnapshot: {
        value: 'Send this to Codex',
        selectionStart: 0,
        selectionEnd: 4,
        isCollapsed: false,
      } as EditorSelectionSnapshot,
    })).toBe(true);
    expect(shouldPreserveEditorSelectionPastePopover({
      activeElement: content,
      latestEditorSnapshot: {
        value: '    ',
        selectionStart: 0,
        selectionEnd: 4,
        isCollapsed: false,
      } as EditorSelectionSnapshot,
    })).toBe(false);
  });

  it('skips active file context reports for collapsed caret-only updates', () => {
    expect(hasActiveLibraryFileSelectionContext(null)).toBe(false);
    expect(hasActiveLibraryFileSelectionContext({
      type: 'wiki',
      rootPath: '/library',
      relPath: 'note',
      filePath: '/library/note.md',
      title: 'Note',
      selectionStart: 4,
      selectionEnd: 4,
    })).toBe(false);
    expect(hasActiveLibraryFileSelectionContext({
      type: 'wiki',
      rootPath: '/library',
      relPath: 'note',
      filePath: '/library/note.md',
      title: 'Note',
      selectionStart: 4,
      selectionEnd: 8,
      selectionText: 'text',
    })).toBe(true);

    expect(shouldReportActiveLibraryFileContextForSelection({ isCollapsed: true }, false)).toBe(false);
    expect(shouldReportActiveLibraryFileContextForSelection({ isCollapsed: true }, true)).toBe(true);
    expect(shouldReportActiveLibraryFileContextForSelection({ isCollapsed: false }, false)).toBe(true);
  });

  it('uses the drawn CodeMirror selection bands when browser selection geometry is empty', () => {
    const root = document.createElement('div');
    const first = document.createElement('div');
    const second = document.createElement('div');
    first.className = 'cm-selectionBackground';
    second.className = 'cm-selectionBackground';
    first.getBoundingClientRect = vi.fn(() => ({
      width: 120,
      height: 24,
      left: 300,
      right: 420,
      top: 100,
      bottom: 124,
    } as DOMRect));
    second.getBoundingClientRect = vi.fn(() => ({
      width: 80,
      height: 24,
      left: 260,
      right: 340,
      top: 128,
      bottom: 152,
    } as DOMRect));
    root.append(first, second);

    expect(getEditorSelectionBackgroundRect(root)).toEqual({
      height: 52,
      left: 260,
      right: 420,
      top: 100,
    });
  });

  it('opens markdown source links on plain left click', () => {
    expect(shouldOpenMarkdownEditorLinkFromMouseDown({
      button: 0,
      metaKey: false,
      altKey: false,
      ctrlKey: false,
    })).toBe(true);
    expect(shouldOpenMarkdownEditorLinkFromMouseDown({
      button: 0,
      metaKey: true,
      altKey: false,
      ctrlKey: false,
    })).toBe(true);
    expect(shouldOpenMarkdownEditorLinkFromMouseDown({
      button: 0,
      metaKey: false,
      altKey: true,
      ctrlKey: false,
    })).toBe(false);
    expect(shouldOpenMarkdownEditorLinkFromMouseDown({
      button: 0,
      metaKey: false,
      altKey: false,
      ctrlKey: true,
    })).toBe(false);
    expect(shouldOpenMarkdownEditorLinkFromMouseDown({
      button: 1,
      metaKey: false,
      altKey: false,
      ctrlKey: false,
    })).toBe(false);
  });

  it('prefers the saved editor session over a stale last-selection on startup', () => {
    expect(resolveLibrarianInitialSelection(
      { type: 'wiki', relPath: 'briefs/Robin Poke-Style Prompt Readable Brief' },
      {
        itemType: 'wiki',
        itemPath: 'scratchpad/actual-last-file',
        contentMode: 'rendered',
        selectionStart: 0,
        selectionEnd: 0,
        scrollTop: 0,
      },
      false,
    )).toEqual({ type: 'wiki', relPath: 'scratchpad/actual-last-file' });
  });

  it('deletes rendered ft-html blocks as whole containers', () => {
    const value = 'Before\n\n```ft-html\n<section>Widget</section>\n```\n\nAfter';
    const blockStart = value.indexOf('```ft-html');
    const blockEnd = value.indexOf('```\n\nAfter') + 3;

    const selectedEdit = getRenderedMarkdownDeleteShortcutEdit({
      event: new KeyboardEvent('keydown', { key: 'Backspace' }),
      value,
      selectionStart: blockStart + 12,
      selectionEnd: blockStart + 20,
    });
    expect(selectedEdit).toMatchObject({
      nextValue: 'Before\n\nAfter',
      selectionStart: blockStart,
      selectionEnd: blockStart,
    });

    const adjacentEdit = getRenderedMarkdownDeleteShortcutEdit({
      event: new KeyboardEvent('keydown', { key: 'Delete' }),
      value,
      selectionStart: blockStart,
      selectionEnd: blockStart,
    });
    expect(adjacentEdit).toMatchObject({
      nextValue: 'Before\n\nAfter',
      selectionStart: blockStart,
      selectionEnd: blockStart,
    });
    expect(blockEnd).toBeGreaterThan(blockStart);
  });

  it('keeps Backspace at rendered heading and quote starts from deleting hidden syntax', () => {
    expect(shouldSuppressRenderedMarkdownBoundaryDelete('## Heading', 3, 3, 'Backspace')).toBe(true);
    expect(shouldSuppressRenderedMarkdownBoundaryDelete('> Quoted', 2, 2, 'Backspace')).toBe(true);
    expect(shouldSuppressRenderedMarkdownBoundaryDelete('Plain text', 5, 5, 'Backspace')).toBe(false);
  });

  function mockStoredWikiSelection(relPath: string, options: { expandScratchpad?: boolean } = {}): void {
    vi.mocked(window.localStorage.getItem).mockImplementation((key) => {
      if (key === 'librarian-last-selection') return JSON.stringify({ type: 'wiki', relPath });
      if (options.expandScratchpad && key === 'wiki-expanded-folders') return expandedScratchpadFolders;
      return null;
    });
  }

  it('classifies html and css library documents for the right default view', () => {
    expect(getLibraryDocumentViewKind('/tmp/report.html', 'external')).toBe('html');
    expect(getLibraryDocumentViewKind('/tmp/styles.css', 'external')).toBe('css');
    expect(getLibraryDocumentViewKind('/tmp/note.md', 'external')).toBe('markdown');
    expect(getLibraryDocumentDefaultContentMode('html')).toBe('rendered');
    expect(getLibraryDocumentDefaultContentMode('css')).toBe('markdown');
    expect(getLocalFileUrl('/tmp/Field Theory/report summary.html')).toBe('file:///tmp/Field%20Theory/report%20summary.html');
    expect(getHtmlPreviewSrcDoc('<head><title>x</title></head>', '/tmp/Field Theory/report.html')).toContain(
      '<head><base href="file:///tmp/Field%20Theory/"><title>x</title>',
    );
  });

  it('restores and persists html layout preferences by document path', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({
        '/tmp/full.html': 'full',
        '/tmp/contained.html': 'contained',
        '/tmp/invalid.html': 'wide',
      })),
      setItem: vi.fn(),
    };

    expect(restoreLibrarianHtmlLayoutByPath(storage)).toEqual({
      '/tmp/full.html': 'full',
      '/tmp/contained.html': 'contained',
    });

    persistLibrarianHtmlLayoutByPath(storage, { '/tmp/report.html': 'contained' });

    expect(storage.setItem).toHaveBeenCalledWith(
      LIBRARIAN_HTML_LAYOUT_STORAGE_KEY,
      JSON.stringify({ '/tmp/report.html': 'contained' }),
    );
  });

  it('recognizes live native renderer-storage preferences for mounted Library views', () => {
    const storage = {
      getItem: vi.fn((key: string) => {
        if (key === 'librarian-text-size') return 'large';
        if (key === 'fieldtheory-line-numbers') return 'faded';
        return null;
      }),
    };

    expect(restoreLibrarianTextSize(storage)).toBe('large');
    expect(restoreLibrarianLineNumbersMode(storage)).toBe('faded');
    expect(restoreLibrarianSidebarWidth({
      getItem: (key: string) => key === 'librarian-sidebar-width' ? '260' : null,
    })).toBe(260);
    expect(restoreLibrarianSidebarWidth({
      getItem: (key: string) => key === 'librarian-sidebar-width' ? '120' : null,
    })).toBe(180);
    expect(isLiveLibrarianRendererStoragePreferenceKey('librarian-text-size')).toBe(true);
    expect(isLiveLibrarianRendererStoragePreferenceKey('fieldtheory-line-numbers')).toBe(true);
    expect(isLiveLibrarianRendererStoragePreferenceKey('librarian-sidebar-width')).toBe(true);
    expect(isLiveLibrarianRendererStoragePreferenceKey('librarian-last-selection')).toBe(false);
    expect(isLiveLibrarianRendererStoragePreferenceKey('librarian-editor-session')).toBe(false);
  });

  it('resolves new wiki pages to the current folder or scratchpad', () => {
    expect(resolveCurrentWikiCreateFolder('wiki', 'projects/notes/plan')).toBe('projects/notes');
    expect(resolveCurrentWikiCreateFolder('wiki', 'loose-note')).toBe('scratchpad');
    expect(resolveCurrentWikiCreateFolder('artifact', null)).toBe('scratchpad');
  });

  it('centers focus chrome over the document area when the right terminal is open', () => {
    expect(getFocusChromeContentCenterX({
      readerLeft: 0,
      readerRight: 1200,
      terminalLeft: 700,
      terminalDockedRight: true,
      terminalVisible: true,
    })).toBe(350);
    expect(getFocusChromeContentCenterX({
      readerLeft: 0,
      readerRight: 1200,
      terminalLeft: 700,
      terminalDockedRight: false,
      terminalVisible: true,
    })).toBe(600);
  });

  it.each([
    {
      name: 'keeps wide layouts unchanged',
      containerWidth: 1200,
      expected: {
        autoCollapseSidebar: false,
        autoDockTerminalBottom: false,
        autoHideTerminal: false,
        reason: 'wide',
      },
    },
    {
      name: 'auto-collapses the sidebar before shrinking the editor',
      containerWidth: 1160,
      expected: {
        autoCollapseSidebar: true,
        autoDockTerminalBottom: false,
        autoHideTerminal: false,
        reason: 'sidebar',
      },
    },
    {
      name: 'auto-docks the terminal bottom before shrinking the editor',
      containerWidth: 990,
      expected: {
        autoCollapseSidebar: true,
        autoDockTerminalBottom: true,
        autoHideTerminal: false,
        reason: 'terminal-bottom',
      },
    },
  ])('derives responsive panel state: $name', ({ containerWidth, expected }) => {
    expect(getResponsivePanelState({
      containerWidth,
      containerHeight: 800,
      sidebarWidth: 180,
      sidebarCollapsed: false,
      sidebarForcedVisible: false,
      terminalVisible: true,
      terminalDockSide: 'right',
    })).toMatchObject(expected);
  });

  it('keeps responsive panel state stable near restore thresholds', () => {
    const previous = getResponsivePanelState({
      containerWidth: 1160,
      containerHeight: 800,
      sidebarWidth: 180,
      sidebarCollapsed: false,
      sidebarForcedVisible: false,
      terminalVisible: true,
      terminalDockSide: 'right',
    });

    expect(getResponsivePanelState({
      containerWidth: 1210,
      containerHeight: 800,
      sidebarWidth: 180,
      sidebarCollapsed: false,
      sidebarForcedVisible: false,
      terminalVisible: true,
      terminalDockSide: 'right',
      previous,
    })).toMatchObject({
      autoCollapseSidebar: true,
      reason: 'sidebar',
    });
  });

  it('keeps responsive panel state stable while the user is resizing a panel', () => {
    const previous = getResponsivePanelState({
      containerWidth: 1200,
      containerHeight: 800,
      sidebarWidth: 180,
      sidebarCollapsed: false,
      sidebarForcedVisible: false,
      terminalVisible: true,
      terminalDockSide: 'right',
    });

    expect(getResponsivePanelState({
      containerWidth: 880,
      containerHeight: 800,
      sidebarWidth: 180,
      sidebarCollapsed: false,
      sidebarForcedVisible: false,
      terminalVisible: true,
      terminalDockSide: 'right',
      userResizing: true,
      previous,
    })).toEqual(previous);
  });

  it('keeps the terminal on the right when an explicitly opened sidebar still leaves enough editor room', () => {
    expect(getResponsivePanelState({
      containerWidth: 1200,
      containerHeight: 800,
      sidebarWidth: 180,
      sidebarCollapsed: false,
      sidebarForcedVisible: false,
      terminalVisible: true,
      terminalDockSide: 'right',
      autoCollapseSidebarSuppressed: true,
    })).toMatchObject({
      autoCollapseSidebar: false,
      autoDockTerminalBottom: false,
      autoHideTerminal: false,
      reason: 'wide',
    });
  });

  it('bottom-docks the terminal when an explicitly opened sidebar consumes the side-by-side editor budget', () => {
    expect(getResponsivePanelState({
      containerWidth: 1160,
      containerHeight: 800,
      sidebarWidth: 180,
      sidebarCollapsed: false,
      sidebarForcedVisible: false,
      terminalVisible: true,
      terminalDockSide: 'right',
      autoCollapseSidebarSuppressed: true,
    })).toMatchObject({
      autoCollapseSidebar: true,
      autoDockTerminalBottom: true,
      autoHideTerminal: false,
      reason: 'terminal-bottom',
    });
  });

  it('animates sidebar auto-collapse unless the terminal also rearranges', () => {
    expect(shouldAnimateResponsiveSidebar({
      responsivePanelState: {
        autoCollapseSidebar: false,
        autoDockTerminalBottom: false,
        autoHideTerminal: false,
      },
      userResizing: false,
    })).toBe(true);

    expect(shouldAnimateResponsiveSidebar({
      responsivePanelState: {
        autoCollapseSidebar: true,
        autoDockTerminalBottom: false,
        autoHideTerminal: false,
      },
      userResizing: false,
    })).toBe(true);

    expect(shouldAnimateResponsiveSidebar({
      responsivePanelState: {
        autoCollapseSidebar: true,
        autoDockTerminalBottom: true,
        autoHideTerminal: false,
      },
      userResizing: false,
    })).toBe(false);
  });

  it('does not auto-collapse the sidebar when it is needed for empty selection', () => {
    expect(getResponsivePanelState({
      containerWidth: 880,
      containerHeight: 800,
      sidebarWidth: 180,
      sidebarCollapsed: false,
      sidebarForcedVisible: true,
      terminalVisible: true,
      terminalDockSide: 'right',
    })).toMatchObject({
      autoCollapseSidebar: false,
      reason: 'forced-sidebar',
    });
  });

  it('auto-hides the terminal only as the narrowest responsive fallback', () => {
    expect(getResponsivePanelState({
      containerWidth: 520,
      containerHeight: 800,
      sidebarWidth: 180,
      sidebarCollapsed: true,
      sidebarForcedVisible: false,
      terminalVisible: true,
      terminalDockSide: 'right',
    })).toMatchObject({
      autoHideTerminal: true,
      reason: 'terminal-hidden',
    });
  });

  it('opens a command-clicked sidebar file in a document window and clears the source selection', async () => {
    const relPath = 'scratchpad/popout-note';
    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'wiki-expanded-folders' ? expandedScratchpadFolders : null
    ));
    vi.mocked(window.libraryAPI!.getRoots).mockResolvedValue([{
      path: testLibraryRootPath,
      label: 'Library',
      builtin: true,
      tree: [{
        kind: 'dir' as const,
        name: 'scratchpad',
        relPath: 'scratchpad',
        children: [{
          kind: 'file' as const,
          relPath,
          absPath: `${testLibraryRootPath}/${relPath}.md`,
          name: 'popout-note',
          title: 'Popout Note',
          lastUpdated: 1,
        }],
      }],
    }]);
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue({
      relPath,
      absPath: `${testLibraryRootPath}/${relPath}.md`,
      name: 'popout-note',
      title: 'Popout Note',
      lastUpdated: 1,
      content: 'Popout body',
      documentVersion: { mtimeMs: 1, size: 11, sha256: 'popout' },
    });

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const row = await screen.findByText('Popout Note');
    fireEvent.click(row);
    await screen.findByText('Popout body');

    fireEvent.click(row, { metaKey: true });

    await waitFor(() => {
      expect(window.libraryAPI!.openDocumentWindow).toHaveBeenCalledWith({ kind: 'wiki', path: relPath, contentMode: 'rendered', sidebarCollapsed: true });
    });
    expect(await screen.findByText('Select a file')).toBeTruthy();
  });

  it('keeps the current source document when command-clicking a different sidebar file into a document window', async () => {
    const currentRelPath = 'scratchpad/current-note';
    const popoutRelPath = 'scratchpad/other-note';
    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'wiki-expanded-folders' ? expandedScratchpadFolders : null
    ));
    vi.mocked(window.libraryAPI!.getRoots).mockResolvedValue([{
      path: testLibraryRootPath,
      label: 'Library',
      builtin: true,
      tree: [{
        kind: 'dir' as const,
        name: 'scratchpad',
        relPath: 'scratchpad',
        children: [
          {
            kind: 'file' as const,
            relPath: currentRelPath,
            absPath: `${testLibraryRootPath}/${currentRelPath}.md`,
            name: 'current-note',
            title: 'Current Note',
            lastUpdated: 1,
          },
          {
            kind: 'file' as const,
            relPath: popoutRelPath,
            absPath: `${testLibraryRootPath}/${popoutRelPath}.md`,
            name: 'other-note',
            title: 'Other Note',
            lastUpdated: 2,
          },
        ],
      }],
    }]);
    vi.mocked(window.wikiAPI!.getPage).mockImplementation(async (relPath) => {
      if (relPath === currentRelPath) {
        return {
          relPath: currentRelPath,
          absPath: `${testLibraryRootPath}/${currentRelPath}.md`,
          name: 'current-note',
          title: 'Current Note',
          lastUpdated: 1,
          content: 'Current body',
          documentVersion: { mtimeMs: 1, size: 12, sha256: 'current' },
        };
      }
      if (relPath === popoutRelPath) {
        return {
          relPath: popoutRelPath,
          absPath: `${testLibraryRootPath}/${popoutRelPath}.md`,
          name: 'other-note',
          title: 'Other Note',
          lastUpdated: 2,
          content: 'Other body',
          documentVersion: { mtimeMs: 2, size: 10, sha256: 'other' },
        };
      }
      return null;
    });

    render(
      <LibrarianView
        sidebarCollapsed={false}
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{ kind: 'wiki', path: currentRelPath, contentMode: 'rendered' }}
      />
    );

    await screen.findByText('Current body');
    fireEvent.click(await screen.findByText('Other Note'), { metaKey: true });

    await waitFor(() => {
      expect(window.libraryAPI!.openDocumentWindow).toHaveBeenCalledWith({ kind: 'wiki', path: popoutRelPath, contentMode: 'rendered', sidebarCollapsed: true });
    });
    expect(screen.getByText('Current body')).toBeTruthy();
    expect(screen.queryByText('Select a file')).toBeNull();
  });

  it('keeps an initial wiki target from being replaced by the default artifact', async () => {
    const relPath = 'scratchpad/right-click-target';
    vi.mocked(window.librarianAPI!.getReadings).mockResolvedValue([{
      path: '/tmp/library/first-artifact.md',
      title: 'first-artifact.md',
      context: null,
      readingTime: null,
      modelSignature: null,
      createdAt: 0,
      mtime: 0,
    }]);
    vi.mocked(window.librarianAPI!.getReading).mockResolvedValue({
      path: '/tmp/library/first-artifact.md',
      title: 'first-artifact.md',
      context: null,
      readingTime: null,
      modelSignature: null,
      createdAt: 0,
      mtime: 0,
      content: 'Wrong artifact body',
      documentVersion: { mtimeMs: 1, size: 19, sha256: 'artifact' },
    });
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue({
      relPath,
      absPath: `${testLibraryRootPath}/${relPath}.md`,
      name: 'right-click-target',
      title: 'Right Click Target',
      lastUpdated: 1,
      content: 'Correct wiki body',
      documentVersion: { mtimeMs: 1, size: 17, sha256: 'wiki' },
    });

    const { rerender } = render(
      <LibrarianView
        sidebarCollapsed={false}
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{ kind: 'wiki', path: relPath, contentMode: 'rendered' }}
      />
    );

    expect(await screen.findByText('Correct wiki body')).toBeTruthy();
    await waitFor(() => {
      expect(window.librarianAPI!.getReadings).toHaveBeenCalled();
    });
    rerender(
      <LibrarianView
        sidebarCollapsed={false}
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={null}
      />
    );
    expect(screen.queryByText('Wrong artifact body')).toBeNull();
    expect(screen.getByText('Correct wiki body')).toBeTruthy();
  });

  it('shows the active file title in the toolbar after scrolling the document', async () => {
    const relPath = 'scratchpad/scrolled-title';
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue({
      relPath,
      absPath: `${testLibraryRootPath}/${relPath}.md`,
      name: 'scrolled-title',
      title: 'Scrolled Title',
      lastUpdated: 1,
      content: Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n\n'),
      documentVersion: { mtimeMs: 1, size: 300, sha256: 'scrolled-title' },
    });

    const { container } = render(
      <LibrarianView
        sidebarCollapsed={false}
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{ kind: 'wiki', path: relPath, contentMode: 'rendered' }}
      />
    );

    await screen.findByText('line 1');
    expect(container.querySelector('[data-ft-active-document-scrolled-title="true"]')).toBeNull();
    const scrollEl = container.querySelector('[data-ft-librarian-content-scroll="true"]') as HTMLDivElement;
    Object.defineProperty(scrollEl, 'scrollTop', { configurable: true, value: 48 });
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 1200 });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 600 });

    fireEvent.scroll(scrollEl);

    await waitFor(() => {
      expect(container.querySelector('[data-ft-active-document-scrolled-title="true"]')?.textContent).toBe('Scrolled Title');
    });
    expect(container.querySelector('[data-ft-active-document-identity="true"]')?.textContent).toContain('scratchpad');
    const topFade = container.querySelector('[data-ft-reader-top-fade="true"]') as HTMLElement;
    expect(topFade.style.height).toBe('58px');
    expect(topFade.style.background).toContain('8%');
    expect(topFade.style.maskImage).toContain('10%');
  });

  it('keeps the scrolled file title visible in fullscreen focus chrome', async () => {
    const relPath = 'scratchpad/fullscreen-scrolled-title';
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue({
      relPath,
      absPath: `${testLibraryRootPath}/${relPath}.md`,
      name: 'fullscreen-scrolled-title',
      title: 'Fullscreen Scrolled Title',
      lastUpdated: 1,
      content: Array.from({ length: 40 }, (_, index) => `fullscreen line ${index + 1}`).join('\n\n'),
      documentVersion: { mtimeMs: 1, size: 400, sha256: 'fullscreen-scrolled-title' },
    });

    const { container } = render(
      <LibrarianView
        sidebarCollapsed
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{ kind: 'wiki', path: relPath, contentMode: 'rendered' }}
        focusChromeEnabled
      />
    );

    await screen.findByText('fullscreen line 1');
    const scrollEl = container.querySelector('[data-ft-librarian-content-scroll="true"]') as HTMLDivElement;
    Object.defineProperty(scrollEl, 'scrollTop', { configurable: true, value: 48 });
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 1200 });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 600 });

    fireEvent.scroll(scrollEl);

    await waitFor(() => {
      expect(container.querySelector('[data-ft-active-document-scrolled-title="true"]')?.textContent).toBe('Fullscreen Scrolled Title');
    });
    expect(container.querySelector('[data-ft-active-document-identity="true"]')?.textContent).toContain('scratchpad');
    const topFade = container.querySelector('[data-ft-reader-top-fade="true"]') as HTMLElement;
    expect(topFade.style.top).toBe('0px');
    expect(topFade.style.right).toBe('14px');
    expect(topFade.style.height).toBe('96px');
    expect(topFade.style.background).toContain('18%');
    expect(topFade.style.maskImage).toContain('22%');
    expect(topFade.style.opacity).toBe('0.72');
    expect(scrollEl.style.scrollbarGutter).toBe('stable');
  });

  it('resamples rendered top fade after scroll geometry settles', async () => {
    const relPath = 'scratchpad/settled-top-fade';
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue({
      relPath,
      absPath: `${testLibraryRootPath}/${relPath}.md`,
      name: 'settled-top-fade',
      title: 'Settled Top Fade',
      lastUpdated: 1,
      content: Array.from({ length: 40 }, (_, index) => `settled line ${index + 1}`).join('\n\n'),
      documentVersion: { mtimeMs: 1, size: 400, sha256: 'settled-top-fade' },
    });

    const { container } = render(
      <LibrarianView
        sidebarCollapsed
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{ kind: 'wiki', path: relPath, contentMode: 'rendered' }}
        focusChromeEnabled
      />
    );

    await screen.findByText('settled line 1');
    const scrollEl = container.querySelector('[data-ft-librarian-content-scroll="true"]') as HTMLDivElement;
    Object.defineProperty(scrollEl, 'scrollTop', { configurable: true, value: 48 });
    Object.defineProperty(scrollEl, 'scrollHeight', { configurable: true, value: 1200 });
    Object.defineProperty(scrollEl, 'clientHeight', { configurable: true, value: 600 });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 90));
    });

    const topFade = container.querySelector('[data-ft-reader-top-fade="true"]') as HTMLElement;
    expect(topFade.style.opacity).toBe('0.72');
  });

  it('keeps the source selection when a document window fails to open', async () => {
    const relPath = 'scratchpad/popout-failure';
    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'wiki-expanded-folders' ? expandedScratchpadFolders : null
    ));
    vi.mocked(window.libraryAPI!.openDocumentWindow).mockResolvedValue({ success: false, error: 'failed' });
    vi.mocked(window.libraryAPI!.getRoots).mockResolvedValue([{
      path: testLibraryRootPath,
      label: 'Library',
      builtin: true,
      tree: [{
        kind: 'dir' as const,
        name: 'scratchpad',
        relPath: 'scratchpad',
        children: [{
          kind: 'file' as const,
          relPath,
          absPath: `${testLibraryRootPath}/${relPath}.md`,
          name: 'popout-failure',
          title: 'Popout Failure',
          lastUpdated: 1,
        }],
      }],
    }]);
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue({
      relPath,
      absPath: `${testLibraryRootPath}/${relPath}.md`,
      name: 'popout-failure',
      title: 'Popout Failure',
      lastUpdated: 1,
      content: 'Still selected',
      documentVersion: { mtimeMs: 1, size: 14, sha256: 'failure' },
    });

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const row = await screen.findByText('Popout Failure');
    fireEvent.click(row);
    await screen.findByText('Still selected');

    fireEvent.click(row, { metaKey: true });

    await waitFor(() => {
      expect(window.libraryAPI!.openDocumentWindow).toHaveBeenCalledWith({ kind: 'wiki', path: relPath, contentMode: 'rendered', sidebarCollapsed: true });
    });
    expect(screen.getByText('Still selected')).toBeTruthy();
    expect(screen.queryByText('Select a file')).toBeNull();
  });

  it('offers a sidebar context menu action for opening a file in a document window', async () => {
    const relPath = 'scratchpad/context-popout';
    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'wiki-expanded-folders' ? expandedScratchpadFolders : null
    ));
    vi.mocked(window.libraryAPI!.getRoots).mockResolvedValue([{
      path: testLibraryRootPath,
      label: 'Library',
      builtin: true,
      tree: [{
        kind: 'dir' as const,
        name: 'scratchpad',
        relPath: 'scratchpad',
        children: [{
          kind: 'file' as const,
          relPath,
          absPath: `${testLibraryRootPath}/${relPath}.md`,
          name: 'context-popout',
          title: 'Context Popout',
          lastUpdated: 1,
        }],
      }],
    }]);

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const row = await screen.findByText('Context Popout');
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByRole('button', { name: 'Open in New Window' }));

    await waitFor(() => {
      expect(window.libraryAPI!.openDocumentWindow).toHaveBeenCalledWith({ kind: 'wiki', path: relPath, contentMode: 'rendered' });
    });
  });

  it('creates a command-shift-n page in the current wiki folder as a document window', async () => {
    const selectedRelPath = 'projects/current-note';
    const createdRelPath = 'projects/new-page';
    mockStoredWikiSelection(selectedRelPath);
    vi.mocked(window.libraryAPI!.getRoots).mockResolvedValue([{
      path: testLibraryRootPath,
      label: 'Library',
      builtin: true,
      tree: [{
        kind: 'dir' as const,
        name: 'projects',
        relPath: 'projects',
        children: [{
          kind: 'file' as const,
          relPath: selectedRelPath,
          absPath: `${testLibraryRootPath}/${selectedRelPath}.md`,
          name: 'current-note',
          title: 'Current Note',
          lastUpdated: 1,
        }],
      }],
    }]);
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue({
      relPath: selectedRelPath,
      absPath: `${testLibraryRootPath}/${selectedRelPath}.md`,
      name: 'current-note',
      title: 'Current Note',
      lastUpdated: 1,
      content: 'Current body',
      documentVersion: { mtimeMs: 1, size: 12, sha256: 'current' },
    });
    vi.mocked(window.wikiAPI!.createFileWithDefaultTitle).mockResolvedValue({
      relPath: createdRelPath,
      absPath: `${testLibraryRootPath}/${createdRelPath}.md`,
      name: 'new-page',
      title: 'New Page',
      lastUpdated: 2,
      content: '',
      documentVersion: { mtimeMs: 2, size: 0, sha256: 'new' },
    });

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    await screen.findByText('Current body');
    fireEvent.keyDown(window, { key: 'n', metaKey: true, shiftKey: true });

    await waitFor(() => {
      expect(window.wikiAPI!.createFileWithDefaultTitle).toHaveBeenCalledWith('projects');
      expect(window.libraryAPI!.openDocumentWindow).toHaveBeenCalledWith({ kind: 'wiki', path: createdRelPath, contentMode: 'rendered' });
    });
    expect(await screen.findByText('Select a file')).toBeTruthy();
  });

  it('ignores rapid repeated sidebar default-create clicks for the same folder', async () => {
    const createdRelPath = 'Handoff/new-page';
    vi.mocked(window.libraryAPI!.getRoots).mockResolvedValue([{
      path: testLibraryRootPath,
      label: 'Library',
      builtin: true,
      tree: [{
        kind: 'dir' as const,
        name: 'Handoff',
        relPath: 'Handoff',
        children: [],
      }],
    }]);

    let resolveCreate: ((page: WikiPage) => void) | null = null;
    vi.mocked(window.wikiAPI!.createFileWithDefaultTitle).mockImplementation(() => new Promise((resolve) => {
      resolveCreate = resolve;
    }));

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const createButton = await screen.findByRole('button', { name: 'New file in Handoff' });
    expect(createButton.style.opacity).toBe('');
    fireEvent.click(createButton);
    fireEvent.click(createButton);

    expect(window.wikiAPI!.createFileWithDefaultTitle).toHaveBeenCalledTimes(1);
    expect(window.wikiAPI!.createFileWithDefaultTitle).toHaveBeenCalledWith('Handoff');

    act(() => {
      resolveCreate?.({
        relPath: createdRelPath,
        absPath: `${testLibraryRootPath}/${createdRelPath}.md`,
        name: 'new-page',
        title: 'New Page',
        lastUpdated: 2,
        content: '',
        documentVersion: { mtimeMs: 2, size: 0, sha256: 'new' },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('New Page')).toBeTruthy();
    });
  });

  it('uses document-style floating sidebar behavior for Bookmarks immersive mode', async () => {
    Object.defineProperty(window, 'bookmarksAPI', {
      configurable: true,
      value: {
        getAll: vi.fn(async () => ({
          bookmarks: [{ id: 'bookmark-1', text: 'Saved bookmark', folders: [] }],
          folders: [],
          xLastSyncedAt: null,
        })),
        onChanged: vi.fn(() => () => {}),
        syncIfStale: vi.fn(async () => ({ status: 'fresh' })),
      },
    });

    function BookmarksHarness() {
      const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
      const [focusChromeEnabled, setFocusChromeEnabled] = useState(false);

      return (
        <LibrarianView
          sidebarCollapsed={sidebarCollapsed}
          focusChromeEnabled={focusChromeEnabled}
          onFocusChromeEnabledChange={setFocusChromeEnabled}
          onFocusChromeShortcut={() => {
            setFocusChromeEnabled(true);
            setSidebarCollapsed(true);
          }}
          onSwitchToClipboard={vi.fn()}
          initialOpenTarget={{ kind: 'bookmarks', path: 'bookmarks' }}
        />
      );
    }

    const { container } = render(<BookmarksHarness />);

    await waitFor(() => {
      expect(window.bookmarksAPI!.getAll).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enter immersive view' }));

    const root = container.firstElementChild as HTMLElement;
    const getHoverStrip = () => root.querySelector(
      '[data-fieldtheory-collapsed-sidebar-hover-strip="true"]'
    ) as HTMLElement | null;
    const getSidebarPane = () => root.querySelector(
      '[data-fieldtheory-collapsed-sidebar-pane="true"]'
    ) as HTMLElement | null;
    const getDismissShield = () => root.querySelector(
      '[data-fieldtheory-bookmarks-sidebar-dismiss-shield="true"]'
    ) as HTMLElement | null;

    await waitFor(() => {
      expect(getHoverStrip()).toBeTruthy();
    });
    expect(getHoverStrip()?.style.width).toBe('30px');

    fireEvent.click(getHoverStrip()!);
    expect(getHoverStrip()).toBeNull();
    expect(getSidebarPane()?.style.boxShadow).toContain('12px 0 24px');
    expect(getDismissShield()).toBeTruthy();

    fireEvent.mouseDown(getDismissShield()!);
    expect(getHoverStrip()).toBeTruthy();
    expect(getDismissShield()).toBeNull();
  });

  it('lets Bookmarks collapse the sidebar like a selected document', async () => {
    Object.defineProperty(window, 'bookmarksAPI', {
      configurable: true,
      value: {
        getAll: vi.fn(async () => ({
          bookmarks: [{ id: 'bookmark-1', text: 'Saved bookmark', folders: [] }],
          folders: [],
          xLastSyncedAt: null,
        })),
        onChanged: vi.fn(() => () => {}),
        syncIfStale: vi.fn(async () => ({ status: 'fresh' })),
      },
    });

    const { container } = render(<LibrarianView browserLibrarySurface sidebarCollapsed onSwitchToClipboard={vi.fn()} />);
    const root = container.firstElementChild as HTMLElement;
    const getHoverStrip = () => root.querySelector(
      '[data-fieldtheory-collapsed-sidebar-hover-strip="true"]'
    ) as HTMLElement | null;
    const getSidebarPane = () => root.querySelector(
      '[data-fieldtheory-collapsed-sidebar-pane="true"]'
    ) as HTMLElement | null;

    fireEvent.click(await screen.findByText('Bookmarks'));

    await waitFor(() => {
      expect(window.bookmarksAPI!.getAll).toHaveBeenCalled();
    });
    expect(getSidebarPane()?.style.width).toBe('0px');
    expect(getHoverStrip()).toBeTruthy();
  });

  it('uses focus chrome proximity for the standalone immersive button and native window buttons', async () => {
    const relPath = 'scratchpad/focus-chrome';
    mockStoredWikiSelection(relPath);
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue({
      relPath,
      absPath: `${testLibraryRootPath}/${relPath}.md`,
      name: 'focus-chrome',
      title: 'Focus Chrome',
      lastUpdated: 1,
      content: 'Focus body',
      documentVersion: { mtimeMs: 1, size: 10, sha256: 'focus-chrome' },
    });

    const { rerender, unmount } = render(
      <LibrarianView
        sidebarCollapsed
        focusChromeEnabled
        focusChromeGroupOpacity={0}
        onSwitchToClipboard={vi.fn()}
      />,
    );

    await screen.findByText('Focus body');
    const immersiveButton = screen.getByRole('button', { name: 'Exit immersive view' });
    expect((immersiveButton.parentElement as HTMLElement).style.opacity).toBe('0.6');
    await waitFor(() => {
      expect(window.librarianAPI!.setWindowButtonVisibility).toHaveBeenLastCalledWith(false);
    });

    rerender(
      <LibrarianView
        sidebarCollapsed
        focusChromeEnabled
        focusChromeGroupOpacity={1}
        onSwitchToClipboard={vi.fn()}
      />,
    );

    expect((immersiveButton.parentElement as HTMLElement).style.opacity).toBe('1');
    await waitFor(() => {
      expect(window.librarianAPI!.setWindowButtonVisibility).toHaveBeenLastCalledWith(true);
    });

    unmount();
    expect(window.librarianAPI!.setWindowButtonVisibility).toHaveBeenLastCalledWith(true);
  });

  function pasteText(target: HTMLElement, text: string): void {
    fireEvent.paste(target, {
      clipboardData: {
        getData: (type: string) => (type === 'text/plain' || type === 'text' ? text : ''),
        files: [],
        items: [],
      },
    });
  }

  function pasteImage(target: HTMLElement): void {
    fireEvent.paste(target, {
      clipboardData: {
        getData: () => '',
        files: [],
        items: [{ kind: 'file', type: 'image/png' }],
      },
    });
  }

  function pasteImageFile(target: HTMLElement, file: File): void {
    fireEvent.paste(target, {
      clipboardData: {
        getData: () => '',
        files: [file],
        items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
      },
    });
  }

  beforeEach(() => {
    toggleLineNumbersFromLauncher = null;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
    });
    Object.defineProperty(window, 'librarianAPI', {
      configurable: true,
      value: {
        isMutedForToday: vi.fn(async () => false),
        setImmersiveDismissable: vi.fn(),
        setSizeKey: vi.fn(),
        discoverLibrarianDirs: vi.fn(async () => []),
        isSetupComplete: vi.fn(async () => true),
        getReadings: vi.fn(async () => [{
          path: '/tmp/library/example.md',
          title: 'example.md',
          context: null,
          readingTime: null,
          modelSignature: null,
          createdAt: 0,
          mtime: 0,
        }]),
        getReading: vi.fn(async () => null),
        getShareStatus: vi.fn(async () => null),
        onInsertMarkdownText: vi.fn(() => () => {}),
        onInsertPlainMarkdownText: vi.fn(() => () => {}),
        onShowReading: vi.fn(() => () => {}),
        onReadingAdded: vi.fn(() => () => {}),
        onReadingUpdated: vi.fn(() => () => {}),
        onReadingRenamed: vi.fn(() => () => {}),
        onReadingRemoved: vi.fn(() => () => {}),
        onSetFullscreen: vi.fn(() => () => {}),
        setMarkdownEditorFocused: vi.fn(),
        setWindowButtonVisibility: vi.fn(),
      },
    });
    Object.defineProperty(window, 'wikiAPI', {
      configurable: true,
      value: {
        getTree: vi.fn(async () => []),
        getPage: vi.fn(async () => null),
        save: vi.fn(async () => null),
        createFile: vi.fn(async () => null),
        createFileWithDefaultTitle: vi.fn(async () => null),
        deletePage: vi.fn(async () => false),
        onPageChanged: vi.fn(() => () => {}),
        onPageDeleted: vi.fn(() => () => {}),
        onPageRenamed: vi.fn(() => () => {}),
        onOpenWikiPage: vi.fn(() => () => {}),
      },
    });
    Object.defineProperty(window, 'commandsAPI', {
      configurable: true,
      value: {
        getCommands: vi.fn(async () => []),
        getCommandByPath: vi.fn(async () => null),
        onCommandsChanged: vi.fn(() => () => {}),
        runLocalCommand: vi.fn(async () => ({ success: true })),
        setActiveLibraryFileContext: vi.fn(),
        startMeetingHere: vi.fn(async () => ({ success: true, session: null })),
        stopMeeting: vi.fn(async () => ({ success: true, session: null })),
        getActiveMeeting: vi.fn(async () => null),
        onMeetingStatus: vi.fn(() => () => {}),
        onToggleLineNumbersFromLauncher: vi.fn((callback: () => void) => {
          toggleLineNumbersFromLauncher = callback;
          return () => {
            toggleLineNumbersFromLauncher = null;
          };
        }),
      },
    });
    Object.defineProperty(window, 'libraryAPI', {
      configurable: true,
      value: {
        getRoots: vi.fn(async () => []),
        getHiddenFolders: vi.fn(async () => []),
        openDocumentWindow: vi.fn(async () => ({ success: true })),
        onRootsChanged: vi.fn(() => () => {}),
        onItemRenamed: vi.fn(() => () => {}),
      },
    });
    Object.defineProperty(window, 'shellAPI', {
      configurable: true,
      value: {
        setRepresentedFilename: vi.fn(),
        pasteIntoCodexInput: vi.fn(async () => ({ success: true })),
      },
    });
    Object.defineProperty(window, 'clipboardAPI', {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, 'markdownImagesAPI', {
      configurable: true,
      value: {
        copyImageForDocument: vi.fn(async () => null),
        copyImageDataUrlForDocument: vi.fn(async () => null),
        makeImagesPortable: vi.fn(async (_documentPath: string, content: string) => ({
          content,
          copied: 0,
          rewritten: 0,
          missing: 0,
        })),
      },
    });
  });

  afterEach(() => {
    toggleLineNumbersFromLauncher = null;
    resetBookmarksCacheForTests();
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders without throwing during hook initialization', async () => {
    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    await waitFor(() => {
      expect(window.librarianAPI?.getReadings).toHaveBeenCalled();
    });
  });

  it('handles launcher line-number toggles while mounted inactive behind Commands', async () => {
    render(<LibrarianView active={false} sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    await waitFor(() => expect(toggleLineNumbersFromLauncher).toBeTruthy());
    vi.mocked(window.localStorage.setItem).mockClear();

    act(() => {
      toggleLineNumbersFromLauncher?.();
    });

    await waitFor(() => {
      expect(window.localStorage.setItem).toHaveBeenCalledWith('fieldtheory-line-numbers', 'visible');
    });
  });

  it('re-reports the active markdown context when the Browser helper reconnects', async () => {
    const relPath = 'scratchpad/reconnect-note';
    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'wiki-expanded-folders' ? expandedScratchpadFolders : null
    ));
    vi.mocked(window.libraryAPI!.getRoots).mockResolvedValue([{
      path: testLibraryRootPath,
      label: 'Library',
      builtin: true,
      tree: [{
        kind: 'dir' as const,
        name: 'scratchpad',
        relPath: 'scratchpad',
        children: [{
          kind: 'file' as const,
          relPath,
          absPath: `${testLibraryRootPath}/${relPath}.md`,
          name: 'reconnect-note',
          title: 'Reconnect Note',
          lastUpdated: 1,
        }],
      }],
    }]);
    vi.mocked(window.wikiAPI!.getTree).mockResolvedValue([{
      name: 'scratchpad',
      files: [{
        relPath,
        absPath: `${testLibraryRootPath}/${relPath}.md`,
        name: 'reconnect-note',
        title: 'Reconnect Note',
        lastUpdated: 1,
      }],
    }]);
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue({
      relPath,
      absPath: `${testLibraryRootPath}/${relPath}.md`,
      name: 'reconnect-note',
      title: 'Reconnect Note',
      lastUpdated: 1,
      content: 'Reconnect body',
      documentVersion: { mtimeMs: 1, size: 14, sha256: 'reconnect' },
    });

    render(
      <LibrarianView
        sidebarCollapsed={false}
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{ kind: 'wiki', path: relPath, contentMode: 'rendered' }}
      />,
    );

    await screen.findByText('Reconnect body');
    const expectedContext = {
      type: 'wiki',
      rootPath: testLibraryRootPath,
      relPath,
      filePath: `${testLibraryRootPath}/${relPath}.md`,
      title: 'Reconnect Note',
    };
    await waitFor(() => {
      expect(window.commandsAPI!.setActiveLibraryFileContext).toHaveBeenCalledWith(expectedContext);
    });
    await waitFor(() => {
      expect(window.librarianAPI!.setSizeKey).toHaveBeenCalledWith('library');
    });
    await waitFor(() => {
      expect(window.shellAPI!.setRepresentedFilename).toHaveBeenCalledWith('');
    });
    const editorContent = document.querySelector('.cm-content') as HTMLElement | null;
    expect(editorContent).toBeTruthy();
    fireEvent.focus(editorContent!);
    await waitFor(() => {
      expect(window.librarianAPI!.setMarkdownEditorFocused).toHaveBeenCalledWith(true);
    });

    vi.mocked(window.commandsAPI!.setActiveLibraryFileContext!).mockClear();
    vi.mocked(window.librarianAPI!.setSizeKey).mockClear();
    vi.mocked(window.librarianAPI!.setMarkdownEditorFocused).mockClear();
    vi.mocked(window.shellAPI!.setRepresentedFilename!).mockClear();
    act(() => {
      window.dispatchEvent(new Event('fieldtheory:browser-helper-event-stream-open'));
    });

    expect(window.commandsAPI!.setActiveLibraryFileContext).toHaveBeenCalledWith(expectedContext);
    expect(window.librarianAPI!.setSizeKey).toHaveBeenCalledWith('library');
    expect(window.librarianAPI!.setMarkdownEditorFocused).toHaveBeenCalledWith(true);
    expect(window.shellAPI!.setRepresentedFilename).toHaveBeenCalledWith('');
  });

  it('reloads sidebar artifacts, tagged docs, and shared pins when the Browser helper reconnects', async () => {
    const firstArtifact = {
      path: '/tmp/library/reconnect-one.md',
      title: 'Reconnect Artifact One',
      context: null,
      readingTime: null,
      modelSignature: null,
      createdAt: 1,
      mtime: 1,
    };
    const secondArtifact = {
      path: '/tmp/library/reconnect-two.md',
      title: 'Reconnect Artifact Two',
      context: null,
      readingTime: null,
      modelSignature: null,
      createdAt: 2,
      mtime: 2,
    };
    let includeSecondArtifact = false;
    window.librarianAPI!.getReadings = vi.fn(async () => (
      includeSecondArtifact ? [firstArtifact, secondArtifact] : [firstArtifact]
    ));
    window.librarianAPI!.getReading = vi.fn(async () => null);
    const listTaggedDocs = vi.fn(async () => []);
    const getPinnedItemIds = vi.fn(async () => []);
    Object.defineProperty(window, 'taggedDocsAPI', {
      configurable: true,
      value: {
        list: listTaggedDocs,
        onUpdated: vi.fn(() => () => {}),
      },
    });
    Object.defineProperty(window, 'sharedFilesAPI', {
      configurable: true,
      value: {
        getAvailability: vi.fn(async () => ({ available: false, hasTeamMembers: false })),
        getStatus: vi.fn(async () => ({ shared: false })),
        getPinnedItemIds,
        setActivePresence: vi.fn(async () => []),
        onPresenceChanged: vi.fn(() => () => {}),
        onPinsChanged: vi.fn(() => () => {}),
      },
    });

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    await waitFor(() => {
      expect(listTaggedDocs).toHaveBeenCalledTimes(1);
      expect(getPinnedItemIds).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText('Reconnect Artifact One')).toBeTruthy();
    expect(screen.queryByText('Reconnect Artifact Two')).toBeNull();

    listTaggedDocs.mockClear();
    getPinnedItemIds.mockClear();
    vi.mocked(window.librarianAPI!.getReadings).mockClear();
    includeSecondArtifact = true;
    act(() => {
      window.dispatchEvent(new Event('fieldtheory:browser-helper-event-stream-open'));
    });

    await waitFor(() => {
      expect(listTaggedDocs).toHaveBeenCalledTimes(1);
      expect(getPinnedItemIds).toHaveBeenCalledTimes(1);
      expect(window.librarianAPI!.getReadings).toHaveBeenCalled();
    });
    expect(await screen.findByText('Reconnect Artifact Two')).toBeTruthy();
  });

  it('uses the bookmarks canvas size key and replays it when the helper reconnects', async () => {
    Object.defineProperty(window, 'bookmarksAPI', {
      configurable: true,
      value: {
        getAll: vi.fn(async () => ({
          bookmarks: [{ id: 'bookmark-1', text: 'Saved bookmark', folders: [] }],
          folders: [],
          xLastSyncedAt: null,
        })),
        onChanged: vi.fn(() => () => {}),
        syncIfStale: vi.fn(async () => ({ status: 'fresh' })),
      },
    });

    render(
      <LibrarianView
        sidebarCollapsed={false}
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{ kind: 'bookmarks', path: 'bookmarks' }}
      />,
    );

    await waitFor(() => {
      expect(window.bookmarksAPI!.getAll).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(window.librarianAPI!.setSizeKey).toHaveBeenCalledWith('canvas');
    });

    vi.mocked(window.librarianAPI!.setSizeKey).mockClear();
    act(() => {
      window.dispatchEvent(new Event('fieldtheory:browser-helper-event-stream-open'));
    });

    expect(window.librarianAPI!.setSizeKey).toHaveBeenCalledWith('canvas');
  });

  it('does not override the window size key for bookmarks list mode', async () => {
    vi.mocked(window.localStorage.getItem).mockImplementation((key: string) => (
      key === 'bookmarks-view-mode' ? 'list' : null
    ));
    Object.defineProperty(window, 'bookmarksAPI', {
      configurable: true,
      value: {
        getAll: vi.fn(async () => ({
          bookmarks: [{ id: 'bookmark-1', text: 'Saved bookmark', folders: [] }],
          folders: [],
          xLastSyncedAt: null,
        })),
        onChanged: vi.fn(() => () => {}),
        syncIfStale: vi.fn(async () => ({ status: 'fresh' })),
      },
    });

    render(
      <LibrarianView
        sidebarCollapsed={false}
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{ kind: 'bookmarks', path: 'bookmarks' }}
      />,
    );

    expect(await screen.findByText('Saved bookmark')).toBeTruthy();
    expect(window.librarianAPI!.setSizeKey).not.toHaveBeenCalledWith('canvas');
  });

  it('releases Browser Library editor focus when the Library surface becomes inactive', async () => {
    const { rerender } = render(
      <LibrarianView active sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />,
    );

    await waitFor(() => {
      expect(window.librarianAPI?.getReadings).toHaveBeenCalled();
    });
    vi.mocked(window.librarianAPI!.setMarkdownEditorFocused).mockClear();

    rerender(
      <LibrarianView active={false} sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />,
    );

    await waitFor(() => {
      expect(window.librarianAPI!.setMarkdownEditorFocused).toHaveBeenCalledWith(false);
    });
  });

  it('opens the real Ember pane from an initial Browser Library target', async () => {
    const emberPage: WikiPage = {
      relPath: 'Ember/Ada Lovelace',
      absPath: `${testLibraryRootPath}/Ember/Ada Lovelace.md`,
      name: 'Ada Lovelace',
      title: 'Ada Lovelace',
      lastUpdated: 1,
      content: [
        '---',
        'ember_frequency: weekly',
        'ember_last_contacted_at: 2026-05-20',
        '---',
        '',
        '# Ada Lovelace',
      ].join('\n'),
      documentVersion: { mtimeMs: 1, size: 100, sha256: 'ember-ada' },
    };
    vi.mocked(window.libraryAPI!.getRoots).mockResolvedValue([{
      path: testLibraryRootPath,
      label: 'Wiki',
      tree: [{
        kind: 'dir',
        name: 'Ember',
        relPath: 'Ember',
        children: [{
          kind: 'file',
          relPath: emberPage.relPath,
          absPath: emberPage.absPath,
          name: emberPage.name,
          title: emberPage.title,
          lastUpdated: 1,
        }],
      }],
      builtin: true,
      writable: true,
    }]);
    vi.mocked(window.wikiAPI!.getPage).mockImplementation(async (relPath) => (
      relPath === emberPage.relPath ? emberPage : null
    ));

    render(
      <LibrarianView
        browserLibrarySurface
        initialOpenTarget={{ kind: 'ember', path: 'ember' }}
        sidebarCollapsed={false}
        onSwitchToClipboard={vi.fn()}
      />,
    );

    expect(await screen.findByPlaceholderText('Person name')).toBeTruthy();
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(window.libraryAPI?.getRoots).toHaveBeenCalled();
    expect(window.wikiAPI?.getPage).toHaveBeenCalledWith(emberPage.relPath);
  });

  it('keeps the library shell visible when artifact readings are empty', async () => {
    window.librarianAPI!.getReadings = vi.fn(async () => []);

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    expect(await screen.findByText('Select a file')).toBeTruthy();
    expect(screen.queryByText('No artifacts yet')).toBeNull();
    expect(window.librarianAPI!.discoverLibrarianDirs).not.toHaveBeenCalled();
  });

  it('keeps a restored wiki selection out of the empty state while the page loads', async () => {
    const relPath = 'scratchpad/restored-delayed';
    mockStoredWikiSelection(relPath);

    let resolvePage: (page: WikiPage) => void = () => {};
    window.wikiAPI!.getPage = vi.fn(() => new Promise<WikiPage>((resolve) => {
      resolvePage = resolve;
    }));

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    await waitFor(() => {
      expect(window.wikiAPI?.getPage).toHaveBeenCalledWith(relPath);
    });
    expect(screen.queryByText('Select a file')).toBeNull();

    await act(async () => {
      resolvePage({
        relPath,
        absPath: `${testLibraryRootPath}/${relPath}.md`,
        name: 'restored-delayed',
        title: 'Restored Delayed',
        lastUpdated: 1,
        content: 'Restored delayed body',
        documentVersion: { mtimeMs: 1, size: 21, sha256: 'restored-delayed' },
      });
    });

    expect(await screen.findByText('Restored delayed body')).toBeTruthy();
    expect(screen.queryByText('Select a file')).toBeNull();
  });

  it('shows the empty selection state after a missing restored wiki page resolves', async () => {
    const relPath = 'scratchpad/missing-restored';
    mockStoredWikiSelection(relPath);

    let resolvePage: (page: WikiPage | null) => void = () => {};
    window.wikiAPI!.getPage = vi.fn(() => new Promise<WikiPage | null>((resolve) => {
      resolvePage = resolve;
    }));

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    await waitFor(() => {
      expect(window.wikiAPI?.getPage).toHaveBeenCalledWith(relPath);
    });
    expect(screen.queryByText('Select a file')).toBeNull();

    await act(async () => {
      resolvePage(null);
    });

    expect(await screen.findByText('Select a file')).toBeTruthy();
  });

  it('shows the sidebar while Library has no selected page even when sidebar collapse is enabled', async () => {
    window.librarianAPI!.getReadings = vi.fn(async () => [{
      path: '/tmp/library/example.md',
      title: 'example.md',
      context: null,
      readingTime: null,
      modelSignature: null,
      createdAt: 0,
      mtime: 0,
    }]);

    const { container } = render(<LibrarianView sidebarCollapsed onSwitchToClipboard={vi.fn()} />);

    await screen.findByText('Select a file');
    const sidebarPane = container.querySelector('[data-fieldtheory-collapsed-sidebar-pane="true"]') as HTMLElement | null;
    expect(sidebarPane?.style.width).not.toBe('0px');
    expect(container.querySelector('[data-fieldtheory-collapsed-sidebar-hover-strip="true"]')).toBeNull();
  });

  it('keeps a popped-out initial target sidebar collapsed while the document loads', async () => {
    const relPath = 'scratchpad/initial-popout';
    window.wikiAPI!.getPage = vi.fn((): Promise<WikiPage | null> => new Promise(() => {}));

    const { container } = render(
      <LibrarianView
        sidebarCollapsed
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{ kind: 'wiki', path: relPath, contentMode: 'rendered' }}
      />
    );

    await waitFor(() => {
      expect(window.wikiAPI?.getPage).toHaveBeenCalledWith(relPath);
    });
    const sidebarPane = container.querySelector('[data-fieldtheory-collapsed-sidebar-pane="true"]') as HTMLElement | null;
    expect(sidebarPane?.style.width).toBe('0px');
    expect(container.querySelector('[data-fieldtheory-collapsed-sidebar-hover-strip="true"]')).toBeTruthy();
  });

  it('does not let popped-out document windows overwrite shared sidebar expansion state', async () => {
    const relPath = 'scratchpad/popped-out-preserve-expanded';
    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'wiki-expanded-folders' ? expandedScratchpadFolders : null
    ));
    vi.mocked(window.libraryAPI!.getRoots).mockResolvedValue([{
      path: testLibraryRootPath,
      label: 'Library',
      builtin: true,
      tree: [{
        kind: 'dir' as const,
        name: 'scratchpad',
        relPath: 'scratchpad',
        children: [{
          kind: 'file' as const,
          relPath,
          absPath: `${testLibraryRootPath}/${relPath}.md`,
          name: 'popped-out-preserve-expanded',
          title: 'Popped Out Preserve Expanded',
          lastUpdated: 1,
        }],
      }],
    }]);
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue({
      relPath,
      absPath: `${testLibraryRootPath}/${relPath}.md`,
      name: 'popped-out-preserve-expanded',
      title: 'Popped Out Preserve Expanded',
      lastUpdated: 1,
      content: 'Popped out body',
      documentVersion: { mtimeMs: 1, size: 15, sha256: 'popped-out-preserve-expanded' },
    });

    render(
      <LibrarianView
        sidebarCollapsed
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{ kind: 'wiki', path: relPath, contentMode: 'rendered' }}
      />
    );

    expect(await screen.findByText('Popped out body')).toBeTruthy();
    const expandedFolderWrites = vi.mocked(window.localStorage.setItem).mock.calls
      .filter(([key]) => key === 'wiki-expanded-folders');
    expect(expandedFolderWrites).toEqual([]);
  });

  it('shows pinned recent docs only in Recents and without pin buttons', async () => {
    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'library-pinned-item-ids'
        ? JSON.stringify(['wiki:scratchpad/pinned-note'])
        : null
    ));
    Object.defineProperty(window, 'recentAPI', {
      configurable: true,
      value: {
        list: vi.fn(async () => [{
          kind: 'wiki' as const,
          path: 'scratchpad/pinned-note',
          title: 'Pinned Note',
          lastOpenedAt: 10,
        }]),
        onChanged: vi.fn(() => () => {}),
        visit: vi.fn(async () => {}),
      },
    });
    window.wikiAPI!.getTree = vi.fn(async () => [{
      name: 'scratchpad',
      files: [{
        relPath: 'scratchpad/pinned-note',
        absPath: '/tmp/pinned-note.md',
        name: 'pinned-note',
        title: 'Pinned Note',
        lastUpdated: 10,
      }],
    }]);

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    expect(await screen.findByText('Pinned Note')).toBeTruthy();
    expect(screen.getAllByText('Pinned Note')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /pin recent/i })).toBeNull();
  });

  it('shows Bookmarks when native bookmark data exists even if roots do not include bookmark folders', async () => {
    window.libraryAPI!.getRoots = vi.fn(async () => [{
      path: testLibraryRootPath,
      label: 'Library',
      builtin: true,
      tree: [{
        kind: 'dir' as const,
        name: 'entries',
        relPath: 'entries',
        children: [],
      }],
    }]);
    Object.defineProperty(window, 'bookmarksAPI', {
      configurable: true,
      value: {
        getAll: vi.fn(async () => ({
          bookmarks: [{ id: 'bookmark-1', text: 'Saved bookmark', folders: [] }],
          folders: [],
          xLastSyncedAt: null,
        })),
        onChanged: vi.fn(() => () => {}),
        syncIfStale: vi.fn(async () => ({ status: 'fresh' })),
      },
    });

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    await waitFor(() => expect(window.libraryAPI!.getRoots).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Bookmarks')).toBeTruthy();
  });

  it('opens the real Bookmarks pane from the Library sidebar when native bookmarks exist', async () => {
    vi.mocked(window.localStorage.getItem).mockImplementation((key: string) => {
      if (key === 'bookmarks-view-mode') return 'list';
      if (key === 'bookmarks-show-text') return '1';
      return null;
    });
    window.libraryAPI!.getRoots = vi.fn(async () => [{
      path: testLibraryRootPath,
      label: 'Library',
      builtin: true,
      tree: [],
    }]);
    Object.defineProperty(window, 'bookmarksAPI', {
      configurable: true,
      value: {
        getAll: vi.fn(async () => ({
          bookmarks: [{ id: 'bookmark-1', text: 'Saved bookmark from native data', folders: [] }],
          folders: [],
          xLastSyncedAt: null,
        })),
        onChanged: vi.fn(() => () => {}),
        syncIfStale: vi.fn(async () => ({ status: 'fresh' })),
      },
    });

    render(<LibrarianView browserLibrarySurface sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    fireEvent.click(await screen.findByText('Bookmarks'));

    expect(await screen.findByText('Saved bookmark from native data')).toBeTruthy();
    expect(window.bookmarksAPI!.syncIfStale).toHaveBeenCalled();
  });

  it('applies native Bookmarks sidebar visibility changes after native library events', async () => {
    let hiddenFolders: string[] = [];
    let rootsChanged: (() => void) | null = null;
    window.libraryAPI!.getRoots = vi.fn(async () => [{
      path: testLibraryRootPath,
      label: 'Library',
      builtin: true,
      tree: [],
    }]);
    window.libraryAPI!.getHiddenFolders = vi.fn(async () => hiddenFolders);
    window.libraryAPI!.onRootsChanged = vi.fn((callback: () => void) => {
      rootsChanged = callback;
      return () => {
        rootsChanged = null;
      };
    });
    Object.defineProperty(window, 'bookmarksAPI', {
      configurable: true,
      value: {
        getAll: vi.fn(async () => ({
          bookmarks: [{ id: 'bookmark-1', text: 'Saved bookmark', folders: [] }],
          folders: [],
          xLastSyncedAt: null,
        })),
        onChanged: vi.fn(() => () => {}),
        syncIfStale: vi.fn(async () => ({ status: 'fresh' })),
      },
    });

    render(<LibrarianView browserLibrarySurface sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    expect(await screen.findByText('Bookmarks')).toBeTruthy();

    hiddenFolders = ['bookmarks-shortcut'];
    act(() => {
      rootsChanged?.();
    });

    await waitFor(() => {
      expect(window.libraryAPI!.getHiddenFolders).toHaveBeenCalledTimes(2);
      expect(screen.queryByText('Bookmarks')).toBeNull();
    });
  });

  it('shows Bookmarks after the native bookmark snapshot appears later', async () => {
    window.libraryAPI!.getRoots = vi.fn(async () => [{
      path: testLibraryRootPath,
      label: 'Library',
      builtin: true,
      tree: [{
        kind: 'dir' as const,
        name: 'entries',
        relPath: 'entries',
        children: [],
      }],
    }]);
    let includeBookmarks = false;
    let bookmarksChanged: (() => void) | null = null;
    Object.defineProperty(window, 'bookmarksAPI', {
      configurable: true,
      value: {
        getAll: vi.fn(async () => ({
          bookmarks: includeBookmarks ? [{ id: 'bookmark-1', text: 'Saved bookmark', folders: [] }] : [],
          folders: [],
          xLastSyncedAt: null,
        })),
        onChanged: vi.fn((callback: () => void) => {
          bookmarksChanged = callback;
          return () => {};
        }),
        syncIfStale: vi.fn(async () => ({ status: 'fresh' })),
      },
    });

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    await waitFor(() => expect(window.bookmarksAPI!.getAll).toHaveBeenCalled());
    expect(screen.queryByText('Bookmarks')).toBeNull();

    includeBookmarks = true;
    act(() => {
      bookmarksChanged?.();
    });

    expect(await screen.findByText('Bookmarks')).toBeTruthy();
  });

  it('keeps Bookmarks hidden when native bookmark data exists but the user hid the shortcut', async () => {
    window.libraryAPI!.getRoots = vi.fn(async () => [{
      path: testLibraryRootPath,
      label: 'Library',
      builtin: true,
      tree: [{
        kind: 'dir' as const,
        name: 'entries',
        relPath: 'entries',
        children: [],
      }],
    }]);
    window.libraryAPI!.getHiddenFolders = vi.fn(async () => ['bookmarks-shortcut']);
    Object.defineProperty(window, 'bookmarksAPI', {
      configurable: true,
      value: {
        getAll: vi.fn(async () => ({
          bookmarks: [{ id: 'bookmark-1', text: 'Saved bookmark', folders: [] }],
          folders: [],
          xLastSyncedAt: null,
        })),
        onChanged: vi.fn(() => () => {}),
        syncIfStale: vi.fn(async () => ({ status: 'fresh' })),
      },
    });

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    await waitFor(() => expect(window.bookmarksAPI!.getAll).toHaveBeenCalled());
    expect(screen.queryByText('Bookmarks')).toBeNull();
  });

  it('animates recent rows when a selection changes their order', async () => {
    const animate = vi.fn();
    const originalAnimateDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
    const originalOffsetTopDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');
    Object.defineProperty(HTMLElement.prototype, 'animate', {
      configurable: true,
      value: animate,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
      configurable: true,
      get(this: HTMLElement) {
        const rows = Array.from(document.querySelectorAll('[data-library-sidebar-row-id]'));
        return rows.indexOf(this) * 28;
      },
    });

    try {
      const alpha = {
        kind: 'wiki' as const,
        path: 'scratchpad/alpha',
        title: 'Alpha',
        lastOpenedAt: 10,
      };
      const beta = {
        kind: 'wiki' as const,
        path: 'scratchpad/beta',
        title: 'Beta',
        lastOpenedAt: 9,
      };
      let recentEntries = [alpha, beta];
      let onRecentChanged: (() => void) | null = null;
      Object.defineProperty(window, 'recentAPI', {
        configurable: true,
        value: {
          list: vi.fn(async () => recentEntries),
          onChanged: vi.fn((handler: () => void) => {
            onRecentChanged = handler;
            return () => {};
          }),
          visit: vi.fn(async () => []),
        },
      });
      window.wikiAPI!.getTree = vi.fn(async () => [{
        name: 'scratchpad',
        files: [
          { relPath: alpha.path, absPath: '/tmp/alpha.md', name: 'alpha', title: alpha.title, lastUpdated: 10 },
          { relPath: beta.path, absPath: '/tmp/beta.md', name: 'beta', title: beta.title, lastUpdated: 9 },
        ],
      }]);

      render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

      expect(await screen.findByText('Alpha')).toBeTruthy();
      expect(screen.getByText('Beta')).toBeTruthy();
      expect(animate).not.toHaveBeenCalled();

      await act(async () => {
        recentEntries = [beta, alpha];
        onRecentChanged?.();
      });

      await waitFor(() => expect(animate).toHaveBeenCalledTimes(2));
      const startTransforms = animate.mock.calls.map((call) => (call[0] as Keyframe[])[0]?.transform);
      expect(startTransforms).toEqual(expect.arrayContaining(['translateY(28px)', 'translateY(-28px)']));
    } finally {
      if (originalAnimateDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'animate', originalAnimateDescriptor);
      } else {
        delete (HTMLElement.prototype as unknown as { animate?: Element['animate'] }).animate;
      }
      if (originalOffsetTopDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'offsetTop', originalOffsetTopDescriptor);
      }
    }
  });

  it('does not auto-scroll the selected row again when a different folder opens', async () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      window.libraryAPI!.getRoots = vi.fn(async () => [{
        path: '/wiki',
        label: 'Wiki',
        builtin: true,
        tree: [{
          kind: 'dir' as const,
          name: 'Plans',
          relPath: 'Plans',
          children: [{
            kind: 'file' as const,
            relPath: 'Plans/plan-a',
            absPath: '/wiki/Plans/plan-a.md',
            name: 'plan-a',
            title: 'Plan A',
            lastUpdated: 10,
          }],
        }],
      }]);

      render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

      expect(await screen.findByText('example.md')).toBeTruthy();
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
      scrollIntoView.mockClear();

      fireEvent.click(screen.getByText('Plans'));
      expect(await screen.findByText('Plan A')).toBeTruthy();
      await act(async () => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      });

      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      if (originalScrollIntoViewDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoViewDescriptor);
      } else {
        delete (HTMLElement.prototype as unknown as { scrollIntoView?: Element['scrollIntoView'] }).scrollIntoView;
      }
    }
  });

  it('does not expand folders just because a recent wiki file is selected', async () => {
    const relPath = 'scratchpad/meetings/team-notes';
    Object.defineProperty(window, 'recentAPI', {
      configurable: true,
      value: {
        list: vi.fn(async () => [{
          kind: 'wiki' as const,
          path: relPath,
          title: 'Team Notes',
          lastOpenedAt: 10,
        }]),
        onChanged: vi.fn(() => () => {}),
        visit: vi.fn(async () => {}),
      },
    });
    window.wikiAPI!.getTree = vi.fn(async () => [{
      name: 'scratchpad',
      files: [{
        relPath,
        absPath: '/tmp/team-notes.md',
        name: 'team-notes',
        title: 'Team Notes',
        lastUpdated: 10,
      }],
    }]);
    window.wikiAPI!.getPage = vi.fn(async () => ({
      relPath,
      absPath: '/tmp/team-notes.md',
      name: 'team-notes',
      title: 'Team Notes',
      lastUpdated: 10,
      content: 'notes',
      documentVersion: { mtimeMs: 1, size: 5, sha256: 'notes' },
    }));
    window.libraryAPI!.getRoots = vi.fn(async () => [{
      path: '/wiki',
      label: 'Wiki',
      builtin: true,
      tree: [{
        kind: 'dir' as const,
        name: 'scratchpad',
        relPath: 'scratchpad',
        children: [{
          kind: 'dir' as const,
          name: 'meetings',
          relPath: 'scratchpad/meetings',
          children: [{
            kind: 'file' as const,
            relPath,
            absPath: '/tmp/team-notes.md',
            name: 'team-notes',
            title: 'Team Notes',
            lastUpdated: 10,
          }],
        }],
      }],
    }]);

    render(
      <LibrarianView
        sidebarCollapsed={false}
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{ kind: 'wiki', path: relPath }}
      />
    );

    expect(await screen.findByText('Team Notes')).toBeTruthy();
    expect(screen.getAllByText('Team Notes')).toHaveLength(1);
    expect(screen.queryByText('Meetings')).toBeNull();

    fireEvent.click(screen.getByTitle('Reveal in scratchpad / meetings'));

    await waitFor(() => {
      expect(screen.getByText('Meetings')).toBeTruthy();
    });
    expect(screen.getAllByText('Team Notes')).toHaveLength(2);
  });

  it('switches from an external command recent to a wiki recent document', async () => {
    const commandPath = '/Users/afar/.fieldtheory/library/Commands/release.md';
    const relPath = 'scratchpad/2026-05-28';
    Object.defineProperty(window, 'externalAPI', {
      configurable: true,
      value: {
        open: vi.fn(async (absPath: string) => ({
          path: absPath,
          name: 'release.md',
          content: 'Release command body',
          mtime: 1,
          documentVersion: { mtimeMs: 1, size: 20, sha256: 'release' },
        })),
        save: vi.fn(async () => ({ ok: true })),
        findLibraryFileByDocumentVersion: vi.fn(async () => null),
        rename: vi.fn(async () => null),
        delete: vi.fn(async () => false),
        onOpenExternal: vi.fn(() => () => {}),
      },
    });
    Object.defineProperty(window, 'recentAPI', {
      configurable: true,
      value: {
        list: vi.fn(async () => [
          {
            kind: 'external' as const,
            path: commandPath,
            title: 'release',
            lastOpenedAt: 20,
          },
          {
            kind: 'wiki' as const,
            path: relPath,
            title: 'Caching Lessons For Field Theory',
            lastOpenedAt: 10,
          },
        ]),
        onChanged: vi.fn(() => () => {}),
        visit: vi.fn(async () => []),
      },
    });
    Object.defineProperty(window, 'recentAPI', {
      configurable: true,
      value: {
        list: vi.fn(async () => [
          {
            kind: 'external' as const,
            path: commandPath,
            title: 'release',
            lastOpenedAt: 20,
          },
          {
            kind: 'wiki' as const,
            path: relPath,
            title: '2026-05-28',
            lastOpenedAt: 10,
          },
        ]),
        onChanged: vi.fn(() => () => {}),
        visit: vi.fn(async () => []),
      },
    });
    window.wikiAPI!.getTree = vi.fn(async () => [{
      name: 'scratchpad',
      files: [{
        relPath,
        absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
        name: '2026-05-28',
        title: '2026-05-28',
        lastUpdated: 10,
      }],
    }]);
    window.libraryAPI!.getRoots = vi.fn(async () => [{
      path: '/Users/afar/.fieldtheory/library',
      label: 'Library',
      builtin: true,
      tree: [{
        kind: 'dir' as const,
        name: 'scratchpad',
        relPath: 'scratchpad',
        children: [{
          kind: 'file' as const,
          relPath,
          absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
          name: '2026-05-28',
          title: '2026-05-28',
          lastUpdated: 10,
        }],
      }],
    }]);
    window.wikiAPI!.getPage = vi.fn(async () => ({
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: '2026-05-28',
      title: '2026-05-28',
      lastUpdated: 10,
      content: 'Scratchpad body',
      documentVersion: { mtimeMs: 1, size: 15, sha256: 'scratchpad' },
    }));

    render(
      <LibrarianView
        sidebarCollapsed={false}
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{ kind: 'external', path: commandPath }}
      />,
    );

    expect(await screen.findByText('Release command body')).toBeTruthy();

    fireEvent.click(screen.getByText('2026-05-28'));

    expect(await screen.findByText('Scratchpad body')).toBeTruthy();
    expect(screen.queryByText('Release command body')).toBeNull();
    expect(window.wikiAPI!.getPage).toHaveBeenCalledWith(relPath);
  });

  it('does not replay a restored external selection after clicking a wiki document', async () => {
    const commandPath = '/Users/afar/.fieldtheory/library/Commands/release.md';
    const relPath = 'scratchpad/Caching Lessons For Field Theory';
    vi.mocked(window.localStorage.getItem).mockImplementation((key) => {
      if (key === 'librarian-last-selection') return JSON.stringify({ type: 'external', path: commandPath });
      if (key === 'wiki-expanded-folders') return expandedScratchpadFolders;
      return null;
    });
    Object.defineProperty(window, 'externalAPI', {
      configurable: true,
      value: {
        open: vi.fn(async (absPath: string) => ({
          path: absPath,
          name: 'release.md',
          content: 'Release command body',
          mtime: 1,
          documentVersion: { mtimeMs: 1, size: 20, sha256: 'release' },
        })),
        save: vi.fn(async () => ({ ok: true })),
        findLibraryFileByDocumentVersion: vi.fn(async () => null),
        rename: vi.fn(async () => null),
        delete: vi.fn(async () => false),
        onOpenExternal: vi.fn(() => () => {}),
      },
    });
    window.libraryAPI!.getRoots = vi.fn(async () => [{
      path: '/Users/afar/.fieldtheory/library',
      label: 'Library',
      builtin: true,
      tree: [{
        kind: 'dir' as const,
        name: 'scratchpad',
        relPath: 'scratchpad',
        children: [{
          kind: 'file' as const,
          relPath,
          absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
          name: 'Caching Lessons For Field Theory',
          title: 'Caching Lessons For Field Theory',
          lastUpdated: 10,
        }],
      }],
    }]);
    window.wikiAPI!.getTree = vi.fn(async () => [{
      name: 'scratchpad',
      files: [{
        relPath,
        absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
        name: 'Caching Lessons For Field Theory',
        title: 'Caching Lessons For Field Theory',
        lastUpdated: 10,
      }],
    }]);
    window.wikiAPI!.getPage = vi.fn(async () => ({
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'Caching Lessons For Field Theory',
      title: 'Caching Lessons For Field Theory',
      lastUpdated: 10,
      content: 'Caching lessons body',
      documentVersion: { mtimeMs: 1, size: 20, sha256: 'caching' },
    }));

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    expect(await screen.findByText('Release command body')).toBeTruthy();
    const openCountBeforeClick = vi.mocked(window.externalAPI!.open).mock.calls.length;

    fireEvent.click(await screen.findByText('Caching Lessons For Field Theory'));

    expect(await screen.findByText('Caching lessons body')).toBeTruthy();
    expect(screen.queryByText('Release command body')).toBeNull();
    expect(window.externalAPI!.open).toHaveBeenCalledTimes(openCountBeforeClick);
  });

  it('keeps a clicked wiki page when a slow initial external command finishes later', async () => {
    const commandPath = '/Users/afar/.fieldtheory/library/Commands/release.md';
    const relPath = 'scratchpad/clicked-after-command';
    let resolveExternalOpen: (() => void) | null = null;

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'wiki-expanded-folders' ? expandedScratchpadFolders : null
    ));
    Object.defineProperty(window, 'externalAPI', {
      configurable: true,
      value: {
        open: vi.fn((absPath: string) => new Promise((resolve) => {
          resolveExternalOpen = () => resolve({
            path: absPath,
            name: 'release.md',
            content: 'Release command body',
            mtime: 1,
            documentVersion: { mtimeMs: 1, size: 20, sha256: 'release' },
          });
        })),
        save: vi.fn(async () => ({ ok: true })),
        findLibraryFileByDocumentVersion: vi.fn(async () => null),
        rename: vi.fn(async () => null),
        delete: vi.fn(async () => false),
        onOpenExternal: vi.fn(() => () => {}),
      },
    });
    window.libraryAPI!.getRoots = vi.fn(async () => [{
      path: '/Users/afar/.fieldtheory/library',
      label: 'Library',
      builtin: true,
      tree: [{
        kind: 'dir' as const,
        name: 'scratchpad',
        relPath: 'scratchpad',
        children: [{
          kind: 'file' as const,
          relPath,
          absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
          name: 'clicked-after-command',
          title: 'clicked-after-command',
          lastUpdated: 10,
        }],
      }],
    }]);
    window.wikiAPI!.getTree = vi.fn(async () => [{
      name: 'scratchpad',
      files: [{
        relPath,
        absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
        name: 'clicked-after-command',
        title: 'clicked-after-command',
        lastUpdated: 10,
      }],
    }]);
    window.wikiAPI!.getPage = vi.fn(async () => ({
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'clicked-after-command',
      title: 'clicked-after-command',
      lastUpdated: 10,
      content: 'Clicked wiki body',
      documentVersion: { mtimeMs: 1, size: 17, sha256: 'clicked' },
    }));

    render(
      <LibrarianView
        sidebarCollapsed={false}
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{ kind: 'external', path: commandPath }}
      />,
    );

    await waitFor(() => {
      expect(window.externalAPI!.open).toHaveBeenCalledWith(commandPath);
    });
    fireEvent.click(await screen.findByText('clicked-after-command'));
    expect(await screen.findByText('Clicked wiki body')).toBeTruthy();

    await act(async () => {
      resolveExternalOpen?.();
      await Promise.resolve();
    });

    expect(screen.getByText('Clicked wiki body')).toBeTruthy();
    expect(screen.queryByText('Release command body')).toBeNull();
  });

  it('refreshes the active rendered wiki page from disk without a watcher event', async () => {
    const relPath = "scratchpad/Monday May 4th - to do's";
    const absPath = `/Users/afar/.fieldtheory/library/${relPath}.md`;
    const makePage = (content: string, sha256: string): WikiPage => ({
      relPath,
      absPath,
      name: "Monday May 4th - to do's",
      title: "Monday May 4th - to do's",
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256 },
    });

    mockStoredWikiSelection(relPath, { expandScratchpad: true });
    vi.mocked(window.wikiAPI!.getPage)
      .mockResolvedValueOnce(makePage('old rendered body', 'old-version'))
      .mockResolvedValueOnce(makePage('old rendered body', 'old-version'))
      .mockResolvedValue(makePage('fresh rendered body', 'fresh-version'));
    window.librarianAPI!.getReadings = vi.fn(async () => [{
      path: '/tmp/library/example.md',
      title: 'example.md',
      context: null,
      readingTime: null,
      modelSignature: null,
      createdAt: 0,
      mtime: 0,
    }]);

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    expect(await screen.findByText('old rendered body')).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText('fresh rendered body')).toBeTruthy();
    }, { timeout: 2000 });
  });

  it('uses an editor-owned rendered input instead of a contentEditable markdown tree', async () => {
    const relPath = 'scratchpad/rendered-toggle-test';
    const absPath = `/Users/afar/.fieldtheory/library/${relPath}.md`;
    const page: WikiPage = {
      relPath,
      absPath,
      name: 'rendered-toggle-test',
      title: 'rendered-toggle-test',
      lastUpdated: 1,
      content: 'First rendered line\n\nSecond rendered line',
      documentVersion: { mtimeMs: 1, size: 40, sha256: 'toggle-version' },
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => {
      if (key === 'librarian-last-selection') return JSON.stringify({ type: 'wiki', relPath });
      if (key === 'librarian-editor-session') {
        return JSON.stringify({
          itemType: 'wiki',
          itemPath: relPath,
          contentMode: 'markdown',
          selectionStart: 5,
          selectionEnd: 5,
          scrollTop: 0,
        });
      }
      return null;
    });
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedInput = await waitFor(() => {
      const renderedRoot = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(renderedRoot?.getAttribute('contenteditable')).toBeNull();
      expect(renderedRoot?.getAttribute('role')).toBeNull();
      expect(renderedRoot?.textContent).toContain('First rendered line');
      expect(input?.tagName).toBe('DIV');
      expect(input?.closest('.cm-editor')).toBeTruthy();
      expect(input?.textContent).toContain('First rendered line');
      expect(input?.textContent).toContain('Second rendered line');
      expect(screen.getByLabelText('Switch to Markdown source')).toBeTruthy();
      expect(screen.queryByLabelText('Switch to rendered view')).toBeNull();
      return input;
    });

    const renderedRoot = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
    if (!renderedRoot) throw new Error('Rendered editor root missing');
    fireEvent.click(renderedRoot);
    expect(renderedInput?.closest('[data-ft-rendered-editor-root="true"]')).toBe(renderedRoot);
    expect(container.querySelector('textarea[data-ft-rendered-editor-input="true"]')).toBeNull();

    fireEvent.click(screen.getByLabelText('Switch to Markdown source'));

    await waitFor(() => {
      expect(container.querySelector('[data-ft-rendered-editor-root="true"]')).toBeNull();
      expect(container.querySelector('.cm-editor')).toBeTruthy();
      expect(screen.queryByLabelText('Switch to Markdown source')).toBeNull();
      expect(screen.getByLabelText('Switch to rendered view')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('Switch to rendered view'));

    await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(root?.getAttribute('contenteditable')).toBeNull();
      expect(root?.textContent).toContain('Second rendered line');
      expect(input?.closest('.cm-editor')).toBeTruthy();
      expect(screen.getByLabelText('Switch to Markdown source')).toBeTruthy();
      expect(screen.queryByLabelText('Switch to rendered view')).toBeNull();
    });
  });

  it('places the document pop-out button immediately before the markdown mode button', async () => {
    const relPath = 'scratchpad/popout-toolbar-order-test';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'popout-toolbar-order-test',
      title: 'popout-toolbar-order-test',
      lastUpdated: 1,
      content: 'Toolbar order body',
      documentVersion: { mtimeMs: 1, size: 18, sha256: 'toolbar-order' },
    };

    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.localStorage.getItem).mockImplementation((key) => {
      if (key === 'fieldtheory.codexTerminal.visible') return 'true';
      if (key === 'fieldtheory.codexTerminal.dockSide') return 'right';
      return null;
    });
    Object.defineProperty(window, 'sharedFilesAPI', {
      configurable: true,
      value: {
        getAvailability: vi.fn(async () => ({ available: true, canWrite: true, hasTeamMembers: true })),
        getStatus: vi.fn(async () => ({ shared: false })),
        setActivePresence: vi.fn(async () => []),
        onPresenceChanged: vi.fn(() => () => {}),
      },
    });

    render(
      <LibrarianView
        sidebarCollapsed={false}
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{ kind: 'wiki', path: relPath, contentMode: 'rendered' }}
      />
    );

    await screen.findByText('Toolbar order body');
    const riverButton = await screen.findByRole('button', { name: 'Add to River (shared)' });
    const popOutButton = screen.getByRole('button', { name: 'Open in New Window' });
    const markdownButton = screen.getByRole('button', { name: 'Switch to Markdown source' });
    const terminalButton = screen.getByRole('button', { name: 'Close Terminal' });
    const focusButton = screen.getByRole('button', { name: 'Enter immersive view' });
    const riverDivider = riverButton.nextElementSibling;
    expect(riverDivider?.getAttribute('data-content-toolbar-divider')).toBe('true');
    expect(riverDivider?.nextElementSibling).toBe(popOutButton);
    expect(popOutButton.nextElementSibling).toBe(markdownButton);
    expect(popOutButton.style.width).toBe(focusButton.style.width);
    expect(markdownButton.style.width).toBe(focusButton.style.width);
    expect(terminalButton.style.width).toBe(focusButton.style.width);
    expect(riverButton.style.width).toBe(focusButton.style.width);
    expect(popOutButton.style.height).toBe(focusButton.style.width);
    expect(markdownButton.style.height).toBe(focusButton.style.width);
    expect(terminalButton.style.height).toBe(focusButton.style.width);
    expect(focusButton.style.height).toBe(focusButton.style.width);
    expect(riverButton.style.borderStyle).toBe('none');
  });

  it('keeps the Library document toolbar in Browser mode while excluding terminal controls', async () => {
    const relPath = 'scratchpad/browser-library-terminal-exclusion-test';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'browser-library-terminal-exclusion-test',
      title: 'browser-library-terminal-exclusion-test',
      lastUpdated: 1,
      content: 'Browser Library body',
      documentVersion: { mtimeMs: 1, size: 20, sha256: 'browser-terminal-exclusion' },
    };

    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.localStorage.getItem).mockImplementation((key) => {
      if (key === 'fieldtheory.codexTerminal.visible') return 'true';
      if (key === 'fieldtheory.codexTerminal.dockSide') return 'right';
      return null;
    });

    const { container } = render(
      <LibrarianView
        browserLibrarySurface
        sidebarCollapsed={false}
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{ kind: 'wiki', path: relPath, contentMode: 'rendered' }}
      />
    );

    await screen.findByText('Browser Library body');
    expect(screen.getByRole('button', { name: 'Open in New Window' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Switch to Markdown source' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enter immersive view' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open Terminal' })).toBeNull();
    expect(container.querySelector('[data-ft-codex-terminal-panel="true"]')).toBeNull();
    const readerPane = container.querySelector('[data-fieldtheory-reader-pane="true"]') as HTMLElement | null;
    expect(readerPane?.style.flexDirection).toBe('column');
    expect(readerPane?.style.overflow).toBe('hidden');
  });

  it('persists Browser Library wiki selections for startup restore', async () => {
    const relPath = 'scratchpad/browser-library-last-selection-test';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'browser-library-last-selection-test',
      title: 'browser-library-last-selection-test',
      lastUpdated: 1,
      content: 'Browser restore body',
      documentVersion: { mtimeMs: 1, size: 20, sha256: 'browser-restore-selection' },
    };
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);

    render(
      <LibrarianView
        browserLibrarySurface
        sidebarCollapsed={false}
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{ kind: 'wiki', path: relPath, contentMode: 'rendered' }}
      />
    );

    await screen.findByText('Browser restore body');
    await waitFor(() => {
      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        'librarian-last-selection',
        JSON.stringify({ type: 'wiki', relPath }),
      );
      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        'librarian-editor-session',
        expect.stringContaining(`"itemPath":"${relPath}"`),
      );
    });
  });

  it('does not show the selected-text Codex paste button in Browser mode', async () => {
    const relPath = 'scratchpad/browser-library-codex-selection-test';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'browser-library-codex-selection-test',
      title: 'browser-library-codex-selection-test',
      lastUpdated: 1,
      content: 'Selected body for Codex',
      documentVersion: { mtimeMs: 1, size: 23, sha256: 'browser-codex-selection' },
    };
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);

    render(
      <LibrarianView
        browserLibrarySurface
        sidebarCollapsed={false}
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{ kind: 'wiki', path: relPath, contentMode: 'rendered' }}
      />
    );

    const selectedText = await screen.findByText('Selected body for Codex');
    const selectedTextNode = selectedText.firstChild;
    expect(selectedTextNode).toBeTruthy();

    const range = document.createRange();
    range.selectNodeContents(selectedTextNode!);
    Object.defineProperty(range, 'getBoundingClientRect', {
      configurable: true,
      value: vi.fn(() => ({
        top: 100,
        left: 280,
        right: 520,
        bottom: 124,
        width: 240,
        height: 24,
        x: 280,
        y: 100,
        toJSON: () => ({}),
      })),
    });

    const selection = window.getSelection();
    expect(selection).toBeTruthy();
    await act(async () => {
      selection!.removeAllRanges();
      selection!.addRange(range);
      fireEvent(document, new Event('selectionchange'));
      fireEvent.mouseUp(window);
    });

    expect(screen.queryByRole('button', { name: 'Paste selection to Codex input' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Paste selection to terminal' })).toBeNull();
    expect(window.shellAPI!.pasteIntoCodexInput).not.toHaveBeenCalled();
  });

  it('centers copy feedback over the reader content instead of the terminal', async () => {
    const relPath = 'briefs/Example CLI Org Scoped Benchmark Brief';
    const page: WikiPage = {
      relPath,
      absPath: `${testLibraryRootPath}/${relPath}.md`,
      name: 'Example CLI Org Scoped Benchmark Brief',
      title: 'Example CLI Org Scoped Benchmark Brief',
      lastUpdated: 1,
      content: 'Benchmark body',
      documentVersion: { mtimeMs: 1, size: 14, sha256: 'feedback-anchor' },
    };
    const writeText = vi.fn(async () => {
      throw new Error('web clipboard unavailable');
    });
    const nativeWriteText = vi.fn(async () => ({ success: true }));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(window, 'clipboardAPI', {
      configurable: true,
      value: { writeText: nativeWriteText },
    });
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.localStorage.getItem).mockImplementation((key) => {
      if (key === 'fieldtheory.codexTerminal.visible') return 'true';
      if (key === 'fieldtheory.codexTerminal.dockSide') return 'right';
      return null;
    });

    const { container } = render(
      <LibrarianView
        sidebarCollapsed={false}
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{ kind: 'wiki', path: relPath, contentMode: 'rendered' }}
      />
    );

    await screen.findByText('Benchmark body');
    expect(screen.getByRole('button', { name: 'Close Terminal' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Copy selected text or file path (⌘C)' }));

    const feedback = await screen.findByRole('status');
    const editorPane = container.querySelector('[data-ft-reader-editor-pane="true"]');
    expect(feedback.textContent).toBe('Copied file path');
    expect(nativeWriteText).toHaveBeenCalledWith(page.absPath);
    expect(writeText).not.toHaveBeenCalled();
    expect(container.firstElementChild?.contains(feedback)).toBe(true);
    expect(editorPane?.contains(feedback)).toBe(false);
    expect(feedback.style.left).not.toBe('');
  });

  it('refreshes River availability after auth session changes', async () => {
    let sessionChanged: ((session: unknown | null) => void) | null = null;
    let available = false;
    const getAvailability = vi.fn(async () => ({ available, hasTeamMembers: available }));
    const sync = vi.fn(async () => ({ written: 0, removed: 0, created: 0, errors: [] }));
    Object.defineProperty(window, 'sharedFilesAPI', {
      configurable: true,
      value: {
        getAvailability,
        sync,
        getStatus: vi.fn(async () => ({ shared: false })),
        setActivePresence: vi.fn(async () => []),
        onPresenceChanged: vi.fn(() => () => {}),
      },
    });
    Object.defineProperty(window, 'authAPI', {
      configurable: true,
      value: {
        onSessionChanged: vi.fn((handler: (session: unknown | null) => void) => {
          sessionChanged = handler;
          return vi.fn();
        }),
      },
    });

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    await waitFor(() => expect(getAvailability).toHaveBeenCalledTimes(1));
    expect(sync).not.toHaveBeenCalled();

    available = true;
    await act(async () => {
      sessionChanged?.({ user: { id: 'user-1' } });
    });

    await waitFor(() => expect(getAvailability).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(sync).toHaveBeenCalledTimes(1));
  });

  it('resets rendered document scroll when selecting a different sidebar file', async () => {
    const firstRelPath = 'scratchpad/scroll-first';
    const secondRelPath = 'scratchpad/scroll-second';
    const firstPage: WikiPage = {
      relPath: firstRelPath,
      absPath: `/Users/afar/.fieldtheory/library/${firstRelPath}.md`,
      name: 'scroll-first',
      title: 'Scroll First',
      lastUpdated: 1,
      content: 'First body',
      documentVersion: { mtimeMs: 1, size: 10, sha256: 'scroll-first' },
    };
    const secondPage: WikiPage = {
      relPath: secondRelPath,
      absPath: `/Users/afar/.fieldtheory/library/${secondRelPath}.md`,
      name: 'scroll-second',
      title: 'Scroll Second',
      lastUpdated: 2,
      content: 'Second body',
      documentVersion: { mtimeMs: 2, size: 11, sha256: 'scroll-second' },
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'wiki-expanded-folders' ? expandedScratchpadFolders : null
    ));
    vi.mocked(window.libraryAPI!.getRoots).mockResolvedValue([{
      path: testLibraryRootPath,
      label: 'Library',
      builtin: true,
      tree: [{
        kind: 'dir' as const,
        name: 'scratchpad',
        relPath: 'scratchpad',
        children: [
          {
            kind: 'file' as const,
            relPath: firstRelPath,
            absPath: firstPage.absPath,
            name: firstPage.name,
            title: firstPage.title,
            lastUpdated: firstPage.lastUpdated,
          },
          {
            kind: 'file' as const,
            relPath: secondRelPath,
            absPath: secondPage.absPath,
            name: secondPage.name,
            title: secondPage.title,
            lastUpdated: secondPage.lastUpdated,
          },
        ],
      }],
    }]);
    vi.mocked(window.wikiAPI!.getPage).mockImplementation(async (relPath) => (
      relPath === firstRelPath ? firstPage : relPath === secondRelPath ? secondPage : null
    ));

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    fireEvent.click(await screen.findByText('Scroll First'));
    await screen.findByText('First body');
    const scrollEl = container.querySelector('[data-ft-librarian-content-scroll="true"]') as HTMLDivElement;
    scrollEl.scrollTop = 180;
    fireEvent.scroll(scrollEl);

    fireEvent.click(await screen.findByText('Scroll Second'));

    await screen.findByText('Second body');
    expect(scrollEl.scrollTop).toBe(0);
  });

  it('resets rendered document scroll when opening a command launcher target', async () => {
    const firstRelPath = 'scratchpad/command-scroll-first';
    const secondRelPath = 'scratchpad/command-scroll-second';
    const firstPage: WikiPage = {
      relPath: firstRelPath,
      absPath: `/Users/afar/.fieldtheory/library/${firstRelPath}.md`,
      name: 'command-scroll-first',
      title: 'Command Scroll First',
      lastUpdated: 1,
      content: 'Command first body',
      documentVersion: { mtimeMs: 1, size: 18, sha256: 'command-scroll-first' },
    };
    const secondPage: WikiPage = {
      relPath: secondRelPath,
      absPath: `/Users/afar/.fieldtheory/library/${secondRelPath}.md`,
      name: 'command-scroll-second',
      title: 'Command Scroll Second',
      lastUpdated: 2,
      content: 'Command second body',
      documentVersion: { mtimeMs: 2, size: 19, sha256: 'command-scroll-second' },
    };

    vi.mocked(window.wikiAPI!.getPage).mockImplementation(async (relPath) => (
      relPath === firstRelPath ? firstPage : relPath === secondRelPath ? secondPage : null
    ));

    const { container, rerender } = render(
      <LibrarianView
        sidebarCollapsed={false}
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{ kind: 'wiki', path: firstRelPath, contentMode: 'rendered' }}
      />
    );

    await screen.findByText('Command first body');
    const scrollEl = container.querySelector('[data-ft-librarian-content-scroll="true"]') as HTMLDivElement;
    scrollEl.scrollTop = 220;
    fireEvent.scroll(scrollEl);

    rerender(
      <LibrarianView
        sidebarCollapsed={false}
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{ kind: 'wiki', path: secondRelPath, contentMode: 'rendered' }}
      />
    );

    await screen.findByText('Command second body');
    expect(scrollEl.scrollTop).toBe(0);
  });

  it('keeps the cursor at the end of inserted recording text in markdown source', async () => {
    const relPath = 'scratchpad/recording-cursor-test';
    const content = 'Intro paragraph.\n\nSecond paragraph.';
    const insertedText = 'Recorded transcription. ';
    const insertAt = content.indexOf('Second');
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'recording-cursor-test',
      title: 'recording-cursor-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'recording-cursor-version' },
    };
    let insertMarkdownTextHandler: ((text: string) => void) | null = null;

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => {
      if (key === 'librarian-last-selection') return JSON.stringify({ type: 'wiki', relPath });
      if (key === 'librarian-editor-session') {
        return JSON.stringify({
          itemType: 'wiki',
          itemPath: relPath,
          contentMode: 'markdown',
          selectionStart: insertAt,
          selectionEnd: insertAt,
          scrollTop: 0,
        });
      }
      return null;
    });
    vi.mocked(window.librarianAPI!.onInsertMarkdownText).mockImplementation((callback) => {
      insertMarkdownTextHandler = callback;
      return () => {
        insertMarkdownTextHandler = null;
      };
    });
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    await waitFor(() => {
      expect(container.querySelector('.cm-editor')).toBeTruthy();
      expect(insertMarkdownTextHandler).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText('Switch to Markdown source'));
    await waitFor(() => {
      expect(screen.getByLabelText('Switch to rendered view')).toBeTruthy();
      expect(container.querySelector('[data-ft-rendered-editor-root="true"]')).toBeNull();
    });

    await act(async () => {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      insertMarkdownTextHandler?.(insertedText);
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    const expectedSelection = insertAt + insertedText.length;
    await waitFor(() => {
      const contentNode = container.querySelector('.cm-content') as HTMLElement | null;
      expect(contentNode?.textContent).toContain(`${insertedText}Second paragraph.`);
    });
    await waitFor(() => {
      const sessionCalls = vi.mocked(window.localStorage.setItem).mock.calls
        .filter(([key]) => key === 'librarian-editor-session');
      expect(sessionCalls.length).toBeGreaterThan(0);
      const latestSession = JSON.parse(sessionCalls[sessionCalls.length - 1][1]);
      expect(latestSession.selectionStart).toBe(expectedSelection);
      expect(latestSession.selectionEnd).toBe(expectedSelection);
    });
  });

  it('persists Browser Library editor sessions for the active page', async () => {
    const relPath = 'scratchpad/browser-panel-session-test';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'browser-panel-session-test',
      title: 'browser-panel-session-test',
      lastUpdated: 1,
      content: 'Browser panel body',
      documentVersion: { mtimeMs: 1, size: 18, sha256: 'browser-panel-session-version' },
    };
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);

    render(
      <LibrarianView
        browserLibrarySurface
        sidebarCollapsed={false}
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{ kind: 'wiki', path: relPath, contentMode: 'rendered' }}
      />
    );

    await screen.findByText('Browser panel body');

    const sessionCalls = vi.mocked(window.localStorage.setItem).mock.calls
      .filter(([key]) => key === 'librarian-editor-session');
    expect(sessionCalls.length).toBeGreaterThan(0);
    const latestSession = JSON.parse(sessionCalls[sessionCalls.length - 1][1]);
    expect(latestSession).toMatchObject({
      itemType: 'wiki',
      itemPath: relPath,
      contentMode: 'rendered',
    });
  });

  it('keeps command-launcher image insertion in rendered mode when rendered is active', async () => {
    const relPath = 'scratchpad/rendered-command-image-insert-test';
    const content = 'hello rendered command image';
    const insertedText = '![Image](<file:///Users/afar/Pictures/Inserted%20Image.png>)';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-command-image-insert-test',
      title: 'rendered-command-image-insert-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'rendered-command-image-version' },
    };
    let insertMarkdownTextHandler: ((text: string) => void) | null = null;

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.librarianAPI!.onInsertMarkdownText).mockImplementation((callback) => {
      insertMarkdownTextHandler = callback;
      return () => {
        insertMarkdownTextHandler = null;
      };
    });
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: content.length + insertedText.length, sha256: 'rendered-command-image-saved' },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain(content);
      expect(insertMarkdownTextHandler).toBeTruthy();
      if (!root) throw new Error('Rendered editor root missing');
      return root;
    });
    fireEvent.click(renderedRoot);

    const renderedInput = await waitFor(() => {
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(input?.textContent).toContain(content);
      return input;
    });

    await act(async () => {
      insertMarkdownTextHandler?.(insertedText);
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    await waitFor(() => {
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        `${content}${insertedText}`,
        page.documentVersion,
      );
    }, { timeout: 1200 });
    expect(container.querySelector('[data-ft-rendered-editor-input="true"]')).toBe(renderedInput);
    expect(screen.getByLabelText('Switch to Markdown source')).toBeTruthy();
  });

  it('opens inline draw from a rendered /draw command and saves portable markdown in place', async () => {
    const relPath = 'scratchpad/rendered-draw-command-test';
    const content = '/draw';
    const drawingMarkdown = '![Drawing](<./.assets/rendered-drawing.png>)';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-draw-command-test',
      title: 'rendered-draw-command-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'rendered-draw-command-version' },
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => {
      if (key === 'librarian-last-selection') return JSON.stringify({ type: 'wiki', relPath });
      if (key === 'librarian-editor-session') {
        return JSON.stringify({
          itemType: 'wiki',
          itemPath: relPath,
          contentMode: 'rendered',
          selectionStart: content.length,
          selectionEnd: content.length,
          scrollTop: 0,
        });
      }
      return null;
    });
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: drawingMarkdown.length + 1, sha256: 'rendered-draw-command-saved' },
    });
    vi.mocked(window.markdownImagesAPI!.copyImageDataUrlForDocument).mockResolvedValue({
      markdown: drawingMarkdown,
      destination: './.assets/rendered-drawing.png',
      copiedPath: `/Users/afar/.fieldtheory/library/${relPath}.assets/rendered-drawing.png`,
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('/draw');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    fireEvent.click(renderedRoot);
    const renderedInput = await waitFor(() => {
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(input).toBeTruthy();
      return input;
    });
    if (!renderedInput) throw new Error('Rendered editor input missing');

    fireEvent.keyDown(renderedInput, { key: 'Enter' });

    expect(await screen.findByRole('region', { name: 'Drawing' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Draw' })).toBeNull();
    expect(container.querySelector('[data-ft-rendered-editor-input="true"]')).toBe(renderedInput);

    const saveDrawingButton = await screen.findByRole('button', { name: 'Save drawing' });
    await act(async () => {
      fireEvent.click(saveDrawingButton);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(window.markdownImagesAPI!.copyImageDataUrlForDocument).toHaveBeenCalledWith(
        page.absPath,
        'data:image/png;base64,drawn',
        'Drawing',
      );
    });
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Drawing' })).toBeNull();
    });
    fireEvent.click(screen.getByLabelText('Switch to Markdown source'));
    await waitFor(() => {
      const contentNode = container.querySelector('.cm-content') as HTMLElement | null;
      expect(contentNode?.textContent).toContain(drawingMarkdown);
      expect(contentNode?.textContent).not.toContain('/draw');
    });
  });

  it('opens inline draw from a markdown /draw command', async () => {
    const relPath = 'scratchpad/markdown-draw-command-test';
    const content = '/draw';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'markdown-draw-command-test',
      title: 'markdown-draw-command-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'markdown-draw-command-version' },
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => {
      if (key === 'librarian-last-selection') return JSON.stringify({ type: 'wiki', relPath });
      if (key === 'librarian-editor-session') {
        return JSON.stringify({
          itemType: 'wiki',
          itemPath: relPath,
          contentMode: 'markdown',
          selectionStart: content.length,
          selectionEnd: content.length,
          scrollTop: 0,
        });
      }
      return null;
    });
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const markdownInput = await waitFor(() => {
      const input = container.querySelector('.cm-content') as HTMLElement | null;
      expect(input?.textContent).toContain('/draw');
      return input;
    });
    if (!markdownInput) throw new Error('Markdown editor input missing');

    fireEvent.keyDown(markdownInput, { key: 'Enter' });

    expect(await screen.findByRole('region', { name: 'Drawing' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Draw' })).toBeNull();
  });

  it('opens inline draw above the markdown editor in focus immersive mode', async () => {
    const relPath = 'scratchpad/immersive-markdown-draw-command-test';
    const content = '/draw';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'immersive-markdown-draw-command-test',
      title: 'immersive-markdown-draw-command-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'immersive-markdown-draw-command-version' },
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => {
      if (key === 'librarian-last-selection') return JSON.stringify({ type: 'wiki', relPath });
      if (key === 'librarian-editor-session') {
        return JSON.stringify({
          itemType: 'wiki',
          itemPath: relPath,
          contentMode: 'markdown',
          selectionStart: content.length,
          selectionEnd: content.length,
          scrollTop: 0,
        });
      }
      return null;
    });
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);

    const { container } = render(
      <LibrarianView
        focusChromeEnabled
        initialOpenTarget={{ kind: 'wiki', path: relPath, contentMode: 'markdown' }}
        sidebarCollapsed
        onSwitchToClipboard={vi.fn()}
      />,
    );

    const markdownInput = await waitFor(() => {
      const input = container.querySelector('[data-ft-quality-editor="markdown"] .cm-content') as HTMLElement | null;
      expect(input?.textContent).toContain('/draw');
      return input;
    });
    if (!markdownInput) throw new Error('Markdown editor input missing');

    fireEvent.keyDown(markdownInput, { key: 'Enter' });

    const drawingRegion = await screen.findByRole('region', { name: 'Drawing' });
    const overlay = container.querySelector('[data-ft-inline-draw-overlay="markdown"]') as HTMLElement | null;
    expect(drawingRegion).toBeTruthy();
    expect(overlay).toBeTruthy();
    expect(overlay?.style.position).toBe('absolute');
    expect(overlay?.style.zIndex).toBe('4');
    expect((drawingRegion as HTMLElement).style.height).toBe('100%');
    expect(screen.queryByRole('dialog', { name: 'Draw' })).toBeNull();
  });

  it('inserts super-pasted image paths as plain text in rendered mode', async () => {
    const relPath = 'scratchpad/rendered-super-paste-image-path-test';
    const content = 'hello rendered super paste';
    const imagePath = '/Users/afar/Pictures/Inserted Image.png';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-super-paste-image-path-test',
      title: 'rendered-super-paste-image-path-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'rendered-super-paste-image-path-version' },
    };
    let insertPlainMarkdownTextHandler: ((text: string) => void) | null = null;

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.librarianAPI!.onInsertPlainMarkdownText!).mockImplementation((callback) => {
      insertPlainMarkdownTextHandler = callback;
      return () => {
        insertPlainMarkdownTextHandler = null;
      };
    });
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: content.length + imagePath.length, sha256: 'rendered-super-paste-image-path-saved' },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain(content);
      expect(insertPlainMarkdownTextHandler).toBeTruthy();
      if (!root) throw new Error('Rendered editor root missing');
      return root;
    });
    fireEvent.click(renderedRoot);

    await waitFor(() => {
      expect(container.querySelector('[data-ft-rendered-editor-input="true"]')?.textContent).toContain(content);
    });

    await act(async () => {
      insertPlainMarkdownTextHandler?.(imagePath);
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    });

    await waitFor(() => {
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        `${content}${imagePath}`,
        page.documentVersion,
      );
    }, { timeout: 1200 });
  });

  it('keeps rendered mode when Enter commits the file title', async () => {
    const relPath = 'scratchpad/title-enter-rendered-test';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'title-enter-rendered-test',
      title: 'title-enter-rendered-test',
      lastUpdated: 1,
      content: 'Rendered body stays visible',
      documentVersion: { mtimeMs: 1, size: 27, sha256: 'title-enter-rendered-version' },
    };

    mockStoredWikiSelection(relPath, { expandScratchpad: true });
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    await waitFor(() => {
      expect(container.querySelector('[data-ft-rendered-editor-root="true"]')?.textContent).toContain('Rendered body stays visible');
    });

    const titleInput = screen.getByLabelText('File title');
    fireEvent.focus(titleInput);
    fireEvent.keyDown(titleInput, { key: 'Enter' });

    await waitFor(() => {
      const renderedRoot = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      const renderedInput = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(renderedRoot?.textContent).toContain('Rendered body stays visible');
      expect(renderedInput).toBeTruthy();
    });
  });

  it('places navigation and Show in Finder before the library breadcrumb', async () => {
    const relPath = 'scratchpad/folder-toolbar-order';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'folder-toolbar-order',
      title: 'folder-toolbar-order',
      lastUpdated: 1,
      content: 'Toolbar order',
      documentVersion: { mtimeMs: 1, size: 13, sha256: 'toolbar-order-version' },
    };

    mockStoredWikiSelection(relPath, { expandScratchpad: true });
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const breadcrumb = await screen.findByText('scratchpad');
    const backButton = screen.getByLabelText('Back');
    const folderButton = screen.getByLabelText('Show in Finder');

    expect(screen.getAllByLabelText('Show in Finder')).toHaveLength(1);
    expect(Boolean(backButton.compareDocumentPosition(folderButton) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(folderButton.compareDocumentPosition(breadcrumb) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('hides the meeting recording button from the active file toolbar', async () => {
    const relPath = 'scratchpad/meeting-toolbar';
    const absPath = `/Users/afar/.fieldtheory/library/${relPath}.md`;
    const page: WikiPage = {
      relPath,
      absPath,
      name: 'meeting-toolbar',
      title: 'meeting-toolbar',
      lastUpdated: 1,
      content: 'Meeting toolbar',
      documentVersion: { mtimeMs: 1, size: 15, sha256: 'meeting-toolbar-version' },
    };

    mockStoredWikiSelection(relPath, { expandScratchpad: true });
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Field Theory' })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Start meeting recording' })).toBeNull();
    expect(window.commandsAPI!.startMeetingHere).not.toHaveBeenCalled();
  });

  it('places Field Theory commands before the view mode toggle', async () => {
    const relPath = 'scratchpad/maxwell-toolbar-order';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'maxwell-toolbar-order',
      title: 'maxwell-toolbar-order',
      lastUpdated: 1,
      content: 'Toolbar order',
      documentVersion: { mtimeMs: 1, size: 13, sha256: 'maxwell-toolbar-order-version' },
    };

    mockStoredWikiSelection(relPath, { expandScratchpad: true });
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const maxwellButton = await screen.findByRole('button', { name: 'Field Theory' });
    const modeToggle = screen.getByRole('button', { name: 'Switch to Markdown source' });

    expect(Boolean(maxwellButton.compareDocumentPosition(modeToggle) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Start meeting recording' })).toBeNull();
  });

  it('adds the active wiki page to Field Theory commands and runs its content from the toolbar', async () => {
    const relPath = 'Commands/maxwell-cleanup';
    const absPath = `/Users/afar/.fieldtheory/library/${relPath}.md`;
    const page: WikiPage = {
      relPath,
      absPath,
      name: 'maxwell-cleanup',
      title: 'Maxwell Cleanup',
      lastUpdated: 1,
      content: 'Tighten this document.',
      documentVersion: { mtimeMs: 1, size: 22, sha256: 'maxwell-toolbar-version' },
    };

    mockStoredWikiSelection(relPath, { expandScratchpad: true });
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const maxwellButton = await screen.findByRole('button', { name: 'Field Theory' });
    fireEvent.click(maxwellButton);
    fireEvent.click(screen.getByRole('button', { name: 'add current page' }));

    await waitFor(() => {
      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        'librarian-maxwell-items',
        expect.stringContaining('"title":"Maxwell Cleanup"'),
      );
    });

    expect(await screen.findByText('Maxwell Cleanup')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));

    await waitFor(() => {
      expect(window.commandsAPI!.runLocalCommand).toHaveBeenCalledWith({
        customInstruction: 'Tighten this document.',
        mode: 'document',
      });
    });
  });

  it('uses selected content mode for Maxwell only when text is selected', () => {
    expect(getMaxwellToolbarRunMode(null)).toEqual({ mode: 'document' });
    expect(getMaxwellToolbarRunMode({ start: 4, end: 4 })).toEqual({ mode: 'document' });
    expect(getMaxwellToolbarRunMode({ start: 12, end: 4 })).toEqual({
      mode: 'selection',
      selection: { start: 4, end: 12 },
    });
    expect(getMaxwellToolbarRunMode({ start: 12, end: 4, text: 'selected' })).toEqual({
      mode: 'selection',
      selection: { start: 4, end: 12, text: 'selected' },
    });
  });

  it('builds inline Gemma commands only for selected text', () => {
    expect(getInlineGemmaLocalCommandRequest('', { start: 4, end: 12 })).toBeNull();
    expect(getInlineGemmaLocalCommandRequest('Tighten this', null)).toBeNull();
    expect(getInlineGemmaLocalCommandRequest('Tighten this', { start: 4, end: 4 })).toBeNull();
    expect(getInlineGemmaLocalCommandRequest('  Tighten this  ', { start: 12, end: 4 })).toEqual({
      customInstruction: 'Tighten this',
      mode: 'selection',
      selection: { start: 4, end: 12 },
    });
    expect(getInlineGemmaLocalCommandRequest('Tighten this', { start: 12, end: 4, text: 'Lipsum' })).toEqual({
      customInstruction: 'Tighten this',
      mode: 'selection',
      selection: { start: 4, end: 12, text: 'Lipsum' },
    });
  });

  it('opens html files as previews and css files as source', async () => {
    const htmlPath = '/Users/afar/.fieldtheory/library/reports/summary.html';
    const cssPath = '/Users/afar/.fieldtheory/library/reports/styles.css';
    Object.defineProperty(window, 'externalAPI', {
      configurable: true,
      value: {
        open: vi.fn(async (absPath: string) => ({
          path: absPath,
          name: absPath.endsWith('.css') ? 'styles.css' : 'summary.html',
          content: absPath.endsWith('.css')
            ? 'body { color: crimson; }'
            : '<!doctype html><link rel="stylesheet" href="./styles.css"><h1>Summary</h1>',
          mtime: 1,
          documentVersion: { mtimeMs: 1, size: 1, sha256: absPath.endsWith('.css') ? 'css' : 'html' },
        })),
        save: vi.fn(async () => ({ ok: true })),
        findLibraryFileByDocumentVersion: vi.fn(async () => null),
        rename: vi.fn(async () => null),
        delete: vi.fn(async () => false),
        onOpenExternal: vi.fn(() => () => {}),
      },
    });

    const { container, unmount } = render(
      <LibrarianView
        sidebarCollapsed={false}
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{ kind: 'external', path: htmlPath }}
      />,
    );

    await waitFor(() => {
      const iframe = container.querySelector('iframe[data-ft-html-preview="true"]') as HTMLIFrameElement | null;
      expect(iframe?.getAttribute('srcdoc')).toContain('<base href="file:///Users/afar/.fieldtheory/library/reports/">');
      expect(iframe?.getAttribute('sandbox')).toBe('');
      expect(iframe?.dataset.ftHtmlLayout).toBe('full');
      expect(iframe?.style.height).toBe('100%');
      expect(container.querySelector('[data-ft-librarian-content-scroll="true"]')?.getAttribute('style')).toContain('width: 100%');
      expect(container.querySelector('[data-ft-rendered-editor-input="true"]')).toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Use contained HTML layout' }));

    await waitFor(() => {
      const iframe = container.querySelector('iframe[data-ft-html-preview="true"]') as HTMLIFrameElement | null;
      expect(iframe?.dataset.ftHtmlLayout).toBe('contained');
      expect(iframe?.style.height).toBe('72vh');
      expect(iframe?.style.maxHeight).toBe('820px');
      expect(screen.getByRole('button', { name: 'Use full-width HTML layout' })).toBeTruthy();
      expect(window.localStorage.setItem).toHaveBeenCalledWith(
        LIBRARIAN_HTML_LAYOUT_STORAGE_KEY,
        JSON.stringify({ [htmlPath]: 'contained' }),
      );
    });

    unmount();
    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === LIBRARIAN_HTML_LAYOUT_STORAGE_KEY
        ? JSON.stringify({ [htmlPath]: 'contained' })
        : null
    ));

    const restoredHtmlRender = render(
      <LibrarianView
        sidebarCollapsed={false}
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{ kind: 'external', path: htmlPath }}
      />,
    );

    await waitFor(() => {
      const iframe = restoredHtmlRender.container.querySelector('iframe[data-ft-html-preview="true"]') as HTMLIFrameElement | null;
      expect(iframe?.dataset.ftHtmlLayout).toBe('contained');
      expect(screen.getByRole('button', { name: 'Use full-width HTML layout' })).toBeTruthy();
    });

    restoredHtmlRender.unmount();
    const cssRender = render(
      <LibrarianView
        sidebarCollapsed={false}
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{ kind: 'external', path: cssPath }}
      />,
    );

    await waitFor(() => {
      expect(cssRender.container.querySelector('iframe[data-ft-html-preview="true"]')).toBeNull();
      expect(cssRender.container.querySelector('.cm-editor')?.textContent).toContain('body { color: crimson; }');
      expect((screen.getByLabelText('Source only') as HTMLButtonElement).disabled).toBe(true);
    });
  }, 10000);

  it('honors markdown mode for initial external Library targets', async () => {
    const externalPath = '/Users/afar/.fieldtheory/library/reports/notes.md';
    const content = 'First paragraph.\n\nSecond paragraph.';
    Object.defineProperty(window, 'externalAPI', {
      configurable: true,
      value: {
        open: vi.fn(async () => ({
          path: externalPath,
          name: 'notes.md',
          content,
          mtime: 1,
          documentVersion: { mtimeMs: 1, size: content.length, sha256: 'external-target' },
        })),
        save: vi.fn(async () => ({ ok: true })),
        findLibraryFileByDocumentVersion: vi.fn(async () => null),
        rename: vi.fn(async () => null),
        delete: vi.fn(async () => false),
        onOpenExternal: vi.fn(() => () => {}),
      },
    });

    const selectionStart = content.indexOf('Second');
    const { container } = render(
      <LibrarianView
        sidebarCollapsed={false}
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{
          kind: 'external',
          path: externalPath,
          contentMode: 'markdown',
          selectionStart,
          selectionEnd: selectionStart + 'Second'.length,
        }}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('.cm-editor')?.textContent).toContain('Second paragraph.');
      expect(screen.getByLabelText('Switch to rendered view')).toBeTruthy();
    });
    expect(window.externalAPI!.open).toHaveBeenCalledWith(externalPath);
  });

  it('honors markdown mode for initial artifact targets', async () => {
    const artifactPath = '/tmp/library/brief.md';
    const content = 'Artifact intro.\n\nArtifact next.';
    const reading = {
      path: artifactPath,
      title: 'brief.md',
      content,
      context: null,
      readingTime: null,
      modelSignature: null,
      createdAt: 0,
      mtime: 1,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'artifact-target' },
    };
    window.librarianAPI!.getReadings = vi.fn(async () => [reading]);
    window.librarianAPI!.getReading = vi.fn(async () => reading);

    const selectionStart = content.indexOf('next');
    const { container } = render(
      <LibrarianView
        sidebarCollapsed={false}
        onSwitchToClipboard={vi.fn()}
        initialOpenTarget={{
          kind: 'artifact',
          path: artifactPath,
          contentMode: 'markdown',
          selectionStart,
          selectionEnd: selectionStart + 'next'.length,
        }}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('.cm-editor')?.textContent).toContain('Artifact next.');
      expect(screen.getByLabelText('Switch to rendered view')).toBeTruthy();
    });
    expect(window.librarianAPI!.getReading).toHaveBeenCalledWith(artifactPath);
  });

  it('renders task list markers as native checkbox controls in rendered editing', async () => {
    const relPath = 'scratchpad/rendered-task-text-test';
    const content = '- [ ] open task\n- [x] done task';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-task-text-test',
      title: 'rendered-task-text-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'task-text-version' },
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('open task');
      expect(root?.textContent).toContain('done task');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    const renderedInput = await waitFor(() => {
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(input?.closest('.cm-editor')).toBeTruthy();
      return input;
    });
    if (!renderedInput) throw new Error('Rendered editor input missing');

    const checkboxes = renderedInput.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0].checked).toBe(false);
    expect(checkboxes[1].checked).toBe(true);
    expect(renderedInput.textContent).not.toContain('[ ]');
    expect(renderedInput.textContent).not.toContain('[x]');
  });

	  it('saves rendered editor edits without replacing the active input', async () => {
	    const relPath = 'scratchpad/rendered-native-typing-test';
	    const content = 'hello world';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-native-typing-test',
      title: 'rendered-native-typing-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'native-version' },
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: content.length + 1, sha256: 'native-saved-version' },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('hello world');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    fireEvent.click(renderedRoot);
    const renderedInput = await waitFor(() => {
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(input?.textContent).toContain('hello world');
      return input;
    });
    if (!renderedInput) throw new Error('Rendered editor missing');
    pasteText(renderedInput, '!');

    await waitFor(() => {
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        'hello world!',
        page.documentVersion,
      );
    }, { timeout: 1200 });
	    expect(container.querySelector('[data-ft-rendered-editor-input="true"]')).toBe(renderedInput);
	    expect(renderedInput.textContent).toContain('hello world!');
	  });

  it('does not append rendered editor debug entries while debug is disabled', async () => {
    const relPath = 'scratchpad/rendered-debug-disabled-test';
    const content = 'hello world';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-debug-disabled-test',
      title: 'rendered-debug-disabled-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'debug-disabled-version' },
    };
    const appendRenderedEditorDebug = vi.fn(async (_entry: unknown) => ({ ok: true, path: '/tmp/rendered-debug.log' }));

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: content.length + 1, sha256: 'debug-disabled-saved-version' },
    });
    Object.defineProperty(window, 'diagnosticsAPI', {
      configurable: true,
      value: {
        getDiagnostics: vi.fn(async () => ({})),
        getDiagnosticsMarkdown: vi.fn(async () => ''),
        appendRenderedEditorDebug,
        getRenderedEditorDebugLogPath: vi.fn(async () => '/tmp/rendered-debug.log'),
        clearRenderedEditorDebugLog: vi.fn(async () => ({ ok: true, path: '/tmp/rendered-debug.log' })),
      },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('hello world');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    fireEvent.click(renderedRoot);
    const renderedInput = await waitFor(() => {
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(input?.textContent).toContain('hello world');
      return input;
    });
    if (!renderedInput) throw new Error('Rendered editor missing');
    pasteText(renderedInput, '!');

    await waitFor(() => {
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        'hello world!',
        page.documentVersion,
      );
    }, { timeout: 1200 });
    expect(appendRenderedEditorDebug).not.toHaveBeenCalled();
  });

  it('records rendered editor timing entries while debug is enabled', async () => {
    const relPath = 'scratchpad/rendered-debug-timing-test';
    const content = Array.from({ length: 120 }, (_, index) => (
      index % 4 === 0
        ? `- [ ] task ${index} with **bold** and [[Target ${index}]]`
        : `Paragraph ${index} with [a link](https://example.com/${index}) and *emphasis*.`
    )).join('\n');
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-debug-timing-test',
      title: 'rendered-debug-timing-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'debug-timing-version' },
    };
    const appendRenderedEditorDebug = vi.fn(async (_entry: unknown) => ({ ok: true, path: '/tmp/rendered-debug.log' }));

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => {
      if (key === 'fieldtheory-rendered-editor-debug') return 'true';
      if (key === 'librarian-last-selection') return JSON.stringify({ type: 'wiki', relPath });
      return null;
    });
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: content.length + 1, sha256: 'debug-timing-saved-version' },
    });
    Object.defineProperty(window, 'diagnosticsAPI', {
      configurable: true,
      value: {
        getDiagnostics: vi.fn(async () => ({})),
        getDiagnosticsMarkdown: vi.fn(async () => ''),
        appendRenderedEditorDebug,
        getRenderedEditorDebugLogPath: vi.fn(async () => '/tmp/rendered-debug.log'),
        clearRenderedEditorDebugLog: vi.fn(async () => ({ ok: true, path: '/tmp/rendered-debug.log' })),
      },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('Paragraph 1');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    fireEvent.click(renderedRoot);
    const renderedInput = await waitFor(() => {
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(input?.textContent).toContain('Paragraph 1');
      return input;
    });
    if (!renderedInput) throw new Error('Rendered editor missing');
    pasteText(renderedInput, '!');

    await waitFor(() => {
      const stages = appendRenderedEditorDebug.mock.calls.map(([entry]) => (entry as { stage?: string }).stage);
      expect(stages).toContain('apply-rendered-editor-body');
      expect(stages).toContain('local-content-state-scheduled');
      expect(stages).toContain('editor-session-persist-scheduled');
      expect(stages).toContain('save-scheduled');
    }, { timeout: 1200 });

    const timingEntries = appendRenderedEditorDebug.mock.calls
      .map(([entry]) => entry as { stage?: string; details?: Record<string, unknown> })
      .filter((entry) => (
        entry.stage === 'apply-rendered-editor-body'
        || entry.stage === 'local-content-state-scheduled'
        || entry.stage === 'handle-rendered-editor-change'
        || entry.stage === 'editor-session-persist-scheduled'
        || entry.stage === 'save-scheduled'
      ));
    expect(timingEntries.length).toBeGreaterThan(0);
    expect(timingEntries.filter((entry) => (
      entry.stage === 'apply-rendered-editor-body'
      || entry.stage === 'local-content-state-scheduled'
      || entry.stage === 'handle-rendered-editor-change'
    )).every((entry) => typeof entry.details?.durationMs === 'number')).toBe(true);
    expect(timingEntries.find((entry) => entry.stage === 'editor-session-persist-scheduled')?.details?.delayMs).toBe(160);
    expect(timingEntries.find((entry) => entry.stage === 'save-scheduled')?.details?.delayMs).toBeGreaterThan(0);
  });

  it('waits for a quiet rendered typing window before autosaving', async () => {
    const relPath = 'scratchpad/rendered-quiet-save-test';
    const content = 'quiet save';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-quiet-save-test',
      title: 'rendered-quiet-save-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'quiet-save-version' },
    };
    const appendRenderedEditorDebug = vi.fn(async (_entry: unknown) => ({ ok: true, path: '/tmp/rendered-debug.log' }));

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => {
      if (key === 'fieldtheory-rendered-editor-debug') return 'true';
      if (key === 'librarian-last-selection') return JSON.stringify({ type: 'wiki', relPath });
      return null;
    });
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: content.length + 1, sha256: 'quiet-save-saved-version' },
    });
    Object.defineProperty(window, 'diagnosticsAPI', {
      configurable: true,
      value: {
        getDiagnostics: vi.fn(async () => ({})),
        getDiagnosticsMarkdown: vi.fn(async () => ''),
        appendRenderedEditorDebug,
        getRenderedEditorDebugLogPath: vi.fn(async () => '/tmp/rendered-debug.log'),
        clearRenderedEditorDebugLog: vi.fn(async () => ({ ok: true, path: '/tmp/rendered-debug.log' })),
      },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('quiet save');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    fireEvent.click(renderedRoot);
    const renderedInput = await waitFor(() => {
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(input?.textContent).toContain('quiet save');
      return input;
    });
    if (!renderedInput) throw new Error('Rendered editor missing');
    pasteText(renderedInput, '!');

    await waitFor(() => {
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        'quiet save!',
        page.documentVersion,
      );
    }, { timeout: 1800 });
  }, 15000);

  it('keeps River sync in the background after a rendered editor save', async () => {
    const relPath = 'scratchpad/rendered-shared-background-sync-test';
    const content = 'local first';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-shared-background-sync-test',
      title: 'rendered-shared-background-sync-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'rendered-shared-version' },
    };
    const updateContent = vi.fn(async () => ({ ok: true, revision: 2 }));

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: content.length + 1, sha256: 'rendered-shared-saved-version' },
    });
    Object.defineProperty(window, 'sharedFilesAPI', {
      configurable: true,
      value: {
        getAvailability: vi.fn(async () => ({ available: true, hasTeamMembers: true })),
        getStatus: vi.fn(async () => ({ shared: true, sharedId: 'shared-1', revision: 1 })),
        updateContent,
        setActivePresence: vi.fn(async () => []),
        onPresenceChanged: vi.fn(() => () => {}),
      },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('local first');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    await waitFor(() => {
      expect(window.sharedFilesAPI!.setActivePresence).toHaveBeenCalledWith('shared-1');
    });

    fireEvent.click(renderedRoot);
    const renderedInput = await waitFor(() => {
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(input?.textContent).toContain('local first');
      return input;
    });
    if (!renderedInput) throw new Error('Rendered editor missing');
    pasteText(renderedInput, '!');

    await waitFor(() => {
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        'local first!',
        page.documentVersion,
      );
    }, { timeout: 1200 });
    expect(updateContent).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(updateContent).toHaveBeenCalledWith('shared-1', 'local first!', 1, page.absPath);
    }, { timeout: 2600 });
  });

  it('uses the River cache version after background sync rewrites the active file', async () => {
    const relPath = 'River (shared)/recent-river-file';
    const content = 'river first';
    const syncedVersion = { mtimeMs: 3, size: 128, sha256: 'river-cache-after-sync' };
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'recent-river-file',
      title: 'recent-river-file',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'river-initial-version' },
    };
    const updateContent = vi.fn(async () => ({ ok: true, revision: 2, cachePath: page.absPath }));

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save)
      .mockResolvedValueOnce({
        ok: true,
        version: { mtimeMs: 2, size: content.length + 1, sha256: 'river-local-save-version' },
      })
      .mockResolvedValueOnce({
        ok: true,
        version: { mtimeMs: 4, size: content.length + 2, sha256: 'river-second-save-version' },
      });
    Object.defineProperty(window, 'externalAPI', {
      configurable: true,
      value: {
        ...window.externalAPI,
        open: vi.fn(async () => ({
          path: page.absPath,
          name: 'recent-river-file.md',
          content: 'river first!',
          mtime: 3,
          documentVersion: syncedVersion,
        })),
        onOpenExternal: vi.fn(() => () => {}),
      },
    });
    Object.defineProperty(window, 'sharedFilesAPI', {
      configurable: true,
      value: {
        getAvailability: vi.fn(async () => ({ available: true, hasTeamMembers: true })),
        getStatus: vi.fn(async () => ({ shared: true, sharedId: 'shared-1', revision: 1 })),
        updateContent,
        setActivePresence: vi.fn(async () => []),
        onPresenceChanged: vi.fn(() => () => {}),
      },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('river first');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    fireEvent.click(renderedRoot);
    const renderedInput = await waitFor(() => {
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(input?.textContent).toContain('river first');
      return input;
    });
    if (!renderedInput) throw new Error('Rendered editor missing');
    pasteText(renderedInput, '!');

    await waitFor(() => {
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        'river first!',
        page.documentVersion,
      );
    }, { timeout: 1200 });

    await waitFor(() => {
      expect(updateContent).toHaveBeenCalledWith('shared-1', 'river first!', 1, page.absPath);
      expect(window.externalAPI!.open).toHaveBeenCalledWith(page.absPath);
    }, { timeout: 2600 });

    pasteText(renderedInput, '?');

    await waitFor(() => {
      expect(window.wikiAPI!.save).toHaveBeenCalledTimes(2);
      expect(window.wikiAPI!.save).toHaveBeenNthCalledWith(
        2,
        relPath,
        'river first!?',
        syncedVersion,
      );
    }, { timeout: 1200 });
  });

  it('syncs River once when shared files become available', async () => {
    const sync = vi.fn(async () => ({ written: 0, removed: 0, created: 1, errors: [] }));
    const riverChanged = vi.fn();
    window.addEventListener('fieldtheory:river-changed-local', riverChanged);
    Object.defineProperty(window, 'sharedFilesAPI', {
      configurable: true,
      value: {
        getAvailability: vi.fn(async () => ({ available: true, hasTeamMembers: true })),
        getStatus: vi.fn(async () => ({ shared: false })),
        sync,
        setActivePresence: vi.fn(async () => []),
        onPresenceChanged: vi.fn(() => () => {}),
      },
    });

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    await waitFor(() => {
      expect(sync).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(riverChanged).toHaveBeenCalledTimes(1);
    });
    window.removeEventListener('fieldtheory:river-changed-local', riverChanged);
  });

  it('retries River background sync after a failed rendered editor save sync', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const relPath = 'scratchpad/rendered-shared-background-sync-retry-test';
    const content = 'retry local first';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-shared-background-sync-retry-test',
      title: 'rendered-shared-background-sync-retry-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'rendered-shared-retry-version' },
    };
    const updateContent = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ ok: true, revision: 2 });

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: content.length + 1, sha256: 'rendered-shared-retry-saved-version' },
    });
    Object.defineProperty(window, 'sharedFilesAPI', {
      configurable: true,
      value: {
        getAvailability: vi.fn(async () => ({ available: true, hasTeamMembers: true })),
        getStatus: vi.fn(async () => ({ shared: true, sharedId: 'shared-1', revision: 1 })),
        updateContent,
        setActivePresence: vi.fn(async () => []),
        onPresenceChanged: vi.fn(() => () => {}),
      },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('retry local first');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    fireEvent.click(renderedRoot);
    const renderedInput = await waitFor(() => {
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(input?.textContent).toContain('retry local first');
      return input;
    });
    if (!renderedInput) throw new Error('Rendered editor missing');
    pasteText(renderedInput, '!');

    await waitFor(() => {
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        'retry local first!',
        page.documentVersion,
      );
    }, { timeout: 1200 });

    await waitFor(() => {
      expect(updateContent).toHaveBeenCalledTimes(2);
    }, { timeout: 3800 });
    expect(updateContent).toHaveBeenNthCalledWith(1, 'shared-1', 'retry local first!', 1, page.absPath);
    expect(updateContent).toHaveBeenNthCalledWith(2, 'shared-1', 'retry local first!', 1, page.absPath);
    warnSpy.mockRestore();
  });

	  it('pastes markdown text into rendered mode as rendered document structure', async () => {
	    const relPath = 'scratchpad/rendered-markdown-paste-test';
	    const content = 'hello';
	    const page: WikiPage = {
	      relPath,
	      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
	      name: 'rendered-markdown-paste-test',
	      title: 'rendered-markdown-paste-test',
	      lastUpdated: 1,
	      content,
	      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'markdown-paste-version' },
	    };

	    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
	      key === 'librarian-last-selection'
	        ? JSON.stringify({ type: 'wiki', relPath })
	        : null
	    ));
	    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
	    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
	      ok: true,
	      version: { mtimeMs: 2, size: 'hello\n# Pasted Heading\n- one'.length, sha256: 'markdown-paste-saved-version' },
	    });

	    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

	    const renderedRoot = await waitFor(() => {
	      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
	      expect(root?.textContent).toContain('hello');
	      return root;
	    });
	    if (!renderedRoot) throw new Error('Rendered editor root missing');

	    fireEvent.click(renderedRoot);
	    const renderedInput = await waitFor(() => {
	      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
	      expect(input?.textContent).toContain('hello');
	      return input;
	    });
	    if (!renderedInput) throw new Error('Rendered editor missing');

	    pasteText(renderedInput, '\n# Pasted Heading\n- one');

	    await waitFor(() => {
	      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
	        relPath,
	        'hello\n# Pasted Heading\n- one',
	        page.documentVersion,
	      );
	      expect(renderedInput.textContent).toContain('Pasted Heading');
	      expect(renderedInput.textContent).toContain('one');
	      expect(renderedInput.textContent).not.toContain('# Pasted Heading');
	    }, { timeout: 1200 });
	  });

	  it('pastes clipboard images into the rendered editor without switching to source mode', async () => {
	    const relPath = 'scratchpad/rendered-image-paste-test';
    const content = 'hello image';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-image-paste-test',
      title: 'rendered-image-paste-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'image-paste-version' },
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: 67, sha256: 'image-paste-saved-version' },
    });
    Object.defineProperty(window, 'clipboardAPI', {
      configurable: true,
      value: {
        getClipboardImagePath: vi.fn(async () => '/Users/afar/Pictures/Test Image.png'),
      },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('hello image');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    fireEvent.click(renderedRoot);
    const renderedInput = await waitFor(() => {
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(input?.textContent).toContain('hello image');
      return input;
    });
    if (!renderedInput) throw new Error('Rendered editor missing');

    pasteImage(renderedInput);

    await waitFor(() => {
      expect(window.clipboardAPI!.getClipboardImagePath).toHaveBeenCalled();
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        'hello image![Image](<file:///Users/afar/Pictures/Test%20Image.png>)',
        page.documentVersion,
      );
    }, { timeout: 1200 });
    expect(container.querySelector('[data-ft-rendered-editor-input="true"]')).toBe(renderedInput);
    expect(container.querySelector('textarea[data-ft-rendered-editor-input="true"]')).toBeNull();
  });

  it('pastes clipboard image files into the rendered editor without reading the global clipboard', async () => {
    const relPath = 'scratchpad/rendered-image-file-paste-test';
    const content = 'hello image file';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-image-file-paste-test',
      title: 'rendered-image-file-paste-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'image-file-paste-version' },
    };
    const getClipboardImagePath = vi.fn(async () => '/Users/afar/Pictures/Global Clipboard.png');
    const savePastedImageFile = vi.fn(async () => '/Users/afar/Pictures/Phone Photo.jpg');

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: 80, sha256: 'image-file-paste-saved-version' },
    });
    Object.defineProperty(window, 'clipboardAPI', {
      configurable: true,
      value: {
        getClipboardImagePath,
        savePastedImageFile,
      },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('hello image file');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    fireEvent.click(renderedRoot);
    const renderedInput = await waitFor(() => {
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(input?.textContent).toContain('hello image file');
      return input;
    });
    if (!renderedInput) throw new Error('Rendered editor missing');

    pasteImageFile(renderedInput, new File([new Uint8Array([1, 2, 3])], 'Phone Photo.jpg', { type: 'image/jpeg' }));

    await waitFor(() => {
      expect(savePastedImageFile).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Phone Photo.jpg',
        type: 'image/jpeg',
        data: expect.any(Uint8Array),
      }));
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        'hello image file![Image](<file:///Users/afar/Pictures/Phone%20Photo.jpg>)',
        page.documentVersion,
      );
    }, { timeout: 1200 });
    expect(getClipboardImagePath).not.toHaveBeenCalled();
  });

  it('pastes clipboard image files into markdown source without reading the global clipboard', async () => {
    const relPath = 'scratchpad/source-image-file-paste-test';
    const content = 'hello source image';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'source-image-file-paste-test',
      title: 'source-image-file-paste-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'source-image-file-paste-version' },
    };
    const getClipboardImagePath = vi.fn(async () => '/Users/afar/Pictures/Global Clipboard.png');
    const savePastedImageFile = vi.fn(async () => '/Users/afar/Pictures/Phone Source Photo.png');

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: 90, sha256: 'source-image-file-paste-saved-version' },
    });
    Object.defineProperty(window, 'clipboardAPI', {
      configurable: true,
      value: {
        getClipboardImagePath,
        savePastedImageFile,
      },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('hello source image');
    });
    fireEvent.click(screen.getByLabelText('Switch to Markdown source'));

    const sourceInput = await waitFor(() => {
      const input = container.querySelector('.cm-content') as HTMLElement | null;
      expect(input).toBeTruthy();
      return input;
    });
    if (!sourceInput) throw new Error('Markdown source input missing');

    pasteImageFile(sourceInput, new File([new Uint8Array([4, 5, 6])], 'Phone Source Photo.png', { type: 'image/png' }));

    await waitFor(() => {
      expect(savePastedImageFile).toHaveBeenCalledWith(expect.objectContaining({
        name: 'Phone Source Photo.png',
        type: 'image/png',
        data: expect.any(Uint8Array),
      }));
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        '![Image](<file:///Users/afar/Pictures/Phone%20Source%20Photo.png>)hello source image',
        page.documentVersion,
      );
    }, { timeout: 1200 });
    expect(getClipboardImagePath).not.toHaveBeenCalled();
  });

  it('opens a Quick Look style preview when a rendered editor image is clicked', async () => {
    const relPath = 'scratchpad/rendered-image-preview-test';
    const content = '![Diagram](<file:///tmp/Figure%201.png>)';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-image-preview-test',
      title: 'rendered-image-preview-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'image-preview-version' },
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedImage = await waitFor(() => {
      const image = container.querySelector('.cm-rendered-markdown-image img') as HTMLImageElement | null;
      expect(image?.getAttribute('src')).toBe('ftlocalfile:///tmp/Figure%201.png');
      return image;
    });
    if (!renderedImage) throw new Error('Rendered image missing');

    fireEvent.click(renderedImage);

    await waitFor(() => {
      const previewImage = container.querySelector('[data-ft-image-preview-img="true"]') as HTMLImageElement | null;
      expect(previewImage?.getAttribute('src')).toBe('ftlocalfile:///tmp/Figure%201.png');
      expect(previewImage?.getAttribute('alt')).toBe('Diagram');
    });
  });

  it('preserves frontmatter while editing the rendered editor body', async () => {
    const relPath = 'scratchpad/rendered-frontmatter-test';
    const content = '---\ntodo: true\ntodo_state: open\n---\n\nhello';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-frontmatter-test',
      title: 'rendered-frontmatter-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'frontmatter-version' },
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: content.length + 1, sha256: 'frontmatter-saved-version' },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('hello');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    fireEvent.click(renderedRoot);
    const renderedInput = await waitFor(() => {
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(input?.textContent).toContain('hello');
      return input;
    });
    if (!renderedInput) throw new Error('Rendered editor missing');

    pasteText(renderedInput, '!');

    await waitFor(() => {
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        '---\ntodo: true\ntodo_state: open\n---\n\nhello!',
        page.documentVersion,
      );
    }, { timeout: 1200 });
  });

  it('preserves artifact frontmatter while editing the rendered editor body', async () => {
    const artifactPath = '/tmp/library/artifact.md';
    const content = '---\ncontent_edited_at: 1234\n---\n\nhello';
    const reading = {
      path: artifactPath,
      title: 'artifact.md',
      context: null,
      readingTime: null,
      modelSignature: null,
      createdAt: 0,
      mtime: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'artifact-frontmatter-version' },
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'artifact', path: artifactPath })
        : null
    ));
    window.librarianAPI!.getReadings = vi.fn(async () => [reading]);
    window.librarianAPI!.getReading = vi.fn(async () => reading);
    window.librarianAPI!.saveReading = vi.fn(async () => ({
      ok: true as const,
      version: { mtimeMs: 2, size: content.length + 1, sha256: 'artifact-frontmatter-saved-version' },
    }));

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('hello');
      expect(root?.textContent).not.toContain('content_edited_at');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    fireEvent.click(renderedRoot);
    const renderedInput = await waitFor(() => {
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(input?.textContent).toContain('hello');
      expect(input?.textContent).not.toContain('content_edited_at');
      return input;
    });
    if (!renderedInput) throw new Error('Rendered editor missing');

    pasteText(renderedInput, '!');

    await waitFor(() => {
      expect(window.librarianAPI!.saveReading).toHaveBeenCalledWith(
        artifactPath,
        '---\ncontent_edited_at: 1234\n---\n\nhello!',
        reading.documentVersion,
      );
    }, { timeout: 1200 });
  });

  it('lets rendered editor input create the next rendered body line', async () => {
    const relPath = 'scratchpad/rendered-enter-blank-line-test';
    const content = 'hello';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-enter-blank-line-test',
      title: 'rendered-enter-blank-line-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'enter-version' },
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: 7, sha256: 'enter-saved-version' },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('hello');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    fireEvent.click(renderedRoot);
    const renderedInput = await waitFor(() => {
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(input?.textContent).toContain('hello');
      return input;
    });
    if (!renderedInput) throw new Error('Rendered editor missing');
    pasteText(renderedInput, '\nx');

    await waitFor(() => {
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        'hello\nx',
        page.documentVersion,
      );
    }, { timeout: 1200 });
  });

  it('continues rendered list items on Enter without showing markdown syntax', async () => {
    const relPath = 'scratchpad/rendered-enter-list-test';
    const content = '- first';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-enter-list-test',
      title: 'rendered-enter-list-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'rendered-enter-list-version' },
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: '- first\n- '.length, sha256: 'rendered-enter-list-saved-version' },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('first');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    fireEvent.click(renderedRoot);
    const renderedInput = await waitFor(() => {
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(input?.textContent).toContain('first');
      return input;
    });
    if (!renderedInput) throw new Error('Rendered editor missing');

    fireEvent.keyDown(renderedInput, { key: 'Enter' });

    await waitFor(() => {
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        '- first\n- ',
        page.documentVersion,
      );
    }, { timeout: 1200 });
  });

	  it('starts an ordered list from an empty rendered editor with Command+Shift+7', async () => {
	    const relPath = 'scratchpad/rendered-empty-ordered-list-test';
	    const content = '';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-empty-ordered-list-test',
      title: 'rendered-empty-ordered-list-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: 0, sha256: 'rendered-empty-list-version' },
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: '1. '.length, sha256: 'rendered-empty-list-saved-version' },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root).toBeTruthy();
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    fireEvent.click(renderedRoot);
    const renderedInput = await waitFor(() => {
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(input).toBeTruthy();
      return input;
    });
    if (!renderedInput) throw new Error('Rendered editor missing');

    fireEvent.keyDown(renderedInput, { key: '&', code: 'Digit7', metaKey: true, shiftKey: true });

    await waitFor(() => {
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        '1. ',
        page.documentVersion,
      );
    }, { timeout: 1200 });
  });

  it('handles rendered editor Command+/ as focus mode without inserting a comment', async () => {
    const relPath = 'scratchpad/rendered-focus-toggle-test';
    const content = 'plain line';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-focus-toggle-test',
      title: 'rendered-focus-toggle-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'rendered-focus-toggle-version' },
    };
    const onFocusChromeEnabledChange = vi.fn();

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);

    const { container } = render(
      <LibrarianView
        sidebarCollapsed={false}
        onSwitchToClipboard={vi.fn()}
        focusChromeEnabled={false}
        onFocusChromeEnabledChange={onFocusChromeEnabledChange}
      />,
    );

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('plain line');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    fireEvent.click(renderedRoot);
    const renderedInput = await waitFor(() => {
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(input?.textContent).toContain('plain line');
      return input;
    });
    if (!renderedInput) throw new Error('Rendered editor missing');

    const propagated = fireEvent.keyDown(renderedInput, {
      key: '/',
      code: 'Slash',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });

    expect(propagated).toBe(false);
    expect(onFocusChromeEnabledChange).toHaveBeenCalledWith(true);
    expect(window.wikiAPI!.save).not.toHaveBeenCalled();
    expect(renderedInput.textContent).not.toContain('<!--');
  });

  it('lets rendered editor input complete wiki links', async () => {
    const relPath = 'scratchpad/rendered-wiki-link-completion-test';
    const content = 'See ';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-wiki-link-completion-test',
      title: 'rendered-wiki-link-completion-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'rendered-wiki-link-version' },
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getTree).mockResolvedValue([{
      name: 'scratchpad',
      files: [{
        relPath: 'scratchpad/consensus',
        absPath: '/Users/afar/.fieldtheory/library/scratchpad/consensus.md',
        name: 'consensus',
        title: 'Consensus',
        lastUpdated: 2,
      }],
    }] as any);
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: 'See [[Consensus]]'.length, sha256: 'rendered-wiki-link-saved-version' },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('See');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    fireEvent.click(renderedRoot);
    const renderedInput = await waitFor(() => {
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(input?.textContent).toContain('See');
      return input;
    });
    if (!renderedInput) throw new Error('Rendered editor missing');

    pasteText(renderedInput, '[[Con');

    const listbox = await screen.findByRole('listbox', { name: 'Wiki link suggestions' });
    fireEvent.click(within(listbox).getByRole('option', { name: /Consensus/ }));

    await waitFor(() => {
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        'See [[Consensus]]',
        expect.any(Object),
      );
    }, { timeout: 1200 });
  });

  it('lets rendered editor input complete @bookmarks mentions', async () => {
    const relPath = 'scratchpad/rendered-bookmarks-mention-completion-test';
    const content = 'See ';
    const nextContent = 'See [@bookmarks](bookmarks://root)';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-bookmarks-mention-completion-test',
      title: 'rendered-bookmarks-mention-completion-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'rendered-bookmarks-mention-version' },
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getTree).mockResolvedValue([]);
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: nextContent.length, sha256: 'rendered-bookmarks-mention-saved-version' },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('See');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    fireEvent.click(renderedRoot);
    const renderedInput = await waitFor(() => {
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(input?.textContent).toContain('See');
      return input;
    });
    if (!renderedInput) throw new Error('Rendered editor missing');

    pasteText(renderedInput, '@boo');

    const listbox = await screen.findByRole('listbox', { name: 'Mention suggestions' });
    fireEvent.click(within(listbox).getByRole('option', { name: /bookmarks/ }));

    await waitFor(() => {
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        nextContent,
        expect.any(Object),
      );
    }, { timeout: 1200 });
  });

  it('keeps rendered wiki link completion editable when deleting a character', async () => {
    const relPath = 'scratchpad/rendered-wiki-link-delete-test';
    const content = 'See ';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-wiki-link-delete-test',
      title: 'rendered-wiki-link-delete-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'rendered-wiki-link-delete-version' },
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getTree).mockResolvedValue([{
      name: 'scratchpad',
      files: [{
        relPath: 'scratchpad/consensus',
        absPath: '/Users/afar/.fieldtheory/library/scratchpad/consensus.md',
        name: 'consensus',
        title: 'Consensus',
        lastUpdated: 2,
      }],
    }] as any);
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: 'See [[Co'.length, sha256: 'rendered-wiki-link-delete-saved-version' },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('See');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    fireEvent.click(renderedRoot);
    const renderedInput = await waitFor(() => {
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(input?.textContent).toContain('See');
      return input;
    });
    if (!renderedInput) throw new Error('Rendered editor missing');

    pasteText(renderedInput, '[[Con');
    await screen.findByRole('listbox', { name: 'Wiki link suggestions' });
    fireEvent.keyDown(renderedInput, { key: 'Backspace' });

    await waitFor(() => {
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        'See [[Co',
        expect.any(Object),
      );
    }, { timeout: 1200 });
  });

  it('shows linked documents at the bottom of rendered wiki content', async () => {
    const relPath = 'scratchpad/rendered-linked-source';
    const targetRelPath = 'scratchpad/target-page';
    const content = 'See [[Target Page]].';
    const activePage: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-linked-source',
      title: 'Rendered Linked Source',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'rendered-linked-source-version' },
    };
    const targetPage: WikiPage = {
      relPath: targetRelPath,
      absPath: `/Users/afar/.fieldtheory/library/${targetRelPath}.md`,
      name: 'target-page',
      title: 'Target Page',
      lastUpdated: 2,
      content: 'Target body',
      documentVersion: { mtimeMs: 2, size: 'Target body'.length, sha256: 'target-page-version' },
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getTree).mockResolvedValue([{
      name: 'scratchpad',
      files: [
        {
          relPath,
          absPath: activePage.absPath,
          name: activePage.name,
          title: activePage.title,
          lastUpdated: activePage.lastUpdated,
        },
        {
          relPath: targetRelPath,
          absPath: targetPage.absPath,
          name: targetPage.name,
          title: targetPage.title,
          lastUpdated: targetPage.lastUpdated,
        },
      ],
    }] as any);
    vi.mocked(window.wikiAPI!.getPage).mockImplementation(async (pageRelPath) => {
      if (pageRelPath === relPath) return activePage;
      if (pageRelPath === targetRelPath) return targetPage;
      return null;
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    await waitFor(() => {
      const renderedRoot = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(renderedRoot?.textContent).toContain('See');
    });
    const linkedSection = await screen.findByLabelText('Linked');
    expect(within(linkedSection).getByRole('button', { name: /Target Page/ })).toBeTruthy();
    const bottomScrollSpace = container.querySelector('[data-ft-rendered-bottom-scroll-space="library"]');
    if (!bottomScrollSpace) throw new Error('Rendered bottom scroll space missing');
    expect(Boolean(linkedSection.compareDocumentPosition(bottomScrollSpace) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('refreshes command link discovery when the Browser helper event stream reconnects', async () => {
    const relPath = 'scratchpad/rendered-command-link-source';
    const content = 'See [[Review]].';
    const activePage: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-command-link-source',
      title: 'Rendered Command Link Source',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'rendered-command-link-source-version' },
    };
    const reviewCommand = {
      name: 'review',
      displayName: 'Review',
      filePath: '/Users/afar/.fieldtheory/library/Commands/review.md',
      lastModified: 2,
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    const getTree = vi.fn(async () => [{
      name: 'scratchpad',
      files: [{
        relPath,
        absPath: activePage.absPath,
        name: activePage.name,
        title: activePage.title,
        lastUpdated: activePage.lastUpdated,
      }],
    }] as any);
    vi.mocked(window.wikiAPI!.getTree).mockImplementation(getTree);
    vi.mocked(window.wikiAPI!.getPage).mockImplementation(async (pageRelPath) => (
      pageRelPath === relPath ? activePage : null
    ));
    const getCommands = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([reviewCommand]);
    vi.mocked(window.commandsAPI!.getCommands).mockImplementation(getCommands);

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    await waitFor(() => {
      const renderedRoot = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(renderedRoot?.textContent).toContain('See');
    });
    expect(getCommands).toHaveBeenCalledTimes(1);
    getTree.mockClear();

    act(() => {
      window.dispatchEvent(new Event('fieldtheory:browser-helper-event-stream-open'));
    });

    await waitFor(() => {
      expect(getCommands).toHaveBeenCalledTimes(2);
      expect(getTree).toHaveBeenCalled();
    });
  });

  it('keeps leading spaces in the rendered editor', async () => {
    const relPath = 'scratchpad/rendered-leading-space-test';
    const content = '';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-leading-space-test',
      title: 'rendered-leading-space-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: 0, sha256: 'leading-space-version' },
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: 2, sha256: 'leading-space-saved-version' },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(root).toBeTruthy();
      expect(input?.closest('.cm-editor')).toBeTruthy();
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    fireEvent.click(renderedRoot);
    const renderedInput = await waitFor(() => {
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(input).toBeTruthy();
      return input;
    });
    if (!renderedInput) throw new Error('Rendered editor missing');
    pasteText(renderedInput, '  ');
    await waitFor(() => {
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        '  ',
        page.documentVersion,
      );
    }, { timeout: 1200 });
  });

  it('archives the selected sidebar file with e and undoes it with Cmd+Z', async () => {
    const relPath = 'scratchpad/keyboard-archive-test';
    const absPath = `/Users/afar/.fieldtheory/library/${relPath}.md`;
    let content = 'hello archive';
    let version: DocumentVersion = { mtimeMs: 1, size: content.length, sha256: 'archive-version-1' };
    const makePage = (): WikiPage => ({
      relPath,
      absPath,
      name: 'keyboard-archive-test',
      title: 'keyboard-archive-test',
      lastUpdated: 1,
      content,
      documentVersion: version,
    });
    const makeRoot = (): LibraryRoot => ({
      path: '/Users/afar/.fieldtheory/library',
      label: 'Library',
      builtin: true,
      tree: [{
        kind: 'dir' as const,
        name: 'scratchpad',
        relPath: 'scratchpad',
        children: [{
          kind: 'file' as const,
          relPath,
          absPath,
          name: 'keyboard-archive-test',
          title: 'keyboard-archive-test',
          lastUpdated: 1,
          archived: content.includes('archived: true') ? true : undefined,
        }],
      }],
    });

    mockStoredWikiSelection(relPath, { expandScratchpad: true });
    vi.mocked(window.wikiAPI!.getPage).mockImplementation(async () => makePage());
    vi.mocked(window.libraryAPI!.getRoots).mockImplementation(async () => [makeRoot()]);
    vi.mocked(window.wikiAPI!.save).mockImplementation(async (_relPath, nextContent) => {
      content = nextContent;
      version = {
        mtimeMs: version.mtimeMs + 1,
        size: nextContent.length,
        sha256: `archive-version-${version.mtimeMs + 1}`,
      };
      return { ok: true, version };
    });

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const sidebarItem = await screen.findByText('keyboard-archive-test');
    fireEvent.mouseDown(sidebarItem);
    fireEvent.click(sidebarItem);

    fireEvent.keyDown(window, { key: 'e' });

    await waitFor(() => {
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        '---\narchived: true\n---\n\nhello archive',
        expect.any(Object),
      );
    });

    fireEvent.keyDown(window, { key: 'z', metaKey: true });

    await waitFor(() => {
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        'hello archive',
        expect.any(Object),
      );
    });
  });

  it('uses x and j to build a multi-selection before archiving selected files', async () => {
    const firstRelPath = 'scratchpad/keyboard-multi-archive-a';
    const secondRelPath = 'scratchpad/keyboard-multi-archive-b';
    const thirdRelPath = 'scratchpad/keyboard-multi-archive-c';
    const absPathFor = (relPath: string) => `/Users/afar/.fieldtheory/library/${relPath}.md`;
    const contents: Record<string, string> = {
      [firstRelPath]: 'first archive target',
      [secondRelPath]: 'second archive target',
      [thirdRelPath]: 'third visible target',
    };
    const versions: Record<string, DocumentVersion> = {
      [firstRelPath]: { mtimeMs: 1, size: contents[firstRelPath].length, sha256: 'archive-a-version-1' },
      [secondRelPath]: { mtimeMs: 1, size: contents[secondRelPath].length, sha256: 'archive-b-version-1' },
      [thirdRelPath]: { mtimeMs: 1, size: contents[thirdRelPath].length, sha256: 'archive-c-version-1' },
    };
    const makePage = (relPath: string): WikiPage => ({
      relPath,
      absPath: absPathFor(relPath),
      name: relPath.split('/').pop() ?? relPath,
      title: relPath.split('/').pop() ?? relPath,
      lastUpdated: 1,
      content: contents[relPath],
      documentVersion: versions[relPath],
    });
    const makeRoot = (): LibraryRoot => ({
      path: '/Users/afar/.fieldtheory/library',
      label: 'Library',
      builtin: true,
      tree: [{
        kind: 'dir',
        name: 'scratchpad',
        relPath: 'scratchpad',
        children: [firstRelPath, secondRelPath, thirdRelPath].map((relPath) => ({
          kind: 'file' as const,
          relPath,
          absPath: absPathFor(relPath),
          name: relPath.split('/').pop() ?? relPath,
          title: relPath.split('/').pop() ?? relPath,
          lastUpdated: 1,
          archived: contents[relPath].includes('archived: true') ? true : undefined,
        })),
      }],
    });

    mockStoredWikiSelection(firstRelPath, { expandScratchpad: true });
    vi.mocked(window.libraryAPI!.getRoots).mockImplementation(async () => [makeRoot()]);
    vi.mocked(window.wikiAPI!.getPage).mockImplementation(async (relPath) => makePage(relPath));
    vi.mocked(window.wikiAPI!.save).mockImplementation(async (relPath, nextContent) => {
      contents[relPath] = nextContent;
      versions[relPath] = {
        mtimeMs: versions[relPath].mtimeMs + 1,
        size: nextContent.length,
        sha256: `${relPath}-saved-${versions[relPath].mtimeMs + 1}`,
      };
      return { ok: true, version: versions[relPath] };
    });

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const firstItem = await screen.findByText('keyboard-multi-archive-a');
    fireEvent.mouseDown(firstItem);
    fireEvent.click(firstItem);

    fireEvent.keyDown(window, { key: 'x' });

    const firstSelectedMarker = await screen.findByRole('button', { name: 'Deselect keyboard-multi-archive-a' });
    const secondUnselectedMarker = screen.getByRole('button', { name: 'Select keyboard-multi-archive-b' });
    expect(firstSelectedMarker.getAttribute('aria-pressed')).toBe('true');
    expect(secondUnselectedMarker.getAttribute('aria-pressed')).toBe('false');

    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'x' });

    await waitFor(() => {
      const secondSelectedMarker = screen.getByRole('button', { name: 'Deselect keyboard-multi-archive-b' });
      expect(secondSelectedMarker.getAttribute('aria-pressed')).toBe('true');
    });

    fireEvent.keyDown(window, { key: 'e' });

    await waitFor(() => {
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        firstRelPath,
        '---\narchived: true\n---\n\nfirst archive target',
        expect.any(Object),
      );
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        secondRelPath,
        '---\narchived: true\n---\n\nsecond archive target',
        expect.any(Object),
      );
    });

    await waitFor(() => {
      expect(window.wikiAPI!.getPage).toHaveBeenCalledWith(thirdRelPath);
    });

    fireEvent.click(await screen.findByText('Archive (2)'));
    expect(await screen.findByText('keyboard-multi-archive-a')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Deselect keyboard-multi-archive-a' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deselect keyboard-multi-archive-b' })).toBeNull();
  }, 20000);

  it('stops sidebar keyboard navigation at visible list boundaries', async () => {
    const visibleRelPath = 'scratchpad/visible-boundary';
    const archivedRelPath = 'scratchpad/archived-boundary';
    const absPathFor = (relPath: string) => `/Users/afar/.fieldtheory/library/${relPath}.md`;
    const makePage = (relPath: string): WikiPage => ({
      relPath,
      absPath: absPathFor(relPath),
      name: relPath.split('/').pop() ?? relPath,
      title: relPath.split('/').pop() ?? relPath,
      lastUpdated: 1,
      content: relPath,
      documentVersion: { mtimeMs: 1, size: relPath.length, sha256: relPath },
    });

    mockStoredWikiSelection(visibleRelPath, { expandScratchpad: true });
    vi.mocked(window.libraryAPI!.getRoots).mockResolvedValue([{
      path: '/Users/afar/.fieldtheory/library',
      label: 'Library',
      builtin: true,
      tree: [{
        kind: 'dir' as const,
        name: 'scratchpad',
        relPath: 'scratchpad',
        children: [{
          kind: 'file' as const,
          relPath: visibleRelPath,
          absPath: absPathFor(visibleRelPath),
          name: 'visible-boundary',
          title: 'visible-boundary',
          lastUpdated: 1,
        }, {
          kind: 'file' as const,
          relPath: archivedRelPath,
          absPath: absPathFor(archivedRelPath),
          name: 'archived-boundary',
          title: 'archived-boundary',
          lastUpdated: 1,
          archived: true,
        }],
      }],
    }]);
    vi.mocked(window.wikiAPI!.getPage).mockImplementation(async (relPath) => makePage(relPath));

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const visibleItem = await screen.findByText('visible-boundary');
    fireEvent.mouseDown(visibleItem);
    fireEvent.click(visibleItem);

    await waitFor(() => {
      expect(window.wikiAPI!.getPage).toHaveBeenCalledWith(visibleRelPath);
    });
    const callCount = vi.mocked(window.wikiAPI!.getPage).mock.calls.length;

    fireEvent.keyDown(window, { key: 'k' });
    fireEvent.keyDown(window, { key: 'j' });

    expect(window.wikiAPI!.getPage).toHaveBeenCalledTimes(callCount);
    expect(screen.queryByText('archived-boundary')).toBeNull();
  });

  it('keeps archived rows collapsed until the sidebar refresh removes them', async () => {
    const relPath = 'scratchpad/archive-collapse-pending';
    const absPath = `/Users/afar/.fieldtheory/library/${relPath}.md`;
    let content = 'collapse pending archive target';
    let holdReload = false;
    let resolveReloadRoots: (roots: LibraryRoot[]) => void = () => {};
    const makePage = (): WikiPage => ({
      relPath,
      absPath,
      name: 'archive-collapse-pending',
      title: 'archive-collapse-pending',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: content },
    });
    const makeRoot = (): LibraryRoot => ({
      path: '/Users/afar/.fieldtheory/library',
      label: 'Library',
      builtin: true,
      tree: [{
        kind: 'dir' as const,
        name: 'scratchpad',
        relPath: 'scratchpad',
        children: [{
          kind: 'file' as const,
          relPath,
          absPath,
          name: 'archive-collapse-pending',
          title: 'archive-collapse-pending',
          lastUpdated: 1,
          archived: content.includes('archived: true') ? true : undefined,
        }],
      }],
    });

    mockStoredWikiSelection(relPath, { expandScratchpad: true });
    vi.mocked(window.libraryAPI!.getRoots).mockImplementation(() => {
      if (!holdReload) return Promise.resolve([makeRoot()]);
      return new Promise<LibraryRoot[]>((resolve) => {
        resolveReloadRoots = resolve;
      });
    });
    vi.mocked(window.wikiAPI!.getPage).mockImplementation(async () => makePage());
    vi.mocked(window.wikiAPI!.save).mockImplementation(async (_relPath, nextContent) => {
      content = nextContent;
      return {
        ok: true,
        version: { mtimeMs: 2, size: nextContent.length, sha256: 'archive-collapse-saved' },
      };
    });

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const sidebarItem = await screen.findByText('archive-collapse-pending');
    const fileRow = sidebarItem.closest('.bm-file-row') as HTMLElement;
    fireEvent.mouseDown(sidebarItem);
    fireEvent.click(sidebarItem);

    holdReload = true;
    fireEvent.keyDown(window, { key: 'e' });

    await waitFor(() => {
      expect(fileRow.style.maxHeight).toBe('0');
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180));
    });
    expect(fileRow.style.maxHeight).toBe('0');

    await act(async () => {
      resolveReloadRoots([makeRoot()]);
    });
    await waitFor(() => {
      expect(screen.queryByText('archive-collapse-pending')).toBeNull();
    });
  });

  it('keeps right-clicked sidebar rows visually active while their menu is open', async () => {
    const relPath = 'scratchpad/right-click-hover';
    const absPath = `/Users/afar/.fieldtheory/library/${relPath}.md`;
    const page: WikiPage = {
      relPath,
      absPath,
      name: 'right-click-hover',
      title: 'right-click-hover',
      lastUpdated: 1,
      content: 'right click hover target',
      documentVersion: { mtimeMs: 1, size: 24, sha256: 'right-click-hover-version' },
    };

    mockStoredWikiSelection(relPath, { expandScratchpad: true });
    vi.mocked(window.libraryAPI!.getRoots).mockResolvedValue([{
      path: '/Users/afar/.fieldtheory/library',
      label: 'Library',
      builtin: true,
      tree: [{
        kind: 'dir' as const,
        name: 'scratchpad',
        relPath: 'scratchpad',
        children: [{
          kind: 'file' as const,
          relPath,
          absPath,
          name: 'right-click-hover',
          title: 'right-click-hover',
          lastUpdated: 1,
        }],
      }],
    }]);
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const folderRow = (await screen.findByText('Scratchpad')).closest('.bm-folder-header') as HTMLElement;
    fireEvent.contextMenu(folderRow, { clientX: 24, clientY: 24 });
    await waitFor(() => {
      expect(folderRow.className).toContain('bm-folder-header-context');
    });

    fireEvent.mouseDown(window);
    await waitFor(() => {
      expect(folderRow.className).not.toContain('bm-folder-header-context');
    });

    const fileRow = (await screen.findByText('right-click-hover')).closest('.bm-file-row') as HTMLElement;
    fireEvent.contextMenu(fileRow, { clientX: 36, clientY: 36 });
    await waitFor(() => {
      expect(fileRow.className).toContain('bm-file-row-context');
    });

    fireEvent.mouseDown(window);
    await waitFor(() => {
      expect(fileRow.className).not.toContain('bm-file-row-context');
    });
  });

  it('confirms before deleting multiple selected sidebar files', async () => {
    const firstRelPath = 'scratchpad/delete-selected-a';
    const secondRelPath = 'scratchpad/delete-selected-b';
    const absPathFor = (relPath: string) => `/Users/afar/.fieldtheory/library/${relPath}.md`;
    const makePage = (relPath: string): WikiPage => ({
      relPath,
      absPath: absPathFor(relPath),
      name: relPath.split('/').pop() ?? relPath,
      title: relPath.split('/').pop() ?? relPath,
      lastUpdated: 1,
      content: relPath,
      documentVersion: { mtimeMs: 1, size: relPath.length, sha256: relPath },
    });

    mockStoredWikiSelection(firstRelPath, { expandScratchpad: true });
    vi.mocked(window.libraryAPI!.getRoots).mockResolvedValue([{
      path: '/Users/afar/.fieldtheory/library',
      label: 'Library',
      builtin: true,
      tree: [{
        kind: 'dir',
        name: 'scratchpad',
        relPath: 'scratchpad',
        children: [firstRelPath, secondRelPath].map((relPath) => ({
          kind: 'file' as const,
          relPath,
          absPath: absPathFor(relPath),
          name: relPath.split('/').pop() ?? relPath,
          title: relPath.split('/').pop() ?? relPath,
          lastUpdated: 1,
        })),
      }],
    }]);
    vi.mocked(window.wikiAPI!.getPage).mockImplementation(async (relPath) => makePage(relPath));
    window.wikiAPI!.deletePage = vi.fn(async () => true);

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const firstItem = await screen.findByText('delete-selected-a');
    fireEvent.mouseDown(firstItem);
    fireEvent.click(firstItem);

    fireEvent.keyDown(window, { key: 'x' });
    fireEvent.keyDown(window, { key: 'j' });
    fireEvent.keyDown(window, { key: 'x' });
    fireEvent.keyDown(window, { key: 'Backspace', metaKey: true });

    expect(await screen.findByRole('dialog', { name: 'Delete 2 selected items?' })).toBeTruthy();
    expect(window.wikiAPI!.deletePage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Move to Trash' }));

    await waitFor(() => {
      expect(window.wikiAPI!.deletePage).toHaveBeenCalledWith(firstRelPath);
      expect(window.wikiAPI!.deletePage).toHaveBeenCalledWith(secondRelPath);
    });
  }, 10000);

  it('reveals the collapsed sidebar when the pointer reaches the edge strip', async () => {
    window.librarianAPI!.getReadings = vi.fn(async () => [{
      path: '/tmp/library/example.md',
      title: 'example.md',
      context: null,
      readingTime: null,
      modelSignature: null,
      createdAt: 0,
      mtime: 0,
    }]);
    window.librarianAPI!.getReading = vi.fn(async () => ({
      path: '/tmp/library/example.md',
      title: 'example.md',
      context: null,
      readingTime: null,
      modelSignature: null,
      createdAt: 0,
      mtime: 0,
      content: '# Example\n',
      documentVersion: { mtimeMs: 1, size: 10, sha256: 'example' },
    }));

    const { container } = render(<LibrarianView sidebarCollapsed onSwitchToClipboard={vi.fn()} />);

    await waitFor(() => {
      expect(window.librarianAPI?.getReadings).toHaveBeenCalled();
    });
    const root = container.firstElementChild as HTMLElement;
    const getHoverStrip = () => root.querySelector(
      '[data-fieldtheory-collapsed-sidebar-hover-strip="true"]'
    ) as HTMLElement | null;
    const getSidebarPane = () => root.querySelector(
      '[data-fieldtheory-collapsed-sidebar-pane="true"]'
    ) as HTMLElement | null;
    const getResizeHandle = () => root.querySelector(
      '[data-fieldtheory-sidebar-resize-handle="true"]'
    ) as HTMLElement | null;

    fireEvent.click(await screen.findByText('example.md'));
    await waitFor(() => {
      expect(window.librarianAPI?.getReading).toHaveBeenCalledWith('/tmp/library/example.md');
    });
    expect(getHoverStrip()).toBeTruthy();

    fireEvent.mouseMove(root, { clientX: 80 });
    expect(Number(getHoverStrip()?.style.opacity)).toBeCloseTo(0.24);

    fireEvent.click(getHoverStrip()!);
    expect(getHoverStrip()).toBeNull();
    expect(getSidebarPane()?.style.boxShadow).toContain('12px 0 24px');
    expect(getResizeHandle()?.style.borderRight).toBe('0px solid transparent');

    fireEvent.mouseDown(root);
    expect(getHoverStrip()).toBeTruthy();

    fireEvent.mouseMove(root, { clientX: 20 });
    expect(getHoverStrip()).toBeTruthy();

    fireEvent.mouseDown(root);
    expect(getHoverStrip()).toBeTruthy();

    fireEvent.click(getHoverStrip()!);
    expect(getHoverStrip()).toBeNull();
    expect(getSidebarPane()?.style.boxShadow).toContain('12px 0 24px');
    expect(getResizeHandle()?.style.borderRight).toBe('0px solid transparent');

    fireEvent.mouseLeave(getSidebarPane()!);
    expect(getHoverStrip()).toBeNull();

    fireEvent.mouseLeave(root);
    expect(getHoverStrip()).toBeNull();

    fireEvent.mouseDown(getSidebarPane()!);
    expect(getHoverStrip()).toBeNull();

    fireEvent.mouseDown(root);
    expect(getHoverStrip()).toBeTruthy();
  });

  it('hides a popped-out collapsed sidebar while the sidebar resize handle is dragging', async () => {
    window.librarianAPI!.getReadings = vi.fn(async () => [{
      path: '/tmp/library/example.md',
      title: 'example.md',
      context: null,
      readingTime: null,
      modelSignature: null,
      createdAt: 0,
      mtime: 0,
    }]);
    window.librarianAPI!.getReading = vi.fn(async () => ({
      path: '/tmp/library/example.md',
      title: 'example.md',
      context: null,
      readingTime: null,
      modelSignature: null,
      createdAt: 0,
      mtime: 0,
      content: '# Example\n',
      documentVersion: { mtimeMs: 1, size: 10, sha256: 'example' },
    }));

    const { container } = render(<LibrarianView sidebarCollapsed onSwitchToClipboard={vi.fn()} />);

    await waitFor(() => {
      expect(window.librarianAPI?.getReadings).toHaveBeenCalled();
    });
    const root = container.firstElementChild as HTMLElement;
    const getHoverStrip = () => root.querySelector(
      '[data-fieldtheory-collapsed-sidebar-hover-strip="true"]'
    ) as HTMLElement | null;
    const getSidebarPane = () => root.querySelector(
      '[data-fieldtheory-collapsed-sidebar-pane="true"]'
    ) as HTMLElement | null;
    const getResizeHandle = () => root.querySelector(
      '[data-fieldtheory-sidebar-resize-handle="true"]'
    ) as HTMLElement | null;

    fireEvent.click(await screen.findByText('example.md'));
    await waitFor(() => {
      expect(window.librarianAPI?.getReading).toHaveBeenCalledWith('/tmp/library/example.md');
    });

    fireEvent.click(getHoverStrip()!);
    expect(getSidebarPane()?.style.width).not.toBe('0px');

    fireEvent.mouseDown(getResizeHandle()!);
    expect(getSidebarPane()?.style.width).toBe('0px');
    expect(getHoverStrip()).toBeTruthy();

    fireEvent.mouseUp(document);
  });
});
