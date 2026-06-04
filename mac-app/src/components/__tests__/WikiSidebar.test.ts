import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetBookmarksCacheForTests } from '../../services/bookmarksCache';
import WikiSidebar, {
  BOOKMARKS_ITEM_ID,
  BOOKMARKS_SHORTCUT_FOLDER_ID,
  addDirToLibraryRoot,
  canDropLibraryItem,
  collectSidebarIconTargetIds,
  filterHiddenDefaultSidebarNodes,
  flattenBuiltinSidebarRoots,
  getMovedLibraryFileSelectionItem,
  getNextVisibleSidebarItemAfterRemoval,
  getSidebarContextHideDirLabel,
  getSidebarShortcutVisibility,
  type LibraryCreateLocation,
  type WikiArchiveController,
  type UnifiedItem,
  isPointerNearRect,
  isRiverSidebarItemId,
  isSharedRiverSidebarItem,
  isWikiSidebarStorageKey,
  mergeSidebarPinnedItemIds,
  readWikiSidebarStoredPreferences,
  splitRiverShortcutNode,
  virtualizeBookmarksGroup,
} from '../WikiSidebar';

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

const libraryRootPath = '/Users/afar/.fieldtheory/library';

type TestLibraryRoot = Pick<LibraryRoot, 'path' | 'label' | 'builtin' | 'tree'>;

type TestSidebarNode = ReturnType<typeof fileNode> | {
  kind: 'dir';
  id: string;
  name: string;
  label: string;
  relPath: string;
  rootPath: string;
  builtin: boolean;
  canCreateFile: boolean;
  children: TestSidebarNode[];
};

function fileNode(id: string, title: string) {
  return {
    kind: 'file' as const,
    id,
    item: {
      id,
      title,
      type: 'wiki' as const,
      absPath: `${libraryRootPath}/${title}.md`,
      relPath: title,
      rootPath: libraryRootPath,
      timestamp: 1,
    },
  };
}

function sidebarItem(id: string, title: string = id) {
  return fileNode(id, title).item;
}

function mockSidebarNativeApis(
  tree: LibraryRoot['tree'] = [],
  roots: TestLibraryRoot[] = [{
    path: libraryRootPath,
    label: 'Library',
    builtin: true,
    tree,
  }],
): void {
  Object.defineProperty(window, 'wikiAPI', {
    configurable: true,
    value: {
      getTree: vi.fn(async () => []),
      rename: vi.fn(async () => null),
      deletePage: vi.fn(async () => true),
      onPageChanged: vi.fn(() => undefined),
      onPageDeleted: vi.fn(() => undefined),
      onPageRenamed: vi.fn(() => undefined),
    },
  });
  Object.defineProperty(window, 'libraryAPI', {
    configurable: true,
    value: {
      getRoots: vi.fn(async () => roots),
      moveItem: vi.fn(async () => null),
      getHiddenFolders: vi.fn(async () => []),
      onRootsChanged: vi.fn(() => undefined),
      onItemRenamed: vi.fn(() => undefined),
    },
  });
  Object.defineProperty(window, 'librarianAPI', {
    configurable: true,
    value: {
      getReadings: vi.fn(async () => []),
      onReadingAdded: vi.fn(() => undefined),
      onReadingRemoved: vi.fn(() => undefined),
      onReadingUpdated: vi.fn(() => undefined),
      onReadingRenamed: vi.fn(() => undefined),
    },
  });
  Object.defineProperty(window, 'recentAPI', {
    configurable: true,
    value: {
      list: vi.fn(async () => []),
      onChanged: vi.fn(() => undefined),
    },
  });
  Object.defineProperty(window, 'taggedDocsAPI', {
    configurable: true,
    value: {
      list: vi.fn(async () => []),
      onUpdated: vi.fn(() => undefined),
    },
  });
  Object.defineProperty(window, 'sharedFilesAPI', {
    configurable: true,
    value: {
      getPinnedItemIds: vi.fn(async () => []),
      onPinsChanged: vi.fn(() => undefined),
    },
  });
  Object.defineProperty(window, 'bookmarksAPI', {
    configurable: true,
    value: {
      getAll: vi.fn(async () => ({ bookmarks: [], folders: [], xLastSyncedAt: null })),
      onChanged: vi.fn(() => undefined),
    },
  });
}

function renderSidebarForTest(options: {
  tree?: LibraryRoot['tree'];
  roots?: TestLibraryRoot[];
  selectedId?: string | null;
  onSelectItem?: (item: UnifiedItem) => void;
  onCreateFile?: (location: LibraryCreateLocation, fileName: string) => boolean | Promise<boolean>;
  archiveControllerRef?: { current: WikiArchiveController | null };
} = {}) {
  mockSidebarNativeApis(options.tree ?? [], options.roots);
  const flatItemsRef = { current: [] as UnifiedItem[] };
  return render(createElement(WikiSidebar, {
    active: true,
    onSelectItem: options.onSelectItem ?? vi.fn(),
    selectedId: options.selectedId ?? null,
    onCreateFile: options.onCreateFile ?? vi.fn(async () => false),
    onCreateDir: vi.fn(async () => false),
    flatItemsRef,
    searchQuery: '',
    onSearchQueryChange: vi.fn(),
    archiveControllerRef: options.archiveControllerRef,
  }));
}

