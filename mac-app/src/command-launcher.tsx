/**
 * Command Launcher UI
 *
 * A unified interface for both portable commands and built-in actions.
 * Shows a search input with the Field Theory icon. Items appear when typing.
 *
 * Keyboard controls:
 * - Type to filter commands and actions
 * - Arrow Up/Down to navigate
 * - Enter to select and invoke
 * - Escape to close
 */

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { flushSync } from 'react-dom';
import ReactDOM from 'react-dom/client';
import ScrollDiagnosticsHUD from './components/ScrollDiagnosticsHUD';
import { useInteractionFpsSampler } from './hooks/useInteractionFpsSampler';
import './utils/scrollDiagnostics.bootstrap';
import {
  buildBuiltInLauncherActions,
  DEFAULT_LAUNCHER_HOTKEYS,
  formatTimeAgo,
  SQUARES_ACTION_IDS,
  DEFAULT_SQUARES_HOTKEYS,
  flattenBookmarkTaxonomyRootsForLauncher,
  flattenLibraryDirectoriesForLauncher,
  flattenLibraryRootsForLauncher,
  filterLauncherDirectoryNamespaceItems,
  filterLauncherMoveTargetDirectories,
  filterLauncherNamespaceItems,
  filterLauncherNormalModeItems,
  buildBookmarkAuthorLauncherItems,
  buildBookmarkPostLauncherItems,
  buildCommandDirectoriesForLauncher,
  buildLauncherFileItems,
  LAUNCHER_NORMAL_MODE_MAX_RESULTS,
  DEFAULT_LAUNCHER_ROOT_SEARCH_ENABLED_KINDS,
  balanceLauncherNormalModeMatches,
  compareLauncherItemsByRecency,
  dedupeLauncherPersonItems,
  getLauncherClipboardSearchInputState,
  getLauncherFileSearchQuery,
  getLauncherFieldTheoryMarkdownTarget,
  getLauncherNativeIconPathForItem,
  getLauncherMoveDirectoryTarget,
  getLauncherMovedFilePath,
  getLauncherMoveUndoTargetDirRelPath,
  getLauncherAreaActionIdForQuery,
  getLauncherItemRecency,
  getLauncherUsageScore,
  getLauncherStatusText,
  getLauncherInvocationVisibilityPolicy,
  areLauncherRootSearchEnabledKindsEqual,
  areLauncherVisibleItemsSameOrder,
  isGeneratedBookmarkTaxonomyPath,
  isLauncherRootSearchKindEnabled,
  nextLauncherArrowIndex,
  normalizeLauncherRootSearchEnabledKinds,
  resolveHighlightedLauncherIndex,
  resolveLauncherAuthorNamespaceHandle,
  resolveLauncherBookmarkFacetNamespace,
  resolveLauncherCommandOpenTarget,
  resolveLauncherDirectoryNamespace,
  resolveLauncherFieldTheoryOpenTarget,
  shouldHandleLauncherPreviewShortcut,
  shouldIncludeLauncherLibraryMarkdownItem,
  shouldIncludeLauncherRecentFile,
  shouldExitLauncherClipboardSearch,
  shouldOfferLocalInstructionFallback,
  shouldPastePortableCommand,
  shouldReturnLauncherSelectionToInput,
  shouldTraceLauncherRendererEvent,
  warmLauncherSearchableItemCache,
  scoreLauncherSearchableItem,
  type LauncherFieldTheoryMarkdownTarget,
  type LauncherHotkeyMap,
  type LauncherDirectoryNamespace,
  type LauncherLibraryMoveSource,
  type LauncherMoveDirectoryTarget,
  type LauncherLibraryRoot,
  type LauncherRootSearchKind,
  type LauncherRootSearchEnabledKinds,
  type LauncherUsageMap,
} from './commandLauncherUtils';
import { normalizeSquaresConfig } from './utils/squaresConfig';
import {
  buildClipboardListRows,
  getStackHydrationIds,
  getStackItemsSignature,
} from './utils/clipboardStacks';
import {
  clipboardItemTypeIcon,
  getClipboardItemLauncherText,
  getClipboardRowImageItem,
  getClipboardRowPreviewContent,
  getClipboardStackLauncherText,
  type LauncherClipboardPreviewContent,
} from './utils/clipboardLauncher';
import type {
  ClipboardItem,
  ClipboardQueryOptions,
  ListRow,
  RunningApp as ClipboardRunningApp,
  StackInfo,
} from './types/clipboard';

// =============================================================================
// Types
// =============================================================================

interface PortableCommandInfo {
  name: string;
  displayName: string;
  filePath: string;
  lastModified: number;
}

interface PortableCommandDirectoryInfo {
  name: string;
  displayName: string;
  rootPath: string;
  directoryPath: string;
  directoryRelPath: string;
  lastModified: number;
}

interface LauncherFileInfo {
  name: string;
  displayName: string;
  filePath: string;
  isDirectory: boolean;
  lastModified: number;
}

interface LauncherFileSearchResult {
  files: LauncherFileInfo[];
  indexing: boolean;
  indexedAt: number | null;
}

interface LauncherFileIconResult {
  success: boolean;
  iconDataUrl?: string;
  error?: string;
}

interface LauncherSettings {
  rootSearchEnabledKinds: Record<string, boolean>;
}

interface HandoffInfo {
  name: string;
  displayName: string;
  filePath: string;
  lastModified: number;
}

type LauncherSourceId = 'wiki' | 'artifact' | 'bookmarks' | 'actions';

type LauncherItemType = 'command' | 'local-command' | 'local-instruction' | 'source' | 'action' | 'handoff' | 'recent-file' | 'wiki-page' | 'markdown-file' | 'artifact' | 'bookmark-author' | 'bookmark' | 'bookmark-facet' | 'directory' | 'file' | 'clipboard-item' | 'clipboard-stack';

interface LauncherRecentEntry {
  kind: 'wiki' | 'external';
  path: string;
  title: string;
  lastOpenedAt: number;
}

type BookmarkNamespace =
  | { kind: 'all'; label: string }
  | { kind: 'facet'; label: string; paths: string[] };

type MarkdownPreview = {
  title: string;
  filePath: string;
  content: string;
};

type ActiveWebPage = {
  url: string;
  title: string;
  bundleId: string;
  appName: string;
};

type LauncherCloseOptions = {
  skipActivation?: boolean;
  generation?: number;
};

type LauncherMeetingActionResult = {
  success: boolean;
  error?: string;
  openTarget?: FieldTheoryMarkdownTarget;
  summaryError?: string;
};

type LauncherResetPayload = {
  isDarkMode?: boolean;
  generation?: number;
};

type LauncherContextState = {
  fieldTheoryActive: boolean;
  hasActiveLibraryFileContext: boolean;
};

type LauncherPreviewPayload =
  | { kind: 'bookmark'; bookmark: Bookmark }
  | { kind: 'markdown'; title: string; filePath: string; content: string }
  | { kind: 'clipboard'; title: string; content: LauncherClipboardPreviewContent };

type LauncherLibraryMoveRecord = {
  source: LauncherLibraryMoveSource;
  target: LauncherMoveDirectoryTarget;
  movedRelPath: string;
};

interface LauncherItem {
  id: string;
  type: LauncherItemType;
  name: string;
  displayName: string;
  keywords: string[];
  hotkey?: string;
  hotkeyDisplay?: string;
  // For commands, handoffs, wiki pages, and artifacts
  filePath?: string;
  relPath?: string;
  isPinned?: boolean;
  lastUpdated?: number;
  recentKind?: LauncherRecentEntry['kind'];
  lastOpenedAt?: number;
  // For actions
  actionId?: string;
  // For source scopes
  sourceId?: LauncherSourceId;
  // For root search rows
  rootSearchKind?: LauncherRootSearchKind;
  rootSearchLabel?: string;
  isDirectory?: boolean;
  // For local model command runs
  localCommandName?: string;
  localInstruction?: string;
  // For handoffs - relative time display
  timeAgo?: string;
  // For bookmark authors
  authorHandle?: string;
  bookmarkCount?: number;
  // For bookmark facets
  facetPaths?: string[];
  // For directory namespaces
  rootPath?: string;
  directoryPath?: string;
  directoryRelPath?: string;
  // For bookmark posts
  bookmarkId?: string;
  postedAt?: string;
  // For clipboard list rows
  clipboardRow?: ListRow;
  clipboardItemId?: number;
  clipboardStackId?: string;
  clipboardSearch?: string;
}

function buildLocalInstructionFallbackItem(instruction: string): LauncherItem {
  return {
    id: 'local-instruction-fallback',
    type: 'local-instruction',
    name: instruction,
    displayName: `Run locally on this file: ${instruction}`,
    keywords: ['local', 'custom', 'instruction', instruction],
    localInstruction: instruction,
    hotkeyDisplay: 'local',
  };
}

const LAUNCHER_USAGE_STORAGE_KEY = 'launcherItemUsage.v1';
const LIBRARY_PINNED_ITEM_IDS_STORAGE_KEY = 'library-pinned-item-ids';

function readLibraryPinnedItemIds(): Set<string> {
  try {
    const raw = localStorage.getItem(LIBRARY_PINNED_ITEM_IDS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function isLibraryMarkdownLauncherItemPinned(item: Pick<LauncherItem, 'type' | 'filePath' | 'relPath'>, pinnedItemIds: ReadonlySet<string>): boolean {
  if (item.type === 'wiki-page' && item.relPath && pinnedItemIds.has(`wiki:${item.relPath}`)) return true;
  return Boolean(item.filePath && pinnedItemIds.has(`external:${item.filePath}`));
}

function readLauncherUsageMap(): LauncherUsageMap {
  try {
    const raw = localStorage.getItem(LAUNCHER_USAGE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as LauncherUsageMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeLauncherUsageMap(next: LauncherUsageMap): void {
  try {
    localStorage.setItem(LAUNCHER_USAGE_STORAGE_KEY, JSON.stringify(next));
  } catch {}
}

const NAMESPACE_PREFIXES = ['wiki', 'artifact', 'actions'] as const;
type NamespacePrefix = typeof NAMESPACE_PREFIXES[number];
type FieldTheoryMarkdownTarget = LauncherFieldTheoryMarkdownTarget;

// Window API types for the launcher's standalone renderer context.
// In the launcher window, these APIs are always available (not optional).
interface LauncherCommandsAPI {
  getCommands: () => Promise<PortableCommandInfo[]>;
  getCommandDirectories: () => Promise<PortableCommandDirectoryInfo[]>;
  onCommandsChanged?: (callback: (commands: PortableCommandInfo[]) => void) => () => void;
  getHandoffs: () => Promise<HandoffInfo[]>;
  getHandoffContent: (filePath: string) => Promise<{ name: string; content: string; filePath: string } | null>;
  getMarkdownPreview: (filePath: string) => Promise<MarkdownPreview | null>;
  invokeCommand: (name: string) => Promise<{ success: boolean; error?: string }>;
  getLauncherFileIcon: (filePath: string) => Promise<LauncherFileIconResult>;
  searchLauncherFiles: (query: string) => Promise<LauncherFileSearchResult>;
  openLauncherFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  warmLauncherFileIndex: () => Promise<{ started: boolean }>;
  getLauncherSettings: () => Promise<LauncherSettings>;
  setLauncherSettings: (settings: LauncherSettings) => Promise<LauncherSettings>;
  runLocalCommand: (request: string | {
    commandName?: string;
    customInstruction?: string;
    mode?: 'document' | 'selection';
    selection?: { start?: number; end?: number; text?: string } | null;
    useMemory?: boolean;
  }) => Promise<{ success: boolean; error?: string; filePath?: string; commandName?: string; mode?: 'document' | 'selection' }>;
  invokeHandoff: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  getLauncherContext: () => Promise<{ fieldTheoryActive: boolean; targetApp?: ClipboardRunningApp | null }>;
  getActiveLibraryFileContext?: () => Promise<LauncherLibraryMoveSource | null>;
  archiveActiveLibraryFile?: () => Promise<{ success: boolean; error?: string }>;
  toggleActiveLibraryLineNumbers?: () => Promise<{ success: boolean; error?: string }>;
  createMeetingNote?: (title?: string) => Promise<LauncherMeetingActionResult>;
  startMeetingHere?: () => Promise<LauncherMeetingActionResult>;
  stopMeeting?: () => Promise<LauncherMeetingActionResult>;
  summarizeCurrentMeeting?: () => Promise<LauncherMeetingActionResult>;
  openFieldTheoryMarkdown: (target: FieldTheoryMarkdownTarget) => Promise<{ success: boolean; error?: string }>;
  insertMarkdownText: (text: string) => Promise<{ success: boolean; error?: string }>;
  insertClipboardItemsAsMarkdown?: (ids: number[]) => Promise<{ success: boolean; error?: string }>;
  launcherResize: (height: number) => void;
  launcherClose: (options?: LauncherCloseOptions) => void;
  launcherTrace?: (event: string, details?: Record<string, unknown>) => void;
  launcherPreviewShow?: (preview: LauncherPreviewPayload) => void;
  launcherPreviewHide?: () => void;
  onLauncherReset: (callback: (payload?: LauncherResetPayload) => void) => () => void;
  onLauncherFocusInput?: (callback: (payload?: { generation?: number }) => void) => () => void;
}

interface LauncherClipboardAPI {
  queryItems: (options?: ClipboardQueryOptions) => Promise<ClipboardItem[]>;
  getItem?: (id: number) => Promise<ClipboardItem | null>;
  pasteItem: (id: number, targetBundleId?: string, useImproved?: boolean) => Promise<void>;
  pasteStack?: (ids: number[], targetBundleId?: string) => Promise<void>;
  queryItemsByStackId?: (stackId: string) => Promise<ClipboardItem[]>;
  getUniqueStacks?: () => Promise<StackInfo[]>;
  updateStackId?: (itemIds: number[], stackId: string | null) => Promise<void>;
  getHotkeys: () => Promise<{
    screenshot?: string;
    fullScreen?: string;
    activeWindow?: string;
    history?: string;
  }>;
  captureScreenshot: (region?: boolean) => Promise<number>;
}

interface LauncherTranscribeAPI {
  getHotkey: () => Promise<string>;
  toggleRecording: () => Promise<void>;
}

interface LauncherThemeAPI {
  initialTheme?: boolean;
  getTheme: () => Promise<boolean>;
  setTheme: (isDark: boolean) => Promise<void>;
  onThemeChanged?: (callback: (isDark: boolean) => void) => () => void;
}

interface LauncherLibraryAPI {
  getRoots: () => Promise<LauncherLibraryRoot[]>;
  moveItem?: (rootPath: string, kind: 'file' | 'dir', sourceRelPath: string, targetDirRelPath: string, targetRootPath?: string) => Promise<string | null>;
  onRootsChanged?: (callback: () => void) => () => void;
}

interface LauncherBookmarksAPI {
  getAll: () => Promise<BookmarksSnapshot>;
  getAuthors: () => Promise<BookmarkAuthorSummary[]>;
  getAuthorBookmarks: (handle: string) => Promise<Bookmark[]>;
  getTaxonomyBookmarks: (filePaths: string[]) => Promise<Bookmark[]>;
  getActiveWebPage?: () => Promise<{ success: boolean; page?: ActiveWebPage; error?: string }>;
  saveActiveWebPage?: () => Promise<{ success: boolean; page?: ActiveWebPage; bookmark?: Bookmark; markdownPath?: string; created?: boolean; error?: string }>;
  invokeBookmark: (id: string) => Promise<{ success: boolean; error?: string }>;
  invokeAuthorTimeline: (handle: string) => Promise<{ success: boolean; error?: string }>;
  onChanged?: (callback: () => void) => () => void;
}

interface LauncherRecentAPI {
  list: () => Promise<LauncherRecentEntry[]>;
  onChanged?: (callback: () => void) => () => void;
}

interface LauncherSquaresAPI {
  executeAction: (action: string, source?: 'default' | 'command-launcher') => Promise<boolean>;
  getHotkeys: () => Promise<Record<string, string>>;
  getConfig: () => Promise<{ showInCommandLauncher?: boolean }>;
  onConfigChanged?: (callback: (config: { showInCommandLauncher?: boolean }) => void) => () => void;
}

// Type-safe accessors for the launcher context
const commandsAPI = window.commandsAPI as unknown as LauncherCommandsAPI;
const clipboardAPI = window.clipboardAPI as unknown as LauncherClipboardAPI;
const transcribeAPI = window.transcribeAPI as unknown as LauncherTranscribeAPI;
const themeAPI = window.themeAPI as unknown as LauncherThemeAPI;
const squaresAPI = window.squaresAPI as unknown as LauncherSquaresAPI;
const libraryAPI = window.libraryAPI as unknown as LauncherLibraryAPI | undefined;
const bookmarksAPI = window.bookmarksAPI as unknown as LauncherBookmarksAPI | undefined;
const recentAPI = window.recentAPI as unknown as LauncherRecentAPI | undefined;

function traceLauncher(event: string, details: Record<string, unknown> = {}) {
  if (!shouldTraceLauncherRendererEvent(event, details)) return;
  commandsAPI.launcherTrace?.(event, details);
}

function getLauncherElapsedMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}

function traceLauncherLoad(
  event: string,
  startedAt: number,
  details: Record<string, unknown> = {},
): void {
  traceLauncher(event, {
    ...details,
    elapsedMs: getLauncherElapsedMs(startedAt),
  });
}

function describeLauncherItem(item: LauncherItem | undefined): Record<string, unknown> | null {
  if (!item) return null;
  return {
    id: item.id,
    type: item.type,
    displayName: item.displayName,
    actionId: item.actionId ?? null,
    sourceId: item.sourceId ?? null,
    filePath: item.filePath ?? null,
    relPath: item.relPath ?? null,
    authorHandle: item.authorHandle ?? null,
    bookmarkId: item.bookmarkId ?? null,
    directoryPath: item.directoryPath ?? null,
    clipboardItemId: item.clipboardItemId ?? null,
    clipboardStackId: item.clipboardStackId ?? null,
  };
}

function launcherItemTypeLabel(item: LauncherItem): string {
  const parentDirectoryLabel = (target: LauncherItem): string | null => {
    if (target.relPath) {
      const parent = target.relPath.split('/').slice(0, -1).join('/');
      if (parent) return parent;
    }
    if (target.filePath) {
      const normalized = target.filePath.replace(/\\/g, '/');
      const parts = normalized.split('/').filter(Boolean);
      const parentName = parts.length > 1 ? parts[parts.length - 2] : null;
      if (parentName) return parentName;
    }
    return null;
  };

  switch (item.type) {
    case 'command': return 'Command';
    case 'local-command': return 'Local';
    case 'local-instruction': return 'Local';
    case 'source': return 'Source';
    case 'file': return item.rootSearchLabel ?? 'File';
    case 'action': return 'Action';
    case 'recent-file': return 'Recent';
    case 'handoff': return 'Handoff';
    case 'wiki-page': return parentDirectoryLabel(item) ?? 'Wiki';
    case 'markdown-file': return parentDirectoryLabel(item) ?? 'Markdown';
    case 'artifact': return 'Artifact';
    case 'bookmark': return 'Bookmark';
    case 'bookmark-author': return 'Author';
    case 'bookmark-facet': return 'Topic';
    case 'directory': return 'Folder';
    case 'clipboard-item': return 'Clipboard';
    case 'clipboard-stack': return 'Stack';
    default: return 'Item';
  }
}

function compactLauncherUrl(rawUrl: string): string {
  let label = rawUrl.trim();
  try {
    const parsed = new URL(rawUrl);
    label = `${parsed.hostname.replace(/^www\./i, '')}${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}`;
  } catch {}
  if (label.length <= 72) return label;
  return `${label.slice(0, 36)}...${label.slice(-30)}`;
}

function getClipboardPreviewTitle(item: LauncherItem): string {
  if (item.type === 'clipboard-stack' && item.clipboardRow?.type === 'stack') {
    return `${item.clipboardRow.stack.itemCount} clipboard items`;
  }
  return item.displayName;
}

// =============================================================================
// Default Hotkeys
// =============================================================================

const DEFAULT_HOTKEYS = DEFAULT_LAUNCHER_HOTKEYS;
const LAUNCHER_COLLAPSED_HEIGHT = 52;
const LAUNCHER_MAX_LIST_HEIGHT = 378;
const LAUNCHER_BACKGROUND_REFRESH_DELAY_MS = 600;
const LAUNCHER_ICON_LOAD_DELAY_MS = 120;
const LAUNCHER_SEARCH_CACHE_WARM_DELAY_MS = 900;
const LAUNCHER_SEARCH_CACHE_WARM_CHUNK_DELAY_MS = 50;
const LAUNCHER_SEARCH_CACHE_WARM_CHUNK_SIZE = 400;
const COMMAND_LAUNCHER_RADIUS = 16;

// =============================================================================
// Styles (dynamic based on theme)
// =============================================================================

const getStyles = (isDark: boolean) => ({
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    backgroundColor: isDark ? '#1e1e1e' : '#fbfbfa',
    borderRadius: `${COMMAND_LAUNCHER_RADIUS}px`,
    height: '100vh',
    boxSizing: 'border-box' as const,
    overflow: 'hidden',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  inputRow: {
    display: 'flex',
    alignItems: 'center',
    minHeight: `${LAUNCHER_COLLAPSED_HEIGHT}px`,
    boxSizing: 'border-box' as const,
    padding: '13px 14px',
    gap: '9px',
  },
  icon: {
    width: '16px',
    height: 'auto',
    flexShrink: 0,
  },
  iconButton: {
    width: '16px',
    height: '16px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    margin: 0,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    flexShrink: 0,
  },
  input: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    fontSize: '12px',
    lineHeight: '16px',
    color: isDark ? '#fff' : '#171717',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  namespaceTag: {
    display: 'inline-flex',
    alignItems: 'center',
    height: '18px',
    padding: '0 6px',
    borderRadius: '4px',
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.06)',
    color: isDark ? '#f2f2f2' : '#242424',
    fontSize: '11px',
    fontFamily: 'SF Mono, Monaco, Menlo, monospace',
    flexShrink: 0,
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: '4px 0 8px 0',
    maxHeight: `${LAUNCHER_MAX_LIST_HEIGHT}px`,
    overflowY: 'auto' as const,
  },
  listItem: {
    minHeight: '30px',
    boxSizing: 'border-box' as const,
    padding: '6px 14px',
    cursor: 'pointer',
    color: isDark ? '#e0e0e0' : '#262626',
    fontSize: '12px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  listItemSelected: {
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.105)' : 'rgba(0, 0, 0, 0.07)',
    boxShadow: `inset 2px 0 0 ${isDark ? 'rgba(255, 255, 255, 0.44)' : 'rgba(0, 0, 0, 0.28)'}`,
  },
  listItemSelectedSoft: {
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.032)',
  },
  listItemCommitted: {
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.135)' : 'rgba(0, 0, 0, 0.085)',
    boxShadow: `inset 2px 0 0 ${isDark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(0, 0, 0, 0.4)'}`,
  },
  listItemClipboardSelected: {
    backgroundColor: isDark ? 'rgba(56, 189, 248, 0.13)' : 'rgba(2, 132, 199, 0.11)',
    boxShadow: `inset 3px 0 0 ${isDark ? 'rgba(56, 189, 248, 0.75)' : 'rgba(2, 132, 199, 0.7)'}`,
  },
  listItemClipboardDropTarget: {
    backgroundColor: isDark ? 'rgba(34, 197, 94, 0.14)' : 'rgba(22, 163, 74, 0.11)',
    boxShadow: `inset 3px 0 0 ${isDark ? 'rgba(34, 197, 94, 0.7)' : 'rgba(22, 163, 74, 0.65)'}`,
  },
  itemName: {
    flex: 1,
    fontWeight: 560,
    letterSpacing: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  itemIconSlot: {
    width: '24px',
    height: '22px',
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemIcon: {
    width: '16px',
    height: '16px',
    objectFit: 'contain' as const,
    display: 'block',
  },
  itemFallbackIcon: {
    width: '16px',
    height: '16px',
    borderRadius: '4px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    fontWeight: 700,
    lineHeight: 1,
    color: isDark ? 'rgba(255,255,255,0.82)' : 'rgba(17,17,17,0.78)',
    backgroundColor: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(0,0,0,0.07)',
  },
  clipboardThumbnail: {
    width: '24px',
    height: '20px',
    objectFit: 'cover' as const,
    display: 'block',
    borderRadius: '4px',
    border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)'}`,
  },
  clipboardTypeIcon: {
    width: '19px',
    height: '18px',
    borderRadius: '4px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '7px',
    fontWeight: 700,
    color: isDark ? '#d6d6d6' : '#343434',
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
    border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.1)'}`,
    letterSpacing: 0,
  },
  clipboardStackIcon: {
    width: '19px',
    height: '18px',
    borderRadius: '4px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    color: isDark ? '#d6d6d6' : '#343434',
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)',
    border: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.1)'}`,
  },
  itemHotkey: {
    fontSize: '10px',
    color: isDark ? '#777' : '#747474',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    flexShrink: 0,
  },
  itemMeta: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    flexShrink: 0,
  },
  itemTypeTag: {
    fontSize: '9px',
    lineHeight: '12px',
    padding: 0,
    color: isDark ? '#686868' : '#8a8a8a',
    backgroundColor: 'transparent',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    textTransform: 'none' as const,
    letterSpacing: 0,
  },
  emptyState: {
    padding: '9px 12px',
    color: isDark ? '#666' : '#777',
    fontSize: '12px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    textAlign: 'center' as const,
  },
  sectionHeader: {
    padding: '5px 12px 3px 14px',
    fontSize: '9px',
    lineHeight: '12px',
    color: isDark ? '#5f5f5f' : '#858585',
    textTransform: 'uppercase' as const,
    textAlign: 'right' as const,
    letterSpacing: '0.4px',
    fontWeight: 600,
    borderTop: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.08)'}`,
  },
});

