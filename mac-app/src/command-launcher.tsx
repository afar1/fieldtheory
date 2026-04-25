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
import {
  buildBuiltInLauncherActions,
  DEFAULT_LAUNCHER_HOTKEYS,
  formatTimeAgo,
  SQUARES_ACTION_IDS,
  DEFAULT_SQUARES_HOTKEYS,
  flattenLibraryRootsForLauncher,
  filterLauncherNamespaceItems,
  buildBookmarkAuthorLauncherItems,
  buildBookmarkPostLauncherItems,
  dedupeLauncherPersonItems,
  isLauncherPreviewToggleKey,
  resolveLauncherAuthorNamespaceHandle,
  type LauncherHotkeyMap,
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

type LauncherItemType = 'command' | 'action' | 'handoff' | 'wiki-page' | 'markdown-file' | 'artifact' | 'bookmark-author' | 'bookmark';

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
  // For actions
  actionId?: string;
  // For handoffs - relative time display
  timeAgo?: string;
  // For bookmark authors
  authorHandle?: string;
  bookmarkCount?: number;
  // For bookmark posts
  bookmarkId?: string;
  postedAt?: string;
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
  invokeCommand: (name: string) => Promise<{ success: boolean; error?: string }>;
  invokeHandoff: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  getLauncherContext: () => Promise<{ fieldTheoryActive: boolean }>;
  openFieldTheoryMarkdown: (target: FieldTheoryMarkdownTarget) => Promise<{ success: boolean; error?: string }>;
  insertMarkdownText: (text: string) => Promise<{ success: boolean; error?: string }>;
  launcherResize: (height: number) => void;
  launcherClose: () => void;
  launcherTrace?: (event: string, details?: Record<string, unknown>) => void;
  launcherPreviewShow?: (bookmark: Bookmark) => void;
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
}

interface LauncherLibraryAPI {
  getRoots: () => Promise<LauncherLibraryRoot[]>;
}

interface LauncherBookmarksAPI {
  getAuthors: () => Promise<BookmarkAuthorSummary[]>;
  getAuthorBookmarks: (handle: string) => Promise<Bookmark[]>;
  invokeBookmark: (id: string) => Promise<{ success: boolean; error?: string }>;
  invokeAuthorTimeline: (handle: string) => Promise<{ success: boolean; error?: string }>;
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
  };
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
    backgroundColor: isDark ? '#1e1e1e' : '#f5f5f5',
    borderRadius: '8px',
    overflow: 'hidden',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  inputRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 10px 10px 10px',
    gap: '6px',
  },
  inputRowWithBorder: {
    borderBottom: `1px solid ${isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.08)'}`,
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
    color: isDark ? '#fff' : '#1a1a1a',
    fontFamily: 'SF Mono, Monaco, Menlo, monospace',
  },
  namespaceTag: {
    display: 'inline-flex',
    alignItems: 'center',
    height: '18px',
    padding: '0 6px',
    borderRadius: '4px',
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)',
    color: isDark ? '#f2f2f2' : '#222',
    fontSize: '10px',
    fontFamily: 'SF Mono, Monaco, Menlo, monospace',
    flexShrink: 0,
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: '3px 0 6px 0',
    maxHeight: '280px',
    overflowY: 'auto' as const,
  },
  listItem: {
    padding: '4px 12px',
    cursor: 'pointer',
    color: isDark ? '#e0e0e0' : '#333',
    fontSize: '10px',
    fontFamily: 'SF Mono, Monaco, Menlo, monospace',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  listItemSelected: {
    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)',
  },
  itemName: {
    flex: 1,
    fontWeight: 400,
    letterSpacing: '-0.2px',
  },
  itemHotkey: {
    fontSize: '9px',
    color: isDark ? '#888' : '#666',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    flexShrink: 0,
  },
  emptyState: {
    padding: '6px 10px',
    color: isDark ? '#666' : '#999',
    fontSize: '9px',
    fontFamily: 'SF Mono, Monaco, Menlo, monospace',
    textAlign: 'center' as const,
  },
  sectionHeader: {
    padding: '5px 12px 3px 12px',
    fontSize: '8px',
    color: isDark ? '#666' : '#999',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    fontWeight: 600,
  },
});

