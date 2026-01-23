/**
 * DebugConsole - In-app console log viewer.
 *
 * Captures console.log/warn/error calls and displays them in a sidebar.
 * Toggle with Cmd+Shift+D. Filter by prefix (e.g., "[FeedbackDot]").
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { useTheme } from '../contexts/ThemeContext';

interface LogEntry {
  id: number;
  type: 'log' | 'warn' | 'error';
  timestamp: number;
  args: string[];
}

let logIdCounter = 0;

export default function DebugConsole() {
  const { theme } = useTheme();
  const [visible, setVisible] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState('');
  const logsEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Capture console methods
  useEffect(() => {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    const addLog = (type: 'log' | 'warn' | 'error', args: unknown[]) => {
      const entry: LogEntry = {
        id: logIdCounter++,
        type,
        timestamp: Date.now(),
        args: args.map(arg => {
          if (typeof arg === 'string') return arg;
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return String(arg);
          }
        }),
      };
      setLogs(prev => [...prev.slice(-500), entry]); // Keep last 500
    };

    console.log = (...args) => {
      originalLog.apply(console, args);
      addLog('log', args);
    };

    console.warn = (...args) => {
      originalWarn.apply(console, args);
      addLog('warn', args);
    };

    console.error = (...args) => {
      originalError.apply(console, args);
      addLog('error', args);
    };

    return () => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    };
  }, []);

  // Keyboard shortcut: Cmd+Shift+D
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        setVisible(v => !v);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (visible) {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, visible]);

  // Stop propagation of all events to prevent dismissing the popup
  const stopPropagation = useCallback((e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
  }, []);

  const filteredLogs = filter
    ? logs.filter(log => log.args.some(arg => arg.includes(filter)))
    : logs;

  if (!visible) return null;

  return (
    <div
      ref={containerRef}
      onClick={stopPropagation}
      onMouseDown={stopPropagation}
      onKeyDown={stopPropagation}
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: '400px',
        height: '100%',
        backgroundColor: theme.isDark ? '#1a1a1a' : '#f5f5f5',
        borderLeft: `1px solid ${theme.border}`,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'SF Mono, Menlo, Monaco, monospace',
        fontSize: '11px',
        zIndex: 99999,
        boxShadow: '-4px 0 20px rgba(0,0,0,0.3)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: `1px solid ${theme.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 600, color: theme.text }}>Debug Console</span>
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter..."
          onClick={stopPropagation}
          onMouseDown={stopPropagation}
          style={{
            flex: 1,
            padding: '4px 8px',
            borderRadius: '4px',
            border: `1px solid ${theme.border}`,
            backgroundColor: theme.isDark ? '#2a2a2a' : '#fff',
            color: theme.text,
            fontSize: '11px',
            outline: 'none',
          }}
        />
        <button
          onClick={(e) => { stopPropagation(e); setLogs([]); }}
          onMouseDown={stopPropagation}
          style={{
            padding: '4px 8px',
            borderRadius: '4px',
            border: `1px solid ${theme.border}`,
            backgroundColor: 'transparent',
            color: theme.textSecondary,
            fontSize: '10px',
            cursor: 'pointer',
          }}
        >
          Clear
        </button>
        <button
          onClick={(e) => { stopPropagation(e); setVisible(false); }}
          onMouseDown={stopPropagation}
          style={{
            padding: '4px 8px',
            borderRadius: '4px',
            border: `1px solid ${theme.border}`,
            backgroundColor: 'transparent',
            color: theme.textSecondary,
            fontSize: '10px',
            cursor: 'pointer',
          }}
        >
          ✕
        </button>
      </div>

      {/* Logs */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '8px',
        }}
      >
        {filteredLogs.length === 0 ? (
          <div style={{ color: theme.textSecondary, padding: '20px', textAlign: 'center' }}>
            {filter ? `No logs matching "${filter}"` : 'No logs yet'}
          </div>
        ) : (
          filteredLogs.map(log => (
            <div
              key={log.id}
              style={{
                padding: '4px 0',
                borderBottom: `1px solid ${theme.isDark ? '#333' : '#e0e0e0'}`,
                color: log.type === 'error' ? '#ef4444' : log.type === 'warn' ? '#f59e0b' : theme.text,
              }}
            >
              <span style={{ color: theme.textSecondary, marginRight: '8px' }}>
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
              {log.args.map((arg, i) => (
                <span key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {arg}{i < log.args.length - 1 ? ' ' : ''}
                </span>
              ))}
            </div>
          ))
        )}
        <div ref={logsEndRef} />
      </div>

      {/* Footer */}
      <div
        style={{
          padding: '6px 12px',
          borderTop: `1px solid ${theme.border}`,
          color: theme.textSecondary,
          fontSize: '10px',
          flexShrink: 0,
        }}
      >
        {filteredLogs.length} logs • Cmd+Shift+D to toggle
      </div>
    </div>
  );
}
