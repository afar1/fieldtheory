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

// =============================================================================
// Types
// =============================================================================

interface PortableCommandInfo {
  name: string;
  displayName: string;
  filePath: string;
}

type LauncherItemType = 'command' | 'action';

interface LauncherItem {
  id: string;
  type: LauncherItemType;
  name: string;
  displayName: string;
  keywords: string[];
  hotkey?: string;
  hotkeyDisplay?: string;
  // For commands
  filePath?: string;
  // For actions
  actionId?: string;
}

// Window API types for the launcher's standalone renderer context.
// In the launcher window, these APIs are always available (not optional).
interface LauncherCommandsAPI {
  getCommands: () => Promise<PortableCommandInfo[]>;
  invokeCommand: (name: string) => Promise<{ success: boolean; error?: string }>;
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

interface LauncherTodoAPI {
  getHotkey: () => Promise<string>;
}

interface LauncherThemeAPI {
  getTheme: () => Promise<boolean>;
  setTheme: (isDark: boolean) => Promise<void>;
}

// Type-safe accessors for the launcher context
const commandsAPI = window.commandsAPI as unknown as LauncherCommandsAPI;
const clipboardAPI = window.clipboardAPI as unknown as LauncherClipboardAPI;
const transcribeAPI = window.transcribeAPI as unknown as LauncherTranscribeAPI;
const todoAPI = window.todoAPI as unknown as LauncherTodoAPI;
const themeAPI = window.themeAPI as unknown as LauncherThemeAPI;

// =============================================================================
// Hotkey Formatting
// =============================================================================

function formatHotkeyDisplay(hotkey: string): string {
  if (!hotkey) return '';
  return hotkey
    .replace(/Command/g, '⌘')
    .replace(/Cmd/g, '⌘')
    .replace(/Shift/g, '⇧')
    .replace(/Option/g, '⌥')
    .replace(/Alt/g, '⌥')
    .replace(/Control/g, '⌃')
    .replace(/Ctrl/g, '⌃')
    .replace(/\+/g, ' ')
    .replace(/\\/g, '\\');
}

// =============================================================================
// Default Hotkeys
// =============================================================================

const DEFAULT_HOTKEYS = {
  screenshot: 'Alt+4',
  fullScreen: 'Alt+3',
  activeWindow: 'Shift+Alt+3',
  history: 'Option+Space',
  transcription: 'Command+\\',
  tasks: 'Shift+Command+T',
  superPaste: 'Shift+Command+V',
};

// =============================================================================
// Built-in Actions
// =============================================================================

function getBuiltInActions(hotkeys: typeof DEFAULT_HOTKEYS, isDarkMode: boolean): LauncherItem[] {
  return [
    {
      id: 'action-settings',
      type: 'action',
      name: 'settings',
      displayName: 'Open Settings',
      keywords: ['settings', 'preferences', 'config', 'configure', 'options'],
      hotkey: 'Command+,',
      hotkeyDisplay: '⌘ ,',
      actionId: 'settings',
    },
    {
      id: 'action-screenshot',
      type: 'action',
      name: 'screenshot',
      displayName: 'Take Screenshot',
      keywords: ['screenshot', 'capture', 'screen', 'region', 'selection', 'snap'],
      hotkey: hotkeys.screenshot,
      hotkeyDisplay: formatHotkeyDisplay(hotkeys.screenshot),
      actionId: 'take-screenshot',
    },
    {
      id: 'action-fullscreen',
      type: 'action',
      name: 'full screen',
      displayName: 'Full Screen Screenshot',
      keywords: ['full', 'screen', 'screenshot', 'entire', 'whole', 'desktop'],
      hotkey: hotkeys.fullScreen,
      hotkeyDisplay: formatHotkeyDisplay(hotkeys.fullScreen),
      actionId: 'full-screen-screenshot',
    },
    {
      id: 'action-window',
      type: 'action',
      name: 'active window',
      displayName: 'Active Window Screenshot',
      keywords: ['active', 'window', 'screenshot', 'focused', 'current'],
      hotkey: hotkeys.activeWindow,
      hotkeyDisplay: formatHotkeyDisplay(hotkeys.activeWindow),
      actionId: 'active-window-screenshot',
    },
    {
      id: 'action-recording',
      type: 'action',
      name: 'recording',
      displayName: 'Start Recording',
      keywords: ['record', 'recording', 'transcribe', 'transcription', 'voice', 'audio', 'dictate'],
      hotkey: hotkeys.transcription,
      hotkeyDisplay: formatHotkeyDisplay(hotkeys.transcription),
      actionId: 'start-recording',
    },
    {
      id: 'action-superpaste',
      type: 'action',
      name: 'terminal image paste',
      displayName: 'Terminal Image Paste',
      keywords: ['terminal', 'image', 'paste', 'base64', 'stack', 'quick'],
      hotkey: hotkeys.superPaste,
      hotkeyDisplay: formatHotkeyDisplay(hotkeys.superPaste),
      actionId: 'super-paste',
    },
    {
      id: 'action-tasks',
      type: 'action',
      name: 'tasks',
      displayName: 'Toggle Tasks',
      keywords: ['tasks', 'todos', 'todo', 'list', 'checklist'],
      hotkey: hotkeys.tasks,
      hotkeyDisplay: formatHotkeyDisplay(hotkeys.tasks),
      actionId: 'toggle-tasks',
    },
    {
      id: 'action-history',
      type: 'action',
      name: 'history',
      displayName: 'Open Clipboard History',
      keywords: ['history', 'clipboard', 'clips', 'copied', 'recent'],
      hotkey: hotkeys.history,
      hotkeyDisplay: formatHotkeyDisplay(hotkeys.history),
      actionId: 'open-history',
    },
    {
      id: 'action-theme',
      type: 'action',
      name: 'theme',
      displayName: isDarkMode ? 'Toggle Light Mode (Field Theory)' : 'Toggle Dark Mode (Field Theory)',
      keywords: ['theme', 'dark', 'light', 'mode', 'appearance', 'color', 'field', 'theory'],
      hotkey: 'Shift+Command+L',
      hotkeyDisplay: '⇧ ⌘ L',
      actionId: 'toggle-theme',
    },
  ];
}

// =============================================================================
// Styles
// =============================================================================

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    backgroundColor: 'transparent',
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
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
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
    color: '#fff',
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
    color: '#e0e0e0',
    fontSize: '10px',
    fontFamily: 'SF Mono, Monaco, Menlo, monospace',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  listItemSelected: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  itemName: {
    flex: 1,
    fontWeight: 400,
    letterSpacing: '-0.2px',
  },
  itemHotkey: {
    fontSize: '9px',
    color: '#888',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    flexShrink: 0,
  },
  emptyState: {
    padding: '6px 10px',
    color: '#666',
    fontSize: '9px',
    fontFamily: 'SF Mono, Monaco, Menlo, monospace',
    textAlign: 'center' as const,
  },
  sectionHeader: {
    padding: '5px 12px 3px 12px',
    fontSize: '8px',
    color: '#666',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    fontWeight: 600,
  },
};

