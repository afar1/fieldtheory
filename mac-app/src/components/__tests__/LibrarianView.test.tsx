import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LibrarianView from '../LibrarianView';
import { setRenderedMarkdownSelectionAtOffset } from '../../utils/renderedMarkdownEditor';

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

  it('keeps the rendered surface editable while preserving the markdown/rendered toggle', async () => {
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

    await waitFor(() => {
      const renderedRoot = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(renderedRoot?.getAttribute('contenteditable')).toBe('true');
      expect(renderedRoot?.getAttribute('role')).toBe('textbox');
      expect(renderedRoot?.textContent).toContain('First rendered line');
    });

    fireEvent.click(screen.getByLabelText('Markdown source'));

    await waitFor(() => {
      expect(container.querySelector('[data-ft-rendered-editor-root="true"]')).toBeNull();
      expect(container.querySelector('.cm-editor')).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('Rendered'));

    await waitFor(() => {
      const renderedRoot = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(renderedRoot?.getAttribute('contenteditable')).toBe('true');
      expect(renderedRoot?.textContent).toContain('Second rendered line');
    });
  });

  it('types at the trusted rendered caret when the browser selection falls back to a block boundary', async () => {
    const relPath = 'scratchpad/rendered-caret-test';
    const absPath = `/Users/afar/.fieldtheory/library/${relPath}.md`;
    const content = 'hello world\n\nsecond line';
    const page: WikiPage = {
      relPath,
      absPath,
      name: 'rendered-caret-test',
      title: 'rendered-caret-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'caret-version' },
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: content.length + 1, sha256: 'caret-saved-version' },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('hello world');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    const firstLine = Array.from(renderedRoot.querySelectorAll('p'))
      .find((paragraph) => paragraph.textContent === 'hello world');
    const firstLineText = firstLine?.firstChild;
    if (!firstLineText || firstLineText.nodeType !== Node.TEXT_NODE) {
      throw new Error('Rendered first line text node missing');
    }

    const selection = renderedRoot.ownerDocument.getSelection();
    if (!selection) throw new Error('Selection API unavailable');

    const originalGetBoundingClientRect = Range.prototype.getBoundingClientRect;
    Range.prototype.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 0,
      bottom: 16,
      width: 0,
      height: 16,
      toJSON: () => ({}),
    } as DOMRect);

    const trustedCaret = renderedRoot.ownerDocument.createRange();
    try {
      trustedCaret.setStart(firstLineText, 5);
      trustedCaret.collapse(true);
      selection.removeAllRanges();
      selection.addRange(trustedCaret);
      fireEvent.focus(renderedRoot);

      const badBoundaryCaret = renderedRoot.ownerDocument.createRange();
      badBoundaryCaret.setStart(renderedRoot, 0);
      badBoundaryCaret.collapse(true);
      selection.removeAllRanges();
      selection.addRange(badBoundaryCaret);

      fireEvent.keyDown(renderedRoot, { key: 'ArrowLeft', code: 'ArrowLeft' });
      expect(selection.rangeCount).toBe(1);
      expect(selection.getRangeAt(0).startContainer.textContent).toBe(firstLineText.textContent);
      expect(selection.getRangeAt(0).startOffset).toBe(5);

      selection.removeAllRanges();
      selection.addRange(badBoundaryCaret);

      fireEvent.keyDown(renderedRoot, { key: 'x', code: 'KeyX' });
      const beforeInput = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: 'x',
      });
      expect(fireEvent(renderedRoot, beforeInput)).toBe(false);
      expect(beforeInput.defaultPrevented).toBe(true);

      await waitFor(() => {
        expect(window.wikiAPI!.save).toHaveBeenCalledWith(
          relPath,
          'hellox world\n\nsecond line',
          page.documentVersion,
        );
        expect(renderedRoot.textContent).toContain('hellox world');
      }, { timeout: 1200 });
      expect(renderedRoot.textContent?.match(/hellox world/g)).toHaveLength(1);
      expect(renderedRoot.textContent).not.toContain('xhello world');
    } finally {
      Range.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    }
  });

  it('applies rendered formatting shortcuts and undo/redo in the visible editor', async () => {
    const relPath = 'scratchpad/rendered-format-history-test';
    const content = 'hello world';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-format-history-test',
      title: 'rendered-format-history-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'format-version' },
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: content.length + 4, sha256: 'format-saved-version' },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('hello world');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    fireEvent.focus(renderedRoot);

    const paragraph = Array.from(renderedRoot.querySelectorAll('p'))
      .find((node) => node.textContent === 'hello world');
    const text = paragraph?.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) throw new Error('Rendered text node missing');

    const selection = renderedRoot.ownerDocument.getSelection();
    if (!selection) throw new Error('Selection API unavailable');
    const range = renderedRoot.ownerDocument.createRange();
    range.setStart(text, 6);
    range.setEnd(text, 11);
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.keyDown(renderedRoot, { key: 'b', code: 'KeyB', metaKey: true });

    await waitFor(() => {
      expect(renderedRoot.querySelector('strong')?.textContent).toBe('world');
    });

    fireEvent.keyDown(renderedRoot, { key: 'z', code: 'KeyZ', metaKey: true });

    await waitFor(() => {
      expect(renderedRoot.querySelector('strong')).toBeNull();
      expect(renderedRoot.textContent).toContain('hello world');
    });

    fireEvent.keyDown(renderedRoot, { key: 'Z', code: 'KeyZ', metaKey: true, shiftKey: true });

    await waitFor(() => {
      expect(renderedRoot.querySelector('strong')?.textContent).toBe('world');
    });
  });

  it('auto-closes rendered wiki links while keeping the source saved once', async () => {
    const relPath = 'scratchpad/rendered-wikilink-test';
    const content = 'See [';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-wikilink-test',
      title: 'rendered-wikilink-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'wikilink-version' },
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: content.length + 3, sha256: 'wikilink-saved-version' },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('See [');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    fireEvent.focus(renderedRoot);

    const paragraph = Array.from(renderedRoot.querySelectorAll('p'))
      .find((node) => node.textContent === 'See [');
    const text = paragraph?.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) throw new Error('Rendered wiki text node missing');

    const selection = renderedRoot.ownerDocument.getSelection();
    if (!selection) throw new Error('Selection API unavailable');
    const range = renderedRoot.ownerDocument.createRange();
    range.setStart(text, 5);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.keyDown(renderedRoot, { key: '[', code: 'BracketLeft' });
    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: '[',
    });
    expect(fireEvent(renderedRoot, beforeInput)).toBe(false);
    expect(beforeInput.defaultPrevented).toBe(true);

    await waitFor(() => {
      expect(renderedRoot.textContent).toContain('See [[]]');
    });
    await waitFor(() => {
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        'See [[]]',
        page.documentVersion,
      );
    }, { timeout: 1200 });
  });

  it('keeps rendered word deletion moving across a trailing-space caret', async () => {
    const relPath = 'scratchpad/rendered-word-delete-test';
    const content = 'hello brave world';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-word-delete-test',
      title: 'rendered-word-delete-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'word-delete-version' },
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: 5, sha256: 'word-delete-saved-version' },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('hello brave world');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    const paragraph = Array.from(renderedRoot.querySelectorAll('p'))
      .find((node) => node.textContent === 'hello brave world');
    const text = paragraph?.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) throw new Error('Rendered word-delete text node missing');

    const selection = renderedRoot.ownerDocument.getSelection();
    if (!selection) throw new Error('Selection API unavailable');
    const range = renderedRoot.ownerDocument.createRange();
    range.setStart(text, 17);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.focus(renderedRoot);
    fireEvent.keyDown(renderedRoot, { key: 'Backspace', code: 'Backspace', altKey: true });

    await waitFor(() => {
      expect(renderedRoot.textContent).toContain('hello brave\u00A0');
      expect(renderedRoot.textContent).not.toContain('world');
    });

    fireEvent.keyDown(renderedRoot, { key: 'Backspace', code: 'Backspace', altKey: true });

    await waitFor(() => {
      expect(renderedRoot.textContent).toBe('hello');
    });
    await waitFor(() => {
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        'hello',
        page.documentVersion,
      );
    }, { timeout: 1200 });
  });

  it('joins rendered lines when Backspace starts a text line', async () => {
    const relPath = 'scratchpad/rendered-line-join-test';
    const content = 'hello\nworld';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-line-join-test',
      title: 'rendered-line-join-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'line-join-version' },
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: content.length - 1, sha256: 'line-join-saved-version' },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('hello');
      expect(root?.textContent).toContain('world');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    fireEvent.focus(renderedRoot);
    expect(setRenderedMarkdownSelectionAtOffset(renderedRoot, content, 6)).toMatchObject({
      sourceOffset: 6,
    });
    fireEvent.keyDown(renderedRoot, { key: 'Backspace', code: 'Backspace' });

    await waitFor(() => {
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        'helloworld',
        page.documentVersion,
      );
      expect(renderedRoot.textContent).toContain('helloworld');
    }, { timeout: 1200 });
  });

  it('applies rendered paste and cut as source transactions', async () => {
    const relPath = 'scratchpad/rendered-paste-cut-test';
    const content = 'hello brave world';
    const page: WikiPage = {
      relPath,
      absPath: `/Users/afar/.fieldtheory/library/${relPath}.md`,
      name: 'rendered-paste-cut-test',
      title: 'rendered-paste-cut-test',
      lastUpdated: 1,
      content,
      documentVersion: { mtimeMs: 1, size: content.length, sha256: 'paste-cut-version' },
    };

    vi.mocked(window.localStorage.getItem).mockImplementation((key) => (
      key === 'librarian-last-selection'
        ? JSON.stringify({ type: 'wiki', relPath })
        : null
    ));
    vi.mocked(window.wikiAPI!.getPage).mockResolvedValue(page);
    vi.mocked(window.wikiAPI!.save).mockResolvedValue({
      ok: true,
      version: { mtimeMs: 2, size: content.length, sha256: 'paste-cut-saved-version' },
    });

    const { container } = render(<LibrarianView sidebarCollapsed={false} onSwitchToClipboard={vi.fn()} />);

    const renderedRoot = await waitFor(() => {
      const root = container.querySelector('[data-ft-rendered-editor-root="true"]') as HTMLElement | null;
      expect(root?.textContent).toContain('hello brave world');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    const paragraph = Array.from(renderedRoot.querySelectorAll('p'))
      .find((node) => node.textContent === 'hello brave world');
    const text = paragraph?.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) throw new Error('Rendered paste/cut text node missing');

    const selection = renderedRoot.ownerDocument.getSelection();
    if (!selection) throw new Error('Selection API unavailable');
    const pasteRange = renderedRoot.ownerDocument.createRange();
    pasteRange.setStart(text, 5);
    pasteRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(pasteRange);

    const pasteData = { getData: vi.fn(() => ' there') };
    fireEvent.paste(renderedRoot, { clipboardData: pasteData });

    await waitFor(() => {
      expect(renderedRoot.textContent).toContain('hello there brave world');
    });

    const updatedParagraph = Array.from(renderedRoot.querySelectorAll('p'))
      .find((node) => node.textContent === 'hello there brave world');
    const updatedText = updatedParagraph?.firstChild;
    if (!updatedText || updatedText.nodeType !== Node.TEXT_NODE) {
      throw new Error('Updated rendered paste/cut text node missing');
    }

    const cutRange = renderedRoot.ownerDocument.createRange();
    cutRange.setStart(updatedText, 6);
    cutRange.setEnd(updatedText, 12);
    selection.removeAllRanges();
    selection.addRange(cutRange);

    const cutData = { setData: vi.fn() };
    fireEvent.cut(renderedRoot, { clipboardData: cutData });

    expect(cutData.setData).toHaveBeenCalledWith('text/plain', 'there ');
    await waitFor(() => {
      expect(renderedRoot.textContent).toContain('hello brave world');
    });
  });

  it('keeps rendered Enter on an editable blank line that accepts typing', async () => {
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

    const paragraph = Array.from(renderedRoot.querySelectorAll('p'))
      .find((node) => node.textContent === 'hello');
    const text = paragraph?.firstChild;
    if (!text || text.nodeType !== Node.TEXT_NODE) throw new Error('Rendered enter text node missing');

    const selection = renderedRoot.ownerDocument.getSelection();
    if (!selection) throw new Error('Selection API unavailable');
    const range = renderedRoot.ownerDocument.createRange();
    range.setStart(text, 5);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);

    fireEvent.focus(renderedRoot);
    fireEvent.keyDown(renderedRoot, { key: 'Enter', code: 'Enter' });

    const blankLine = await waitFor(() => {
      const blank = renderedRoot.querySelector('[data-ft-rendered-blank-line="true"]');
      expect(blank?.textContent).toBe('\u00A0');
      expect(blank?.getAttribute('contenteditable')).toBeNull();
      return blank;
    });
    expect(selection.focusNode).toBe(blankLine?.firstChild);

    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: 'x',
    });
    expect(fireEvent(renderedRoot, beforeInput)).toBe(false);
    expect(beforeInput.defaultPrevented).toBe(true);

    await waitFor(() => {
      expect(renderedRoot.textContent).not.toContain('\u00A0x');
      expect(window.wikiAPI!.save).toHaveBeenCalledWith(
        relPath,
        'hello\nx',
        page.documentVersion,
      );
    }, { timeout: 1200 });
  });

  it('keeps leading spaces editable on a blank rendered page', async () => {
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
      expect(root?.textContent).toBe('\u00A0');
      return root;
    });
    if (!renderedRoot) throw new Error('Rendered editor root missing');

    fireEvent.focus(renderedRoot);
    expect(setRenderedMarkdownSelectionAtOffset(renderedRoot, content, 0)).toMatchObject({
      sourceOffset: 0,
    });

    const firstSpace = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: ' ',
    });
    expect(fireEvent(renderedRoot, firstSpace)).toBe(false);
    expect(firstSpace.defaultPrevented).toBe(true);

    await waitFor(() => {
      expect(renderedRoot.textContent).toBe('\u00A0');
      expect(renderedRoot.ownerDocument.getSelection()?.focusOffset).toBe(1);
    });

    const secondSpace = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: ' ',
    });
    expect(fireEvent(renderedRoot, secondSpace)).toBe(false);
    expect(secondSpace.defaultPrevented).toBe(true);

    await waitFor(() => {
      expect(renderedRoot.textContent).toBe('\u00A0\u00A0');
      expect(renderedRoot.ownerDocument.getSelection()?.focusOffset).toBe(2);
    });
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