function createDataTransferStub() {
  const data = new Map<string, string>();
  const dataTransfer = {
    types: [] as string[],
    effectAllowed: '',
    dropEffect: '',
    setData: vi.fn((type: string, value: string) => {
      data.set(type, value);
      if (!dataTransfer.types.includes(type)) dataTransfer.types.push(type);
    }),
    getData: vi.fn((type: string) => data.get(type) ?? ''),
  };
  return dataTransfer;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  resetBookmarksCacheForTests();
  const values = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
      removeItem: vi.fn((key: string) => { values.delete(key); }),
      clear: vi.fn(() => { values.clear(); }),
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (window as Partial<Window>).wikiAPI;
  delete (window as Partial<Window>).libraryAPI;
  delete (window as Partial<Window>).librarianAPI;
  delete (window as Partial<Window>).recentAPI;
  delete (window as Partial<Window>).taggedDocsAPI;
  delete (window as Partial<Window>).sharedFilesAPI;
  delete (window as Partial<Window>).bookmarksAPI;
});

function dirNode(name: string, children: TestSidebarNode[] = [fileNode(`wiki:${name}/note`, 'note')]): TestSidebarNode {
  return {
    kind: 'dir' as const,
    id: `${libraryRootPath}::${name}`,
    name,
    label: name,
    relPath: name,
    rootPath: libraryRootPath,
    builtin: true,
    canCreateFile: true,
    children,
  };
}

