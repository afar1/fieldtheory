/**
 * Command Launcher UI
 * 
 * A simple, focused interface for searching and selecting portable commands.
 * Shows a search input with the Field Theory icon. Commands appear only
 * when the user starts typing.
 * 
 * Keyboard controls:
 * - Type to filter commands
 * - Arrow Up/Down to navigate
 * - Enter to select and invoke
 * - Escape to close
 */

import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';

// Types mirror the IPC types from commands.ts.
interface PortableCommandInfo {
  name: string;
  displayName: string;
  filePath: string;
}

// Declare the commandsAPI on window (exposed by preload).
declare global {
  interface Window {
    commandsAPI: {
      getCommands: () => Promise<PortableCommandInfo[]>;
      invokeCommand: (name: string) => Promise<{ success: boolean; error?: string }>;
      launcherResize: (height: number) => void;
      launcherClose: () => void;
      onLauncherReset: (callback: () => void) => () => void;
    };
  }
}

// Styles - inline to keep it self-contained.
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
    maxHeight: '220px',
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
  commandName: {
    fontWeight: 400,
    letterSpacing: '-0.2px',
  },
  emptyState: {
    padding: '8px 12px',
    color: '#666',
    fontSize: '11px',
    fontFamily: 'SF Mono, Monaco, Menlo, monospace',
    textAlign: 'center' as const,
  },
};

function CommandLauncher() {
  const [query, setQuery] = useState('');
  const [commands, setCommands] = useState<PortableCommandInfo[]>([]);
  const [filtered, setFiltered] = useState<PortableCommandInfo[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  
  // Load commands on mount.
  useEffect(() => {
    window.commandsAPI.getCommands().then((cmds: PortableCommandInfo[]) => {
      setCommands(cmds || []);
    });
    
    // Listen for reset events (when window is shown).
    const handleReset = () => {
      setQuery('');
      setFiltered([]);
      setSelectedIndex(0);
      inputRef.current?.focus();
    };
    
    const unsubscribe = window.commandsAPI.onLauncherReset(handleReset);
    
    return () => {
      unsubscribe();
    };
  }, []);
  
  // Filter commands when query changes.
  useEffect(() => {
    const inputHeight = 42; // 10px padding top + 16px icon + 12px padding bottom + 4px buffer
    const emptyStateHeight = 32;
    
    // If no commands configured, show empty state.
    if (commands.length === 0) {
      setFiltered([]);
      window.commandsAPI.launcherResize(inputHeight + emptyStateHeight);
      return;
    }
    
    if (query.trim() === '') {
      setFiltered([]);
      setSelectedIndex(0);
      // Resize window to collapsed state (just input).
      window.commandsAPI.launcherResize(inputHeight);
      return;
    }
    
    const q = query.toLowerCase();
    const matches = commands.filter(cmd =>
      cmd.name.toLowerCase().includes(q) ||
      cmd.displayName.toLowerCase().includes(q)
    );
    setFiltered(matches);
    setSelectedIndex(0);
    
    // Resize window based on number of results.
    const itemHeight = 28; // Smaller items with terminal-style text
    const padding = 12;
    const listHeight = matches.length > 0 
      ? Math.min(matches.length * itemHeight + padding, 220) 
      : emptyStateHeight;
    window.commandsAPI.launcherResize(inputHeight + listHeight);
  }, [query, commands]);
  
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
        invokeCommand(filtered[selectedIndex]);
      }
    }
  };
  
  // Invoke the selected command.
  const invokeCommand = async (cmd: PortableCommandInfo) => {
    await window.commandsAPI.invokeCommand(cmd.name);
    window.commandsAPI.launcherClose();
  };
  
  // Determine if we should show content below the input.
  const hasContentBelow = filtered.length > 0 || 
    (query.trim() !== '' && commands.length > 0) || 
    commands.length === 0;
  
  return (
    <div style={styles.container}>
      <div style={{
        ...styles.inputRow,
        ...(hasContentBelow && query.trim() !== '' ? styles.inputRowWithBorder : {}),
      }}>
        <img
          src="fieldtheory-icon.png"
          alt=""
          style={styles.icon}
        />
        <input
          ref={inputRef}
          type="text"
          placeholder="Type a command"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          style={styles.input}
        />
      </div>
      
      {filtered.length > 0 && (
        <ul style={styles.list}>
          {filtered.map((cmd, i) => (
            <li
              key={cmd.name}
              style={{
                ...styles.listItem,
                ...(i === selectedIndex ? styles.listItemSelected : {}),
              }}
              onClick={() => invokeCommand(cmd)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span style={styles.commandName}>{cmd.name}</span>
            </li>
          ))}
        </ul>
      )}
      
      {query.trim() !== '' && filtered.length === 0 && commands.length > 0 && (
        <div style={styles.emptyState}>No commands found</div>
      )}
      
      {commands.length === 0 && (
        <div style={styles.emptyState}>No commands directory configured</div>
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
