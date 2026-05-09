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
  buildBookmarkAuthorLauncherItems,
  buildBookmarkPostLauncherItems,
  balanceLauncherNormalModeMatches,
  dedupeLauncherPersonItems,
  getLauncherFieldTheoryMarkdownTarget,
  getLauncherMoveDirectoryTarget,
  getLauncherMovedFilePath,
  getLauncherMoveUndoTargetDirRelPath,
  getLauncherAreaActionIdForQuery,
  getLauncherUsageScore,
  getLauncherStatusText,
  isGeneratedBookmarkTaxonomyPath,
  nextLauncherArrowIndex,
  resolveHighlightedLauncherIndex,
  resolveLauncherAuthorNamespaceHandle,
  resolveLauncherBookmarkFacetNamespace,
  resolveLauncherCommandOpenTarget,
  resolveLauncherDirectoryNamespace,
  shouldHandleLauncherPreviewShortcut,
  shouldOfferLocalInstructionFallback,
  shouldPastePortableCommand,
  type LauncherFieldTheoryMarkdownTarget,
  type LauncherHotkeyMap,
  type LauncherDirectoryNamespace,
  type LauncherLibraryMoveSource,
  type LauncherMoveDirectoryTarget,
  type LauncherLibraryRoot,
  type LauncherUsageMap,
} from './commandLauncherUtils';
import { normalizeSquaresConfig } from './utils/squaresConfig';

// =============================================================================
// Types
// =============================================================================

interface PortableCommandInfo {
  name: string;
  displayName: string;
  filePath: string;
}

interface HandoffInfo {
  name: string;
  displayName: string;
  filePath: string;
  lastModified: number;
}

type LauncherItemType = 'command' | 'local-command' | 'local-instruction' | 'action' | 'handoff' | 'recent-file' | 'wiki-page' | 'markdown-file' | 'artifact' | 'bookmark-author' | 'bookmark' | 'bookmark-facet' | 'directory';

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
  | { kind: 'markdown'; title: string; filePath: string; content: string };

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
}

function fuzzySubsequenceScore(text: string, query: string): number {
  if (query.length < 2) return 0;
  let queryIndex = 0;
  let firstMatch = -1;
  let lastMatch = -1;
  let gapPenalty = 0;

  for (let i = 0; i < text.length && queryIndex < query.length; i += 1) {
    if (text[i] !== query[queryIndex]) continue;
    if (firstMatch === -1) firstMatch = i;
    if (lastMatch !== -1) gapPenalty += Math.max(0, i - lastMatch - 1);
    lastMatch = i;
    queryIndex += 1;
  }

  if (queryIndex !== query.length || firstMatch === -1) return 0;
  return Math.max(40, 220 - firstMatch * 4 - gapPenalty * 8 - (text.length - query.length));
}

function scoreLauncherText(rawText: string | undefined, query: string): number {
  const text = rawText?.trim().toLowerCase();
  if (!text || !query) return 0;
  if (text === query) return 1000;
  if (text.startsWith(query)) return 850 - Math.min(120, text.length - query.length);
  if (text.split(/[\s/._-]+/).some(part => part.startsWith(query))) return 760 - Math.min(120, text.length - query.length);
  const containsIndex = text.indexOf(query);
  if (containsIndex >= 0) return 600 - Math.min(180, containsIndex * 5);
  return fuzzySubsequenceScore(text, query);
}

function scoreLauncherItem(item: LauncherItem, query: string): number {
  const candidateScores = [
    scoreLauncherText(item.name, query),
    scoreLauncherText(item.displayName, query) - 20,
    ...item.keywords.map(keyword => scoreLauncherText(keyword, query) - 70),
  ];
  const textScore = Math.max(0, ...candidateScores);
  if (textScore <= 0) return 0;

  let typeScore = 0;
  if (item.type === 'directory') typeScore += 35;
  if (item.type === 'command') typeScore += 20;
  if (item.type === 'bookmark-author') typeScore += 15;
  if (item.type === 'bookmark-facet') typeScore += 15;
  if (item.type === 'recent-file') typeScore += 12;
  if (item.type === 'action') typeScore += 10;
  if (item.type === 'handoff') typeScore += 3;

  return textScore + typeScore;
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
  runLocalCommand: (request: string | {
    commandName?: string;
    customInstruction?: string;
    mode?: 'document' | 'selection';
    selection?: { start?: number; end?: number; text?: string } | null;
  }) => Promise<{ success: boolean; error?: string; filePath?: string; commandName?: string; mode?: 'document' | 'selection' }>;
  invokeHandoff: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  getLauncherContext: () => Promise<{ fieldTheoryActive: boolean }>;
  getActiveLibraryFileContext?: () => Promise<LauncherLibraryMoveSource | null>;
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
  };
}

