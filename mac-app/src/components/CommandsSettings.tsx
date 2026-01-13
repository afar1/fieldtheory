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

  // Handle browse button click.
  const handleBrowse = useCallback(async () => {
    if (!window.commandsAPI) return;

    setError(null);
    try {
      const selectedPath = await window.commandsAPI.browseDirectory();
      if (selectedPath) {
        const result = await window.commandsAPI.setDirectory(selectedPath);
        if (!result.success) {
          setError(result.error || 'Failed to set directory');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
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
        backgroundColor: theme.isDark ? '#1a1a1a' : '#f9fafb',
        border: `1px solid ${theme.isDark ? '#404040' : '#e5e7eb'}`,
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

          {directoryPath ? (
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <code style={{
                flex: 1,
                padding: '8px 12px',
                fontSize: '12px',
                fontFamily: 'monospace',
                backgroundColor: theme.isDark ? '#2d2d2d' : '#fff',
                border: `1px solid ${theme.isDark ? '#404040' : '#d1d5db'}`,
                borderRadius: '6px',
                color: theme.text,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                {formatPath(directoryPath)}
              </code>
              <button
                onClick={handleBrowse}
                style={{
                  padding: '8px 12px',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: theme.isDark ? '#e5e5e5' : '#374151',
                  backgroundColor: theme.isDark ? '#2d2d2d' : '#fff',
                  border: `1px solid ${theme.isDark ? '#404040' : '#d1d5db'}`,
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
                  color: theme.isDark ? '#f87171' : '#dc2626',
                  backgroundColor: 'transparent',
                  border: `1px solid ${theme.isDark ? '#404040' : '#d1d5db'}`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </div>
          ) : (
            <button
              onClick={handleBrowse}
              style={{
                padding: '10px 16px',
                fontSize: '13px',
                fontWeight: 500,
                color: '#fff',
                backgroundColor: '#3b82f6',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              Select Directory
            </button>
          )}
        </div>

        {/* Error display */}
        {error && (
          <p style={{
            marginTop: '8px',
            fontSize: '12px',
            color: '#ef4444',
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
                border: `1px solid ${theme.isDark ? '#404040' : '#e5e7eb'}`,
                borderRadius: '6px',
                backgroundColor: theme.isDark ? '#2d2d2d' : '#fff',
              }}>
                {commands.map((cmd, index) => (
                  <div
                    key={cmd.name}
                    style={{
                      padding: '8px 12px',
                      borderBottom: index < commands.length - 1 
                        ? `1px solid ${theme.isDark ? '#404040' : '#e5e7eb'}` 
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
          backgroundColor: theme.isDark ? '#2d3748' : '#f0f9ff',
          borderRadius: '6px',
          border: `1px solid ${theme.isDark ? '#4a5568' : '#bfdbfe'}`,
        }}>
          <p style={{
            margin: 0,
            fontSize: '12px',
            color: theme.isDark ? '#a0aec0' : '#1e40af',
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
