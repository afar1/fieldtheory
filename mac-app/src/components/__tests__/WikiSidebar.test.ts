import { describe, expect, it } from 'vitest';
import {
  BOOKMARKS_ITEM_ID,
  BOOKMARKS_SHORTCUT_FOLDER_ID,
  collectSidebarIconTargetIds,
  filterHiddenDefaultSidebarNodes,
  flattenBuiltinSidebarRoots,
  getSidebarContextHideDirLabel,
  getSidebarShortcutVisibility,
  isPointerNearRect,
  isRiverSidebarItemId,
  isSharedRiverSidebarItem,
  isWikiSidebarStorageKey,
  mergeSidebarPinnedItemIds,
  readWikiSidebarStoredPreferences,
  splitRiverShortcutNode,
  virtualizeBookmarksGroup,
} from '../WikiSidebar';

const libraryRootPath = '/Users/afar/.fieldtheory/library';

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
