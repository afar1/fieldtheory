import { memo, useState, useEffect, useCallback, useMemo, useRef, type MutableRefObject } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useDeleteConfirmation } from '../hooks/useDeleteConfirmation';

type SortMode = 'alpha' | 'time';

interface UnifiedItem {
  id: string;
  title: string;
  type: 'wiki' | 'artifact' | 'bookmarks' | 'external';
  absPath: string;
  relPath?: string;
  timestamp: number;
}

export const BOOKMARKS_ITEM_ID = 'bookmarks:root';
export const SCRATCHPAD_FOLDER_NAME = 'scratchpad';

interface UnifiedFolder {
  name: string;
  label: string;
  items: UnifiedItem[];
  canCreateFile?: boolean;
}

type SidebarNode =
  | {
      kind: 'dir';
      id: string;
      name: string;
      label: string;
      relPath: string;
      rootPath: string;
      builtin: boolean;
      canCreateFile: boolean;
      canRemoveRoot?: boolean;
      children: SidebarNode[];
    }
  | {
      kind: 'file';
      id: string;
      item: UnifiedItem;
    };

// Lets callers (keyboard shortcuts) drive the inline-create UI since
// Electron silently returns null from window.prompt().
export interface WikiCreationController {
  beginCreateFile: (folder?: string) => void;
  beginCreateDir: (parent?: string) => void;
}

interface WikiSidebarProps {
  onSelectItem: (item: UnifiedItem) => void;
  selectedId: string | null;
  onCreateFile: (folderName: string, fileName: string) => void | Promise<void>;
  onCreateDir: (dirName: string) => void | Promise<void>;
  // Scratchpad's "+" creates an entry titled with the current date (e.g.
  // "Monday Apr 20th") so the user doesn't have to name quick captures.
  onCreateScratchpadDefault?: () => void | Promise<void>;
  flatItemsRef?: MutableRefObject<UnifiedItem[]>;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  searchInputRef?: MutableRefObject<HTMLInputElement | null>;
  creationControllerRef?: MutableRefObject<WikiCreationController | null>;
}

export type { UnifiedItem, UnifiedFolder, SortMode };

export type { SidebarNode as LibrarySidebarNode };

function matchesLibrarySearch(item: UnifiedItem, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;

  return [
    item.title,
    item.relPath,
    item.absPath,
  ]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(normalizedQuery));
}

export function filterUnifiedFolders(folders: UnifiedFolder[], searchQuery: string): UnifiedFolder[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (!normalizedQuery) return folders;

  return folders
    .map((folder) => ({
      ...folder,
      items: folder.items.filter((item) => matchesLibrarySearch(item, normalizedQuery)),
    }))
    .filter((folder) => folder.items.length > 0);
}

/** Split the recent list into wiki/external groups and clip each to a
 *  visible count that expands when the caller passes a non-null `expanded`
 *  kind. Returns stable shapes so the sidebar render can map() blindly. */
export function splitRecent(
  entries: RecentEntry[],
  expanded: 'wiki' | 'external' | null,
  collapsed: number = 3,
  expandedMax: number = 10,
): {
  wiki: RecentEntry[];
  wikiTotal: number;
  external: RecentEntry[];
  externalTotal: number;
} {
  const wikiAll = entries.filter((e) => e.kind === 'wiki');
  const externalAll = entries.filter((e) => e.kind === 'external');
  const wikiLimit = expanded === 'wiki' ? expandedMax : collapsed;
  const externalLimit = expanded === 'external' ? expandedMax : collapsed;
  return {
    wiki: wikiAll.slice(0, wikiLimit),
    wikiTotal: wikiAll.length,
    external: externalAll.slice(0, externalLimit),
    externalTotal: externalAll.length,
  };
}

/** Drop wiki entries from the Recent list whose relPath no longer appears in
 *  the current wiki tree (file was trashed / renamed externally and we
 *  missed the FS event). External entries are left alone since they live
 *  outside the tree. */
export function filterStaleRecent(
  entries: RecentEntry[],
  tree: WikiFolder[],
): RecentEntry[] {
  const live = new Set<string>();
  for (const folder of tree) {
    for (const page of folder.files) live.add(page.relPath);
  }
  return entries.filter((e) => e.kind === 'external' || live.has(e.path));
}

/** Pin Scratchpad at the top when the wiki tree doesn't already expose it, so
 * the user can create ad-hoc docs without running a backfill first. */
export function ensureScratchpadPinned(folders: UnifiedFolder[]): UnifiedFolder[] {
  if (folders.some((f) => f.name === SCRATCHPAD_FOLDER_NAME)) return folders;
  return [
    { name: SCRATCHPAD_FOLDER_NAME, label: 'Scratchpad', items: [], canCreateFile: true },
    ...folders,
  ];
}

function makeBookmarksItem(): UnifiedItem {
  return {
    id: BOOKMARKS_ITEM_ID,
    title: 'View bookmarks',
    type: 'bookmarks',
    absPath: '',
    timestamp: 0,
  };
}

function sidebarNodeSortTimestamp(node: SidebarNode): number {
  if (node.kind === 'file') return node.item.timestamp;
  return node.children.reduce((latest, child) => Math.max(latest, sidebarNodeSortTimestamp(child)), 0);
}

