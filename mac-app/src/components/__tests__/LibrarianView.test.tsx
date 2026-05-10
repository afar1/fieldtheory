import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LibrarianView from '../LibrarianView';

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
  function pasteText(target: HTMLElement, text: string): void {
    fireEvent.paste(target, {
      clipboardData: {
        getData: (type: string) => (type === 'text/plain' || type === 'text' ? text : ''),
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
        setActiveLibraryFileContext: vi.fn(),
      },
    });
    Object.defineProperty(window, 'libraryAPI', {
      configurable: true,
      value: {
        getRoots: vi.fn(async () => []),
        getHiddenFolders: vi.fn(async () => []),
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
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders without throwing during hook initialization', async () => {
    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    await waitFor(() => {
      expect(window.librarianAPI?.getReadings).toHaveBeenCalled();
    });
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

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
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

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
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
      return input;
    });

    const renderedRoot = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
    if (!renderedRoot) throw new Error('Rendered editor root missing');
    fireEvent.click(renderedRoot);
    expect(renderedInput?.closest('[data-ft-rendered-editor-root="true"]')).toBe(renderedRoot);
    expect(container.querySelector('textarea[data-ft-rendered-editor-input="true"]')).toBeNull();

    fireEvent.click(screen.getByLabelText('Markdown source'));

    await waitFor(() => {
      expect(container.querySelector('[data-ft-rendered-editor-root="true"]')).toBeNull();
      expect(container.querySelector('.cm-editor')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('Rendered'));

    await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      const input = container.querySelector('[data-ft-rendered-editor-input="true"]') as HTMLElement | null;
      expect(root?.getAttribute('contenteditable')).toBeNull();
      expect(root?.textContent).toContain('Second rendered line');
      expect(input?.closest('.cm-editor')).toBeTruthy();
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

  it('collapses the temporary sidebar reveal when the pointer leaves the surface', async () => {
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

    await waitFor(() => {
      expect(window.librarianAPI?.getReadings).toHaveBeenCalled();
    });

    const root = container.firstElementChild as HTMLElement;
    const getHoverStrip = () => Array.from(root.querySelectorAll('div[aria-hidden="true"]'))
      .find((element) => {
        const style = (element as HTMLElement).style;
        return style.width === '30px' && style.left === '0px';
      }) as HTMLElement | undefined;

    expect(getHoverStrip()).toBeTruthy();

    fireEvent.mouseEnter(getHoverStrip()!);

    await waitFor(() => {
      expect(getHoverStrip()).toBeUndefined();
    });

    fireEvent.mouseLeave(root);

    await waitFor(() => {
      expect(getHoverStrip()).toBeTruthy();
    });
  });
});