// =============================================================================
// Main Component
// =============================================================================

function CommandLauncher() {
  const [query, setQuery] = useState('');
  const [namespacePrefix, setNamespacePrefix] = useState<NamespacePrefix | null>(null);
  const [authorNamespace, setAuthorNamespace] = useState<string | null>(null);
  const [commands, setCommands] = useState<PortableCommandInfo[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffInfo[]>([]);
  const [hotkeys, setHotkeys] = useState<LauncherHotkeyMap>(DEFAULT_HOTKEYS);
  const [squaresHotkeys, setSquaresHotkeys] = useState<Record<string, string>>(DEFAULT_SQUARES_HOTKEYS);
  const [showSquaresInCommandLauncher, setShowSquaresInCommandLauncher] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [libraryMarkdownItems, setLibraryMarkdownItems] = useState<LauncherItem[]>([]);
  const [artifactReadings, setArtifactReadings] = useState<LauncherItem[]>([]);
  const [bookmarkAuthorItems, setBookmarkAuthorItems] = useState<LauncherItem[]>([]);
  const [authorBookmarkItems, setAuthorBookmarkItems] = useState<LauncherItem[]>([]);
  const [authorBookmarks, setAuthorBookmarks] = useState<Bookmark[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [filtered, setFiltered] = useState<LauncherItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedIndexRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const authorNamespaceRef = useRef<string | null>(null);
  const previewWindowWasOpenRef = useRef(false);
  const hasNavigatedRef = useRef(false); // Track if user has used arrow keys

  const selectIndex = useCallback((index: number) => {
    const nextIndex = Math.max(0, index);
    selectedIndexRef.current = nextIndex;
    setSelectedIndex(nextIndex);
  }, []);

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

  const loadBookmarkAuthors = useCallback(async () => {
    try {
      const authors = await bookmarksAPI?.getAuthors();
      setBookmarkAuthorItems(buildBookmarkAuthorLauncherItems(authors ?? []));
    } catch {}
  }, []);

  const loadAuthorBookmarks = useCallback(async (handle: string) => {
    try {
      const bookmarks = await bookmarksAPI?.getAuthorBookmarks(handle);
      const nextBookmarks = bookmarks ?? [];
      setAuthorBookmarks(nextBookmarks);
      setAuthorBookmarkItems(buildBookmarkPostLauncherItems(nextBookmarks));
    } catch {
      setAuthorBookmarks([]);
      setAuthorBookmarkItems([]);
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
    commandsAPI.launcherResize(36);

    loadCommands();
    loadHandoffs();
    loadHotkeys();
    loadBookmarkAuthors();

    // Load current theme
    themeAPI.getTheme().then(dark => setIsDarkMode(dark));

    // Listen for reset events (when window is shown).
    // Reload commands and handoffs each time to pick up newly added ones without restart.
    const handleReset = async () => {
      setQuery('');
      setNamespacePrefix(null);
      setAuthorNamespace(null);
      setPreviewOpen(false);
      setAuthorBookmarks([]);
      setAuthorBookmarkItems([]);
      setFiltered([]);
      selectIndex(0);
      inputRef.current?.focus();
      loadCommands();
      loadHandoffs();
      loadLibraryMarkdown();
      loadArtifacts();
      loadBookmarkAuthors();
      // Refresh theme state
      const dark = await themeAPI.getTheme();
      setIsDarkMode(dark ?? true);
      // Reset height to input-only
      commandsAPI.launcherResize(36);
    };

    const unsubscribe = commandsAPI.onLauncherReset(handleReset);
    const unsubscribeSquaresConfig = squaresAPI.onConfigChanged?.((config) => {
      setShowSquaresInCommandLauncher(normalizeSquaresConfig(config).showInCommandLauncher);
    });
    const unsubscribeBookmarks = bookmarksAPI?.onChanged?.(() => {
      loadBookmarkAuthors();
      const handle = authorNamespaceRef.current;
      if (handle) loadAuthorBookmarks(handle);
    });
    return () => {
      unsubscribe();
      unsubscribeSquaresConfig?.();
      unsubscribeBookmarks?.();
    };
  }, [loadCommands, loadHandoffs, loadHotkeys, loadLibraryMarkdown, loadArtifacts, loadBookmarkAuthors, loadAuthorBookmarks, selectIndex]);

  useEffect(() => {
    authorNamespaceRef.current = authorNamespace;
    if (!authorNamespace) {
      setAuthorBookmarks([]);
      setAuthorBookmarkItems([]);
      setPreviewOpen(false);
      return;
    }
    loadAuthorBookmarks(authorNamespace);
  }, [authorNamespace, loadAuthorBookmarks]);

  // Build all items (commands + actions + handoffs).
  const allItems = useMemo(() => {
    const commandItems: LauncherItem[] = commands.map(cmd => ({
      id: `cmd-${cmd.name}`,
      type: 'command' as const,
      name: cmd.name,
      displayName: cmd.displayName,
      keywords: [cmd.name, cmd.displayName, ...cmd.name.split('-'), ...cmd.name.split('_')],
      filePath: cmd.filePath,
    }));

    const handoffItems: LauncherItem[] = handoffs.map(h => ({
      id: `handoff-${h.name}`,
      type: 'handoff' as const,
      name: h.name,
      displayName: h.displayName,
      keywords: [h.name, h.displayName, 'handoff', 'session', ...h.displayName.split('-')],
      filePath: h.filePath,
      timeAgo: formatTimeAgo(h.lastModified),
    }));

    const actionItems = buildBuiltInLauncherActions(hotkeys, isDarkMode, squaresHotkeys, showSquaresInCommandLauncher);

    const markdownItems = [...libraryMarkdownItems, ...artifactReadings];
    return [...bookmarkAuthorItems, ...markdownItems, ...commandItems, ...handoffItems, ...actionItems];
  }, [commands, handoffs, hotkeys, squaresHotkeys, showSquaresInCommandLauncher, isDarkMode, libraryMarkdownItems, artifactReadings, bookmarkAuthorItems]);

  const namespaceLabel = authorNamespace ? `@${authorNamespace}` : namespacePrefix;
  const previewBookmark = useMemo(() => {
    if (!previewOpen) return null;
    const selected = filtered[selectedIndex];
    if (selected?.type !== 'bookmark' || !selected.bookmarkId) return null;
    return authorBookmarks.find((bookmark) => bookmark.id === selected.bookmarkId) ?? null;
  }, [authorBookmarks, filtered, previewOpen, selectedIndex]);

  useEffect(() => {
    if (!previewOpen) return;
    traceLauncher('preview-state', {
      hasBookmark: Boolean(previewBookmark),
      selectedIndex,
      filteredCount: filtered.length,
      item: describeLauncherItem(filtered[selectedIndex]),
      bookmarkId: previewBookmark?.id ?? null,
    });
  }, [filtered, previewBookmark, previewOpen, selectedIndex]);

  useEffect(() => {
    if (!previewOpen) {
      if (previewWindowWasOpenRef.current) {
        commandsAPI.launcherPreviewHide?.();
        previewWindowWasOpenRef.current = false;
      }
      return;
    }
    if (!previewBookmark) {
      if (previewWindowWasOpenRef.current) {
        commandsAPI.launcherPreviewHide?.();
        previewWindowWasOpenRef.current = false;
      }
      return;
    }
    previewWindowWasOpenRef.current = true;
    traceLauncher('preview-window-show', {
      selectedIndex,
      bookmarkId: previewBookmark.id,
    });
    commandsAPI.launcherPreviewShow?.(previewBookmark);
  }, [previewBookmark, previewOpen, selectedIndex]);

  // Check if query is a help command.
  const isHelpQuery = useMemo(() => {
    if (namespacePrefix || authorNamespace) return false;
    const q = query.trim().toLowerCase();
    return q === 'help' || q === '?';
  }, [namespacePrefix, authorNamespace, query]);

  // Filter items when query changes.
  useEffect(() => {
    const inputHeight = 36;
    const emptyStateHeight = 26;
    const maxListHeight = 280;

    const resizeForResults = (resultCount: number, forceEmptyState = false) => {
      const itemHeight = 22;
      const listHeight = resultCount > 0
        ? Math.min(resultCount * itemHeight + 10, maxListHeight)
        : (forceEmptyState ? emptyStateHeight : 0);
      commandsAPI.launcherResize(inputHeight + listHeight);
    };

    if (allItems.length === 0 && !authorNamespace) {
      setFiltered([]);
      selectIndex(0);
      // Don't show empty state height when still loading (query is empty)
      // Only show it when user has typed but no results found
      commandsAPI.launcherResize(inputHeight);
      return;
    }

    if (!namespacePrefix && !authorNamespace && query.trim() === '') {
      setFiltered([]);
      selectIndex(0);
      commandsAPI.launcherResize(inputHeight);
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
        280
      );
      commandsAPI.launcherResize(inputHeight + listHeight);
      return;
    }

    const q = query.toLowerCase();

    if (authorNamespace) {
      const results = filterLauncherNamespaceItems(authorBookmarkItems, q);
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

    // Score and filter items.
    const scored = allItems.map(item => {
      let score = 0;

      // Exact name match.
      if (item.name.toLowerCase() === q) score += 200;

      // Name starts with query.
      if (item.name.toLowerCase().startsWith(q)) score += 100;

      // Name contains query.
      if (item.name.toLowerCase().includes(q)) score += 50;

      // Display name contains query.
      if (item.displayName.toLowerCase().includes(q)) score += 40;

      // Any keyword matches.
      if (item.keywords.some(kw => kw.toLowerCase().includes(q))) score += 30;

      // Prefer the synthesized author action over handle-shaped markdown files.
      if (item.type === 'bookmark-author') score += 25;

      return { item, score };
    });

    const matches = dedupeLauncherPersonItems(scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(s => s.item));

    setFiltered(matches);
    selectIndex(0);

    // Resize window.
    resizeForResults(matches.length, true);
  }, [namespacePrefix, authorNamespace, query, allItems, isHelpQuery, libraryMarkdownItems, artifactReadings, authorBookmarkItems, selectIndex]);

  // Reset navigation flag when filtered results change.
  useEffect(() => {
    hasNavigatedRef.current = false;
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

  // Handle keyboard navigation.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (previewOpen) {
        e.preventDefault();
        traceLauncher('preview-close', { source: 'escape' });
        setPreviewOpen(false);
        return;
      }
      commandsAPI.launcherClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filtered.length === 0) return;
      hasNavigatedRef.current = true;
      const nextIndex = Math.min(selectedIndexRef.current + 1, filtered.length - 1);
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
      const nextIndex = Math.max(selectedIndexRef.current - 1, 0);
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
      if (namespacePrefix || authorNamespace) return;

      const rawQuery = query.trim();
      const q = rawQuery.toLowerCase();
      const currentIndex = selectedIndexRef.current;
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
          setPreviewOpen(false);
          setQuery('');
          return;
        }
      }
    } else if (isLauncherPreviewToggleKey(e)) {
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
        setPreviewOpen(false);
        return;
      }
      if (selectedItem?.type === 'bookmark') {
        e.preventDefault();
        selectIndex(currentIndex);
        traceLauncher('preview-open-bookmark', {
          selectedIndex: currentIndex,
          item: describeLauncherItem(selectedItem),
        });
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
    } else if (e.key === 'Backspace' && (namespacePrefix || authorNamespace) && query === '') {
      e.preventDefault();
      setNamespacePrefix(null);
      setAuthorNamespace(null);
      setPreviewOpen(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered.length > 0) {
        const currentIndex = Math.min(selectedIndexRef.current, filtered.length - 1);
        const selectedItem = filtered[currentIndex];
        if (selectedItem) invokeItem(selectedItem, { insertWikiLink: e.metaKey });
      }
    }
  };

  // Invoke the selected item.
  const invokeItem = useCallback(async (item: LauncherItem, options: { insertWikiLink?: boolean } = {}) => {
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
    } else if (item.type === 'bookmark-author') {
      if (item.authorHandle) {
        await bookmarksAPI?.invokeAuthorTimeline(item.authorHandle);
      }
      commandsAPI.launcherClose();
    } else if (item.type === 'bookmark') {
      if (item.bookmarkId) {
        await bookmarksAPI?.invokeBookmark(item.bookmarkId);
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
            await themeAPI.setTheme(!currentIsDark);
          })();
          break;
        // Route Squares window management actions.
        default:
          if (item.actionId && SQUARES_ACTION_IDS.has(item.actionId)) {
            squaresAPI.executeAction(item.actionId, 'command-launcher');
          }
          break;
      }
      commandsAPI.launcherClose();
    }
  }, [getFieldTheoryTarget, getWikiLinkText]);

  const hasContentBelow = filtered.length > 0 || ((namespaceLabel || query.trim() !== '') && (allItems.length > 0 || authorBookmarkItems.length > 0));
  // Always use dark mode styling for the launcher regardless of system theme
  const styles = getStyles(true);

  return (
    <div style={styles.container}>
      <div style={{
        ...styles.inputRow,
        ...(hasContentBelow ? styles.inputRowWithBorder : {}),
      }}>
        <img
          src="fieldtheory-icon.png"
          alt=""
          style={styles.icon}
        />
        {namespaceLabel && (
          <span style={styles.namespaceTag}>{namespaceLabel}</span>
        )}
        <input
          ref={inputRef}
          type="text"
          placeholder="Type a command (? for help)"
          aria-label={namespaceLabel ? `${namespaceLabel} search` : 'Command search'}
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
                        ...(globalIndex === selectedIndex ? styles.listItemSelected : {}),
                      }}
                      onClick={(event) => invokeItem(item, { insertWikiLink: event.metaKey })}
                      onMouseEnter={() => selectIndex(globalIndex)}
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
                        ...(globalIndex === selectedIndex ? styles.listItemSelected : {}),
                      }}
                      onClick={(event) => invokeItem(item, { insertWikiLink: event.metaKey })}
                      onMouseEnter={() => selectIndex(globalIndex)}
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
                        ...(globalIndex === selectedIndex ? styles.listItemSelected : {}),
                      }}
                      onClick={(event) => invokeItem(item, { insertWikiLink: event.metaKey })}
                      onMouseEnter={() => selectIndex(globalIndex)}
                    >
                      <span style={styles.itemName}>{item.name}</span>
                    </li>
                  );
                })}
            </>
          ) : (
            // Normal mode: flat list.
            filtered.map((item, i) => (
              <li
                key={item.id}
                data-item-index={i}
                style={{
                  ...styles.listItem,
                  ...(i === selectedIndex ? styles.listItemSelected : {}),
                }}
                onClick={(event) => invokeItem(item, { insertWikiLink: event.metaKey })}
                onMouseEnter={() => selectIndex(i)}
              >
                <span style={styles.itemName}>
                  {item.type === 'command' ? item.name : item.displayName}
                </span>
                {item.hotkeyDisplay && (
                  <span style={styles.itemHotkey}>{item.hotkeyDisplay}</span>
                )}
                {item.type === 'handoff' && item.timeAgo && (
                  <span style={styles.itemHotkey}>{item.timeAgo}</span>
                )}
              </li>
            ))
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
    <CommandLauncher />
  </React.StrictMode>
);