describe('WikiSidebar River root helpers', () => {
  it('adds a newly created directory to the matching library root', () => {
    const roots = [{
      path: libraryRootPath,
      label: 'Library',
      builtin: true,
      tree: [{
        kind: 'dir' as const,
        name: 'scratchpad',
        relPath: 'scratchpad',
        children: [],
      }],
    }] as LibraryRoot[];

    expect(addDirToLibraryRoot(roots, libraryRootPath, 'scratchpad/projects/alpha')).toEqual([{
      ...roots[0],
      tree: [{
        kind: 'dir',
        name: 'scratchpad',
        relPath: 'scratchpad',
        children: [{
          kind: 'dir',
          name: 'projects',
          relPath: 'scratchpad/projects',
          children: [{
            kind: 'dir',
            name: 'alpha',
            relPath: 'scratchpad/projects/alpha',
            children: [],
          }],
        }],
      }],
    }]);
  });

  it('keeps newer sidebar tree state when an older reload finishes last', async () => {
    const initialRoots = [{
      path: libraryRootPath,
      label: 'Library',
      builtin: true,
      tree: [dirNode('Initial', [])],
    }] as unknown as LibraryRoot[];
    const staleRoots = [{
      path: libraryRootPath,
      label: 'Library',
      builtin: true,
      tree: [dirNode('Stale', [])],
    }] as unknown as LibraryRoot[];
    const freshRoots = [{
      path: libraryRootPath,
      label: 'Library',
      builtin: true,
      tree: [dirNode('Fresh', [])],
    }] as unknown as LibraryRoot[];
    const staleRootsLoad = deferred<LibraryRoot[]>();
    const freshRootsLoad = deferred<LibraryRoot[]>();
    let rootsChanged: (() => void) | undefined;
    const rootLoads = [
      Promise.resolve(initialRoots),
      staleRootsLoad.promise,
      freshRootsLoad.promise,
    ];

    mockSidebarNativeApis([], initialRoots);
    vi.mocked(window.libraryAPI!.getRoots).mockImplementation(async () => (
      rootLoads.shift() ?? Promise.resolve(freshRoots)
    ));
    vi.mocked(window.libraryAPI!.onRootsChanged).mockImplementation((callback: () => void) => {
      rootsChanged = callback;
      return () => undefined;
    });

    render(createElement(WikiSidebar, {
      active: true,
      onSelectItem: vi.fn(),
      selectedId: null,
      onCreateFile: vi.fn(async () => false),
      onCreateDir: vi.fn(async () => false),
      flatItemsRef: { current: [] as UnifiedItem[] },
      searchQuery: '',
      onSearchQueryChange: vi.fn(),
    }));

    await screen.findByText('Initial');

    act(() => {
      rootsChanged?.();
      rootsChanged?.();
    });
    await act(async () => {
      freshRootsLoad.resolve(freshRoots);
      await freshRootsLoad.promise;
    });
    expect(await screen.findByText('Fresh')).toBeTruthy();

    await act(async () => {
      staleRootsLoad.resolve(staleRoots);
      await staleRootsLoad.promise;
    });
    expect(screen.queryByText('Stale')).toBeNull();
    expect(screen.getByText('Fresh')).toBeTruthy();
  });

  it('keeps newer recent work when an older recent refresh finishes last', async () => {
    const staleRecentLoad = deferred<RecentEntry[]>();
    const freshRecentLoad = deferred<RecentEntry[]>();
    let recentChanged: (() => void) | undefined;
    const recentLoads = [
      Promise.resolve([]),
      staleRecentLoad.promise,
      freshRecentLoad.promise,
    ];

    mockSidebarNativeApis();
    vi.mocked(window.recentAPI!.list).mockImplementation(async () => (
      recentLoads.shift() ?? Promise.resolve([])
    ));
    vi.mocked(window.recentAPI!.onChanged).mockImplementation((callback: () => void) => {
      recentChanged = callback;
      return () => undefined;
    });

    render(createElement(WikiSidebar, {
      active: true,
      onSelectItem: vi.fn(),
      selectedId: null,
      onCreateFile: vi.fn(async () => false),
      onCreateDir: vi.fn(async () => false),
      flatItemsRef: { current: [] as UnifiedItem[] },
      searchQuery: '',
      onSearchQueryChange: vi.fn(),
    }));

    await waitFor(() => expect(window.recentAPI?.list).toHaveBeenCalledTimes(1));

    act(() => {
      recentChanged?.();
      recentChanged?.();
    });
    await act(async () => {
      freshRecentLoad.resolve([{
        kind: 'external',
        path: '/Users/afar/Documents/Fresh.md',
        title: 'Fresh Recent',
        lastOpenedAt: 2,
      }]);
      await freshRecentLoad.promise;
    });
    expect(await screen.findByText('Fresh Recent')).toBeTruthy();

    await act(async () => {
      staleRecentLoad.resolve([{
        kind: 'external',
        path: '/Users/afar/Documents/Stale.md',
        title: 'Stale Recent',
        lastOpenedAt: 1,
      }]);
      await staleRecentLoad.promise;
    });
    expect(screen.queryByText('Stale Recent')).toBeNull();
    expect(screen.getByText('Fresh Recent')).toBeTruthy();
  });

  it('uses recent change payloads without another list round trip', async () => {
    let recentChanged: ((entries?: RecentEntry[]) => void) | undefined;
    mockSidebarNativeApis();
    vi.mocked(window.recentAPI!.onChanged).mockImplementation((callback: (entries?: RecentEntry[]) => void) => {
      recentChanged = callback;
      return () => undefined;
    });

    render(createElement(WikiSidebar, {
      active: true,
      onSelectItem: vi.fn(),
      selectedId: null,
      onCreateFile: vi.fn(async () => false),
      onCreateDir: vi.fn(async () => false),
      flatItemsRef: { current: [] as UnifiedItem[] },
      searchQuery: '',
      onSearchQueryChange: vi.fn(),
    }));

    await waitFor(() => expect(window.recentAPI?.list).toHaveBeenCalledTimes(1));

    act(() => {
      recentChanged?.([{
        kind: 'external',
        path: '/Users/afar/Documents/Instant.md',
        title: 'Instant Recent',
        lastOpenedAt: 3,
      }]);
    });

    expect(await screen.findByText('Instant Recent')).toBeTruthy();
    expect(window.recentAPI?.list).toHaveBeenCalledTimes(1);
  });

  it('patches content-only wiki metadata deltas without reloading the tree', async () => {
    let pageChanged: ((event?: LibraryChangeEvent) => void) | undefined;
    mockSidebarNativeApis([], [{
      path: libraryRootPath,
      label: 'Library',
      builtin: true,
      tree: [{
        kind: 'dir',
        name: 'Notes',
        relPath: 'Notes',
        children: [{
          kind: 'file',
          relPath: 'Notes/today',
          absPath: `${libraryRootPath}/Notes/today.md`,
          name: 'today',
          title: 'Old Title',
          lastUpdated: 1,
        }],
      }],
    }]);
    vi.mocked(window.wikiAPI!.onPageChanged).mockImplementation((callback: (event?: LibraryChangeEvent) => void) => {
      pageChanged = callback;
      return () => undefined;
    });

    render(createElement(WikiSidebar, {
      active: true,
      onSelectItem: vi.fn(),
      selectedId: null,
      onCreateFile: vi.fn(async () => false),
      onCreateDir: vi.fn(async () => false),
      flatItemsRef: { current: [] as UnifiedItem[] },
      searchQuery: '',
      onSearchQueryChange: vi.fn(),
    }));

    fireEvent.click(await screen.findByText('Notes'));
    await screen.findByText('Old Title');
    expect(window.libraryAPI?.getRoots).toHaveBeenCalledTimes(1);

    act(() => {
      pageChanged?.({
        type: 'file-changed',
        rootPath: libraryRootPath,
        relPath: 'Notes/today',
        absPath: `${libraryRootPath}/Notes/today.md`,
        builtin: true,
        source: 'watcher',
        detectedAt: 1,
        page: {
          relPath: 'Notes/today',
          absPath: `${libraryRootPath}/Notes/today.md`,
          name: 'today',
          title: 'Updated Title',
          lastUpdated: 2,
        },
      });
    });
    expect(screen.getByText('Updated Title')).toBeTruthy();
    expect(screen.queryByText('Old Title')).toBeNull();
    expect(window.libraryAPI?.getRoots).toHaveBeenCalledTimes(1);

    act(() => {
      pageChanged?.();
    });
    await waitFor(() => expect(window.libraryAPI?.getRoots).toHaveBeenCalledTimes(2));
  });

  it('ignores duplicate builtin library change payloads after wiki deltas', async () => {
    let pageChanged: ((event?: LibraryChangeEvent) => void) | undefined;
    let rootsChanged: ((event?: LibraryChangeEvent) => void) | undefined;
    mockSidebarNativeApis([], [{
      path: libraryRootPath,
      label: 'Library',
      builtin: true,
      tree: [{
        kind: 'dir',
        name: 'Notes',
        relPath: 'Notes',
        children: [{
          kind: 'file',
          relPath: 'Notes/today',
          absPath: `${libraryRootPath}/Notes/today.md`,
          name: 'today',
          title: 'Old Title',
          lastUpdated: 1,
        }],
      }],
    }]);
    vi.mocked(window.wikiAPI!.onPageChanged).mockImplementation((callback: (event?: LibraryChangeEvent) => void) => {
      pageChanged = callback;
      return () => undefined;
    });
    vi.mocked(window.libraryAPI!.onRootsChanged).mockImplementation((callback: (event?: LibraryChangeEvent) => void) => {
      rootsChanged = callback;
      return () => undefined;
    });

    render(createElement(WikiSidebar, {
      active: true,
      onSelectItem: vi.fn(),
      selectedId: null,
      onCreateFile: vi.fn(async () => false),
      onCreateDir: vi.fn(async () => false),
      flatItemsRef: { current: [] as UnifiedItem[] },
      searchQuery: '',
      onSearchQueryChange: vi.fn(),
    }));

    fireEvent.click(await screen.findByText('Notes'));
    await screen.findByText('Old Title');
    expect(window.libraryAPI?.getRoots).toHaveBeenCalledTimes(1);

    const event: LibraryChangeEvent = {
      type: 'file-changed',
      rootPath: libraryRootPath,
      relPath: 'Notes/today',
      absPath: `${libraryRootPath}/Notes/today.md`,
      builtin: true,
      source: 'app',
      detectedAt: 1,
      page: {
        relPath: 'Notes/today',
        absPath: `${libraryRootPath}/Notes/today.md`,
        name: 'today',
        title: 'Updated Title',
        lastUpdated: 2,
      },
    };

    act(() => {
      pageChanged?.(event);
      rootsChanged?.(event);
    });

    expect(screen.getByText('Updated Title')).toBeTruthy();
    expect(window.libraryAPI?.getRoots).toHaveBeenCalledTimes(1);
  });

  it('patches added wiki file deltas without reloading the tree', async () => {
    let pageChanged: ((event?: LibraryChangeEvent) => void) | undefined;
    mockSidebarNativeApis([], [{
      path: libraryRootPath,
      label: 'Library',
      builtin: true,
      tree: [{
        kind: 'dir',
        name: 'Notes',
        relPath: 'Notes',
        children: [],
      }],
    }]);
    vi.mocked(window.wikiAPI!.onPageChanged).mockImplementation((callback: (event?: LibraryChangeEvent) => void) => {
      pageChanged = callback;
      return () => undefined;
    });

    render(createElement(WikiSidebar, {
      active: true,
      onSelectItem: vi.fn(),
      selectedId: null,
      onCreateFile: vi.fn(async () => false),
      onCreateDir: vi.fn(async () => false),
      flatItemsRef: { current: [] as UnifiedItem[] },
      searchQuery: '',
      onSearchQueryChange: vi.fn(),
    }));

    fireEvent.click(await screen.findByText('Notes'));
    expect(window.libraryAPI?.getRoots).toHaveBeenCalledTimes(1);

    act(() => {
      pageChanged?.({
        type: 'file-added',
        rootPath: libraryRootPath,
        relPath: 'Notes/Instant',
        absPath: `${libraryRootPath}/Notes/Instant.md`,
        builtin: true,
        source: 'app',
        detectedAt: 1,
        page: {
          relPath: 'Notes/Instant',
          absPath: `${libraryRootPath}/Notes/Instant.md`,
          name: 'Instant',
          title: 'Instant',
          lastUpdated: 2,
        },
      });
    });

    expect(screen.getByText('Instant')).toBeTruthy();
    expect(window.libraryAPI?.getRoots).toHaveBeenCalledTimes(1);
  });

  it('patches external library file delete deltas without reloading the tree', async () => {
    const externalRootPath = '/Users/afar/Documents/Notes';
    let rootsChanged: ((event?: LibraryChangeEvent) => void) | undefined;
    mockSidebarNativeApis([], [
      {
        path: libraryRootPath,
        label: 'Library',
        builtin: true,
        tree: [],
      },
      {
        path: externalRootPath,
        label: 'Notes',
        builtin: false,
        tree: [{
          kind: 'dir',
          name: 'Projects',
          relPath: 'Projects',
          children: [{
            kind: 'file',
            relPath: 'Projects/Gone',
            absPath: `${externalRootPath}/Projects/Gone.md`,
            name: 'Gone',
            title: 'Gone',
            lastUpdated: 1,
          }],
        }],
      },
    ]);
    vi.mocked(window.libraryAPI!.onRootsChanged).mockImplementation((callback: (event?: LibraryChangeEvent) => void) => {
      rootsChanged = callback;
      return () => undefined;
    });

    render(createElement(WikiSidebar, {
      active: true,
      onSelectItem: vi.fn(),
      selectedId: null,
      onCreateFile: vi.fn(async () => false),
      onCreateDir: vi.fn(async () => false),
      flatItemsRef: { current: [] as UnifiedItem[] },
      searchQuery: '',
      onSearchQueryChange: vi.fn(),
    }));

    fireEvent.click(await screen.findByText('Notes'));
    fireEvent.click(await screen.findByText('Projects'));
    await screen.findByText('Gone');
    expect(window.libraryAPI?.getRoots).toHaveBeenCalledTimes(1);

    act(() => {
      rootsChanged?.({
        type: 'file-deleted',
        rootPath: externalRootPath,
        relPath: 'Projects/Gone',
        absPath: `${externalRootPath}/Projects/Gone.md`,
        builtin: false,
        source: 'watcher',
        detectedAt: 1,
      });
    });

    expect(screen.queryByText('Gone')).toBeNull();
    expect(window.libraryAPI?.getRoots).toHaveBeenCalledTimes(1);
  });

  it('keeps the create input open with feedback when file creation fails', async () => {
    const onCreateFile = vi.fn(async () => false);
    renderSidebarForTest({
      tree: [{
        kind: 'dir',
        name: 'projects',
        relPath: 'projects',
        children: [],
      }],
      onCreateFile,
    });

    fireEvent.click(await screen.findByRole('button', { name: 'New file in Projects' }));
    const input = screen.getByPlaceholderText('Untitled');
    fireEvent.change(input, { target: { value: 'Duplicate' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(onCreateFile).toHaveBeenCalledWith(expect.objectContaining({
        rootPath: libraryRootPath,
        relPath: 'projects',
        builtin: true,
      }), 'Duplicate');
      expect(screen.getByRole('alert').textContent).toContain('Could not create file');
    });
    expect(screen.getByDisplayValue('Duplicate')).toBeTruthy();
  });

  it('keeps the rename input open with feedback when sidebar rename fails', async () => {
    const relPath = 'projects/original';
    renderSidebarForTest({
      tree: [{
        kind: 'dir',
        name: 'projects',
        relPath: 'projects',
        children: [{
          kind: 'file',
          relPath,
          absPath: `${libraryRootPath}/${relPath}.md`,
          name: 'original',
          title: 'Original',
          lastUpdated: 1,
        }],
      }],
      selectedId: `wiki:${relPath}`,
    });

    fireEvent.click(await screen.findByText('Projects'));
    fireEvent.doubleClick(await screen.findByText('Original'));
    const input = screen.getByDisplayValue('Original');
    fireEvent.change(input, { target: { value: 'Existing' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(window.wikiAPI?.rename).toHaveBeenCalledWith(relPath, 'Existing');
      expect(screen.getByRole('alert').textContent).toContain('Could not rename');
    });
    expect(screen.getByDisplayValue('Existing')).toBeTruthy();
  });

  it('selects a visible fallback after deleting the selected sidebar page', async () => {
    const selectedRelPath = 'projects/selected';
    const fallbackRelPath = 'projects/fallback';
    const onSelectItem = vi.fn();
    const archiveControllerRef = { current: null as WikiArchiveController | null };
    renderSidebarForTest({
      tree: [{
        kind: 'dir',
        name: 'projects',
        relPath: 'projects',
        children: [
          {
            kind: 'file',
            relPath: selectedRelPath,
            absPath: `${libraryRootPath}/${selectedRelPath}.md`,
            name: 'selected',
            title: 'Selected',
            lastUpdated: 1,
          },
          {
            kind: 'file',
            relPath: fallbackRelPath,
            absPath: `${libraryRootPath}/${fallbackRelPath}.md`,
            name: 'fallback',
            title: 'Fallback',
            lastUpdated: 2,
          },
        ],
      }],
      selectedId: `wiki:${selectedRelPath}`,
      onSelectItem,
      archiveControllerRef,
    });

    fireEvent.click(await screen.findByText('Projects'));
    await screen.findByText('Selected');
    await waitFor(() => expect(archiveControllerRef.current).not.toBeNull());
    act(() => {
      expect(archiveControllerRef.current?.toggleFocusedSelection()).toBe(true);
      expect(archiveControllerRef.current?.deleteSelectedItems()).toBe(true);
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Move to Trash' }));

    await waitFor(() => {
      expect(window.wikiAPI?.deletePage).toHaveBeenCalledWith(selectedRelPath);
      expect(onSelectItem).toHaveBeenCalledWith(expect.objectContaining({
        id: `wiki:${fallbackRelPath}`,
        title: 'Fallback',
      }));
    });
  });

  it('passes source and target roots through rendered cross-root file drag/drop', async () => {
    const externalRootPath = '/Users/afar/Documents/Notes';
    const onSelectItem = vi.fn();
    const slowRootsReload = deferred<TestLibraryRoot[]>();
    renderSidebarForTest({
      roots: [
        {
          path: libraryRootPath,
          label: 'Library',
          builtin: true,
          tree: [{
            kind: 'dir',
            name: 'scratchpad',
            relPath: 'scratchpad',
            children: [{
              kind: 'file',
              relPath: 'scratchpad/source',
              absPath: `${libraryRootPath}/scratchpad/source.md`,
              name: 'source',
              title: 'Source',
              lastUpdated: 1,
            }],
          }],
        },
        {
          path: externalRootPath,
          label: 'Notes',
          builtin: false,
          tree: [{
            kind: 'dir',
            name: 'Target',
            relPath: 'Target',
            children: [],
          }],
        },
      ],
      onSelectItem,
    });
    vi.mocked(window.libraryAPI!.moveItem).mockResolvedValue('Target/source');
    vi.mocked(window.libraryAPI!.getRoots).mockImplementationOnce(async () => [
      {
        path: libraryRootPath,
        label: 'Library',
        builtin: true,
        tree: [{
          kind: 'dir',
          name: 'scratchpad',
          relPath: 'scratchpad',
          children: [{
            kind: 'file',
            relPath: 'scratchpad/source',
            absPath: `${libraryRootPath}/scratchpad/source.md`,
            name: 'source',
            title: 'Source',
            lastUpdated: 1,
          }],
        }],
      },
      {
        path: externalRootPath,
        label: 'Notes',
        builtin: false,
        tree: [{
          kind: 'dir',
          name: 'Target',
          relPath: 'Target',
          children: [],
        }],
      },
    ]).mockImplementationOnce(async () => slowRootsReload.promise);

    fireEvent.click(await screen.findByText('Scratchpad'));
    fireEvent.click(await screen.findByText('Notes'));
    const sourceRow = (await screen.findByText('Source')).closest('[data-library-sidebar-row-id]');
    const targetRow = (await screen.findByText('Target')).closest('[data-library-sidebar-row-id]');
    expect(sourceRow).toBeTruthy();
    expect(targetRow).toBeTruthy();
    const dataTransfer = createDataTransferStub();

    fireEvent.dragStart(sourceRow!, { dataTransfer });
    fireEvent.dragOver(targetRow!, { dataTransfer });
    fireEvent.drop(targetRow!, { dataTransfer });

    await waitFor(() => {
      expect(window.libraryAPI?.moveItem).toHaveBeenCalledWith(
        libraryRootPath,
        'file',
        'scratchpad/source',
        'Target',
        externalRootPath,
      );
      expect(onSelectItem).toHaveBeenCalledWith(expect.objectContaining({
        id: `external:${externalRootPath}/Target/source.md`,
        type: 'external',
        relPath: 'Target/source',
      }));
    });
    slowRootsReload.resolve([]);
  });

  it('allows cross-root file drops but keeps cross-root folders blocked', () => {
    const sourceRoot = '/library';
    const targetRoot = '/project';
    const target = { rootPath: targetRoot, relPath: 'Notes', builtin: false };

    expect(canDropLibraryItem({
      rootPath: sourceRoot,
      relPath: 'scratchpad/note',
      kind: 'file',
    }, target)).toBe(true);

    expect(canDropLibraryItem({
      rootPath: sourceRoot,
      relPath: 'scratchpad',
      kind: 'dir',
    }, target)).toBe(false);
  });

  it('still rejects same-root folder drops into themselves or descendants', () => {
    const rootPath = '/library';
    const item = { rootPath, relPath: 'Projects', kind: 'dir' as const };

    expect(canDropLibraryItem(item, { rootPath, relPath: 'Projects', builtin: true })).toBe(false);
    expect(canDropLibraryItem(item, { rootPath, relPath: 'Projects/Nested', builtin: true })).toBe(false);
    expect(canDropLibraryItem(item, { rootPath, relPath: 'scratchpad', builtin: true })).toBe(true);
  });

  it('builds wiki selection state for moved markdown files in the built-in root', () => {
    const item = getMovedLibraryFileSelectionItem(
      { rootPath: libraryRootPath, relPath: 'scratchpad', builtin: true },
      'scratchpad/moved',
      { builtin: true },
      123,
    );

    expect(item).toEqual({
      id: 'wiki:scratchpad/moved',
      title: 'moved',
      type: 'wiki',
      absPath: '',
      relPath: 'scratchpad/moved',
      rootPath: libraryRootPath,
      timestamp: 123,
    });
  });

  it('builds external selection state for moved files in external roots', () => {
    const rootPath = '/Users/afar/Documents/Notes';

    expect(getMovedLibraryFileSelectionItem(
      { rootPath, relPath: 'Inbox', builtin: false },
      'Inbox/moved',
      { builtin: false },
      123,
    )).toEqual(expect.objectContaining({
      id: 'external:/Users/afar/Documents/Notes/Inbox/moved.md',
      title: 'moved',
      type: 'external',
      absPath: '/Users/afar/Documents/Notes/Inbox/moved.md',
      relPath: 'Inbox/moved',
      rootPath,
    }));

    expect(getMovedLibraryFileSelectionItem(
      { rootPath, relPath: 'Web', builtin: false },
      'Web/site.html',
      { builtin: false },
      123,
    )).toEqual(expect.objectContaining({
      id: 'external:/Users/afar/Documents/Notes/Web/site.html',
      title: 'site.html',
      type: 'external',
      absPath: '/Users/afar/Documents/Notes/Web/site.html',
      relPath: 'Web/site.html',
    }));
  });

  it('chooses the next visible sibling after deleting the selected item', () => {
    const first = sidebarItem('wiki:first');
    const selected = sidebarItem('wiki:selected');
    const next = sidebarItem('wiki:next');

    expect(getNextVisibleSidebarItemAfterRemoval(
      [first, selected, next],
      [first, selected, next],
      selected.id,
      new Set([selected.id]),
    )).toBe(next);
  });

  it('chooses the previous visible sibling when deleting the last selected item', () => {
    const previous = sidebarItem('wiki:previous');
    const selected = sidebarItem('wiki:selected');

    expect(getNextVisibleSidebarItemAfterRemoval(
      [previous, selected],
      [previous, selected],
      selected.id,
      new Set([selected.id]),
    )).toBe(previous);
  });

  it('falls back to the flat visible list when an entire sibling group is removed', () => {
    const outside = sidebarItem('wiki:outside');
    const selected = sidebarItem('wiki:selected');
    const sibling = sidebarItem('wiki:sibling');

    expect(getNextVisibleSidebarItemAfterRemoval(
      [selected, sibling],
      [outside, selected, sibling],
      selected.id,
      new Set([selected.id, sibling.id]),
    )).toBe(outside);
  });

  it('reads native-synced sidebar display preferences from renderer storage', () => {
    const values = new Map<string, string>([
      ['library-sort-mode', 'time'],
      ['wiki-expanded-folders', JSON.stringify(['scratchpad', 'root:/library'])],
      ['wiki-recent-collapsed', '1'],
      ['library-pinned-item-ids', JSON.stringify(['wiki:scratchpad/Note', 17, 'bookmarks:root'])],
      ['library-sidebar-icon-color-indices', JSON.stringify({ 'wiki:scratchpad/Note': 2, invalid: -1, nope: 'blue' })],
      ['library-sidebar-icon-color-order', JSON.stringify([3, 1, 99, 1])],
      ['library-new-doc-location', '/library::scratchpad'],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
    };

    const preferences = readWikiSidebarStoredPreferences(storage);

    expect(preferences.sortMode).toBe('time');
    expect([...preferences.expandedFolders]).toEqual(['scratchpad', 'root:/library']);
    expect(preferences.recentCollapsed).toBe(true);
    expect([...preferences.pinnedItemIds]).toEqual(['wiki:scratchpad/Note', 'bookmarks:root']);
    expect(preferences.iconColorIndices).toEqual({ 'wiki:scratchpad/Note': 2 });
    expect(preferences.iconColorOrder.slice(0, 4)).toEqual([3, 1, 0, 2]);
    expect(preferences.newDocLocationKey).toBe('/library::scratchpad');
    expect(isWikiSidebarStorageKey('library-pinned-item-ids')).toBe(true);
    expect(isWikiSidebarStorageKey(BOOKMARKS_SHORTCUT_FOLDER_ID)).toBe(false);
    expect(isWikiSidebarStorageKey('bookmarks-view-mode')).toBe(false);
  });

  it('falls back when renderer storage reads fail', () => {
    const preferences = readWikiSidebarStoredPreferences({
      getItem: () => {
        throw new Error('storage unavailable');
      },
    });

    expect(preferences.sortMode).toBe('alpha');
    expect([...preferences.expandedFolders]).toEqual([]);
    expect(preferences.recentCollapsed).toBe(false);
    expect([...preferences.pinnedItemIds]).toEqual([]);
    expect(preferences.iconColorIndices).toEqual({});
    expect(preferences.iconColorOrder).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(preferences.newDocLocationKey).toBe('');
  });

  it('detects when the cursor is close to a sidebar create button', () => {
    const rect = { left: 100, right: 118, top: 40, bottom: 58 };

    expect(isPointerNearRect({ clientX: 92, clientY: 50 }, rect, 10)).toBe(true);
    expect(isPointerNearRect({ clientX: 118, clientY: 68 }, rect, 10)).toBe(true);
    expect(isPointerNearRect({ clientX: 89, clientY: 50 }, rect, 10)).toBe(false);
  });

  it('hides the virtual Bookmarks shortcut when the native preference says bookmarks are hidden', () => {
    const baseBookmarksNode = fileNode(BOOKMARKS_ITEM_ID, 'Bookmarks');
    const bookmarksNode = {
      ...baseBookmarksNode,
      item: {
        ...baseBookmarksNode.item,
        type: 'bookmarks' as const,
      },
    };
    const nodes = [bookmarksNode, dirNode('entries')];

    const filtered = filterHiddenDefaultSidebarNodes(nodes, [BOOKMARKS_SHORTCUT_FOLDER_ID]);

    expect(filtered.map((node) => node.id)).toEqual([`${libraryRootPath}::entries`]);
  });

  it('virtualizes native bookmark folders into the same Bookmarks shortcut used by the app', () => {
    const nodes = [
      dirNode('scratchpad'),
      dirNode('bookmarks-from-x', [dirNode('categories')]),
    ];

    const filtered = virtualizeBookmarksGroup(nodes, {
      path: libraryRootPath,
      label: 'Library',
      builtin: true,
      tree: [],
    });

    expect(filtered.map((node) => node.kind === 'file' ? node.id : node.name)).toEqual([
      BOOKMARKS_ITEM_ID,
      'scratchpad',
    ]);
  });

  it('keeps River visible even if hidden default folder settings include it', () => {
    const nodes = [dirNode('River (shared)'), dirNode('scratchpad')];

    const filtered = filterHiddenDefaultSidebarNodes(nodes, ['River (shared)', 'scratchpad']);

    expect(filtered.map((node) => node.kind === 'dir' ? node.name : node.id)).toEqual(['River (shared)']);
  });

  it('flattens the built-in Library root so River can be promoted by the shortcut splitter', () => {
    const river = dirNode('River (shared)');
    const flattened = flattenBuiltinSidebarRoots([{
      kind: 'dir' as const,
      id: `root:${libraryRootPath}`,
      name: 'Wiki',
      label: 'Wiki',
      relPath: '',
      rootPath: libraryRootPath,
      builtin: true,
      canCreateFile: true,
      children: [river, dirNode('scratchpad')],
    }]);

    expect(flattened).toContain(river);
  });

  it('promotes River (shared) to the top-level River shortcut', () => {
    const river = dirNode('River (shared)', [
      fileNode('wiki:River (shared)/brief', 'brief'),
      fileNode('wiki:River (shared)/plan', 'plan'),
    ]);
    const scratchpad = dirNode('scratchpad');

    const { riverShortcutNode, visibleRoots } = splitRiverShortcutNode([scratchpad, river]);

    expect(riverShortcutNode).toBe(river);
    expect(visibleRoots).toEqual([scratchpad]);
  });

  it('includes the promoted River shortcut when applying sidebar icon colors to all', () => {
    const river = dirNode('River (shared)', [
      fileNode('wiki:River (shared)/brief', 'brief'),
      fileNode('wiki:River (shared)/plan', 'plan'),
    ]);
    const scratchpad = dirNode('scratchpad');
    const { riverShortcutNode, visibleRoots } = splitRiverShortcutNode([scratchpad, river]);

    const targetIds = [
      ...collectSidebarIconTargetIds(visibleRoots),
      ...(riverShortcutNode ? collectSidebarIconTargetIds([riverShortcutNode]) : []),
    ];

    expect(targetIds).toEqual([
      `${libraryRootPath}::scratchpad`,
      'wiki:scratchpad/note',
      `${libraryRootPath}::River (shared)`,
      'wiki:River (shared)/brief',
      'wiki:River (shared)/plan',
    ]);
  });

  it('suppresses one-way hidden-folder context actions when Settings is unavailable', () => {
    expect(getSidebarContextHideDirLabel({
      canHideSidebarDefaultFolders: false,
      contextHideBookmarks: true,
      contextDefaultFolderId: null,
      contextUserFolderId: null,
    })).toBeNull();
    expect(getSidebarContextHideDirLabel({
      canHideSidebarDefaultFolders: true,
      contextHideBookmarks: true,
      contextDefaultFolderId: null,
      contextUserFolderId: null,
    })).toBe('Hide Bookmarks');
    expect(getSidebarContextHideDirLabel({
      canHideSidebarDefaultFolders: true,
      contextHideBookmarks: false,
      contextDefaultFolderId: 'scratchpad',
      contextUserFolderId: null,
    })).toBe('Hide folder');
  });

  it('shows the River shortcut even when Bookmarks is absent', () => {
    expect(getSidebarShortcutVisibility({
      isSearching: false,
      hasBookmarksActionItem: false,
      hasRiverShortcutNode: true,
    })).toEqual({
      showBookmarks: false,
      showRiver: true,
      hasShortcutRows: true,
    });
  });

  it('combines local pins with shared River pins for sidebar ordering', () => {
    const localPins = new Set(['wiki:scratchpad/Note']);
    const sharedPins = new Set(['wiki:River (shared)/Brief AF']);

    const merged = mergeSidebarPinnedItemIds(localPins, sharedPins);

    expect([...merged]).toEqual([
      'wiki:scratchpad/Note',
      'wiki:River (shared)/Brief AF',
    ]);
    expect(mergeSidebarPinnedItemIds(localPins, new Set())).toBe(localPins);
  });

  it('ignores older local River pins so team shared pins are the source of truth', () => {
    const localPins = new Set([
      'wiki:scratchpad/Note',
      'wiki:River (shared)/Old Local AF',
    ]);
    const sharedPins = new Set(['wiki:River (shared)/Team Pin AF']);

    expect([...mergeSidebarPinnedItemIds(localPins, sharedPins)]).toEqual([
      'wiki:scratchpad/Note',
      'wiki:River (shared)/Team Pin AF',
    ]);
    expect([...mergeSidebarPinnedItemIds(localPins, new Set())]).toEqual(['wiki:scratchpad/Note']);
    expect(isRiverSidebarItemId('wiki:River (shared)/Old Local AF')).toBe(true);
  });

  it('recognizes River cache items even when older metadata is missing', () => {
    expect(isSharedRiverSidebarItem({ relPath: 'River (shared)/Brief AF.md' })).toBe(true);
    expect(isSharedRiverSidebarItem({ relPath: 'scratchpad/Brief.md' })).toBe(false);
    expect(isSharedRiverSidebarItem({ relPath: 'scratchpad/Brief.md', sharedAuthorCallsign: 'AMB-MAC' })).toBe(true);
  });
});