function launcherItemTypeLabel(item: LauncherItem): string {
  switch (item.type) {
    case 'command': return 'Command';
    case 'local-command': return 'Local';
    case 'local-instruction': return 'Local';
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
  input: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    fontSize: '14px',
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
  const [lastLibraryMove, setLastLibraryMove] = useState<LauncherLibraryMoveRecord | null>(null);
  const [commands, setCommands] = useState<PortableCommandInfo[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffInfo[]>([]);
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
  const manualPreviewRef = useRef(false);
  const hasNavigatedRef = useRef(false); // Track if user has used arrow keys
  const hasExplicitSelectionRef = useRef(false);
  const launcherDataRequestRef = useRef(0);
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
    setQuery(message);
    setFiltered([]);
    resizeLauncher(LAUNCHER_COLLAPSED_HEIGHT);
  }, [resizeLauncher]);

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

  const loadLauncherData = useCallback(async () => {
    const requestId = ++launcherDataRequestRef.current;
    setLauncherDataLoading(true);
    await Promise.allSettled([
      loadCommands(),
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
  }, [loadCommands, loadHandoffs, loadHotkeys, loadLibraryMarkdown, loadArtifacts, loadRecentEntries, loadBookmarkAuthors, loadWebBookmarks, loadActiveWebPage, refreshLauncherContext]);

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
    })), [commands]);

  const recentFileItems = useMemo((): LauncherItem[] => {
    return recentEntries.flatMap((entry) => {
      const libraryItem = entry.kind === 'wiki'
        ? libraryMarkdownItems.find((item) => item.type === 'wiki-page' && item.relPath === entry.path)
        : libraryMarkdownItems.find((item) => item.type === 'markdown-file' && item.filePath === entry.path);

      if (entry.kind === 'wiki' && !libraryItem) return [];

      const filePath = libraryItem?.filePath ?? entry.path;
      const relPath = entry.kind === 'wiki' ? entry.path : libraryItem?.relPath;
      const name = libraryItem?.name ?? entry.title;

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
  }, [libraryMarkdownItems, recentEntries]);

  // Build all items (commands + actions + handoffs).
  const allItems = useMemo(() => {
    const handoffItems: LauncherItem[] = handoffs.map(h => ({
      id: `handoff-${h.name}`,
      type: 'handoff' as const,
      name: h.name,
      displayName: h.displayName,
      keywords: [h.name, h.displayName, 'handoff', 'session', ...h.displayName.split('-')],
      filePath: h.filePath,
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
    return [...directoryItems, ...bookmarkFacetItems, ...bookmarkAuthorItems, ...webBookmarkItems, ...recentFileItems, ...markdownItems, ...commandItems, ...handoffItems, ...actionItems];
  }, [commandItems, handoffs, hotkeys, squaresHotkeys, showSquaresInCommandLauncher, isDarkMode, libraryMarkdownItems, artifactReadings, directoryItems, bookmarkAuthorItems, bookmarkFacetItems, webBookmarkItems, recentFileItems, activeWebPage, lastLibraryMove]);

  const namespaceLabel = moveSource
    ? `move: ${moveSource.title}`
    : directoryNamespace?.label ?? (authorNamespace ? `@${authorNamespace}` : bookmarkNamespace?.label ?? namespacePrefix);
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
  }, [bookmarkForItem, markdownPreviewPathForItem]);

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
        .filter(item => item.type === 'handoff');
      // Handoffs are already sorted by recency from the backend
      const cmds = allItems
        .filter(item => item.type === 'command')
        .sort((a, b) => a.name.localeCompare(b.name));

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

    const localMatch = query.trim().match(/^local(?:\s+([\s\S]*))?$/i);
    if (localMatch) {
      const localQuery = (localMatch[1] ?? '').trim();
      const localQueryLower = localQuery.toLowerCase();
      const commandMatches = (localQuery
        ? commandItems
            .map(item => ({ item, score: scoreLauncherItem(item, localQueryLower) }))
            .filter(({ score }) => score > 0)
            .sort((a, b) => b.score - a.score)
            .map(({ item }) => item)
        : commandItems.slice().sort((a, b) => a.name.localeCompare(b.name)))
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

    const scoredMatches = allItems.map(item => {
      const baseScore = scoreLauncherItem(item, q);
      return { item, score: baseScore + getLauncherUsageScore(item, q, usageByItemId, baseScore) };
    }).filter(s => s.score > 0);
    const balancedMatches = dedupeLauncherPersonItems(balanceLauncherNormalModeMatches(scoredMatches));
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
      totalResultCount: scoredMatches.length,
      launcherDataLoading,
      elapsedMs: Math.round((performance.now() - filterStartedAt) * 10) / 10,
    });
  }, [namespacePrefix, directoryNamespace, authorNamespace, bookmarkNamespace, moveSource, query, allItems, isHelpQuery, directoryItems, libraryMarkdownItems, artifactReadings, commandItems, authorBookmarkItems, bookmarkNamespaceItems, localInstructionFallbackForQuery, resizeLauncher, selectIndex, usageByItemId, launcherDataLoading]);

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
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filtered.length === 0) return;
      hasNavigatedRef.current = true;
      manualPreviewRef.current = false;
      const nextIndex = nextLauncherArrowIndex(selectedIndexRef.current, filtered.length, 'down', hasExplicitSelectionRef.current);
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
      const nextIndex = nextLauncherArrowIndex(selectedIndexRef.current, filtered.length, 'up', hasExplicitSelectionRef.current);
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

      if (moveSource) return;

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

      const selectedItem = filtered[currentIndex];
      if (selectedItem && getFieldTheoryTarget(selectedItem)) {
        void invokeItem(selectedItem, { openFieldTheoryTarget: true });
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
      if (bookmarkForItem(selectedItem) || markdownPreviewPathForItem(selectedItem)) {
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
      if (filtered.length > 0) {
        const currentIndex = resolveHighlightedLauncherIndex(selectedIndexRef.current, filtered.length);
        const selectedItem = filtered[currentIndex];
        if (selectedItem) invokeItem(selectedItem, { insertWikiLink: selectedItem.type !== 'command' });
        return;
      }
      const rawQuery = query.trim();
      const inScopedMode = Boolean(namespacePrefix || directoryNamespace || authorNamespace || bookmarkNamespace || moveSource);
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
    const latestContext = await commandsAPI.getLauncherContext().catch(() => ({ fieldTheoryActive: false }));
    const shouldResolveFieldTheoryTarget = options.openFieldTheoryTarget || latestContext?.fieldTheoryActive;
    const fieldTheoryTarget = shouldResolveFieldTheoryTarget ? getFieldTheoryTarget(item) : null;
    traceLauncher('invoke-item', {
      item: describeLauncherItem(item),
      fieldTheoryActive: latestContext?.fieldTheoryActive ?? false,
      hasFieldTheoryTarget: !!fieldTheoryTarget,
      openFieldTheoryTarget: options.openFieldTheoryTarget ?? false,
      insertWikiLink: options.insertWikiLink ?? false,
    });
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
  }, [applyTheme, dismissPreview, getFieldTheoryTarget, getWikiLinkText, loadWebBookmarks, moveLibraryFileToDirectory, moveSource, noteItemUsage, prepareLauncherForNextOpen, resizeLauncher, selectIndex, showLauncherMessage, undoLastLibraryMove]);

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
    loading: launcherDataLoading,
    hasLoadedItems: allItems.length > 0,
  });

  return (
    <div style={{
      ...styles.container,
      visibility: launcherSessionReady ? 'visible' : 'hidden',
    }}>
      <style>
        {`
          .command-launcher-input::placeholder {
            color: currentColor;
            font-size: 10px;
            opacity: 0.55;
          }
        `}
      </style>
      <div style={styles.inputRow}>
        <img
          src={isDarkMode ? 'fieldtheory-icon.png' : 'field-theory-icon-black.png'}
          alt=""
          style={styles.icon}
        />
        {namespaceLabel && (
          <span style={styles.namespaceTag}>{namespaceLabel}</span>
        )}
        <input
          ref={inputRef}
          className="command-launcher-input"
          type="text"
          name="field-theory-command-launcher-query"
          placeholder="Search your markdown, commands, or bookmarks"
          aria-label={namespaceLabel ? `${namespaceLabel} search` : 'Command search'}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          value={query}
          onChange={e => setQuery(e.target.value)}
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
