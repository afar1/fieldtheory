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
import ReactDOM from 'react-dom/client';
import TrialGate from './components/TrialGate';
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
  filterLauncherNamespaceItems,
  buildBookmarkAuthorLauncherItems,
  buildBookmarkPostLauncherItems,
  dedupeLauncherPersonItems,
  isGeneratedBookmarkTaxonomyPath,
  nextLauncherArrowIndex,
  resolveLauncherEnterIndex,
  resolveLauncherAuthorNamespaceHandle,
  resolveLauncherBookmarkFacetNamespace,
  resolveLauncherDirectoryNamespace,
  shouldHandleLauncherPreviewShortcut,
  type LauncherHotkeyMap,
  type LauncherDirectoryNamespace,
  type LauncherLibraryRoot,
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

type LauncherItemType = 'command' | 'action' | 'handoff' | 'recent-file' | 'wiki-page' | 'markdown-file' | 'artifact' | 'bookmark-author' | 'bookmark' | 'bookmark-facet' | 'directory';

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

type LauncherPreviewPayload =
  | { kind: 'bookmark'; bookmark: Bookmark }
  | { kind: 'markdown'; title: string; filePath: string; content: string };

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
  recentKind?: LauncherRecentEntry['kind'];
  lastOpenedAt?: number;
  // For actions
  actionId?: string;
  // For handoffs - relative time display
  timeAgo?: string;
  // For bookmark authors
  authorHandle?: string;
  bookmarkCount?: number;
  // For bookmark facets
  facetPaths?: string[];
  // For directory namespaces
  directoryPath?: string;
  directoryRelPath?: string;
  // For bookmark posts
  bookmarkId?: string;
  postedAt?: string;
}

type LauncherLayoutSectionId = 'commands' | 'actions' | 'recent' | 'bookmarks' | 'files';

interface ScoredLauncherItem {
  item: LauncherItem;
  score: number;
}

const NORMAL_MODE_SECTION_ORDER: Array<{ id: LauncherLayoutSectionId; predicate: (item: LauncherItem) => boolean }> = [
  { id: 'commands', predicate: (item) => item.type === 'command' },
  { id: 'actions', predicate: (item) => item.type === 'action' },
  { id: 'recent', predicate: (item) => item.type === 'recent-file' },
  { id: 'bookmarks', predicate: (item) => item.type === 'bookmark' || item.type === 'bookmark-author' || item.type === 'bookmark-facet' },
  { id: 'files', predicate: (item) => item.type === 'wiki-page' || item.type === 'markdown-file' || item.type === 'artifact' || item.type === 'directory' },
];

const NORMAL_MODE_SECTION_LIMITS: Record<LauncherLayoutSectionId, number> = {
  commands: 4,
  actions: 3,
  recent: 3,
  bookmarks: 4,
  files: 6,
};

function getNormalModeSectionId(item: LauncherItem): LauncherLayoutSectionId | null {
  return NORMAL_MODE_SECTION_ORDER.find(section => section.predicate(item))?.id ?? null;
}