export function sortSidebarNodes(nodes: SidebarNode[], sortMode: SortMode = 'alpha'): SidebarNode[] {
  return [...nodes].sort((a, b) => {
    if (sortMode === 'time') {
      const byTimestamp = sidebarNodeSortTimestamp(b) - sidebarNodeSortTimestamp(a);
      if (byTimestamp !== 0) return byTimestamp;
    }
    const left = a.kind === 'dir' ? a.label : a.item.title;
    const right = b.kind === 'dir' ? b.label : b.item.title;
    return left.localeCompare(right, undefined, { sensitivity: 'base' });
  });
}

function countSidebarItems(nodes: SidebarNode[]): number {
  return nodes.reduce((total, node) => {
    if (node.kind === 'file') return total + (node.item.type === 'bookmarks' ? 0 : 1);
    return total + countSidebarItems(node.children);
  }, 0);
}

function collectSidebarItems(nodes: SidebarNode[]): UnifiedItem[] {
  return nodes.flatMap((node) => {
    if (node.kind === 'file') return [node.item];
    return collectSidebarItems(node.children);
  });
}

function matchesSidebarNode(node: SidebarNode, normalizedQuery: string): boolean {
  if (node.kind === 'file') return matchesLibrarySearch(node.item, normalizedQuery);
  return node.label.toLowerCase().includes(normalizedQuery) || node.relPath.toLowerCase().includes(normalizedQuery);
}

function filterSidebarNodes(nodes: SidebarNode[], searchQuery: string): SidebarNode[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();
  if (!normalizedQuery) return nodes;

  const filtered: SidebarNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'file') {
      if (matchesSidebarNode(node, normalizedQuery)) filtered.push(node);
      continue;
    }
    if (matchesSidebarNode(node, normalizedQuery)) {
      filtered.push(node);
      continue;
    }
    const children = filterSidebarNodes(node.children, normalizedQuery);
    if (children.length > 0) filtered.push({ ...node, children });
  }
  return filtered;
}

function wikiNodeToSidebarNode(node: WikiNode, root: LibraryRoot, sortMode: SortMode): SidebarNode {
  if (node.kind === 'file') {
    const type = root.builtin ? 'wiki' : 'external';
    const id = root.builtin ? `wiki:${node.relPath}` : `external:${node.absPath}`;
    return {
      kind: 'file',
      id,
      item: {
        id,
        title: node.title,
        type,
        absPath: node.absPath,
        relPath: root.builtin ? node.relPath : undefined,
        timestamp: node.lastUpdated,
      },
    };
  }

  return {
    kind: 'dir',
    id: `${root.path}::${node.relPath}`,
    name: node.name,
    label: node.name.charAt(0).toUpperCase() + node.name.slice(1),
    relPath: node.relPath,
    rootPath: root.path,
    builtin: root.builtin,
    canCreateFile: root.builtin,
    children: sortSidebarNodes(node.children.map((child) => wikiNodeToSidebarNode(child, root, sortMode)), sortMode),
  };
}

export function ensureScratchpadNodePinned(nodes: SidebarNode[], root: LibraryRoot): SidebarNode[] {
  const scratchpadIndex = nodes.findIndex((node) => node.kind === 'dir' && node.name === SCRATCHPAD_FOLDER_NAME);
  if (scratchpadIndex === 0) return nodes;
  if (scratchpadIndex > 0) {
    const scratchpad = nodes[scratchpadIndex];
    return [scratchpad, ...nodes.slice(0, scratchpadIndex), ...nodes.slice(scratchpadIndex + 1)];
  }
  return [
    {
      kind: 'dir',
      id: `${root.path}::${SCRATCHPAD_FOLDER_NAME}`,
      name: SCRATCHPAD_FOLDER_NAME,
      label: 'Scratchpad',
      relPath: SCRATCHPAD_FOLDER_NAME,
      rootPath: root.path,
      builtin: true,
      canCreateFile: true,
      children: [],
    },
    ...nodes,
  ];
}

export function virtualizeBookmarksGroup(nodes: SidebarNode[], root: LibraryRoot, sortMode: SortMode = 'alpha'): SidebarNode[] {
  if (!root.builtin) return nodes;

  const bookmarkFolderNames = new Set(['categories', 'domains', 'entities']);
  const bookmarkNodes: SidebarNode[] = [];
  const remainingNodes: SidebarNode[] = [];

  for (const node of nodes) {
    if (node.kind === 'dir' && bookmarkFolderNames.has(node.name)) {
      bookmarkNodes.push(node);
    } else {
      remainingNodes.push(node);
    }
  }

  if (bookmarkNodes.length === 0) return nodes;

  return sortSidebarNodes([
    ...remainingNodes,
    {
      kind: 'dir',
      id: `${root.path}::bookmarks-from-x`,
      name: 'bookmarks-from-x',
      label: 'Bookmarks from x.com',
      relPath: 'bookmarks-from-x',
      rootPath: root.path,
      builtin: true,
      canCreateFile: false,
      children: [
        { kind: 'file', id: BOOKMARKS_ITEM_ID, item: makeBookmarksItem() },
        ...sortSidebarNodes(bookmarkNodes, sortMode),
      ],
    },
  ], sortMode);
}

