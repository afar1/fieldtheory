/**
 * CommandsSettings - Configure portable commands directory.
 * 
 * Allows users to point to a folder containing markdown files
 * (like Claude skills, Cursor rules, etc.) that can be invoked
 * by name during transcription.
 */

import { useEffect, useState, useCallback } from 'react';
import { useTheme } from '../contexts/ThemeContext';

type PortableCommandInfo = {
  name: string;
  displayName: string;
  filePath: string;
};

export default function CommandsSettings() {
  const { theme } = useTheme();
  
  // Commands directory path.
  const [directoryPath, setDirectoryPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Available commands.
  const [commands, setCommands] = useState<PortableCommandInfo[]>([]);
  
  // Error state.
  const [error, setError] = useState<string | null>(null);

  // Manual path input mode.
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualPath, setManualPath] = useState('');

  // Load initial state.
  useEffect(() => {
    if (!window.commandsAPI) {
      setLoading(false);
      return;
    }

    Promise.all([
      window.commandsAPI.getDirectory(),
      window.commandsAPI.getCommands(),
    ]).then(([dir, cmds]) => {
      setDirectoryPath(dir);
      setCommands(cmds);
      setLoading(false);
    }).catch((err) => {
      console.error('Failed to load commands settings:', err);
      setLoading(false);
    });

    // Listen for changes.
    const unsubCommands = window.commandsAPI.onCommandsChanged((cmds) => {
      setCommands(cmds);
    });
    const unsubDir = window.commandsAPI.onDirectoryChanged((dir) => {
      setDirectoryPath(dir);
    });

    return () => {
      unsubCommands();
      unsubDir();
    };
  }, []);

  // Handle clear button click.
  const handleClear = useCallback(async () => {
    if (!window.commandsAPI) return;

    setError(null);
    try {
      const result = await window.commandsAPI.setDirectory(null);
      if (!result.success) {
        setError(result.error || 'Failed to clear directory');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, []);

  // Handle refresh button click.
  const handleRefresh = useCallback(async () => {
    if (!window.commandsAPI) return;

    setError(null);
    try {
      await window.commandsAPI.refreshCommands();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, []);

  // Handle manual path submission.
  const handleManualPathSubmit = useCallback(async () => {
    if (!window.commandsAPI || !manualPath.trim()) return;

    setError(null);
    try {
      // Expand ~ to home directory
      let expandedPath = manualPath.trim();
      if (expandedPath.startsWith('~/')) {
        // The backend will handle the expansion, but we can show it nicely
        expandedPath = manualPath.trim();
      }

      const result = await window.commandsAPI.setDirectory(expandedPath);
      if (result.success) {
        setShowManualInput(false);
        setManualPath('');
      } else {
        setError(result.error || 'Failed to set directory');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [manualPath]);

  if (loading) {
    return (
      <div style={{ padding: '16px' }}>
        <span style={{ color: theme.textSecondary, fontSize: '13px' }}>
          Loading...
        </span>
      </div>
    );
  }

  // Format the directory path for display (shorten home directory).
  const formatPath = (path: string): string => {
    const home = '~';
    if (path.startsWith('/Users/')) {
      const parts = path.split('/');
      if (parts.length > 2) {
        return home + path.slice(('/Users/' + parts[2]).length);
      }
    }
    return path;
  };

  return (
    <div style={{ padding: '0' }}>
      <p style={{
        fontSize: '13px',
        color: theme.textSecondary,
        marginBottom: '16px',
        marginTop: '4px',
        lineHeight: '1.5',
      }}>
        Point to a folder containing your command markdown files. 
        Say "use the [name] command" during transcription to invoke them.
      </p>

      <div style={{
        padding: '16px',
        borderRadius: '8px',
        backgroundColor: theme.isDark ? theme.bgSecondary : '#f9fafb',
        border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
      }}>
        {/* Directory Configuration */}
        <div style={{ marginBottom: directoryPath ? '16px' : '0' }}>
          <label style={{
            display: 'block',
            marginBottom: '8px',
            fontSize: '13px',
            fontWeight: 600,
            color: theme.text,
          }}>
            Commands Directory
          </label>

          {directoryPath && !showManualInput ? (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <code style={{
                flex: 1,
                padding: '8px 12px',
                fontSize: '12px',
                fontFamily: 'monospace',
                backgroundColor: theme.isDark ? theme.surface2 : '#fff',
                border: `1px solid ${theme.isDark ? theme.border : '#d1d5db'}`,
                borderRadius: '6px',
                color: theme.text,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {formatPath(directoryPath)}
              </code>
              <button
                onClick={() => { setShowManualInput(true); setManualPath(directoryPath || ''); }}
                style={{
                  padding: '8px 12px',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: theme.isDark ? '#e5e5e5' : '#374151',
                  backgroundColor: theme.isDark ? theme.surface2 : '#fff',
                  border: `1px solid ${theme.isDark ? theme.border : '#d1d5db'}`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Change
              </button>
              <button
                onClick={handleClear}
                style={{
                  padding: '8px 12px',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: theme.error,
                  backgroundColor: 'transparent',
                  border: `1px solid ${theme.isDark ? theme.border : '#d1d5db'}`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </div>
          ) : (
            /* Path input */
            <div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={manualPath}
                  onChange={(e) => setManualPath(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleManualPathSubmit()}
                  placeholder="Enter path (e.g., ~/.cursor/rules)"
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    fontSize: '13px',
                    fontFamily: 'monospace',
                    backgroundColor: theme.isDark ? theme.surface2 : '#fff',
                    border: `1px solid ${theme.isDark ? theme.border : '#d1d5db'}`,
                    borderRadius: '6px',
                    color: theme.text,
                    outline: 'none',
                  }}
                />
                <button
                  onClick={handleManualPathSubmit}
                  disabled={!manualPath.trim()}
                  style={{
                    padding: '8px 16px',
                    fontSize: '13px',
                    fontWeight: 500,
                    color: '#fff',
                    backgroundColor: manualPath.trim() ? theme.info : '#9ca3af',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: manualPath.trim() ? 'pointer' : 'not-allowed',
                  }}
                >
                  Set
                </button>
                {directoryPath && (
                  <button
                    onClick={() => { setShowManualInput(false); setManualPath(''); }}
                    style={{
                      padding: '8px 12px',
                      fontSize: '13px',
                      color: theme.textSecondary,
                      backgroundColor: 'transparent',
                      border: `1px solid ${theme.isDark ? theme.border : '#d1d5db'}`,
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    Cancel
                  </button>
                )}
              </div>

              {/* Hint text */}
              <p style={{
                fontSize: '11px',
                color: theme.textSecondary,
                marginTop: '8px',
                marginBottom: '0',
                lineHeight: '1.5',
              }}>
                {directoryPath ? (
                  'Supports ~ for home directory'
                ) : (
                  <>
                    <strong>Common locations:</strong><br />
                    • <code style={{ fontSize: '10px', backgroundColor: theme.isDark ? '#2d2d2d' : '#f3f4f6', padding: '1px 4px', borderRadius: '3px' }}>~/.cursor/rules</code> — Cursor rules<br />
                    • <code style={{ fontSize: '10px', backgroundColor: theme.isDark ? '#2d2d2d' : '#f3f4f6', padding: '1px 4px', borderRadius: '3px' }}>~/Documents/commands</code> — Custom commands
                  </>
                )}
              </p>
            </div>
          )}
        </div>

        {/* Error display */}
        {error && (
          <p style={{
            marginTop: '8px',
            fontSize: '12px',
            color: theme.error,
          }}>
            {error}
          </p>
        )}

        {/* Commands list */}
        {directoryPath && (
          <div style={{ marginTop: '16px' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '8px',
            }}>
              <label style={{
                fontSize: '13px',
                fontWeight: 600,
                color: theme.text,
              }}>
                Available Commands ({commands.length})
              </label>
              <button
                onClick={handleRefresh}
                style={{
                  padding: '4px 8px',
                  fontSize: '11px',
                  color: theme.textSecondary,
                  backgroundColor: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                }}
                title="Refresh command list"
              >
                ↻ Refresh
              </button>
            </div>

            {commands.length === 0 ? (
              <p style={{
                fontSize: '12px',
                color: theme.textSecondary,
                fontStyle: 'italic',
              }}>
                No markdown files found in directory.
              </p>
            ) : (
              <div style={{
                maxHeight: '200px',
                overflowY: 'auto',
                border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
                borderRadius: '6px',
                backgroundColor: theme.isDark ? theme.surface2 : '#fff',
              }}>
                {commands.map((cmd, index) => (
                  <div
                    key={cmd.name}
                    style={{
                      padding: '8px 12px',
                      borderBottom: index < commands.length - 1 
                        ? `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}` 
                        : 'none',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <span style={{
                        fontSize: '13px',
                        fontWeight: 500,
                        color: theme.text,
                      }}>
                        {cmd.displayName}
                      </span>
                      <span style={{
                        fontSize: '11px',
                        color: theme.textSecondary,
                        marginLeft: '8px',
                      }}>
                        (use the "{cmd.name}" command)
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Usage instructions */}
        <div style={{
          marginTop: '16px',
          padding: '12px',
          backgroundColor: theme.isDark ? theme.surface2 : '#f0f9ff',
          borderRadius: '6px',
          border: `1px solid ${theme.isDark ? theme.border : '#bfdbfe'}`,
        }}>
          <p style={{
            margin: 0,
            fontSize: '12px',
            color: theme.isDark ? theme.textSecondary : '#1e40af',
            lineHeight: '1.5',
          }}>
            <strong>How it works:</strong> During transcription, say something like 
            "please use the debug command" or "use the review command". 
            The markdown content will be injected into your prompt.
          </p>
        </div>
      </div>
    </div>
  );
}