function balanceNormalModeMatches(matches: ScoredLauncherItem[]): LauncherItem[] {
  const groups = new Map<LauncherLayoutSectionId, ScoredLauncherItem[]>();
  for (const item of matches) {
    const sectionId = getNormalModeSectionId(item.item);
    if (!sectionId) continue;
    const group = groups.get(sectionId) ?? [];
    group.push(item);
    groups.set(sectionId, group);
  }

  const activeSectionCount = NORMAL_MODE_SECTION_ORDER.filter(section => (groups.get(section.id)?.length ?? 0) > 0).length;
  const recentItems = groups.get('recent') ?? [];
  if (activeSectionCount === 1 && recentItems.length > 0) {
    return recentItems
      .slice()
      .sort((a, b) => (b.item.lastOpenedAt ?? 0) - (a.item.lastOpenedAt ?? 0))
      .map(({ item }) => item);
  }
  if (activeSectionCount <= 1) return matches.map(({ item }) => item);

  const counts = new Map<LauncherLayoutSectionId, number>();
  const balanced: LauncherItem[] = [];
  for (const match of matches) {
    const sectionId = getNormalModeSectionId(match.item);
    if (!sectionId) continue;
    const count = counts.get(sectionId) ?? 0;
    if (count >= NORMAL_MODE_SECTION_LIMITS[sectionId]) continue;
    counts.set(sectionId, count + 1);
    balanced.push(match.item);
  }
  return balanced;
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

function readStoredIsDarkMode(): boolean {
  return localStorage.getItem('darkMode') === 'true';
}

function writeStoredIsDarkMode(isDark: boolean): void {
  localStorage.setItem('darkMode', String(isDark));
}

const NAMESPACE_PREFIXES = ['wiki', 'artifact'] as const;
type NamespacePrefix = typeof NAMESPACE_PREFIXES[number];
type FieldTheoryMarkdownTarget = { kind: 'wiki' | 'artifact' | 'command'; path: string };

let WIKI_COMMAND_PATH: string | null = null;
try { WIKI_COMMAND_PATH = `${process.env.HOME}/.fieldtheory/commands/wiki.md`; } catch {}

// Window API types for the launcher's standalone renderer context.
// In the launcher window, these APIs are always available (not optional).
interface LauncherCommandsAPI {
  getCommands: () => Promise<PortableCommandInfo[]>;
  getHandoffs: () => Promise<HandoffInfo[]>;
  getHandoffContent: (filePath: string) => Promise<{ name: string; content: string; filePath: string } | null>;
  getMarkdownPreview: (filePath: string) => Promise<MarkdownPreview | null>;
  invokeCommand: (name: string) => Promise<{ success: boolean; error?: string }>;
  invokeHandoff: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  getLauncherContext: () => Promise<{ fieldTheoryActive: boolean }>;
  openFieldTheoryMarkdown: (target: FieldTheoryMarkdownTarget) => Promise<{ success: boolean; error?: string }>;
  insertMarkdownText: (text: string) => Promise<{ success: boolean; error?: string }>;
  launcherResize: (height: number) => void;
  launcherClose: () => void;
  launcherTrace?: (event: string, details?: Record<string, unknown>) => void;
  launcherPreviewShow?: (preview: LauncherPreviewPayload) => void;
  launcherPreviewHide?: () => void;
  onLauncherReset: (callback: () => void) => () => void;
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
  getTheme: () => Promise<boolean>;
  setTheme: (isDark: boolean) => Promise<void>;
  onThemeChanged?: (callback: (isDark: boolean) => void) => () => void;
}

interface LauncherLibraryAPI {
  getRoots: () => Promise<LauncherLibraryRoot[]>;
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

// =============================================================================
// Styles (dynamic based on theme)
// =============================================================================

const getStyles = (isDark: boolean) => ({
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    backgroundColor: isDark ? '#1e1e1e' : '#fbfbfa',
    borderRadius: '8px',
    overflow: 'hidden',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  inputRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '9px 10px',
    gap: '6px',
  },
  icon: {
    width: '14px',
    height: 'auto',
    flexShrink: 0,
  },
  input: {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    fontSize: '11px',
    color: isDark ? '#fff' : '#171717',
    fontFamily: 'SF Mono, Monaco, Menlo, monospace',
  },
  namespaceTag: {
    display: 'inline-flex',
    alignItems: 'center',
    height: '18px',
    padding: '0 6px',
    borderRadius: '4px',
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.06)',
    color: isDark ? '#f2f2f2' : '#242424',
    fontSize: '10px',
    fontFamily: 'SF Mono, Monaco, Menlo, monospace',
    flexShrink: 0,
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: '3px 0 6px 0',
    maxHeight: '318px',
    overflowY: 'auto' as const,
  },
  listItem: {
    padding: '4px 12px',
    cursor: 'pointer',
    color: isDark ? '#e0e0e0' : '#262626',
    fontSize: '10px',
    fontFamily: 'SF Mono, Monaco, Menlo, monospace',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  listItemSelected: {
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.075)',
  },
  listItemSelectedSoft: {
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.038)',
  },
  itemName: {
    flex: 1,
    fontWeight: 400,
    letterSpacing: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  itemHotkey: {
    fontSize: '9px',
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
    fontSize: '7px',
    lineHeight: '11px',
    padding: '0 4px',
    borderRadius: '3px',
    color: isDark ? '#8b8b8b' : '#767676',
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.055)' : 'rgba(0, 0, 0, 0.045)',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.3px',
  },
  emptyState: {
    padding: '6px 10px',
    color: isDark ? '#666' : '#777',
    fontSize: '9px',
    fontFamily: 'SF Mono, Monaco, Menlo, monospace',
    textAlign: 'center' as const,
  },
  sectionHeader: {
    padding: '2px 8px 1px 12px',
    fontSize: '7px',
    lineHeight: '10px',
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
  const [commands, setCommands] = useState<PortableCommandInfo[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffInfo[]>([]);
  const [recentEntries, setRecentEntries] = useState<LauncherRecentEntry[]>([]);
  const [hotkeys, setHotkeys] = useState<LauncherHotkeyMap>(DEFAULT_HOTKEYS);
  const [squaresHotkeys, setSquaresHotkeys] = useState<Record<string, string>>(DEFAULT_SQUARES_HOTKEYS);
  const [showSquaresInCommandLauncher, setShowSquaresInCommandLauncher] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(readStoredIsDarkMode);
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
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPayload, setPreviewPayload] = useState<LauncherPreviewPayload | null>(null);
  const [filtered, setFiltered] = useState<LauncherItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hasExplicitSelection, setHasExplicitSelection] = useState(false);
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
  const resizeFrameRef = useRef<number | null>(null);
  const resizeHeightRef = useRef<number>(36);

  const resizeLauncher = useCallback((height: number) => {
    const nextHeight = Math.max(36, Math.round(height));
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
    writeStoredIsDarkMode(dark);
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

  // Load commands from the filesystem.
  const loadCommands = useCallback(async () => {
    try {
      const cmds = await commandsAPI.getCommands();
      console.log('[CommandLauncher] Loaded commands:', cmds?.length || 0, cmds?.map(c => c.name));
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
      console.log('[CommandLauncher] Loaded handoffs:', hoffs?.length || 0);
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

  // Load commands, handoffs, and hotkeys on mount.
  useEffect(() => {
    // Set initial height immediately to prevent layout shift
    resizeLauncher(36);

    loadCommands();
    loadHandoffs();
    loadHotkeys();
    loadLibraryMarkdown();
    loadArtifacts();
    loadRecentEntries();
    loadBookmarkAuthors();
    loadWebBookmarks();
    loadActiveWebPage();

    // Load current Field Theory theme preference and keep this separate window in sync.
    themeAPI.getTheme().then(applyTheme);
    const unsubscribeTheme = themeAPI.onThemeChanged?.(applyTheme);

    // Listen for reset events (when window is shown).
    // Reload commands and handoffs each time to pick up newly added ones without restart.
    const handleReset = async () => {
      authorNamespaceRef.current = null;
      bookmarkNamespaceRef.current = null;
      authorBookmarkRequestRef.current += 1;
      bookmarkNamespaceRequestRef.current += 1;
      activeWebPageRequestRef.current += 1;
      manualPreviewRef.current = false;
      setQuery('');
      setNamespacePrefix(null);
      setDirectoryNamespace(null);
      setAuthorNamespace(null);
      setBookmarkNamespace(null);
      setActiveWebPage(null);
      previewRequestRef.current += 1;
      setPreviewOpen(false);
      setPreviewPayload(null);
      setAuthorBookmarks([]);
      setAuthorBookmarkItems([]);
      setBookmarkNamespaceBookmarks([]);
      setBookmarkNamespaceItems([]);
      setFiltered([]);
      selectIndex(0);
      inputRef.current?.focus();
      loadCommands();
      loadHandoffs();
      loadLibraryMarkdown();
      loadArtifacts();
      loadRecentEntries();
      loadBookmarkAuthors();
      loadWebBookmarks();
      loadActiveWebPage();
      // Refresh theme state
      const dark = await themeAPI.getTheme();
      applyTheme(dark ?? false);
      // Reset height to input-only
      resizeLauncher(36);
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
  }, [applyTheme, loadCommands, loadHandoffs, loadHotkeys, loadLibraryMarkdown, loadArtifacts, loadRecentEntries, loadBookmarkAuthors, loadWebBookmarks, loadActiveWebPage, loadAuthorBookmarks, loadBookmarkNamespace, resizeLauncher, selectIndex]);

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

    const actionItems = buildBuiltInLauncherActions(hotkeys, isDarkMode, squaresHotkeys, showSquaresInCommandLauncher)
      .map((item) => {
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
  }, [commandItems, handoffs, hotkeys, squaresHotkeys, showSquaresInCommandLauncher, isDarkMode, libraryMarkdownItems, artifactReadings, directoryItems, bookmarkAuthorItems, bookmarkFacetItems, webBookmarkItems, recentFileItems, activeWebPage]);

  const namespaceLabel = directoryNamespace?.label ?? (authorNamespace ? `@${authorNamespace}` : bookmarkNamespace?.label ?? namespacePrefix);
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
    if (namespacePrefix || directoryNamespace || authorNamespace || bookmarkNamespace) return false;
    const q = query.trim().toLowerCase();
    return q === 'help' || q === '?';
  }, [namespacePrefix, directoryNamespace, authorNamespace, bookmarkNamespace, query]);

  // Filter items when query changes.
  useEffect(() => {
    const filterStartedAt = performance.now();
    const inputHeight = 36;
    const emptyStateHeight = 26;
    const maxListHeight = 318;

    const resizeForResults = (resultCount: number, forceEmptyState = false) => {
      const itemHeight = 22;
      const listHeight = resultCount > 0
        ? Math.min(resultCount * itemHeight + 10, maxListHeight)
        : (forceEmptyState ? emptyStateHeight : 0);
      resizeLauncher(inputHeight + listHeight);
    };

    if (allItems.length === 0 && !directoryNamespace && !authorNamespace && !bookmarkNamespace) {
      setFiltered([]);
      selectIndex(0);
      // Don't show empty state height when still loading (query is empty)
      // Only show it when user has typed but no results found
      resizeLauncher(inputHeight);
      return;
    }

    if (!namespacePrefix && !directoryNamespace && !authorNamespace && !bookmarkNamespace && query.trim() === '') {
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
      const itemHeight = 22;
      const sectionHeaderHeight = 20;
      const padding = 10;
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

    const scored = allItems.map(item => ({ item, score: scoreLauncherItem(item, q) }));

    const matches = dedupeLauncherPersonItems(scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(s => s.item));
    const scoresById = new Map(scored.map(({ item, score }) => [item.id, score]));
    const scoredMatches = matches.map(item => ({ item, score: scoresById.get(item.id) ?? 0 }));
    const balancedMatches = balanceNormalModeMatches(scoredMatches);

    setFiltered(balancedMatches);
    selectIndex(0);

    // Resize window.
    resizeForResults(balancedMatches.length, true);
    traceLauncher('filter-results', {
      queryLength: query.length,
      namespacePrefix: namespacePrefix ?? null,
      hasDirectoryNamespace: Boolean(directoryNamespace),
      hasAuthorNamespace: Boolean(authorNamespace),
      hasBookmarkNamespace: Boolean(bookmarkNamespace),
      resultCount: balancedMatches.length,
      totalResultCount: matches.length,
      elapsedMs: Math.round((performance.now() - filterStartedAt) * 10) / 10,
    });
  }, [namespacePrefix, directoryNamespace, authorNamespace, bookmarkNamespace, query, allItems, isHelpQuery, libraryMarkdownItems, artifactReadings, commandItems, authorBookmarkItems, bookmarkNamespaceItems, resizeLauncher, selectIndex]);

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

  const getFieldTheoryTarget = useCallback((item: LauncherItem): FieldTheoryMarkdownTarget | null => {
    if (item.type === 'recent-file' && item.recentKind === 'wiki' && item.relPath) {
      return { kind: 'wiki', path: item.relPath };
    }
    if (item.type === 'wiki-page' && item.relPath) {
      return { kind: 'wiki', path: item.relPath };
    }
    if (item.type === 'artifact' && item.filePath) {
      return { kind: 'artifact', path: item.filePath };
    }
    if (item.type === 'command' && item.filePath) {
      return { kind: 'command', path: item.filePath };
    }
    return null;
  }, []);

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

  // Handle keyboard navigation.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (previewOpen) {
        e.preventDefault();
        traceLauncher('preview-close', { source: 'escape' });
        manualPreviewRef.current = false;
        previewRequestRef.current += 1;
        setPreviewOpen(false);
        setPreviewPayload(null);
        return;
      }
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
    } else if (e.key === 'Backspace' && (namespacePrefix || directoryNamespace || authorNamespace || bookmarkNamespace) && query === '') {
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
      previewRequestRef.current += 1;
      setPreviewOpen(false);
      setPreviewPayload(null);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered.length > 0) {
        const currentIndex = resolveLauncherEnterIndex(selectedIndexRef.current, filtered.length, hasNavigatedRef.current);
        const selectedItem = filtered[currentIndex];
        if (selectedItem) invokeItem(selectedItem, { insertWikiLink: e.metaKey });
      }
    }
  };

  // Invoke the selected item.
  const invokeItem = useCallback(async (item: LauncherItem, options: { insertWikiLink?: boolean } = {}) => {
    dismissPreview();
    const latestContext = await commandsAPI.getLauncherContext().catch(() => ({ fieldTheoryActive: false }));
    const fieldTheoryTarget = latestContext?.fieldTheoryActive ? getFieldTheoryTarget(item) : null;
    if (fieldTheoryTarget) {
      if (options.insertWikiLink) {
        await commandsAPI.insertMarkdownText(getWikiLinkText(item));
      } else {
        await commandsAPI.openFieldTheoryMarkdown(fieldTheoryTarget);
      }
      return;
    }

    if (item.type === 'command') {
      await commandsAPI.invokeCommand(item.name);
      commandsAPI.launcherClose();
    } else if (item.type === 'directory') {
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
      commandsAPI.launcherClose();
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
      commandsAPI.launcherClose();
    } else if (item.type === 'recent-file') {
      if (item.filePath) {
        await commandsAPI.invokeHandoff(item.filePath);
      }
      commandsAPI.launcherClose();
    } else if (item.type === 'wiki-page' || item.type === 'markdown-file' || item.type === 'artifact') {
      if (item.filePath) {
        await commandsAPI.invokeHandoff(item.filePath);
      }
      commandsAPI.launcherClose();
    } else if (item.type === 'handoff') {
      if (item.filePath) {
        await commandsAPI.invokeHandoff(item.filePath);
      }
      commandsAPI.launcherClose();
    } else if (item.type === 'action') {
      // Handle built-in actions.
      switch (item.actionId) {
        case 'take-screenshot':
          clipboardAPI.captureScreenshot?.(true);
          break;
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
          resizeLauncher(36);
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
          resizeLauncher(36);
          setPreviewPayload({
            kind: 'markdown',
            title: result.bookmark?.title || preview.title,
            filePath: preview.filePath,
            content: preview.content,
          });
          setPreviewOpen(true);
          return;
        }
        // Route Squares window management actions.
        default:
          if (item.actionId && SQUARES_ACTION_IDS.has(item.actionId)) {
            squaresAPI.executeAction(item.actionId, 'command-launcher');
          }
          break;
      }
      commandsAPI.launcherClose();
    }
  }, [applyTheme, dismissPreview, getFieldTheoryTarget, getWikiLinkText, loadWebBookmarks, resizeLauncher, selectIndex]);

  const styles = getStyles(isDarkMode);
  const selectedItemStyle = (index: number) => {
    if (index !== selectedIndex) return {};
    return hasExplicitSelection ? styles.listItemSelected : styles.listItemSelectedSoft;
  };

  return (
    <div style={styles.container}>
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
        <ul ref={listRef} style={styles.list}>
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
                      onMouseEnter={() => selectExplicitItem(globalIndex)}
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
                      onMouseEnter={() => selectExplicitItem(globalIndex)}
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
                      onMouseEnter={() => selectExplicitItem(globalIndex)}
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
                  onMouseEnter={() => selectExplicitItem(i)}
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

      {(query.trim() !== '' || namespaceLabel) && filtered.length === 0 && (
        <div style={styles.emptyState}>No matches found</div>
      )}
    </div>
  );
}

// Mount the React app.
const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <TrialGate
      showBanner={false}
      onPaywallMount={() => commandsAPI.launcherResize(360)}
    >
      <CommandLauncher />
    </TrialGate>
  </React.StrictMode>
);
