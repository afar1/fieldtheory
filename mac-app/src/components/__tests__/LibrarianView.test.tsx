import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('places Show in Finder before the library breadcrumb', async () => {
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

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);

    render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const breadcrumb = await screen.findByText('scratchpad');
    const folderButton = screen.getByLabelText('Show in Finder');

    expect(screen.getAllByLabelText('Show in Finder')).toHaveLength(1);
    expect(Boolean(folderButton.compareDocumentPosition(breadcrumb) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
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
    fireEvent.click(screen.getByLabelText('Markdown source'));

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

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
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

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath: firstRelPath })
        : null
    ));
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

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath: visibleRelPath })
        : null
    ));
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

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
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

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
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

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath: firstRelPath })
        : null
    ));
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

    expect(getHoverStrip()).toBeTruthy();

    fireEvent.mouseMove(root, { clientX: 80 });
    expect(Number(getHoverStrip()?.style.opacity)).toBeCloseTo(0.24);

    fireEvent.mouseOver(getHoverStrip()!, { clientX: 12 });
    expect(getHoverStrip()).toBeTruthy();

    fireEvent.mouseMove(root, { clientX: 20 });
    expect(getHoverStrip()).toBeTruthy();

    fireEvent.click(getHoverStrip()!);
    expect(getHoverStrip()).toBeNull();

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