function rootToSidebarNode(root: LibraryRoot, sortMode: SortMode): SidebarNode {
  let children = sortSidebarNodes(root.tree.map((node) => wikiNodeToSidebarNode(node, root, sortMode)), sortMode);
  if (root.builtin) {
    children = virtualizeBookmarksGroup(children, root, sortMode);
    children = ensureScratchpadNodePinned(children, root);
  }
  return {
    kind: 'dir',
    id: `root:${root.path}`,
    name: root.label,
    label: root.label,
    relPath: '',
    rootPath: root.path,
    builtin: root.builtin,
    canCreateFile: false,
    canRemoveRoot: !root.builtin,
    children,
  };
}

function WikiSidebar({
  onSelectItem,
  selectedId,
  onCreateFile,
  onCreateDir,
  onCreateScratchpadDefault,
  flatItemsRef,
  searchQuery,
  onSearchQueryChange,
  searchInputRef,
  creationControllerRef,
}: WikiSidebarProps) {
  const { theme } = useTheme();
  const { confirmDelete, deleteConfirmationDialog } = useDeleteConfirmation();
  const [wikiTree, setWikiTree] = useState<WikiFolder[]>([]);
  const [libraryRoots, setLibraryRoots] = useState<LibraryRoot[]>([]);
  const [artifacts, setArtifacts] = useState<ReadingMeta[]>([]);
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const saved = localStorage.getItem('library-sort-mode');
    return saved === 'time' ? 'time' : 'alpha';
  });
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('wiki-expanded-folders');
      return saved ? new Set(JSON.parse(saved)) : new Set(['artifacts']);
    } catch {
      return new Set(['artifacts']);
    }
  });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [creating, setCreating] = useState<
    | { kind: 'file'; folder: string }
    | { kind: 'dir'; parent?: string }
    | null
  >(null);
  const [newName, setNewName] = useState('');
  const createInputRef = useRef<HTMLInputElement | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [recentExpanded, setRecentExpanded] = useState<'wiki' | 'external' | null>(null);
  const [recentCollapsed, setRecentCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('wiki-recent-collapsed') === '1';
    } catch {
      return false;
    }
  });
  const selectedItemRef = useRef<HTMLDivElement | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: SidebarNode | null;
  } | null>(null);

  // Auto-expand the parent folder of the selected wiki item so programmatic
  // opens (open-file, wiki:// links, Recent clicks) reveal the entry instead
  // of leaving it hidden under a collapsed folder.
  useEffect(() => {
    if (!selectedId?.startsWith('wiki:')) return;
    const relPath = selectedId.slice('wiki:'.length);
    const builtinRoot = libraryRoots.find((root) => root.builtin);
    if (!builtinRoot) return;
    const parts = relPath.split('/').filter(Boolean);
    if (parts.length < 2) return;
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.add(`root:${builtinRoot.path}`);
      for (let index = 1; index < parts.length; index += 1) {
        next.add(`${builtinRoot.path}::${parts.slice(0, index).join('/')}`);
      }
      return next;
    });
  }, [selectedId, libraryRoots]);

  // Scroll the selected item into view when the selection changes programmatically.
  useEffect(() => {
    if (!selectedId) return;
    // Defer to next frame so the newly-expanded folder has rendered its items.
    const id = requestAnimationFrame(() => {
      selectedItemRef.current?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(id);
  }, [selectedId]);

  const loadTree = useCallback(async () => {
    const [treeResult, rootsResult] = await Promise.all([
      window.wikiAPI?.getTree(),
      window.libraryAPI?.getRoots(),
    ]);
    if (treeResult) setWikiTree(treeResult);
    if (rootsResult) {
      setLibraryRoots(rootsResult);
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        for (const root of rootsResult) {
          if (root.builtin) next.add(`root:${root.path}`);
        }
        return next;
      });
    }
  }, []);

  const loadArtifacts = useCallback(async () => {
    const result = await window.librarianAPI?.getReadings();
    if (result) setArtifacts(result);
  }, []);

  const loadRecent = useCallback(async () => {
    const result = await window.recentAPI?.list();
    if (result) setRecent(result);
  }, []);

  useEffect(() => {
    loadTree();
    loadArtifacts();
    loadRecent();
    const unsubWiki = window.wikiAPI?.onPageChanged(() => loadTree());
    const unsubLibrary = window.libraryAPI?.onRootsChanged(() => loadTree());
    const unsubAdded = window.librarianAPI?.onReadingAdded(() => loadArtifacts());
    const unsubRemoved = window.librarianAPI?.onReadingRemoved(() => loadArtifacts());
    const unsubUpdated = window.librarianAPI?.onReadingUpdated(() => loadArtifacts());
    const unsubRecent = window.recentAPI?.onChanged(() => loadRecent());
    // Backstop for missed FSEvents (sleep/wake, bg writes): reload on focus.
    const onFocus = () => {
      loadTree();
      loadArtifacts();
      loadRecent();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      unsubWiki?.();
      unsubLibrary?.();
      unsubAdded?.();
      unsubRemoved?.();
      unsubUpdated?.();
      unsubRecent?.();
      window.removeEventListener('focus', onFocus);
    };
  }, [loadTree, loadArtifacts, loadRecent]);

  useEffect(() => {
    localStorage.setItem('wiki-expanded-folders', JSON.stringify([...expandedFolders]));
  }, [expandedFolders]);

  useEffect(() => {
    localStorage.setItem('library-sort-mode', sortMode);
  }, [sortMode]);

  useEffect(() => {
    localStorage.setItem('wiki-recent-collapsed', recentCollapsed ? '1' : '0');
  }, [recentCollapsed]);

  const toggleFolder = (name: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const beginCreateFile = useCallback((folder?: string) => {
    const target = folder ?? SCRATCHPAD_FOLDER_NAME;
    // Scratchpad has a default-name flow (today's date) — skip the naming
    // input so quick captures stay one click / shortcut away.
    if (target === SCRATCHPAD_FOLDER_NAME && onCreateScratchpadDefault) {
      void onCreateScratchpadDefault();
      return;
    }
    setExpandedFolders((prev) => {
      const builtinRoot = libraryRoots.find((root) => root.builtin);
      const targetKey = builtinRoot ? `${builtinRoot.path}::${target}` : target;
      if (prev.has(targetKey)) return prev;
      const next = new Set(prev);
      next.add(targetKey);
      return next;
    });
    setCreating({ kind: 'file', folder: target });
    setNewName('');
  }, [libraryRoots, onCreateScratchpadDefault]);

  const beginCreateDir = useCallback((parent?: string) => {
    setCreating({ kind: 'dir', parent });
    setNewName('');
  }, []);

  useEffect(() => {
    if (!creationControllerRef) return;
    creationControllerRef.current = { beginCreateFile, beginCreateDir };
    return () => { creationControllerRef.current = null; };
  }, [creationControllerRef, beginCreateFile, beginCreateDir]);

  useEffect(() => {
    if (creating) createInputRef.current?.focus();
  }, [creating]);

  const cancelCreate = useCallback(() => {
    setCreating(null);
    setNewName('');
  }, []);

  const submitCreate = useCallback(async () => {
    const name = newName.trim();
    if (!name || !creating) { cancelCreate(); return; }
    if (creating.kind === 'file') await onCreateFile(creating.folder, name);
    else await onCreateDir(creating.parent ? `${creating.parent}/${name}` : name);
    setCreating(null);
    setNewName('');
  }, [newName, creating, onCreateFile, onCreateDir, cancelCreate]);

  const sidebarRoots = useMemo(() => {
    const roots: SidebarNode[] = [];

    if (artifacts.length > 0) {
      const items: UnifiedItem[] = artifacts.map((r) => ({
        id: `artifact:${r.path}`,
        title: r.title,
        type: 'artifact' as const,
        absPath: r.path,
        timestamp: r.createdAt,
      }));
      if (sortMode === 'alpha') {
        items.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
      } else {
        items.sort((a, b) => b.timestamp - a.timestamp);
      }
      roots.push({
        kind: 'dir',
        id: 'artifacts',
        name: 'artifacts',
        label: 'Artifacts',
        relPath: 'artifacts',
        rootPath: 'artifacts',
        builtin: false,
        canCreateFile: false,
        children: items.map((item) => ({ kind: 'file' as const, id: item.id, item })),
      });
    }

    roots.push(...libraryRoots.map((root) => rootToSidebarNode(root, sortMode)));
    return roots;
  }, [artifacts, libraryRoots, sortMode]);

  const filteredSidebarRoots = useMemo(
    () => filterSidebarNodes(sidebarRoots, searchQuery),
    [sidebarRoots, searchQuery]
  );

  const flatItems = useMemo(() => collectSidebarItems(filteredSidebarRoots), [filteredSidebarRoots]);
  if (flatItemsRef) flatItemsRef.current = flatItems;

  const totalPages = countSidebarItems(sidebarRoots);
  const visiblePages = flatItems.length;
  const isSearching = searchQuery.trim().length > 0;

  const emptyWiki = sidebarRoots.length === 0;

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const openContextMenu = useCallback((event: React.MouseEvent, node: SidebarNode | null) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ x: event.clientX, y: event.clientY, node });
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeContextMenu();
    };
    const onPointerDown = () => closeContextMenu();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousedown', onPointerDown);
    };
  }, [contextMenu, closeContextMenu]);

  const contextDir = contextMenu?.node?.kind === 'dir' ? contextMenu.node : null;
  const contextFile = contextMenu?.node?.kind === 'file' ? contextMenu.node.item : null;
  const contextCreateTarget = contextDir?.builtin && contextDir.relPath ? contextDir.relPath : undefined;
  const canDeleteContextFile = contextFile?.type === 'wiki' || contextFile?.type === 'artifact';

  const addFolderFromPath = useCallback(async () => {
    closeContextMenu();
    const picked = await window.libraryAPI?.pickFolder();
    if (!picked) return;
    const root = await window.libraryAPI?.addRoot(picked);
    if (!root) return;
    await loadTree();
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.add(`root:${root.path}`);
      return next;
    });
  }, [closeContextMenu, loadTree]);

  const removeContextRoot = useCallback(async () => {
    const target = contextDir;
    closeContextMenu();
    if (!target?.canRemoveRoot) return;
    await window.libraryAPI?.removeRoot(target.rootPath);
    await loadTree();
  }, [closeContextMenu, contextDir, loadTree]);

  const deleteContextFile = useCallback(() => {
    const target = contextFile;
    closeContextMenu();
    if (!target || (target.type !== 'wiki' && target.type !== 'artifact')) return;

    if (target.type === 'wiki') {
      if (!target.relPath) return;
      confirmDelete({
        title: 'Delete page?',
        message: `Move "${target.title}" to Trash?`,
        confirmLabel: 'Move to Trash',
        onConfirm: async () => {
          await window.wikiAPI?.deletePage(target.relPath!);
        },
      });
      return;
    }

    confirmDelete({
      title: 'Delete artifact?',
      message: `Delete "${target.title}"? This cannot be undone.`,
      onConfirm: async () => {
        const shareStatus = await window.librarianAPI?.getShareStatus(target.absPath);
        if (shareStatus?.shared) {
          await window.librarianAPI?.unshareReading(target.absPath);
        }
        await window.librarianAPI?.deleteReading(target.absPath);
      },
    });
  }, [closeContextMenu, confirmDelete, contextFile]);

  return (
    <div
      onContextMenu={(event) => openContextMenu(event, null)}
      onClick={closeContextMenu}
      style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', position: 'relative' }}
    >
      <style>{`
        .bm-folder-header:hover .bm-new-file-btn { opacity: 0.7; }
        .bm-new-file-btn:hover { opacity: 1 !important; }
      `}</style>
      <div style={{ padding: '0 12px 4px', display: 'flex', alignItems: 'center', gap: '6px' }}>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setSortMode(sortMode === 'alpha' ? 'time' : 'alpha')}
          style={{
            padding: '2px 4px',
            fontSize: '10px',
            color: theme.textSecondary,
            backgroundColor: 'transparent',
            border: 'none',
            cursor: 'pointer',
            borderRadius: '3px',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            opacity: 0.7,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.backgroundColor = theme.hoverBg; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7'; e.currentTarget.style.backgroundColor = 'transparent'; }}
          title={sortMode === 'alpha' ? 'Sort by date' : 'Sort A-Z'}
        >
          {sortMode === 'alpha' ? (
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              <path d="M10.082 5.629 9.664 7H8.598l1.789-5.332h1.234L13.402 7h-1.12l-.419-1.371h-1.781zm1.57-.785L11 2.687h-.047l-.652 2.157h1.351z"/>
              <path d="M12.96 14H9.028v-.691l2.579-3.72v-.054H9.098v-.867h3.785v.691l-2.567 3.72v.054h2.645V14zM4.5 2.5a.5.5 0 0 0-1 0v9.793l-1.146-1.147a.5.5 0 0 0-.708.708l2 2a.5.5 0 0 0 .708 0l2-2a.5.5 0 0 0-.708-.708L4.5 12.293V2.5z"/>
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3 0a.5.5 0 0 1 .5.5V2h5a.5.5 0 0 1 0 1h-5v1.5a.5.5 0 0 1-1 0v-4A.5.5 0 0 1 3 0z"/>
              <path d="M7.823 2.823l-2.396 2.396A.25.25 0 0 0 5.604 5.5h4.792a.25.25 0 0 0 .177-.427L8.177 2.823a.25.25 0 0 0-.354 0z"/>
              <path d="M4.5 2.5a.5.5 0 0 0-1 0v9.793l-1.146-1.147a.5.5 0 0 0-.708.708l2 2a.5.5 0 0 0 .708 0l2-2a.5.5 0 0 0-.708-.708L4.5 12.293V2.5z"/>
            </svg>
          )}
          <span>{sortMode === 'alpha' ? 'A-Z' : 'Date'}</span>
        </button>
      </div>

      <div style={{ padding: '0 12px 8px' }}>
        <input
          ref={searchInputRef}
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          placeholder="Search library (⌘F)"
          style={{
            width: '100%',
            padding: '7px 10px',
            fontSize: '11px',
            color: theme.text,
            backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
            border: `1px solid ${theme.border}`,
            borderRadius: '6px',
            outline: 'none',
          }}
        />
      </div>

      {/* Page count */}
      <div style={{ padding: '0 12px 8px', fontSize: '10px', color: theme.textSecondary, opacity: 0.6 }}>
        {isSearching ? `${visiblePages} of ${totalPages} pages` : `${totalPages} pages`}
      </div>

      {emptyWiki ? (
        <div style={{ padding: '8px 12px', fontSize: '11px', color: theme.textSecondary }}>
          No pages yet. Run <code style={{ fontSize: '10px', background: theme.hoverBg, padding: '1px 4px', borderRadius: '3px' }}>ft sync && ft wiki</code> to generate.
        </div>
      ) : filteredSidebarRoots.length === 0 ? (
        <div style={{ padding: '8px 12px', fontSize: '11px', color: theme.textSecondary }}>
          No pages match that search.
        </div>
      ) : filteredSidebarRoots.map((node) => (
        <TreeNode
          key={node.id}
          node={node}
          depth={0}
          isSearching={isSearching}
          expandedFolders={expandedFolders}
          toggleFolder={toggleFolder}
          creating={creating}
          newName={newName}
          setNewName={setNewName}
          createInputRef={createInputRef}
          submitCreate={submitCreate}
          cancelCreate={cancelCreate}
          beginCreateFile={beginCreateFile}
          selectedId={selectedId}
          selectedItemRef={selectedItemRef}
          hoveredId={hoveredId}
          setHoveredId={setHoveredId}
          theme={theme}
          onSelectItem={onSelectItem}
          onContextMenu={openContextMenu}
        />
      ))}

      {creating?.kind === 'dir' && !creating.parent && (
        <CreateInput
          inputRef={createInputRef}
          value={newName}
          onChange={setNewName}
          onSubmit={submitCreate}
          onCancel={cancelCreate}
          theme={theme}
          depth={0}
          placeholder="New folder"
        />
      )}

      {contextMenu && (
        <LibraryContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          theme={theme}
          canRemoveRoot={!!contextDir?.canRemoveRoot}
          canDelete={canDeleteContextFile}
          onNewFile={() => {
            closeContextMenu();
            beginCreateFile(contextCreateTarget);
          }}
          onNewFolder={() => {
            closeContextMenu();
            beginCreateDir(contextCreateTarget);
          }}
          onAddFolder={addFolderFromPath}
          onRemoveRoot={removeContextRoot}
          onDelete={deleteContextFile}
        />
      )}
      {deleteConfirmationDialog}

      {!isSearching && recent.length > 0 && (
        <RecentBlock
          recent={filterStaleRecent(recent, wikiTree)}
          expanded={recentExpanded}
          onExpand={setRecentExpanded}
          collapsed={recentCollapsed}
          onToggleCollapsed={() => setRecentCollapsed((v) => !v)}
          selectedId={selectedId}
          theme={theme}
          onOpenWiki={(relPath, title) =>
            onSelectItem({
              id: `wiki:${relPath}`,
              title,
              type: 'wiki',
              // Recent wiki items don't carry the abs path; Show-in-Finder
              // isn't exposed here so the empty string is fine.
              absPath: '',
              relPath,
              timestamp: 0,
            })
          }
          onOpenExternal={(absPath, title) =>
            onSelectItem({
              id: `external:${absPath}`,
              title,
              type: 'external',
              absPath,
              timestamp: 0,
            })
          }
        />
      )}
    </div>
  );
}

