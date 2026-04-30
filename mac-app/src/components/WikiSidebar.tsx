import { memo, useState, useEffect, useCallback, useMemo, useRef, type MutableRefObject } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useDeleteConfirmation } from '../hooks/useDeleteConfirmation';
import {
  SIDEBAR_DARK_ICON_COLOR,
  SIDEBAR_DARK_TEXT_COLOR,
  SIDEBAR_ICON_TEXT_GAP,
  SIDEBAR_LIGHT_ICON_COLOR,
  SIDEBAR_LIGHT_TEXT_COLOR,
  SidebarBookmarkIcon,
  SidebarFolderIcon,
  SidebarMarkdownIcon,
  SidebarRecentIcon,
} from './SidebarIcons';

type SortMode = 'alpha' | 'time';
type SidebarTodoState = 'open' | 'done';
type SidebarTodoStateOverride = SidebarTodoState | null;

interface UnifiedItem {
  id: string;
  title: string;
  type: 'wiki' | 'artifact' | 'bookmarks' | 'external';
  absPath: string;
  relPath?: string;
  rootPath?: string;
  timestamp: number;
  todoState?: SidebarTodoState;
  taggedDocId?: string;
  hasUnread?: boolean;
}

export const BOOKMARKS_ITEM_ID = 'bookmarks:root';
export const SCRATCHPAD_FOLDER_NAME = 'scratchpad';
export const LIBRARY_DEFAULT_FOLDER_IDS = [
  'artifacts',
  SCRATCHPAD_FOLDER_NAME,
  'Shared Markdown',
  'debates',
  'bookmarks-from-x',
  'entries',
  'categories',
  'domains',
  'entities',
] as const;
export type LibraryDefaultFolderId = typeof LIBRARY_DEFAULT_FOLDER_IDS[number];
const LIBRARY_DEFAULT_FOLDER_ID_SET = new Set<string>(LIBRARY_DEFAULT_FOLDER_IDS);
const LEGACY_HIDDEN_DEFAULT_FOLDER_IDS = ['concepts'] as const;
const LIBRARY_DRAG_DATA_TYPE = 'application/x-fieldtheory-library-item';
const LIBRARY_DRAG_TEXT_PREFIX = 'fieldtheory-library-item:';
const LIBRARY_SIDEBAR_ROW_PADDING_Y = '6px';
const LIBRARY_SIDEBAR_ROW_LINE_HEIGHT = '16px';
const LIBRARY_SIDEBAR_ROW_MIN_HEIGHT = '28px';
const LIBRARY_SIDEBAR_FADE_WIDTH = 28;
const LIBRARY_SIDEBAR_HOVER_FADE_WIDTH = 44;
const SCRATCHPAD_COLLAPSED_ITEM_LIMIT = 20;
const EMPTY_TODO_STATE_OVERRIDES: Record<string, SidebarTodoStateOverride | undefined> = {};
const librarySidebarFadeTextStyle = (fadeWidth = LIBRARY_SIDEBAR_FADE_WIDTH): React.CSSProperties => ({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  WebkitMaskImage: `linear-gradient(to right, #000 calc(100% - ${fadeWidth}px), transparent)`,
  maskImage: `linear-gradient(to right, #000 calc(100% - ${fadeWidth}px), transparent)`,
});

type LibraryDragItem = {
  rootPath: string;
  kind: 'file' | 'dir';
  relPath: string;
};

let activeLibraryDragItem: LibraryDragItem | null = null;

export function setLibraryDragData(dataTransfer: DataTransfer, item: LibraryDragItem): void {
  activeLibraryDragItem = item;
  const serialized = JSON.stringify(item);
  dataTransfer.setData(LIBRARY_DRAG_DATA_TYPE, serialized);
  dataTransfer.setData('text/plain', `${LIBRARY_DRAG_TEXT_PREFIX}${serialized}`);
  dataTransfer.effectAllowed = 'move';
}

export function clearLibraryDragData(): void {
  activeLibraryDragItem = null;
}

export function hasLibraryDragData(dataTransfer: DataTransfer): boolean {
  if (activeLibraryDragItem) return true;
  const types = Array.from(dataTransfer.types);
  if (types.includes(LIBRARY_DRAG_DATA_TYPE)) return true;
  if (!types.includes('text/plain')) return false;
  return dataTransfer.getData('text/plain').startsWith(LIBRARY_DRAG_TEXT_PREFIX);
}

export function getLibraryDragData(dataTransfer: DataTransfer): LibraryDragItem | null {
  const rawCustom = dataTransfer.getData(LIBRARY_DRAG_DATA_TYPE);
  const rawText = dataTransfer.getData('text/plain');
  const raw = rawCustom || (rawText.startsWith(LIBRARY_DRAG_TEXT_PREFIX) ? rawText.slice(LIBRARY_DRAG_TEXT_PREFIX.length) : '');
  if (!raw) return activeLibraryDragItem;
  try {
    const item = JSON.parse(raw) as Partial<LibraryDragItem>;
    if (!item.rootPath || !item.relPath || (item.kind !== 'file' && item.kind !== 'dir')) return null;
    return item as LibraryDragItem;
  } catch {
    return activeLibraryDragItem;
  }
}

export function canDropLibraryItem(item: LibraryDragItem | null, target: LibraryCreateLocation): boolean {
  if (!item) return false;
  if (item.rootPath !== target.rootPath) return false;
  if (item.kind === 'dir') {
    if (item.relPath === target.relPath) return false;
    if (target.relPath.startsWith(`${item.relPath}/`)) return false;
  }
  const sourceParent = item.relPath.split('/').slice(0, -1).join('/');
  if (sourceParent === target.relPath) return false;
  return true;
}

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
      canDeleteDir?: boolean;
      canRemoveRoot?: boolean;
      hasUnread?: boolean;
      children: SidebarNode[];
    }
  | {
      kind: 'file';
      id: string;
      item: UnifiedItem;
    };

export interface LibraryCreateLocation {
  rootPath: string;
  relPath: string;
  builtin: boolean;
}

type LibraryCreateTarget = string | LibraryCreateLocation;

type CreatingState =
  | { kind: 'file'; location: LibraryCreateLocation }
  | { kind: 'dir'; location: LibraryCreateLocation }
  | null;

type TaggedDocListItem = {
  ulid: string;
  path: string;
  unread: boolean;
};

// Lets callers (keyboard shortcuts) drive the inline-create UI since
// Electron silently returns null from window.prompt().
export interface WikiCreationController {
  beginCreateFile: (target?: LibraryCreateTarget) => void;
  beginCreateDir: (target?: LibraryCreateTarget) => void;
}

interface WikiSidebarProps {
  active?: boolean;
  onSelectItem: (item: UnifiedItem) => void;
  selectedId: string | null;
  selectedKeyboardActive?: boolean;
  todoStateOverrides?: Record<string, SidebarTodoStateOverride | undefined>;
  onCreateFile: (location: LibraryCreateLocation, fileName: string) => boolean | void | Promise<boolean | void>;
  onCreateDefaultFile?: (location: LibraryCreateLocation) => boolean | void | Promise<boolean | void>;
  onCreateDir: (location: LibraryCreateLocation) => boolean | void | Promise<boolean | void>;
  flatItemsRef?: MutableRefObject<UnifiedItem[]>;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  searchInputRef?: MutableRefObject<HTMLInputElement | null>;
  creationControllerRef?: MutableRefObject<WikiCreationController | null>;
  onDeletedItem?: (item: UnifiedItem) => void;
  onKeyboardScopeActive?: () => void;
}

export type { UnifiedItem, UnifiedFolder, SortMode };

export function applyTodoStateOverrideToItem(
  item: UnifiedItem,
  todoStateOverrides: Record<string, SidebarTodoStateOverride | undefined>,
): UnifiedItem {
  if (!Object.prototype.hasOwnProperty.call(todoStateOverrides, item.id)) return item;
  const override = todoStateOverrides[item.id];
  if (override) return { ...item, todoState: override };

  const { todoState: _todoState, ...rest } = item;
  return rest;
}

