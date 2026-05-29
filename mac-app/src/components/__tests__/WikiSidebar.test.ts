import { describe, expect, it } from 'vitest';
import {
  filterHiddenDefaultSidebarNodes,
  flattenBuiltinSidebarRoots,
  getSidebarShortcutVisibility,
  splitRiverShortcutNode,
} from '../WikiSidebar';

const libraryRootPath = '/Users/afar/.fieldtheory/library';

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

function dirNode(name: string, children = [fileNode(`wiki:${name}/note`, 'note')]) {
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
});
