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
  type LauncherHotkeyMap,
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

type LauncherItemType = 'command' | 'action' | 'handoff' | 'wiki-page' | 'artifact';

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
  const [commands, setCommands] = useState<PortableCommandInfo[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffInfo[]>([]);
  const [hotkeys, setHotkeys] = useState<LauncherHotkeyMap>(DEFAULT_HOTKEYS);
  const [squaresHotkeys, setSquaresHotkeys] = useState<Record<string, string>>(DEFAULT_SQUARES_HOTKEYS);
  const [showSquaresInCommandLauncher, setShowSquaresInCommandLauncher] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [wikiPages, setWikiPages] = useState<LauncherItem[]>([]);
  const [artifactReadings, setArtifactReadings] = useState<LauncherItem[]>([]);
  const [fieldTheoryActive, setFieldTheoryActive] = useState(false);
  const [filtered, setFiltered] = useState<LauncherItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const hasNavigatedRef = useRef(false); // Track if user has used arrow keys

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

  const loadWikiPages = useCallback(async () => {
    try {
      const tree = await window.wikiAPI?.getTree();
      if (!tree) return;
      setWikiPages(tree.flatMap(folder =>
        folder.files.map(page => ({
          id: `wiki-${page.relPath}`,
          type: 'wiki-page' as const,
          name: page.name,
          displayName: page.title,
          keywords: [page.name, page.title, page.relPath, ...page.name.split('-')],
          filePath: page.absPath,
          relPath: page.relPath,
        }))
      ));
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

  const loadLauncherContext = useCallback(async () => {
    try {
      const context = await commandsAPI.getLauncherContext();
      setFieldTheoryActive(Boolean(context?.fieldTheoryActive));
    } catch {
      setFieldTheoryActive(false);
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
    loadLauncherContext();
    loadHotkeys();

    // Load current theme
    themeAPI.getTheme().then(dark => setIsDarkMode(dark));

    // Listen for reset events (when window is shown).
    // Reload commands and handoffs each time to pick up newly added ones without restart.
    const handleReset = async () => {
      setQuery('');
      setFiltered([]);
      setSelectedIndex(0);
      inputRef.current?.focus();
      await loadLauncherContext();
      loadCommands();
      loadHandoffs();
      loadWikiPages();
      loadArtifacts();
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
    return () => {
      unsubscribe();
      unsubscribeSquaresConfig?.();
    };
  }, [loadCommands, loadHandoffs, loadHotkeys, loadWikiPages, loadArtifacts, loadLauncherContext]);

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

    const markdownItems = fieldTheoryActive ? [...wikiPages, ...artifactReadings] : [];
    return [...markdownItems, ...commandItems, ...handoffItems, ...actionItems];
  }, [commands, handoffs, hotkeys, squaresHotkeys, showSquaresInCommandLauncher, isDarkMode, fieldTheoryActive, wikiPages, artifactReadings]);

  // Check if query is a help command.
  const isHelpQuery = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === 'help' || q === '?';
  }, [query]);

  // Filter items when query changes.
  useEffect(() => {
    const inputHeight = 36;
    const emptyStateHeight = 26;

    if (allItems.length === 0) {
      setFiltered([]);
      // Don't show empty state height when still loading (query is empty)
      // Only show it when user has typed but no results found
      commandsAPI.launcherResize(inputHeight);
      return;
    }

    if (query.trim() === '') {
      setFiltered([]);
      setSelectedIndex(0);
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
      setSelectedIndex(0);

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

    const nsMatch = q.match(/^(wiki|artifact)\s+(.*)$/);
    if (nsMatch) {
      const [, ns, search] = nsMatch;
      const pool = ns === 'wiki' ? wikiPages : artifactReadings;
      const s = search.trim().toLowerCase();
      const results = s
        ? pool.filter(item =>
            item.name.toLowerCase().includes(s) ||
            item.displayName.toLowerCase().includes(s) ||
            item.keywords.some(k => k.toLowerCase().includes(s))
          )
        : pool;
      setFiltered(results.slice(0, 20));
      setSelectedIndex(0);
      const itemHeight = 22;
      const listHeight = Math.min(results.length * itemHeight + 10, 280);
      commandsAPI.launcherResize(inputHeight + (results.length > 0 ? listHeight : emptyStateHeight));
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
      }, ...wikiPages.slice(0, 5)]);
      setSelectedIndex(0);
      commandsAPI.launcherResize(inputHeight + Math.min(6 * 22 + 10, 280));
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

      return { item, score };
    });

    const matches = scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(s => s.item);

    setFiltered(matches);
    setSelectedIndex(0);

    // Resize window.
    const itemHeight = 22;
    const padding = 10;
    const listHeight = matches.length > 0
      ? Math.min(matches.length * itemHeight + padding, 280)
      : emptyStateHeight;
    commandsAPI.launcherResize(inputHeight + listHeight);
  }, [query, allItems, isHelpQuery, wikiPages, artifactReadings]);

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
      commandsAPI.launcherClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      hasNavigatedRef.current = true;
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      hasNavigatedRef.current = true;
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const q = query.trim().toLowerCase();
      for (const prefix of NAMESPACE_PREFIXES) {
        if (prefix.startsWith(q) && q.length > 0) {
          setQuery(prefix + ' ');
          return;
        }
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered.length > 0) {
        invokeItem(filtered[selectedIndex], { insertWikiLink: e.metaKey });
      }
    }
  };

  // Invoke the selected item.
  const invokeItem = useCallback(async (item: LauncherItem, options: { insertWikiLink?: boolean } = {}) => {
    const fieldTheoryTarget = fieldTheoryActive ? getFieldTheoryTarget(item) : null;
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
    } else if (item.type === 'wiki-page' || item.type === 'artifact') {
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
  }, [fieldTheoryActive, getFieldTheoryTarget, getWikiLinkText]);

  const hasContentBelow = filtered.length > 0 || (query.trim() !== '' && allItems.length > 0);
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
        <input
          ref={inputRef}
          type="text"
          placeholder="Type a command (? for help)"
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
                      onClick={() => invokeItem(item)}
                      onMouseEnter={() => setSelectedIndex(globalIndex)}
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
                      onClick={() => invokeItem(item)}
                      onMouseEnter={() => setSelectedIndex(globalIndex)}
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
                      onClick={() => invokeItem(item)}
                      onMouseEnter={() => setSelectedIndex(globalIndex)}
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
                onClick={() => invokeItem(item)}
                onMouseEnter={() => setSelectedIndex(i)}
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

      {query.trim() !== '' && filtered.length === 0 && (
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