function applyTodoStateOverridesToNodes(
  nodes: SidebarNode[],
  todoStateOverrides: Record<string, SidebarTodoStateOverride | undefined>,
): SidebarNode[] {
  if (Object.keys(todoStateOverrides).length === 0) return nodes;
  return nodes.map((node) => {
    if (node.kind === 'file') {
      return { ...node, item: applyTodoStateOverrideToItem(node.item, todoStateOverrides) };
    }
    return { ...node, children: applyTodoStateOverridesToNodes(node.children, todoStateOverrides) };
  });
}

export type { SidebarNode as LibrarySidebarNode };

function matchesLibrarySearch(item: UnifiedItem, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;

  return [
    item.title,
    item.relPath,
    item.absPath,
    item.todoState,
    item.todoState ? 'todo task' : undefined,
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

/** Clip the recent list for the sidebar. Expanded means all remaining recent
 *  items are visible in one click. */
export function splitRecent(
  entries: RecentEntry[],
  expanded: boolean,
  collapsed: number = 6,
): {
  entries: RecentEntry[];
  total: number;
} {
  return {
    entries: expanded ? entries : entries.slice(0, collapsed),
    total: entries.length,
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

export function orderTopLevelSidebarNodes(nodes: SidebarNode[], _sortMode: SortMode = 'alpha'): SidebarNode[] {
  return sortSidebarNodes(nodes, 'alpha');
}

function getLibraryFolderVisibilityId(node: SidebarNode): string | null {
  if (node.kind !== 'dir') return null;
  if (node.id === 'artifacts') return 'artifacts';
  if (!node.builtin || !node.relPath || node.relPath.includes('/')) return null;
  return node.relPath;
}

function getDefaultFolderId(node: SidebarNode): LibraryDefaultFolderId | null {
  const folderId = getLibraryFolderVisibilityId(node);
  return folderId && LIBRARY_DEFAULT_FOLDER_ID_SET.has(folderId) ? (folderId as LibraryDefaultFolderId) : null;
}

function getUserFolderVisibilityId(node: SidebarNode): string | null {
  const folderId = getLibraryFolderVisibilityId(node);
  if (!folderId || LIBRARY_DEFAULT_FOLDER_ID_SET.has(folderId)) return null;
  return folderId;
}

export function filterHiddenDefaultSidebarNodes(nodes: SidebarNode[], hiddenFolderIds: string[]): SidebarNode[] {
  const hidden = new Set([...LEGACY_HIDDEN_DEFAULT_FOLDER_IDS, ...hiddenFolderIds]);
  const filterNodes = (items: SidebarNode[]): { nodes: SidebarNode[]; changed: boolean } => {
    let changed = false;
    const filtered: SidebarNode[] = [];

    for (const node of items) {
      const folderId = getLibraryFolderVisibilityId(node);
      if (folderId && hidden.has(folderId)) {
        changed = true;
        continue;
      }
      if (node.kind === 'file' || node.children.length === 0) {
        filtered.push(node);
        continue;
      }

      const children = filterNodes(node.children);
      if (children.changed) {
        changed = true;
        filtered.push({
          ...node,
          hasUnread: children.nodes.some(sidebarNodeHasUnread),
          children: children.nodes,
        });
      } else {
        filtered.push(node);
      }
    }

    return { nodes: changed ? filtered : items, changed };
  };
  return filterNodes(nodes).nodes;
}

export function flattenBuiltinSidebarRoots(nodes: SidebarNode[]): SidebarNode[] {
  return nodes.flatMap((node) => {
    if (node.kind === 'dir' && node.children.some((child) => child.id === BOOKMARKS_ITEM_ID)) {
      return node.children;
    }
    if (node.kind === 'dir' && node.builtin && node.relPath === '' && node.id.startsWith('root:')) {
      return node.children;
    }
    return [node];
  });
}

export function getSidebarFolderFinderPath(node: SidebarNode | null): string | null {
  if (!node || node.kind !== 'dir') return null;
  if (node.id === 'artifacts') return null;
  if (!node.rootPath || node.rootPath === 'artifacts') return null;
  if (node.builtin && node.name === 'bookmarks-from-x') return node.rootPath;
  if (!node.relPath) return node.rootPath;
  return `${node.rootPath.replace(/\/+$/, '')}/${node.relPath}`;
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

function sidebarNodeContainsSelectedId(node: SidebarNode, selectedId: string | null): boolean {
  if (!selectedId) return false;
  if (node.kind === 'file') return node.item.id === selectedId;
  return node.children.some((child) => sidebarNodeContainsSelectedId(child, selectedId));
}

export function collectSidebarSiblingItems(nodes: SidebarNode[], selectedId: string | null): UnifiedItem[] {
  if (!selectedId) return [];

  const directItems = nodes.flatMap((node) => node.kind === 'file' ? [node.item] : []);
  if (directItems.some((item) => item.id === selectedId)) return directItems;

  for (const node of nodes) {
    if (node.kind === 'dir') {
      const match = collectSidebarSiblingItems(node.children, selectedId);
      if (match.length > 0) return match;
    }
  }

  return [];
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

function libraryRootCanCreateFiles(root: LibraryRoot): boolean {
  return root.writable !== false;
}

function normalizeTaggedPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function sidebarNodeHasUnread(node: SidebarNode): boolean {
  return node.kind === 'file' ? node.item.hasUnread === true : node.hasUnread === true;
}

function getLibraryCreateLocationKey(location: LibraryCreateLocation): string {
  return `${location.rootPath}::${location.relPath}`;
}

function getSidebarNodeCreateLocation(node: Extract<SidebarNode, { kind: 'dir' }>): LibraryCreateLocation {
  return {
    rootPath: node.rootPath,
    relPath: node.relPath,
    builtin: node.builtin,
  };
}

function createLocationMatches(left: LibraryCreateLocation, right: LibraryCreateLocation): boolean {
  return getLibraryCreateLocationKey(left) === getLibraryCreateLocationKey(right);
}

function joinLibraryRelPath(parent: string, name: string): string {
  const trimmedName = name.trim();
  return parent ? `${parent}/${trimmedName}` : trimmedName;
}

function wikiNodeToSidebarNode(
  node: WikiNode,
  root: LibraryRoot,
  sortMode: SortMode,
  taggedDocByPath: Map<string, TaggedDocListItem>
): SidebarNode {
  if (node.kind === 'file') {
    const type = root.builtin ? 'wiki' : 'external';
    const id = root.builtin ? `wiki:${node.relPath}` : `external:${node.absPath}`;
    const taggedDoc = taggedDocByPath.get(normalizeTaggedPath(node.absPath));
    return {
      kind: 'file',
      id,
      item: {
        id,
        title: node.title,
        type,
        absPath: node.absPath,
        relPath: node.relPath,
        rootPath: root.path,
        timestamp: node.lastUpdated,
        todoState: node.todoState,
        taggedDocId: taggedDoc?.ulid,
        hasUnread: taggedDoc?.unread ?? false,
      },
    };
  }

  const children = sortSidebarNodes(
    node.children.map((child) => wikiNodeToSidebarNode(child, root, sortMode, taggedDocByPath)),
    sortMode
  );
  return {
    kind: 'dir',
    id: `${root.path}::${node.relPath}`,
    name: node.name,
    label: node.name.charAt(0).toUpperCase() + node.name.slice(1),
    relPath: node.relPath,
    rootPath: root.path,
    builtin: root.builtin,
    canCreateFile: libraryRootCanCreateFiles(root),
    canDeleteDir: true,
    hasUnread: children.some(sidebarNodeHasUnread),
    children,
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

export function getWikiSidebarExpansionIds(rootPath: string, relPath: string): string[] {
  const parts = relPath.split('/').filter(Boolean);
  const ids = [`root:${rootPath}`];
  for (let index = 1; index < parts.length; index += 1) {
    ids.push(`${rootPath}::${parts.slice(0, index).join('/')}`);
  }
  return ids;
}

export function getSelectedWikiAutoExpandKey(
  selectedId: string | null | undefined,
  rootPath: string | null | undefined
): string | null {
  if (!selectedId?.startsWith('wiki:') || !rootPath) return null;
  return `${rootPath}::${selectedId}`;
}

export function virtualizeBookmarksGroup(nodes: SidebarNode[], root: LibraryRoot, sortMode: SortMode = 'alpha'): SidebarNode[] {
  if (!root.builtin) return nodes;

  const bookmarkFolderNames = new Set(['categories', 'domains', 'entities']);
  const isBookmarkSourceNode = (node: SidebarNode): boolean => {
    if (node.kind === 'file') return node.id === BOOKMARKS_ITEM_ID;
    // These directories remain on disk; the sidebar renders them through the
    // dedicated bookmarks canvas/list entry instead of as ordinary folders.
    if (bookmarkFolderNames.has(node.name) || node.name === 'bookmarks-from-x' || node.name.toLowerCase() === 'bookmarks') return true;
    return node.children.some(isBookmarkSourceNode);
  };
  const remainingNodes: SidebarNode[] = [];
  let foundBookmarkSourceNode = false;

  for (const node of nodes) {
    if (node.kind !== 'dir') {
      remainingNodes.push(node);
      continue;
    }
    if (isBookmarkSourceNode(node)) {
      foundBookmarkSourceNode = true;
      continue;
    }
    remainingNodes.push(node);
  }

  if (!foundBookmarkSourceNode) return nodes;

  return sortSidebarNodes([
    ...remainingNodes,
    { kind: 'file', id: BOOKMARKS_ITEM_ID, item: makeBookmarksItem() },
  ], sortMode);
}

function rootToSidebarNode(
  root: LibraryRoot,
  sortMode: SortMode,
  taggedDocByPath: Map<string, TaggedDocListItem>
): SidebarNode {
  let children = sortSidebarNodes(
    root.tree.map((node) => wikiNodeToSidebarNode(node, root, sortMode, taggedDocByPath)),
    sortMode
  );
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
    canCreateFile: libraryRootCanCreateFiles(root),
    canRemoveRoot: !root.builtin,
    hasUnread: children.some(sidebarNodeHasUnread),
    children,
  };
}

function WikiSidebar({
  active = true,
  onSelectItem,
  selectedId,
  selectedKeyboardActive = false,
  todoStateOverrides = EMPTY_TODO_STATE_OVERRIDES,
  onCreateFile,
  onCreateDefaultFile,
  onCreateDir,
  flatItemsRef,
  searchQuery,
  onSearchQueryChange,
  searchInputRef,
  creationControllerRef,
  onDeletedItem,
  onKeyboardScopeActive,
}: WikiSidebarProps) {
  const { theme } = useTheme();
  const { confirmDelete, deleteConfirmationDialog } = useDeleteConfirmation();
  const [wikiTree, setWikiTree] = useState<WikiFolder[]>([]);
  const [libraryRoots, setLibraryRoots] = useState<LibraryRoot[]>([]);
  const [hiddenDefaultFolders, setHiddenDefaultFolders] = useState<string[]>([]);
  const [artifacts, setArtifacts] = useState<ReadingMeta[]>([]);
  const [taggedDocs, setTaggedDocs] = useState<TaggedDocListItem[]>([]);
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
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [creating, setCreating] = useState<CreatingState>(null);
  const [newName, setNewName] = useState('');
  const createInputRef = useRef<HTMLInputElement | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [recentExpanded, setRecentExpanded] = useState(false);
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
  const [renameRequestId, setRenameRequestId] = useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(() => new Set());
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const autoExpandedSelectedWikiKeyRef = useRef<string | null>(null);

  // Auto-expand the parent folder of the selected wiki item so programmatic
  // opens (open-file, wiki:// links, Recent clicks) reveal the entry instead
  // of leaving it hidden under a collapsed folder. Track the selection so
  // focus-triggered tree reloads do not reopen a folder the user collapsed.
  useEffect(() => {
    if (!selectedId?.startsWith('wiki:')) {
      autoExpandedSelectedWikiKeyRef.current = null;
      return;
    }
    const relPath = selectedId.slice('wiki:'.length);
    const builtinRoot = libraryRoots.find((root) => root.builtin);
    if (!builtinRoot) return;
    const autoExpandKey = getSelectedWikiAutoExpandKey(selectedId, builtinRoot.path);
    if (!autoExpandKey || autoExpandedSelectedWikiKeyRef.current === autoExpandKey) return;
    autoExpandedSelectedWikiKeyRef.current = autoExpandKey;
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of getWikiSidebarExpansionIds(builtinRoot.path, relPath)) {
        if (next.has(id)) continue;
        next.add(id);
        changed = true;
      }
      return changed ? next : prev;
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
  }, [selectedId, expandedFolders, wikiTree, libraryRoots, artifacts, searchQuery]);

  const loadTree = useCallback(async () => {
    const [treeResult, rootsResult, hiddenFoldersResult] = await Promise.all([
      window.wikiAPI?.getTree(),
      window.libraryAPI?.getRoots(),
      window.libraryAPI?.getHiddenFolders(),
    ]);
    if (treeResult) setWikiTree(treeResult);
    if (hiddenFoldersResult) setHiddenDefaultFolders(hiddenFoldersResult);
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
    return rootsResult;
  }, []);

  const loadArtifacts = useCallback(async () => {
    const result = await window.librarianAPI?.getReadings();
    if (result) setArtifacts(result);
  }, []);

  const loadRecent = useCallback(async () => {
    const result = await window.recentAPI?.list();
    if (result) setRecent(result);
  }, []);

  const loadTaggedDocs = useCallback(async () => {
    const result = await window.taggedDocsAPI?.list();
    if (result) setTaggedDocs(result);
  }, []);

  useEffect(() => {
    if (!active) return;
    loadTree();
    loadArtifacts();
    loadRecent();
    loadTaggedDocs();
    const unsubWiki = window.wikiAPI?.onPageChanged(() => loadTree());
    const unsubLibrary = window.libraryAPI?.onRootsChanged(() => loadTree());
    const unsubAdded = window.librarianAPI?.onReadingAdded(() => loadArtifacts());
    const unsubRemoved = window.librarianAPI?.onReadingRemoved(() => loadArtifacts());
    const unsubUpdated = window.librarianAPI?.onReadingUpdated(() => loadArtifacts());
    const unsubRecent = window.recentAPI?.onChanged(() => loadRecent());
    const unsubTaggedDocs = window.taggedDocsAPI?.onUpdated(() => loadTaggedDocs());
    // Backstop for missed FSEvents (sleep/wake, bg writes): reload on focus.
    const onFocus = () => {
      loadTree();
      loadArtifacts();
      loadRecent();
      loadTaggedDocs();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      unsubWiki?.();
      unsubLibrary?.();
      unsubAdded?.();
      unsubRemoved?.();
      unsubUpdated?.();
      unsubRecent?.();
      unsubTaggedDocs?.();
      window.removeEventListener('focus', onFocus);
    };
  }, [active, loadTree, loadArtifacts, loadRecent, loadTaggedDocs]);

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

  const getBuiltinCreateLocation = useCallback((relPath: string): LibraryCreateLocation | null => {
    const builtinRoot = libraryRoots.find((root) => root.builtin);
    if (!builtinRoot) return null;
    return {
      rootPath: builtinRoot.path,
      relPath,
      builtin: true,
    };
  }, [libraryRoots]);

  const resolveCreateTarget = useCallback((target: LibraryCreateTarget | undefined, fallbackRelPath: string): LibraryCreateLocation | null => {
    if (typeof target === 'object') return target;
    return getBuiltinCreateLocation(target ?? fallbackRelPath);
  }, [getBuiltinCreateLocation]);

  const expandCreateLocation = useCallback((location: LibraryCreateLocation, relPath = location.relPath) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      for (const id of getWikiSidebarExpansionIds(location.rootPath, relPath)) {
        next.add(id);
      }
      if (relPath) next.add(`${location.rootPath}::${relPath}`);
      return next;
    });
  }, []);

  const reloadTreeAndExpandLocation = useCallback(async (location: LibraryCreateLocation, relPath = location.relPath) => {
    const rootsResult = await loadTree();
    const root = (rootsResult ?? libraryRoots).find((candidate) => candidate.path === location.rootPath)
      ?? (location.builtin ? (rootsResult ?? libraryRoots).find((candidate) => candidate.builtin) : undefined);
    const rootPath = root?.path ?? location.rootPath;
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      for (const id of getWikiSidebarExpansionIds(rootPath, relPath)) {
        next.add(id);
      }
      if (relPath) next.add(`${rootPath}::${relPath}`);
      return next;
    });
  }, [libraryRoots, loadTree]);

  const moveLibraryItem = useCallback(async (item: LibraryDragItem, target: LibraryCreateLocation) => {
    if (!canDropLibraryItem(item, target)) return;
    const newRelPath = await window.libraryAPI?.moveItem(target.rootPath, item.kind, item.relPath, target.relPath);
    if (!newRelPath) {
      setMoveError('Could not move item. A file or folder with that name may already exist.');
      return;
    }
    setMoveError(null);
    await reloadTreeAndExpandLocation(target, newRelPath);
    if (item.kind === 'file') {
      const root = libraryRoots.find((entry) => entry.path === target.rootPath);
      setTimeout(() => {
        const type = root?.builtin ? 'wiki' : 'external';
        const absPath = type === 'wiki' ? '' : `${target.rootPath}/${newRelPath}.md`;
        const id = type === 'wiki' ? `wiki:${newRelPath}` : `external:${absPath}`;
        setHoveredId(null);
        const fileName = newRelPath.split('/').pop() ?? newRelPath;
        onSelectItem({
          id,
          title: fileName,
          type,
          absPath,
          relPath: newRelPath,
          rootPath: target.rootPath,
          timestamp: Date.now(),
        });
      }, 0);
    }
  }, [libraryRoots, onSelectItem, reloadTreeAndExpandLocation]);

  const beginCreateFile = useCallback((target?: LibraryCreateTarget) => {
    const location = resolveCreateTarget(target, SCRATCHPAD_FOLDER_NAME);
    if (!location) return;
    // Built-in markdown pages have an editor-side title suggestion, so skip
    // the sidebar naming input and let the H1 become the live title.
    if (location.builtin && onCreateDefaultFile) {
      void (async () => {
        const created = await onCreateDefaultFile(location);
        if (created !== false) await reloadTreeAndExpandLocation(location);
      })();
      return;
    }
    expandCreateLocation(location);
    setCreating({ kind: 'file', location });
    setNewName('');
  }, [expandCreateLocation, onCreateDefaultFile, reloadTreeAndExpandLocation, resolveCreateTarget]);

  const beginCreateDir = useCallback((target?: LibraryCreateTarget) => {
    const location = resolveCreateTarget(target, '');
    if (!location) return;
    expandCreateLocation(location);
    setCreating({ kind: 'dir', location });
    setNewName('');
  }, [expandCreateLocation, resolveCreateTarget]);

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
    if (creating.kind === 'file') {
      const created = await onCreateFile(creating.location, name);
      if (created !== false) await reloadTreeAndExpandLocation(creating.location);
    } else {
      const dirRelPath = joinLibraryRelPath(creating.location.relPath, name);
      const nextLocation = { ...creating.location, relPath: dirRelPath };
      const created = await onCreateDir(nextLocation);
      if (created !== false) await reloadTreeAndExpandLocation(nextLocation);
    }
    setCreating(null);
    setNewName('');
  }, [newName, creating, onCreateFile, onCreateDir, reloadTreeAndExpandLocation, cancelCreate]);

  const sidebarRoots = useMemo(() => {
    const roots: SidebarNode[] = [];
    const taggedDocByPath = new Map(
      taggedDocs.map((doc) => [normalizeTaggedPath(doc.path), doc])
    );

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

    const libraryRootNodes = libraryRoots.map((root) => rootToSidebarNode(root, sortMode, taggedDocByPath));
    roots.push(...flattenBuiltinSidebarRoots(libraryRootNodes));
    return orderTopLevelSidebarNodes(filterHiddenDefaultSidebarNodes(roots, hiddenDefaultFolders), sortMode);
  }, [artifacts, hiddenDefaultFolders, libraryRoots, sortMode, taggedDocs]);

  const sidebarRootsWithTodoOverrides = useMemo(
    () => applyTodoStateOverridesToNodes(sidebarRoots, todoStateOverrides),
    [sidebarRoots, todoStateOverrides],
  );

  const filteredSidebarRoots = useMemo(
    () => filterSidebarNodes(sidebarRootsWithTodoOverrides, searchQuery),
    [sidebarRootsWithTodoOverrides, searchQuery]
  );
  const bookmarksActionItem = useMemo(() => {
    const node = sidebarRootsWithTodoOverrides.find((item) => item.id === BOOKMARKS_ITEM_ID);
    return node?.kind === 'file' ? node.item : null;
  }, [sidebarRootsWithTodoOverrides]);
  const visibleSidebarRoots = useMemo(
    () => filteredSidebarRoots.filter((node) => node.id !== BOOKMARKS_ITEM_ID),
    [filteredSidebarRoots]
  );

  const flatItems = useMemo(() => collectSidebarItems(filteredSidebarRoots), [filteredSidebarRoots]);
  const navigationItems = useMemo(() => {
    const siblingItems = collectSidebarSiblingItems(filteredSidebarRoots, selectedId);
    return siblingItems.length > 0 ? siblingItems : flatItems;
  }, [filteredSidebarRoots, flatItems, selectedId]);
  if (flatItemsRef) flatItemsRef.current = navigationItems;

  const selectSidebarFileItem = useCallback((item: UnifiedItem, event: React.MouseEvent) => {
    onKeyboardScopeActive?.();
    const toggleSelection = event.metaKey || event.ctrlKey;
    if (event.shiftKey && selectionAnchorId) {
      const anchorIndex = flatItems.findIndex((entry) => entry.id === selectionAnchorId);
      const itemIndex = flatItems.findIndex((entry) => entry.id === item.id);
      if (anchorIndex >= 0 && itemIndex >= 0) {
        const [start, end] = anchorIndex < itemIndex ? [anchorIndex, itemIndex] : [itemIndex, anchorIndex];
        setSelectedFileIds(new Set(flatItems.slice(start, end + 1).map((entry) => entry.id)));
        onSelectItem(item);
        return;
      }
    }

    if (toggleSelection) {
      setSelectedFileIds((prev) => {
        const next = new Set(prev);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
      setSelectionAnchorId(item.id);
      if (!selectedFileIds.has(item.id)) onSelectItem(item);
      return;
    }

    setSelectedFileIds(new Set());
    setSelectionAnchorId(item.id);
    onSelectItem(item);
  }, [flatItems, onKeyboardScopeActive, onSelectItem, selectedFileIds, selectionAnchorId]);

  const totalPages = countSidebarItems(sidebarRootsWithTodoOverrides);
  const visiblePages = flatItems.length;
  const isSearching = searchQuery.trim().length > 0;

  const emptyWiki = visibleSidebarRoots.length === 0 && !bookmarksActionItem;

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
  const contextCreateTarget = contextDir?.canCreateFile ? getSidebarNodeCreateLocation(contextDir) : undefined;
  const canCreateInContext = !contextDir || contextDir.canCreateFile;
  const contextDefaultFolderId = contextDir ? getDefaultFolderId(contextDir) : null;
  const contextUserFolderId = contextDir ? getUserFolderVisibilityId(contextDir) : null;
  const contextHideFolderId = contextDefaultFolderId ?? contextUserFolderId;
  const contextHideDirLabel = contextDefaultFolderId ? 'Hide folder' : contextUserFolderId ? 'Remove from FT' : null;
  const canDeleteContextDir = !!contextDir?.canDeleteDir && !contextDefaultFolderId;
  const canDeleteContextFile = contextFile?.type === 'wiki' || contextFile?.type === 'artifact';
  const contextFolderFinderPath = getSidebarFolderFinderPath(contextDir);
  const canRenameContextFile = contextFile?.type === 'wiki' && !!contextFile.relPath;
  const contextFileFinderPath = contextFile?.type !== 'bookmarks' ? contextFile?.absPath : undefined;
  const rootCreateLocation = getBuiltinCreateLocation('');

  const addFolderFromPath = useCallback(async () => {
    closeContextMenu();
    const picked = await window.libraryAPI?.pickFolder();
    if (!picked) return;
    let root: LibraryRoot | null | undefined;
    try {
      root = await window.libraryAPI?.addRoot(picked);
    } catch (error) {
      setMoveError(error instanceof Error ? error.message : 'Could not add folder.');
      return;
    }
    if (!root) {
      setMoveError('Could not add folder. Choose an existing folder that is not already in Library.');
      return;
    }
    setMoveError(null);
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

  const hideContextDir = useCallback(async () => {
    const folderId = contextHideFolderId;
    const previous = hiddenDefaultFolders;
    closeContextMenu();
    if (!folderId) return;

    const optimistic = [...new Set([...previous, folderId])];
    setHiddenDefaultFolders(optimistic);

    try {
      const result = await window.libraryAPI?.setFolderHidden(folderId, true);
      setHiddenDefaultFolders(result ?? optimistic);
      await loadTree();
    } catch {
      setHiddenDefaultFolders(previous);
    }
  }, [closeContextMenu, contextHideFolderId, hiddenDefaultFolders, loadTree]);

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
          const success = await window.wikiAPI?.deletePage(target.relPath!);
          if (success) {
            onDeletedItem?.(target);
            await loadTree();
          }
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
        const success = await window.librarianAPI?.deleteReading(target.absPath);
        if (success) {
          onDeletedItem?.(target);
          await loadArtifacts();
        }
      },
    });
  }, [closeContextMenu, confirmDelete, contextFile, loadArtifacts, loadTree, onDeletedItem]);

  const deleteContextDir = useCallback(() => {
    const target = contextDir;
    closeContextMenu();
    if (!target?.canDeleteDir) return;
    const deletedItems = collectSidebarItems(target.children).filter((item) => item.type !== 'bookmarks');
    confirmDelete({
      title: 'Delete folder?',
      message: `Move "${target.label}"${deletedItems.length > 0 ? ` and ${deletedItems.length} file${deletedItems.length === 1 ? '' : 's'}` : ''} to Trash?`,
      confirmLabel: 'Move to Trash',
      onConfirm: async () => {
        const success = await window.libraryAPI?.deleteDir(target.rootPath, target.relPath);
        if (!success) return;
        setExpandedFolders((prev) => {
          const next = new Set(prev);
          const prefix = `${target.rootPath}::${target.relPath}`;
          for (const id of prev) {
            if (id === prefix || id.startsWith(`${prefix}/`)) next.delete(id);
          }
          return next;
        });
        for (const item of deletedItems) {
          onDeletedItem?.(item);
        }
        await loadTree();
      },
    });
  }, [closeContextMenu, confirmDelete, contextDir, loadTree, onDeletedItem]);

  const showContextFolderInFinder = useCallback(() => {
    const finderPath = contextFolderFinderPath;
    closeContextMenu();
    if (!finderPath) return;
    window.shellAPI?.showItemInFolder(finderPath);
  }, [closeContextMenu, contextFolderFinderPath]);

  const renameContextFile = useCallback(() => {
    const target = contextFile;
    closeContextMenu();
    if (target?.type !== 'wiki' || !target.relPath) return;
    setRenameRequestId(target.id);
  }, [closeContextMenu, contextFile]);

  const copyContextFilePath = useCallback(() => {
    const target = contextFile;
    closeContextMenu();
    const filePath = target?.absPath || target?.relPath;
    if (!filePath) return;
    void navigator.clipboard?.writeText(filePath);
  }, [closeContextMenu, contextFile]);

  const showContextFileInFinder = useCallback(() => {
    const finderPath = contextFileFinderPath;
    closeContextMenu();
    if (!finderPath) return;
    window.shellAPI?.showItemInFolder(finderPath);
  }, [closeContextMenu, contextFileFinderPath]);

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
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            onSearchQueryChange('');
            e.currentTarget.blur();
          }}
          onBlur={(e) => {
            if (!e.currentTarget.value.trim()) onSearchQueryChange('');
          }}
          placeholder="Search library (/)"
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

      {rootCreateLocation && creating?.kind === 'file' && createLocationMatches(creating.location, rootCreateLocation) && (
        <CreateInput
          inputRef={createInputRef}
          value={newName}
          onChange={setNewName}
          onSubmit={submitCreate}
          onCancel={cancelCreate}
          theme={theme}
          depth={0}
          placeholder="Untitled"
        />
      )}

      {rootCreateLocation && creating?.kind === 'dir' && createLocationMatches(creating.location, rootCreateLocation) && (
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

      {emptyWiki ? (
        <div style={{ padding: '8px 12px', fontSize: '11px', color: theme.textSecondary }}>
          No pages yet. Run <code style={{ fontSize: '10px', background: theme.hoverBg, padding: '1px 4px', borderRadius: '3px' }}>ft sync && ft wiki</code> to generate.
        </div>
      ) : visibleSidebarRoots.length === 0 ? (
        <div style={{ padding: '8px 12px', fontSize: '11px', color: theme.textSecondary }}>
          No pages match that search.
        </div>
      ) : visibleSidebarRoots.map((node) => (
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
          selectedKeyboardActive={selectedKeyboardActive}
          selectedItemRef={selectedItemRef}
          hoveredId={hoveredId}
          setHoveredId={setHoveredId}
          dropTargetId={dropTargetId}
          setDropTargetId={setDropTargetId}
          onMoveLibraryItem={moveLibraryItem}
          theme={theme}
          onSelectItem={selectSidebarFileItem}
          selectedFileIds={selectedFileIds}
          renameRequestId={renameRequestId}
          onRenameRequestConsumed={() => setRenameRequestId(null)}
          onContextMenu={openContextMenu}
          onKeyboardScopeActive={onKeyboardScopeActive}
        />
      ))}

      {contextMenu && (
        <LibraryContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          theme={theme}
          canCreate={canCreateInContext}
          canRemoveRoot={!!contextDir?.canRemoveRoot}
          canShowFolderInFinder={!!contextFolderFinderPath}
          canRenameFile={canRenameContextFile}
          canCopyFilePath={!!contextFile}
          canShowFileInFinder={!!contextFileFinderPath}
          canDeleteFile={canDeleteContextFile}
          hideDirLabel={contextHideDirLabel}
          canDeleteDir={canDeleteContextDir}
          onNewFile={() => {
            closeContextMenu();
            if (!canCreateInContext) return;
            beginCreateFile(contextCreateTarget);
          }}
          onNewFolder={() => {
            closeContextMenu();
            if (!canCreateInContext) return;
            beginCreateDir(contextCreateTarget);
          }}
          onAddFolder={addFolderFromPath}
          onShowFolderInFinder={showContextFolderInFinder}
          onRenameFile={renameContextFile}
          onCopyFilePath={copyContextFilePath}
          onShowFileInFinder={showContextFileInFinder}
          onRemoveRoot={removeContextRoot}
          onHideDir={hideContextDir}
          onDeleteFile={deleteContextFile}
          onDeleteDir={deleteContextDir}
        />
      )}
      {deleteConfirmationDialog}
      {moveError && (
        <div
          role="status"
          style={{
            margin: '0 8px 8px',
            padding: '6px 8px',
            fontSize: '11px',
            color: theme.textSecondary,
            backgroundColor: theme.isDark ? 'rgba(245,158,11,0.12)' : 'rgba(245,158,11,0.14)',
            border: `1px solid ${theme.isDark ? 'rgba(245,158,11,0.24)' : 'rgba(245,158,11,0.28)'}`,
            borderRadius: '5px',
          }}
          onClick={() => setMoveError(null)}
        >
          {moveError}
        </div>
      )}

      {!isSearching && bookmarksActionItem && (
        <BookmarksShortcutBlock
          item={bookmarksActionItem}
          isSelected={selectedId === bookmarksActionItem.id}
          theme={theme}
          onOpen={() => onSelectItem(bookmarksActionItem)}
        />
      )}

      {!isSearching && recent.length > 0 && (
        <RecentBlock
          recent={filterStaleRecent(recent, wikiTree)}
          expanded={recentExpanded}
          onExpand={setRecentExpanded}
          collapsed={recentCollapsed}
          onToggleCollapsed={() => setRecentCollapsed((v) => !v)}
          showDivider={!bookmarksActionItem}
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
  selectedKeyboardActive,
  selectedItemRef,
  hoveredId,
  setHoveredId,
  dropTargetId,
  setDropTargetId,
  onMoveLibraryItem,
  theme,
  onSelectItem,
  selectedFileIds,
  renameRequestId,
  onRenameRequestConsumed,
  onContextMenu,
  onKeyboardScopeActive,
}: {
  node: SidebarNode;
  depth: number;
  isSearching: boolean;
  expandedFolders: Set<string>;
  toggleFolder: (id: string) => void;
  creating: CreatingState;
  newName: string;
  setNewName: (value: string) => void;
  createInputRef: MutableRefObject<HTMLInputElement | null>;
  submitCreate: () => void | Promise<void>;
  cancelCreate: () => void;
  beginCreateFile: (target?: LibraryCreateTarget) => void;
  selectedId: string | null;
  selectedKeyboardActive: boolean;
  selectedItemRef: MutableRefObject<HTMLDivElement | null>;
  hoveredId: string | null;
  setHoveredId: (id: string | null) => void;
  dropTargetId: string | null;
  setDropTargetId: (id: string | null) => void;
  onMoveLibraryItem: (item: LibraryDragItem, target: LibraryCreateLocation) => void | Promise<void>;
  theme: ReturnType<typeof useTheme>['theme'];
  onSelectItem: (item: UnifiedItem, event: React.MouseEvent) => void;
  selectedFileIds: Set<string>;
  renameRequestId: string | null;
  onRenameRequestConsumed: () => void;
  onContextMenu: (event: React.MouseEvent, node: SidebarNode | null) => void;
  onKeyboardScopeActive?: () => void;
}) {
  const [scratchpadExpanded, setScratchpadExpanded] = useState(false);

  if (node.kind === 'file') {
    const isSel = node.item.id === selectedId;
    return (
      <FileItem
        item={node.item}
        depth={depth}
        isSelected={isSel || selectedFileIds.has(node.item.id)}
        selectedKeyboardActive={selectedKeyboardActive}
        isHovered={node.item.id === hoveredId}
        theme={theme}
        onSelect={(event) => onSelectItem(node.item, event)}
        onHover={setHoveredId}
        onContextMenu={(event) => onContextMenu(event, node)}
        onKeyboardScopeActive={onKeyboardScopeActive}
        requestRename={renameRequestId === node.item.id}
        onRenameRequestConsumed={onRenameRequestConsumed}
        draggable={!!node.item.rootPath && (node.item.type === 'wiki' || node.item.type === 'external')}
        refProp={isSel ? selectedItemRef : undefined}
      />
    );
  }

  const isExpanded = isSearching || expandedFolders.has(node.id);
  const itemCount = countSidebarItems(node.children);
  const nodeCreateLocation = getSidebarNodeCreateLocation(node);
  const canDragDir = node.canDeleteDir && !(node.builtin && LIBRARY_DEFAULT_FOLDER_ID_SET.has(node.relPath));
  const isDropTarget = dropTargetId === node.id;
  const shouldCapScratchpad = node.name === SCRATCHPAD_FOLDER_NAME
    && !isSearching
    && !scratchpadExpanded
    && !node.children.some((child) => sidebarNodeContainsSelectedId(child, selectedId))
    && node.children.length > SCRATCHPAD_COLLAPSED_ITEM_LIMIT;
  const visibleChildren = shouldCapScratchpad ? node.children.slice(0, SCRATCHPAD_COLLAPSED_ITEM_LIMIT) : node.children;
  const hiddenScratchpadCount = node.children.length - visibleChildren.length;
  const dropBg = theme.isDark ? 'rgba(59,130,246,0.18)' : 'rgba(59,130,246,0.12)';
  const sidebarIconColor = theme.isDark ? SIDEBAR_DARK_ICON_COLOR : SIDEBAR_LIGHT_ICON_COLOR;
  const sidebarTextColor = theme.isDark ? SIDEBAR_DARK_TEXT_COLOR : SIDEBAR_LIGHT_TEXT_COLOR;
  const getDroppableDragItem = (dataTransfer: DataTransfer): LibraryDragItem | null => {
    const item = getLibraryDragData(dataTransfer);
    return canDropLibraryItem(item, nodeCreateLocation) ? item : null;
  };

  return (
    <div>
      <div
        className="bm-folder-header"
        draggable={canDragDir}
        onDragStart={(event) => {
          if (!canDragDir) {
            event.preventDefault();
            return;
          }
          const item: LibraryDragItem = {
            rootPath: node.rootPath,
            kind: 'dir',
            relPath: node.relPath,
          };
          setLibraryDragData(event.dataTransfer, item);
        }}
        onDragEnd={clearLibraryDragData}
        onDragEnter={(event) => {
          if (!node.canCreateFile) return;
          if (!hasLibraryDragData(event.dataTransfer)) return;
          if (!getDroppableDragItem(event.dataTransfer)) return;
          event.preventDefault();
          setDropTargetId(node.id);
        }}
        onDragOver={(event) => {
          if (!node.canCreateFile) return;
          if (!hasLibraryDragData(event.dataTransfer)) return;
          if (!getDroppableDragItem(event.dataTransfer)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          setDropTargetId(node.id);
        }}
        onDragLeave={() => {
          if (dropTargetId === node.id) setDropTargetId(null);
        }}
        onDrop={(event) => {
          if (!node.canCreateFile) return;
          event.preventDefault();
          setDropTargetId(null);
          const item = getDroppableDragItem(event.dataTransfer);
          clearLibraryDragData();
          if (!item) return;
          void onMoveLibraryItem(item, nodeCreateLocation);
        }}
        onClick={() => toggleFolder(node.id)}
        onContextMenu={(event) => onContextMenu(event, node)}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isDropTarget ? dropBg : theme.hoverBg)}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = isDropTarget ? dropBg : 'transparent')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: SIDEBAR_ICON_TEXT_GAP,
          padding: `${LIBRARY_SIDEBAR_ROW_PADDING_Y} 12px ${LIBRARY_SIDEBAR_ROW_PADDING_Y} ${12 + depth * 12}px`,
          cursor: 'pointer',
          fontSize: '12px',
          fontWeight: 400,
          lineHeight: LIBRARY_SIDEBAR_ROW_LINE_HEIGHT,
          color: sidebarTextColor,
          userSelect: 'none',
          backgroundColor: isDropTarget ? dropBg : 'transparent',
        }}
      >
        <SidebarFolderIcon color={sidebarIconColor} />
        <span style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>{node.label}</span>
        <span style={{
          minWidth: '14px',
          height: '14px',
          padding: '0 4px',
          borderRadius: '999px',
          boxSizing: 'border-box',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          color: theme.textSecondary,
          backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.035)',
          fontWeight: 400,
          fontSize: '9px',
          lineHeight: '14px',
          opacity: 0.72,
        }}>
          {itemCount}
        </span>
        {node.hasUnread && (
          <span
            aria-label="Unread shared document"
            style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              backgroundColor: '#3b82f6',
              flexShrink: 0,
              marginLeft: '2px',
            }}
          />
        )}
        {node.canCreateFile && (
          <button
            className="bm-new-file-btn"
            onClick={(e) => { e.stopPropagation(); beginCreateFile(nodeCreateLocation); }}
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

      {node.canCreateFile && creating?.kind === 'file' && createLocationMatches(creating.location, nodeCreateLocation) && (
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

      {node.canCreateFile && creating?.kind === 'dir' && createLocationMatches(creating.location, nodeCreateLocation) && (
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

      {isExpanded && visibleChildren.map((child) => (
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
          selectedKeyboardActive={selectedKeyboardActive}
          selectedItemRef={selectedItemRef}
          hoveredId={hoveredId}
          setHoveredId={setHoveredId}
          dropTargetId={dropTargetId}
          setDropTargetId={setDropTargetId}
          onMoveLibraryItem={onMoveLibraryItem}
          theme={theme}
          onSelectItem={onSelectItem}
          selectedFileIds={selectedFileIds}
          renameRequestId={renameRequestId}
          onRenameRequestConsumed={onRenameRequestConsumed}
          onContextMenu={onContextMenu}
          onKeyboardScopeActive={onKeyboardScopeActive}
        />
      ))}
      {isExpanded && hiddenScratchpadCount > 0 && (
        <div
          onClick={(event) => {
            event.stopPropagation();
            setScratchpadExpanded(true);
          }}
          style={{
            padding: `${LIBRARY_SIDEBAR_ROW_PADDING_Y} 12px ${LIBRARY_SIDEBAR_ROW_PADDING_Y} ${24 + depth * 12}px`,
            fontSize: '10px',
            lineHeight: LIBRARY_SIDEBAR_ROW_LINE_HEIGHT,
            color: theme.textSecondary,
            cursor: 'pointer',
            opacity: 0.68,
          }}
          onMouseEnter={(event) => { event.currentTarget.style.backgroundColor = theme.hoverBg; }}
          onMouseLeave={(event) => { event.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          Show more ({hiddenScratchpadCount})
        </div>
      )}
    </div>
  );
}

function LibraryContextMenu({
  x,
  y,
  theme,
  canCreate,
  canRemoveRoot,
  canShowFolderInFinder,
  canRenameFile,
  canCopyFilePath,
  canShowFileInFinder,
  canDeleteFile,
  hideDirLabel,
  canDeleteDir,
  onNewFile,
  onNewFolder,
  onAddFolder,
  onShowFolderInFinder,
  onRenameFile,
  onCopyFilePath,
  onShowFileInFinder,
  onRemoveRoot,
  onHideDir,
  onDeleteFile,
  onDeleteDir,
}: {
  x: number;
  y: number;
  theme: ReturnType<typeof useTheme>['theme'];
  canCreate: boolean;
  canRemoveRoot: boolean;
  canShowFolderInFinder: boolean;
  canRenameFile: boolean;
  canCopyFilePath: boolean;
  canShowFileInFinder: boolean;
  canDeleteFile: boolean;
  hideDirLabel: string | null;
  canDeleteDir: boolean;
  onNewFile: () => void;
  onNewFolder: () => void;
  onAddFolder: () => void;
  onShowFolderInFinder: () => void;
  onRenameFile: () => void;
  onCopyFilePath: () => void;
  onShowFileInFinder: () => void;
  onRemoveRoot: () => void;
  onHideDir: () => void;
  onDeleteFile: () => void;
  onDeleteDir: () => void;
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
  const disabledItemStyle: React.CSSProperties = {
    ...itemStyle,
    opacity: 0.45,
    cursor: 'default',
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
      <button
        style={canCreate ? itemStyle : disabledItemStyle}
        disabled={!canCreate}
        onClick={canCreate ? onNewFile : undefined}
        onMouseEnter={canCreate ? setHover : undefined}
        onMouseLeave={canCreate ? clearHover : undefined}
      >
        New file
      </button>
      <button
        style={canCreate ? itemStyle : disabledItemStyle}
        disabled={!canCreate}
        onClick={canCreate ? onNewFolder : undefined}
        onMouseEnter={canCreate ? setHover : undefined}
        onMouseLeave={canCreate ? clearHover : undefined}
      >
        New folder
      </button>
      <button style={itemStyle} onClick={onAddFolder} onMouseEnter={setHover} onMouseLeave={clearHover}>Add folder from path...</button>
      {canShowFolderInFinder && (
        <button style={itemStyle} onClick={onShowFolderInFinder} onMouseEnter={setHover} onMouseLeave={clearHover}>Show in Finder</button>
      )}
      {canRenameFile && (
        <button style={itemStyle} onClick={onRenameFile} onMouseEnter={setHover} onMouseLeave={clearHover}>Rename</button>
      )}
      {canCopyFilePath && (
        <button style={itemStyle} onClick={onCopyFilePath} onMouseEnter={setHover} onMouseLeave={clearHover}>Copy file path</button>
      )}
      {canShowFileInFinder && (
        <button style={itemStyle} onClick={onShowFileInFinder} onMouseEnter={setHover} onMouseLeave={clearHover}>Show in Finder</button>
      )}
      {canRemoveRoot && (
        <button style={itemStyle} onClick={onRemoveRoot} onMouseEnter={setHover} onMouseLeave={clearHover}>Remove from FT</button>
      )}
      {hideDirLabel && (
        <button style={itemStyle} onClick={onHideDir} onMouseEnter={setHover} onMouseLeave={clearHover}>{hideDirLabel}</button>
      )}
      {canDeleteDir && (
        <button
          style={{ ...itemStyle, color: '#dc2626' }}
          onClick={onDeleteDir}
          onMouseEnter={(event) => setHover(event, true)}
          onMouseLeave={clearHover}
        >
          Delete folder
        </button>
      )}
      {canDeleteFile && (
        <button
          style={{ ...itemStyle, color: '#dc2626' }}
          onClick={onDeleteFile}
          onMouseEnter={(event) => setHover(event, true)}
          onMouseLeave={clearHover}
        >
          Delete
        </button>
      )}
    </div>
  );
}

function FileItem({ item, depth = 0, isSelected, selectedKeyboardActive, isHovered, theme, onSelect, onHover, onContextMenu, onKeyboardScopeActive, requestRename, onRenameRequestConsumed, draggable, refProp }: {
  item: UnifiedItem;
  depth?: number;
  isSelected: boolean;
  selectedKeyboardActive: boolean;
  isHovered: boolean;
  theme: ReturnType<typeof useTheme>['theme'];
  onSelect: (event: React.MouseEvent) => void;
  onHover: (id: string | null) => void;
  onContextMenu?: (event: React.MouseEvent) => void;
  onKeyboardScopeActive?: () => void;
  requestRename?: boolean;
  onRenameRequestConsumed?: () => void;
  draggable?: boolean;
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
  const sidebarIconColor = theme.isDark ? SIDEBAR_DARK_ICON_COLOR : SIDEBAR_LIGHT_ICON_COLOR;
  const sidebarTextColor = theme.isDark ? SIDEBAR_DARK_TEXT_COLOR : SIDEBAR_LIGHT_TEXT_COLOR;

  const beginRename = useCallback(() => {
    if (!canRename) return;
    setDraft(item.title);
    setRenaming(true);
  }, [canRename, item.title]);

  useEffect(() => {
    if (!requestRename) return;
    beginRename();
    onRenameRequestConsumed?.();
  }, [beginRename, requestRename, onRenameRequestConsumed]);

  const commitRename = async () => {
    if (!renaming) return;
    const trimmed = draft.trim();
    setRenaming(false);
    if (!canRename || !item.relPath || !trimmed || trimmed === item.title) return;
    await window.wikiAPI?.rename(item.relPath, trimmed);
  };

  const canShowInFinder = !!item.absPath && item.type !== 'bookmarks';
  const showFinderButton = canShowInFinder && isHovered;
  const selectedInSidebar = isSelected && selectedKeyboardActive;
  const selectedInDocument = isSelected && !selectedKeyboardActive;
  const documentSelectionColor = theme.isDark ? '#38bdf8' : '#0284c7';

  return (
    <div
      ref={refProp}
      tabIndex={-1}
      draggable={draggable}
      onDragStart={(event) => {
        if (!draggable || !item.rootPath || !item.relPath) {
          event.preventDefault();
          return;
        }
        const dragItem: LibraryDragItem = {
          rootPath: item.rootPath,
          kind: 'file',
          relPath: item.relPath,
        };
        setLibraryDragData(event.dataTransfer, dragItem);
      }}
      onDragEnd={clearLibraryDragData}
      onContextMenu={onContextMenu}
      onMouseDown={(e) => {
        onKeyboardScopeActive?.();
        e.currentTarget.focus({ preventScroll: true });
      }}
      onDoubleClick={(e) => {
        if (!canRename) return;
        e.preventDefault();
        e.stopPropagation();
        beginRename();
      }}
      onClick={(e) => {
        onSelect(e);
      }}
      onMouseEnter={() => onHover(item.id)}
      onMouseLeave={() => onHover(null)}
      style={{
        position: 'relative',
        minHeight: LIBRARY_SIDEBAR_ROW_MIN_HEIGHT,
        boxSizing: 'border-box',
        padding: `${LIBRARY_SIDEBAR_ROW_PADDING_Y} ${showFinderButton ? 28 : 12}px ${LIBRARY_SIDEBAR_ROW_PADDING_Y} ${12 + depth * 12}px`,
        cursor: 'pointer',
        backgroundColor: selectedInSidebar
          ? (theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)')
          : selectedInDocument
            ? (theme.isDark ? 'rgba(56,189,248,0.08)' : 'rgba(2,132,199,0.08)')
          : isHovered ? theme.hoverBg : 'transparent',
        borderLeft: selectedInSidebar
          ? `2px solid ${theme.accent}`
          : selectedInDocument
            ? `2px solid ${documentSelectionColor}`
            : '2px solid transparent',
        transition: 'background-color 0.1s ease',
        outline: 'none',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: SIDEBAR_ICON_TEXT_GAP,
        minHeight: LIBRARY_SIDEBAR_ROW_LINE_HEIGHT,
      }}>
        {renaming ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
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
          <>
            <SidebarMarkdownIcon color={sidebarIconColor} />
            <div style={{
              fontSize: '12px',
              fontWeight: 400,
              color: sidebarTextColor,
              lineHeight: LIBRARY_SIDEBAR_ROW_LINE_HEIGHT,
              ...librarySidebarFadeTextStyle(showFinderButton ? LIBRARY_SIDEBAR_HOVER_FADE_WIDTH : LIBRARY_SIDEBAR_FADE_WIDTH),
            }}>
              {item.title}
            </div>
            {item.todoState && (
              <span
                aria-label={item.todoState === 'done' ? 'done task note' : 'open task note'}
                title={item.todoState === 'done' ? 'done' : 'to do'}
                style={{
                  flexShrink: 0,
                  padding: '0 5px',
                  borderRadius: '999px',
                  fontSize: '9px',
                  lineHeight: '14px',
                  color: item.todoState === 'done'
                    ? (theme.isDark ? '#86efac' : '#047857')
                    : (theme.isDark ? '#93c5fd' : '#1d4ed8'),
                  backgroundColor: item.todoState === 'done'
                    ? (theme.isDark ? 'rgba(52,211,153,0.14)' : 'rgba(5,150,105,0.10)')
                    : (theme.isDark ? 'rgba(96,165,250,0.14)' : 'rgba(37,99,235,0.10)'),
                  border: `1px solid ${item.todoState === 'done'
                    ? (theme.isDark ? 'rgba(52,211,153,0.20)' : 'rgba(5,150,105,0.16)')
                    : (theme.isDark ? 'rgba(96,165,250,0.20)' : 'rgba(37,99,235,0.16)')}`,
                }}
              >
                {item.todoState === 'done' ? 'done' : 'to do'}
              </span>
            )}
            {item.hasUnread && (
              <span
                aria-label="Unread shared document"
                style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  backgroundColor: '#3b82f6',
                  flexShrink: 0,
                }}
              />
            )}
          </>
        )}
        {canShowInFinder && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              window.shellAPI?.showItemInFolder(item.absPath);
            }}
            style={{
              position: 'absolute',
              top: '50%',
              right: '8px',
              transform: 'translateY(-50%)',
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
              opacity: isHovered ? 0.7 : 0,
              pointerEvents: isHovered ? 'auto' : 'none',
              transition: 'opacity 0.1s ease, background-color 0.1s ease',
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
  expanded: boolean;
  onExpand: (expanded: boolean) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  showDivider?: boolean;
  selectedId: string | null;
  theme: ReturnType<typeof useTheme>['theme'];
  onOpenWiki: (relPath: string, title: string) => void;
  onOpenExternal: (absPath: string, title: string) => void;
}

function RecentBlock({ recent, expanded, onExpand, collapsed, onToggleCollapsed, showDivider = true, selectedId, theme, onOpenWiki, onOpenExternal }: RecentBlockProps) {
  const visibleRecent = splitRecent(recent, expanded);
  if (visibleRecent.total === 0) return null;
  const sidebarIconColor = theme.isDark ? SIDEBAR_DARK_ICON_COLOR : SIDEBAR_LIGHT_ICON_COLOR;
  const sidebarTextColor = theme.isDark ? SIDEBAR_DARK_TEXT_COLOR : SIDEBAR_LIGHT_TEXT_COLOR;

  const headerStyle: React.CSSProperties = {
    boxSizing: 'border-box',
    minHeight: LIBRARY_SIDEBAR_ROW_MIN_HEIGHT,
    padding: `${LIBRARY_SIDEBAR_ROW_PADDING_Y} 12px`,
    fontSize: '12px',
    fontWeight: 400,
    lineHeight: LIBRARY_SIDEBAR_ROW_LINE_HEIGHT,
    color: sidebarTextColor,
    display: 'flex',
    alignItems: 'center',
    gap: SIDEBAR_ICON_TEXT_GAP,
    cursor: 'pointer',
    userSelect: 'none',
  };
  const itemStyle = (isSelected: boolean): React.CSSProperties => ({
    boxSizing: 'border-box',
    minHeight: LIBRARY_SIDEBAR_ROW_MIN_HEIGHT,
    display: 'flex',
    alignItems: 'center',
    gap: SIDEBAR_ICON_TEXT_GAP,
    padding: `${LIBRARY_SIDEBAR_ROW_PADDING_Y} 12px ${LIBRARY_SIDEBAR_ROW_PADDING_Y} 24px`,
    fontSize: '12px',
    fontWeight: 400,
    lineHeight: LIBRARY_SIDEBAR_ROW_LINE_HEIGHT,
    cursor: 'pointer',
    color: sidebarTextColor,
    overflow: 'hidden',
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

  return (
    <div style={{ marginBottom: '4px' }}>
      {showDivider && (
        <hr
          style={{
            border: 'none',
            height: '1px',
            margin: '8px 12px 4px',
            backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
          }}
        />
      )}
      <div
        style={headerStyle}
        onClick={onToggleCollapsed}
        onMouseEnter={(event) => { event.currentTarget.style.backgroundColor = theme.hoverBg; }}
        onMouseLeave={(event) => { event.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        <SidebarRecentIcon color={sidebarIconColor} />
        <span>Recents</span>
      </div>
      {!collapsed && visibleRecent.entries.map((e) => {
        const id = `${e.kind}:${e.path}`;
        const isSel = selectedId === id;
        return (
          <div
            key={id}
            onClick={() => (e.kind === 'wiki' ? onOpenWiki(e.path, e.title) : onOpenExternal(e.path, e.title))}
            style={itemStyle(isSel)}
            title={e.kind === 'external' ? e.path : e.title}
            onMouseEnter={(el) => { if (!isSel) el.currentTarget.style.backgroundColor = theme.hoverBg; }}
            onMouseLeave={(el) => { if (!isSel) el.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            <SidebarMarkdownIcon color={sidebarIconColor} />
            <span style={librarySidebarFadeTextStyle()}>
              {e.title}
            </span>
          </div>
        );
      })}
      {!collapsed && visibleRecent.total > visibleRecent.entries.length && (
        <div onClick={() => onExpand(true)} style={showMoreStyle}>Show more ({visibleRecent.total - visibleRecent.entries.length})</div>
      )}
      {!collapsed && expanded && (
        <div onClick={() => onExpand(false)} style={showMoreStyle}>Show less</div>
      )}
    </div>
  );
}

function BookmarksShortcutBlock({ item, isSelected, theme, onOpen }: {
  item: UnifiedItem;
  isSelected: boolean;
  theme: ReturnType<typeof useTheme>['theme'];
  onOpen: () => void;
}) {
  const sidebarIconColor = theme.isDark ? SIDEBAR_DARK_ICON_COLOR : SIDEBAR_LIGHT_ICON_COLOR;
  const sidebarTextColor = theme.isDark ? SIDEBAR_DARK_TEXT_COLOR : SIDEBAR_LIGHT_TEXT_COLOR;

  return (
    <div>
      <hr
        style={{
          border: 'none',
          height: '1px',
          margin: '8px 12px 4px',
          backgroundColor: theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
        }}
      />
      <div
        onClick={onOpen}
        style={{
          boxSizing: 'border-box',
          minHeight: LIBRARY_SIDEBAR_ROW_MIN_HEIGHT,
          padding: '6px 12px 6px 10px',
          fontSize: '12px',
          fontWeight: 400,
          lineHeight: LIBRARY_SIDEBAR_ROW_LINE_HEIGHT,
          color: sidebarTextColor,
          display: 'flex',
          alignItems: 'center',
          gap: SIDEBAR_ICON_TEXT_GAP,
          cursor: 'pointer',
          userSelect: 'none',
          backgroundColor: isSelected ? (theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)') : 'transparent',
          borderLeft: isSelected ? `2px solid ${theme.accent}` : '2px solid transparent',
        }}
        onMouseEnter={(event) => { if (!isSelected) event.currentTarget.style.backgroundColor = theme.hoverBg; }}
        onMouseLeave={(event) => { if (!isSelected) event.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        <SidebarBookmarkIcon color={sidebarIconColor} />
        <span style={librarySidebarFadeTextStyle()}>
          {item.title}
        </span>
      </div>
    </div>
  );
}