// =============================================================================
// Main Component
// =============================================================================

function CommandLauncher() {
  const [query, setQuery] = useState('');
  const [namespacePrefix, setNamespacePrefix] = useState<NamespacePrefix | null>(null);
  const [directoryNamespace, setDirectoryNamespace] = useState<LauncherDirectoryNamespace | null>(null);
  const [authorNamespace, setAuthorNamespace] = useState<string | null>(null);
  const [bookmarkNamespace, setBookmarkNamespace] = useState<BookmarkNamespace | null>(null);
  const [moveSource, setMoveSource] = useState<LauncherLibraryMoveSource | null>(null);
  const [clipboardSearchActive, setClipboardSearchActive] = useState(false);
  const [lastLibraryMove, setLastLibraryMove] = useState<LauncherLibraryMoveRecord | null>(null);
  const [commands, setCommands] = useState<PortableCommandInfo[]>([]);
  const [commandDirectories, setCommandDirectories] = useState<PortableCommandDirectoryInfo[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffInfo[]>([]);
  const [launcherFiles, setLauncherFiles] = useState<LauncherFileInfo[]>([]);
  const [launcherFileSearchLoading, setLauncherFileSearchLoading] = useState(false);
  const [clipboardItems, setClipboardItems] = useState<ClipboardItem[]>([]);
  const [clipboardStacks, setClipboardStacks] = useState<StackInfo[]>([]);
  const [clipboardHydratedStackItemsById, setClipboardHydratedStackItemsById] = useState<Record<string, ClipboardItem[]>>({});
  const [clipboardSearchLoading, setClipboardSearchLoading] = useState(false);
  const [clipboardSelectedItemIds, setClipboardSelectedItemIds] = useState<Set<number>>(new Set());
  const [clipboardDragId, setClipboardDragId] = useState<string | null>(null);
  const [clipboardDropId, setClipboardDropId] = useState<string | null>(null);
  const [launcherRootSearchEnabledKinds, setLauncherRootSearchEnabledKinds] = useState<Record<LauncherRootSearchKind, boolean>>(
    DEFAULT_LAUNCHER_ROOT_SEARCH_ENABLED_KINDS,
  );
  const [recentEntries, setRecentEntries] = useState<LauncherRecentEntry[]>([]);
  const [hotkeys, setHotkeys] = useState<LauncherHotkeyMap>(DEFAULT_HOTKEYS);
  const [squaresHotkeys, setSquaresHotkeys] = useState<Record<string, string>>(DEFAULT_SQUARES_HOTKEYS);
  const [showSquaresInCommandLauncher, setShowSquaresInCommandLauncher] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState<boolean | null>(() => themeAPI.initialTheme ?? null);
  const [libraryMarkdownItems, setLibraryMarkdownItems] = useState<LauncherItem[]>([]);
  const [pinnedItemIds, setPinnedItemIds] = useState<Set<string>>(() => readLibraryPinnedItemIds());
  const [directoryItems, setDirectoryItems] = useState<LauncherItem[]>([]);
  const [artifactReadings, setArtifactReadings] = useState<LauncherItem[]>([]);
  const [bookmarkAuthorItems, setBookmarkAuthorItems] = useState<LauncherItem[]>([]);
  const [bookmarkFacetItems, setBookmarkFacetItems] = useState<LauncherItem[]>([]);
  const [authorBookmarkItems, setAuthorBookmarkItems] = useState<LauncherItem[]>([]);
  const [authorBookmarks, setAuthorBookmarks] = useState<Bookmark[]>([]);
  const [bookmarkNamespaceItems, setBookmarkNamespaceItems] = useState<LauncherItem[]>([]);
  const [bookmarkNamespaceBookmarks, setBookmarkNamespaceBookmarks] = useState<Bookmark[]>([]);
  const [bookmarkPostItems, setBookmarkPostItems] = useState<LauncherItem[]>([]);
  const [bookmarkPosts, setBookmarkPosts] = useState<Bookmark[]>([]);
  const [activeWebPage, setActiveWebPage] = useState<ActiveWebPage | null>(null);
  const [launcherDataLoading, setLauncherDataLoading] = useState(true);
  const [launcherActive, setLauncherActive] = useState(false);
  const [launcherSessionReady, setLauncherSessionReady] = useState(false);
  const [launcherContext, setLauncherContext] = useState<LauncherContextState>({
    fieldTheoryActive: false,
    hasActiveLibraryFileContext: false,
  });
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPayload, setPreviewPayload] = useState<LauncherPreviewPayload | null>(null);
  const [filtered, setFiltered] = useState<LauncherItem[]>([]);
  const [launcherIconDataByPath, setLauncherIconDataByPath] = useState<Record<string, string | null>>({});
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hasExplicitSelection, setHasExplicitSelection] = useState(false);
  const [committedItemId, setCommittedItemId] = useState<string | null>(null);
  const [usageByItemId, setUsageByItemId] = useState<LauncherUsageMap>(() => readLauncherUsageMap());
  const sampleLauncherInputInteraction = useInteractionFpsSampler('launcher-input');
  const filteredRef = useRef<LauncherItem[]>([]);
  const selectedIndexRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const authorNamespaceRef = useRef<string | null>(null);
  const bookmarkNamespaceRef = useRef<BookmarkNamespace | null>(null);
  const authorBookmarkRequestRef = useRef(0);
  const bookmarkNamespaceRequestRef = useRef(0);
  const activeWebPageRequestRef = useRef(0);
  const previewWindowWasOpenRef = useRef(false);
  const previewRequestRef = useRef(0);
  const launcherFirstInputTracedRef = useRef(false);
  const lastPreviewWindowPayloadKeyRef = useRef<string | null>(null);
  const launcherIconPendingPathsRef = useRef(new Set<string>());
  const launcherIconDataBatchRef = useRef<Record<string, string | null>>({});
  const launcherIconDataFlushFrameRef = useRef<number | null>(null);
  const launcherIconLoadTimeoutRef = useRef<number | null>(null);
  const launcherSearchCacheWarmTimeoutRef = useRef<number | null>(null);
  const launcherSearchCacheWarmIndexRef = useRef(0);
  const manualPreviewRef = useRef(false);
  const hasNavigatedRef = useRef(false); // Track if user has used arrow keys
  const hasExplicitSelectionRef = useRef(false);
  const launcherDataRequestRef = useRef(0);
  const launcherFileSearchRequestRef = useRef(0);
  const clipboardSearchRequestRef = useRef(0);
  const clipboardStackHydrationRequestRef = useRef(0);
  const launcherGenerationRef = useRef(0);
  const launcherActiveRef = useRef(false);
  const launcherBackgroundRefreshTimeoutRef = useRef<number | null>(null);
  const launcherBackgroundRefreshInFlightRef = useRef(false);
  const resizeFrameRef = useRef<number | null>(null);
  const resizeHeightRef = useRef<number>(LAUNCHER_COLLAPSED_HEIGHT);
  const launcherClosingForInvocationRef = useRef(false);

  const resizeLauncher = useCallback((height: number) => {
    const nextHeight = Math.max(LAUNCHER_COLLAPSED_HEIGHT, Math.round(height));
    if (resizeHeightRef.current === nextHeight) return;
    resizeHeightRef.current = nextHeight;
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current);
    }
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      commandsAPI.launcherResize(nextHeight);
      resizeFrameRef.current = null;
    });
  }, []);

  const applyTheme = useCallback((dark: boolean) => {
    setIsDarkMode(dark);
  }, []);

  useEffect(() => {
    launcherActiveRef.current = launcherActive;
  }, [launcherActive]);

  const noteItemUsage = useCallback((itemId: string) => {
    setUsageByItemId((prev) => {
      const existing = prev[itemId];
      const next: LauncherUsageMap = {
        ...prev,
        [itemId]: { count: (existing?.count ?? 0) + 1, lastUsedAt: Date.now() },
      };
      writeLauncherUsageMap(next);
      return next;
    });
  }, []);

  const selectIndex = useCallback((index: number) => {
    const nextIndex = Math.max(0, index);
    selectedIndexRef.current = nextIndex;
    setSelectedIndex(nextIndex);
  }, []);

  const selectExplicitItem = useCallback((index: number) => {
    hasExplicitSelectionRef.current = true;
    setHasExplicitSelection(true);
    selectIndex(index);
  }, [selectIndex]);

  const applyFilteredResults = useCallback((results: LauncherItem[]) => {
    if (areLauncherVisibleItemsSameOrder(filteredRef.current, results)) return false;
    filteredRef.current = results;
    setFiltered(results);
    return true;
  }, []);

  useEffect(() => {
    filteredRef.current = filtered;
  }, [filtered]);

  const showLauncherMessage = useCallback((message: string) => {
    setCommittedItemId(null);
    setClipboardSearchActive(false);
    setClipboardSelectedItemIds(new Set());
    setClipboardDragId(null);
    setClipboardDropId(null);
    setQuery(message);
    setFiltered([]);
    resizeLauncher(LAUNCHER_COLLAPSED_HEIGHT);
  }, [resizeLauncher]);

  const handleQueryChange = useCallback((nextQuery: string) => {
    if (!launcherFirstInputTracedRef.current) {
      launcherFirstInputTracedRef.current = true;
      traceLauncher('first-input', {
        queryLength: nextQuery.length,
        launcherDataLoading,
      });
    }
    sampleLauncherInputInteraction();
    setCommittedItemId(null);
    const next = getLauncherClipboardSearchInputState({
      active: clipboardSearchActive,
      query: nextQuery,
    });
    setClipboardSearchActive(next.active);
    setQuery(next.query);
  }, [clipboardSearchActive, launcherDataLoading, sampleLauncherInputInteraction]);

  const focusLauncherInput = useCallback(() => {
    inputRef.current?.focus();
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
  }, []);

  // Load commands from the filesystem.
  const loadCommands = useCallback(async () => {
    const startedAt = performance.now();
    try {
      const [cmds, directories] = await Promise.all([
        commandsAPI.getCommands(),
        commandsAPI.getCommandDirectories(),
      ]);
      const nextCommands = cmds || [];
      const nextDirectories = directories || [];
      setCommands(nextCommands);
      setCommandDirectories(nextDirectories);
      traceLauncherLoad('load-commands', startedAt, {
        commandCount: nextCommands.length,
        directoryCount: nextDirectories.length,
      });
    } catch (err) {
      traceLauncherLoad('load-commands', startedAt, { success: false });
      console.error('[CommandLauncher] Failed to load commands:', err);
    }
  }, []);

  const loadLauncherSettings = useCallback(async () => {
    const startedAt = performance.now();
    try {
      const settings = await commandsAPI.getLauncherSettings();
      const normalized = normalizeLauncherRootSearchEnabledKinds(settings?.rootSearchEnabledKinds as LauncherRootSearchEnabledKinds);
      setLauncherRootSearchEnabledKinds(prev => (
        areLauncherRootSearchEnabledKindsEqual(prev, normalized) ? prev : normalized
      ));
      traceLauncherLoad('load-launcher-settings', startedAt);
    } catch (err) {
      traceLauncherLoad('load-launcher-settings', startedAt, { success: false });
      console.error('[CommandLauncher] Failed to load launcher settings:', err);
      setLauncherRootSearchEnabledKinds(prev => (
        areLauncherRootSearchEnabledKindsEqual(prev, DEFAULT_LAUNCHER_ROOT_SEARCH_ENABLED_KINDS)
          ? prev
          : DEFAULT_LAUNCHER_ROOT_SEARCH_ENABLED_KINDS
      ));
    }
  }, []);

  const warmLauncherFileIndex = useCallback(async () => {
    if (!isLauncherRootSearchKindEnabled(launcherRootSearchEnabledKinds, 'file')) return;
    const startedAt = performance.now();
    try {
      const result = await commandsAPI.warmLauncherFileIndex();
      traceLauncherLoad('warm-file-index', startedAt, { started: Boolean(result?.started) });
    } catch (err) {
      traceLauncherLoad('warm-file-index', startedAt, { success: false });
      console.error('[CommandLauncher] Failed to warm file index:', err);
    }
  }, [launcherRootSearchEnabledKinds]);

  const loadLibraryMarkdown = useCallback(async () => {
    const startedAt = performance.now();
    try {
      const roots = await libraryAPI?.getRoots();
      if (roots) {
        const nextLibraryItems = flattenLibraryRootsForLauncher(roots);
        const nextDirectoryItems = flattenLibraryDirectoriesForLauncher(roots);
        const nextBookmarkFacetItems = flattenBookmarkTaxonomyRootsForLauncher(roots);
        setLibraryMarkdownItems(nextLibraryItems);
        setDirectoryItems(nextDirectoryItems);
        setBookmarkFacetItems(nextBookmarkFacetItems);
        traceLauncherLoad('load-library-markdown', startedAt, {
          rootCount: roots.length,
          itemCount: nextLibraryItems.length,
          directoryCount: nextDirectoryItems.length,
          bookmarkFacetCount: nextBookmarkFacetItems.length,
        });
        return;
      }
      traceLauncherLoad('load-library-markdown', startedAt, { rootCount: 0 });
    } catch {
      traceLauncherLoad('load-library-markdown', startedAt, { success: false });
    }
  }, []);

  const loadArtifacts = useCallback(async () => {
    const startedAt = performance.now();
    try {
      const readings = await window.librarianAPI?.getReadings();
      if (!readings) {
        traceLauncherLoad('load-artifacts', startedAt, { itemCount: 0 });
        return;
      }
      const nextReadings = readings.map(r => ({
        id: `artifact-${r.path}`,
        type: 'artifact' as const,
        name: r.title,
        displayName: r.title,
        keywords: [r.title, r.context ?? '', ...r.title.split(/\s+/)].filter(Boolean),
        filePath: r.path,
        lastUpdated: r.mtime,
      }));
      setArtifactReadings(nextReadings);
      traceLauncherLoad('load-artifacts', startedAt, { itemCount: nextReadings.length });
    } catch {
      traceLauncherLoad('load-artifacts', startedAt, { success: false });
    }
  }, []);

  const loadRecentEntries = useCallback(async () => {
    const startedAt = performance.now();
    try {
      const entries = await recentAPI?.list();
      const nextEntries = (entries ?? []).slice().sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
      setRecentEntries(nextEntries);
      traceLauncherLoad('load-recents', startedAt, { itemCount: nextEntries.length });
    } catch {
      setRecentEntries([]);
      traceLauncherLoad('load-recents', startedAt, { success: false });
    }
  }, []);

  const loadBookmarkAuthors = useCallback(async () => {
    const startedAt = performance.now();
    try {
      const authors = await bookmarksAPI?.getAuthors();
      const nextAuthors = buildBookmarkAuthorLauncherItems(authors ?? []);
      setBookmarkAuthorItems(nextAuthors);
      traceLauncherLoad('load-bookmark-authors', startedAt, { itemCount: nextAuthors.length });
    } catch {
      traceLauncherLoad('load-bookmark-authors', startedAt, { success: false });
    }
  }, []);

  const loadBookmarkPosts = useCallback(async () => {
    const startedAt = performance.now();
    try {
      const snapshot = await bookmarksAPI?.getAll();
      const bookmarks = (snapshot?.bookmarks ?? [])
        .sort((a, b) => {
          const aTime = new Date(a.savedAt ?? a.postedAt).getTime();
          const bTime = new Date(b.savedAt ?? b.postedAt).getTime();
          return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
        });
      setBookmarkPosts(bookmarks);
      const nextBookmarkPosts = buildBookmarkPostLauncherItems(bookmarks);
      setBookmarkPostItems(nextBookmarkPosts);
      traceLauncherLoad('load-bookmark-posts', startedAt, {
        bookmarkCount: bookmarks.length,
        itemCount: nextBookmarkPosts.length,
      });
    } catch {
      setBookmarkPosts([]);
      setBookmarkPostItems([]);
      traceLauncherLoad('load-bookmark-posts', startedAt, { success: false });
    }
  }, []);

  const loadActiveWebPage = useCallback(async () => {
    const requestId = ++activeWebPageRequestRef.current;
    const startedAt = performance.now();
    try {
      const result = await bookmarksAPI?.getActiveWebPage?.();
      if (requestId !== activeWebPageRequestRef.current) return;
      setActiveWebPage(result?.success && result.page ? result.page : null);
      traceLauncherLoad('load-active-web-page', startedAt, {
        hasPage: Boolean(result?.success && result.page),
      });
    } catch {
      if (requestId !== activeWebPageRequestRef.current) return;
      setActiveWebPage(null);
      traceLauncherLoad('load-active-web-page', startedAt, { success: false });
    }
  }, []);

  const refreshLauncherContext = useCallback(async () => {
    const startedAt = performance.now();
    const activeLibraryFilePromise = commandsAPI.getActiveLibraryFileContext
      ? commandsAPI.getActiveLibraryFileContext().catch(() => null)
      : Promise.resolve(null);
    const [context, activeLibraryFile] = await Promise.all([
      commandsAPI.getLauncherContext().catch(() => ({ fieldTheoryActive: false })),
      activeLibraryFilePromise,
    ]);
    setLauncherContext({
      fieldTheoryActive: Boolean(context?.fieldTheoryActive),
      hasActiveLibraryFileContext: Boolean(activeLibraryFile?.filePath),
    });
    traceLauncherLoad('refresh-launcher-context', startedAt, {
      fieldTheoryActive: Boolean(context?.fieldTheoryActive),
      hasActiveLibraryFileContext: Boolean(activeLibraryFile?.filePath),
    });
  }, []);

  const loadAuthorBookmarks = useCallback(async (handle: string) => {
    const requestId = ++authorBookmarkRequestRef.current;
    try {
      const bookmarks = await bookmarksAPI?.getAuthorBookmarks(handle);
      if (requestId !== authorBookmarkRequestRef.current || authorNamespaceRef.current !== handle) return;
      const nextBookmarks = bookmarks ?? [];
      setAuthorBookmarks(nextBookmarks);
      setAuthorBookmarkItems(buildBookmarkPostLauncherItems(nextBookmarks));
    } catch {
      if (requestId !== authorBookmarkRequestRef.current || authorNamespaceRef.current !== handle) return;
      setAuthorBookmarks([]);
      setAuthorBookmarkItems([]);
    }
  }, []);

  const loadBookmarkNamespace = useCallback(async (namespace: BookmarkNamespace) => {
    const requestId = ++bookmarkNamespaceRequestRef.current;
    try {
      const bookmarks = namespace.kind === 'all'
        ? (await bookmarksAPI?.getAll())?.bookmarks
        : await bookmarksAPI?.getTaxonomyBookmarks(namespace.paths);
      if (requestId !== bookmarkNamespaceRequestRef.current || bookmarkNamespaceRef.current !== namespace) return;
      const nextBookmarks = bookmarks ?? [];
      setBookmarkNamespaceBookmarks(nextBookmarks);
      setBookmarkNamespaceItems(buildBookmarkPostLauncherItems(nextBookmarks));
    } catch {
      if (requestId !== bookmarkNamespaceRequestRef.current || bookmarkNamespaceRef.current !== namespace) return;
      setBookmarkNamespaceBookmarks([]);
      setBookmarkNamespaceItems([]);
    }
  }, []);

  // Load handoffs from global Field Theory directory.
  const loadHandoffs = useCallback(async () => {
    const startedAt = performance.now();
    try {
      const hoffs = await commandsAPI.getHandoffs();
      const nextHandoffs = hoffs || [];
      setHandoffs(nextHandoffs);
      traceLauncherLoad('load-handoffs', startedAt, { itemCount: nextHandoffs.length });
    } catch (err) {
      traceLauncherLoad('load-handoffs', startedAt, { success: false });
      console.error('[CommandLauncher] Failed to load handoffs:', err);
    }
  }, []);

  // Load hotkeys from preferences.
  const loadHotkeys = useCallback(async () => {
    const startedAt = performance.now();
    try {
      const [clipboardHotkeys, transcriptionHotkey, sqHotkeys, sqConfig] = await Promise.all([
        clipboardAPI.getHotkeys?.() ?? {},
        transcribeAPI.getHotkey?.() ?? DEFAULT_HOTKEYS.transcription,
        squaresAPI.getHotkeys?.() ?? DEFAULT_SQUARES_HOTKEYS,
        squaresAPI.getConfig?.() ?? { showInCommandLauncher: true },
      ]);

      setHotkeys({
        screenshot: clipboardHotkeys.screenshot || DEFAULT_HOTKEYS.screenshot,
        fullScreen: clipboardHotkeys.fullScreen || DEFAULT_HOTKEYS.fullScreen,
        activeWindow: clipboardHotkeys.activeWindow || DEFAULT_HOTKEYS.activeWindow,
        history: clipboardHotkeys.history || DEFAULT_HOTKEYS.history,
        transcription: transcriptionHotkey as string || DEFAULT_HOTKEYS.transcription,
        superPaste: DEFAULT_HOTKEYS.superPaste,
      });

      if (sqHotkeys && typeof sqHotkeys === 'object') {
        setSquaresHotkeys({ ...DEFAULT_SQUARES_HOTKEYS, ...sqHotkeys });
      }
      setShowSquaresInCommandLauncher(normalizeSquaresConfig(sqConfig).showInCommandLauncher);
      traceLauncherLoad('load-hotkeys', startedAt, {
        hasClipboardHotkeys: Boolean(clipboardHotkeys),
        showSquaresInCommandLauncher: normalizeSquaresConfig(sqConfig).showInCommandLauncher,
      });
    } catch (err) {
      traceLauncherLoad('load-hotkeys', startedAt, { success: false });
      console.error('[CommandLauncher] Failed to load hotkeys:', err);
    }
  }, []);

  const loadLauncherBackgroundData = useCallback(async () => {
    if (launcherBackgroundRefreshInFlightRef.current) {
      traceLauncher('background-refresh-skipped-in-flight');
      return;
    }

    launcherBackgroundRefreshInFlightRef.current = true;
    const startedAt = performance.now();
    try {
      const results = await Promise.allSettled([
        loadHandoffs(),
        warmLauncherFileIndex(),
        loadLibraryMarkdown(),
        loadArtifacts(),
        loadBookmarkAuthors(),
        loadBookmarkPosts(),
        loadActiveWebPage(),
      ]);
      traceLauncherLoad('load-launcher-background-data', startedAt, {
        rejectedCount: results.filter(result => result.status === 'rejected').length,
      });
    } finally {
      launcherBackgroundRefreshInFlightRef.current = false;
    }
  }, [loadActiveWebPage, loadArtifacts, loadBookmarkAuthors, loadBookmarkPosts, loadHandoffs, loadLibraryMarkdown, warmLauncherFileIndex]);

  const loadLauncherData = useCallback(async (options: { includeBackground?: boolean } = {}) => {
    const includeBackground = options.includeBackground ?? true;
    const requestId = ++launcherDataRequestRef.current;
    const startedAt = performance.now();
    setLauncherDataLoading(true);
    const results = await Promise.allSettled([
      loadCommands(),
      loadLauncherSettings(),
      loadHandoffs(),
      loadHotkeys(),
      loadRecentEntries(),
      refreshLauncherContext(),
    ]);
    if (requestId === launcherDataRequestRef.current) {
      setLauncherDataLoading(false);
      traceLauncherLoad('load-launcher-data', startedAt, {
        includeBackground,
        rejectedCount: results.filter(result => result.status === 'rejected').length,
      });
    }
    if (includeBackground && requestId === launcherDataRequestRef.current) {
      void loadLauncherBackgroundData();
    }
  }, [loadCommands, loadHandoffs, loadHotkeys, loadLauncherBackgroundData, loadLauncherSettings, loadRecentEntries, refreshLauncherContext]);

  const loadLauncherOpenData = useCallback(async () => {
    const startedAt = performance.now();
    const results = await Promise.allSettled([
      loadRecentEntries(),
      refreshLauncherContext(),
    ]);
    traceLauncherLoad('load-launcher-open-data', startedAt, {
      rejectedCount: results.filter(result => result.status === 'rejected').length,
    });
  }, [loadRecentEntries, refreshLauncherContext]);

  const scheduleLauncherBackgroundRefresh = useCallback(() => {
    if (launcherBackgroundRefreshTimeoutRef.current !== null) {
      window.clearTimeout(launcherBackgroundRefreshTimeoutRef.current);
    }

    const runBackgroundRefresh = () => {
      if (!launcherActiveRef.current) {
        traceLauncher('background-refresh-skipped-hidden');
        launcherBackgroundRefreshTimeoutRef.current = null;
        return;
      }

      if ((inputRef.current?.value ?? '').trim()) {
        traceLauncher('background-refresh-deferred-for-input', {
          delayMs: LAUNCHER_BACKGROUND_REFRESH_DELAY_MS,
        });
        launcherBackgroundRefreshTimeoutRef.current = window.setTimeout(
          runBackgroundRefresh,
          LAUNCHER_BACKGROUND_REFRESH_DELAY_MS,
        );
        return;
      }

      launcherBackgroundRefreshTimeoutRef.current = null;
      void loadLauncherBackgroundData();
    };

    launcherBackgroundRefreshTimeoutRef.current = window.setTimeout(
      runBackgroundRefresh,
      LAUNCHER_BACKGROUND_REFRESH_DELAY_MS,
    );
  }, [loadLauncherBackgroundData]);

  const fetchClipboardStackItemsById = useCallback(async (stackIds: string[]): Promise<Record<string, ClipboardItem[]>> => {
    const queryItemsByStackId = clipboardAPI.queryItemsByStackId;
    if (!queryItemsByStackId || stackIds.length === 0) return {};

    const entries = await Promise.all(
      stackIds.map(async (stackId) => [stackId, await queryItemsByStackId(stackId)] as const)
    );
    const fetchedStacks = Object.fromEntries(entries) as Record<string, ClipboardItem[]>;

    setClipboardHydratedStackItemsById((prev) => {
      let changed = false;
      const next = { ...prev };

      for (const [stackId, stackItems] of Object.entries(fetchedStacks)) {
        if (getStackItemsSignature(prev[stackId] ?? []) !== getStackItemsSignature(stackItems)) {
          next[stackId] = stackItems;
          changed = true;
        }
      }

      return changed ? next : prev;
    });

    return fetchedStacks;
  }, []);

  const clearLauncherSessionState = useCallback(() => {
    authorNamespaceRef.current = null;
    bookmarkNamespaceRef.current = null;
    authorBookmarkRequestRef.current += 1;
    bookmarkNamespaceRequestRef.current += 1;
    activeWebPageRequestRef.current += 1;
    previewRequestRef.current += 1;
    manualPreviewRef.current = false;
    hasNavigatedRef.current = false;
    hasExplicitSelectionRef.current = false;
    setQuery('');
    setClipboardSearchActive(false);
    setNamespacePrefix(null);
    setDirectoryNamespace(null);
    setAuthorNamespace(null);
    setBookmarkNamespace(null);
    setMoveSource(null);
    setActiveWebPage(null);
    setPreviewOpen(false);
    setPreviewPayload(null);
    setAuthorBookmarks([]);
    setAuthorBookmarkItems([]);
    setBookmarkNamespaceBookmarks([]);
    setBookmarkNamespaceItems([]);
    setFiltered([]);
    setHasExplicitSelection(false);
    setCommittedItemId(null);
    selectIndex(0);
  }, [selectIndex]);

  const prepareLauncherForNextOpen = useCallback((options: { revealWhenReady?: boolean } = {}) => {
    const revealWhenReady = options.revealWhenReady ?? true;
    launcherActiveRef.current = false;
    if (launcherBackgroundRefreshTimeoutRef.current !== null) {
      window.clearTimeout(launcherBackgroundRefreshTimeoutRef.current);
      launcherBackgroundRefreshTimeoutRef.current = null;
    }
    flushSync(() => {
      setLauncherActive(false);
      setLauncherSessionReady(false);
      clearLauncherSessionState();
    });
    resizeLauncher(LAUNCHER_COLLAPSED_HEIGHT);
    if (!revealWhenReady) return;
    window.requestAnimationFrame(() => {
      setLauncherSessionReady(true);
    });
  }, [clearLauncherSessionState, resizeLauncher]);

  // Load commands, handoffs, and hotkeys on mount.
  useEffect(() => {
    // Set initial height immediately to prevent layout shift
    resizeLauncher(LAUNCHER_COLLAPSED_HEIGHT);

    void loadLauncherData({ includeBackground: false });

    // Load current Field Theory theme preference and keep this separate window in sync.
    themeAPI.getTheme().then(applyTheme).catch(() => {});
    const unsubscribeTheme = themeAPI.onThemeChanged?.(applyTheme);

    // Listen for reset events (when window is shown).
    const handleReset = (payload?: LauncherResetPayload) => {
      const resetStartedAt = performance.now();
      launcherFirstInputTracedRef.current = false;
      if (typeof payload?.isDarkMode === 'boolean') {
        applyTheme(payload.isDarkMode);
      }
      if (typeof payload?.generation === 'number') {
        launcherGenerationRef.current = payload.generation;
      }
      const earlyTypedQuery = document.hasFocus() && document.activeElement === inputRef.current
        ? inputRef.current?.value ?? ''
        : '';
      flushSync(() => {
        launcherClosingForInvocationRef.current = false;
        launcherActiveRef.current = true;
        setLauncherActive(true);
        setPinnedItemIds(readLibraryPinnedItemIds());
        clearLauncherSessionState();
        if (earlyTypedQuery) setQuery(earlyTypedQuery);
        setLauncherSessionReady(true);
      });
      resizeLauncher(LAUNCHER_COLLAPSED_HEIGHT);
      focusLauncherInput();
      traceLauncherLoad('launcher-reset', resetStartedAt, {
        hadEarlyTypedQuery: Boolean(earlyTypedQuery),
        generation: payload?.generation ?? null,
      });
      void loadLauncherOpenData();
      scheduleLauncherBackgroundRefresh();
      void themeAPI.getTheme()
        .then(dark => applyTheme(dark ?? payload?.isDarkMode ?? false))
        .catch(() => applyTheme(payload?.isDarkMode ?? themeAPI.initialTheme ?? false));
    };

    const unsubscribe = commandsAPI.onLauncherReset(handleReset);
    const unsubscribeFocusInput = commandsAPI.onLauncherFocusInput?.((payload) => {
      if (typeof payload?.generation === 'number' && payload.generation !== launcherGenerationRef.current) return;
      focusLauncherInput();
    });
    const unsubscribeSquaresConfig = squaresAPI.onConfigChanged?.((config) => {
      setShowSquaresInCommandLauncher(normalizeSquaresConfig(config).showInCommandLauncher);
    });
    const unsubscribeBookmarks = bookmarksAPI?.onChanged?.(() => {
      if (!launcherActiveRef.current) return;
      scheduleLauncherBackgroundRefresh();
      const handle = authorNamespaceRef.current;
      if (handle) loadAuthorBookmarks(handle);
      const namespace = bookmarkNamespaceRef.current;
      if (namespace) loadBookmarkNamespace(namespace);
    });
    const unsubscribeCommands = commandsAPI.onCommandsChanged?.((nextCommands) => {
      setCommands(nextCommands || []);
      void commandsAPI.getCommandDirectories()
        .then(directories => setCommandDirectories(directories || []))
        .catch(() => setCommandDirectories([]));
    });
    const unsubscribeLibraryRoots = libraryAPI?.onRootsChanged?.(() => {
      if (!launcherActiveRef.current) return;
      scheduleLauncherBackgroundRefresh();
    });
    const unsubscribeRecent = recentAPI?.onChanged?.(() => {
      if (!launcherActiveRef.current) return;
      loadRecentEntries();
    });
    return () => {
      if (launcherBackgroundRefreshTimeoutRef.current !== null) {
        window.clearTimeout(launcherBackgroundRefreshTimeoutRef.current);
        launcherBackgroundRefreshTimeoutRef.current = null;
      }
      unsubscribe();
      unsubscribeFocusInput?.();
      unsubscribeTheme?.();
      unsubscribeSquaresConfig?.();
      unsubscribeBookmarks?.();
      unsubscribeCommands?.();
      unsubscribeLibraryRoots?.();
      unsubscribeRecent?.();
    };
  }, [applyTheme, clearLauncherSessionState, focusLauncherInput, loadAuthorBookmarks, loadBookmarkNamespace, loadLauncherData, loadLauncherOpenData, loadRecentEntries, resizeLauncher, scheduleLauncherBackgroundRefresh]);

  useEffect(() => {
    const handleBlur = () => {
      prepareLauncherForNextOpen({
        revealWhenReady: !launcherClosingForInvocationRef.current,
      });
    };
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('blur', handleBlur);
    };
  }, [prepareLauncherForNextOpen]);

  useEffect(() => () => {
    if (launcherSearchCacheWarmTimeoutRef.current !== null) {
      window.clearTimeout(launcherSearchCacheWarmTimeoutRef.current);
      launcherSearchCacheWarmTimeoutRef.current = null;
    }
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current);
    }
  }, []);

  useEffect(() => {
    authorNamespaceRef.current = authorNamespace;
    if (!authorNamespace) {
      setAuthorBookmarks([]);
      setAuthorBookmarkItems([]);
      previewRequestRef.current += 1;
      setPreviewOpen(false);
      setPreviewPayload(null);
      return;
    }
    loadAuthorBookmarks(authorNamespace);
  }, [authorNamespace, loadAuthorBookmarks]);

  useEffect(() => {
    bookmarkNamespaceRef.current = bookmarkNamespace;
    if (!bookmarkNamespace) {
      setBookmarkNamespaceBookmarks([]);
      setBookmarkNamespaceItems([]);
      previewRequestRef.current += 1;
      setPreviewOpen(false);
      setPreviewPayload(null);
      return;
    }
    loadBookmarkNamespace(bookmarkNamespace);
  }, [bookmarkNamespace, loadBookmarkNamespace]);

  const pinnedLibraryFilePaths = useMemo(() => new Set(
    libraryMarkdownItems
      .filter(item => isLibraryMarkdownLauncherItemPinned(item, pinnedItemIds))
      .map(item => item.filePath)
      .filter((filePath): filePath is string => Boolean(filePath)),
  ), [libraryMarkdownItems, pinnedItemIds]);

  const commandItems = useMemo((): LauncherItem[] => commands
    .filter(cmd => !isGeneratedBookmarkTaxonomyPath(cmd.filePath))
    .map(cmd => ({
      id: `cmd-${cmd.name}`,
      type: 'command' as const,
      name: cmd.name,
      displayName: cmd.displayName,
      keywords: [cmd.name, cmd.displayName, ...cmd.name.split('-'), ...cmd.name.split('_')],
      filePath: cmd.filePath,
      isPinned: pinnedItemIds.has(`external:${cmd.filePath}`) || pinnedLibraryFilePaths.has(cmd.filePath),
      lastUpdated: cmd.lastModified,
    })), [commands, pinnedItemIds, pinnedLibraryFilePaths]);

  const commandDirectoryItems = useMemo((): LauncherItem[] => (
    buildCommandDirectoriesForLauncher(commandDirectories)
  ), [commandDirectories]);

  const sourceItems = useMemo((): LauncherItem[] => ([
    {
      id: 'source-wiki',
      type: 'source' as const,
      sourceId: 'wiki' as const,
      name: 'wiki',
      displayName: 'Wiki',
      keywords: ['wiki', 'markdown', 'library', 'notes', 'pages'],
      hotkeyDisplay: 'source',
    },
    {
      id: 'source-bookmarks',
      type: 'source' as const,
      sourceId: 'bookmarks' as const,
      name: 'bookmarks',
      displayName: 'Bookmarks',
      keywords: ['bookmarks', 'bookmark', 'tweets', 'tweet', 'posts', 'post', 'x', 'links'],
      hotkeyDisplay: 'source',
    },
    {
      id: 'source-artifact',
      type: 'source' as const,
      sourceId: 'artifact' as const,
      name: 'artifact',
      displayName: 'Artifacts',
      keywords: ['artifact', 'artifacts', 'readings'],
      hotkeyDisplay: 'source',
    },
    {
      id: 'source-actions',
      type: 'source' as const,
      sourceId: 'actions' as const,
      name: 'actions',
      displayName: 'Actions',
      keywords: ['actions', 'action', 'controls', 'control', 'window controls'],
      hotkeyDisplay: 'source',
    },
  ]), []);

  const fileItems = useMemo((): LauncherItem[] => buildLauncherFileItems(launcherFiles), [launcherFiles]);

  const commandFilePaths = useMemo(
    () => new Set(commandItems.map(item => item.filePath).filter((filePath): filePath is string => Boolean(filePath))),
    [commandItems],
  );

  const libraryMarkdownSearchItems = useMemo(() => (
    libraryMarkdownItems.filter((item) => (
      shouldIncludeLauncherLibraryMarkdownItem({ filePath: item.filePath, commandFilePaths })
    )).map(item => ({
      ...item,
      isPinned: isLibraryMarkdownLauncherItemPinned(item, pinnedItemIds),
    }))
  ), [commandFilePaths, libraryMarkdownItems, pinnedItemIds]);

  const recentFileItems = useMemo((): LauncherItem[] => {
    return recentEntries.flatMap((entry) => {
      const libraryItem = entry.kind === 'wiki'
        ? libraryMarkdownItems.find((item) => item.type === 'wiki-page' && item.relPath === entry.path)
        : libraryMarkdownItems.find((item) => item.type === 'markdown-file' && item.filePath === entry.path);

      if (entry.kind === 'wiki' && !libraryItem) return [];

      const filePath = libraryItem?.filePath ?? entry.path;
      const relPath = entry.kind === 'wiki' ? entry.path : libraryItem?.relPath;
      const name = libraryItem?.name ?? entry.title;
      if (!shouldIncludeLauncherRecentFile({ filePath, commandFilePaths })) return [];

      return [{
        id: `recent-${entry.kind}-${entry.path}`,
        type: 'recent-file' as const,
        name,
        displayName: entry.title,
        keywords: [name, entry.title, entry.path, ...entry.title.split(/\s+/), ...entry.path.split(/[/-]/)].filter(Boolean),
        filePath,
        relPath,
        recentKind: entry.kind,
        lastOpenedAt: entry.lastOpenedAt,
        hotkeyDisplay: formatTimeAgo(entry.lastOpenedAt),
      }];
    });
  }, [commandFilePaths, libraryMarkdownItems, recentEntries]);

  const handoffItems = useMemo((): LauncherItem[] => handoffs.map(h => ({
    id: `handoff-${h.name}`,
    type: 'handoff' as const,
    name: h.name,
    displayName: h.displayName,
    keywords: [h.name, h.displayName, 'handoff', 'session', ...h.displayName.split('-')],
    filePath: h.filePath,
    lastUpdated: h.lastModified,
    timeAgo: formatTimeAgo(h.lastModified),
  })), [handoffs]);

  const actionItems = useMemo((): LauncherItem[] => (
    buildBuiltInLauncherActions(hotkeys, isDarkMode ?? false, squaresHotkeys, showSquaresInCommandLauncher)
      .map((item) => {
        if (item.actionId === 'undo-library-move' && lastLibraryMove) {
          return {
            ...item,
            displayName: `Undo Move: ${lastLibraryMove.source.title}`,
          };
        }
        if (item.actionId !== 'save-current-website' || !activeWebPage?.url) return item;
        return {
          ...item,
          displayName: `Save to Markdown: ${compactLauncherUrl(activeWebPage.url)}`,
          keywords: [...item.keywords, activeWebPage.url, activeWebPage.title, activeWebPage.appName].filter(Boolean),
        };
      })
  ), [activeWebPage, hotkeys, isDarkMode, lastLibraryMove, showSquaresInCommandLauncher, squaresHotkeys]);

  // Build all items (commands + actions + handoffs).
  const allItems = useMemo(() => {
    return [
      ...commandItems,
      ...commandDirectoryItems,
      ...directoryItems,
      ...libraryMarkdownSearchItems,
      ...sourceItems,
      ...recentFileItems,
      ...handoffItems,
      ...actionItems,
    ];
  }, [actionItems, commandItems, commandDirectoryItems, directoryItems, handoffItems, libraryMarkdownSearchItems, sourceItems, recentFileItems]);

  useEffect(() => {
    let idleHandle: number | null = null;
    let cancelled = false;
    const scheduleIdle = window.requestIdleCallback
      ? (callback: IdleRequestCallback) => {
        idleHandle = window.requestIdleCallback(callback, { timeout: 500 });
      }
      : (callback: IdleRequestCallback) => {
        launcherSearchCacheWarmTimeoutRef.current = window.setTimeout(() => {
          callback({
            didTimeout: true,
            timeRemaining: () => 0,
          });
        }, LAUNCHER_SEARCH_CACHE_WARM_CHUNK_DELAY_MS);
      };
    const cancelIdle = () => {
      if (idleHandle !== null) {
        window.cancelIdleCallback?.(idleHandle);
        idleHandle = null;
      }
    };
    const clearWarmTimeout = () => {
      if (launcherSearchCacheWarmTimeoutRef.current !== null) {
        window.clearTimeout(launcherSearchCacheWarmTimeoutRef.current);
        launcherSearchCacheWarmTimeoutRef.current = null;
      }
    };

    cancelIdle();
    clearWarmTimeout();
    launcherSearchCacheWarmIndexRef.current = 0;
    if (!launcherActive || !launcherSessionReady || allItems.length === 0) return;
    const startedAt = performance.now();

    const warmSearchCache = () => {
      if (cancelled) return;
      if ((inputRef.current?.value ?? '').trim()) {
        traceLauncher('search-cache-warm-deferred-for-input', {
          itemCount: allItems.length,
          warmedCount: launcherSearchCacheWarmIndexRef.current,
          delayMs: LAUNCHER_SEARCH_CACHE_WARM_DELAY_MS,
        });
        launcherSearchCacheWarmTimeoutRef.current = window.setTimeout(
          warmSearchCache,
          LAUNCHER_SEARCH_CACHE_WARM_DELAY_MS,
        );
        return;
      }

      const chunkStartedAt = performance.now();
      const startIndex = launcherSearchCacheWarmIndexRef.current;
      launcherSearchCacheWarmIndexRef.current = warmLauncherSearchableItemCache(
        allItems,
        startIndex,
        LAUNCHER_SEARCH_CACHE_WARM_CHUNK_SIZE,
      );
      traceLauncherLoad('warm-search-cache-chunk', chunkStartedAt, {
        itemCount: allItems.length,
        startIndex,
        endIndex: launcherSearchCacheWarmIndexRef.current,
        chunkSize: LAUNCHER_SEARCH_CACHE_WARM_CHUNK_SIZE,
      });
      if (launcherSearchCacheWarmIndexRef.current < allItems.length) {
        scheduleIdle(warmSearchCache);
        return;
      }

      traceLauncherLoad('warm-search-cache', startedAt, {
        itemCount: allItems.length,
        chunkSize: LAUNCHER_SEARCH_CACHE_WARM_CHUNK_SIZE,
      });
      launcherSearchCacheWarmTimeoutRef.current = null;
    };

    launcherSearchCacheWarmTimeoutRef.current = window.setTimeout(
      warmSearchCache,
      LAUNCHER_SEARCH_CACHE_WARM_DELAY_MS,
    );

    return () => {
      cancelled = true;
      cancelIdle();
      clearWarmTimeout();
    };
  }, [allItems, launcherActive, launcherSessionReady]);

  const fileSearchQuery = useMemo(() => getLauncherFileSearchQuery(query), [query]);
  const clipboardSearchQuery = clipboardSearchActive ? query : null;
  const fileSearchEnabled = isLauncherRootSearchKindEnabled(launcherRootSearchEnabledKinds, 'file');

  const namespaceLabel = moveSource
    ? `move: ${moveSource.title}`
    : clipboardSearchQuery !== null
      ? 'clipboard'
      : directoryNamespace?.label ?? (authorNamespace ? `@${authorNamespace}` : bookmarkNamespace?.label ?? namespacePrefix);

  const clipboardListRows = useMemo((): ListRow[] => (
    buildClipboardListRows(clipboardItems, clipboardStacks, new Set<string>(), clipboardHydratedStackItemsById)
  ), [clipboardHydratedStackItemsById, clipboardItems, clipboardStacks]);

  const clipboardLauncherItems = useMemo((): LauncherItem[] => clipboardListRows.map((row) => {
    if (row.type === 'stack') {
      const displayName = getClipboardStackLauncherText(row);
      return {
        id: `clipboard-stack-${row.stack.stackId}`,
        type: 'clipboard-stack' as const,
        name: displayName,
        displayName,
        keywords: ['clipboard', 'stack', displayName, row.stack.firstTextPreview ?? ''].filter(Boolean),
        hotkeyDisplay: `${row.stack.itemCount} items`,
        lastUpdated: row.stack.createdAt,
        clipboardRow: row,
        clipboardStackId: row.stack.stackId,
        clipboardSearch: clipboardSearchQuery ?? '',
      };
    }

    const displayName = getClipboardItemLauncherText(row.item);
    return {
      id: `clipboard-item-${row.item.id}`,
      type: 'clipboard-item' as const,
      name: displayName,
      displayName,
      keywords: ['clipboard', row.item.type, displayName, row.item.sourceAppName ?? '', row.item.content ?? ''].filter(Boolean),
      hotkeyDisplay: row.item.sourceAppName || formatTimeAgo(row.item.createdAt),
      lastUpdated: row.item.createdAt,
      clipboardRow: row,
      clipboardItemId: row.item.id,
      clipboardSearch: clipboardSearchQuery ?? '',
    };
  }), [clipboardListRows, clipboardSearchQuery]);

  const bookmarkForItem = useCallback((item: LauncherItem | undefined): Bookmark | null => {
    if (item?.type !== 'bookmark' || !item.bookmarkId) return null;
    const bookmarks = authorNamespace ? authorBookmarks : bookmarkNamespaceBookmarks;
    return bookmarks.find((bookmark) => bookmark.id === item.bookmarkId)
      ?? bookmarkPosts.find((bookmark) => bookmark.id === item.bookmarkId)
      ?? null;
  }, [authorBookmarks, authorNamespace, bookmarkNamespaceBookmarks, bookmarkPosts]);

  const markdownPreviewPathForItem = useCallback((item: LauncherItem | undefined): string | null => {
    if (!item?.filePath) return null;
    if (item.type === 'command' || item.type === 'handoff' || item.type === 'recent-file' || item.type === 'wiki-page' || item.type === 'markdown-file' || item.type === 'artifact') {
      return item.filePath;
    }
    return null;
  }, []);

  const clipboardPreviewContentForItem = useCallback((item: LauncherItem | undefined): LauncherClipboardPreviewContent | null => {
    if (item?.type !== 'clipboard-item' && item?.type !== 'clipboard-stack') return null;
    if (!item.clipboardRow) return null;
    return getClipboardRowPreviewContent(item.clipboardRow);
  }, []);

  const loadPreviewForItem = useCallback(async (item: LauncherItem | undefined, itemIndex: number, source: string) => {
    const requestId = ++previewRequestRef.current;
    const bookmark = bookmarkForItem(item);
    if (bookmark) {
      setPreviewPayload({ kind: 'bookmark', bookmark });
      traceLauncher('preview-load-bookmark', {
        source,
        selectedIndex: itemIndex,
        item: describeLauncherItem(item),
        bookmarkId: bookmark.id,
      });
      return;
    }

    const clipboardPreview = clipboardPreviewContentForItem(item);
    if (item && clipboardPreview) {
      setPreviewPayload({
        kind: 'clipboard',
        title: getClipboardPreviewTitle(item),
        content: clipboardPreview,
      });
      traceLauncher('preview-load-clipboard', {
        source,
        selectedIndex: itemIndex,
        item: describeLauncherItem(item),
        previewType: clipboardPreview.type,
      });

      if (clipboardPreview.type === 'image' && clipboardPreview.needsFullImage && clipboardAPI.getItem) {
        void clipboardAPI.getItem(clipboardPreview.itemId).then((fullItem) => {
          if (requestId !== previewRequestRef.current || !fullItem?.imageData) return;
          setPreviewPayload({
            kind: 'clipboard',
            title: getClipboardPreviewTitle(item),
            content: {
              ...clipboardPreview,
              data: fullItem.imageData,
              width: fullItem.imageWidth || clipboardPreview.width,
              height: fullItem.imageHeight || clipboardPreview.height,
            },
          });
        }).catch(() => {});
      }
      return;
    }

    const filePath = markdownPreviewPathForItem(item);
    if (!filePath) {
      setPreviewPayload(null);
      traceLauncher('preview-load-empty', {
        source,
        selectedIndex: itemIndex,
        item: describeLauncherItem(item),
      });
      return;
    }

    const preview = await commandsAPI.getMarkdownPreview(filePath).catch(() => null);
    if (requestId !== previewRequestRef.current) return;
    if (!preview) {
      setPreviewPayload(null);
      traceLauncher('preview-load-markdown-failed', {
        source,
        selectedIndex: itemIndex,
        item: describeLauncherItem(item),
        filePath,
      });
      return;
    }

    setPreviewPayload({
      kind: 'markdown',
      title: item?.displayName || preview.title,
      filePath: preview.filePath,
      content: preview.content,
    });
    traceLauncher('preview-load-markdown', {
      source,
      selectedIndex: itemIndex,
      item: describeLauncherItem(item),
      filePath: preview.filePath,
    });
  }, [bookmarkForItem, clipboardPreviewContentForItem, markdownPreviewPathForItem]);

  const previewPayloadKey = useMemo(() => {
    if (!previewPayload) return null;
    if (previewPayload.kind === 'bookmark') return `bookmark:${previewPayload.bookmark.id}`;
    if (previewPayload.kind === 'markdown') return `markdown:${previewPayload.filePath}:${previewPayload.content.length}`;
    const content = previewPayload.content;
    const contentKey = content.type === 'image'
      ? `${content.itemId}:${content.width ?? 0}:${content.height ?? 0}:${content.data ? 'full' : 'thumb'}`
      : `${content.content.length}`;
    return `clipboard:${previewPayload.title}:${content.type}:${contentKey}`;
  }, [previewPayload]);

  const selectedPreviewItem = filtered[selectedIndex];
  const selectedPreviewItemId = selectedPreviewItem?.id ?? null;

  useEffect(() => {
    if (!previewOpen) return;
    traceLauncher('preview-state', {
      hasPreview: Boolean(previewPayload),
      previewKind: previewPayload?.kind ?? null,
      selectedIndex,
      filteredCount: filtered.length,
      item: describeLauncherItem(filtered[selectedIndex]),
      bookmarkId: previewPayload?.kind === 'bookmark' ? previewPayload.bookmark.id : null,
      filePath: previewPayload?.kind === 'markdown' ? previewPayload.filePath : null,
    });
  }, [filtered, previewOpen, previewPayload, selectedIndex]);

  useEffect(() => {
    if (!previewOpen) {
      if (previewWindowWasOpenRef.current) {
        commandsAPI.launcherPreviewHide?.();
        previewWindowWasOpenRef.current = false;
      }
      lastPreviewWindowPayloadKeyRef.current = null;
      setPreviewPayload(null);
      return;
    }
    if (!previewPayload) {
      if (previewWindowWasOpenRef.current) {
        commandsAPI.launcherPreviewHide?.();
        previewWindowWasOpenRef.current = false;
      }
      lastPreviewWindowPayloadKeyRef.current = null;
      return;
    }
    if (lastPreviewWindowPayloadKeyRef.current === previewPayloadKey) return;
    lastPreviewWindowPayloadKeyRef.current = previewPayloadKey;
    previewWindowWasOpenRef.current = true;
    traceLauncher('preview-window-show', {
      selectedIndex,
      previewKind: previewPayload.kind,
      bookmarkId: previewPayload.kind === 'bookmark' ? previewPayload.bookmark.id : null,
      filePath: previewPayload.kind === 'markdown' ? previewPayload.filePath : null,
    });
    commandsAPI.launcherPreviewShow?.(previewPayload);
  }, [previewOpen, previewPayload, previewPayloadKey, selectedIndex]);

  useEffect(() => {
    if (!previewOpen) return;
    if (manualPreviewRef.current) return;
    const delayMs = previewWindowWasOpenRef.current ? 70 : 0;
    const timeout = window.setTimeout(() => {
      void loadPreviewForItem(selectedPreviewItem, selectedIndex, 'selection');
    }, delayMs);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [loadPreviewForItem, previewOpen, selectedIndex, selectedPreviewItem, selectedPreviewItemId]);

  // Check if query is a help command.
  const isHelpQuery = useMemo(() => {
    if (namespacePrefix || directoryNamespace || authorNamespace || bookmarkNamespace || moveSource) return false;
    const q = query.trim().toLowerCase();
    return q === 'help' || q === '?';
  }, [namespacePrefix, directoryNamespace, authorNamespace, bookmarkNamespace, moveSource, query]);

  const localInstructionFallbackForQuery = useCallback((rawQuery: string, resultCount: number, inScopedMode = false): LauncherItem | null => {
    const instruction = rawQuery.trim();
    if (!shouldOfferLocalInstructionFallback({
      query: instruction,
      resultCount,
      fieldTheoryActive: launcherContext.fieldTheoryActive,
      hasActiveLibraryFileContext: launcherContext.hasActiveLibraryFileContext,
      inScopedMode,
    })) {
      return null;
    }
    return buildLocalInstructionFallbackItem(instruction);
  }, [launcherContext.fieldTheoryActive, launcherContext.hasActiveLibraryFileContext]);

  const getNormalModeMatches = useCallback((rawQuery: string): LauncherItem[] => {
    return dedupeLauncherPersonItems(filterLauncherNormalModeItems(allItems, rawQuery, usageByItemId));
  }, [allItems, usageByItemId]);

  const visibleLauncherIconPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const item of filtered) {
      const iconPath = getLauncherNativeIconPathForItem(item);
      if (iconPath) paths.add(iconPath);
    }
    return Array.from(paths).slice(0, LAUNCHER_NORMAL_MODE_MAX_RESULTS);
  }, [filtered]);

  const flushLauncherIconDataBatch = useCallback(() => {
    launcherIconDataFlushFrameRef.current = null;
    const entries = Object.entries(launcherIconDataBatchRef.current);
    launcherIconDataBatchRef.current = {};
    if (entries.length === 0) return;

    setLauncherIconDataByPath(prev => {
      let changed = false;
      const next = { ...prev };
      for (const [filePath, iconData] of entries) {
        if (Object.prototype.hasOwnProperty.call(next, filePath)) continue;
        next[filePath] = iconData;
        changed = true;
      }
      return changed ? next : prev;
    });
  }, []);

  const queueLauncherIconData = useCallback((filePath: string, iconData: string | null) => {
    launcherIconDataBatchRef.current[filePath] = iconData;
    if (launcherIconDataFlushFrameRef.current !== null) return;
    launcherIconDataFlushFrameRef.current = window.requestAnimationFrame(flushLauncherIconDataBatch);
  }, [flushLauncherIconDataBatch]);

  useEffect(() => () => {
    if (launcherIconLoadTimeoutRef.current !== null) {
      window.clearTimeout(launcherIconLoadTimeoutRef.current);
      launcherIconLoadTimeoutRef.current = null;
    }
    if (launcherIconDataFlushFrameRef.current !== null) {
      window.cancelAnimationFrame(launcherIconDataFlushFrameRef.current);
      launcherIconDataFlushFrameRef.current = null;
    }
    launcherIconDataBatchRef.current = {};
  }, []);

  const loadClipboardLauncherResults = useCallback(async (search: string): Promise<void> => {
    const requestId = ++clipboardSearchRequestRef.current;
    const startedAt = performance.now();
    setClipboardSearchLoading(true);
    const options: ClipboardQueryOptions = {
      limit: 50,
      offset: 0,
    };
    if (search.trim()) {
      options.search = search.trim();
    }

    try {
      const [items, stacks] = await Promise.all([
        clipboardAPI.queryItems(options),
        clipboardAPI.getUniqueStacks?.() ?? Promise.resolve([]),
      ]);
      if (requestId !== clipboardSearchRequestRef.current) return;
      setClipboardHydratedStackItemsById({});
      setClipboardItems(items ?? []);
      setClipboardStacks(stacks ?? []);
      traceLauncherLoad('load-clipboard-results', startedAt, {
        queryLength: search.length,
        itemCount: items?.length ?? 0,
        stackCount: stacks?.length ?? 0,
      });
    } catch (error) {
      if (requestId !== clipboardSearchRequestRef.current) return;
      console.error('[CommandLauncher] Failed to load clipboard results:', error);
      setClipboardItems([]);
      setClipboardStacks([]);
      setClipboardHydratedStackItemsById({});
      traceLauncherLoad('load-clipboard-results', startedAt, {
        queryLength: search.length,
        success: false,
      });
    } finally {
      if (requestId !== clipboardSearchRequestRef.current) return;
      setClipboardSearchLoading(false);
    }
  }, []);

  useEffect(() => {
    if (clipboardSearchQuery === null) {
      clipboardSearchRequestRef.current += 1;
      setClipboardItems([]);
      setClipboardStacks([]);
      setClipboardHydratedStackItemsById({});
      setClipboardSelectedItemIds(new Set());
      setClipboardDragId(null);
      setClipboardDropId(null);
      setClipboardSearchLoading(false);
      return;
    }

    let cancelled = false;
    void loadClipboardLauncherResults(clipboardSearchQuery).then(() => {
      if (cancelled) return;
    });
    return () => {
      cancelled = true;
    };
  }, [clipboardSearchQuery, loadClipboardLauncherResults]);

  useEffect(() => {
    if (clipboardSearchQuery === null) return;

    const stackIdsToHydrate = getStackHydrationIds(clipboardItems, clipboardStacks, clipboardHydratedStackItemsById);
    if (stackIdsToHydrate.length === 0) return;

    const requestId = ++clipboardStackHydrationRequestRef.current;
    void fetchClipboardStackItemsById(stackIdsToHydrate).catch((error) => {
      if (requestId !== clipboardStackHydrationRequestRef.current) return;
      console.error('[CommandLauncher] Failed to hydrate clipboard stack results:', error);
    });
  }, [clipboardHydratedStackItemsById, clipboardItems, clipboardSearchQuery, clipboardStacks, fetchClipboardStackItemsById]);

  useEffect(() => {
    if (clipboardSearchQuery === null || clipboardSelectedItemIds.size === 0) return;
    const visibleIds = new Set<number>();
    for (const item of clipboardItems) visibleIds.add(item.id);
    for (const stackItems of Object.values(clipboardHydratedStackItemsById)) {
      for (const item of stackItems) visibleIds.add(item.id);
    }
    setClipboardSelectedItemIds((prev) => {
      const next = new Set([...prev].filter(id => visibleIds.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [clipboardHydratedStackItemsById, clipboardItems, clipboardSearchQuery, clipboardSelectedItemIds.size]);

  useEffect(() => {
    const isScopedMode = Boolean(namespacePrefix || directoryNamespace || authorNamespace || bookmarkNamespace || moveSource || clipboardSearchQuery !== null);
    const requestId = ++launcherFileSearchRequestRef.current;
    if (fileSearchQuery === null || isScopedMode || !fileSearchEnabled) {
      setLauncherFiles([]);
      setLauncherFileSearchLoading(false);
      return;
    }
    if (!fileSearchQuery) {
      setLauncherFiles([]);
      setLauncherFileSearchLoading(false);
      return;
    }

    setLauncherFileSearchLoading(true);
    let cancelled = false;
    let pollTimeoutId: number | null = null;
    const runSearch = () => {
      const searchStartedAt = performance.now();
      void commandsAPI.searchLauncherFiles(fileSearchQuery)
        .then((result) => {
          if (cancelled || requestId !== launcherFileSearchRequestRef.current) return;
          setLauncherFiles(result.files || []);
          setLauncherFileSearchLoading(result.indexing);
          traceLauncherLoad('search-launcher-files', searchStartedAt, {
            queryLength: fileSearchQuery.length,
            resultCount: result.files?.length ?? 0,
            indexing: result.indexing,
            indexedAt: result.indexedAt ?? null,
          });
          if (result.indexing) {
            pollTimeoutId = window.setTimeout(runSearch, 250);
          }
        })
        .catch((error) => {
          console.error('[CommandLauncher] Failed to search files:', error);
          if (cancelled || requestId !== launcherFileSearchRequestRef.current) return;
          setLauncherFiles([]);
          setLauncherFileSearchLoading(false);
          traceLauncherLoad('search-launcher-files', searchStartedAt, {
            queryLength: fileSearchQuery.length,
            success: false,
          });
        });
    };
    const timeoutId = window.setTimeout(runSearch, 80);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      if (pollTimeoutId !== null) window.clearTimeout(pollTimeoutId);
    };
  }, [authorNamespace, bookmarkNamespace, clipboardSearchQuery, directoryNamespace, fileSearchEnabled, fileSearchQuery, moveSource, namespacePrefix]);

  useEffect(() => {
    if (launcherIconLoadTimeoutRef.current !== null) {
      window.clearTimeout(launcherIconLoadTimeoutRef.current);
      launcherIconLoadTimeoutRef.current = null;
    }
    if (!launcherActive || !launcherSessionReady || visibleLauncherIconPaths.length === 0) return;

    launcherIconLoadTimeoutRef.current = window.setTimeout(() => {
      launcherIconLoadTimeoutRef.current = null;
      for (const filePath of visibleLauncherIconPaths) {
        if (Object.prototype.hasOwnProperty.call(launcherIconDataByPath, filePath)) continue;
        if (launcherIconPendingPathsRef.current.has(filePath)) continue;
        launcherIconPendingPathsRef.current.add(filePath);
        const iconStartedAt = performance.now();
        void commandsAPI.getLauncherFileIcon(filePath)
          .then((result) => {
            queueLauncherIconData(filePath, result.success ? (result.iconDataUrl ?? null) : null);
            traceLauncherLoad('load-launcher-file-icon', iconStartedAt, {
              success: result.success,
              hasIconDataUrl: Boolean(result.iconDataUrl),
            });
          })
          .catch(() => {
            queueLauncherIconData(filePath, null);
            traceLauncherLoad('load-launcher-file-icon', iconStartedAt, { success: false });
          })
          .finally(() => {
            launcherIconPendingPathsRef.current.delete(filePath);
          });
      }
    }, LAUNCHER_ICON_LOAD_DELAY_MS);

    return () => {
      if (launcherIconLoadTimeoutRef.current !== null) {
        window.clearTimeout(launcherIconLoadTimeoutRef.current);
        launcherIconLoadTimeoutRef.current = null;
      }
    };
  }, [launcherActive, launcherIconDataByPath, launcherSessionReady, queueLauncherIconData, visibleLauncherIconPaths]);

  // Filter items when query changes.
  useEffect(() => {
    if (committedItemId) return;

    const filterStartedAt = performance.now();
    const inputHeight = LAUNCHER_COLLAPSED_HEIGHT;
    const emptyStateHeight = 34;
    const maxListHeight = LAUNCHER_MAX_LIST_HEIGHT;

    const resizeForResults = (resultCount: number, forceEmptyState = false) => {
      const itemHeight = 30;
      const listHeight = resultCount > 0
        ? Math.min(resultCount * itemHeight + 10, maxListHeight)
        : (forceEmptyState ? emptyStateHeight : 0);
      resizeLauncher(inputHeight + listHeight);
    };

    if (clipboardSearchQuery !== null) {
      const results = clipboardLauncherItems;
      applyFilteredResults(results);
      selectIndex(0);
      resizeForResults(results.length, clipboardSearchQuery.length > 0 || clipboardSearchLoading);
      return;
    }

    if (allItems.length === 0 && !namespacePrefix && !directoryNamespace && !authorNamespace && !bookmarkNamespace && !moveSource) {
      const waitingForResults = launcherDataLoading && query.trim() !== '';
      const fallback = waitingForResults ? null : localInstructionFallbackForQuery(query, 0, isHelpQuery);
      applyFilteredResults(fallback ? [fallback] : []);
      selectIndex(0);
      // Don't show empty state height when still loading (query is empty)
      // Only show it when user has typed but no results found
      resizeForResults(fallback ? 1 : 0, waitingForResults);
      return;
    }

    if (!namespacePrefix && !directoryNamespace && !authorNamespace && !bookmarkNamespace && !moveSource && query.trim() === '') {
      applyFilteredResults([]);
      selectIndex(0);
      resizeLauncher(inputHeight);
      return;
    }

    // Help mode: show all items grouped by type.
    if (isHelpQuery) {
      // Sort: actions first (alphabetically), then handoffs (by recency), then commands (alphabetically).
      const actions = allItems
        .filter(item => item.type === 'action')
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      const hoffs = allItems
        .filter(item => item.type === 'handoff')
        .sort(compareLauncherItemsByRecency);
      const cmds = allItems
        .filter(item => item.type === 'command')
        .sort(compareLauncherItemsByRecency);

      applyFilteredResults([...actions, ...hoffs, ...cmds]);
      selectIndex(0);

      // Resize for all items.
      const itemHeight = 30;
      const sectionHeaderHeight = 20;
      const padding = 12;
      const numSections = (actions.length > 0 ? 1 : 0) + (hoffs.length > 0 ? 1 : 0) + (cmds.length > 0 ? 1 : 0);
      const totalItems = actions.length + hoffs.length + cmds.length;
      const listHeight = Math.min(
        totalItems * itemHeight + numSections * sectionHeaderHeight + padding,
        maxListHeight
      );
      resizeLauncher(inputHeight + listHeight);
      return;
    }

    const q = query.toLowerCase();

    if (fileSearchQuery !== null) {
      const results = fileSearchEnabled ? fileItems : [];
      applyFilteredResults(results);
      selectIndex(0);
      resizeForResults(results.length, fileSearchQuery.length > 0 || launcherFileSearchLoading);
      return;
    }

    const localMatch = query.trim().match(/^local(?:\s+([\s\S]*))?$/i);
    if (localMatch) {
      const localQuery = (localMatch[1] ?? '').trim();
      const localQueryLower = localQuery.toLowerCase();
      const commandMatches = (localQuery
        ? commandItems
            .map(item => ({ item, score: scoreLauncherSearchableItem(item, localQueryLower) }))
            .filter(({ score }) => score > 0)
            .sort((a, b) => {
              const pinnedDelta = Number(Boolean(b.item.isPinned)) - Number(Boolean(a.item.isPinned));
              if (pinnedDelta !== 0) return pinnedDelta;
              const recencyDelta = getLauncherItemRecency(b.item) - getLauncherItemRecency(a.item);
              return recencyDelta || b.score - a.score;
            })
            .map(({ item }) => item)
        : commandItems.slice().sort(compareLauncherItemsByRecency))
        .slice(0, 12)
        .map(item => ({
          ...item,
          id: `local-${item.id}`,
          type: 'local-command' as const,
          displayName: `Run locally: ${item.displayName || item.name}`,
          keywords: [...item.keywords, 'local', 'gemma', 'offline'],
          localCommandName: item.name,
        }));

      const exactCommandMatch = localQuery
        ? commandMatches.some(item =>
            item.localCommandName?.toLowerCase() === localQueryLower ||
            item.displayName.toLowerCase() === `run locally: ${localQueryLower}`
          )
        : false;
      const customInstructionItem: LauncherItem[] = localQuery
        ? [{
            id: `local-instruction-${localQuery}`,
            type: 'local-instruction',
            name: localQuery,
            displayName: `Run local instruction: ${localQuery}`,
            keywords: ['local', 'custom', 'instruction', localQuery],
            localInstruction: localQuery,
            hotkeyDisplay: 'custom',
          }]
        : [];
      const results = exactCommandMatch
        ? [...commandMatches, ...customInstructionItem]
        : [...customInstructionItem, ...commandMatches];
      applyFilteredResults(results.slice(0, 14));
      selectIndex(0);
      resizeForResults(results.length, true);
      return;
    }

    if (moveSource) {
      const results = filterLauncherMoveTargetDirectories(directoryItems, moveSource, q);
      applyFilteredResults(results);
      selectIndex(0);
      resizeForResults(results.length, true);
      return;
    }

    if (directoryNamespace) {
      const results = filterLauncherDirectoryNamespaceItems(
        [...libraryMarkdownSearchItems, ...artifactReadings, ...commandItems],
        directoryNamespace,
        q,
      );
      applyFilteredResults(results);
      selectIndex(0);
      resizeForResults(results.length, true);
      return;
    }

    if (authorNamespace) {
      const results = filterLauncherNamespaceItems(authorBookmarkItems, q);
      applyFilteredResults(results);
      selectIndex(0);
      resizeForResults(results.length, true);
      return;
    }

    if (bookmarkNamespace) {
      const pool = bookmarkNamespace.kind === 'all'
        ? [...bookmarkAuthorItems, ...bookmarkFacetItems, ...(bookmarkNamespaceItems.length > 0 ? bookmarkNamespaceItems : bookmarkPostItems)]
        : bookmarkNamespaceItems;
      const results = filterLauncherNamespaceItems(pool, q);
      applyFilteredResults(results);
      selectIndex(0);
      resizeForResults(results.length, true);
      return;
    }

    if (namespacePrefix) {
      const pool = namespacePrefix === 'wiki'
        ? [...directoryItems, ...libraryMarkdownSearchItems]
        : namespacePrefix === 'actions'
          ? actionItems
          : artifactReadings;
      const results = dedupeLauncherPersonItems(filterLauncherNamespaceItems(pool, q));
      applyFilteredResults(results.slice(0, 20));
      selectIndex(0);
      resizeForResults(results.length, true);
      return;
    }

    const areaActionId = getLauncherAreaActionIdForQuery(q);
    if (areaActionId) {
      const areaAction = allItems.find((item) => item.type === 'action' && item.actionId === areaActionId);
      applyFilteredResults(areaAction ? [areaAction] : []);
      selectIndex(0);
      resizeForResults(areaAction ? 1 : 0);
      return;
    }

    const balancedMatches = getNormalModeMatches(q);
    const fallback = localInstructionFallbackForQuery(query, balancedMatches.length);
    const results = fallback ? [fallback] : balancedMatches;

    applyFilteredResults(results);
    selectIndex(0);

    // Resize window.
    resizeForResults(results.length, true);
    traceLauncher('filter-results', {
      queryLength: query.length,
      namespacePrefix: namespacePrefix ?? null,
      hasDirectoryNamespace: Boolean(directoryNamespace),
      hasMoveSource: Boolean(moveSource),
      hasAuthorNamespace: Boolean(authorNamespace),
      hasBookmarkNamespace: Boolean(bookmarkNamespace),
      resultCount: results.length,
      usedLocalInstructionFallback: Boolean(fallback),
      totalResultCount: balancedMatches.length,
      allItemCount: allItems.length,
      commandItemCount: commandItems.length,
      actionItemCount: actionItems.length,
      libraryMarkdownItemCount: libraryMarkdownSearchItems.length,
      artifactItemCount: artifactReadings.length,
      bookmarkAuthorItemCount: bookmarkAuthorItems.length,
      bookmarkFacetItemCount: bookmarkFacetItems.length,
      bookmarkPostItemCount: bookmarkPostItems.length,
      recentFileItemCount: recentFileItems.length,
      fileItemCount: fileItems.length,
      launcherDataLoading,
      elapsedMs: Math.round((performance.now() - filterStartedAt) * 10) / 10,
    });
  }, [committedItemId, namespacePrefix, directoryNamespace, authorNamespace, bookmarkNamespace, moveSource, query, allItems, isHelpQuery, fileSearchQuery, fileSearchEnabled, fileItems, launcherFileSearchLoading, clipboardSearchQuery, clipboardLauncherItems, clipboardSearchLoading, directoryItems, libraryMarkdownSearchItems, artifactReadings, actionItems, commandItems, authorBookmarkItems, bookmarkAuthorItems, bookmarkFacetItems, bookmarkNamespaceItems, bookmarkPostItems, recentFileItems, localInstructionFallbackForQuery, resizeLauncher, selectIndex, launcherDataLoading, getNormalModeMatches, applyFilteredResults]);

  // Reset navigation flag when filtered results change.
  useEffect(() => {
    hasNavigatedRef.current = false;
    hasExplicitSelectionRef.current = false;
    setHasExplicitSelection(false);
    // Also reset scroll position when results change.
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [filtered]);

  // Scroll selected item into view when selection changes via keyboard.
  // Only scroll if the item is outside the visible area of the list.
  useEffect(() => {
    // Only scroll if user has navigated with arrow keys.
    if (!hasNavigatedRef.current) return;
    if (!listRef.current || filtered.length === 0) return;

    const list = listRef.current;
    const selectedItem = list.querySelector(`[data-item-index="${selectedIndex}"]`) as HTMLElement | null;
    if (!selectedItem) return;

    // Get positions relative to the list container.
    const listTop = list.scrollTop;
    const listBottom = listTop + list.clientHeight;
    const itemTop = selectedItem.offsetTop;
    const itemBottom = itemTop + selectedItem.offsetHeight;

    // Check if item is above visible area.
    if (itemTop < listTop) {
      list.scrollTop = itemTop;
    }
    // Check if item is below visible area.
    else if (itemBottom > listBottom) {
      list.scrollTop = itemBottom - list.clientHeight;
    }
    // Otherwise, item is visible - don't scroll.
  }, [selectedIndex, filtered.length]);

  const getFieldTheoryTarget = useCallback((item: LauncherItem): FieldTheoryMarkdownTarget | null => (
    getLauncherFieldTheoryMarkdownTarget(item)
  ), []);

  const getWikiLinkText = useCallback((item: LauncherItem): string => {
    const target = (item.type === 'command' ? item.name : item.displayName).trim();
    return `[[${target.replace(/\]/g, '\\]')}]]`;
  }, []);

  const dismissPreview = useCallback(() => {
    if (previewOpen || previewWindowWasOpenRef.current) {
      traceLauncher('preview-close', { source: 'invoke' });
    }
    manualPreviewRef.current = false;
    previewRequestRef.current += 1;
    setPreviewOpen(false);
    setPreviewPayload(null);
    commandsAPI.launcherPreviewHide?.();
    previewWindowWasOpenRef.current = false;
  }, [previewOpen]);

  const openMovedLibraryFile = useCallback(async (
    source: LauncherLibraryMoveSource,
    target: LauncherMoveDirectoryTarget,
    movedRelPath: string,
  ) => {
    const path = getLauncherMovedFilePath(source, movedRelPath, target.targetRootPath, target.targetType);
    const result = await commandsAPI.openFieldTheoryMarkdown({
      kind: target.targetType,
      path,
    });
    if (!result.success) {
      traceLauncher('move-open-moved-file-error', { error: result.error ?? 'Open failed', path });
    }
  }, []);

  const moveLibraryFileToDirectory = useCallback(async (
    source: LauncherLibraryMoveSource,
    directory: LauncherItem,
  ): Promise<boolean> => {
    const closeGeneration = launcherGenerationRef.current;
    const target = getLauncherMoveDirectoryTarget(source, directory);
    if (!target) {
      showLauncherMessage('Choose a Library folder');
      return false;
    }
    const movedRelPath = await libraryAPI?.moveItem?.(
      target.sourceRootPath,
      'file',
      source.relPath,
      target.targetDirRelPath,
      target.targetRootPath,
    );
    if (!movedRelPath) {
      showLauncherMessage('Move failed');
      return false;
    }
    setLastLibraryMove({ source, target, movedRelPath });
    setMoveSource(null);
    setQuery('');
    setFiltered([]);
    selectIndex(0);
    resizeLauncher(LAUNCHER_COLLAPSED_HEIGHT);
    await loadLibraryMarkdown();
    await openMovedLibraryFile(source, target, movedRelPath);
    prepareLauncherForNextOpen();
    commandsAPI.launcherClose({ skipActivation: true, generation: closeGeneration });
    return true;
  }, [loadLibraryMarkdown, openMovedLibraryFile, prepareLauncherForNextOpen, resizeLauncher, selectIndex, showLauncherMessage]);

  const undoLastLibraryMove = useCallback(async (): Promise<boolean> => {
    const closeGeneration = launcherGenerationRef.current;
    if (!lastLibraryMove) {
      showLauncherMessage('No move to undo');
      return false;
    }
    const originalParentRelPath = getLauncherMoveUndoTargetDirRelPath(lastLibraryMove.source.relPath);
    const restoredRelPath = await libraryAPI?.moveItem?.(
      lastLibraryMove.target.targetRootPath,
      'file',
      lastLibraryMove.movedRelPath,
      originalParentRelPath,
      lastLibraryMove.source.rootPath,
    );
    if (!restoredRelPath) {
      showLauncherMessage('Undo move failed');
      return false;
    }
    setLastLibraryMove(null);
    setQuery('');
    setFiltered([]);
    resizeLauncher(LAUNCHER_COLLAPSED_HEIGHT);
    await loadLibraryMarkdown();
    await openMovedLibraryFile(
      lastLibraryMove.source,
      {
        sourceRootPath: lastLibraryMove.target.targetRootPath,
        targetRootPath: lastLibraryMove.source.rootPath,
        targetDirRelPath: originalParentRelPath,
        targetType: lastLibraryMove.source.type,
      },
      restoredRelPath,
    );
    prepareLauncherForNextOpen();
    commandsAPI.launcherClose({ skipActivation: true, generation: closeGeneration });
    return true;
  }, [lastLibraryMove, loadLibraryMarkdown, openMovedLibraryFile, prepareLauncherForNextOpen, resizeLauncher, showLauncherMessage]);

  const openClipboardLauncherItem = useCallback(async (item: LauncherItem): Promise<void> => {
    if (item.type !== 'clipboard-item' && item.type !== 'clipboard-stack') return;
    const result = await commandsAPI.openFieldTheoryMarkdown({
      kind: 'clipboard',
      path: 'clipboard',
      clipboardItemId: item.clipboardItemId,
      clipboardStackId: item.clipboardStackId,
      clipboardSearch: item.clipboardSearch ?? '',
    });
    if (!result.success) {
      showLauncherMessage(result.error ?? 'Open clipboard failed');
    }
  }, [showLauncherMessage]);

  const getClipboardLauncherStackItemIds = useCallback(async (item: LauncherItem): Promise<number[]> => {
    if (item.type !== 'clipboard-stack' || item.clipboardRow?.type !== 'stack') return [];
    const row = item.clipboardRow;
    if (row.stack.itemCount <= row.items.length || !item.clipboardStackId) {
      return row.items.map(stackItem => stackItem.id);
    }
    const hydrated = await fetchClipboardStackItemsById([item.clipboardStackId]);
    return (hydrated[item.clipboardStackId] ?? row.items).map(stackItem => stackItem.id);
  }, [fetchClipboardStackItemsById]);

  const getClipboardLauncherItemIds = useCallback(async (item: LauncherItem | undefined): Promise<number[]> => {
    if (!item) return [];
    if (item.type === 'clipboard-item' && typeof item.clipboardItemId === 'number') return [item.clipboardItemId];
    if (item.type === 'clipboard-stack') return getClipboardLauncherStackItemIds(item);
    return [];
  }, [getClipboardLauncherStackItemIds]);

  const refreshClipboardLauncherResults = useCallback(async () => {
    if (clipboardSearchQuery === null) return;
    await loadClipboardLauncherResults(clipboardSearchQuery);
  }, [clipboardSearchQuery, loadClipboardLauncherResults]);

  const toggleClipboardLauncherSelection = useCallback(async (item: LauncherItem | undefined) => {
    const itemIds = await getClipboardLauncherItemIds(item);
    if (itemIds.length === 0) return;
    setClipboardSelectedItemIds((prev) => {
      const next = new Set(prev);
      const allSelected = itemIds.every(id => next.has(id));
      if (allSelected) itemIds.forEach(id => next.delete(id));
      else itemIds.forEach(id => next.add(id));
      return next;
    });
  }, [getClipboardLauncherItemIds]);

  const stackClipboardLauncherSelection = useCallback(async () => {
    if (!clipboardAPI.updateStackId || clipboardSelectedItemIds.size < 2) return;
    const itemIds = Array.from(clipboardSelectedItemIds);
    const newStackId = crypto.randomUUID();
    await clipboardAPI.updateStackId(itemIds, newStackId);
    setClipboardSelectedItemIds(new Set());
    await refreshClipboardLauncherResults();
  }, [clipboardSelectedItemIds, refreshClipboardLauncherResults]);

  const unstackClipboardLauncherItem = useCallback(async (item: LauncherItem | undefined) => {
    if (!clipboardAPI.updateStackId || !item) return;
    if (item.type === 'clipboard-stack') {
      const itemIds = await getClipboardLauncherStackItemIds(item);
      if (itemIds.length < 2) return;
      await clipboardAPI.updateStackId(itemIds, null);
      setClipboardSelectedItemIds(new Set());
      await refreshClipboardLauncherResults();
      return;
    }
    if (item.type === 'clipboard-item' && typeof item.clipboardItemId === 'number') {
      const previousStackId = item.clipboardRow?.type === 'item'
        ? item.clipboardRow.item.stackId
        : null;
      if (!previousStackId) return;
      await clipboardAPI.updateStackId([item.clipboardItemId], null);
      setClipboardSelectedItemIds((prev) => {
        const next = new Set(prev);
        next.delete(item.clipboardItemId as number);
        return next;
      });
      await refreshClipboardLauncherResults();
    }
  }, [getClipboardLauncherStackItemIds, refreshClipboardLauncherResults]);

  const applyClipboardLauncherDrop = useCallback(async (activeId: string, overId: string) => {
    if (!clipboardAPI.updateStackId || activeId === overId) return;
    const [activeType, activeValue] = activeId.split(':');
    const [overType, overValue] = overId.split(':');

    if (activeType === 'item') {
      const draggedItemId = Number(activeValue);
      if (!Number.isFinite(draggedItemId)) return;
      if (overType === 'stack') {
        await clipboardAPI.updateStackId([draggedItemId], overValue);
      } else if (overType === 'item') {
        const targetItemId = Number(overValue);
        if (!Number.isFinite(targetItemId) || draggedItemId === targetItemId) return;
        await clipboardAPI.updateStackId([draggedItemId, targetItemId], crypto.randomUUID());
      }
    } else if (activeType === 'stack') {
      if (overType === 'stack' && activeValue !== overValue) {
        const stackItems = await clipboardAPI.queryItemsByStackId?.(activeValue);
        const itemIds = stackItems?.map(item => item.id) ?? [];
        if (itemIds.length > 0) await clipboardAPI.updateStackId(itemIds, overValue);
      } else if (overType === 'item') {
        const targetItemId = Number(overValue);
        if (!Number.isFinite(targetItemId)) return;
        await clipboardAPI.updateStackId([targetItemId], activeValue);
      }
    }

    setClipboardSelectedItemIds(new Set());
    await refreshClipboardLauncherResults();
  }, [refreshClipboardLauncherResults]);

  const enterLauncherSource = useCallback((sourceId: LauncherSourceId) => {
    setDirectoryNamespace(null);
    setAuthorNamespace(null);
    setBookmarkNamespace(null);
    setMoveSource(null);
    setBookmarkNamespaceBookmarks([]);
    setBookmarkNamespaceItems([]);
    if (sourceId === 'bookmarks') {
      setNamespacePrefix(null);
      setBookmarkNamespace({ kind: 'all', label: 'bookmarks' });
    } else {
      setNamespacePrefix(sourceId);
    }
    setQuery('');
    selectIndex(0);
  }, [selectIndex]);

  // Handle keyboard navigation.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const plainKey = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (previewOpen) {
        traceLauncher('preview-close', { source: 'escape' });
        manualPreviewRef.current = false;
        previewRequestRef.current += 1;
        setPreviewOpen(false);
        setPreviewPayload(null);
        return;
      }
      prepareLauncherForNextOpen();
      commandsAPI.launcherClose({ generation: launcherGenerationRef.current });
    } else if (shouldExitLauncherClipboardSearch({ active: clipboardSearchActive, query, key: e.key })) {
      e.preventDefault();
      setClipboardSearchActive(false);
      setFiltered([]);
      selectIndex(0);
      resizeLauncher(LAUNCHER_COLLAPSED_HEIGHT);
    } else if (clipboardSearchQuery !== null && plainKey && e.key === 'x') {
      e.preventDefault();
      const selectedItem = filtered[resolveHighlightedLauncherIndex(selectedIndexRef.current, filtered.length)];
      void toggleClipboardLauncherSelection(selectedItem);
    } else if (clipboardSearchQuery !== null && plainKey && e.key === 's') {
      e.preventDefault();
      void stackClipboardLauncherSelection();
    } else if (clipboardSearchQuery !== null && plainKey && e.key === 'u') {
      e.preventDefault();
      const selectedItem = filtered[resolveHighlightedLauncherIndex(selectedIndexRef.current, filtered.length)];
      void unstackClipboardLauncherItem(selectedItem);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filtered.length === 0) return;
      hasNavigatedRef.current = true;
      manualPreviewRef.current = false;
      const nextIndex = nextLauncherArrowIndex(selectedIndexRef.current, filtered.length, 'down');
      hasExplicitSelectionRef.current = true;
      setHasExplicitSelection(true);
      selectIndex(nextIndex);
      if (previewOpen) {
        traceLauncher('preview-selection', {
          source: 'arrow-down',
          selectedIndex: nextIndex,
          item: describeLauncherItem(filtered[nextIndex]),
        });
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filtered.length === 0) return;
      hasNavigatedRef.current = true;
      manualPreviewRef.current = false;
      if (shouldReturnLauncherSelectionToInput(selectedIndexRef.current, filtered.length, hasExplicitSelectionRef.current)) {
        hasExplicitSelectionRef.current = false;
        setHasExplicitSelection(false);
        selectIndex(0);
        return;
      }
      if (!hasExplicitSelectionRef.current) return;
      const nextIndex = nextLauncherArrowIndex(selectedIndexRef.current, filtered.length, 'up');
      hasExplicitSelectionRef.current = true;
      setHasExplicitSelection(true);
      selectIndex(nextIndex);
      if (previewOpen) {
        traceLauncher('preview-selection', {
          source: 'arrow-up',
          selectedIndex: nextIndex,
          item: describeLauncherItem(filtered[nextIndex]),
        });
      }
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const rawQuery = query.trim();
      const q = rawQuery.toLowerCase();
      const currentIndex = selectedIndexRef.current;

      if (clipboardSearchQuery !== null) {
        const selectedItem = filtered[currentIndex];
        if (selectedItem) void openClipboardLauncherItem(selectedItem);
        return;
      }

      if (moveSource) return;

      const selectedForTab = filtered[currentIndex];
      const selectedSource = selectedForTab?.type === 'source' ? selectedForTab : null;
      const typedSource = !hasExplicitSelectionRef.current && selectedForTab?.type !== 'command'
        ? sourceItems.find(item => item.name === q || (q.length > 0 && item.name.startsWith(q)))
        : null;
      const sourceTarget = selectedSource ?? typedSource;
      if (sourceTarget?.sourceId) {
        enterLauncherSource(sourceTarget.sourceId);
        return;
      }

      if (hasExplicitSelectionRef.current && selectedForTab?.type === 'directory' && selectedForTab.directoryPath) {
        setDirectoryNamespace({
          label: selectedForTab.displayName,
          directoryPath: selectedForTab.directoryPath,
          directoryRelPath: selectedForTab.directoryRelPath,
        });
        setQuery('');
        selectIndex(0);
        return;
      }

      if (hasExplicitSelectionRef.current && selectedForTab?.type === 'file' && selectedForTab.isDirectory && selectedForTab.filePath) {
        setDirectoryNamespace({
          label: selectedForTab.displayName,
          directoryPath: selectedForTab.filePath,
        });
        setQuery('');
        selectIndex(0);
        return;
      }

      if (hasExplicitSelectionRef.current) {
        const selectedFieldTheoryTarget = resolveLauncherFieldTheoryOpenTarget(
          filtered,
          allItems,
          currentIndex,
          rawQuery,
          true,
        );
        if (selectedFieldTheoryTarget) {
          void invokeItem(selectedFieldTheoryTarget, { openFieldTheoryTarget: true });
          return;
        }
      }

      if (fileSearchQuery !== null) return;

      const commandTarget = resolveLauncherCommandOpenTarget(
        filtered,
        commandItems,
        currentIndex,
        rawQuery,
        hasExplicitSelectionRef.current,
      );
      if (commandTarget) {
        void invokeItem(commandTarget, { openFieldTheoryTarget: true });
        return;
      }

      const directory = resolveLauncherDirectoryNamespace(filtered, directoryItems, currentIndex, rawQuery);
      if (directory?.directoryPath) {
        setDirectoryNamespace({
          label: directory.displayName,
          directoryPath: directory.directoryPath,
          directoryRelPath: directory.directoryRelPath,
        });
        setQuery('');
        selectIndex(0);
        return;
      }

      const fieldTheoryTarget = resolveLauncherFieldTheoryOpenTarget(
        filtered,
        allItems,
        currentIndex,
        rawQuery,
        hasExplicitSelectionRef.current,
      );
      if (fieldTheoryTarget) {
        void invokeItem(fieldTheoryTarget, { openFieldTheoryTarget: true });
        return;
      }

      if (namespacePrefix || directoryNamespace || authorNamespace || bookmarkNamespace) {
        const directory = namespacePrefix === 'wiki'
          ? resolveLauncherDirectoryNamespace(filtered, directoryItems, currentIndex, rawQuery)
          : null;
        if (directory?.directoryPath) {
          setDirectoryNamespace({
            label: directory.displayName,
            directoryPath: directory.directoryPath,
            directoryRelPath: directory.directoryRelPath,
          });
          setNamespacePrefix(null);
          setBookmarkNamespace(null);
          setAuthorNamespace(null);
          setQuery('');
          selectIndex(0);
          return;
        }

        const bookmarkFacet = bookmarkNamespace
          ? resolveLauncherBookmarkFacetNamespace(filtered, bookmarkFacetItems, currentIndex, rawQuery)
          : null;
        if (bookmarkFacet?.facetPaths?.length) {
          setBookmarkNamespace({ kind: 'facet', label: bookmarkFacet.displayName, paths: bookmarkFacet.facetPaths });
          setQuery('');
          selectIndex(0);
          return;
        }

        const authorHandle = bookmarkNamespace
          ? resolveLauncherAuthorNamespaceHandle(filtered, bookmarkAuthorItems, currentIndex, rawQuery)
          : null;
        if (authorHandle) {
          setNamespacePrefix(null);
          setDirectoryNamespace(null);
          setBookmarkNamespace(null);
          setAuthorNamespace(authorHandle);
          setQuery('');
          selectIndex(0);
        }
        return;
      }

      for (const prefix of NAMESPACE_PREFIXES) {
        if (prefix.startsWith(q) && q.length > 0) {
          enterLauncherSource(prefix);
          return;
        }
      }

    } else if (shouldHandleLauncherPreviewShortcut(e, hasExplicitSelectionRef.current, previewOpen)) {
      const currentIndex = selectedIndexRef.current;
      const selectedItem = filtered[currentIndex];
      traceLauncher('preview-key', {
        key: e.key,
        code: e.code,
        previewOpen,
        query: query.trim(),
        namespaceLabel: namespaceLabel ?? null,
        filteredCount: filtered.length,
        reactSelectedIndex: selectedIndex,
        refSelectedIndex: currentIndex,
        selectedItem: describeLauncherItem(selectedItem),
        activeElement: document.activeElement?.tagName ?? null,
      });
      if (previewOpen) {
        e.preventDefault();
        traceLauncher('preview-close', { source: 'space' });
        manualPreviewRef.current = false;
        previewRequestRef.current += 1;
        setPreviewOpen(false);
        setPreviewPayload(null);
        return;
      }
      if (bookmarkForItem(selectedItem) || markdownPreviewPathForItem(selectedItem) || clipboardPreviewContentForItem(selectedItem)) {
        e.preventDefault();
        selectIndex(currentIndex);
        traceLauncher('preview-open-item', {
          selectedIndex: currentIndex,
          item: describeLauncherItem(selectedItem),
        });
        manualPreviewRef.current = false;
        setPreviewOpen(true);
        return;
      }
      const authorHandle = resolveLauncherAuthorNamespaceHandle(filtered, bookmarkAuthorItems, currentIndex, query.trim());
      if (authorHandle) {
        e.preventDefault();
        traceLauncher('preview-open-author', {
          authorHandle,
          selectedIndex: currentIndex,
          item: describeLauncherItem(selectedItem),
        });
        setAuthorNamespace(authorHandle);
        setQuery('');
        selectIndex(0);
        setPreviewOpen(true);
        return;
      }
      traceLauncher('preview-key-noop', {
        reason: 'selected-item-not-previewable',
        selectedIndex: currentIndex,
        item: describeLauncherItem(selectedItem),
      });
    } else if (e.key === 'Backspace' && (namespacePrefix || directoryNamespace || authorNamespace || bookmarkNamespace || moveSource) && query === '') {
      e.preventDefault();
      authorNamespaceRef.current = null;
      bookmarkNamespaceRef.current = null;
      authorBookmarkRequestRef.current += 1;
      bookmarkNamespaceRequestRef.current += 1;
      manualPreviewRef.current = false;
      setNamespacePrefix(null);
      setDirectoryNamespace(null);
      setAuthorNamespace(null);
      setBookmarkNamespace(null);
      setMoveSource(null);
      previewRequestRef.current += 1;
      setPreviewOpen(false);
      setPreviewPayload(null);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const rawQuery = query.trim();
      const inScopedMode = Boolean(namespacePrefix || directoryNamespace || authorNamespace || bookmarkNamespace || moveSource);
      if (filtered.length > 0) {
        const currentIndex = resolveHighlightedLauncherIndex(selectedIndexRef.current, filtered.length);
        const selectedItem = filtered[currentIndex];
        traceLauncher('enter-key', {
          query: rawQuery,
          namespaceLabel: namespaceLabel ?? null,
          inScopedMode,
          filteredCount: filtered.length,
          selectedIndex: currentIndex,
          selectedItem: describeLauncherItem(selectedItem),
          hasExplicitSelection: hasExplicitSelectionRef.current,
        });
        if (selectedItem?.type === 'local-instruction' && !inScopedMode) {
          const normalMatch = getNormalModeMatches(rawQuery)[0];
          if (normalMatch) {
            invokeItem(normalMatch, { insertWikiLink: normalMatch.type !== 'command' });
            return;
          }
        }
        if (selectedItem) invokeItem(selectedItem, { insertWikiLink: selectedItem.type !== 'command' });
        return;
      }
      const normalMatch = inScopedMode ? null : getNormalModeMatches(rawQuery)[0];
      if (normalMatch) {
        traceLauncher('enter-key-resolved-normal-match', {
          query: rawQuery,
          selectedItem: describeLauncherItem(normalMatch),
        });
        invokeItem(normalMatch, { insertWikiLink: normalMatch.type !== 'command' });
        return;
      }
      const commandTarget = inScopedMode
        ? null
        : resolveLauncherCommandOpenTarget([], commandItems, 0, rawQuery, false);
      if (commandTarget) {
        traceLauncher('enter-key-resolved-command', {
          query: rawQuery,
          selectedItem: describeLauncherItem(commandTarget),
        });
        invokeItem(commandTarget, { insertWikiLink: false });
        return;
      }
      const fallback = localInstructionFallbackForQuery(rawQuery, 0, inScopedMode);
      if (fallback) {
        invokeItem(fallback);
      }
    }
  };

  // Invoke the selected item.
  const invokeItem = useCallback(async (item: LauncherItem, options: { insertWikiLink?: boolean; openFieldTheoryTarget?: boolean } = {}) => {
    const invocationGeneration = launcherGenerationRef.current;
    const closeForInvocation = (closeOptions: Omit<LauncherCloseOptions, 'generation'> = {}) => {
      prepareLauncherForNextOpen();
      commandsAPI.launcherClose({ ...closeOptions, generation: invocationGeneration });
    };
    const visibilityPolicy = getLauncherInvocationVisibilityPolicy({
      itemType: item.type,
      openFieldTheoryTarget: options.openFieldTheoryTarget,
      insertWikiLink: options.insertWikiLink,
    });
    const willPastePortableCommand = shouldPastePortableCommand({
      itemType: item.type,
      openFieldTheoryTarget: options.openFieldTheoryTarget,
      insertWikiLink: options.insertWikiLink,
    });
    if (visibilityPolicy.suppressRevealDuringBlur) {
      launcherClosingForInvocationRef.current = true;
      flushSync(() => {
        setCommittedItemId(item.id);
        setLauncherSessionReady(false);
      });
    } else {
      setCommittedItemId(item.id);
    }
    if (item.type !== 'local-instruction') {
      noteItemUsage(item.id);
    }
    dismissPreview();
    const showInvocationError = (event: string, error: string | undefined, fallback: string) => {
      const message = error ?? fallback;
      traceLauncher(event, { error: message });
      launcherClosingForInvocationRef.current = false;
      setCommittedItemId(null);
      setLauncherSessionReady(true);
      setQuery(message);
      setFiltered([]);
      resizeLauncher(LAUNCHER_COLLAPSED_HEIGHT);
    };
    const openMeetingResult = async (
      result: LauncherMeetingActionResult,
      errorEvent: string,
      fallback: string,
    ): Promise<boolean> => {
      if (!result.success) {
        showInvocationError(errorEvent, result.error ?? result.summaryError, fallback);
        return false;
      }
      if (result.openTarget) {
        const openResult = await commandsAPI.openFieldTheoryMarkdown(result.openTarget);
        if (!openResult.success) {
          showInvocationError(`${errorEvent}-open`, openResult.error, 'Open meeting failed');
          return false;
        }
        return true;
      }
      closeForInvocation({ skipActivation: true });
      return true;
    };
    const latestContext = await commandsAPI.getLauncherContext().catch(() => ({ fieldTheoryActive: false, targetApp: null }));
    if (item.type === 'source' && item.sourceId) {
      traceLauncher('invoke-source-scope', { sourceId: item.sourceId });
      setCommittedItemId(null);
      enterLauncherSource(item.sourceId);
      return;
    }
    const shouldResolveFieldTheoryTarget = options.openFieldTheoryTarget || latestContext?.fieldTheoryActive;
    const fieldTheoryTarget = shouldResolveFieldTheoryTarget ? getFieldTheoryTarget(item) : null;
    traceLauncher('invoke-item', {
      item: describeLauncherItem(item),
      fieldTheoryActive: latestContext?.fieldTheoryActive ?? false,
      targetBundleId: latestContext?.targetApp?.bundleId ?? null,
      targetName: latestContext?.targetApp?.name ?? null,
      hasFieldTheoryTarget: !!fieldTheoryTarget,
      openFieldTheoryTarget: options.openFieldTheoryTarget ?? false,
      insertWikiLink: options.insertWikiLink ?? false,
    });
    if (item.type === 'clipboard-item' || item.type === 'clipboard-stack') {
      if (latestContext?.fieldTheoryActive && commandsAPI.insertClipboardItemsAsMarkdown) {
        const itemIds = item.type === 'clipboard-stack'
          ? await getClipboardLauncherStackItemIds(item)
          : typeof item.clipboardItemId === 'number'
            ? [item.clipboardItemId]
            : [];
        const result = itemIds.length > 0
          ? await commandsAPI.insertClipboardItemsAsMarkdown(itemIds).catch((error) => ({
            success: false,
            error: error instanceof Error ? error.message : 'Insert failed',
          }))
          : { success: false, error: 'Clipboard item not found' };
        if (!result.success) {
          showInvocationError('insert-clipboard-markdown-error', result.error, 'Insert failed');
          return;
        }
        prepareLauncherForNextOpen({ revealWhenReady: visibilityPolicy.revealWhenReadyAfterSuccess });
        return;
      }
      const targetBundleId = latestContext?.targetApp?.bundleId;
      if (!targetBundleId) {
        showInvocationError('paste-clipboard-launcher-no-target', 'No external target app available', 'No external target app available');
        return;
      }
      if (item.type === 'clipboard-stack') {
        const itemIds = await getClipboardLauncherStackItemIds(item);
        if (itemIds.length > 0) {
          await clipboardAPI.pasteStack?.(itemIds, targetBundleId);
        }
      } else if (typeof item.clipboardItemId === 'number') {
        const clipboardItem = item.clipboardRow?.type === 'item' ? item.clipboardRow.item : null;
        await clipboardAPI.pasteItem(item.clipboardItemId, targetBundleId, clipboardItem?.useImprovedVersion);
      }
      prepareLauncherForNextOpen({ revealWhenReady: visibilityPolicy.revealWhenReadyAfterSuccess });
      if (visibilityPolicy.closeFromRendererAfterSuccess) {
        commandsAPI.launcherClose({ skipActivation: true, generation: invocationGeneration });
      }
      return;
    }
    if (willPastePortableCommand) {
      traceLauncher('invoke-command-paste-request', {
        commandName: item.name,
        fieldTheoryActive: latestContext?.fieldTheoryActive ?? false,
      });
      const result = await commandsAPI.invokeCommand(item.name).catch((error) => ({
        success: false,
        error: error instanceof Error ? error.message : 'Command paste failed',
      }));
      if (!result.success) {
        showInvocationError('invoke-command-renderer-error', result.error, 'Command paste failed');
        return;
      }
      prepareLauncherForNextOpen({ revealWhenReady: visibilityPolicy.revealWhenReadyAfterSuccess });
      return;
    }
    if (item.type === 'local-command' || item.type === 'local-instruction') {
      if (!latestContext?.fieldTheoryActive) {
        showInvocationError('run-local-command-no-field-theory', 'Open a Field Theory document to run locally', 'Open a Field Theory document to run locally');
        return;
      }
      void commandsAPI.runLocalCommand(item.type === 'local-instruction'
        ? { customInstruction: item.localInstruction }
        : { commandName: item.localCommandName ?? item.name }
      ).catch((error) => ({
        success: false,
        error: error instanceof Error ? error.message : 'Local command failed',
      })).then((result) => {
        if (!result.success) traceLauncher('run-local-command-error', { error: result.error ?? 'Local command failed' });
      });
      closeForInvocation({ skipActivation: true });
      return;
    }
    if (options.openFieldTheoryTarget && !fieldTheoryTarget) return;
    if (fieldTheoryTarget) {
      if (options.openFieldTheoryTarget) {
        const result = await commandsAPI.openFieldTheoryMarkdown(fieldTheoryTarget);
        if (!result.success) {
          showInvocationError('open-field-theory-target-error', result.error, 'Open failed');
        }
        return;
      }
      if (options.insertWikiLink) {
        const result = await commandsAPI.insertMarkdownText(getWikiLinkText(item)).catch((error) => ({
          success: false,
          error: error instanceof Error ? error.message : 'Insert failed',
        }));
        if (!result.success) {
          showInvocationError('insert-markdown-text-error', result.error, 'Insert failed');
        }
        return;
      }
      const result = await commandsAPI.openFieldTheoryMarkdown(fieldTheoryTarget);
      if (!result.success) {
        showInvocationError('open-field-theory-target-error', result.error, 'Open failed');
      }
      return;
    }

    if (item.type === 'directory') {
      if (moveSource) {
        await moveLibraryFileToDirectory(moveSource, item);
        return;
      }
      if (item.directoryPath) {
        setCommittedItemId(null);
        setDirectoryNamespace({
          label: item.displayName,
          directoryPath: item.directoryPath,
          directoryRelPath: item.directoryRelPath,
        });
        setQuery('');
        selectIndex(0);
      }
    } else if (item.type === 'bookmark-author') {
      if (item.authorHandle) {
        await bookmarksAPI?.invokeAuthorTimeline(item.authorHandle);
      }
      closeForInvocation();
    } else if (item.type === 'bookmark-facet') {
      if (item.facetPaths?.length) {
        setCommittedItemId(null);
        setBookmarkNamespace({ kind: 'facet', label: item.displayName, paths: item.facetPaths });
        setQuery('');
        selectIndex(0);
      }
    } else if (item.type === 'bookmark') {
      if (item.bookmarkId) {
        await bookmarksAPI?.invokeBookmark(item.bookmarkId);
      }
      closeForInvocation();
    } else if (item.type === 'recent-file') {
      if (item.filePath) {
        await commandsAPI.invokeHandoff(item.filePath);
      }
      closeForInvocation({ skipActivation: true });
    } else if (item.type === 'file') {
      if (!item.filePath) {
        showInvocationError('open-file-missing-path', 'File path missing', 'Open failed');
        return;
      }
      const result = await commandsAPI.openLauncherFile(item.filePath).catch((error) => ({
        success: false,
        error: error instanceof Error ? error.message : 'Open failed',
      }));
      if (!result.success) {
        showInvocationError('open-file-error', result.error, 'Open failed');
        return;
      }
      closeForInvocation({ skipActivation: true });
    } else if (item.type === 'wiki-page' || item.type === 'markdown-file' || item.type === 'artifact') {
      if (item.filePath) {
        await commandsAPI.invokeHandoff(item.filePath);
      }
      closeForInvocation({ skipActivation: true });
    } else if (item.type === 'handoff') {
      if (item.filePath) {
        await commandsAPI.invokeHandoff(item.filePath);
      }
      closeForInvocation({ skipActivation: true });
    } else if (item.type === 'action') {
      // Handle built-in actions.
      switch (item.actionId) {
        case 'take-screenshot':
          clipboardAPI.captureScreenshot?.(true);
          break;
        case 'open-history':
          {
            const result = await commandsAPI.openFieldTheoryMarkdown({ kind: 'clipboard', path: 'clipboard' });
            if (!result.success) {
              showInvocationError('open-clipboard-error', result.error, 'Open clipboard failed');
            }
          }
          return;
        case 'open-library': {
          const result = await commandsAPI.openFieldTheoryMarkdown({ kind: 'library', path: 'library' });
          if (!result.success) {
            showInvocationError('open-library-error', result.error, 'Open library failed');
          }
          return;
        }
        case 'toggle-line-numbers': {
          const result = await commandsAPI.toggleActiveLibraryLineNumbers?.();
          if (!result?.success) {
            showLauncherMessage(result?.error ?? 'Open Field Theory to toggle line numbers');
            return;
          }
          closeForInvocation({ skipActivation: true });
          return;
        }
        case 'open-commands': {
          const result = await commandsAPI.openFieldTheoryMarkdown({ kind: 'commands', path: 'commands' });
          if (!result.success) {
            showInvocationError('open-commands-error', result.error, 'Open library failed');
          }
          return;
        }
        case 'start-recording':
          transcribeAPI.toggleRecording?.();
          break;
        case 'new-meeting-note': {
          if (!commandsAPI.createMeetingNote) {
            showLauncherMessage('Meetings are unavailable');
            return;
          }
          const result = await commandsAPI.createMeetingNote();
          await openMeetingResult(result, 'new-meeting-note-error', 'Could not create meeting note');
          return;
        }
        case 'start-meeting-here': {
          if (!commandsAPI.startMeetingHere) {
            showLauncherMessage('Meetings are unavailable');
            return;
          }
          const result = await commandsAPI.startMeetingHere();
          await openMeetingResult(result, 'start-meeting-error', 'Could not start meeting');
          return;
        }
        case 'stop-meeting': {
          if (!commandsAPI.stopMeeting) {
            showLauncherMessage('Meetings are unavailable');
            return;
          }
          setQuery('Finalizing meeting...');
          setFiltered([]);
          resizeLauncher(LAUNCHER_COLLAPSED_HEIGHT);
          const result = await commandsAPI.stopMeeting();
          await openMeetingResult(result, 'stop-meeting-error', 'Could not stop meeting');
          return;
        }
        case 'summarize-meeting': {
          if (!commandsAPI.summarizeCurrentMeeting) {
            showLauncherMessage('Meetings are unavailable');
            return;
          }
          setQuery('Summarizing meeting...');
          setFiltered([]);
          resizeLauncher(LAUNCHER_COLLAPSED_HEIGHT);
          const result = await commandsAPI.summarizeCurrentMeeting();
          await openMeetingResult(result, 'summarize-meeting-error', 'Could not summarize meeting');
          return;
        }
        case 'toggle-theme':
          // Toggle dark/light mode
          (async () => {
            const currentIsDark = await themeAPI.getTheme();
            const nextIsDark = !currentIsDark;
            applyTheme(nextIsDark);
            await themeAPI.setTheme(nextIsDark);
          })();
          break;
        case 'save-current-website': {
          setQuery('Saving to markdown...');
          setFiltered([]);
          resizeLauncher(LAUNCHER_COLLAPSED_HEIGHT);
          const result = await bookmarksAPI?.saveActiveWebPage?.();
          if (!result?.success) {
            traceLauncher('save-current-website-error', { error: result?.error ?? 'Bookmarks API unavailable' });
            setQuery(result?.error ?? 'Bookmarks API unavailable');
            return;
          }
          const markdownPath = result.markdownPath ?? result.bookmark?.markdownPath;
          traceLauncher('save-current-website-success', {
            bookmarkId: result.bookmark?.id ?? null,
            markdownPath: markdownPath ?? null,
            created: result.created ?? null,
            url: result.page?.url ?? result.bookmark?.url ?? null,
          });
          await loadBookmarkPosts();

          if (!markdownPath) {
            setQuery('Saved, but no markdown path was returned');
            return;
          }

          const preview = await commandsAPI.getMarkdownPreview(markdownPath).catch(() => null);
          if (!preview) {
            setQuery('Saved, but preview could not be loaded');
            return;
          }

          manualPreviewRef.current = true;
          previewRequestRef.current += 1;
          setQuery('');
          setFiltered([]);
          selectIndex(0);
          resizeLauncher(LAUNCHER_COLLAPSED_HEIGHT);
          setPreviewPayload({
            kind: 'markdown',
            title: result.bookmark?.title || preview.title,
            filePath: preview.filePath,
            content: preview.content,
          });
          setPreviewOpen(true);
          return;
        }
        case 'view-bookmarks': {
          const result = await commandsAPI.openFieldTheoryMarkdown({ kind: 'bookmarks', path: 'bookmarks' });
          if (!result.success) {
            showInvocationError('open-bookmarks-error', result.error, 'Open bookmarks failed');
          }
          return;
        }
        case 'move-current-library-file': {
          if (!latestContext?.fieldTheoryActive) {
            showLauncherMessage('Open Field Theory to move the current file');
            setCommittedItemId(null);
            return;
          }
          const source = await commandsAPI.getActiveLibraryFileContext?.();
          if (!source) {
            showLauncherMessage('No current Library file to move');
            setCommittedItemId(null);
            return;
          }
          setCommittedItemId(null);
          setMoveSource(source);
          setQuery('');
          selectIndex(0);
          return;
        }
        case 'archive-current-library-file': {
          if (!latestContext?.fieldTheoryActive) {
            showLauncherMessage('Open Field Theory to archive the current file');
            return;
          }
          if (!commandsAPI.archiveActiveLibraryFile) {
            showLauncherMessage('Archive is unavailable');
            return;
          }
          const result = await commandsAPI.archiveActiveLibraryFile();
          if (!result.success) {
            showLauncherMessage(result.error ?? 'Archive failed');
            return;
          }
          await loadLibraryMarkdown();
          closeForInvocation({ skipActivation: true });
          return;
        }
        case 'undo-library-move': {
          await undoLastLibraryMove();
          return;
        }
        // Route Squares window management actions.
        default:
          if (item.actionId && SQUARES_ACTION_IDS.has(item.actionId)) {
            squaresAPI.executeAction(item.actionId, 'command-launcher');
          }
          break;
      }
      closeForInvocation();
    }
  }, [applyTheme, clipboardPreviewContentForItem, dismissPreview, enterLauncherSource, getClipboardLauncherStackItemIds, getFieldTheoryTarget, getWikiLinkText, loadLibraryMarkdown, loadBookmarkPosts, moveLibraryFileToDirectory, moveSource, noteItemUsage, prepareLauncherForNextOpen, resizeLauncher, selectIndex, showLauncherMessage, undoLastLibraryMove]);

  const openMainFieldTheoryWindow = useCallback(async () => {
    dismissPreview();
    traceLauncher('open-field-theory-icon-click');
    const result = await commandsAPI.openFieldTheoryMarkdown({ kind: 'library', path: 'library' }).catch((error) => ({
      success: false,
      error: error instanceof Error ? error.message : 'Open Field Theory failed',
    }));
    if (!result.success) {
      const message = result.error ?? 'Open Field Theory failed';
      traceLauncher('open-field-theory-icon-error', { error: message });
      showLauncherMessage(message);
    }
  }, [dismissPreview, showLauncherMessage]);

  if (isDarkMode === null) {
    return <div style={{ width: '100vw', height: '100vh', background: 'transparent' }} />;
  }

  const styles = getStyles(isDarkMode);
  const selectedItemStyle = (item: LauncherItem, index: number) => {
    if (item.id === committedItemId) return styles.listItemCommitted;
    if (index !== selectedIndex) return {};
    return hasExplicitSelection ? styles.listItemSelected : styles.listItemSelectedSoft;
  };
  const getClipboardLauncherDragId = (item: LauncherItem): string | null => {
    if (item.type === 'clipboard-item' && typeof item.clipboardItemId === 'number') return `item:${item.clipboardItemId}`;
    if (item.type === 'clipboard-stack' && item.clipboardStackId) return `stack:${item.clipboardStackId}`;
    return null;
  };
  const isClipboardLauncherMarked = (item: LauncherItem): boolean => {
    if (item.type === 'clipboard-item' && typeof item.clipboardItemId === 'number') {
      return clipboardSelectedItemIds.has(item.clipboardItemId);
    }
    if (item.type === 'clipboard-stack' && item.clipboardRow?.type === 'stack') {
      return item.clipboardRow.items.some(stackItem => clipboardSelectedItemIds.has(stackItem.id));
    }
    return false;
  };
  const namespaceTagStyle = (() => {
    if (!namespaceLabel) return styles.namespaceTag;
    const label = namespaceLabel.toLowerCase();
    const color = label.startsWith('move:')
      ? (isDarkMode ? 'rgba(234, 179, 8, 0.18)' : 'rgba(234, 179, 8, 0.14)')
      : label === 'clipboard'
        ? (isDarkMode ? 'rgba(45, 212, 191, 0.15)' : 'rgba(20, 184, 166, 0.11)')
        : label === 'bookmarks' || label.startsWith('@')
          ? (isDarkMode ? 'rgba(96, 165, 250, 0.16)' : 'rgba(37, 99, 235, 0.09)')
          : label === 'artifact'
            ? (isDarkMode ? 'rgba(167, 139, 250, 0.16)' : 'rgba(124, 58, 237, 0.09)')
            : (isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.06)');
    return {
      ...styles.namespaceTag,
      backgroundColor: color,
      color: isDarkMode ? '#f0f0f0' : '#202020',
    };
  })();
  const statusText = getLauncherStatusText({
    hasQuery: query.trim() !== '',
    namespaceLabel,
    resultCount: filtered.length,
    loading: launcherDataLoading || launcherFileSearchLoading || clipboardSearchLoading,
    hasLoadedItems: clipboardSearchQuery !== null
      ? !clipboardSearchLoading
      : fileSearchQuery !== null ? !launcherFileSearchLoading : allItems.length > 0,
  });
  const renderItemIcon = (item: LauncherItem) => {
    if (item.type === 'clipboard-item' || item.type === 'clipboard-stack') {
      const imageItem = getClipboardRowImageItem(item.clipboardRow);
      const thumbnailData = imageItem?.thumbnailData || imageItem?.imageData;
      const iconLabel = item.type === 'clipboard-stack'
        ? 'ST'
        : clipboardItemTypeIcon(item.clipboardRow?.type === 'item' ? item.clipboardRow.item : imageItem ?? undefined);
      return (
        <span style={styles.itemIconSlot} aria-hidden="true">
          {thumbnailData ? (
            <img
              src={`data:image/png;base64,${thumbnailData}`}
              alt=""
              style={styles.clipboardThumbnail}
            />
          ) : (
            <span style={item.type === 'clipboard-stack' ? styles.clipboardStackIcon : styles.clipboardTypeIcon}>
              {iconLabel}
            </span>
          )}
        </span>
      );
    }

    const iconPath = getLauncherNativeIconPathForItem(item);
    const iconDataUrl = iconPath ? launcherIconDataByPath[iconPath] : null;
    const fallbackIcon = item.type === 'bookmark' || item.actionId === 'view-bookmarks' ? 'X' : '';
    return (
      <span style={styles.itemIconSlot} aria-hidden="true">
        {iconDataUrl ? <img src={iconDataUrl} alt="" style={styles.itemIcon} /> : (
          fallbackIcon ? <span style={styles.itemFallbackIcon}>{fallbackIcon}</span> : null
        )}
      </span>
    );
  };
  return (
    <div style={{
      ...styles.container,
      visibility: launcherSessionReady ? 'visible' : 'hidden',
    }}>
      <style>
        {`
          .command-launcher-input::placeholder {
            color: currentColor;
            font-size: inherit;
            opacity: 0.55;
          }
        `}
      </style>
      <div style={styles.inputRow}>
        <button
          type="button"
          aria-label="Open Field Theory"
          title="Open Field Theory"
          style={styles.iconButton}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => { void openMainFieldTheoryWindow(); }}
        >
          <img
            src={isDarkMode ? 'fieldtheory-icon.png' : 'field-theory-icon-black.png'}
            alt=""
            style={styles.icon}
          />
        </button>
        {namespaceLabel && (
          <span style={namespaceTagStyle}>{namespaceLabel}</span>
        )}
        <input
          ref={inputRef}
          className="command-launcher-input"
          type="text"
          name="field-theory-command-launcher-query"
          placeholder="Search markdown, commands, bookmarks, or ' files"
          aria-label={namespaceLabel ? `${namespaceLabel} search` : 'Command search'}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          value={query}
          onChange={e => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          style={styles.input}
        />
      </div>

      {filtered.length > 0 && (
        <ul
          ref={listRef}
          style={styles.list}
        >
          {isHelpQuery ? (
            // Help mode: show grouped by type with section headers.
            <>
              {filtered.some(item => item.type === 'action') && (
                <li style={styles.sectionHeader}>Actions</li>
              )}
              {filtered
                .filter(item => item.type === 'action')
                .map((item, i) => {
                  const globalIndex = filtered.findIndex(f => f.id === item.id);
                  return (
                    <li
                      key={item.id}
                      data-item-index={globalIndex}
                      style={{
                        ...styles.listItem,
                        ...selectedItemStyle(item, globalIndex),
                      }}
                      onClick={(event) => invokeItem(item, { insertWikiLink: event.metaKey })}
                    >
                      {renderItemIcon(item)}
                      <span style={styles.itemName}>{item.displayName}</span>
                      {item.hotkeyDisplay && (
                        <span style={styles.itemHotkey}>{item.hotkeyDisplay}</span>
                      )}
                    </li>
                  );
                })}
              {filtered.some(item => item.type === 'handoff') && (
                <li style={styles.sectionHeader}>Recent Handoffs</li>
              )}
              {filtered
                .filter(item => item.type === 'handoff')
                .map((item, i) => {
                  const globalIndex = filtered.findIndex(f => f.id === item.id);
                  return (
                    <li
                      key={item.id}
                      data-item-index={globalIndex}
                      style={{
                        ...styles.listItem,
                        ...selectedItemStyle(item, globalIndex),
                      }}
                      onClick={(event) => invokeItem(item, { insertWikiLink: event.metaKey })}
                    >
                      {renderItemIcon(item)}
                      <span style={styles.itemName}>{item.displayName}</span>
                      {item.timeAgo && (
                        <span style={styles.itemHotkey}>{item.timeAgo}</span>
                      )}
                    </li>
                  );
                })}
              {filtered.some(item => item.type === 'command') && (
                <li style={styles.sectionHeader}>Commands</li>
              )}
              {filtered
                .filter(item => item.type === 'command')
                .map((item, i) => {
                  const globalIndex = filtered.findIndex(f => f.id === item.id);
                  return (
                    <li
                      key={item.id}
                      data-item-index={globalIndex}
                      style={{
                        ...styles.listItem,
                        ...selectedItemStyle(item, globalIndex),
                      }}
                      onClick={(event) => invokeItem(item, { insertWikiLink: event.metaKey })}
                    >
                      {renderItemIcon(item)}
                      <span style={styles.itemName}>{item.displayName || item.name}</span>
                    </li>
                  );
                })}
            </>
          ) : (
            filtered.map((item, i) => {
              const metaText = item.type === 'handoff' ? item.timeAgo : item.hotkeyDisplay;
              const showMetaText = Boolean(metaText && !(item.type === 'directory' && metaText === 'folder'));
              const clipboardDragItemId = getClipboardLauncherDragId(item);
              const isClipboardDropTarget = Boolean(clipboardDragItemId && clipboardDropId === clipboardDragItemId && clipboardDragId !== clipboardDragItemId);
              return (
                <li
                  key={item.id}
                  data-item-index={i}
                  draggable={Boolean(clipboardSearchQuery !== null && clipboardDragItemId)}
                  onDragStart={(event) => {
                    if (!clipboardDragItemId) return;
                    setClipboardDragId(clipboardDragItemId);
                    event.dataTransfer.setData('text/plain', clipboardDragItemId);
                    event.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(event) => {
                    if (!clipboardDragId || !clipboardDragItemId || clipboardDragId === clipboardDragItemId) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setClipboardDropId(clipboardDragItemId);
                  }}
                  onDragLeave={() => {
                    if (clipboardDropId === clipboardDragItemId) setClipboardDropId(null);
                  }}
                  onDrop={(event) => {
                    if (!clipboardDragItemId) return;
                    event.preventDefault();
                    const activeId = clipboardDragId ?? event.dataTransfer.getData('text/plain');
                    setClipboardDragId(null);
                    setClipboardDropId(null);
                    if (activeId) void applyClipboardLauncherDrop(activeId, clipboardDragItemId);
                  }}
                  onDragEnd={() => {
                    setClipboardDragId(null);
                    setClipboardDropId(null);
                  }}
                  style={{
                    ...styles.listItem,
                    ...(isClipboardLauncherMarked(item) ? styles.listItemClipboardSelected : {}),
                    ...selectedItemStyle(item, i),
                    ...(isClipboardDropTarget ? styles.listItemClipboardDropTarget : {}),
                    cursor: clipboardDragItemId ? (clipboardDragId ? 'grabbing' : 'grab') : styles.listItem.cursor,
                  }}
                  onClick={(event) => invokeItem(item, { insertWikiLink: event.metaKey })}
                >
                  {renderItemIcon(item)}
                  <span style={styles.itemName}>
                    {item.type === 'command' ? (item.displayName || item.name) : item.displayName}
                  </span>
                  <span style={styles.itemMeta}>
                    {showMetaText && <span style={styles.itemHotkey}>{metaText}</span>}
                    <span style={styles.itemTypeTag}>{launcherItemTypeLabel(item)}</span>
                  </span>
                </li>
              );
            })
          )}
        </ul>
      )}

      {statusText && (
        <div style={styles.emptyState}>{statusText}</div>
      )}
      <ScrollDiagnosticsHUD />
    </div>
  );
}

// Mount the React app.
const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <CommandLauncher />
  </React.StrictMode>
);