export default memo(WikiSidebar);

function CreateInput({ inputRef, value, onChange, onSubmit, onCancel, theme, depth, placeholder }: {
  inputRef: MutableRefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  onCancel: () => void;
  theme: ReturnType<typeof useTheme>['theme'];
  depth: number;
  placeholder: string;
}) {
  return (
    <div style={{ padding: `4px 12px 4px ${28 + depth * 12}px` }}>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void onSubmit(); }
          else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        onBlur={onCancel}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '4px 6px',
          fontSize: '11px',
          color: theme.text,
          backgroundColor: theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
          border: `1px solid ${theme.border}`,
          borderRadius: '4px',
          outline: 'none',
        }}
      />
    </div>
  );
}

function TreeNode({
  node,
  depth,
  isSearching,
  expandedFolders,
  toggleFolder,
  creating,
  newName,
  setNewName,
  createInputRef,
  submitCreate,
  cancelCreate,
  beginCreateFile,
  selectedId,
  selectedItemRef,
  hoveredId,
  setHoveredId,
  theme,
  onSelectItem,
  onContextMenu,
}: {
  node: SidebarNode;
  depth: number;
  isSearching: boolean;
  expandedFolders: Set<string>;
  toggleFolder: (id: string) => void;
  creating: { kind: 'file'; folder: string } | { kind: 'dir'; parent?: string } | null;
  newName: string;
  setNewName: (value: string) => void;
  createInputRef: MutableRefObject<HTMLInputElement | null>;
  submitCreate: () => void | Promise<void>;
  cancelCreate: () => void;
  beginCreateFile: (folder?: string) => void;
  selectedId: string | null;
  selectedItemRef: MutableRefObject<HTMLDivElement | null>;
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
  theme: ReturnType<typeof useTheme>['theme'];
  onSelectItem: (item: UnifiedItem) => void;
  onContextMenu: (event: React.MouseEvent, node: SidebarNode | null) => void;
}) {
  if (node.kind === 'file') {
    const isSel = node.item.id === selectedId;
    return (
      <FileItem
        item={node.item}
        depth={depth}
        isSelected={isSel}
        isHovered={node.item.id === hoveredId}
        theme={theme}
        onSelect={() => onSelectItem(node.item)}
        onHover={setHoveredId}
        onContextMenu={(event) => onContextMenu(event, node)}
        refProp={isSel ? selectedItemRef : undefined}
      />
    );
  }

  const isExpanded = isSearching || expandedFolders.has(node.id);
  const itemCount = countSidebarItems(node.children);

  return (
    <div>
      <div
        className="bm-folder-header"
        onClick={() => toggleFolder(node.id)}
        onContextMenu={(event) => onContextMenu(event, node)}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.hoverBg)}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: `6px 12px 6px ${12 + depth * 12}px`,
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: 500,
          color: theme.text,
          userSelect: 'none',
        }}
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          fill="currentColor"
          style={{
            transition: 'transform 0.15s ease',
            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
            flexShrink: 0,
            color: theme.textSecondary,
          }}
        >
          <path d="M2 1l4 3-4 3V1z" />
        </svg>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{node.label}</span>
        <span style={{ color: theme.textSecondary, fontWeight: 400, fontSize: '11px', opacity: 0.5 }}>
          {itemCount}
        </span>
        {node.canCreateFile && (
          <button
            className="bm-new-file-btn"
            onClick={(e) => { e.stopPropagation(); beginCreateFile(node.relPath); }}
            title={node.name === SCRATCHPAD_FOLDER_NAME ? 'New scratchpad entry' : 'New file'}
            aria-label={`New file in ${node.label}`}
            style={{
              marginLeft: 'auto',
              width: '18px',
              height: '18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0,
              background: 'transparent',
              border: 'none',
              borderRadius: '3px',
              color: theme.textSecondary,
              cursor: 'pointer',
              opacity: 0,
              transition: 'opacity 0.12s ease, background 0.12s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <path d="M8 3v10M3 8h10" />
            </svg>
          </button>
        )}
      </div>

      {node.canCreateFile && creating?.kind === 'file' && creating.folder === node.relPath && (
        <CreateInput
          inputRef={createInputRef}
          value={newName}
          onChange={setNewName}
          onSubmit={submitCreate}
          onCancel={cancelCreate}
          theme={theme}
          depth={depth}
          placeholder="Untitled"
        />
      )}

      {node.builtin && creating?.kind === 'dir' && creating.parent === node.relPath && (
        <CreateInput
          inputRef={createInputRef}
          value={newName}
          onChange={setNewName}
          onSubmit={submitCreate}
          onCancel={cancelCreate}
          theme={theme}
          depth={depth}
          placeholder="New folder"
        />
      )}

      {isExpanded && node.children.map((child) => (
        <TreeNode
          key={child.id}
          node={child}
          depth={depth + 1}
          isSearching={isSearching}
          expandedFolders={expandedFolders}
          toggleFolder={toggleFolder}
          creating={creating}
          newName={newName}
          setNewName={setNewName}
          createInputRef={createInputRef}
          submitCreate={submitCreate}
          cancelCreate={cancelCreate}
          beginCreateFile={beginCreateFile}
          selectedId={selectedId}
          selectedItemRef={selectedItemRef}
          hoveredId={hoveredId}
          setHoveredId={setHoveredId}
          theme={theme}
          onSelectItem={onSelectItem}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  );
}

function LibraryContextMenu({ x, y, theme, canRemoveRoot, canDelete, onNewFile, onNewFolder, onAddFolder, onRemoveRoot, onDelete }: {
  x: number;
  y: number;
  theme: ReturnType<typeof useTheme>['theme'];
  canRemoveRoot: boolean;
  canDelete: boolean;
  onNewFile: () => void;
  onNewFolder: () => void;
  onAddFolder: () => void;
  onRemoveRoot: () => void;
  onDelete: () => void;
}) {
  const itemStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    padding: '6px 10px',
    textAlign: 'left',
    fontSize: '12px',
    color: theme.text,
    background: 'transparent',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
  };
  const setHover = (event: React.MouseEvent<HTMLButtonElement>, danger = false) => {
    event.currentTarget.style.backgroundColor = danger
      ? (theme.isDark ? 'rgba(239,68,68,0.14)' : 'rgba(239,68,68,0.1)')
      : theme.hoverBg;
  };
  const clearHover = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.style.backgroundColor = 'transparent';
  };

  return (
    <div
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 1000,
        minWidth: '170px',
        padding: '4px',
        backgroundColor: theme.surface2,
        border: `1px solid ${theme.border}`,
        borderRadius: '6px',
        boxShadow: theme.isDark ? '0 8px 24px rgba(0,0,0,0.45)' : '0 8px 24px rgba(0,0,0,0.15)',
      }}
    >
      <button style={itemStyle} onClick={onNewFile} onMouseEnter={setHover} onMouseLeave={clearHover}>New file</button>
      <button style={itemStyle} onClick={onNewFolder} onMouseEnter={setHover} onMouseLeave={clearHover}>New folder</button>
      <button style={itemStyle} onClick={onAddFolder} onMouseEnter={setHover} onMouseLeave={clearHover}>Add folder from path...</button>
      {canRemoveRoot && (
        <button style={itemStyle} onClick={onRemoveRoot} onMouseEnter={setHover} onMouseLeave={clearHover}>Remove from library</button>
      )}
      {canDelete && (
        <button
          style={{ ...itemStyle, color: '#dc2626' }}
          onClick={onDelete}
          onMouseEnter={(event) => setHover(event, true)}
          onMouseLeave={clearHover}
        >
          Delete
        </button>
      )}
    </div>
  );
}

