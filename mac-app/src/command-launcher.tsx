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

// Declare APIs on window (exposed by preload).
declare global {
  interface Window {
    commandsAPI: {
      getCommands: () => Promise<PortableCommandInfo[]>;
      invokeCommand: (name: string) => Promise<{ success: boolean; error?: string }>;
      launcherResize: (height: number) => void;
      launcherClose: () => void;
      onLauncherReset: (callback: () => void) => () => void;
    };
    clipboardAPI?: {
      getHotkeys?: () => Promise<{
        screenshot?: string;
        fullScreen?: string;
        activeWindow?: string;
        history?: string;
      }>;
      captureScreenshot?: (region?: boolean) => Promise<number>;
    };
    transcribeAPI?: {
      getHotkey?: () => Promise<string>;
      toggleRecording?: () => Promise<void>;
    };
    todoAPI?: {
      getHotkey?: () => Promise<string>;
    };
  }
}

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
  screenshot: 'Shift+Command+4',
  fullScreen: 'Command+3',
  activeWindow: 'Shift+Command+3',
  history: 'Option+Space',
  transcription: 'Command+\\',
  tasks: 'Shift+Command+T',
  superPaste: 'Shift+Command+V',
};

// =============================================================================
// Built-in Actions
// =============================================================================

function getBuiltInActions(hotkeys: typeof DEFAULT_HOTKEYS): LauncherItem[] {
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
      name: 'super paste',
      displayName: 'Super Paste',
      keywords: ['super', 'paste', 'smart', 'stack', 'quick'],
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
  ];
}

// =============================================================================
// Styles
// =============================================================================

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    backgroundColor: 'rgba(30, 30, 30, 0.98)',
    borderRadius: '8px',
    overflow: 'hidden',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },
  inputRow: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 12px 12px 12px',
    gap: '8px',
  },
  inputRowWithBorder: {
    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
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
    fontSize: '13px',
    color: '#fff',
    fontFamily: 'SF Mono, Monaco, Menlo, monospace',
  },
  list: {
    listStyle: 'none',
    margin: 0,
    padding: '4px 0',
    maxHeight: '280px',
    overflowY: 'auto' as const,
  },
  listItem: {
    padding: '6px 14px',
    cursor: 'pointer',
    color: '#e0e0e0',
    fontSize: '12px',
    fontFamily: 'SF Mono, Monaco, Menlo, monospace',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
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
    fontSize: '10px',
    color: '#888',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    flexShrink: 0,
  },
  emptyState: {
    padding: '8px 12px',
    color: '#666',
    fontSize: '11px',
    fontFamily: 'SF Mono, Monaco, Menlo, monospace',
    textAlign: 'center' as const,
  },
  sectionHeader: {
    padding: '6px 14px 4px 14px',
    fontSize: '9px',
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
  const [filtered, setFiltered] = useState<LauncherItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load commands and hotkeys on mount.
  useEffect(() => {
    // Load portable commands.
    window.commandsAPI.getCommands().then((cmds: PortableCommandInfo[]) => {
      setCommands(cmds || []);
    });

    // Load hotkeys.
    async function loadHotkeys() {
      try {
        const [clipboardHotkeys, transcriptionHotkey, tasksHotkey] = await Promise.all([
          window.clipboardAPI?.getHotkeys?.() ?? {},
          window.transcribeAPI?.getHotkey?.() ?? DEFAULT_HOTKEYS.transcription,
          window.todoAPI?.getHotkey?.() ?? DEFAULT_HOTKEYS.tasks,
        ]);

        setHotkeys({
          screenshot: clipboardHotkeys.screenshot || DEFAULT_HOTKEYS.screenshot,
          fullScreen: clipboardHotkeys.fullScreen || DEFAULT_HOTKEYS.fullScreen,
          activeWindow: clipboardHotkeys.activeWindow || DEFAULT_HOTKEYS.activeWindow,
          history: clipboardHotkeys.history || DEFAULT_HOTKEYS.history,
          transcription: transcriptionHotkey as string || DEFAULT_HOTKEYS.transcription,
          tasks: tasksHotkey as string || DEFAULT_HOTKEYS.tasks,
          superPaste: DEFAULT_HOTKEYS.superPaste,
        });
      } catch (err) {
        console.error('[CommandLauncher] Failed to load hotkeys:', err);
      }
    }
    loadHotkeys();

    // Listen for reset events (when window is shown).
    const handleReset = () => {
      setQuery('');
      setFiltered([]);
      setSelectedIndex(0);
      inputRef.current?.focus();
    };

    const unsubscribe = window.commandsAPI.onLauncherReset(handleReset);
    return () => unsubscribe();
  }, []);

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

    const actionItems = getBuiltInActions(hotkeys);

    return [...commandItems, ...actionItems];
  }, [commands, hotkeys]);

  // Filter items when query changes.
  useEffect(() => {
    const inputHeight = 42;
    const emptyStateHeight = 32;

    if (allItems.length === 0) {
      setFiltered([]);
      window.commandsAPI.launcherResize(inputHeight + emptyStateHeight);
      return;
    }

    if (query.trim() === '') {
      setFiltered([]);
      setSelectedIndex(0);
      window.commandsAPI.launcherResize(inputHeight);
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
    const itemHeight = 28;
    const padding = 12;
    const listHeight = matches.length > 0
      ? Math.min(matches.length * itemHeight + padding, 280)
      : emptyStateHeight;
    window.commandsAPI.launcherResize(inputHeight + listHeight);
  }, [query, allItems]);

  // Handle keyboard navigation.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      window.commandsAPI.launcherClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
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
      await window.commandsAPI.invokeCommand(item.name);
      window.commandsAPI.launcherClose();
    } else if (item.type === 'action') {
      // Handle built-in actions.
      switch (item.actionId) {
        case 'take-screenshot':
          window.clipboardAPI?.captureScreenshot?.(true);
          break;
        case 'start-recording':
          window.transcribeAPI?.toggleRecording?.();
          break;
        // Other actions are handled by closing and letting main process handle.
        default:
          // For actions that need main process handling, we'll extend the IPC later.
          console.log(`[CommandLauncher] Action: ${item.actionId}`);
          break;
      }
      window.commandsAPI.launcherClose();
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
          placeholder="Type a command or action"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          style={styles.input}
        />
      </div>

      {filtered.length > 0 && (
        <ul style={styles.list}>
          {filtered.map((item, i) => (
            <li
              key={item.id}
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
          ))}
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
