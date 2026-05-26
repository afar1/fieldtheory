import { memo, useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect, type MutableRefObject } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useDeleteConfirmation } from '../hooks/useDeleteConfirmation';
import { getBookmarks, onBookmarksChanged, peekBookmarks } from '../services/bookmarksCache';
import {
  SIDEBAR_DARK_ICON_COLOR,
  SIDEBAR_DARK_TEXT_COLOR,
  SIDEBAR_ICON_TEXT_GAP,
  SIDEBAR_LIGHT_ICON_COLOR,
  SIDEBAR_LIGHT_TEXT_COLOR,
  SidebarArchiveIcon,
  SidebarBookmarkIcon,
  SidebarFolderIcon,
  SidebarMarkdownIcon,
  SidebarRecentIcon,
  SidebarRiverIcon,
} from './SidebarIcons';
import { setMarkdownArchivedState, setMarkdownTodoState } from '../../electron/shared/markdownFrontmatter';

type SortMode = 'alpha' | 'time';
type SidebarTodoState = 'open' | 'done';
type SidebarTodoStateOverride = SidebarTodoState | null;

interface UnifiedItem {
  id: string;
  title: string;
  type: 'wiki' | 'artifact' | 'bookmarks' | 'ember' | 'external';
  absPath: string;
  relPath?: string;
  rootPath?: string;
  timestamp: number;
  todoState?: SidebarTodoState;
  archived?: boolean;
  sharedOriginalSourcePath?: string;
  sharedAuthorCallsign?: string;
  sharedRiverCallsign?: string;
  taggedDocId?: string;
  hasUnread?: boolean;
}

export const BOOKMARKS_ITEM_ID = 'bookmarks:root';
export const BOOKMARKS_SHORTCUT_FOLDER_ID = 'bookmarks-shortcut';
const RIVER_SHARED_FOLDER_NAME = 'River (shared)';
const RIVER_SHORTCUT_LABEL = 'River';
export const EMBER_ITEM_ID = 'ember:root';
export const SCRATCHPAD_FOLDER_NAME = 'scratchpad';
const POSSIBLE_TOP_NAV_AVAILABLE = false;
export const LIBRARY_DEFAULT_FOLDER_IDS = [
  'artifacts',
  SCRATCHPAD_FOLDER_NAME,
  'debates',
  'Plans',
  BOOKMARKS_SHORTCUT_FOLDER_ID,
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
const LIBRARY_SIDEBAR_DEPTH_INDENT = 12;
const LIBRARY_SIDEBAR_EDGE_PADDING = 12;
const LIBRARY_SIDEBAR_FADE_WIDTH = 28;
const LIBRARY_SIDEBAR_HOVER_FADE_WIDTH = 44;
const LIBRARY_SIDEBAR_SCROLL_JUMP_EDGE_DISTANCE = 56;
const RECENT_SIDEBAR_ITEM_LIMIT = 7;
const RECENT_ROW_MOVE_ANIMATION_MS = 180;
const RECENT_ROW_MOVE_ANIMATION_EASING = 'cubic-bezier(0.2, 0, 0, 1)';
const LIBRARY_SIDEBAR_REFRESH_DELAY_MS = 250;
const EMPTY_TODO_STATE_OVERRIDES: Record<string, SidebarTodoStateOverride | undefined> = {};
const LIBRARY_PINNED_ITEM_IDS_STORAGE_KEY = 'library-pinned-item-ids';
const LIBRARY_ICON_COLOR_STORAGE_KEY = 'library-sidebar-icon-color-indices';
const LIBRARY_ICON_COLOR_ORDER_STORAGE_KEY = 'library-sidebar-icon-color-order';
const LIBRARY_NEW_DOC_LOCATION_STORAGE_KEY = 'library-new-doc-location';
const LOCAL_WIKI_RENAMED_EVENT = 'fieldtheory:wiki-renamed-local';
const LOCAL_WIKI_ADDED_EVENT = 'fieldtheory:wiki-added-local';
const LOCAL_WIKI_DELETED_EVENT = 'fieldtheory:wiki-deleted-local';
const LOCAL_RIVER_CHANGED_EVENT = 'fieldtheory:river-changed-local';
const LIBRARY_SIDEBAR_ICON_COLOR_PALETTE = [
  '#8a8a8a',
  '#b45309',
  '#dc2626',
  '#0f766e',
  '#2563eb',
  '#7c3aed',
  '#be185d',
] as const;
const DEFAULT_LIBRARY_SIDEBAR_ICON_COLOR_ORDER = LIBRARY_SIDEBAR_ICON_COLOR_PALETTE.map((_color, index) => index);
const librarySidebarFadeTextStyle = (fadeWidth = LIBRARY_SIDEBAR_FADE_WIDTH): React.CSSProperties => ({
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  WebkitMaskImage: `linear-gradient(to right, #000 calc(100% - ${fadeWidth}px), transparent)`,
  maskImage: `linear-gradient(to right, #000 calc(100% - ${fadeWidth}px), transparent)`,
});

const getLibrarySidebarFileHoverBg = (isDark: boolean) => (
  isDark ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.022)'
);
export function getLibrarySidebarIconColor(
  colorIndex: number | undefined,
  fallbackColor: string,
): string {
  if (colorIndex === undefined || colorIndex < 0) return fallbackColor;
  return LIBRARY_SIDEBAR_ICON_COLOR_PALETTE[colorIndex % LIBRARY_SIDEBAR_ICON_COLOR_PALETTE.length];
}

export function normalizeLibrarySidebarIconColorOrder(value: unknown): number[] {
  if (!Array.isArray(value)) return DEFAULT_LIBRARY_SIDEBAR_ICON_COLOR_ORDER;
  const seen = new Set<number>();
  const next: number[] = [];
  for (const item of value) {
    if (!Number.isInteger(item)) continue;
    if (item < 0 || item >= LIBRARY_SIDEBAR_ICON_COLOR_PALETTE.length) continue;
    if (seen.has(item)) continue;
    seen.add(item);
    next.push(item);
  }
  for (const item of DEFAULT_LIBRARY_SIDEBAR_ICON_COLOR_ORDER) {
    if (!seen.has(item)) next.push(item);
  }
  return next;
}