// =============================================================================
// Main Component
// =============================================================================

function CommandLauncher() {
  const [query, setQuery] = useState('');
  const [commands, setCommands] = useState<PortableCommandInfo[]>([]);
  const [hotkeys, setHotkeys] = useState(DEFAULT_HOTKEYS);
  const [isDarkMode, setIsDarkMode] = useState(true);
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

  // Load hotkeys from preferences.
  const loadHotkeys = useCallback(async () => {
    try {
      const [clipboardHotkeys, transcriptionHotkey] = await Promise.all([
        clipboardAPI.getHotkeys?.() ?? {},
        transcribeAPI.getHotkey?.() ?? DEFAULT_HOTKEYS.transcription,
      ]);

      setHotkeys({
        screenshot: clipboardHotkeys.screenshot || DEFAULT_HOTKEYS.screenshot,
        fullScreen: clipboardHotkeys.fullScreen || DEFAULT_HOTKEYS.fullScreen,
        activeWindow: clipboardHotkeys.activeWindow || DEFAULT_HOTKEYS.activeWindow,
        history: clipboardHotkeys.history || DEFAULT_HOTKEYS.history,
        transcription: transcriptionHotkey as string || DEFAULT_HOTKEYS.transcription,
        tasks: DEFAULT_HOTKEYS.tasks,
        superPaste: DEFAULT_HOTKEYS.superPaste,
      });
    } catch (err) {
      console.error('[CommandLauncher] Failed to load hotkeys:', err);
    }
  }, []);

  // Load commands and hotkeys on mount.
  useEffect(() => {
    // Set initial height immediately to prevent layout shift
    commandsAPI.launcherResize(36);

    loadCommands();
    loadHotkeys();

    // Load current theme
    themeAPI.getTheme().then(dark => setIsDarkMode(dark));

    // Listen for reset events (when window is shown).
    // Reload commands each time to pick up newly added commands without restart.
    const handleReset = async () => {
      setQuery('');
      setFiltered([]);
      setSelectedIndex(0);
      inputRef.current?.focus();
      // Reload commands to pick up any new ones added since last open.
      loadCommands();
      // Refresh theme state
      const dark = await themeAPI.getTheme();
      setIsDarkMode(dark ?? true);
      // Reset height to input-only
      commandsAPI.launcherResize(36);
    };

    const unsubscribe = commandsAPI.onLauncherReset(handleReset);
    return () => unsubscribe();
  }, [loadCommands, loadHotkeys]);

  // Build all items (commands + actions).
  const allItems = useMemo(() => {
    const commandItems: LauncherItem[] = commands.map(cmd => ({
      id: `cmd-${cmd.name}`,
      type: 'command' as const,
      name: cmd.name,
      displayName: cmd.displayName,
      keywords: [cmd.name, cmd.displayName, ...cmd.name.split('-'), ...cmd.name.split('_')],
      filePath: cmd.filePath,
    }));

    const actionItems = getBuiltInActions(hotkeys, isDarkMode);

    return [...commandItems, ...actionItems];
  }, [commands, hotkeys, isDarkMode]);

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
      // Sort: actions first (alphabetically), then commands (alphabetically).
      const actions = allItems
        .filter(item => item.type === 'action')
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      const cmds = allItems
        .filter(item => item.type === 'command')
        .sort((a, b) => a.name.localeCompare(b.name));

      setFiltered([...actions, ...cmds]);
      setSelectedIndex(0);

      // Resize for all items.
      const itemHeight = 22;
      const sectionHeaderHeight = 20;
      const padding = 10;
      const numSections = (actions.length > 0 ? 1 : 0) + (cmds.length > 0 ? 1 : 0);
      const totalItems = actions.length + cmds.length;
      const listHeight = Math.min(
        totalItems * itemHeight + numSections * sectionHeaderHeight + padding,
        280
      );
      commandsAPI.launcherResize(inputHeight + listHeight);
      return;
    }

    const q = query.toLowerCase();

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
  }, [query, allItems, isHelpQuery]);

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
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered.length > 0) {
        invokeItem(filtered[selectedIndex]);
      }
    }
  };

  // Invoke the selected item.
  const invokeItem = useCallback(async (item: LauncherItem) => {
    if (item.type === 'command') {
      await commandsAPI.invokeCommand(item.name);
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
        // Other actions are handled by closing and letting main process handle.
        default:
          // For actions that need main process handling, we'll extend the IPC later.
          console.log(`[CommandLauncher] Action: ${item.actionId}`);
          break;
      }
      commandsAPI.launcherClose();
    }
  }, []);

  const hasContentBelow = filtered.length > 0 || (query.trim() !== '' && allItems.length > 0);

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