function FileItem({ item, depth = 0, isSelected, isHovered, theme, onSelect, onHover, onContextMenu, refProp }: {
  item: UnifiedItem;
  depth?: number;
  isSelected: boolean;
  isHovered: boolean;
  theme: ReturnType<typeof useTheme>['theme'];
  onSelect: () => void;
  onHover: (id: string | null) => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  refProp?: MutableRefObject<HTMLDivElement | null>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

  const canRename = item.type === 'wiki' && !!item.relPath;

  const commitRename = async () => {
    if (!renaming) return;
    const trimmed = draft.trim();
    setRenaming(false);
    if (!canRename || !item.relPath || !trimmed || trimmed === item.title) return;
    await window.wikiAPI?.rename(item.relPath, trimmed);
  };

  return (
    <div
      ref={refProp}
      onContextMenu={onContextMenu}
      onClick={(e) => {
        // Cmd-click on a wiki item enters inline rename; regular click selects.
        if (canRename && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          e.stopPropagation();
          setDraft(item.title);
          setRenaming(true);
          return;
        }
        onSelect();
      }}
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover(null)}
      style={{
        padding: `6px 8px 6px ${28 + depth * 12}px`,
        cursor: 'pointer',
        backgroundColor: isSelected
          ? (theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')
          : 'transparent',
        borderLeft: isSelected ? `2px solid ${theme.accent}` : '2px solid transparent',
        transition: 'background-color 0.1s ease',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '4px',
      }}>
        {renaming ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void commitRename(); }
              else if (e.key === 'Escape') { e.preventDefault(); setRenaming(false); }
            }}
            onBlur={() => { void commitRename(); }}
            style={{
              flex: 1,
              minWidth: 0,
              padding: '1px 4px',
              fontSize: '12px',
              fontWeight: 500,
              backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)',
              border: `1px solid ${theme.accent}`,
              borderRadius: '3px',
              color: theme.text,
              outline: 'none',
            }}
          />
        ) : (
          <div style={{
            fontSize: '12px',
            fontWeight: 500,
            color: theme.text,
            lineHeight: 1.3,
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {item.title}
          </div>
        )}
        {isHovered && item.absPath && item.type !== 'bookmarks' && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              window.shellAPI?.showItemInFolder(item.absPath);
            }}
            style={{
              padding: '0',
              width: '16px',
              height: '16px',
              color: theme.textSecondary,
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '3px',
              opacity: 0.7,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '1';
              e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '0.7';
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
            title="Show in Finder"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9zM2.5 3a.5.5 0 0 0-.5.5V6h12v-.5a.5.5 0 0 0-.5-.5H9c-.964 0-1.71-.629-2.174-1.154C6.374 3.334 5.82 3 5.264 3H2.5zM14 7H2v5.5a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V7z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}

interface RecentBlockProps {
  recent: RecentEntry[];
  expanded: 'wiki' | 'external' | null;
  onExpand: (kind: 'wiki' | 'external' | null) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  selectedId: string | null;
  theme: ReturnType<typeof useTheme>['theme'];
  onOpenWiki: (relPath: string, title: string) => void;
  onOpenExternal: (absPath: string, title: string) => void;
}

function RecentBlock({ recent, expanded, onExpand, collapsed, onToggleCollapsed, selectedId, theme, onOpenWiki, onOpenExternal }: RecentBlockProps) {
  const { wiki, wikiTotal, external, externalTotal } = splitRecent(recent, expanded);
  if (wikiTotal === 0 && externalTotal === 0) return null;

  const showBothSubheads = wikiTotal > 0 && externalTotal > 0;
  const headerStyle: React.CSSProperties = {
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: 500,
    color: theme.textSecondary,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    cursor: 'pointer',
    userSelect: 'none',
  };
  const subheadStyle: React.CSSProperties = {
    ...headerStyle,
    padding: '4px 12px 2px 20px',
    opacity: 0.5,
  };
  const itemStyle = (isSelected: boolean): React.CSSProperties => ({
    padding: '5px 12px 5px 20px',
    fontSize: '11.5px',
    cursor: 'pointer',
    color: theme.text,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    backgroundColor: isSelected ? (theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)') : 'transparent',
    borderLeft: isSelected ? `2px solid ${theme.accent}` : '2px solid transparent',
  });
  const showMoreStyle: React.CSSProperties = {
    padding: '3px 12px 5px 20px',
    fontSize: '10px',
    color: theme.textSecondary,
    cursor: 'pointer',
    opacity: 0.6,
  };

  const renderSection = (
    kind: 'wiki' | 'external',
    entries: RecentEntry[],
    total: number,
  ) => (
    <>
      {showBothSubheads && (
        <div style={subheadStyle}>{kind === 'wiki' ? 'Wiki' : 'External'}</div>
      )}
      {entries.map((e) => {
        const id = `${kind}:${e.path}`;
        const isSel = selectedId === id;
        return (
          <div
            key={id}
            onClick={() => (kind === 'wiki' ? onOpenWiki(e.path, e.title) : onOpenExternal(e.path, e.title))}
            style={itemStyle(isSel)}
            title={kind === 'external' ? e.path : e.title}
            onMouseEnter={(el) => { if (!isSel) el.currentTarget.style.backgroundColor = theme.hoverBg; }}
            onMouseLeave={(el) => { if (!isSel) el.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            {e.title}
          </div>
        );
      })}
      {total > entries.length && (
        <div onClick={() => onExpand(kind)} style={showMoreStyle}>Show more ({total - entries.length})</div>
      )}
      {expanded === kind && (
        <div onClick={() => onExpand(null)} style={showMoreStyle}>Show less</div>
      )}
    </>
  );

  return (
    <div style={{ marginBottom: '4px' }}>
      <hr
        style={{
          border: 'none',
          height: '1px',
          margin: '8px 12px 4px',
          backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
        }}
      />
      <div style={headerStyle} onClick={onToggleCollapsed}>
        <svg
          width="8"
          height="8"
          viewBox="0 0 8 8"
          fill="currentColor"
          style={{
            transition: 'transform 0.15s ease',
            transform: collapsed ? 'rotate(0deg)' : 'rotate(90deg)',
            flexShrink: 0,
          }}
        >
          <path d="M2 1l4 3-4 3V1z" />
        </svg>
        <span>Recent</span>
      </div>
      {!collapsed && wikiTotal > 0 && renderSection('wiki', wiki, wikiTotal)}
      {!collapsed && externalTotal > 0 && renderSection('external', external, externalTotal)}
    </div>
  );
}