export function reorderLibrarySidebarIconColorOrder(
  order: readonly number[],
  fromIndex: number,
  toIndex: number,
): number[] {
  if (fromIndex < 0 || fromIndex >= order.length || toIndex < 0 || toIndex >= order.length || fromIndex === toIndex) {
    return [...order];
  }
  const next = [...order];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export function getSidebarIconColorDragTargetIndex(
  startIndex: number,
  startY: number,
  currentY: number,
  rowHeight: number,
  itemCount: number,
): number {
  if (itemCount <= 0) return 0;
  const safeRowHeight = Math.max(1, rowHeight);
  const rowDelta = Math.round((currentY - startY) / safeRowHeight);
  return Math.max(0, Math.min(itemCount - 1, startIndex + rowDelta));
}

function collectSidebarIconTargetIds(nodes: readonly SidebarNode[]): string[] {
  const ids: string[] = [];
  const visit = (node: SidebarNode) => {
    ids.push(node.id);
    if (node.kind === 'dir') node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return ids;
}

const waitForSidebarCollapseAnimation = () => new Promise<void>((resolve) => {
  window.setTimeout(resolve, 140);
});

export function getSidebarFolderHeaderPositionStyle(depth: number): React.CSSProperties {
  return depth === 0 ? { position: 'sticky', top: 0, zIndex: 3 } : {};
}

export function isSidebarFolderHeaderPinned(
  scrollerTop: number,
  headerTop: number,
  folderTop: number,
): boolean {
  return headerTop <= scrollerTop + 1 && folderTop < scrollerTop - 1;
}

export function shouldShowSidebarPinnedFolderFade(depth: number, expanded: boolean, pinned: boolean): boolean {
  return depth === 0 && expanded && pinned;
}

export function getSidebarDividerStyle(isDark: boolean): React.CSSProperties {
  return {
    border: 'none',
    height: '1px',
    flexShrink: 0,
    margin: '8px 12px 4px',
    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
  };
}

function getSidebarChildGuideStyle(depth: number, isDark: boolean): React.CSSProperties {
  return {
    position: 'absolute',
    top: LIBRARY_SIDEBAR_ROW_MIN_HEIGHT,
    bottom: '2px',
    left: `${LIBRARY_SIDEBAR_EDGE_PADDING + depth * LIBRARY_SIDEBAR_DEPTH_INDENT + 6}px`,
    width: '1px',
    backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
    pointerEvents: 'none',
  };
}

function libraryRenameTraceEnabled(): boolean {
  try {
    return localStorage.getItem('fieldtheory.libraryRenameTrace') === 'true';
  } catch {
    return false;
  }
}

function traceLibrarySidebar(stage: string, extra: Record<string, unknown> = {}): void {
  if (!libraryRenameTraceEnabled()) return;
  console.debug('[LibraryRenameTrace]', stage, extra);
}

function traceLibraryRename(stage: string, event: LibraryRenameEvent, extra: Record<string, unknown> = {}): void {
  traceLibrarySidebar(stage, {
    traceId: event.traceId,
    source: event.source,
    oldRelPath: event.oldRelPath,
    newRelPath: event.newRelPath,
    ipcAgeMs: event.emittedAt ? Date.now() - event.emittedAt : null,
    ...extra,
  });
}

type LibraryDragItem = {
  rootPath: string;
  kind: 'file' | 'dir';
  relPath: string;
};

let activeLibraryDragItem: LibraryDragItem | null = null;

type LocalWikiDeletedPayload = {
  relPaths: string[];
};

export function dispatchLocalWikiRenamed(event: LibraryRenameEvent): void {
  window.dispatchEvent(new CustomEvent<LibraryRenameEvent>(LOCAL_WIKI_RENAMED_EVENT, { detail: event }));
}

export function dispatchLocalWikiAdded(page: WikiPage): void {
  window.dispatchEvent(new CustomEvent<WikiPage>(LOCAL_WIKI_ADDED_EVENT, { detail: page }));
}

export function dispatchLocalWikiDeleted(relPathOrRelPaths: string | string[]): void {
  const relPaths = Array.isArray(relPathOrRelPaths) ? relPathOrRelPaths : [relPathOrRelPaths];
  const validRelPaths = relPaths.filter(Boolean);
  if (validRelPaths.length === 0) return;
  window.dispatchEvent(new CustomEvent<LocalWikiDeletedPayload>(LOCAL_WIKI_DELETED_EVENT, {
    detail: { relPaths: validRelPaths },
  }));
}

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
      finderPath?: string;
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

type NewDocLocationOption = {
  id: string;
  label: string;
  pathLabel: string;
  depth: number;
  location: LibraryCreateLocation;
  iconColorIndex?: number;
};

type LibraryFolderConfirmationRequest = {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
};

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

export interface WikiArchiveController {
  hasExplicitSelection: () => boolean;
  canArchiveSelected: () => boolean;
  hasArchiveUndo: () => boolean;
  toggleFocusedSelection: (itemId?: string | null) => boolean;
  toggleSelectedArchive: () => Promise<boolean>;
  undoArchive: () => Promise<boolean>;
  cycleSelectedTodoState: (direction: 'forward' | 'backward') => Promise<boolean>;
  deleteSelectedItems: () => boolean;
  renameFocusedItem: (itemId?: string | null) => boolean;
}

interface WikiSidebarProps {
  active?: boolean;
  onSelectItem: (item: UnifiedItem) => void;
  onOpenItemInNewWindow?: (item: UnifiedItem, options?: { sidebarCollapsed?: boolean }) => void;
  selectedId: string | null;
  selectedKeyboardActive?: boolean;
  todoStateOverrides?: Record<string, SidebarTodoStateOverride | undefined>;
  onCreateFile: (location: LibraryCreateLocation, fileName: string) => boolean | void | WikiPage | Promise<boolean | void | WikiPage>;
  onCreateDefaultFile?: (location: LibraryCreateLocation) => boolean | void | Promise<boolean | void>;
  onCreateDir: (location: LibraryCreateLocation) => boolean | void | Promise<boolean | void>;
  flatItemsRef?: MutableRefObject<UnifiedItem[]>;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  searchInputRef?: MutableRefObject<HTMLInputElement | null>;
  creationControllerRef?: MutableRefObject<WikiCreationController | null>;
  archiveControllerRef?: MutableRefObject<WikiArchiveController | null>;
  onSidebarItemContentChanged?: (item: UnifiedItem, content: string, version: DocumentVersion | null) => void;
  onDeletedItem?: (item: UnifiedItem) => void;
  onKeyboardScopeActive?: () => void;
}

export type { UnifiedItem, UnifiedFolder, SortMode };

type ArchivableSidebarItem = UnifiedItem & { type: 'wiki' | 'external' };
type SidebarArchiveUndo = {
  entries: Array<{
    item: ArchivableSidebarItem;
    previousArchived: boolean;
  }>;
};

function canOpenSidebarItemInNewWindow(item: UnifiedItem | null | undefined): item is UnifiedItem & { type: 'wiki' | 'artifact' | 'external' } {
  return item?.type === 'wiki' || item?.type === 'artifact' || item?.type === 'external';
}

function isArchivableSidebarItem(item: UnifiedItem | null | undefined): item is ArchivableSidebarItem {
  return item?.type === 'wiki' || item?.type === 'external';
}

function getNextSelectedTodoState(items: ArchivableSidebarItem[], direction: 'forward' | 'backward'): SidebarTodoState | null {
  const states = items.map((item) => item.todoState ?? null);
  if (direction === 'backward') {
    if (states.some((state) => state === null)) return 'done';
    if (states.some((state) => state === 'done')) return 'open';
    return null;
  }

  if (states.some((state) => state === null)) return 'open';
  if (states.some((state) => state === 'open')) return 'done';
  return null;
}

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

export function shouldShowSidebarTodoStateBadge(item: Pick<UnifiedItem, 'todoState'>, isCollapsing: boolean): boolean {
  return !!item.todoState && !isCollapsing;
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

export function splitRecent(
  entries: RecentEntry[],
  limit: number = RECENT_SIDEBAR_ITEM_LIMIT,
): {
  entries: RecentEntry[];
  total: number;
} {
  return {
    entries: entries.slice(0, limit),
    total: entries.length,
  };
}

export function getRecentEntrySidebarId(entry: RecentEntry): string {
  return `${entry.kind}:${entry.path}`;
}

export function getRecentEntryParentLabel(entry: Pick<RecentEntry, 'kind' | 'path'>): string {
  const parts = entry.path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (entry.kind === 'wiki') {
    return parts.length > 1 ? parts.slice(0, -1).join(' / ') : 'Library';
  }
  return parts.length > 1 ? parts[parts.length - 2] : 'File';
}

export function getRecentEntryParentPath(entry: Pick<RecentEntry, 'kind' | 'path'>): string {
  return `/ ${getRecentEntryParentLabel(entry).replace(/\s*\/\s*/g, ' / ')}`;
}

export function getRecentRowMoveKeyframes(previousTop: number, currentTop: number): Keyframe[] | null {
  const deltaY = previousTop - currentTop;
  if (Math.abs(deltaY) < 1) return null;
  return [
    { transform: `translateY(${deltaY}px)` },
    { transform: 'translateY(0)' },
  ];
}

export function splitPinnedRecentEntries(
  entries: RecentEntry[],
  pinnedItemIds: ReadonlySet<string>,
): { pinned: RecentEntry[]; unpinned: RecentEntry[] } {
  const pinned: RecentEntry[] = [];
  const unpinned: RecentEntry[] = [];
  for (const entry of entries) {
    if (pinnedItemIds.has(getRecentEntrySidebarId(entry))) pinned.push(entry);
    else unpinned.push(entry);
  }
  return { pinned, unpinned };
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

export function removeWikiRelPathFromTree(tree: WikiFolder[], relPath: string): WikiFolder[] {
  let changed = false;
  const next = tree.map((folder) => {
    const files = folder.files.filter((page) => !wikiRelPathMatchesDeletedPath(page.relPath, relPath));
    if (files.length === folder.files.length) return folder;
    changed = true;
    return { ...folder, files };
  });
  return changed ? next : tree;
}

function wikiRelPathMatchesDeletedPath(candidate: string, deletedRelPath: string): boolean {
  return candidate === deletedRelPath || candidate.startsWith(`${deletedRelPath}/`);
}

function relPathTitle(relPath: string): string {
  return relPath.split('/').filter(Boolean).pop() ?? relPath;
}

function renameWikiRelPathInTree(tree: WikiFolder[], event: LibraryRenameEvent): WikiFolder[] {
  let changed = false;
  const next = tree.map((folder) => {
    const files = folder.files.map((page) => {
      if (page.relPath !== event.oldRelPath) return page;
      changed = true;
      const title = relPathTitle(event.newRelPath);
      return {
        ...page,
        relPath: event.newRelPath,
        absPath: event.newAbsPath,
        name: title,
        title,
        lastUpdated: Date.now(),
      };
    });
    return changed ? { ...folder, files } : folder;
  });
  return changed ? next : tree;
}

function removeWikiRelPathFromNodes(nodes: WikiNode[], relPath: string): { nodes: WikiNode[]; changed: boolean } {
  let changed = false;
  const next: WikiNode[] = [];

  for (const node of nodes) {
    if (wikiRelPathMatchesDeletedPath(node.relPath, relPath)) {
      changed = true;
      continue;
    }

    if (node.kind === 'file') {
      next.push(node);
      continue;
    }

    const children = removeWikiRelPathFromNodes(node.children, relPath);
    if (children.changed) {
      changed = true;
      next.push({ ...node, children: children.nodes });
    } else {
      next.push(node);
    }
  }

  return { nodes: changed ? next : nodes, changed };
}

function wikiFileNodeFromPage(page: WikiPageMeta): WikiNode {
  return {
    kind: 'file',
    relPath: page.relPath,
    absPath: page.absPath,
    name: page.name,
    title: page.title,
    lastUpdated: page.lastUpdated,
    todoState: page.todoState,
    archived: page.archived,
  };
}

function makeWikiDirChain(parts: string[], page: WikiPageMeta, parentRelPath = ''): WikiNode {
  const [head, ...rest] = parts;
  const relPath = parentRelPath ? `${parentRelPath}/${head}` : head;
  if (rest.length === 1) {
    return { kind: 'dir', name: head, relPath, children: [wikiFileNodeFromPage(page)] };
  }
  return { kind: 'dir', name: head, relPath, children: [makeWikiDirChain(rest, page, relPath)] };
}

function addWikiPageToNodes(nodes: WikiNode[], page: WikiPageMeta, parentRelPath = ''): { nodes: WikiNode[]; changed: boolean } {
  const relPath = parentRelPath && page.relPath.startsWith(`${parentRelPath}/`)
    ? page.relPath.slice(parentRelPath.length + 1)
    : page.relPath;
  const parts = relPath.split('/').filter(Boolean);
  if (parts.length === 0) return { nodes, changed: false };
  if (parts.length === 1) {
    let changed = false;
    const fileNode = wikiFileNodeFromPage(page);
    const next = nodes.map((node) => {
      if (node.kind !== 'file' || node.relPath !== page.relPath) return node;
      changed = true;
      return fileNode;
    });
    if (changed) return { nodes: next, changed };
    return { nodes: [...nodes, fileNode], changed: true };
  }

  const [dirName] = parts;
  const dirRelPath = parentRelPath ? `${parentRelPath}/${dirName}` : dirName;
  let changed = false;
  const next = nodes.map((node) => {
    if (node.kind !== 'dir' || node.relPath !== dirRelPath) return node;
    const added = addWikiPageToNodes(node.children, page, dirRelPath);
    if (!added.changed) return node;
    changed = true;
    return { ...node, children: added.nodes };
  });
  if (changed) return { nodes: next, changed };
  return { nodes: [...nodes, makeWikiDirChain(parts, page)], changed: true };
}

function renameWikiRelPathInNodes(nodes: WikiNode[], event: LibraryRenameEvent): { nodes: WikiNode[]; changed: boolean } {
  let changed = false;
  const next = nodes.map((node) => {
    if (node.kind === 'file') {
      if (node.relPath !== event.oldRelPath) return node;
      changed = true;
      const title = relPathTitle(event.newRelPath);
      return {
        ...node,
        relPath: event.newRelPath,
        absPath: event.newAbsPath,
        name: title,
        title,
        lastUpdated: Date.now(),
      };
    }

    const children = renameWikiRelPathInNodes(node.children, event);
    if (!children.changed) return node;
    changed = true;
    return { ...node, children: children.nodes };
  });
  return { nodes: changed ? next : nodes, changed };
}

export function removeWikiRelPathFromLibraryRoots(roots: LibraryRoot[], relPath: string): LibraryRoot[] {
  let changed = false;
  const next = roots.map((root) => {
    if (!root.builtin) return root;
    const pruned = removeWikiRelPathFromNodes(root.tree, relPath);
    if (!pruned.changed) return root;
    changed = true;
    return { ...root, tree: pruned.nodes };
  });
  return changed ? next : roots;
}

export function addWikiPageToTree(tree: WikiFolder[], page: WikiPageMeta): WikiFolder[] {
  const folderName = page.relPath.split('/').filter(Boolean)[0] ?? '';
  if (!folderName) return tree;
  const pageMeta: WikiPageMeta = {
    relPath: page.relPath,
    absPath: page.absPath,
    name: page.name,
    title: page.title,
    lastUpdated: page.lastUpdated,
    todoState: page.todoState,
    archived: page.archived,
  };
  let changed = false;
  const next = tree.map((folder) => {
    if (folder.name !== folderName) return folder;
    changed = true;
    const files = folder.files.some((file) => file.relPath === page.relPath)
      ? folder.files.map((file) => file.relPath === page.relPath ? pageMeta : file)
      : [...folder.files, pageMeta];
    return { ...folder, files };
  });
  if (changed) return next;
  return [...tree, { name: folderName, files: [pageMeta] }];
}

export function addWikiPageToLibraryRoots(roots: LibraryRoot[], page: WikiPageMeta): LibraryRoot[] {
  let changed = false;
  const next = roots.map((root) => {
    if (!root.builtin) return root;
    const added = addWikiPageToNodes(root.tree, page);
    if (!added.changed) return root;
    changed = true;
    return { ...root, tree: added.nodes };
  });
  return changed ? next : roots;
}

export function addPageToLibraryRoot(roots: LibraryRoot[], rootPath: string, page: WikiPageMeta): LibraryRoot[] {
  let changed = false;
  const next = roots.map((root) => {
    if (root.path !== rootPath) return root;
    const added = addWikiPageToNodes(root.tree, page);
    if (!added.changed) return root;
    changed = true;
    return { ...root, tree: added.nodes };
  });
  return changed ? next : roots;
}

export function renameLibraryRootRelPath(roots: LibraryRoot[], event: LibraryRenameEvent): LibraryRoot[] {
  let changed = false;
  const next = roots.map((root) => {
    if (root.path !== event.rootPath && !(event.builtin && root.builtin)) return root;
    const renamed = renameWikiRelPathInNodes(root.tree, event);
    if (!renamed.changed) return root;
    changed = true;
    return { ...root, tree: renamed.nodes };
  });
  return changed ? next : roots;
}

export function wikiTreeHasRelPath(tree: WikiFolder[], relPath: string): boolean {
  return tree.some((folder) => folder.files.some((page) => page.relPath === relPath));
}

export function libraryRootsHaveBuiltinRelPath(roots: LibraryRoot[], relPath: string): boolean {
  return roots.some((root) => root.builtin && nodesHaveRelPath(root.tree, relPath));
}

function nodesHaveRelPath(nodes: WikiNode[], relPath: string): boolean {
  return nodes.some((node) => {
    if (node.kind === 'file') return node.relPath === relPath;
    return nodesHaveRelPath(node.children, relPath);
  });
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
    title: 'Bookmarks',
    type: 'bookmarks',
    absPath: '',
    timestamp: 0,
  };
}

function sidebarNodeSortTimestamp(node: SidebarNode): number {
  if (node.kind === 'file') return node.item.timestamp;
  return node.children.reduce((latest, child) => Math.max(latest, sidebarNodeSortTimestamp(child)), 0);
}

function sidebarNodePinnedRank(node: SidebarNode, pinnedItemIds: ReadonlySet<string>): number {
  return pinnedItemIds.has(node.id) ? 1 : 0;
}

function sidebarNodeArchivedRank(node: SidebarNode, pinnedItemIds: ReadonlySet<string>): number {
  if (pinnedItemIds.has(node.id)) return 0;
  return node.kind === 'file' && node.item.archived ? 1 : 0;
}

function sidebarNodeColorRank(
  node: SidebarNode,
  iconColorIndices: Readonly<Record<string, number>>,
  iconColorOrder: readonly number[],
): number {
  const colorIndex = iconColorIndices[node.id];
  const effectiveColorIndex = typeof colorIndex === 'number' ? colorIndex : 0;
  const orderedIndex = iconColorOrder.indexOf(effectiveColorIndex);
  return orderedIndex >= 0 ? orderedIndex : effectiveColorIndex;
}

function isArchivedSidebarNode(node: SidebarNode, pinnedItemIds: ReadonlySet<string>): boolean {
  return sidebarNodeArchivedRank(node, pinnedItemIds) > 0;
}

export function splitArchivedSidebarNodes(
  nodes: SidebarNode[],
  pinnedItemIds: ReadonlySet<string> = new Set(),
): { normalNodes: SidebarNode[]; archivedNodes: SidebarNode[] } {
  const archivedNodes = nodes.filter((node) => isArchivedSidebarNode(node, pinnedItemIds));
  if (archivedNodes.length === 0) return { normalNodes: nodes, archivedNodes };
  return {
    normalNodes: nodes.filter((node) => !isArchivedSidebarNode(node, pinnedItemIds)),
    archivedNodes,
  };
}

export function sortSidebarNodes(
  nodes: SidebarNode[],
  sortMode: SortMode = 'alpha',
  pinnedItemIds: ReadonlySet<string> = new Set(),
  iconColorIndices: Readonly<Record<string, number>> = {},
  iconColorOrder: readonly number[] = DEFAULT_LIBRARY_SIDEBAR_ICON_COLOR_ORDER,
): SidebarNode[] {
  return [...nodes].sort((a, b) => {
    const pinnedDelta = sidebarNodePinnedRank(b, pinnedItemIds) - sidebarNodePinnedRank(a, pinnedItemIds);
    if (pinnedDelta !== 0) return pinnedDelta;
    const archivedDelta = sidebarNodeArchivedRank(a, pinnedItemIds) - sidebarNodeArchivedRank(b, pinnedItemIds);
    if (archivedDelta !== 0) return archivedDelta;
    const colorDelta = sidebarNodeColorRank(a, iconColorIndices, iconColorOrder) - sidebarNodeColorRank(b, iconColorIndices, iconColorOrder);
    if (colorDelta !== 0) return colorDelta;
    if (sortMode === 'time') {
      const byTimestamp = sidebarNodeSortTimestamp(b) - sidebarNodeSortTimestamp(a);
      if (byTimestamp !== 0) return byTimestamp;
    }
    const left = a.kind === 'dir' ? a.label : a.item.title;
    const right = b.kind === 'dir' ? b.label : b.item.title;
    return left.localeCompare(right, undefined, { sensitivity: 'base' });
  });
}

export function orderTopLevelSidebarNodes(
  nodes: SidebarNode[],
  _sortMode: SortMode = 'alpha',
  pinnedItemIds: ReadonlySet<string> = new Set(),
  iconColorIndices: Readonly<Record<string, number>> = {},
  iconColorOrder: readonly number[] = DEFAULT_LIBRARY_SIDEBAR_ICON_COLOR_ORDER,
): SidebarNode[] {
  return sortSidebarNodes(nodes, 'alpha', pinnedItemIds, iconColorIndices, iconColorOrder);
}

export function splitRiverShortcutNode(
  nodes: SidebarNode[],
): { riverShortcutNode: Extract<SidebarNode, { kind: 'dir' }> | null; visibleRoots: SidebarNode[] } {
  const riverNodes = nodes.filter((node): node is Extract<SidebarNode, { kind: 'dir' }> => (
    node.kind === 'dir'
    && (node.name === RIVER_SHARED_FOLDER_NAME || node.label === RIVER_SHARED_FOLDER_NAME)
  ));
  if (riverNodes.length === 0) return { riverShortcutNode: null, visibleRoots: nodes };

  const riverShortcutNode = riverNodes.reduce((best, node) => (
    countSidebarItems(node.children) > countSidebarItems(best.children) ? node : best
  ));
  const riverIds = new Set(riverNodes.map((node) => node.id));
  return {
    riverShortcutNode,
    visibleRoots: nodes.filter((node) => !riverIds.has(node.id)),
  };
}

export function normalizeRiverSharedSourcePath(sourcePath: string | undefined): string | null {
  const normalized = sourcePath?.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalized) return null;
  return normalized.replace(/\.(?:md|markdown)$/i, '').toLowerCase();
}

export function collectRiverSharedSourceCallsigns(
  nodes: readonly SidebarNode[],
): Map<string, string> {
  const callsignBySource = new Map<string, string>();
  const visitRiverChild = (node: SidebarNode) => {
    if (node.kind === 'file') {
      const sourceKey = normalizeRiverSharedSourcePath(node.item.sharedOriginalSourcePath);
      const callsign = node.item.sharedAuthorCallsign?.trim();
      if (sourceKey && callsign) callsignBySource.set(sourceKey, callsign);
      return;
    }
    node.children.forEach(visitRiverChild);
  };

  for (const node of nodes) {
    if (
      node.kind === 'dir'
      && (node.name === RIVER_SHARED_FOLDER_NAME || node.label === RIVER_SHARED_FOLDER_NAME)
    ) {
      node.children.forEach(visitRiverChild);
    }
  }

  return callsignBySource;
}

export function annotateRiverSharedItems(
  nodes: readonly SidebarNode[],
  callsignBySource: ReadonlyMap<string, string>,
): SidebarNode[] {
  return nodes.map((node) => {
    if (node.kind === 'file') {
      const sourceKey = normalizeRiverSharedSourcePath(node.item.relPath);
      const callsign = sourceKey ? callsignBySource.get(sourceKey) : undefined;
      if (!callsign || node.item.sharedRiverCallsign === callsign) return node;
      return {
        ...node,
        item: {
          ...node.item,
          sharedRiverCallsign: callsign,
        },
      };
    }

    if (node.name === RIVER_SHARED_FOLDER_NAME || node.label === RIVER_SHARED_FOLDER_NAME) return node;
    return {
      ...node,
      children: annotateRiverSharedItems(node.children, callsignBySource),
    };
  });
}

export function applyPinnedSidebarOrder(
  nodes: SidebarNode[],
  sortMode: SortMode,
  pinnedItemIds: ReadonlySet<string>,
  iconColorIndices: Readonly<Record<string, number>> = {},
  iconColorOrder: readonly number[] = DEFAULT_LIBRARY_SIDEBAR_ICON_COLOR_ORDER,
): SidebarNode[] {
  if (pinnedItemIds.size === 0 && Object.keys(iconColorIndices).length === 0) return nodes;
  return sortSidebarNodes(nodes.map((node) => {
    if (node.kind === 'file') return node;
    return {
      ...node,
      children: applyPinnedSidebarOrder(node.children, sortMode, pinnedItemIds, iconColorIndices, iconColorOrder),
    };
  }), sortMode, pinnedItemIds, iconColorIndices, iconColorOrder);
}

export function toggleSidebarPinnedItemIds(
  pinnedItemIds: ReadonlySet<string>,
  targetId: string | null,
): Set<string> {
  const next = new Set(pinnedItemIds);
  if (!targetId) return next;
  if (next.has(targetId)) next.delete(targetId);
  else next.add(targetId);
  return next;
}

export function renamePinnedSidebarIds(pinnedItemIds: Set<string>, event: LibraryRenameEvent): Set<string> {
  let changed = false;
  const next = new Set<string>();
  const oldWikiFileId = `wiki:${event.oldRelPath}`;
  const newWikiFileId = `wiki:${event.newRelPath}`;
  const oldExternalFileId = `external:${event.oldAbsPath}`;
  const newExternalFileId = `external:${event.newAbsPath}`;
  const oldFolderId = `${event.rootPath}::${event.oldRelPath}`;
  const newFolderId = `${event.rootPath}::${event.newRelPath}`;
  const builtinFolderSuffix = `::${event.oldRelPath}`;

  for (const id of pinnedItemIds) {
    let replacement = id;
    if (event.builtin) {
      if (id === oldWikiFileId) {
        replacement = newWikiFileId;
      } else if (id.endsWith(builtinFolderSuffix)) {
        replacement = `${id.slice(0, -builtinFolderSuffix.length)}::${event.newRelPath}`;
      }
    } else if (id === oldExternalFileId) {
      replacement = newExternalFileId;
    } else if (id === oldFolderId) {
      replacement = newFolderId;
    }

    if (replacement !== id) changed = true;
    next.add(replacement);
  }

  return changed ? next : pinnedItemIds;
}

function getLibraryFolderVisibilityId(node: SidebarNode): string | null {
  if (node.kind !== 'dir') return null;
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
      if (node.kind === 'file' && node.id === BOOKMARKS_ITEM_ID && hidden.has(BOOKMARKS_SHORTCUT_FOLDER_ID)) {
        changed = true;
        continue;
      }
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

function isReadmeOnlyLibraryArtifactsNode(node: SidebarNode): boolean {
  if (node.kind !== 'dir' || !node.builtin || node.name !== 'artifacts') return false;
  return node.children.length === 0 || node.children.every((child) => (
    child.kind === 'file' && child.item.relPath === 'artifacts/README'
  ));
}

export function hideReadmeOnlyLibraryArtifactsFolder(nodes: SidebarNode[]): SidebarNode[] {
  const filtered = nodes.filter((node) => !isReadmeOnlyLibraryArtifactsNode(node));
  return filtered.length === nodes.length ? nodes : filtered;
}

function parentDirFromPath(filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, '/');
  const separatorIndex = normalized.lastIndexOf('/');
  return separatorIndex > 0 ? normalized.slice(0, separatorIndex) : null;
}

export function getPrimaryArtifactsFinderPath(artifacts: ReadonlyArray<Pick<ReadingMeta, 'path'>>): string | null {
  const globalMarker = '/.fieldtheory/librarian/artifacts/';
  const globalArtifact = artifacts.find((artifact) => artifact.path.replace(/\\/g, '/').includes(globalMarker));
  if (globalArtifact) {
    const normalized = globalArtifact.path.replace(/\\/g, '/');
    const markerIndex = normalized.indexOf(globalMarker);
    return normalized.slice(0, markerIndex + globalMarker.length - 1);
  }
  return artifacts[0] ? parentDirFromPath(artifacts[0].path) : null;
}

export function getSidebarFolderFinderPath(node: SidebarNode | null): string | null {
  if (!node || node.kind !== 'dir') return null;
  if (node.finderPath) return node.finderPath;
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

function collectSidebarItems(nodes: SidebarNode[], includeArchived = true): UnifiedItem[] {
  return nodes.flatMap((node) => {
    if (node.kind === 'file') return includeArchived || !node.item.archived ? [node.item] : [];
    return collectSidebarItems(node.children, includeArchived);
  });
}

export function collectSidebarSiblingItems(
  nodes: SidebarNode[],
  selectedId: string | null,
  includeArchived = true,
): UnifiedItem[] {
  if (!selectedId) return [];

  const directItems = nodes.flatMap((node) => (
    node.kind === 'file' && (includeArchived || !node.item.archived) ? [node.item] : []
  ));
  if (directItems.some((item) => item.id === selectedId)) return directItems;

  for (const node of nodes) {
    if (node.kind === 'dir') {
      const match = collectSidebarSiblingItems(node.children, selectedId, includeArchived);
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

function getLibraryCreateLocationPathLabel(location: Pick<LibraryCreateLocation, 'relPath'>): string {
  const label = location.relPath
    ? location.relPath.split('/').filter(Boolean).join(' / ')
    : 'Library';
  return `/ ${label}`;
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

function shouldHideUnavailablePossibleSidebarNode(node: SidebarNode): boolean {
  return !POSSIBLE_TOP_NAV_AVAILABLE &&
    node.kind === 'dir' &&
    node.builtin &&
    !node.relPath.includes('/') &&
    node.relPath.toLowerCase() === 'possible';
}

function filterUnavailablePossibleSidebarNodes(nodes: SidebarNode[]): SidebarNode[] {
  let changed = false;
  const filtered = nodes.filter((node) => {
    const keep = !shouldHideUnavailablePossibleSidebarNode(node);
    if (!keep) changed = true;
    return keep;
  });
  return changed ? filtered : nodes;
}

function collectNewDocLocationOptions(
  nodes: readonly SidebarNode[],
): NewDocLocationOption[] {
  const options: NewDocLocationOption[] = [];
  for (const node of nodes) {
    if (node.kind === 'file') continue;
    if (node.canCreateFile) {
      const location = getSidebarNodeCreateLocation(node);
      options.push({
        id: node.id,
        label: node.label,
        pathLabel: getLibraryCreateLocationPathLabel(location),
        depth: 0,
        location,
        iconColorIndex: 0,
      });
    }
  }
  return options;
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
    const isWikiMarkdown = root.builtin && (node.documentKind === undefined || node.documentKind === 'markdown');
    const type = isWikiMarkdown ? 'wiki' : 'external';
    const id = isWikiMarkdown ? `wiki:${node.relPath}` : `external:${node.absPath}`;
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
        archived: node.archived,
        sharedOriginalSourcePath: node.sharedOriginalSourcePath,
        sharedAuthorCallsign: node.sharedAuthorCallsign,
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

export function ensureScratchpadNodePresent(nodes: SidebarNode[], root: LibraryRoot): SidebarNode[] {
  const scratchpadIndex = nodes.findIndex((node) => node.kind === 'dir' && node.name === SCRATCHPAD_FOLDER_NAME);
  if (scratchpadIndex >= 0) return nodes;
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

function getRecentEntryRevealLocation(entry: RecentEntry, roots: LibraryRoot[]): LibraryCreateLocation | null {
  if (entry.kind === 'wiki') {
    const builtinRoot = roots.find((root) => root.builtin);
    return builtinRoot ? { rootPath: builtinRoot.path, relPath: entry.path, builtin: true } : null;
  }

  const normalizedPath = entry.path.replace(/\\/g, '/');
  const matchingRoot = roots
    .filter((root) => {
      const rootPath = root.path.replace(/\\/g, '/').replace(/\/+$/, '');
      return normalizedPath === rootPath || normalizedPath.startsWith(`${rootPath}/`);
    })
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (!matchingRoot) return null;

  const rootPath = matchingRoot.path.replace(/\\/g, '/').replace(/\/+$/, '');
  const relPath = normalizedPath.slice(rootPath.length).replace(/^\/+/, '');
  return { rootPath: matchingRoot.path, relPath, builtin: matchingRoot.builtin };
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
    children = hideReadmeOnlyLibraryArtifactsFolder(children);
    children = filterUnavailablePossibleSidebarNodes(children);
    children = ensureScratchpadNodePresent(children, root);
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
  onOpenItemInNewWindow,
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
  archiveControllerRef,
  onSidebarItemContentChanged,
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
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [creating, setCreating] = useState<CreatingState>(null);
  const [newName, setNewName] = useState('');
  const createInputRef = useRef<HTMLInputElement | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [recentCollapsed, setRecentCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('wiki-recent-collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [pinnedItemIds, setPinnedItemIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(LIBRARY_PINNED_ITEM_IDS_STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) : null;
      return Array.isArray(parsed)
        ? new Set(parsed.filter((id): id is string => typeof id === 'string'))
        : new Set();
    } catch {
      return new Set();
    }
  });
  const [iconColorIndices, setIconColorIndices] = useState<Record<string, number>>(() => {
    try {
      const saved = localStorage.getItem(LIBRARY_ICON_COLOR_STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) : null;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, number] => (
          typeof entry[0] === 'string' &&
          typeof entry[1] === 'number' &&
          Number.isInteger(entry[1]) &&
          entry[1] >= 0
        )),
      );
    } catch {
      return {};
    }
  });
  const [iconColorOrder, setIconColorOrder] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem(LIBRARY_ICON_COLOR_ORDER_STORAGE_KEY);
      return normalizeLibrarySidebarIconColorOrder(saved ? JSON.parse(saved) : null);
    } catch {
      return DEFAULT_LIBRARY_SIDEBAR_ICON_COLOR_ORDER;
    }
  });
  const selectedItemRef = useRef<HTMLDivElement | null>(null);
  const archiveUndoRef = useRef<SidebarArchiveUndo | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: SidebarNode | null;
  } | null>(null);
  const [folderConfirmation, setFolderConfirmation] = useState<LibraryFolderConfirmationRequest | null>(null);
  const [renameRequestId, setRenameRequestId] = useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(() => new Set());
  const selectedFileIdsRef = useRef<Set<string>>(selectedFileIds);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [collapsingFileIds, setCollapsingFileIds] = useState<Set<string>>(() => new Set());
  const deletedWikiRelPathsRef = useRef<Set<string>>(new Set());
  const loadTreeRefreshTimeoutRef = useRef<number | null>(null);
  const loadTreeRefreshInFlightRef = useRef(false);
  const loadTreeRefreshQueuedReasonRef = useRef<string | null>(null);
  const sidebarScrollRef = useRef<HTMLDivElement | null>(null);
  const scrollJumpElementRef = useRef<HTMLElement | null>(null);
  const iconColorUndoStackRef = useRef<Record<string, number>[]>([]);
  const [scrollJumpTarget, setScrollJumpTarget] = useState<'top' | 'bottom' | null>(null);
  const [sidebarTopFadeVisible, setSidebarTopFadeVisible] = useState(false);
  const [pinnedFolderFadeIds, setPinnedFolderFadeIds] = useState<Set<string>>(() => new Set());
  const [iconColorPicker, setIconColorPicker] = useState<{
    id: string;
    x: number;
    y: number;
  } | null>(null);
  const [newDocLocationKey, setNewDocLocationKey] = useState<string>(() => {
    try {
      return localStorage.getItem(LIBRARY_NEW_DOC_LOCATION_STORAGE_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [newDocLocationPicker, setNewDocLocationPicker] = useState<{ x: number; y: number } | null>(null);
  const updateSelectedFileIds = useCallback((nextOrUpdater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    setSelectedFileIds((prev) => {
      const next = typeof nextOrUpdater === 'function' ? nextOrUpdater(prev) : nextOrUpdater;
      selectedFileIdsRef.current = next;
      return next;
    });
  }, []);

  // Scroll the selected item into view when the selection changes programmatically.
  const lastAutoScrolledSelectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedId) return;
    if (lastAutoScrolledSelectedIdRef.current === selectedId) return;
    // Defer to next frame so the selected row has rendered.
    const id = requestAnimationFrame(() => {
      const selectedNode = selectedItemRef.current;
      if (!selectedNode) return;
      lastAutoScrolledSelectedIdRef.current = selectedId;
      selectedNode.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(id);
  }, [selectedId, wikiTree, libraryRoots, artifacts, searchQuery]);

  const pruneDeletedWikiPage = useCallback((relPath: string) => {
    deletedWikiRelPathsRef.current.add(relPath);
    setWikiTree((prev) => removeWikiRelPathFromTree(prev, relPath));
    setLibraryRoots((prev) => removeWikiRelPathFromLibraryRoots(prev, relPath));
  }, []);

  const loadTree = useCallback(async (reason = 'manual') => {
    const startedAt = Date.now();
    traceLibrarySidebar('sidebar-loadTree-start', { reason });
    const [treeResult, rootsResult, hiddenFoldersResult] = await Promise.all([
      window.wikiAPI?.getTree(),
      window.libraryAPI?.getRoots(),
      window.libraryAPI?.getHiddenFolders(),
    ]);
    traceLibrarySidebar('sidebar-loadTree-ipc-done', {
      reason,
      durationMs: Date.now() - startedAt,
      folders: treeResult?.length ?? null,
      roots: rootsResult?.length ?? null,
    });
    const deletedRelPaths = [...deletedWikiRelPathsRef.current];
    let nextTree = treeResult;
    let nextRoots = rootsResult;
    for (const relPath of deletedRelPaths) {
      if (nextTree) nextTree = removeWikiRelPathFromTree(nextTree, relPath);
      if (nextRoots) nextRoots = removeWikiRelPathFromLibraryRoots(nextRoots, relPath);
    }
    for (const relPath of deletedRelPaths) {
      const existsInTree = treeResult ? wikiTreeHasRelPath(treeResult, relPath) : true;
      const existsInRoots = rootsResult ? libraryRootsHaveBuiltinRelPath(rootsResult, relPath) : true;
      if (!existsInTree && !existsInRoots) deletedWikiRelPathsRef.current.delete(relPath);
    }

    if (nextTree) setWikiTree(nextTree);
    if (hiddenFoldersResult) setHiddenDefaultFolders(hiddenFoldersResult);
    if (nextRoots) {
      setLibraryRoots(nextRoots);
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        for (const root of nextRoots) {
          if (root.builtin) next.add(`root:${root.path}`);
        }
        return next;
      });
    }
    traceLibrarySidebar('sidebar-loadTree-state-scheduled', {
      reason,
      durationMs: Date.now() - startedAt,
    });
    return nextRoots;
  }, []);

  const scheduleLoadTree = useCallback((reason: string) => {
    loadTreeRefreshQueuedReasonRef.current = reason;
    if (loadTreeRefreshTimeoutRef.current !== null) {
      window.clearTimeout(loadTreeRefreshTimeoutRef.current);
    }

    const run = () => {
      const nextReason = loadTreeRefreshQueuedReasonRef.current ?? reason;
      loadTreeRefreshQueuedReasonRef.current = null;
      loadTreeRefreshTimeoutRef.current = null;

      if (loadTreeRefreshInFlightRef.current) {
        loadTreeRefreshQueuedReasonRef.current = nextReason;
        traceLibrarySidebar('sidebar-loadTree-queued-in-flight', { reason: nextReason });
        return;
      }

      loadTreeRefreshInFlightRef.current = true;
      void loadTree(nextReason).finally(() => {
        loadTreeRefreshInFlightRef.current = false;
        const queuedReason = loadTreeRefreshQueuedReasonRef.current;
        if (!queuedReason) return;
        loadTreeRefreshQueuedReasonRef.current = null;
        scheduleLoadTree(queuedReason);
      });
    };

    loadTreeRefreshTimeoutRef.current = window.setTimeout(run, LIBRARY_SIDEBAR_REFRESH_DELAY_MS);
  }, [loadTree]);

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
    loadTree('active');
    loadArtifacts();
    loadRecent();
    loadTaggedDocs();
    const unsubWiki = window.wikiAPI?.onPageChanged(() => {
      traceLibrarySidebar('sidebar-wiki-changed-received');
      scheduleLoadTree('wiki:changed');
    });
    const unsubDeletedWiki = window.wikiAPI?.onPageDeleted((relPath) => pruneDeletedWikiPage(relPath));
    const unsubRenamedWiki = window.wikiAPI?.onPageRenamed?.((event) => {
      traceLibraryRename('sidebar-wiki-received', event);
      deletedWikiRelPathsRef.current.add(event.oldRelPath);
      setWikiTree((prev) => {
        const next = renameWikiRelPathInTree(prev, event);
        traceLibraryRename('sidebar-wiki-tree-patched', event, { changed: next !== prev });
        return next;
      });
      setLibraryRoots((prev) => {
        const next = renameLibraryRootRelPath(prev, event);
        traceLibraryRename('sidebar-wiki-roots-patched', event, { changed: next !== prev });
        return next;
      });
      setPinnedItemIds((prev) => renamePinnedSidebarIds(prev, event));
    });
    const onLocalWikiRenamed = (localEvent: Event) => {
      const event = (localEvent as CustomEvent<LibraryRenameEvent>).detail;
      if (!event) return;
      traceLibraryRename('sidebar-local-wiki-received', event);
      deletedWikiRelPathsRef.current.add(event.oldRelPath);
      setWikiTree((prev) => {
        const next = renameWikiRelPathInTree(prev, event);
        traceLibraryRename('sidebar-local-wiki-tree-patched', event, { changed: next !== prev });
        return next;
      });
      setLibraryRoots((prev) => {
        const next = renameLibraryRootRelPath(prev, event);
        traceLibraryRename('sidebar-local-wiki-roots-patched', event, { changed: next !== prev });
        return next;
      });
      setPinnedItemIds((prev) => renamePinnedSidebarIds(prev, event));
    };
    window.addEventListener(LOCAL_WIKI_RENAMED_EVENT, onLocalWikiRenamed);
    const onLocalWikiAdded = (localEvent: Event) => {
      const page = (localEvent as CustomEvent<WikiPage>).detail;
      if (!page) return;
      if (deletedWikiRelPathsRef.current.has(page.relPath)) return;
      setWikiTree((prev) => {
        return addWikiPageToTree(prev, page);
      });
      setLibraryRoots((prev) => {
        return addWikiPageToLibraryRoots(prev, page);
      });
    };
    window.addEventListener(LOCAL_WIKI_ADDED_EVENT, onLocalWikiAdded);
    const onLocalWikiDeleted = (localEvent: Event) => {
      const payload = (localEvent as CustomEvent<LocalWikiDeletedPayload>).detail;
      if (!payload?.relPaths?.length) return;
      for (const relPath of payload.relPaths) {
        pruneDeletedWikiPage(relPath);
      }
    };
    window.addEventListener(LOCAL_WIKI_DELETED_EVENT, onLocalWikiDeleted);
    const unsubLibrary = window.libraryAPI?.onRootsChanged(() => {
      traceLibrarySidebar('sidebar-library-changed-received');
      scheduleLoadTree('library:changed');
    });
    const unsubRenamedLibrary = window.libraryAPI?.onItemRenamed?.((event) => {
      if (event.builtin) return;
      traceLibraryRename('sidebar-library-received', event);
      setLibraryRoots((prev) => {
        const next = renameLibraryRootRelPath(prev, event);
        traceLibraryRename('sidebar-library-roots-patched', event, { changed: next !== prev });
        return next;
      });
      setPinnedItemIds((prev) => renamePinnedSidebarIds(prev, event));
    });
    const unsubAdded = window.librarianAPI?.onReadingAdded(() => loadArtifacts());
    const unsubRemoved = window.librarianAPI?.onReadingRemoved(() => loadArtifacts());
    const unsubUpdated = window.librarianAPI?.onReadingUpdated(() => loadArtifacts());
    const unsubRenamedReading = window.librarianAPI?.onReadingRenamed?.((event) => {
      if (libraryRenameTraceEnabled()) {
        console.debug('[LibraryRenameTrace]', 'sidebar-reading-received', {
          traceId: event.traceId,
          oldPath: event.oldPath,
          newPath: event.reading.path,
          ipcAgeMs: event.emittedAt ? Date.now() - event.emittedAt : null,
        });
      }
      loadArtifacts();
    });
    const unsubRecent = window.recentAPI?.onChanged(() => loadRecent());
    const unsubTaggedDocs = window.taggedDocsAPI?.onUpdated(() => loadTaggedDocs());
    const onLocalRiverChanged = () => {
      scheduleLoadTree('river:changed-local');
    };
    window.addEventListener(LOCAL_RIVER_CHANGED_EVENT, onLocalRiverChanged);
    // Backstop for missed FSEvents (sleep/wake, bg writes): reload on focus.
    const onFocus = () => {
      scheduleLoadTree('focus');
      loadArtifacts();
      loadRecent();
      loadTaggedDocs();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      unsubWiki?.();
      unsubDeletedWiki?.();
      unsubRenamedWiki?.();
      window.removeEventListener(LOCAL_WIKI_RENAMED_EVENT, onLocalWikiRenamed);
      window.removeEventListener(LOCAL_WIKI_ADDED_EVENT, onLocalWikiAdded);
      window.removeEventListener(LOCAL_WIKI_DELETED_EVENT, onLocalWikiDeleted);
      unsubLibrary?.();
      unsubRenamedLibrary?.();
      unsubAdded?.();
      unsubRemoved?.();
      unsubUpdated?.();
      unsubRenamedReading?.();
      unsubRecent?.();
      unsubTaggedDocs?.();
      window.removeEventListener(LOCAL_RIVER_CHANGED_EVENT, onLocalRiverChanged);
      window.removeEventListener('focus', onFocus);
      if (loadTreeRefreshTimeoutRef.current !== null) {
        window.clearTimeout(loadTreeRefreshTimeoutRef.current);
        loadTreeRefreshTimeoutRef.current = null;
      }
    };
  }, [active, loadTree, scheduleLoadTree, loadArtifacts, loadRecent, loadTaggedDocs, pruneDeletedWikiPage]);

  useEffect(() => {
    localStorage.setItem('wiki-expanded-folders', JSON.stringify([...expandedFolders]));
  }, [expandedFolders]);

  useEffect(() => {
    localStorage.setItem('library-sort-mode', sortMode);
  }, [sortMode]);

  useEffect(() => {
    localStorage.setItem('wiki-recent-collapsed', recentCollapsed ? '1' : '0');
  }, [recentCollapsed]);

  useEffect(() => {
    localStorage.setItem(LIBRARY_PINNED_ITEM_IDS_STORAGE_KEY, JSON.stringify([...pinnedItemIds]));
  }, [pinnedItemIds]);

  useEffect(() => {
    localStorage.setItem(LIBRARY_ICON_COLOR_STORAGE_KEY, JSON.stringify(iconColorIndices));
  }, [iconColorIndices]);

  useEffect(() => {
    localStorage.setItem(LIBRARY_ICON_COLOR_ORDER_STORAGE_KEY, JSON.stringify(iconColorOrder));
  }, [iconColorOrder]);

  useEffect(() => {
    if (newDocLocationKey) localStorage.setItem(LIBRARY_NEW_DOC_LOCATION_STORAGE_KEY, newDocLocationKey);
  }, [newDocLocationKey]);

  const openSidebarIconColorPicker = useCallback((id: string, event: React.MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setIconColorPicker({
      id,
      x: rect.right + 12,
      y: rect.top + rect.height / 2,
    });
  }, []);

  const openNewDocLocationPicker = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setNewDocLocationPicker({
      x: rect.right + 12,
      y: rect.top - 6,
    });
  }, []);

  const selectNewDocLocation = useCallback((option: NewDocLocationOption) => {
    setNewDocLocationKey(getLibraryCreateLocationKey(option.location));
    setNewDocLocationPicker(null);
  }, []);

  const pushIconColorUndo = useCallback((previous: Record<string, number>) => {
    iconColorUndoStackRef.current = [...iconColorUndoStackRef.current.slice(-19), { ...previous }];
  }, []);

  const selectSidebarIconColor = useCallback((id: string, colorIndex: number, targetIds?: readonly string[]) => {
    setIconColorIndices((prev) => {
      const ids = targetIds?.length ? targetIds : [id];
      if (ids.every((targetId) => prev[targetId] === colorIndex)) return prev;
      pushIconColorUndo(prev);
      const next = { ...prev };
      for (const targetId of ids) next[targetId] = colorIndex;
      return next;
    });
    setIconColorPicker(null);
  }, [pushIconColorUndo]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey || event.shiftKey || event.key.toLowerCase() !== 'z') return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, [contenteditable="true"]')) return;
      const previous = iconColorUndoStackRef.current.pop();
      if (!previous) return;
      event.preventDefault();
      setIconColorIndices(previous);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active]);

  const setSidebarIconColorOrder = useCallback((nextOrder: readonly number[]) => {
    setIconColorOrder(normalizeLibrarySidebarIconColorOrder([...nextOrder]));
  }, []);

  const getSidebarIconColor = useCallback((id: string, fallbackColor: string) => (
    getLibrarySidebarIconColor(iconColorIndices[id], fallbackColor)
  ), [iconColorIndices]);

  const getSidebarIconColorIndex = useCallback((id: string) => iconColorIndices[id], [iconColorIndices]);

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
        const isMarkdownRelPath = !/\.(html?|css)$/i.test(newRelPath);
        const type = root?.builtin && isMarkdownRelPath ? 'wiki' : 'external';
        const absPath = type === 'wiki'
          ? ''
          : `${target.rootPath.replace(/\/+$/, '')}/${isMarkdownRelPath ? `${newRelPath}.md` : newRelPath}`;
        const id = type === 'wiki' ? `wiki:${newRelPath}` : `external:${absPath}`;
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
    // Built-in markdown pages open with the document title field selected, so
    // the filename title is edited in the main surface instead of the sidebar.
    if (location.builtin && onCreateDefaultFile) {
      void (async () => {
        const created = await onCreateDefaultFile(location);
        if (created !== false) expandCreateLocation(location);
      })();
      return;
    }
    expandCreateLocation(location);
    setCreating({ kind: 'file', location });
    setNewName('');
  }, [expandCreateLocation, onCreateDefaultFile, resolveCreateTarget]);

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
      if (created !== false) {
        if (creating.location.builtin) {
          expandCreateLocation(creating.location, joinLibraryRelPath(creating.location.relPath, name));
        } else if (created && typeof created === 'object') {
          setLibraryRoots((prev) => addPageToLibraryRoot(prev, creating.location.rootPath, created));
          expandCreateLocation(creating.location, created.relPath);
        } else {
          await reloadTreeAndExpandLocation(creating.location);
        }
      }
    } else {
      const dirRelPath = joinLibraryRelPath(creating.location.relPath, name);
      const nextLocation = { ...creating.location, relPath: dirRelPath };
      const created = await onCreateDir(nextLocation);
      if (created !== false) {
        await reloadTreeAndExpandLocation(nextLocation);
      }
    }
    setCreating(null);
    setNewName('');
  }, [newName, creating, onCreateFile, onCreateDir, expandCreateLocation, reloadTreeAndExpandLocation, cancelCreate]);

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
        finderPath: getPrimaryArtifactsFinderPath(artifacts) ?? undefined,
        children: items.map((item) => ({ kind: 'file' as const, id: item.id, item })),
      });
    }

    const libraryRootNodes = libraryRoots.map((root) => rootToSidebarNode(root, sortMode, taggedDocByPath));
    roots.push(...flattenBuiltinSidebarRoots(libraryRootNodes));
    const visibleRoots = filterHiddenDefaultSidebarNodes(roots, hiddenDefaultFolders);
    return orderTopLevelSidebarNodes(
      applyPinnedSidebarOrder(visibleRoots, sortMode, pinnedItemIds, iconColorIndices, iconColorOrder),
      sortMode,
      pinnedItemIds,
      iconColorIndices,
      iconColorOrder,
    );
  }, [artifacts, hiddenDefaultFolders, iconColorIndices, iconColorOrder, libraryRoots, pinnedItemIds, sortMode, taggedDocs]);

  const sidebarRootsWithTodoOverrides = useMemo(
    () => applyTodoStateOverridesToNodes(sidebarRoots, todoStateOverrides),
    [sidebarRoots, todoStateOverrides],
  );

  const sidebarRootsWithRiverSharedIndicators = useMemo(
    () => annotateRiverSharedItems(
      sidebarRootsWithTodoOverrides,
      collectRiverSharedSourceCallsigns(sidebarRootsWithTodoOverrides),
    ),
    [sidebarRootsWithTodoOverrides],
  );

  const filteredSidebarRoots = useMemo(
    () => filterSidebarNodes(sidebarRootsWithRiverSharedIndicators, searchQuery),
    [sidebarRootsWithRiverSharedIndicators, searchQuery]
  );
  const filteredRecentEntries = useMemo(() => filterStaleRecent(recent, wikiTree), [recent, wikiTree]);
  const revealRecentEntryInTree = useCallback((entry: RecentEntry) => {
    const location = getRecentEntryRevealLocation(entry, libraryRoots);
    if (!location) return;
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      for (const id of getWikiSidebarExpansionIds(location.rootPath, location.relPath)) {
        next.add(id);
      }
      return next;
    });
    if (entry.kind === 'wiki') {
      onSelectItem({
        id: `wiki:${entry.path}`,
        title: entry.title,
        type: 'wiki',
        absPath: '',
        relPath: entry.path,
        timestamp: 0,
      });
      return;
    }
    onSelectItem({
      id: `external:${entry.path}`,
      title: entry.title,
      type: 'external',
      absPath: entry.path,
      timestamp: 0,
    });
  }, [libraryRoots, onSelectItem]);
  const isSearching = searchQuery.trim().length > 0;
  const { riverShortcutNode, visibleRoots: sidebarRootsWithoutPinnedRiver } = useMemo(
    () => isSearching
      ? { riverShortcutNode: null, visibleRoots: filteredSidebarRoots }
      : splitRiverShortcutNode(filteredSidebarRoots),
    [filteredSidebarRoots, isSearching],
  );
  const visibleSidebarRoots = useMemo(
    () => sidebarRootsWithoutPinnedRiver.filter((node) => node.id !== BOOKMARKS_ITEM_ID),
    [sidebarRootsWithoutPinnedRiver]
  );
  const bookmarksActionNode = useMemo(() => {
    const node = filteredSidebarRoots.find((item) => item.id === BOOKMARKS_ITEM_ID);
    return node?.kind === 'file' ? node : null;
  }, [filteredSidebarRoots]);
  const bookmarksActionItem = bookmarksActionNode?.item ?? null;
  const [bookmarkCount, setBookmarkCount] = useState<number | null>(() => peekBookmarks()?.bookmarks.length ?? null);
  useEffect(() => {
    if (!bookmarksActionItem) return;
    let cancelled = false;
    const applySnapshot = (snapshot: BookmarksSnapshot) => {
      if (!cancelled) setBookmarkCount(snapshot.bookmarks.length);
    };

    const cachedBookmarks = peekBookmarks();
    if (cachedBookmarks) applySnapshot(cachedBookmarks);
    void getBookmarks().then(applySnapshot);
    const unsubscribe = onBookmarksChanged(applySnapshot);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [bookmarksActionItem]);
  const newDocLocationOptions = useMemo(
    () => collectNewDocLocationOptions(visibleSidebarRoots),
    [visibleSidebarRoots]
  );
  const selectedNewDocLocation = useMemo(() => {
    if (newDocLocationOptions.length === 0) return null;
    const selected = newDocLocationOptions.find((option) => getLibraryCreateLocationKey(option.location) === newDocLocationKey);
    return selected ?? newDocLocationOptions.find((option) => option.location.relPath === SCRATCHPAD_FOLDER_NAME) ?? newDocLocationOptions[0];
  }, [newDocLocationKey, newDocLocationOptions]);
  const sidebarIconTargetIds = useMemo(() => {
    const ids = collectSidebarIconTargetIds(visibleSidebarRoots);
    if (!isSearching && selectedNewDocLocation) ids.push('new-doc:root');
    if (!isSearching && filteredRecentEntries.length > 0) {
      ids.push('recent:root');
      ids.push(...filteredRecentEntries.map((entry) => `recent-entry:${getRecentEntrySidebarId(entry)}`));
    }
    if (!isSearching && bookmarksActionItem) ids.push(BOOKMARKS_ITEM_ID);
    return ids;
  }, [bookmarksActionItem, filteredRecentEntries, isSearching, selectedNewDocLocation, visibleSidebarRoots]);

  const sidebarRowTopsRef = useRef<Map<string, number>>(new Map());
  useLayoutEffect(() => {
    const root = sidebarScrollRef.current;
    if (!root) return;
    const previousTops = sidebarRowTopsRef.current;
    const nextTops = new Map<string, number>();
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const suppressMoveAnimation = collapsingFileIds.size > 0;

    for (const node of root.querySelectorAll<HTMLElement>('[data-library-sidebar-row-id]')) {
      const rowId = node.dataset.librarySidebarRowId;
      if (!rowId) continue;
      const currentTop = node.offsetTop;
      nextTops.set(rowId, currentTop);
      if (suppressMoveAnimation || reduceMotion || typeof node.animate !== 'function') continue;

      const previousTop = previousTops.get(rowId);
      if (previousTop === undefined) continue;

      const keyframes = getRecentRowMoveKeyframes(previousTop, currentTop);
      if (!keyframes) continue;

      node.animate(keyframes, {
        duration: RECENT_ROW_MOVE_ANIMATION_MS,
        easing: RECENT_ROW_MOVE_ANIMATION_EASING,
      });
    }

    sidebarRowTopsRef.current = nextTops;
  }, [expandedFolders, filteredRecentEntries, filteredSidebarRoots, recentCollapsed, searchQuery, selectedNewDocLocation]);

  const allFlatItems = useMemo(() => collectSidebarItems(filteredSidebarRoots), [filteredSidebarRoots]);
  const flatItems = useMemo(() => collectSidebarItems(filteredSidebarRoots, false), [filteredSidebarRoots]);
  const navigationItems = useMemo(() => {
    const siblingItems = collectSidebarSiblingItems(filteredSidebarRoots, selectedId, false);
    return siblingItems.length > 0 ? siblingItems : flatItems;
  }, [filteredSidebarRoots, flatItems, selectedId]);
  if (flatItemsRef) flatItemsRef.current = navigationItems;

  const selectSidebarFileItem = useCallback((item: UnifiedItem, event: React.MouseEvent) => {
    onKeyboardScopeActive?.();
    if (event.metaKey && !event.shiftKey && !event.ctrlKey && !event.altKey && onOpenItemInNewWindow && canOpenSidebarItemInNewWindow(item)) {
      onOpenItemInNewWindow(item, { sidebarCollapsed: true });
      return;
    }
    const toggleSelection = event.ctrlKey;
    if (event.shiftKey && selectionAnchorId) {
      const anchorIndex = flatItems.findIndex((entry) => entry.id === selectionAnchorId);
      const itemIndex = flatItems.findIndex((entry) => entry.id === item.id);
      if (anchorIndex >= 0 && itemIndex >= 0) {
        const [start, end] = anchorIndex < itemIndex ? [anchorIndex, itemIndex] : [itemIndex, anchorIndex];
        updateSelectedFileIds(new Set(flatItems.slice(start, end + 1).map((entry) => entry.id)));
        onSelectItem(item);
        return;
      }
    }

    if (toggleSelection) {
      updateSelectedFileIds((prev) => {
        const next = new Set(prev);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
      setSelectionAnchorId(item.id);
      if (!selectedFileIds.has(item.id)) onSelectItem(item);
      return;
    }

    updateSelectedFileIds(new Set());
    setSelectionAnchorId(item.id);
    onSelectItem(item);
  }, [flatItems, onKeyboardScopeActive, onOpenItemInNewWindow, onSelectItem, selectedFileIds, selectionAnchorId, updateSelectedFileIds]);

  const getNextVisibleItemAfterMove = useCallback((targetIds: ReadonlySet<string>): UnifiedItem | null => {
    const findFallback = (sourceItems: UnifiedItem[]): UnifiedItem | null => {
      if (sourceItems.length === 0) return null;
      const targetIndexes = sourceItems
        .map((item, index) => targetIds.has(item.id) ? index : -1)
        .filter((index) => index >= 0);
      const selectedIndex = sourceItems.findIndex((item) => item.id === selectedId);
      const startIndex = targetIndexes.length > 0
        ? Math.min(...targetIndexes)
        : selectedIndex >= 0
          ? selectedIndex
          : 0;

      for (let index = startIndex; index < sourceItems.length; index += 1) {
        if (!targetIds.has(sourceItems[index].id)) return sourceItems[index];
      }
      for (let index = startIndex - 1; index >= 0; index -= 1) {
        if (!targetIds.has(sourceItems[index].id)) return sourceItems[index];
      }
      return null;
    };

    return findFallback(navigationItems) ?? findFallback(flatItems);
  }, [flatItems, navigationItems, selectedId]);

  const toggleSidebarItemSelection = useCallback((item: UnifiedItem) => {
    if (item.type === 'bookmarks') return;
    onKeyboardScopeActive?.();
    const next = new Set(selectedFileIdsRef.current);
    if (next.has(item.id)) next.delete(item.id);
    else next.add(item.id);
    selectedFileIdsRef.current = next;
    updateSelectedFileIds(next);
    setSelectionAnchorId(item.id);
  }, [onKeyboardScopeActive, updateSelectedFileIds]);

  const updateScrollJumpTarget = useCallback((clientY?: number, eventTarget?: EventTarget | null) => {
    const scroller = sidebarScrollRef.current;
    if (!scroller) {
      scrollJumpElementRef.current = null;
      setScrollJumpTarget(null);
      return;
    }
    const maxScrollTop = scroller.scrollHeight - scroller.clientHeight;
    if (maxScrollTop <= 2) {
      scrollJumpElementRef.current = null;
      setScrollJumpTarget(null);
      return;
    }
    const targetElement = eventTarget instanceof Element
      ? eventTarget.closest('[data-library-scroll-jump-control="true"]')
        ? scrollJumpElementRef.current
        : eventTarget.closest<HTMLElement>('[data-library-dir-node="true"]')
      : scrollJumpElementRef.current;
    if (!targetElement || !scroller.contains(targetElement)) {
      scrollJumpElementRef.current = null;
      setScrollJumpTarget(null);
      return;
    }
    scrollJumpElementRef.current = targetElement;
    const scrollerRect = scroller.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    const canJumpUp = targetRect.top < scrollerRect.top - 2;
    const canJumpDown = targetRect.bottom > scrollerRect.bottom + 2;
    if (clientY === undefined) {
      setScrollJumpTarget((current) => {
        if (current === 'top' && !canJumpUp) return null;
        if (current === 'bottom' && !canJumpDown) return null;
        return current;
      });
      return;
    }
    const y = clientY - scrollerRect.top;
    if (y < LIBRARY_SIDEBAR_SCROLL_JUMP_EDGE_DISTANCE && canJumpUp) {
      setScrollJumpTarget('top');
    } else if (y > scrollerRect.height - LIBRARY_SIDEBAR_SCROLL_JUMP_EDGE_DISTANCE && canJumpDown) {
      setScrollJumpTarget('bottom');
    } else {
      setScrollJumpTarget(null);
    }
  }, []);

  const handleSidebarMouseMove = useCallback((event: React.MouseEvent) => {
    const scroller = sidebarScrollRef.current;
    if (!scroller) return;
    const scrollerRect = scroller.getBoundingClientRect();
    const y = event.clientY - scrollerRect.top;
    if (
      !scrollJumpTarget
      && y >= LIBRARY_SIDEBAR_SCROLL_JUMP_EDGE_DISTANCE
      && y <= scrollerRect.height - LIBRARY_SIDEBAR_SCROLL_JUMP_EDGE_DISTANCE
    ) {
      return;
    }
    updateScrollJumpTarget(event.clientY, event.target);
  }, [scrollJumpTarget, updateScrollJumpTarget]);

  const updateSidebarTopFade = useCallback(() => {
    const scroller = sidebarScrollRef.current;
    setSidebarTopFadeVisible(Boolean(scroller && scroller.scrollTop > 2));
  }, []);

  const updatePinnedFolderFades = useCallback(() => {
    const scroller = sidebarScrollRef.current;
    const next = new Set<string>();
    if (scroller) {
      const scrollerTop = scroller.getBoundingClientRect().top;
      for (const header of scroller.querySelectorAll<HTMLElement>('[data-library-sticky-folder-id]')) {
        const id = header.dataset.libraryStickyFolderId;
        const folder = header.closest<HTMLElement>('[data-library-dir-node="true"]');
        if (!id || !folder) continue;
        if (isSidebarFolderHeaderPinned(
          scrollerTop,
          header.getBoundingClientRect().top,
          folder.getBoundingClientRect().top,
        )) {
          next.add(id);
        }
      }
    }
    setPinnedFolderFadeIds((current) => {
      if (current.size === next.size && [...current].every((id) => next.has(id))) return current;
      return next;
    });
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      updateScrollJumpTarget();
      updateSidebarTopFade();
      updatePinnedFolderFades();
    });
    return () => cancelAnimationFrame(id);
  }, [expandedFolders, filteredSidebarRoots, recent.length, searchQuery, updatePinnedFolderFades, updateScrollJumpTarget, updateSidebarTopFade]);

  const jumpSidebar = useCallback((target: 'top' | 'bottom') => {
    const scroller = sidebarScrollRef.current;
    const targetElement = scrollJumpElementRef.current;
    if (!scroller || !targetElement) return;
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const scrollerRect = scroller.getBoundingClientRect();
    const targetRect = targetElement.getBoundingClientRect();
    const nextScrollTop = target === 'top'
      ? scroller.scrollTop + targetRect.top - scrollerRect.top
      : scroller.scrollTop + targetRect.bottom - scrollerRect.bottom;
    scroller.scrollTop = Math.max(0, Math.min(maxScrollTop, nextScrollTop));
    scrollJumpElementRef.current = null;
    setScrollJumpTarget(null);
  }, []);

  const totalPages = countSidebarItems(sidebarRootsWithTodoOverrides);
  const visiblePages = flatItems.filter((item) => item.type !== 'bookmarks').length;

  const emptyWiki = visibleSidebarRoots.length === 0 && !bookmarksActionItem;
  const contextActiveNodeId = contextMenu?.node?.id ?? null;

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
  const contextHideBookmarks = contextFile?.type === 'bookmarks';
  const contextHideFolderId = contextHideBookmarks ? BOOKMARKS_SHORTCUT_FOLDER_ID : contextDefaultFolderId ?? contextUserFolderId;
  const contextHideDirLabel = contextHideBookmarks ? 'Hide Bookmarks' : contextDefaultFolderId ? 'Hide folder' : contextUserFolderId ? 'Remove from FT' : null;
  const canDeleteContextDir = !!contextDir?.canDeleteDir;
  const canDeleteContextFile = contextFile?.type === 'wiki' || contextFile?.type === 'artifact' || contextFile?.type === 'external';
  const canOpenContextFileInNewWindow = !!onOpenItemInNewWindow && canOpenSidebarItemInNewWindow(contextFile);
  const contextFolderFinderPath = getSidebarFolderFinderPath(contextDir);
  const canRenameContextFile = contextFile?.type === 'wiki' && !!contextFile.relPath;
  const canArchiveContextFile = contextFile?.type === 'wiki' || contextFile?.type === 'external';
  const archiveContextFileLabel = canArchiveContextFile ? (contextFile?.archived ? 'Unarchive' : 'Archive') : null;
  const multiContextItems = contextFile && selectedFileIds.has(contextFile.id) && selectedFileIds.size > 1
    ? allFlatItems.filter((item) => selectedFileIds.has(item.id))
    : [];
  const multiContextArchivableItems = multiContextItems.filter(isArchivableSidebarItem);
  const multiContextArchiveLabel = multiContextArchivableItems.length > 0
    ? (multiContextArchivableItems.every((item) => item.archived) ? 'Unarchive selected' : 'Archive selected')
    : null;
  const contextFileFinderPath = contextFile?.type !== 'bookmarks' ? contextFile?.absPath : undefined;
  const contextDirIsRiverShortcut = contextDir?.name === RIVER_SHARED_FOLDER_NAME || contextDir?.label === RIVER_SHARED_FOLDER_NAME;
  const contextPinTargetId = contextDirIsRiverShortcut ? null : contextDir?.id ?? (contextFile?.type !== 'bookmarks' ? contextFile?.id : null);
  const contextPinLabel = contextPinTargetId
    ? `${pinnedItemIds.has(contextPinTargetId) ? 'Unpin' : 'Pin'} ${contextDir ? 'folder' : 'doc'}`
    : null;
  const rootCreateLocation = getBuiltinCreateLocation('');
  const getExplicitSelectedItems = useCallback((): UnifiedItem[] => {
    const selectedIds = selectedFileIdsRef.current;
    if (selectedIds.size === 0) return [];
    return allFlatItems.filter((item) => selectedIds.has(item.id));
  }, [allFlatItems]);

  const getActionItems = useCallback((): UnifiedItem[] => {
    const explicitItems = getExplicitSelectedItems();
    if (explicitItems.length > 0) return explicitItems;
    const current = allFlatItems.find((item) => item.id === selectedId);
    return current ? [current] : [];
  }, [allFlatItems, getExplicitSelectedItems, selectedId]);

  const saveMarkdownItem = useCallback(async (
    target: ArchivableSidebarItem,
    transform: (content: string) => string,
    failureLabel: string,
  ): Promise<boolean> => {
    try {
      if (target.type === 'wiki') {
        if (!target.relPath) return false;
        const page = await window.wikiAPI?.getPage(target.relPath);
        if (!page) {
          setMoveError('Could not load file.');
          return false;
        }
        const nextContent = transform(page.content);
        const result = await window.wikiAPI?.save(
          target.relPath,
          nextContent,
          page.documentVersion,
        );
        if (!result?.ok) {
          setMoveError(`${failureLabel} failed.`);
          return false;
        }
        setMoveError(null);
        onSidebarItemContentChanged?.(target, nextContent, result.version);
        return true;
      }

      const file = await window.externalAPI?.open(target.absPath);
      if (!file) {
        setMoveError('Could not load file.');
        return false;
      }
      const nextContent = transform(file.content);
      const result = await window.externalAPI?.save(
        target.absPath,
        nextContent,
        file.documentVersion,
      );
      if (!result?.ok) {
        setMoveError(`${failureLabel} failed.`);
        return false;
      }
      setMoveError(null);
      onSidebarItemContentChanged?.(target, nextContent, result.version);
      return true;
    } catch (error) {
      setMoveError(error instanceof Error ? error.message : `${failureLabel} failed.`);
      return false;
    }
  }, [onSidebarItemContentChanged]);

  const toggleArchivedItems = useCallback(async (targets: ArchivableSidebarItem[]): Promise<boolean> => {
    if (targets.length === 0) return false;
    const nextArchived = targets.some((item) => !item.archived);
    const undoEntries: SidebarArchiveUndo['entries'] = [];

    for (const target of targets) {
      const previousArchived = !!target.archived;
      const success = await saveMarkdownItem(
        target,
        (content) => setMarkdownArchivedState(content, nextArchived),
        nextArchived ? 'Archive' : 'Unarchive',
      );
      if (success) undoEntries.push({ item: { ...target }, previousArchived });
    }

    if (undoEntries.length === 0) return false;
    const movedIds = new Set(undoEntries.map((entry) => entry.item.id));
    const fallbackItem = selectedId && movedIds.has(selectedId)
      ? getNextVisibleItemAfterMove(movedIds)
      : null;
    archiveUndoRef.current = { entries: undoEntries };
    updateSelectedFileIds(new Set());
    setSelectionAnchorId(null);
    setCollapsingFileIds(movedIds);
    await waitForSidebarCollapseAnimation();
    try {
      await loadTree('selected-files-archived');
    } finally {
      setCollapsingFileIds(new Set());
    }
    if (fallbackItem) onSelectItem(fallbackItem);
    return true;
  }, [getNextVisibleItemAfterMove, loadTree, onSelectItem, saveMarkdownItem, selectedId, updateSelectedFileIds]);

  const toggleSelectedArchive = useCallback(async (): Promise<boolean> => {
    const targets = getActionItems().filter(isArchivableSidebarItem);
    return toggleArchivedItems(targets);
  }, [getActionItems, toggleArchivedItems]);

  const undoArchive = useCallback(async (): Promise<boolean> => {
    const undo = archiveUndoRef.current;
    if (!undo) return false;
    let changed = false;
    for (const entry of undo.entries) {
      const success = await saveMarkdownItem(
        entry.item,
        (content) => setMarkdownArchivedState(content, entry.previousArchived),
        entry.previousArchived ? 'Archive' : 'Unarchive',
      );
      changed = changed || success;
    }
    if (!changed) return false;
    archiveUndoRef.current = null;
    await loadTree('selected-files-archive-undone');
    return true;
  }, [loadTree, saveMarkdownItem]);

  const cycleSelectedTodoState = useCallback(async (direction: 'forward' | 'backward'): Promise<boolean> => {
    const targets = getExplicitSelectedItems().filter(isArchivableSidebarItem);
    if (targets.length === 0) return false;
    const nextState = getNextSelectedTodoState(targets, direction);
    let changed = false;
    for (const target of targets) {
      const success = await saveMarkdownItem(
        target,
        (content) => setMarkdownTodoState(content, nextState),
        'Update task state',
      );
      changed = changed || success;
    }
    if (changed) await loadTree('selected-files-todo-state');
    return changed;
  }, [getExplicitSelectedItems, loadTree, saveMarkdownItem]);

  const setSelectedTodoState = useCallback(async (nextState: SidebarTodoState | null): Promise<boolean> => {
    const targets = getExplicitSelectedItems().filter(isArchivableSidebarItem);
    if (targets.length === 0) return false;
    let changed = false;
    for (const target of targets) {
      const success = await saveMarkdownItem(
        target,
        (content) => setMarkdownTodoState(content, nextState),
        'Update task state',
      );
      changed = changed || success;
    }
    if (changed) await loadTree('selected-files-todo-state');
    return changed;
  }, [getExplicitSelectedItems, loadTree, saveMarkdownItem]);

  const deleteItems = useCallback(async (targets: UnifiedItem[]): Promise<void> => {
    let deletedExternal = false;
    let deletedArtifact = false;
    const deletedWikiRelPaths: string[] = [];
    const deletedIds = new Set(targets.map((target) => target.id));
    const fallbackItem = selectedId && deletedIds.has(selectedId)
      ? getNextVisibleItemAfterMove(deletedIds)
      : null;

    for (const target of targets) {
      if (target.type === 'wiki') {
        if (!target.relPath) continue;
        const success = await window.wikiAPI?.deletePage(target.relPath);
        if (!success) continue;
        deletedWikiRelPaths.push(target.relPath);
        onDeletedItem?.(target);
      } else if (target.type === 'external') {
        const success = await window.externalAPI?.delete(target.absPath);
        if (!success) continue;
        deletedExternal = true;
        onDeletedItem?.(target);
      } else if (target.type === 'artifact') {
        const shareStatus = await window.librarianAPI?.getShareStatus(target.absPath);
        if (shareStatus?.shared) {
          await window.librarianAPI?.unshareReading(target.absPath);
        }
        const success = await window.librarianAPI?.deleteReading(target.absPath);
        if (!success) continue;
        deletedArtifact = true;
        onDeletedItem?.(target);
      }
    }

    if (deletedWikiRelPaths.length > 0) dispatchLocalWikiDeleted(deletedWikiRelPaths);
    if (deletedExternal) await loadTree('selected-files-deleted');
    if (deletedArtifact) await loadArtifacts();
    updateSelectedFileIds(new Set());
    setSelectionAnchorId(null);
    if (fallbackItem) onSelectItem(fallbackItem);
  }, [getNextVisibleItemAfterMove, loadArtifacts, loadTree, onDeletedItem, onSelectItem, selectedId, updateSelectedFileIds]);

  const deleteSelectedItems = useCallback((): boolean => {
    const targets = getExplicitSelectedItems().filter((item) => item.type === 'wiki' || item.type === 'external' || item.type === 'artifact');
    if (targets.length === 0) return false;
    confirmDelete({
      title: targets.length === 1 ? 'Delete selected item?' : `Delete ${targets.length} selected items?`,
      message: targets.length === 1
        ? `Move "${targets[0].title}" to Trash?`
        : `Move ${targets.length} selected items to Trash?`,
      confirmLabel: 'Move to Trash',
      force: targets.length > 1,
      onConfirm: () => deleteItems(targets),
    });
    return true;
  }, [confirmDelete, deleteItems, getExplicitSelectedItems]);

  const toggleFocusedSelection = useCallback((itemId?: string | null): boolean => {
    const targetId = itemId ?? selectedId;
    const target = allFlatItems.find((item) => item.id === targetId);
    if (!target || target.type === 'bookmarks') return false;
    onKeyboardScopeActive?.();
    const next = new Set(selectedFileIdsRef.current);
    if (next.has(target.id)) next.delete(target.id);
    else next.add(target.id);
    selectedFileIdsRef.current = next;
    updateSelectedFileIds(next);
    setSelectionAnchorId(target.id);
    return true;
  }, [allFlatItems, onKeyboardScopeActive, selectedId, updateSelectedFileIds]);

  const renameFocusedItem = useCallback((itemId?: string | null): boolean => {
    const targetId = itemId ?? selectedId;
    const target = allFlatItems.find((item) => item.id === targetId);
    if (target?.type !== 'wiki' || !target.relPath) return false;
    onKeyboardScopeActive?.();
    setRenameRequestId(target.id);
    return true;
  }, [allFlatItems, onKeyboardScopeActive, selectedId]);

  useEffect(() => {
    if (!archiveControllerRef) return;
    archiveControllerRef.current = {
      hasExplicitSelection: () => selectedFileIdsRef.current.size > 0,
      canArchiveSelected: () => getActionItems().some(isArchivableSidebarItem),
      hasArchiveUndo: () => archiveUndoRef.current !== null,
      toggleFocusedSelection,
      toggleSelectedArchive,
      undoArchive,
      cycleSelectedTodoState,
      deleteSelectedItems,
      renameFocusedItem,
    };
    return () => { archiveControllerRef.current = null; };
  }, [archiveControllerRef, cycleSelectedTodoState, deleteSelectedItems, getActionItems, renameFocusedItem, toggleFocusedSelection, toggleSelectedArchive, undoArchive]);

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

  const removeContextRoot = useCallback(() => {
    const target = contextDir;
    closeContextMenu();
    if (!target?.canRemoveRoot) return;
    setFolderConfirmation({
      title: 'Remove folder from FT?',
      message: `Remove "${target.label}" from Field Theory? The folder stays on disk.`,
      confirmLabel: 'Remove from FT',
      onConfirm: async () => {
        await window.libraryAPI?.removeRoot(target.rootPath);
        await loadTree();
      },
    });
  }, [closeContextMenu, contextDir, loadTree]);

  const hideContextDir = useCallback(() => {
    const folderId = contextHideFolderId;
    const targetLabel = contextHideBookmarks ? 'Bookmarks' : contextDir?.label ?? folderId;
    closeContextMenu();
    if (!folderId) return;

    setFolderConfirmation({
      title: contextHideBookmarks ? 'Hide Bookmarks?' : 'Hide folder?',
      message: `Hide "${targetLabel}" from the Library sidebar? You can restore it in Settings.`,
      confirmLabel: contextHideBookmarks ? 'Hide Bookmarks' : 'Hide folder',
      onConfirm: async () => {
        const previous = hiddenDefaultFolders;
        const optimistic = [...new Set([...previous, folderId])];
        setHiddenDefaultFolders(optimistic);

        try {
          const result = await window.libraryAPI?.setFolderHidden(folderId, true);
          setHiddenDefaultFolders(result ?? optimistic);
          await loadTree();
        } catch {
          setHiddenDefaultFolders(previous);
        }
      },
    });
  }, [closeContextMenu, contextDir, contextHideBookmarks, contextHideFolderId, hiddenDefaultFolders, loadTree]);

  const deleteContextFile = useCallback(() => {
    const target = contextFile;
    closeContextMenu();
    if (!target || (target.type !== 'wiki' && target.type !== 'artifact' && target.type !== 'external')) return;

    if (target.type === 'wiki') {
      if (!target.relPath) return;
      confirmDelete({
        title: 'Delete page?',
        message: `Move "${target.title}" to Trash?`,
        confirmLabel: 'Move to Trash',
        onConfirm: async () => {
          const success = await window.wikiAPI?.deletePage(target.relPath!);
          if (success) {
            dispatchLocalWikiDeleted(target.relPath!);
            onDeletedItem?.(target);
          }
        },
      });
      return;
    }

    if (target.type === 'external') {
      confirmDelete({
        title: 'Delete file?',
        message: `Move "${target.title}" to Trash?`,
        confirmLabel: 'Move to Trash',
        onConfirm: async () => {
          const success = await window.externalAPI?.delete(target.absPath);
          if (success) {
            onDeletedItem?.(target);
            await loadTree('external-file-deleted');
          }
        },
      });
      return;
    }

    confirmDelete({
      title: 'Delete artifact?',
      message: `Move "${target.title}" to Trash?`,
      confirmLabel: 'Move to Trash',
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
  }, [closeContextMenu, confirmDelete, contextFile, loadArtifacts, onDeletedItem]);

  const toggleContextFileArchived = useCallback(async () => {
    const target = contextFile;
    closeContextMenu();
    if (!isArchivableSidebarItem(target)) return;
    void toggleArchivedItems([target]);
  }, [closeContextMenu, contextFile, toggleArchivedItems]);

  const deleteContextDir = useCallback(() => {
    const target = contextDir;
    closeContextMenu();
    if (!target?.canDeleteDir) return;
    const deletedItems = collectSidebarItems(target.children).filter((item) => item.type !== 'bookmarks');
    setFolderConfirmation({
      title: 'Delete folder?',
      message: `Move "${target.label}"${deletedItems.length > 0 ? ` and ${deletedItems.length} file${deletedItems.length === 1 ? '' : 's'}` : ''} to Trash?`,
      confirmLabel: 'Move to Trash',
      danger: true,
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
        dispatchLocalWikiDeleted(deletedItems
          .filter((item) => item.type === 'wiki' && item.relPath)
          .map((item) => item.relPath!));
        await loadTree();
      },
    });
  }, [closeContextMenu, contextDir, loadTree, onDeletedItem]);

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

  const toggleContextPinned = useCallback(() => {
    const targetId = contextPinTargetId;
    closeContextMenu();
    if (!targetId) return;
    setPinnedItemIds((prev) => toggleSidebarPinnedItemIds(prev, targetId));
  }, [closeContextMenu, contextPinTargetId]);

  return (
    <div
      onContextMenu={(event) => openContextMenu(event, null)}
      onClick={closeContextMenu}
      onMouseMove={handleSidebarMouseMove}
      onMouseLeave={() => {
        scrollJumpElementRef.current = null;
        setScrollJumpTarget(null);
      }}
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}
    >
        <style>{`
          .bm-folder-header:hover .bm-new-file-btn { opacity: 0.7; }
          .bm-new-file-btn:hover { opacity: 1 !important; }
          .bm-file-row:not(.bm-file-row-selected):hover,
          .bm-file-row-context:not(.bm-file-row-selected) {
            background-color: ${getLibrarySidebarFileHoverBg(theme.isDark)};
          }
          .bm-file-row:hover .bm-show-finder-btn,
          .bm-file-row-context .bm-show-finder-btn {
            opacity: 0.7;
            pointer-events: auto;
          }
          .bm-show-finder-btn:hover {
            opacity: 1 !important;
            background-color: ${theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'} !important;
          }
        `}</style>
      <div
        ref={sidebarScrollRef}
        onScroll={() => {
          updateScrollJumpTarget();
          updateSidebarTopFade();
          updatePinnedFolderFades();
        }}
        style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}
      >
        <div style={{ padding: '0 10px 8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Tab' && e.ctrlKey && !e.altKey && !e.metaKey) {
                onSearchQueryChange('');
                e.currentTarget.blur();
                return;
              }
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
            data-fieldtheory-top-nav-search="true"
            style={{
              flex: '1 1 auto',
              minWidth: 0,
              height: '30px',
              boxSizing: 'border-box',
              padding: '0 10px',
              fontSize: '11px',
              color: theme.text,
              backgroundColor: theme.isDark ? 'rgba(255,255,255,0.055)' : 'rgba(255,255,255,0.55)',
              border: `1px solid ${theme.border}`,
              borderRadius: '6px',
              outline: 'none',
            }}
          />
          <button
            onClick={() => setSortMode(sortMode === 'alpha' ? 'time' : 'alpha')}
            style={{
              flex: '0 0 auto',
              minWidth: '48px',
              height: '30px',
              padding: '0 7px',
              fontSize: '10px',
              color: theme.textSecondary,
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              borderRadius: '6px',
              outline: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '3px',
              opacity: 0.7,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = theme.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7'; e.currentTarget.style.color = theme.textSecondary; }}
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

      {/* Page count */}
      <div style={{ padding: '0 12px 8px', fontSize: '10px', color: theme.textSecondary, opacity: 0.62, letterSpacing: 0 }}>
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

      {!isSearching && selectedNewDocLocation && (
        <NewDocShortcutBlock
          option={selectedNewDocLocation}
          theme={theme}
          iconColor={getSidebarIconColor('new-doc:root', theme.isDark ? SIDEBAR_DARK_ICON_COLOR : SIDEBAR_LIGHT_ICON_COLOR)}
          onOpen={() => beginCreateFile(selectedNewDocLocation.location)}
          onOpenIconColorPicker={(event) => openSidebarIconColorPicker('new-doc:root', event)}
          onOpenLocationPicker={openNewDocLocationPicker}
        />
      )}

      {!isSearching && filteredRecentEntries.length > 0 && (
        <RecentBlock
          recent={filteredRecentEntries}
          collapsed={recentCollapsed}
          onToggleCollapsed={() => setRecentCollapsed((value) => !value)}
          showDivider={false}
          selectedId={selectedId}
          theme={theme}
          getSidebarIconColor={getSidebarIconColor}
          onOpenIconColorPicker={openSidebarIconColorPicker}
          onRevealEntry={revealRecentEntryInTree}
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
          showTrailingDivider={!bookmarksActionItem}
        />
      )}

      {!isSearching && bookmarksActionItem && (
        <>
          <SidebarShortcutRow
            icon={<SidebarBookmarkIcon color={getSidebarIconColor(BOOKMARKS_ITEM_ID, theme.isDark ? SIDEBAR_DARK_ICON_COLOR : SIDEBAR_LIGHT_ICON_COLOR)} />}
            title={bookmarksActionItem.title}
            count={bookmarkCount ?? undefined}
            isSelected={selectedId === BOOKMARKS_ITEM_ID}
            theme={theme}
            indent={LIBRARY_SIDEBAR_EDGE_PADDING}
            fontWeight={500}
            rowId={BOOKMARKS_ITEM_ID}
            onIconClick={(event) => openSidebarIconColorPicker(BOOKMARKS_ITEM_ID, event)}
            onOpen={() => onSelectItem(bookmarksActionItem)}
            onContextMenu={(event) => {
              if (bookmarksActionNode) openContextMenu(event, bookmarksActionNode);
            }}
          />
          {riverShortcutNode && (
            <>
              <SidebarShortcutRow
                icon={<SidebarRiverIcon color={getSidebarIconColor(riverShortcutNode.id, theme.isDark ? SIDEBAR_DARK_ICON_COLOR : SIDEBAR_LIGHT_ICON_COLOR)} />}
                title={RIVER_SHORTCUT_LABEL}
                titleAttr={riverShortcutNode.label}
                count={countSidebarItems(riverShortcutNode.children)}
                isSelected={selectedId === riverShortcutNode.id}
                theme={theme}
                indent={LIBRARY_SIDEBAR_EDGE_PADDING}
                fontWeight={500}
                rowId={riverShortcutNode.id}
                trailing={<SidebarPeopleChipIcon color={theme.textSecondary} />}
                onIconClick={(event) => openSidebarIconColorPicker(riverShortcutNode.id, event)}
                onOpen={() => toggleFolder(riverShortcutNode.id)}
                onContextMenu={(event) => openContextMenu(event, riverShortcutNode)}
              />
              {expandedFolders.has(riverShortcutNode.id) && riverShortcutNode.children.map((child) => (
                <TreeNode
                  key={child.id}
                  node={child}
                  depth={1}
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
                  dropTargetId={dropTargetId}
                  setDropTargetId={setDropTargetId}
                  onMoveLibraryItem={moveLibraryItem}
                  theme={theme}
                  onSelectItem={selectSidebarFileItem}
                  onToggleItemSelection={toggleSidebarItemSelection}
                  selectedFileIds={selectedFileIds}
                  collapsingFileIds={collapsingFileIds}
                  contextActiveNodeId={contextActiveNodeId}
                  renameRequestId={renameRequestId}
                  onRenameRequestConsumed={() => setRenameRequestId(null)}
                  onContextMenu={openContextMenu}
                  onKeyboardScopeActive={onKeyboardScopeActive}
                  pinnedItemIds={pinnedItemIds}
                  pinnedFolderFadeIds={pinnedFolderFadeIds}
                  getSidebarIconColor={getSidebarIconColor}
                  getSidebarIconColorIndex={getSidebarIconColorIndex}
                  onOpenIconColorPicker={openSidebarIconColorPicker}
                  inheritedIconColorIndex={getSidebarIconColorIndex(riverShortcutNode.id)}
                />
              ))}
            </>
          )}
          <SidebarDivider theme={theme} />
        </>
      )}

      {emptyWiki ? (
        <div style={{ padding: '8px 12px', fontSize: '11px', color: theme.textSecondary }}>
          No pages yet. Run <code style={{ fontSize: '10px', background: theme.hoverBg, padding: '1px 4px', borderRadius: '3px' }}>ft sync && ft wiki</code> to generate.
        </div>
      ) : visibleSidebarRoots.length === 0 ? (
        <div style={{ padding: '8px 12px', fontSize: '11px', color: theme.textSecondary }}>
          No pages match that search.
        </div>
      ) : visibleSidebarRoots.map((node, index) => (
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
          dropTargetId={dropTargetId}
          setDropTargetId={setDropTargetId}
          onMoveLibraryItem={moveLibraryItem}
          theme={theme}
          onSelectItem={selectSidebarFileItem}
          onToggleItemSelection={toggleSidebarItemSelection}
          selectedFileIds={selectedFileIds}
          collapsingFileIds={collapsingFileIds}
          contextActiveNodeId={contextActiveNodeId}
          renameRequestId={renameRequestId}
          onRenameRequestConsumed={() => setRenameRequestId(null)}
          onContextMenu={openContextMenu}
          onKeyboardScopeActive={onKeyboardScopeActive}
          pinnedItemIds={pinnedItemIds}
          pinnedFolderFadeIds={pinnedFolderFadeIds}
          getSidebarIconColor={getSidebarIconColor}
          getSidebarIconColorIndex={getSidebarIconColorIndex}
          onOpenIconColorPicker={openSidebarIconColorPicker}
        />
      ))}

      {contextMenu && (
        <LibraryContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          theme={theme}
          multiSelectionCount={multiContextItems.length}
          multiArchiveLabel={multiContextArchiveLabel}
          canMarkSelectedTodo={multiContextArchivableItems.length > 0}
          canCreate={canCreateInContext}
          canRemoveRoot={!!contextDir?.canRemoveRoot}
          canShowFolderInFinder={!!contextFolderFinderPath}
          canRenameFile={canRenameContextFile}
          canOpenFileInNewWindow={canOpenContextFileInNewWindow}
          archiveFileLabel={archiveContextFileLabel}
          canCopyFilePath={!!contextFile && contextFile.type !== 'bookmarks'}
          canShowFileInFinder={!!contextFileFinderPath}
          canDeleteFile={canDeleteContextFile}
          pinLabel={contextPinLabel}
          pinIsFolder={!!contextDir && !!contextPinLabel}
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
          onOpenFileInNewWindow={() => {
            closeContextMenu();
            if (contextFile) onOpenItemInNewWindow?.(contextFile);
          }}
          onToggleArchiveFile={toggleContextFileArchived}
          onToggleMultiArchive={() => {
            closeContextMenu();
            void toggleSelectedArchive();
          }}
          onMarkSelectedTodo={(state) => {
            closeContextMenu();
            void setSelectedTodoState(state);
          }}
          onCopyFilePath={copyContextFilePath}
          onShowFileInFinder={showContextFileInFinder}
          onTogglePin={toggleContextPinned}
          onRemoveRoot={removeContextRoot}
          onHideDir={hideContextDir}
          onDeleteFile={deleteContextFile}
          onDeleteSelectedItems={() => {
            closeContextMenu();
            deleteSelectedItems();
          }}
          onDeleteDir={deleteContextDir}
        />
      )}
      {iconColorPicker && (
        <SidebarIconColorPicker
          x={iconColorPicker.x}
          y={iconColorPicker.y}
          theme={theme}
          colorOrder={iconColorOrder}
          selectedColorIndex={iconColorIndices[iconColorPicker.id]}
          onSelect={(colorIndex, applyToAll) => selectSidebarIconColor(
            iconColorPicker.id,
            colorIndex,
            applyToAll ? sidebarIconTargetIds : undefined,
          )}
          onReorder={setSidebarIconColorOrder}
          onClose={() => setIconColorPicker(null)}
        />
      )}
      {newDocLocationPicker && (
        <NewDocLocationPicker
          x={newDocLocationPicker.x}
          y={newDocLocationPicker.y}
          theme={theme}
          options={newDocLocationOptions}
          selectedKey={selectedNewDocLocation ? getLibraryCreateLocationKey(selectedNewDocLocation.location) : ''}
          iconColor={theme.isDark ? SIDEBAR_DARK_ICON_COLOR : SIDEBAR_LIGHT_ICON_COLOR}
          onSelect={selectNewDocLocation}
          onClose={() => setNewDocLocationPicker(null)}
        />
      )}
      {deleteConfirmationDialog}
      <LibraryFolderConfirmationDialog
        request={folderConfirmation}
        theme={theme}
        onClose={() => setFolderConfirmation(null)}
      />
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

        </div>
        {scrollJumpTarget && (
          <button
            type="button"
            data-library-scroll-jump-control="true"
            title={scrollJumpTarget === 'top' ? 'Jump to top' : 'Jump to bottom'}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              jumpSidebar(scrollJumpTarget);
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            style={{
              position: 'absolute',
              right: '10px',
              [scrollJumpTarget]: '8px',
              zIndex: 3,
              width: '28px',
              height: '24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: theme.textSecondary,
              backgroundColor: theme.isDark ? 'rgba(24,24,26,0.94)' : 'rgba(255,255,255,0.94)',
              border: `1px solid ${theme.border}`,
              borderRadius: '6px',
              boxShadow: theme.isDark ? '0 4px 12px rgba(0,0,0,0.28)' : '0 4px 12px rgba(0,0,0,0.12)',
              cursor: 'pointer',
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              {scrollJumpTarget === 'top'
                ? <path d="M8 3.25a.75.75 0 0 1 .53.22l4 4a.75.75 0 0 1-1.06 1.06L8.75 5.81V12a.75.75 0 0 1-1.5 0V5.81L4.53 8.53a.75.75 0 0 1-1.06-1.06l4-4A.75.75 0 0 1 8 3.25z" />
                : <path d="M8 12.75a.75.75 0 0 1-.53-.22l-4-4a.75.75 0 0 1 1.06-1.06l2.72 2.72V4a.75.75 0 0 1 1.5 0v6.19l2.72-2.72a.75.75 0 1 1 1.06 1.06l-4 4a.75.75 0 0 1-.53.22z" />}
            </svg>
          </button>
        )}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '28px',
            pointerEvents: 'none',
            zIndex: 2,
            opacity: sidebarTopFadeVisible ? 1 : 0,
            transition: 'opacity 120ms ease',
            background: `linear-gradient(to bottom, ${theme.bg} 0%, ${theme.bg}cc 45%, ${theme.bg}00 100%)`,
          }}
        />
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
  dropTargetId,
  setDropTargetId,
  onMoveLibraryItem,
  theme,
  onSelectItem,
  onToggleItemSelection,
  selectedFileIds,
  collapsingFileIds,
  contextActiveNodeId,
  renameRequestId,
  onRenameRequestConsumed,
  onContextMenu,
  onKeyboardScopeActive,
  pinnedItemIds,
  pinnedFolderFadeIds,
  getSidebarIconColor,
  getSidebarIconColorIndex,
  onOpenIconColorPicker,
  inheritedIconColorIndex,
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
  dropTargetId: string | null;
  setDropTargetId: (id: string | null) => void;
  onMoveLibraryItem: (item: LibraryDragItem, target: LibraryCreateLocation) => void | Promise<void>;
  theme: ReturnType<typeof useTheme>['theme'];
  onSelectItem: (item: UnifiedItem, event: React.MouseEvent) => void;
  onToggleItemSelection: (item: UnifiedItem) => void;
  selectedFileIds: Set<string>;
  collapsingFileIds: ReadonlySet<string>;
  contextActiveNodeId: string | null;
  renameRequestId: string | null;
  onRenameRequestConsumed: () => void;
  onContextMenu: (event: React.MouseEvent, node: SidebarNode | null) => void;
  onKeyboardScopeActive?: () => void;
  pinnedItemIds: ReadonlySet<string>;
  pinnedFolderFadeIds: ReadonlySet<string>;
  getSidebarIconColor: (id: string, fallbackColor: string) => string;
  getSidebarIconColorIndex: (id: string) => number | undefined;
  onOpenIconColorPicker: (id: string, event: React.MouseEvent<HTMLElement>) => void;
  inheritedIconColorIndex?: number;
}) {
  const [archiveExpanded, setArchiveExpanded] = useState(false);

  if (node.kind === 'file') {
    const isSel = node.item.id === selectedId;
    const explicitlySelected = selectedFileIds.has(node.item.id);
    const fileIconColorIndex = inheritedIconColorIndex ?? getSidebarIconColorIndex(node.id);
    const fallbackIconColor = theme.isDark ? SIDEBAR_DARK_ICON_COLOR : SIDEBAR_LIGHT_ICON_COLOR;
    return (
      <FileItem
        item={node.item}
        depth={depth}
        isPinned={pinnedItemIds.has(node.id)}
        isSelected={isSel || explicitlySelected}
        explicitlySelected={explicitlySelected}
        showSelectionMarker={selectedFileIds.size > 0 && node.item.type !== 'bookmarks'}
        isCollapsing={collapsingFileIds.has(node.item.id)}
        isContextActive={contextActiveNodeId === node.id}
        selectedKeyboardActive={selectedKeyboardActive}
        theme={theme}
        iconColor={getLibrarySidebarIconColor(fileIconColorIndex, fallbackIconColor)}
        onOpenIconColorPicker={(event) => onOpenIconColorPicker(node.id, event)}
        onSelect={(event) => onSelectItem(node.item, event)}
        onToggleSelection={() => onToggleItemSelection(node.item)}
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
  const { normalNodes, archivedNodes } = splitArchivedSidebarNodes(node.children, pinnedItemIds);
  const itemCount = countSidebarItems(node.children);
  const nodeCreateLocation = getSidebarNodeCreateLocation(node);
  const canDragDir = node.canDeleteDir && !(node.builtin && LIBRARY_DEFAULT_FOLDER_ID_SET.has(node.relPath));
  const isDropTarget = dropTargetId === node.id;
  const visibleChildren = normalNodes;
  const showChildGuide = isExpanded && (
    visibleChildren.length > 0 ||
    archivedNodes.length > 0
  );
  const dropBg = theme.isDark ? 'rgba(59,130,246,0.18)' : 'rgba(59,130,246,0.12)';
  const sidebarIconColor = theme.isDark ? SIDEBAR_DARK_ICON_COLOR : SIDEBAR_LIGHT_ICON_COLOR;
  const folderIconColorIndex = getSidebarIconColorIndex(node.id) ?? inheritedIconColorIndex;
  const folderIconColor = getLibrarySidebarIconColor(folderIconColorIndex, sidebarIconColor);
  const sidebarTextColor = theme.isDark ? SIDEBAR_DARK_TEXT_COLOR : SIDEBAR_LIGHT_TEXT_COLOR;
  const folderContextActive = contextActiveNodeId === node.id;
  const folderHoverBg = getLibrarySidebarFileHoverBg(theme.isDark);
  const folderBackgroundColor = isDropTarget ? dropBg : folderContextActive ? folderHoverBg : 'transparent';
  const stickyFolderBackgroundColor = depth === 0 ? theme.bg : folderBackgroundColor;
  const showPinnedFolderFade = shouldShowSidebarPinnedFolderFade(depth, isExpanded, pinnedFolderFadeIds.has(node.id));
  const getDroppableDragItem = (dataTransfer: DataTransfer): LibraryDragItem | null => {
    const item = getLibraryDragData(dataTransfer);
    return canDropLibraryItem(item, nodeCreateLocation) ? item : null;
  };

  return (
    <>
      <div data-library-dir-node="true" data-library-dir-id={node.id} style={{ position: 'relative' }}>
        <div
          className={`bm-folder-header${folderContextActive ? ' bm-folder-header-context' : ''}`}
          data-library-sidebar-row-id={node.id}
          data-library-sticky-folder-id={depth === 0 ? node.id : undefined}
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
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isDropTarget ? dropBg : folderHoverBg)}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = stickyFolderBackgroundColor)}
          style={{
            ...getSidebarFolderHeaderPositionStyle(depth),
            display: 'flex',
            alignItems: 'center',
            gap: SIDEBAR_ICON_TEXT_GAP,
            minHeight: LIBRARY_SIDEBAR_ROW_MIN_HEIGHT,
            margin: 0,
            padding: `${LIBRARY_SIDEBAR_ROW_PADDING_Y} ${LIBRARY_SIDEBAR_EDGE_PADDING}px ${LIBRARY_SIDEBAR_ROW_PADDING_Y} ${LIBRARY_SIDEBAR_EDGE_PADDING + depth * LIBRARY_SIDEBAR_DEPTH_INDENT}px`,
            cursor: 'pointer',
            fontSize: '12px',
            fontWeight: depth === 0 ? 500 : 400,
            lineHeight: LIBRARY_SIDEBAR_ROW_LINE_HEIGHT,
            color: sidebarTextColor,
            userSelect: 'none',
            backgroundColor: stickyFolderBackgroundColor,
            borderRadius: 0,
          }}
        >
          {showPinnedFolderFade && (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: '-18px',
                height: '18px',
                pointerEvents: 'none',
                background: `linear-gradient(to bottom, ${stickyFolderBackgroundColor} 0%, ${stickyFolderBackgroundColor}00 100%)`,
              }}
            />
          )}
            <SidebarIconButton label={`Change color for ${node.label}`} onClick={(event) => onOpenIconColorPicker(node.id, event)}>
              <SidebarFolderIcon color={folderIconColor} />
            </SidebarIconButton>
            <span style={{ flex: '0 1 auto', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>{node.label}</span>
            <SidebarCountPill count={itemCount} theme={theme} />
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
            <span aria-hidden="true" style={{ flex: '1 0 auto', minWidth: '8px' }} />
            {node.canCreateFile && (
              <button
                className="bm-new-file-btn"
                onClick={(e) => { e.stopPropagation(); beginCreateFile(nodeCreateLocation); }}
                title={node.name === SCRATCHPAD_FOLDER_NAME ? 'New scratchpad entry' : 'New file'}
                aria-label={`New file in ${node.label}`}
                style={{
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
            {pinnedItemIds.has(node.id) && (
              <span title="Pinned" aria-label="Pinned" style={{ color: theme.textSecondary, opacity: 0.56, flexShrink: 0 }}>
                <SidebarPinIcon />
              </span>
            )}
          </div>

      {showChildGuide && <span aria-hidden="true" style={getSidebarChildGuideStyle(depth, theme.isDark)} />}

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

      {isExpanded && visibleChildren.map((child, index) => (
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
          dropTargetId={dropTargetId}
          setDropTargetId={setDropTargetId}
          onMoveLibraryItem={onMoveLibraryItem}
          theme={theme}
          onSelectItem={onSelectItem}
          onToggleItemSelection={onToggleItemSelection}
          selectedFileIds={selectedFileIds}
          collapsingFileIds={collapsingFileIds}
          contextActiveNodeId={contextActiveNodeId}
          renameRequestId={renameRequestId}
          onRenameRequestConsumed={onRenameRequestConsumed}
          onContextMenu={onContextMenu}
          onKeyboardScopeActive={onKeyboardScopeActive}
          pinnedItemIds={pinnedItemIds}
          pinnedFolderFadeIds={pinnedFolderFadeIds}
          getSidebarIconColor={getSidebarIconColor}
          getSidebarIconColorIndex={getSidebarIconColorIndex}
          onOpenIconColorPicker={onOpenIconColorPicker}
          inheritedIconColorIndex={folderIconColorIndex}
        />
      ))}
      {isExpanded && archivedNodes.length > 0 && (
        <div
          onClick={(event) => {
            event.stopPropagation();
            setArchiveExpanded((expanded) => !expanded);
          }}
          style={{
            minHeight: LIBRARY_SIDEBAR_ROW_MIN_HEIGHT,
            boxSizing: 'border-box',
            padding: `${LIBRARY_SIDEBAR_ROW_PADDING_Y} ${LIBRARY_SIDEBAR_EDGE_PADDING}px ${LIBRARY_SIDEBAR_ROW_PADDING_Y} ${LIBRARY_SIDEBAR_EDGE_PADDING + (depth + 1) * LIBRARY_SIDEBAR_DEPTH_INDENT}px`,
            fontSize: '12px',
            lineHeight: LIBRARY_SIDEBAR_ROW_LINE_HEIGHT,
            color: theme.textSecondary,
            cursor: 'pointer',
            borderLeft: '2px solid transparent',
            opacity: 0.72,
            display: 'flex',
            alignItems: 'center',
            gap: SIDEBAR_ICON_TEXT_GAP,
          }}
          onMouseEnter={(event) => { event.currentTarget.style.backgroundColor = theme.hoverBg; }}
          onMouseLeave={(event) => { event.currentTarget.style.backgroundColor = 'transparent'; }}
        >
          <span
            aria-hidden="true"
            style={{
              flex: '0 0 14px',
              width: '14px',
              height: '14px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SidebarArchiveIcon color="currentColor" />
          </span>
          <span>{archiveExpanded ? 'Hide archive' : `Archive (${archivedNodes.length})`}</span>
        </div>
      )}
      {isExpanded && archiveExpanded && archivedNodes.map((child, index) => (
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
          dropTargetId={dropTargetId}
          setDropTargetId={setDropTargetId}
          onMoveLibraryItem={onMoveLibraryItem}
          theme={theme}
          onSelectItem={onSelectItem}
          onToggleItemSelection={onToggleItemSelection}
          selectedFileIds={selectedFileIds}
          collapsingFileIds={collapsingFileIds}
          contextActiveNodeId={contextActiveNodeId}
          renameRequestId={renameRequestId}
          onRenameRequestConsumed={onRenameRequestConsumed}
          onContextMenu={onContextMenu}
          onKeyboardScopeActive={onKeyboardScopeActive}
          pinnedItemIds={pinnedItemIds}
          pinnedFolderFadeIds={pinnedFolderFadeIds}
          getSidebarIconColor={getSidebarIconColor}
          getSidebarIconColorIndex={getSidebarIconColorIndex}
          onOpenIconColorPicker={onOpenIconColorPicker}
          inheritedIconColorIndex={folderIconColorIndex}
        />
      ))}
      </div>
    </>
  );
}

function LibraryFolderConfirmationDialog({
  request,
  theme,
  onClose,
}: {
  request: LibraryFolderConfirmationRequest | null;
  theme: ReturnType<typeof useTheme>['theme'];
  onClose: () => void;
}) {
  if (!request) return null;

  const confirmColor = request.danger ? '#dc2626' : theme.accent;

  return (
    <div
      role="presentation"
      onMouseDown={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.isDark ? 'rgba(0,0,0,0.36)' : 'rgba(0,0,0,0.18)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          width: 'min(360px, calc(100vw - 32px))',
          padding: '16px',
          borderRadius: '8px',
          border: `1px solid ${theme.border}`,
          backgroundColor: theme.surface2,
          boxShadow: theme.isDark ? '0 18px 48px rgba(0,0,0,0.5)' : '0 18px 48px rgba(0,0,0,0.2)',
        }}
      >
        <div style={{ fontSize: '14px', fontWeight: 600, color: theme.text, marginBottom: '8px' }}>
          {request.title}
        </div>
        <div style={{ fontSize: '12px', lineHeight: 1.45, color: theme.textSecondary, marginBottom: '14px' }}>
          {request.message}
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              height: '28px',
              padding: '0 10px',
              fontSize: '12px',
              color: theme.text,
              backgroundColor: 'transparent',
              border: `1px solid ${theme.border}`,
              borderRadius: '5px',
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              const pending = request;
              onClose();
              void pending.onConfirm();
            }}
            style={{
              height: '28px',
              padding: '0 10px',
              fontSize: '12px',
              color: '#fff',
              backgroundColor: confirmColor,
              border: `1px solid ${confirmColor}`,
              borderRadius: '5px',
              cursor: 'pointer',
            }}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function LibraryContextMenu({
  x,
  y,
  theme,
  multiSelectionCount = 0,
  multiArchiveLabel,
  canMarkSelectedTodo,
  canCreate,
  canRemoveRoot,
  canShowFolderInFinder,
  canRenameFile,
  canOpenFileInNewWindow,
  archiveFileLabel,
  canCopyFilePath,
  canShowFileInFinder,
  canDeleteFile,
  pinLabel,
  pinIsFolder,
  hideDirLabel,
  canDeleteDir,
  onNewFile,
  onNewFolder,
  onAddFolder,
  onShowFolderInFinder,
  onRenameFile,
  onOpenFileInNewWindow,
  onToggleArchiveFile,
  onToggleMultiArchive,
  onMarkSelectedTodo,
  onCopyFilePath,
  onShowFileInFinder,
  onTogglePin,
  onRemoveRoot,
  onHideDir,
  onDeleteFile,
  onDeleteSelectedItems,
  onDeleteDir,
}: {
  x: number;
  y: number;
  theme: ReturnType<typeof useTheme>['theme'];
  multiSelectionCount?: number;
  multiArchiveLabel?: string | null;
  canMarkSelectedTodo: boolean;
  canCreate: boolean;
  canRemoveRoot: boolean;
  canShowFolderInFinder: boolean;
  canRenameFile: boolean;
  canOpenFileInNewWindow: boolean;
  archiveFileLabel: string | null;
  canCopyFilePath: boolean;
  canShowFileInFinder: boolean;
  canDeleteFile: boolean;
  pinLabel: string | null;
  pinIsFolder: boolean;
  hideDirLabel: string | null;
  canDeleteDir: boolean;
  onNewFile: () => void;
  onNewFolder: () => void;
  onAddFolder: () => void;
  onShowFolderInFinder: () => void;
  onRenameFile: () => void;
  onOpenFileInNewWindow: () => void;
  onToggleArchiveFile: () => void;
  onToggleMultiArchive: () => void;
  onMarkSelectedTodo: (state: SidebarTodoState | null) => void;
  onCopyFilePath: () => void;
  onShowFileInFinder: () => void;
  onTogglePin: () => void;
  onRemoveRoot: () => void;
  onHideDir: () => void;
  onDeleteFile: () => void;
  onDeleteSelectedItems: () => void;
  onDeleteDir: () => void;
}) {
  const itemStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    minHeight: '28px',
    padding: '6px 10px',
    textAlign: 'left',
    fontSize: '12px',
    color: theme.text,
    background: 'transparent',
    border: 'none',
    borderRadius: '5px',
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
  const dividerStyle: React.CSSProperties = {
    height: '1px',
    margin: '5px 2px',
    backgroundColor: theme.border,
  };
  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: x,
    top: y,
    zIndex: 1000,
    minWidth: '196px',
    padding: '5px',
    backgroundColor: theme.surface2,
    border: `1px solid ${theme.border}`,
    borderRadius: '8px',
    boxShadow: theme.isDark ? '0 14px 34px rgba(0,0,0,0.48)' : '0 14px 34px rgba(0,0,0,0.16)',
  };
  const hasBottomFolderAction = canRemoveRoot || !!hideDirLabel;
  const hasBottomAction = hasBottomFolderAction || canDeleteDir || canDeleteFile;

  if (multiSelectionCount > 1) {
    return (
      <div
        onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        style={menuStyle}
      >
        <div style={{
          padding: '4px 10px 6px',
          fontSize: '10px',
          lineHeight: '14px',
          color: theme.textSecondary,
        }}>
          {multiSelectionCount} selected
        </div>
        {multiArchiveLabel && (
          <button style={itemStyle} onClick={onToggleMultiArchive} onMouseEnter={setHover} onMouseLeave={clearHover}>{multiArchiveLabel}</button>
        )}
        {canMarkSelectedTodo && (
          <>
            <button style={itemStyle} onClick={() => onMarkSelectedTodo('open')} onMouseEnter={setHover} onMouseLeave={clearHover}>Mark selected to do</button>
            <button style={itemStyle} onClick={() => onMarkSelectedTodo('done')} onMouseEnter={setHover} onMouseLeave={clearHover}>Mark selected done</button>
            <button style={itemStyle} onClick={() => onMarkSelectedTodo(null)} onMouseEnter={setHover} onMouseLeave={clearHover}>Clear task state</button>
          </>
        )}
        {(multiArchiveLabel || canMarkSelectedTodo) && <div style={dividerStyle} />}
        <button
          style={{ ...itemStyle, color: '#dc2626' }}
          onClick={onDeleteSelectedItems}
          onMouseEnter={(event) => setHover(event, true)}
          onMouseLeave={clearHover}
        >
          Delete selected
        </button>
      </div>
    );
  }

  return (
    <div
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      style={menuStyle}
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
      {pinLabel && pinIsFolder && (
        <button style={itemStyle} onClick={onTogglePin} onMouseEnter={setHover} onMouseLeave={clearHover}>{pinLabel}</button>
      )}
      <button style={itemStyle} onClick={onAddFolder} onMouseEnter={setHover} onMouseLeave={clearHover}>Add folder from path...</button>
      {canShowFolderInFinder && (
        <button style={itemStyle} onClick={onShowFolderInFinder} onMouseEnter={setHover} onMouseLeave={clearHover}>Show in Finder</button>
      )}
      {canRenameFile && (
        <button style={itemStyle} onClick={onRenameFile} onMouseEnter={setHover} onMouseLeave={clearHover}>Rename</button>
      )}
      {canOpenFileInNewWindow && (
        <button style={itemStyle} onClick={onOpenFileInNewWindow} onMouseEnter={setHover} onMouseLeave={clearHover}>Open in New Window</button>
      )}
      {archiveFileLabel && (
        <button style={itemStyle} onClick={onToggleArchiveFile} onMouseEnter={setHover} onMouseLeave={clearHover}>{archiveFileLabel}</button>
      )}
      {canCopyFilePath && (
        <button style={itemStyle} onClick={onCopyFilePath} onMouseEnter={setHover} onMouseLeave={clearHover}>Copy file path</button>
      )}
      {canShowFileInFinder && (
        <button style={itemStyle} onClick={onShowFileInFinder} onMouseEnter={setHover} onMouseLeave={clearHover}>Show in Finder</button>
      )}
      {pinLabel && !pinIsFolder && (
        <button style={itemStyle} onClick={onTogglePin} onMouseEnter={setHover} onMouseLeave={clearHover}>{pinLabel}</button>
      )}
      {hasBottomAction && <div style={dividerStyle} />}
      {canRemoveRoot && (
        <button style={itemStyle} onClick={onRemoveRoot} onMouseEnter={setHover} onMouseLeave={clearHover}>Remove from FT</button>
      )}
      {hideDirLabel && (
        <button style={itemStyle} onClick={onHideDir} onMouseEnter={setHover} onMouseLeave={clearHover}>{hideDirLabel}</button>
      )}
      {hasBottomFolderAction && (canDeleteDir || canDeleteFile) && <div style={dividerStyle} />}
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

function FileItem({
  item,
  depth = 0,
  isPinned,
  iconColor,
  isSelected,
  explicitlySelected,
  showSelectionMarker,
  isCollapsing,
  isContextActive,
  selectedKeyboardActive,
  theme,
  onOpenIconColorPicker,
  onSelect,
  onToggleSelection,
  onContextMenu,
  onKeyboardScopeActive,
  requestRename,
  onRenameRequestConsumed,
  draggable,
  refProp,
}: {
  item: UnifiedItem;
  depth?: number;
  isPinned: boolean;
  iconColor: string;
  isSelected: boolean;
  explicitlySelected: boolean;
  showSelectionMarker: boolean;
  isCollapsing: boolean;
  isContextActive: boolean;
  selectedKeyboardActive: boolean;
  theme: ReturnType<typeof useTheme>['theme'];
  onOpenIconColorPicker: (event: React.MouseEvent<HTMLElement>) => void;
  onSelect: (event: React.MouseEvent) => void;
  onToggleSelection: () => void;
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
  const icon = item.type === 'bookmarks'
    ? <SidebarBookmarkIcon color={iconColor} />
    : <SidebarMarkdownIcon color={iconColor} />;

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
  const selectedInSidebar = isSelected && selectedKeyboardActive;
  const selectedInDocument = isSelected && !selectedKeyboardActive;
  const documentSelectionColor = theme.isDark ? '#38bdf8' : '#0284c7';
  const rowSelected = selectedInSidebar || selectedInDocument;
  const fileHoverBg = getLibrarySidebarFileHoverBg(theme.isDark);
  const selectedSidebarBg = theme.isDark ? 'rgba(56,189,248,0.14)' : 'rgba(2,132,199,0.12)';
  const selectedDocumentBg = theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
  const contextSelectedBg = theme.isDark ? 'rgba(255,255,255,0.11)' : 'rgba(0,0,0,0.065)';
  const fileBackgroundColor = isContextActive
    ? (rowSelected ? contextSelectedBg : fileHoverBg)
    : selectedInSidebar
      ? selectedSidebarBg
      : selectedInDocument
        ? selectedDocumentBg
        : undefined;
  const horizontalPadding = canShowInFinder ? 28 : LIBRARY_SIDEBAR_EDGE_PADDING;
  const leftPadding = LIBRARY_SIDEBAR_EDGE_PADDING + depth * LIBRARY_SIDEBAR_DEPTH_INDENT;
  const rowPadding = isCollapsing
    ? `0 ${horizontalPadding}px 0 ${leftPadding}px`
    : `${LIBRARY_SIDEBAR_ROW_PADDING_Y} ${horizontalPadding}px ${LIBRARY_SIDEBAR_ROW_PADDING_Y} ${leftPadding}px`;
  const showTodoStateBadge = shouldShowSidebarTodoStateBadge(item, isCollapsing);
  const showOwnRiverShare = Boolean(item.sharedRiverCallsign);
  const sharedAuthorLabel = !showOwnRiverShare && item.sharedOriginalSourcePath
    ? item.sharedAuthorCallsign
    : undefined;
  const sharedAuthorTitle = sharedAuthorLabel ? `Shared by ${sharedAuthorLabel}` : undefined;
  const hasRightAlignedFileMeta = showOwnRiverShare || isPinned;
  const hasInlineFileMeta = Boolean(showOwnRiverShare || sharedAuthorLabel || isPinned || showTodoStateBadge || item.hasUnread);

  return (
    <div
      className={`bm-file-row${rowSelected ? ' bm-file-row-selected' : ''}${isContextActive ? ' bm-file-row-context' : ''}`}
      data-library-sidebar-row-id={item.id}
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
      style={{
        position: 'relative',
        minHeight: isCollapsing ? 0 : LIBRARY_SIDEBAR_ROW_MIN_HEIGHT,
        maxHeight: isCollapsing ? 0 : '40px',
        boxSizing: 'border-box',
        padding: rowPadding,
        cursor: 'pointer',
        backgroundColor: fileBackgroundColor,
        borderLeft: selectedInSidebar
          ? `2px solid ${documentSelectionColor}`
          : selectedInDocument
            ? `2px solid ${theme.textSecondary}`
            : '2px solid transparent',
        opacity: isCollapsing ? 0 : 1,
        transform: isCollapsing ? 'translateX(4px)' : 'translateX(0)',
        overflow: 'hidden',
        pointerEvents: isCollapsing ? 'none' : undefined,
        transition: 'background-color 0.1s ease, max-height 0.14s ease, min-height 0.14s ease, padding 0.14s ease, opacity 0.1s ease, transform 0.14s ease',
        outline: 'none',
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: SIDEBAR_ICON_TEXT_GAP,
        minHeight: LIBRARY_SIDEBAR_ROW_LINE_HEIGHT,
        width: '100%',
        minWidth: 0,
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
            {showSelectionMarker ? (
              <button
                type="button"
                aria-label={`${explicitlySelected ? 'Deselect' : 'Select'} ${item.title}`}
                aria-pressed={explicitlySelected}
                onMouseDown={(event) => {
                  event.stopPropagation();
                  onKeyboardScopeActive?.();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleSelection();
                }}
                style={{
                  width: '14px',
                  height: '14px',
                  padding: 0,
                  margin: 0,
                  flex: '0 0 14px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: explicitlySelected ? theme.accent : sidebarIconColor,
                  backgroundColor: explicitlySelected
                    ? (theme.isDark ? 'rgba(20,184,166,0.14)' : 'rgba(15,118,110,0.10)')
                    : 'transparent',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                }}
              >
                {explicitlySelected ? (
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path
                      d="M3.25 8.2 6.6 11.35 12.9 4.65"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : icon}
              </button>
            ) : (
              <SidebarIconButton label={`Change color for ${item.title}`} onClick={onOpenIconColorPicker}>
                {icon}
              </SidebarIconButton>
            )}
            <div style={{
              fontSize: '12px',
              fontWeight: 400,
              color: sidebarTextColor,
              lineHeight: LIBRARY_SIDEBAR_ROW_LINE_HEIGHT,
              ...(hasInlineFileMeta
                ? {
                  flex: '0 1 auto',
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }
                : librarySidebarFadeTextStyle(canShowInFinder ? LIBRARY_SIDEBAR_HOVER_FADE_WIDTH : LIBRARY_SIDEBAR_FADE_WIDTH)),
            }}>
              {item.title}
            </div>
            {sharedAuthorLabel && sharedAuthorTitle && (
              <SidebarSharedAuthorChip label={sharedAuthorLabel} theme={theme} title={sharedAuthorTitle} />
            )}
            {showTodoStateBadge && (
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
            {hasRightAlignedFileMeta && (
              <span aria-hidden="true" style={{ flex: '1 1 auto', minWidth: '8px' }} />
            )}
            {showOwnRiverShare && (
              <SidebarRiverShareIndicator theme={theme} />
            )}
            {isPinned && (
              <span title="Pinned" aria-label="Pinned" style={{ color: theme.textSecondary, opacity: 0.56, flexShrink: 0 }}>
                <SidebarPinIcon />
              </span>
            )}
          </>
        )}
        {canShowInFinder && (
          <button
            className="bm-show-finder-btn"
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
              opacity: 0,
              pointerEvents: 'none',
              transition: 'opacity 0.1s ease, background-color 0.1s ease',
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

function SidebarDivider({ theme }: {
  theme: ReturnType<typeof useTheme>['theme'];
}) {
  return (
    <hr
      style={getSidebarDividerStyle(theme.isDark)}
    />
  );
}

function SidebarChevron({
  expanded,
  color,
  size = 10,
  opacity = 0.72,
}: {
  expanded: boolean;
  color: string;
  size?: number;
  opacity?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        flex: `0 0 ${size}px`,
        color,
        opacity,
        transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
        transition: 'transform 0.12s ease',
      }}
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

function SidebarCountPill({
  count,
  theme,
}: {
  count: number;
  theme: ReturnType<typeof useTheme>['theme'];
}) {
  return (
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
      {count}
    </span>
  );
}

function SidebarPinIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <path d="M5.5 2.5h5l-1 4 2.5 2.5v1H9.1L8 14l-1.1-4H4V9l2.5-2.5-1-4Z" />
    </svg>
  );
}

function SidebarSharedAuthorChip({
  label,
  theme,
  title,
}: {
  label: string;
  theme: ReturnType<typeof useTheme>['theme'];
  title: string;
}) {
  return (
    <span
      aria-label={title}
      title={title}
      style={{
        flexShrink: 0,
        padding: '0 4px',
        borderRadius: '999px',
        fontSize: '7px',
        lineHeight: '10px',
        color: theme.isDark ? 'rgba(212,212,212,0.82)' : 'rgba(82,82,82,0.82)',
        backgroundColor: theme.isDark ? 'rgba(255,255,255,0.045)' : 'rgba(0,0,0,0.035)',
        border: `1px solid ${theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
        maxWidth: '64px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

function SidebarRiverShareIndicator({
  theme,
}: {
  theme: ReturnType<typeof useTheme>['theme'];
}) {
  const color = theme.isDark ? '#d4d4d4' : '#525252';
  return (
    <span
      aria-label="Shared to River"
      title="Shared to River"
      style={{
        flex: '0 0 14px',
        width: '14px',
        height: '14px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color,
      }}
    >
      <SidebarRiverIcon color="currentColor" style={{ opacity: 0.58 }} />
    </span>
  );
}

function SidebarPeopleChipIcon({ color }: { color: string }) {
  return (
    <span
      title="Shared River"
      aria-label="Shared River"
      style={{ color, opacity: 0.62, flexShrink: 0, display: 'inline-flex', alignItems: 'center' }}
    >
      <svg width="16" height="14" viewBox="0 0 18 16" fill="none" aria-hidden="true">
        <path
          d="M6.75 7.25a2.45 2.45 0 1 0 0-4.9 2.45 2.45 0 0 0 0 4.9zM2.55 13.15c.55-2.45 2.05-3.7 4.2-3.7s3.65 1.25 4.2 3.7"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
        <path
          d="M11.6 7.05a2.05 2.05 0 1 0 0-4.1M12.85 9.55c1.35.35 2.25 1.45 2.6 3.25"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

function SidebarNewDocIcon({ color }: { color: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ display: 'block', flexShrink: 0, color, opacity: 0.46 }}
    >
      <path d="M4.25 2.25h5.1l2.4 2.45v9.05h-7.5V2.25Z" />
      <path d="M9.25 2.5v2.35h2.25" />
      <path d="M5.9 8.2h4.2" />
      <path d="M5.9 10.4h3.3" />
    </svg>
  );
}

function SidebarIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick(event);
      }}
      style={{
        width: '14px',
        height: '14px',
        padding: 0,
        margin: 0,
        flex: '0 0 14px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'inherit',
        backgroundColor: 'transparent',
        border: 'none',
        borderRadius: '3px',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

function NewDocShortcutBlock({
  option,
  theme,
  iconColor,
  onOpen,
  onOpenIconColorPicker,
  onOpenLocationPicker,
}: {
  option: NewDocLocationOption;
  theme: ReturnType<typeof useTheme>['theme'];
  iconColor: string;
  onOpen: () => void;
  onOpenIconColorPicker: (event: React.MouseEvent<HTMLElement>) => void;
  onOpenLocationPicker: (event: React.MouseEvent<HTMLElement>) => void;
}) {
  const sidebarTextColor = theme.isDark ? SIDEBAR_DARK_TEXT_COLOR : SIDEBAR_LIGHT_TEXT_COLOR;
  return (
    <div
      onClick={onOpen}
      title={`New doc in ${option.pathLabel}`}
      style={{
        boxSizing: 'border-box',
        minHeight: LIBRARY_SIDEBAR_ROW_MIN_HEIGHT,
        padding: `${LIBRARY_SIDEBAR_ROW_PADDING_Y} ${LIBRARY_SIDEBAR_EDGE_PADDING}px`,
        fontSize: '12px',
        fontWeight: 500,
        lineHeight: LIBRARY_SIDEBAR_ROW_LINE_HEIGHT,
        color: sidebarTextColor,
        display: 'flex',
        alignItems: 'center',
        gap: SIDEBAR_ICON_TEXT_GAP,
        cursor: 'pointer',
        userSelect: 'none',
      }}
      onMouseEnter={(event) => { event.currentTarget.style.backgroundColor = theme.hoverBg; }}
      onMouseLeave={(event) => { event.currentTarget.style.backgroundColor = 'transparent'; }}
    >
      <SidebarIconButton label="Change color for New doc" onClick={onOpenIconColorPicker}>
        <SidebarNewDocIcon color={iconColor} />
      </SidebarIconButton>
      <span style={{ flex: '0 1 auto', minWidth: 0, whiteSpace: 'nowrap' }}>New doc</span>
      <span aria-hidden="true" style={{ flex: '1 0 auto', minWidth: '8px' }} />
      <button
        type="button"
        title="Choose new doc folder"
        aria-label="Choose new doc folder"
        onClick={(event) => {
          event.stopPropagation();
          onOpenLocationPicker(event);
        }}
        style={{
          maxWidth: '112px',
          minWidth: 0,
          flexShrink: 1,
          border: 'none',
          padding: 0,
          backgroundColor: 'transparent',
          color: theme.textSecondary,
          fontSize: '10px',
          fontStyle: 'italic',
          lineHeight: LIBRARY_SIDEBAR_ROW_LINE_HEIGHT,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          cursor: 'pointer',
          opacity: 0.52,
        }}
        onMouseEnter={(event) => { event.currentTarget.style.color = theme.text; }}
        onMouseLeave={(event) => { event.currentTarget.style.color = theme.textSecondary; }}
      >
        {option.pathLabel}
      </button>
    </div>
  );
}

function NewDocLocationPicker({
  x,
  y,
  theme,
  options,
  selectedKey,
  iconColor,
  onSelect,
  onClose,
}: {
  x: number;
  y: number;
  theme: ReturnType<typeof useTheme>['theme'];
  options: readonly NewDocLocationOption[];
  selectedKey: string;
  iconColor: string;
  onSelect: (option: NewDocLocationOption) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div
        aria-hidden="true"
        onMouseDown={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 999,
          backgroundColor: 'transparent',
        }}
      />
      <div
        role="menu"
        aria-label="Choose new doc folder"
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          position: 'fixed',
          left: x,
          top: y,
          zIndex: 1000,
          width: '188px',
          maxHeight: 'min(360px, calc(100vh - 32px))',
          overflowY: 'auto',
          padding: '6px',
          backgroundColor: theme.surface2,
          border: `1px solid ${theme.border}`,
          borderRadius: '8px',
          boxShadow: theme.isDark ? '0 14px 34px rgba(0,0,0,0.48)' : '0 14px 34px rgba(0,0,0,0.16)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '-8px',
            top: '50%',
            width: '8px',
            height: '1px',
            backgroundColor: theme.border,
          }}
        />
        {options.map((option) => {
          const isSelected = getLibraryCreateLocationKey(option.location) === selectedKey;
          return (
            <button
              key={option.id}
              type="button"
              role="menuitemradio"
              aria-checked={isSelected}
              onClick={() => onSelect(option)}
              style={{
                width: '100%',
                minHeight: '28px',
                padding: `6px 8px 6px ${8 + option.depth * 12}px`,
                border: 'none',
                borderRadius: '5px',
                backgroundColor: isSelected ? (theme.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.045)') : 'transparent',
                color: theme.text,
                display: 'flex',
                alignItems: 'center',
                gap: SIDEBAR_ICON_TEXT_GAP,
                cursor: 'pointer',
                textAlign: 'left',
              }}
              onMouseEnter={(event) => { event.currentTarget.style.backgroundColor = theme.hoverBg; }}
              onMouseLeave={(event) => {
                event.currentTarget.style.backgroundColor = isSelected
                  ? (theme.isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.045)')
                  : 'transparent';
              }}
            >
              <SidebarFolderIcon color={iconColor} />
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px', fontWeight: 500 }}>
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function SidebarIconColorPicker({
  x,
  y,
  theme,
  colorOrder,
  selectedColorIndex,
  onSelect,
  onReorder,
  onClose,
}: {
  x: number;
  y: number;
  theme: ReturnType<typeof useTheme>['theme'];
  colorOrder: readonly number[];
  selectedColorIndex?: number;
  onSelect: (colorIndex: number, applyToAll: boolean) => void;
  onReorder: (nextOrder: readonly number[]) => void;
  onClose: () => void;
}) {
  const [dragColorIndex, setDragColorIndex] = useState<number | null>(null);
  const [draftColorOrder, setDraftColorOrder] = useState<number[]>(() => normalizeLibrarySidebarIconColorOrder(colorOrder));
  const didDragRef = useRef(false);
  const draftColorOrderRef = useRef<number[]>(draftColorOrder);
  const dotRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  const previousDotTopsRef = useRef<Map<number, number>>(new Map());
  const pointerDragRef = useRef<{
    colorIndex: number;
    pointerId: number;
    startIndex: number;
    startY: number;
    rowHeight: number;
    startOrder: number[];
  } | null>(null);
  const orderedColors = draftColorOrder;

  useEffect(() => {
    if (dragColorIndex !== null) return;
    const nextOrder = normalizeLibrarySidebarIconColorOrder(colorOrder);
    draftColorOrderRef.current = nextOrder;
    setDraftColorOrder(nextOrder);
  }, [colorOrder, dragColorIndex]);

  const setDotRef = useCallback((colorIndex: number, node: HTMLButtonElement | null) => {
    if (node) dotRefs.current.set(colorIndex, node);
    else dotRefs.current.delete(colorIndex);
  }, []);

  const getDotRowHeight = useCallback((order: readonly number[], colorIndex: number) => {
    const currentIndex = order.indexOf(colorIndex);
    const currentNode = dotRefs.current.get(colorIndex);
    const nextNode = currentIndex >= 0 ? dotRefs.current.get(order[currentIndex + 1]) : null;
    const previousNode = currentIndex > 0 ? dotRefs.current.get(order[currentIndex - 1]) : null;
    if (currentNode && nextNode) return nextNode.offsetTop - currentNode.offsetTop;
    if (currentNode && previousNode) return currentNode.offsetTop - previousNode.offsetTop;
    return 28;
  }, []);

  const commitPointerDrag = useCallback((node: HTMLButtonElement, pointerId: number) => {
    if (!pointerDragRef.current || pointerDragRef.current.pointerId !== pointerId) return;
    if (didDragRef.current) onReorder(draftColorOrderRef.current);
    try {
      node.releasePointerCapture(pointerId);
    } catch {
      // Pointer capture may already be released if the window canceled the drag.
    }
    pointerDragRef.current = null;
    setDragColorIndex(null);
  }, [onReorder]);

  const cancelPointerDrag = useCallback((node: HTMLButtonElement, pointerId: number) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    if (didDragRef.current) {
      draftColorOrderRef.current = drag.startOrder;
      setDraftColorOrder(drag.startOrder);
    }
    try {
      node.releasePointerCapture(pointerId);
    } catch {
      // Pointer capture may already be released if the window canceled the drag.
    }
    pointerDragRef.current = null;
    setDragColorIndex(null);
  }, []);

  useLayoutEffect(() => {
    const previousTops = previousDotTopsRef.current;
    const nextTops = new Map<number, number>();
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    for (const colorIndex of orderedColors) {
      const node = dotRefs.current.get(colorIndex);
      if (!node) continue;
      const currentTop = node.offsetTop;
      nextTops.set(colorIndex, currentTop);
      if (reduceMotion || typeof node.animate !== 'function') continue;

      const previousTop = previousTops.get(colorIndex);
      if (previousTop === undefined) continue;

      const keyframes = getRecentRowMoveKeyframes(previousTop, currentTop);
      if (!keyframes) continue;

      node.animate(keyframes, {
        duration: RECENT_ROW_MOVE_ANIMATION_MS,
        easing: RECENT_ROW_MOVE_ANIMATION_EASING,
      });
    }

    previousDotTopsRef.current = nextTops;
  }, [orderedColors]);

  return (
    <>
      <div
        aria-hidden="true"
        onMouseDown={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 999,
          backgroundColor: 'transparent',
        }}
      />
      <div
        role="menu"
        aria-label="Choose icon color"
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          position: 'fixed',
          left: x,
          top: y,
          transform: 'translateY(-50%)',
          zIndex: 1000,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '6px',
          padding: '7px',
          backgroundColor: theme.surface2,
          border: `1px solid ${theme.border}`,
          borderRadius: '8px',
          boxShadow: theme.isDark ? '0 14px 34px rgba(0,0,0,0.48)' : '0 14px 34px rgba(0,0,0,0.16)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '-8px',
            top: '50%',
            width: '8px',
            height: '1px',
            backgroundColor: theme.border,
          }}
        />
        {orderedColors.map((colorIndex, index) => (
          <button
            key={colorIndex}
            ref={(node) => setDotRef(colorIndex, node)}
            type="button"
            role="menuitem"
            aria-label={`Use icon color ${index + 1}`}
            aria-pressed={selectedColorIndex === colorIndex}
            onClick={(event) => {
              if (didDragRef.current) {
                didDragRef.current = false;
                return;
              }
              onSelect(colorIndex, event.metaKey);
            }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              const order = draftColorOrderRef.current;
              pointerDragRef.current = {
                colorIndex,
                pointerId: event.pointerId,
                startIndex: order.indexOf(colorIndex),
                startY: event.clientY,
                rowHeight: getDotRowHeight(order, colorIndex),
                startOrder: order,
              };
              didDragRef.current = false;
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const drag = pointerDragRef.current;
              if (!drag || drag.pointerId !== event.pointerId) return;
              const targetIndex = getSidebarIconColorDragTargetIndex(
                drag.startIndex,
                drag.startY,
                event.clientY,
                drag.rowHeight,
                drag.startOrder.length,
              );
              const currentIndex = draftColorOrderRef.current.indexOf(drag.colorIndex);
              if (targetIndex === currentIndex) return;
              didDragRef.current = true;
              setDragColorIndex(drag.colorIndex);
              const nextOrder = reorderLibrarySidebarIconColorOrder(draftColorOrderRef.current, currentIndex, targetIndex);
              draftColorOrderRef.current = nextOrder;
              setDraftColorOrder(nextOrder);
            }}
            onPointerUp={(event) => {
              commitPointerDrag(event.currentTarget, event.pointerId);
            }}
            onPointerCancel={(event) => {
              cancelPointerDrag(event.currentTarget, event.pointerId);
            }}
            style={{
              width: '22px',
              height: '22px',
              boxSizing: 'border-box',
              padding: 0,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              borderRadius: '999px',
              backgroundColor: 'transparent',
              opacity: dragColorIndex === colorIndex ? 0.36 : 0.62,
              cursor: dragColorIndex === colorIndex ? 'grabbing' : 'default',
              outline: 'none',
              touchAction: 'none',
              boxShadow: selectedColorIndex === colorIndex
                ? `inset 0 0 0 1px ${theme.isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.16)'}`
                : undefined,
            }}
            onMouseEnter={(event) => {
              if (dragColorIndex !== colorIndex) event.currentTarget.style.opacity = '0.86';
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.opacity = dragColorIndex === colorIndex ? '0.36' : '0.62';
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: '16px',
                height: '16px',
                borderRadius: '999px',
                backgroundColor: LIBRARY_SIDEBAR_ICON_COLOR_PALETTE[colorIndex],
                boxShadow: `inset 0 0 0 1px ${theme.isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'}`,
              }}
            />
          </button>
        ))}
      </div>
    </>
  );
}

function SidebarShortcutRow({
  icon,
  title,
  count,
  titleAttr,
  meta,
  metaTitle,
  onMetaClick,
  isSelected,
  theme,
  indent = 10,
  fontWeight = 400,
  rowId,
  trailing,
  onIconClick,
  onOpen,
  onContextMenu,
}: {
  icon: React.ReactNode;
  title: string;
  count?: number;
  titleAttr?: string;
  meta?: string;
  metaTitle?: string;
  onMetaClick?: () => void;
  isSelected: boolean;
  theme: ReturnType<typeof useTheme>['theme'];
  indent?: number;
  fontWeight?: React.CSSProperties['fontWeight'];
  rowId?: string;
  trailing?: React.ReactNode;
  onIconClick?: (event: React.MouseEvent<HTMLElement>) => void;
  onOpen: () => void;
  onContextMenu?: (event: React.MouseEvent) => void;
}) {
  const sidebarTextColor = theme.isDark ? SIDEBAR_DARK_TEXT_COLOR : SIDEBAR_LIGHT_TEXT_COLOR;
  const titleStyle = count === undefined
    ? librarySidebarFadeTextStyle()
    : {
      flex: '0 1 auto',
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    };
  return (
    <div
      data-library-sidebar-row-id={rowId}
      onClick={onOpen}
      onContextMenu={onContextMenu}
      title={titleAttr}
      style={{
        boxSizing: 'border-box',
        minHeight: LIBRARY_SIDEBAR_ROW_MIN_HEIGHT,
        padding: `${LIBRARY_SIDEBAR_ROW_PADDING_Y} ${LIBRARY_SIDEBAR_EDGE_PADDING}px ${LIBRARY_SIDEBAR_ROW_PADDING_Y} ${indent}px`,
        fontSize: '12px',
        fontWeight,
        lineHeight: LIBRARY_SIDEBAR_ROW_LINE_HEIGHT,
        color: sidebarTextColor,
        display: 'flex',
        alignItems: 'center',
        gap: SIDEBAR_ICON_TEXT_GAP,
        cursor: 'pointer',
        userSelect: 'none',
        backgroundColor: isSelected ? (theme.isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)') : 'transparent',
        boxShadow: isSelected ? `inset 2px 0 0 ${theme.accent}` : undefined,
      }}
      onMouseEnter={(event) => { if (!isSelected) event.currentTarget.style.backgroundColor = theme.hoverBg; }}
      onMouseLeave={(event) => { if (!isSelected) event.currentTarget.style.backgroundColor = 'transparent'; }}
    >
      {onIconClick ? (
        <SidebarIconButton label={`Change color for ${title}`} onClick={onIconClick}>
          {icon}
        </SidebarIconButton>
      ) : icon}
      <span style={titleStyle}>{title}</span>
      {count !== undefined && <SidebarCountPill count={count} theme={theme} />}
      {trailing}
      {meta && (
        <button
          type="button"
          title={metaTitle}
          aria-label={metaTitle}
          onClick={(event) => {
            event.stopPropagation();
            onMetaClick?.();
          }}
          style={{
            maxWidth: '92px',
            minWidth: 0,
            flexShrink: 0,
            border: 'none',
            padding: 0,
            borderRadius: 0,
            color: theme.textSecondary,
            backgroundColor: 'transparent',
            fontSize: '10px',
            fontStyle: 'italic',
            lineHeight: LIBRARY_SIDEBAR_ROW_LINE_HEIGHT,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            cursor: onMetaClick ? 'pointer' : 'default',
            opacity: 0.52,
          }}
          onMouseEnter={(event) => { event.currentTarget.style.color = theme.text; }}
          onMouseLeave={(event) => { event.currentTarget.style.color = theme.textSecondary; }}
        >
          {meta}
        </button>
      )}
    </div>
  );
}

interface RecentBlockProps {
  recent: RecentEntry[];
  collapsed: boolean;
  onToggleCollapsed: () => void;
  showDivider?: boolean;
  showTrailingDivider?: boolean;
  selectedId: string | null;
  theme: ReturnType<typeof useTheme>['theme'];
  getSidebarIconColor: (id: string, fallbackColor: string) => string;
  onOpenIconColorPicker: (id: string, event: React.MouseEvent<HTMLElement>) => void;
  onRevealEntry: (entry: RecentEntry) => void;
  onOpenWiki: (relPath: string, title: string) => void;
  onOpenExternal: (absPath: string, title: string) => void;
}

function RecentBlock({ recent, collapsed, onToggleCollapsed, showDivider = true, showTrailingDivider = true, selectedId, theme, getSidebarIconColor, onOpenIconColorPicker, onRevealEntry, onOpenWiki, onOpenExternal }: RecentBlockProps) {
  const visibleRecent = splitRecent(recent);
  if (visibleRecent.total === 0) return null;
  const sidebarIconColor = theme.isDark ? SIDEBAR_DARK_ICON_COLOR : SIDEBAR_LIGHT_ICON_COLOR;
  const recentIconId = 'recent:root';
  const recentIconColor = getSidebarIconColor(recentIconId, sidebarIconColor);
  const sidebarTextColor = theme.isDark ? SIDEBAR_DARK_TEXT_COLOR : SIDEBAR_LIGHT_TEXT_COLOR;

  const headerStyle: React.CSSProperties = {
    boxSizing: 'border-box',
    minHeight: LIBRARY_SIDEBAR_ROW_MIN_HEIGHT,
    margin: 0,
    padding: `${LIBRARY_SIDEBAR_ROW_PADDING_Y} ${LIBRARY_SIDEBAR_EDGE_PADDING}px`,
    fontSize: '12px',
    fontWeight: 500,
    lineHeight: LIBRARY_SIDEBAR_ROW_LINE_HEIGHT,
    color: sidebarTextColor,
    display: 'flex',
    alignItems: 'center',
    gap: SIDEBAR_ICON_TEXT_GAP,
    cursor: 'pointer',
    userSelect: 'none',
    backgroundColor: 'transparent',
  };

  return (
    <div style={{ position: 'relative' }}>
      {showDivider && <SidebarDivider theme={theme} />}
      <div
        data-library-sidebar-row-id={recentIconId}
        style={headerStyle}
        onClick={onToggleCollapsed}
        onMouseEnter={(event) => { event.currentTarget.style.backgroundColor = theme.hoverBg; }}
        onMouseLeave={(event) => { event.currentTarget.style.backgroundColor = 'transparent'; }}
      >
        <SidebarIconButton label="Change color for Recents" onClick={(event) => onOpenIconColorPicker(recentIconId, event)}>
          <SidebarRecentIcon color={recentIconColor} />
        </SidebarIconButton>
        <span style={{ flex: '0 1 auto', minWidth: 0 }}>Recents</span>
        <SidebarCountPill count={visibleRecent.total} theme={theme} />
        <span aria-hidden="true" style={{ flex: '1 0 auto', minWidth: '8px' }} />
      </div>
      {!collapsed && visibleRecent.entries.length > 0 && <span aria-hidden="true" style={getSidebarChildGuideStyle(0, theme.isDark)} />}
      {!collapsed && visibleRecent.entries.map((e) => {
        const id = getRecentEntrySidebarId(e);
        const iconId = `recent-entry:${id}`;
        const isSel = selectedId === id;
        const parentLabel = getRecentEntryParentLabel(e);
        const parentPath = getRecentEntryParentPath(e);
        return (
          <SidebarShortcutRow
            key={id}
            icon={<SidebarMarkdownIcon color={getSidebarIconColor(iconId, sidebarIconColor)} />}
            title={e.title}
            titleAttr={e.kind === 'external' ? e.path : e.title}
            meta={parentPath}
            metaTitle={`Reveal in ${parentLabel}`}
            onMetaClick={() => onRevealEntry(e)}
            isSelected={isSel}
            theme={theme}
            indent={24}
            rowId={iconId}
            onIconClick={(event) => onOpenIconColorPicker(iconId, event)}
            onOpen={() => (e.kind === 'wiki' ? onOpenWiki(e.path, e.title) : onOpenExternal(e.path, e.title))}
          />
        );
      })}
      {showTrailingDivider && <SidebarDivider theme={theme} />}
    </div>
  );
}
