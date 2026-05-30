import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LibrarianView, {
  getMaxwellToolbarRunMode,
  getLibraryDocumentDefaultContentMode,
  getLibraryDocumentViewKind,
  getHtmlPreviewSrcDoc,
  getLocalFileUrl,
  LIBRARIAN_HTML_LAYOUT_STORAGE_KEY,
  persistLibrarianHtmlLayoutByPath,
  restoreLibrarianHtmlLayoutByPath,
  resolveCurrentWikiCreateFolder,
  getFocusChromeContentCenterX,
  getResponsivePanelState,
  shouldAnimateResponsiveSidebar,
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

describe('LibrarianView render', () => {
  type TestMeetingSession = NonNullable<Awaited<ReturnType<NonNullable<NonNullable<Window['commandsAPI']>['getActiveMeeting']>>>>;
  const testLibraryRootPath = '/Users/afar/.fieldtheory/library';
  const expandedScratchpadFolders = JSON.stringify([
    `root:${testLibraryRootPath}`,
    `${testLibraryRootPath}::scratchpad`,
  ]);

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
      name: 'auto-collapses the sidebar before reshaping the terminal',
      containerWidth: 1040,
      expected: {
        autoCollapseSidebar: true,
        autoDockTerminalBottom: false,
        autoHideTerminal: false,
        reason: 'sidebar',
      },
    },
    {
      name: 'auto-docks the terminal bottom after the sidebar is collapsed',
      containerWidth: 880,
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
      containerWidth: 1040,
      containerHeight: 800,
      sidebarWidth: 180,
      sidebarCollapsed: false,
      sidebarForcedVisible: false,
      terminalVisible: true,
      terminalDockSide: 'right',
    });

    expect(getResponsivePanelState({
      containerWidth: 1120,
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
    expect(topFade.style.height).toBe('30px');
    expect(topFade.style.opacity).toBe('0.72');
    expect(scrollEl.style.scrollbarGutter).toBe('stable');
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
      },
    });
    Object.defineProperty(window, 'clipboardAPI', {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
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

  it('keeps the library shell visible when artifact readings are empty', async () => {
    window.librarianAPI!.getReadings = vi.fn(async () => []);

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    expect(await screen.findByText('Select a file')).toBeTruthy();
    expect(screen.queryByText('No artifacts yet')).toBeNull();
    expect(window.librarianAPI!.discoverLibrarianDirs).not.toHaveBeenCalled();
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
    const terminalButton = screen.getByRole('button', { name: 'Open Terminal' });
    const focusButton = screen.getByRole('button', { name: 'Enter immersive view' });
    expect(riverButton.nextElementSibling).toBe(popOutButton);
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

  it('starts and stops a meeting recording from the active file toolbar', async () => {
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
    const recordingSession: TestMeetingSession = {
      meetingId: 'meeting-toolbar-session',
      title: 'meeting-toolbar',
      type: 'wiki',
      filePath: absPath,
      relPath,
      status: 'recording',
      startedAt: '2026-05-14T20:00:00.000Z',
      endedAt: null,
      audioPath: null,
      transcriptPath: null,
      rawTranscriptPath: null,
      speakerDiarizationSupported: false,
    };
    const doneSession: TestMeetingSession = {
      ...recordingSession,
      status: 'done',
      endedAt: '2026-05-14T20:01:00.000Z',
    };

    mockStoredWikiSelection(relPath, { expandScratchpad: true });
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.commandsAPI!.startMeetingHere!).mockResolvedValue({
      success: true,
      session: recordingSession,
    });
    vi.mocked(window.commandsAPI!.stopMeeting!).mockResolvedValue({
      success: true,
      session: doneSession,
    });

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const startButton = await screen.findByRole('button', { name: 'Start meeting recording' });
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(window.commandsAPI!.startMeetingHere).toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Stop meeting recording' })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Stop meeting recording' }));

    await waitFor(() => {
      expect(window.commandsAPI!.stopMeeting).toHaveBeenCalled();
      expect(screen.getByRole('button', { name: 'Start meeting recording' })).toBeTruthy();
    });
  });

  it('places Field Theory commands to the right of the meeting button and before the view mode toggle', async () => {
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

    const meetingButton = await screen.findByRole('button', { name: 'Start meeting recording' });
    const maxwellButton = screen.getByRole('button', { name: 'Field Theory' });
    const modeToggle = screen.getByRole('button', { name: 'Switch to Markdown source' });

    expect(Boolean(meetingButton.compareDocumentPosition(maxwellButton) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(maxwellButton.compareDocumentPosition(modeToggle) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(meetingButton.style.borderStyle).toBe('none');
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
    }, { timeout: 1200 });

    const timingEntries = appendRenderedEditorDebug.mock.calls
      .map(([entry]) => entry as { stage?: string; details?: Record<string, unknown> })
      .filter((entry) => (
        entry.stage === 'apply-rendered-editor-body'
        || entry.stage === 'local-content-state-scheduled'
        || entry.stage === 'handle-rendered-editor-change'
      ));
    expect(timingEntries.length).toBeGreaterThan(0);
    expect(timingEntries.every((entry) => typeof entry.details?.durationMs === 'number')).toBe(true);
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
      const stages = appendRenderedEditorDebug.mock.calls.map(([entry]) => (entry as { stage?: string }).stage);
      expect(stages).toContain('save-rescheduled-active-typing');
    }, { timeout: 900 });
    expect(window.wikiAPI!.save).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        'quiet save!',
        page.documentVersion,
      );
    }, { timeout: 1200 });
  });

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
        'river first?',
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
        page.documentVersion,
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
        page.documentVersion,
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
  });

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
  });

  it('reveals the collapsed sidebar only when the edge strip is clicked', async () => {
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

    fireEvent.mouseOver(getHoverStrip()!, { clientX: 12 });
    expect(getHoverStrip()).toBeTruthy();

    fireEvent.mouseMove(root, { clientX: 20 });
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
});
