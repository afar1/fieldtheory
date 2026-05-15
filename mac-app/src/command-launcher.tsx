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
  buildLauncherAppItems,
  buildLauncherFileItems,
  LAUNCHER_NORMAL_MODE_APP_RESULT_LIMIT,
  LAUNCHER_NORMAL_MODE_MAX_RESULTS,
  DEFAULT_LAUNCHER_ROOT_SEARCH_ENABLED_KINDS,
  balanceLauncherNormalModeMatches,
  compareLauncherItemsByRecency,
  dedupeLauncherPersonItems,
  getLauncherAppSearchQuery,
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
  areLauncherRootSearchEnabledKindsEqual,
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
  shouldIncludeLauncherAppInNormalSearch,
  shouldIncludeLauncherRecentFile,
  shouldExitLauncherClipboardSearch,
  shouldOfferLocalInstructionFallback,
  shouldPastePortableCommand,
  shouldReturnLauncherSelectionToInput,
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

interface LauncherAppInfo {
  name: string;
  displayName: string;
  appPath: string;
  bundleId?: string;
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

type LauncherItemType = 'command' | 'local-command' | 'local-instruction' | 'action' | 'handoff' | 'recent-file' | 'wiki-page' | 'markdown-file' | 'artifact' | 'bookmark-author' | 'bookmark' | 'bookmark-facet' | 'directory' | 'app' | 'file' | 'clipboard-item' | 'clipboard-stack';

interface LauncherRecentEntry {
  kind: 'wiki' | 'external';
  path: string;
  title: string;
  lastOpenedAt: number;
}

type BookmarkNamespace =
  | { kind: 'facet'; label: string; paths: string[] }
  | { kind: 'search'; label: string; query: string };

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
  lastUpdated?: number;
  recentKind?: LauncherRecentEntry['kind'];
  lastOpenedAt?: number;
  // For actions
  actionId?: string;
  // For root search rows
  rootSearchKind?: LauncherRootSearchKind;
  rootSearchLabel?: string;
  appPath?: string;
  bundleId?: string;
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

const NAMESPACE_PREFIXES = ['wiki', 'artifact'] as const;
type NamespacePrefix = typeof NAMESPACE_PREFIXES[number];
type FieldTheoryMarkdownTarget = LauncherFieldTheoryMarkdownTarget;

let WIKI_COMMAND_PATH: string | null = null;
try { WIKI_COMMAND_PATH = `${process.env.HOME}/.fieldtheory/library/Commands/wiki.md`; } catch {}

// Window API types for the launcher's standalone renderer context.
// In the launcher window, these APIs are always available (not optional).
interface LauncherCommandsAPI {
  getCommands: () => Promise<PortableCommandInfo[]>;
  getHandoffs: () => Promise<HandoffInfo[]>;
  getHandoffContent: (filePath: string) => Promise<{ name: string; content: string; filePath: string } | null>;
  getMarkdownPreview: (filePath: string) => Promise<MarkdownPreview | null>;
  invokeCommand: (name: string) => Promise<{ success: boolean; error?: string }>;
  listLauncherApps: () => Promise<LauncherAppInfo[]>;
  launchApp: (appPath: string) => Promise<{ success: boolean; error?: string }>;
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
  createMeetingNote?: (title?: string) => Promise<LauncherMeetingActionResult>;
  startMeetingHere?: () => Promise<LauncherMeetingActionResult>;
  stopMeeting?: () => Promise<LauncherMeetingActionResult>;
  summarizeCurrentMeeting?: () => Promise<LauncherMeetingActionResult>;
  openFieldTheoryMarkdown: (target: FieldTheoryMarkdownTarget) => Promise<{ success: boolean; error?: string }>;
  insertMarkdownText: (text: string) => Promise<{ success: boolean; error?: string }>;
  launcherResize: (height: number) => void;
  launcherClose: (options?: LauncherCloseOptions) => void;
  launcherTrace?: (event: string, details?: Record<string, unknown>) => void;
  launcherPreviewShow?: (preview: LauncherPreviewPayload) => void;
  launcherPreviewHide?: () => void;
  onLauncherReset: (callback: (payload?: LauncherResetPayload) => void) => () => void;
}

interface LauncherClipboardAPI {
  queryItems: (options?: ClipboardQueryOptions) => Promise<ClipboardItem[]>;
  getItem?: (id: number) => Promise<ClipboardItem | null>;
  pasteItem: (id: number, targetBundleId?: string, useImproved?: boolean) => Promise<void>;
  pasteStack?: (ids: number[], targetBundleId?: string) => Promise<void>;
  queryItemsByStackId?: (stackId: string) => Promise<ClipboardItem[]>;
  getUniqueStacks?: () => Promise<StackInfo[]>;
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
}

interface LauncherBookmarksAPI {
  getAll: () => Promise<BookmarksSnapshot>;
  getAuthors: () => Promise<BookmarkAuthorSummary[]>;
  getAuthorBookmarks: (handle: string) => Promise<Bookmark[]>;
  getTaxonomyBookmarks: (filePaths: string[]) => Promise<Bookmark[]>;
  search: (query: string) => Promise<Bookmark[]>;
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
  commandsAPI.launcherTrace?.(event, details);
}

function describeLauncherItem(item: LauncherItem | undefined): Record<string, unknown> | null {
  if (!item) return null;
  return {
    id: item.id,
    type: item.type,
    displayName: item.displayName,
    authorHandle: item.authorHandle ?? null,
    bookmarkId: item.bookmarkId ?? null,
    directoryPath: item.directoryPath ?? null,
    clipboardItemId: item.clipboardItemId ?? null,
    clipboardStackId: item.clipboardStackId ?? null,
  };
}

function launcherItemTypeLabel(item: LauncherItem): string {
  switch (item.type) {
    case 'command': return 'Command';
    case 'local-command': return 'Local';
    case 'local-instruction': return 'Local';
    case 'app': return item.rootSearchLabel ?? 'App';
    case 'file': return item.rootSearchLabel ?? 'File';
    case 'action': return 'Action';
    case 'recent-file': return 'Recent';
    case 'handoff': return 'Handoff';
    case 'wiki-page': return 'Wiki';
    case 'markdown-file': return 'Markdown';
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
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.13)' : 'rgba(0, 0, 0, 0.085)',
    boxShadow: `inset 3px 0 0 ${isDark ? 'rgba(255, 255, 255, 0.5)' : 'rgba(0, 0, 0, 0.32)'}`,
  },
  listItemSelectedSoft: {
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.038)',
  },
  itemName: {
    flex: 1,
    fontWeight: 500,
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
    fontSize: '11px',
    color: isDark ? '#888' : '#6b6b6b',
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
    fontSize: '8px',
    lineHeight: '12px',
    padding: '0 5px',
    borderRadius: '3px',
    color: isDark ? '#8b8b8b' : '#767676',
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.055)' : 'rgba(0, 0, 0, 0.045)',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.3px',
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
  const [handoffs, setHandoffs] = useState<HandoffInfo[]>([]);
  const [launcherApps, setLauncherApps] = useState<LauncherAppInfo[]>([]);
  const [launcherFiles, setLauncherFiles] = useState<LauncherFileInfo[]>([]);
  const [launcherFileSearchLoading, setLauncherFileSearchLoading] = useState(false);
  const [clipboardItems, setClipboardItems] = useState<ClipboardItem[]>([]);
  const [clipboardStacks, setClipboardStacks] = useState<StackInfo[]>([]);
  const [clipboardHydratedStackItemsById, setClipboardHydratedStackItemsById] = useState<Record<string, ClipboardItem[]>>({});
  const [clipboardSearchLoading, setClipboardSearchLoading] = useState(false);
  const [launcherRootSearchEnabledKinds, setLauncherRootSearchEnabledKinds] = useState<Record<LauncherRootSearchKind, boolean>>(
    DEFAULT_LAUNCHER_ROOT_SEARCH_ENABLED_KINDS,
  );
  const [recentEntries, setRecentEntries] = useState<LauncherRecentEntry[]>([]);
  const [hotkeys, setHotkeys] = useState<LauncherHotkeyMap>(DEFAULT_HOTKEYS);
  const [squaresHotkeys, setSquaresHotkeys] = useState<Record<string, string>>(DEFAULT_SQUARES_HOTKEYS);
  const [showSquaresInCommandLauncher, setShowSquaresInCommandLauncher] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState<boolean | null>(() => themeAPI.initialTheme ?? null);
  const [libraryMarkdownItems, setLibraryMarkdownItems] = useState<LauncherItem[]>([]);
  const [directoryItems, setDirectoryItems] = useState<LauncherItem[]>([]);
  const [artifactReadings, setArtifactReadings] = useState<LauncherItem[]>([]);
  const [bookmarkAuthorItems, setBookmarkAuthorItems] = useState<LauncherItem[]>([]);
  const [bookmarkFacetItems, setBookmarkFacetItems] = useState<LauncherItem[]>([]);
  const [authorBookmarkItems, setAuthorBookmarkItems] = useState<LauncherItem[]>([]);
  const [authorBookmarks, setAuthorBookmarks] = useState<Bookmark[]>([]);
  const [bookmarkNamespaceItems, setBookmarkNamespaceItems] = useState<LauncherItem[]>([]);
  const [bookmarkNamespaceBookmarks, setBookmarkNamespaceBookmarks] = useState<Bookmark[]>([]);
  const [webBookmarkItems, setWebBookmarkItems] = useState<LauncherItem[]>([]);
  const [webBookmarks, setWebBookmarks] = useState<Bookmark[]>([]);
  const [activeWebPage, setActiveWebPage] = useState<ActiveWebPage | null>(null);
  const [launcherDataLoading, setLauncherDataLoading] = useState(true);
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
  const [usageByItemId, setUsageByItemId] = useState<LauncherUsageMap>(() => readLauncherUsageMap());
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
  const launcherIconPendingPathsRef = useRef(new Set<string>());
  const manualPreviewRef = useRef(false);
  const hasNavigatedRef = useRef(false); // Track if user has used arrow keys
  const hasExplicitSelectionRef = useRef(false);
  const launcherDataRequestRef = useRef(0);
  const launcherFileSearchRequestRef = useRef(0);
  const clipboardSearchRequestRef = useRef(0);
  const clipboardStackHydrationRequestRef = useRef(0);
  const launcherGenerationRef = useRef(0);
  const resizeFrameRef = useRef<number | null>(null);
  const resizeHeightRef = useRef<number>(LAUNCHER_COLLAPSED_HEIGHT);
  const lastMousePositionRef = useRef<{ x: number; y: number } | null>(null);

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

  const showLauncherMessage = useCallback((message: string) => {
    setClipboardSearchActive(false);
    setQuery(message);
    setFiltered([]);
    resizeLauncher(LAUNCHER_COLLAPSED_HEIGHT);
  }, [resizeLauncher]);

  const handleQueryChange = useCallback((nextQuery: string) => {
    const next = getLauncherClipboardSearchInputState({
      active: clipboardSearchActive,
      query: nextQuery,
    });
    setClipboardSearchActive(next.active);
    setQuery(next.query);
  }, [clipboardSearchActive]);

  const handleListItemMouseMove = useCallback((event: React.MouseEvent, index: number) => {
    const last = lastMousePositionRef.current;
    const moved = !last || last.x !== event.clientX || last.y !== event.clientY;
    if (!moved) return;
    lastMousePositionRef.current = { x: event.clientX, y: event.clientY };
    selectExplicitItem(index);
  }, [selectExplicitItem]);

  // Load commands from the filesystem.
  const loadCommands = useCallback(async () => {
    try {
      const cmds = await commandsAPI.getCommands();
      setCommands(cmds || []);
    } catch (err) {
      console.error('[CommandLauncher] Failed to load commands:', err);
    }
  }, []);

  const loadLauncherApps = useCallback(async () => {
    try {
      const apps = await commandsAPI.listLauncherApps();
      setLauncherApps(apps || []);
    } catch (err) {
      console.error('[CommandLauncher] Failed to load apps:', err);
      setLauncherApps([]);
    }
  }, []);

  const loadLauncherSettings = useCallback(async () => {
    try {
      const settings = await commandsAPI.getLauncherSettings();
      const normalized = normalizeLauncherRootSearchEnabledKinds(settings?.rootSearchEnabledKinds as LauncherRootSearchEnabledKinds);
      setLauncherRootSearchEnabledKinds(prev => (
        areLauncherRootSearchEnabledKindsEqual(prev, normalized) ? prev : normalized
      ));
    } catch (err) {
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
    try {
      await commandsAPI.warmLauncherFileIndex();
    } catch (err) {
      console.error('[CommandLauncher] Failed to warm file index:', err);
    }
  }, [launcherRootSearchEnabledKinds]);

  const loadLibraryMarkdown = useCallback(async () => {
    try {
      const roots = await libraryAPI?.getRoots();
      if (roots) {
        setLibraryMarkdownItems(flattenLibraryRootsForLauncher(roots));
        setDirectoryItems(flattenLibraryDirectoriesForLauncher(roots));
        setBookmarkFacetItems(flattenBookmarkTaxonomyRootsForLauncher(roots));
        return;
      }
    } catch {}
  }, []);

  const loadArtifacts = useCallback(async () => {
    try {
      const readings = await window.librarianAPI?.getReadings();
      if (!readings) return;
      setArtifactReadings(readings.map(r => ({
        id: `artifact-${r.path}`,
        type: 'artifact' as const,
        name: r.title,
        displayName: r.title,
        keywords: [r.title, r.context ?? '', ...r.title.split(/\s+/)].filter(Boolean),
        filePath: r.path,
        lastUpdated: r.mtime,
      })));
    } catch {}
  }, []);

  const loadRecentEntries = useCallback(async () => {
    try {
      const entries = await recentAPI?.list();
      setRecentEntries((entries ?? []).slice().sort((a, b) => b.lastOpenedAt - a.lastOpenedAt));
    } catch {
      setRecentEntries([]);
    }
  }, []);

  const loadBookmarkAuthors = useCallback(async () => {
    try {
      const authors = await bookmarksAPI?.getAuthors();
      setBookmarkAuthorItems(buildBookmarkAuthorLauncherItems(authors ?? []));
    } catch {}
  }, []);

  const loadWebBookmarks = useCallback(async () => {
    try {
      const snapshot = await bookmarksAPI?.getAll();
      const bookmarks = (snapshot?.bookmarks ?? [])
        .filter((bookmark) => bookmark.sourceType === 'web')
        .sort((a, b) => {
          const aTime = new Date(a.savedAt ?? a.postedAt).getTime();
          const bTime = new Date(b.savedAt ?? b.postedAt).getTime();
          return (Number.isFinite(bTime) ? bTime : 0) - (Number.isFinite(aTime) ? aTime : 0);
        })
        .slice(0, 100);
      setWebBookmarks(bookmarks);
      setWebBookmarkItems(buildBookmarkPostLauncherItems(bookmarks));
    } catch {
      setWebBookmarks([]);
      setWebBookmarkItems([]);
    }
  }, []);

  const loadActiveWebPage = useCallback(async () => {
    const requestId = ++activeWebPageRequestRef.current;
    try {
      const result = await bookmarksAPI?.getActiveWebPage?.();
      if (requestId !== activeWebPageRequestRef.current) return;
      setActiveWebPage(result?.success && result.page ? result.page : null);
    } catch {
      if (requestId !== activeWebPageRequestRef.current) return;
      setActiveWebPage(null);
    }
  }, []);

  const refreshLauncherContext = useCallback(async () => {
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
      const bookmarks = namespace.kind === 'facet'
        ? await bookmarksAPI?.getTaxonomyBookmarks(namespace.paths)
        : await bookmarksAPI?.search(namespace.query);
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
    try {
      const hoffs = await commandsAPI.getHandoffs();
      setHandoffs(hoffs || []);
    } catch (err) {
      console.error('[CommandLauncher] Failed to load handoffs:', err);
    }
  }, []);

  // Load hotkeys from preferences.
  const loadHotkeys = useCallback(async () => {
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
    } catch (err) {
      console.error('[CommandLauncher] Failed to load hotkeys:', err);
    }
  }, []);

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

  const loadLauncherData = useCallback(async () => {
    const requestId = ++launcherDataRequestRef.current;
    setLauncherDataLoading(true);
    await Promise.allSettled([
      loadCommands(),
      loadLauncherApps(),
      loadLauncherSettings(),
      warmLauncherFileIndex(),
      loadHandoffs(),
      loadHotkeys(),
      loadLibraryMarkdown(),
      loadArtifacts(),
      loadRecentEntries(),
      loadBookmarkAuthors(),
      loadWebBookmarks(),
      loadActiveWebPage(),
      refreshLauncherContext(),
    ]);
    if (requestId === launcherDataRequestRef.current) {
      setLauncherDataLoading(false);
    }
  }, [loadCommands, loadLauncherApps, loadLauncherSettings, warmLauncherFileIndex, loadHandoffs, loadHotkeys, loadLibraryMarkdown, loadArtifacts, loadRecentEntries, loadBookmarkAuthors, loadWebBookmarks, loadActiveWebPage, refreshLauncherContext]);

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
	    lastMousePositionRef.current = null;
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
    selectIndex(0);
  }, [selectIndex]);

  const prepareLauncherForNextOpen = useCallback(() => {
    flushSync(() => {
      setLauncherSessionReady(false);
      clearLauncherSessionState();
    });
    resizeLauncher(LAUNCHER_COLLAPSED_HEIGHT);
    window.requestAnimationFrame(() => {
      setLauncherSessionReady(true);
    });
  }, [clearLauncherSessionState, resizeLauncher]);

  // Load commands, handoffs, and hotkeys on mount.
  useEffect(() => {
    // Set initial height immediately to prevent layout shift
    resizeLauncher(LAUNCHER_COLLAPSED_HEIGHT);

    void loadLauncherData();

    // Load current Field Theory theme preference and keep this separate window in sync.
    themeAPI.getTheme().then(applyTheme).catch(() => {});
    const unsubscribeTheme = themeAPI.onThemeChanged?.(applyTheme);

    // Listen for reset events (when window is shown).
    // Reload commands and handoffs each time to pick up newly added ones without restart.
    const handleReset = (payload?: LauncherResetPayload) => {
      if (typeof payload?.isDarkMode === 'boolean') {
        applyTheme(payload.isDarkMode);
      }
      if (typeof payload?.generation === 'number') {
        launcherGenerationRef.current = payload.generation;
      }
      flushSync(() => {
        clearLauncherSessionState();
        setLauncherSessionReady(true);
      });
      resizeLauncher(LAUNCHER_COLLAPSED_HEIGHT);
      inputRef.current?.focus();
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
      void loadLauncherData();
      void themeAPI.getTheme()
        .then(dark => applyTheme(dark ?? payload?.isDarkMode ?? false))
        .catch(() => applyTheme(payload?.isDarkMode ?? themeAPI.initialTheme ?? false));
    };

    const unsubscribe = commandsAPI.onLauncherReset(handleReset);
    const unsubscribeSquaresConfig = squaresAPI.onConfigChanged?.((config) => {
      setShowSquaresInCommandLauncher(normalizeSquaresConfig(config).showInCommandLauncher);
    });
    const unsubscribeBookmarks = bookmarksAPI?.onChanged?.(() => {
      loadBookmarkAuthors();
      loadWebBookmarks();
      const handle = authorNamespaceRef.current;
      if (handle) loadAuthorBookmarks(handle);
      const namespace = bookmarkNamespaceRef.current;
      if (namespace) loadBookmarkNamespace(namespace);
    });
    const unsubscribeRecent = recentAPI?.onChanged?.(() => {
      loadRecentEntries();
    });
    return () => {
      unsubscribe();
      unsubscribeTheme?.();
      unsubscribeSquaresConfig?.();
      unsubscribeBookmarks?.();
      unsubscribeRecent?.();
    };
  }, [applyTheme, clearLauncherSessionState, loadAuthorBookmarks, loadBookmarkNamespace, loadLauncherData, resizeLauncher]);

  useEffect(() => {
    window.addEventListener('blur', prepareLauncherForNextOpen);
    return () => {
      window.removeEventListener('blur', prepareLauncherForNextOpen);
    };
  }, [prepareLauncherForNextOpen]);

  useEffect(() => () => {
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

  const commandItems = useMemo((): LauncherItem[] => commands
    .filter(cmd => !isGeneratedBookmarkTaxonomyPath(cmd.filePath))
    .map(cmd => ({
      id: `cmd-${cmd.name}`,
      type: 'command' as const,
      name: cmd.name,
      displayName: cmd.displayName,
      keywords: [cmd.name, cmd.displayName, ...cmd.name.split('-'), ...cmd.name.split('_')],
      filePath: cmd.filePath,
      lastUpdated: cmd.lastModified,
    })), [commands]);

  const appItems = useMemo((): LauncherItem[] => {
    if (!isLauncherRootSearchKindEnabled(launcherRootSearchEnabledKinds, 'app')) return [];
    return buildLauncherAppItems(launcherApps);
  }, [launcherApps, launcherRootSearchEnabledKinds]);

  const fileItems = useMemo((): LauncherItem[] => buildLauncherFileItems(launcherFiles), [launcherFiles]);

  const commandFilePaths = useMemo(
    () => new Set(commandItems.map(item => item.filePath).filter((filePath): filePath is string => Boolean(filePath))),
    [commandItems],
  );

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

  // Build all items (commands + actions + handoffs).
  const allItems = useMemo(() => {
    const handoffItems: LauncherItem[] = handoffs.map(h => ({
      id: `handoff-${h.name}`,
      type: 'handoff' as const,
      name: h.name,
      displayName: h.displayName,
      keywords: [h.name, h.displayName, 'handoff', 'session', ...h.displayName.split('-')],
      filePath: h.filePath,
      lastUpdated: h.lastModified,
      timeAgo: formatTimeAgo(h.lastModified),
    }));

    const actionItems = buildBuiltInLauncherActions(hotkeys, isDarkMode ?? false, squaresHotkeys, showSquaresInCommandLauncher)
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
      });

    const recentKeys = new Set(recentFileItems.map(item => `${item.recentKind}:${item.recentKind === 'wiki' ? item.relPath : item.filePath}`));
    const markdownItems = [...libraryMarkdownItems, ...artifactReadings].filter((item) => {
      if (item.type === 'wiki-page') return !recentKeys.has(`wiki:${item.relPath}`);
      if (item.type === 'markdown-file') return !recentKeys.has(`external:${item.filePath}`);
      return true;
    });
    return [...appItems, ...directoryItems, ...bookmarkFacetItems, ...bookmarkAuthorItems, ...webBookmarkItems, ...recentFileItems, ...markdownItems, ...commandItems, ...handoffItems, ...actionItems];
  }, [appItems, commandItems, handoffs, hotkeys, squaresHotkeys, showSquaresInCommandLauncher, isDarkMode, libraryMarkdownItems, artifactReadings, directoryItems, bookmarkAuthorItems, bookmarkFacetItems, webBookmarkItems, recentFileItems, activeWebPage, lastLibraryMove]);

	  const appSearchQuery = useMemo(() => getLauncherAppSearchQuery(query), [query]);
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
      ?? webBookmarks.find((bookmark) => bookmark.id === item.bookmarkId)
      ?? null;
  }, [authorBookmarks, authorNamespace, bookmarkNamespaceBookmarks, webBookmarks]);

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
      setPreviewPayload(null);
      return;
    }
    if (!previewPayload) {
      if (previewWindowWasOpenRef.current) {
        commandsAPI.launcherPreviewHide?.();
        previewWindowWasOpenRef.current = false;
      }
      return;
    }
    previewWindowWasOpenRef.current = true;
    traceLauncher('preview-window-show', {
      selectedIndex,
      previewKind: previewPayload.kind,
      bookmarkId: previewPayload.kind === 'bookmark' ? previewPayload.bookmark.id : null,
      filePath: previewPayload.kind === 'markdown' ? previewPayload.filePath : null,
    });
    commandsAPI.launcherPreviewShow?.(previewPayload);
  }, [previewOpen, previewPayload, selectedIndex]);

  useEffect(() => {
    if (!previewOpen) return;
    if (manualPreviewRef.current) return;
    const selected = filtered[selectedIndex];
    void loadPreviewForItem(selected, selectedIndex, 'selection');
  }, [filtered, loadPreviewForItem, previewOpen, selectedIndex]);

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
    return dedupeLauncherPersonItems(filterLauncherNormalModeItems(allItems, rawQuery, usageByItemId, {
      maxAppResults: LAUNCHER_NORMAL_MODE_APP_RESULT_LIMIT,
      includeItem: (item) => (
        item.type !== 'app' || shouldIncludeLauncherAppInNormalSearch({
          app: item,
          query: rawQuery.trim().toLowerCase(),
          usage: usageByItemId[item.id],
        })
      ),
    }));
  }, [allItems, usageByItemId]);

  const visibleLauncherIconPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const item of filtered) {
      const iconPath = getLauncherNativeIconPathForItem(item);
      if (iconPath) paths.add(iconPath);
    }
    return Array.from(paths).slice(0, LAUNCHER_NORMAL_MODE_MAX_RESULTS);
  }, [filtered]);

  useEffect(() => {
    const requestId = ++clipboardSearchRequestRef.current;
    if (clipboardSearchQuery === null) {
      setClipboardItems([]);
      setClipboardStacks([]);
      setClipboardHydratedStackItemsById({});
      setClipboardSearchLoading(false);
      return;
    }

    setClipboardSearchLoading(true);
    const options: ClipboardQueryOptions = {
      limit: 50,
      offset: 0,
    };
    if (clipboardSearchQuery.trim()) {
      options.search = clipboardSearchQuery.trim();
    }

    let cancelled = false;
    void Promise.all([
      clipboardAPI.queryItems(options),
      clipboardAPI.getUniqueStacks?.() ?? Promise.resolve([]),
    ]).then(([items, stacks]) => {
      if (cancelled || requestId !== clipboardSearchRequestRef.current) return;
      setClipboardHydratedStackItemsById({});
      setClipboardItems(items ?? []);
      setClipboardStacks(stacks ?? []);
    }).catch((error) => {
      if (cancelled || requestId !== clipboardSearchRequestRef.current) return;
      console.error('[CommandLauncher] Failed to load clipboard results:', error);
      setClipboardItems([]);
      setClipboardStacks([]);
      setClipboardHydratedStackItemsById({});
    }).finally(() => {
      if (cancelled || requestId !== clipboardSearchRequestRef.current) return;
      setClipboardSearchLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [clipboardSearchQuery]);

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
      void commandsAPI.searchLauncherFiles(fileSearchQuery)
        .then((result) => {
          if (cancelled || requestId !== launcherFileSearchRequestRef.current) return;
          setLauncherFiles(result.files || []);
          setLauncherFileSearchLoading(result.indexing);
          if (result.indexing) {
            pollTimeoutId = window.setTimeout(runSearch, 250);
          }
        })
        .catch((error) => {
          console.error('[CommandLauncher] Failed to search files:', error);
          if (cancelled || requestId !== launcherFileSearchRequestRef.current) return;
          setLauncherFiles([]);
          setLauncherFileSearchLoading(false);
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
    for (const filePath of visibleLauncherIconPaths) {
      if (Object.prototype.hasOwnProperty.call(launcherIconDataByPath, filePath)) continue;
      if (launcherIconPendingPathsRef.current.has(filePath)) continue;
      launcherIconPendingPathsRef.current.add(filePath);
      void commandsAPI.getLauncherFileIcon(filePath)
        .then((result) => {
          setLauncherIconDataByPath(prev => {
            if (Object.prototype.hasOwnProperty.call(prev, filePath)) return prev;
            return { ...prev, [filePath]: result.success ? (result.iconDataUrl ?? null) : null };
          });
        })
        .catch(() => {
          setLauncherIconDataByPath(prev => {
            if (Object.prototype.hasOwnProperty.call(prev, filePath)) return prev;
            return { ...prev, [filePath]: null };
          });
        })
        .finally(() => {
          launcherIconPendingPathsRef.current.delete(filePath);
        });
    }
  }, [launcherIconDataByPath, visibleLauncherIconPaths]);

  // Filter items when query changes.
  useEffect(() => {
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
      setFiltered(results);
      selectIndex(0);
      resizeForResults(results.length, clipboardSearchQuery.length > 0 || clipboardSearchLoading);
      return;
    }

    if (allItems.length === 0 && !namespacePrefix && !directoryNamespace && !authorNamespace && !bookmarkNamespace && !moveSource) {
      const waitingForResults = launcherDataLoading && query.trim() !== '';
      const fallback = waitingForResults ? null : localInstructionFallbackForQuery(query, 0, isHelpQuery);
      setFiltered(fallback ? [fallback] : []);
      selectIndex(0);
      // Don't show empty state height when still loading (query is empty)
      // Only show it when user has typed but no results found
      resizeForResults(fallback ? 1 : 0, waitingForResults);
      return;
    }

    if (!namespacePrefix && !directoryNamespace && !authorNamespace && !bookmarkNamespace && !moveSource && query.trim() === '') {
      setFiltered([]);
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

      setFiltered([...actions, ...hoffs, ...cmds]);
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
      setFiltered(results);
      selectIndex(0);
      resizeForResults(results.length, fileSearchQuery.length > 0 || launcherFileSearchLoading);
      return;
    }

    if (appSearchQuery !== null) {
      const appQuery = appSearchQuery.toLowerCase();
      const results = balanceLauncherNormalModeMatches(appItems.map(item => {
        const baseScore = scoreLauncherSearchableItem(item, appQuery);
        return { item, score: baseScore + getLauncherUsageScore(item, appQuery, usageByItemId, baseScore) };
      }).filter(({ score }) => score > 0));
      setFiltered(results);
      selectIndex(0);
      resizeForResults(results.length, appSearchQuery.length > 0);
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
      setFiltered(results.slice(0, 14));
      selectIndex(0);
      resizeForResults(results.length, true);
      return;
    }

    if (moveSource) {
      const results = filterLauncherMoveTargetDirectories(directoryItems, moveSource, q);
      setFiltered(results);
      selectIndex(0);
      resizeForResults(results.length, true);
      return;
    }

    if (directoryNamespace) {
      const results = filterLauncherDirectoryNamespaceItems(
        [...libraryMarkdownItems, ...artifactReadings, ...commandItems],
        directoryNamespace,
        q,
      );
      setFiltered(results);
      selectIndex(0);
      resizeForResults(results.length, true);
      return;
    }

    if (authorNamespace) {
      const results = filterLauncherNamespaceItems(authorBookmarkItems, q);
      setFiltered(results);
      selectIndex(0);
      resizeForResults(results.length, true);
      return;
    }

    if (bookmarkNamespace) {
      const results = filterLauncherNamespaceItems(bookmarkNamespaceItems, q);
      setFiltered(results);
      selectIndex(0);
      resizeForResults(results.length, true);
      return;
    }

    if (namespacePrefix) {
      const pool = namespacePrefix === 'wiki' ? libraryMarkdownItems : artifactReadings;
      const results = dedupeLauncherPersonItems(filterLauncherNamespaceItems(pool, q));
      setFiltered(results.slice(0, 20));
      selectIndex(0);
      resizeForResults(results.length, true);
      return;
    }

    const nsMatch = q.match(/^(wiki|artifact)\s+(.*)$/);
    if (nsMatch) {
      const [, ns, search] = nsMatch;
      const pool = ns === 'wiki' ? libraryMarkdownItems : artifactReadings;
      const results = dedupeLauncherPersonItems(filterLauncherNamespaceItems(pool, search));
      setFiltered(results.slice(0, 20));
      selectIndex(0);
      resizeForResults(results.length, true);
      return;
    }

    if (q === 'wiki') {
      setFiltered([{
        id: 'wiki-command',
        type: 'command' as const,
        name: 'wiki',
        displayName: 'wiki.md — lookup',
        keywords: ['wiki'],
        filePath: WIKI_COMMAND_PATH ?? undefined,
      }, ...libraryMarkdownItems.slice(0, 5)]);
      selectIndex(0);
      resizeForResults(6);
      return;
    }

    const areaActionId = getLauncherAreaActionIdForQuery(q);
    if (areaActionId) {
      const areaAction = allItems.find((item) => item.type === 'action' && item.actionId === areaActionId);
      setFiltered(areaAction ? [areaAction] : []);
      selectIndex(0);
      resizeForResults(areaAction ? 1 : 0);
      return;
    }

    const balancedMatches = getNormalModeMatches(q);
    const fallback = localInstructionFallbackForQuery(query, balancedMatches.length);
    const results = fallback ? [fallback] : balancedMatches;

    setFiltered(results);
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
      launcherDataLoading,
      elapsedMs: Math.round((performance.now() - filterStartedAt) * 10) / 10,
    });
  }, [namespacePrefix, directoryNamespace, authorNamespace, bookmarkNamespace, moveSource, query, allItems, isHelpQuery, appSearchQuery, appItems, fileSearchQuery, fileSearchEnabled, fileItems, launcherFileSearchLoading, clipboardSearchQuery, clipboardLauncherItems, clipboardSearchLoading, directoryItems, libraryMarkdownItems, artifactReadings, commandItems, authorBookmarkItems, bookmarkNamespaceItems, localInstructionFallbackForQuery, resizeLauncher, selectIndex, launcherDataLoading, getNormalModeMatches]);

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

  // Handle keyboard navigation.
  const handleKeyDown = (e: React.KeyboardEvent) => {
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
      commandsAPI.launcherClose();
    } else if (shouldExitLauncherClipboardSearch({ active: clipboardSearchActive, query, key: e.key })) {
      e.preventDefault();
      setClipboardSearchActive(false);
      setFiltered([]);
      selectIndex(0);
      resizeLauncher(LAUNCHER_COLLAPSED_HEIGHT);
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
        const authorHandle = resolveLauncherAuthorNamespaceHandle([], bookmarkAuthorItems, 0, rawQuery);
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

      const bookmarkFacet = resolveLauncherBookmarkFacetNamespace(filtered, bookmarkFacetItems, currentIndex, rawQuery);
      if (bookmarkFacet?.facetPaths?.length) {
        setBookmarkNamespace({ kind: 'facet', label: bookmarkFacet.displayName, paths: bookmarkFacet.facetPaths });
        setQuery('');
        selectIndex(0);
        return;
      }

      const authorHandle = resolveLauncherAuthorNamespaceHandle(filtered, bookmarkAuthorItems, currentIndex, rawQuery);
      if (authorHandle) {
        setAuthorNamespace(authorHandle);
        setQuery('');
        selectIndex(0);
        return;
      }

      for (const prefix of NAMESPACE_PREFIXES) {
        if (prefix.startsWith(q) && q.length > 0) {
          setNamespacePrefix(prefix);
          previewRequestRef.current += 1;
          setPreviewOpen(false);
          setPreviewPayload(null);
          setQuery('');
          return;
        }
      }

      if (rawQuery) {
        setBookmarkNamespace({ kind: 'search', label: `search: ${rawQuery}`, query: rawQuery });
        setQuery('');
        selectIndex(0);
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
        invokeItem(normalMatch, { insertWikiLink: normalMatch.type !== 'command' });
        return;
      }
      const commandTarget = inScopedMode
        ? null
        : resolveLauncherCommandOpenTarget([], commandItems, 0, rawQuery, false);
      if (commandTarget) {
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
    if (item.type !== 'local-instruction') {
      noteItemUsage(item.id);
    }
    dismissPreview();
    const showInvocationError = (event: string, error: string | undefined, fallback: string) => {
      const message = error ?? fallback;
      traceLauncher(event, { error: message });
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
    const shouldResolveFieldTheoryTarget = options.openFieldTheoryTarget || latestContext?.fieldTheoryActive;
    const fieldTheoryTarget = shouldResolveFieldTheoryTarget ? getFieldTheoryTarget(item) : null;
    traceLauncher('invoke-item', {
      item: describeLauncherItem(item),
      fieldTheoryActive: latestContext?.fieldTheoryActive ?? false,
      hasFieldTheoryTarget: !!fieldTheoryTarget,
      openFieldTheoryTarget: options.openFieldTheoryTarget ?? false,
      insertWikiLink: options.insertWikiLink ?? false,
    });
    if (item.type === 'clipboard-item' || item.type === 'clipboard-stack') {
      const targetBundleId = latestContext?.targetApp?.bundleId;
      if (!targetBundleId) {
        showInvocationError('paste-clipboard-launcher-no-target', 'No external target app available', 'No external target app available');
        return;
      }
      closeForInvocation({ skipActivation: true });
      if (item.type === 'clipboard-stack') {
        const itemIds = await getClipboardLauncherStackItemIds(item);
        if (itemIds.length > 0) {
          await clipboardAPI.pasteStack?.(itemIds, targetBundleId);
        }
      } else if (typeof item.clipboardItemId === 'number') {
        const clipboardItem = item.clipboardRow?.type === 'item' ? item.clipboardRow.item : null;
        await clipboardAPI.pasteItem(item.clipboardItemId, targetBundleId, clipboardItem?.useImprovedVersion);
      }
      return;
    }
    if (shouldPastePortableCommand({
      itemType: item.type,
      openFieldTheoryTarget: options.openFieldTheoryTarget,
      insertWikiLink: options.insertWikiLink,
    })) {
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
      prepareLauncherForNextOpen();
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
    } else if (item.type === 'app') {
      if (!item.appPath) {
        showInvocationError('launch-app-missing-path', 'App path missing', 'Launch failed');
        return;
      }
      const result = await commandsAPI.launchApp(item.appPath).catch((error) => ({
        success: false,
        error: error instanceof Error ? error.message : 'Launch failed',
      }));
      if (!result.success) {
        showInvocationError('launch-app-error', result.error, 'Launch failed');
        return;
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
          await loadWebBookmarks();

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
            return;
          }
          const source = await commandsAPI.getActiveLibraryFileContext?.();
          if (!source) {
            showLauncherMessage('No current Library file to move');
            return;
          }
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
  }, [applyTheme, clipboardPreviewContentForItem, dismissPreview, getClipboardLauncherStackItemIds, getFieldTheoryTarget, getWikiLinkText, loadLibraryMarkdown, loadWebBookmarks, moveLibraryFileToDirectory, moveSource, noteItemUsage, prepareLauncherForNextOpen, resizeLauncher, selectIndex, showLauncherMessage, undoLastLibraryMove]);

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
  const selectedItemStyle = (index: number) => {
    if (index !== selectedIndex) return {};
    return hasExplicitSelection ? styles.listItemSelected : styles.listItemSelectedSoft;
  };
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
    return (
      <span style={styles.itemIconSlot} aria-hidden="true">
        {iconDataUrl ? <img src={iconDataUrl} alt="" style={styles.itemIcon} /> : null}
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
          <span style={styles.namespaceTag}>{namespaceLabel}</span>
        )}
        <input
          ref={inputRef}
          className="command-launcher-input"
          type="text"
          name="field-theory-command-launcher-query"
          placeholder="Search apps, markdown, commands, bookmarks, or ' files"
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
          onMouseLeave={() => {
            lastMousePositionRef.current = null;
          }}
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
                        ...selectedItemStyle(globalIndex),
                      }}
                      onClick={(event) => invokeItem(item, { insertWikiLink: event.metaKey })}
                      onMouseMove={(event) => handleListItemMouseMove(event, globalIndex)}
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
                        ...selectedItemStyle(globalIndex),
                      }}
                      onClick={(event) => invokeItem(item, { insertWikiLink: event.metaKey })}
                      onMouseMove={(event) => handleListItemMouseMove(event, globalIndex)}
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
                        ...selectedItemStyle(globalIndex),
                      }}
                      onClick={(event) => invokeItem(item, { insertWikiLink: event.metaKey })}
                      onMouseMove={(event) => handleListItemMouseMove(event, globalIndex)}
                    >
                      {renderItemIcon(item)}
                      <span style={styles.itemName}>{item.name}</span>
                    </li>
                  );
                })}
            </>
          ) : (
            filtered.map((item, i) => {
              const metaText = item.type === 'handoff' ? item.timeAgo : item.hotkeyDisplay;
              const showMetaText = Boolean(metaText && !(item.type === 'directory' && metaText === 'folder'));
              return (
                <li
                  key={item.id}
                  data-item-index={i}
                  style={{
                    ...styles.listItem,
                    ...selectedItemStyle(i),
                  }}
                  onClick={(event) => invokeItem(item, { insertWikiLink: event.metaKey })}
                  onMouseMove={(event) => handleListItemMouseMove(event, i)}
                >
                  {renderItemIcon(item)}
                  <span style={styles.itemName}>
                    {item.type === 'command' ? item.name : item.displayName}
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
