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
        getReadings: vi.fn(async () => []),
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
        return style.width === '14px' && style.left === '0px';
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
