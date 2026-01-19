/**
 * CommandsSettings - Configure portable commands directories.
 *
 * Allows users to point to multiple folders containing markdown files
 * (like Claude skills, Cursor rules, etc.) that can be invoked
 * by name during transcription.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';

type PortableCommandInfo = {
  name: string;
  displayName: string;
  filePath: string;
};

type WatchedDir = {
  path: string;
  enabled: boolean;
};

export default function CommandsSettings() {
  const { theme } = useTheme();

  // Watched directories (multi-directory support).
  const [watchedDirs, setWatchedDirs] = useState<WatchedDir[]>([]);
  const [loading, setLoading] = useState(true);

  // Available commands from all directories (for counting).
  const [commands, setCommands] = useState<PortableCommandInfo[]>([]);

  // Error state.
  const [error, setError] = useState<string | null>(null);

  // Path input for adding new directories.
  const [newPath, setNewPath] = useState('');

  // Count commands per directory.
  const commandCountsByDir = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const dir of watchedDirs) {
      counts[dir.path] = commands.filter(cmd => cmd.filePath.startsWith(dir.path)).length;
    }
    return counts;
  }, [watchedDirs, commands]);

  // Load initial state.
  useEffect(() => {
    if (!window.commandsAPI) {
      setLoading(false);
      return;
    }

    Promise.all([
      window.commandsAPI.getWatchedDirs(),
      window.commandsAPI.getCommands(),
    ]).then(([dirs, cmds]) => {
      setWatchedDirs(dirs || []);
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

    return () => {
      unsubCommands();
    };
  }, []);

  // Handle adding a new directory.
  const handleAddDirectory = useCallback(async () => {
    if (!window.commandsAPI || !newPath.trim()) return;

    setError(null);
    const trimmed = newPath.trim();

    try {
      const result = await window.commandsAPI.addWatchedDir(trimmed);
      if (result) {
        setWatchedDirs((prev) => [...prev, result]);
        setNewPath('');
        // Refresh commands to get updated counts
        const cmds = await window.commandsAPI.getCommands();
        setCommands(cmds);
      } else {
        // Check if already watched
        const dirs = await window.commandsAPI.getWatchedDirs();
        const alreadyWatched = dirs?.some((d) => {
          const inputPath = trimmed.replace(/^~/, '');
          return d.path.endsWith(inputPath) || d.path === trimmed;
        });

        if (alreadyWatched) {
          setError('This directory is already being watched.');
        } else {
          setError('Directory not found. Please check the path and try again.');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [newPath]);

  // Handle removing a directory.
  const handleRemoveDirectory = useCallback(async (dirPath: string) => {
    if (!window.commandsAPI) return;

    setError(null);
    try {
      const success = await window.commandsAPI.removeWatchedDir(dirPath);
      if (success) {
        setWatchedDirs((prev) => prev.filter((d) => d.path !== dirPath));
        // Refresh commands
        const cmds = await window.commandsAPI.getCommands();
        setCommands(cmds);
      } else {
        setError('Failed to remove directory');
      }
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
        Point to folders containing your command markdown files.
        Use <strong>⌘⇧K</strong> to invoke a command in any application, or say "use the [name] command" during transcription.
      </p>

      <div style={{
        padding: '16px',
        borderRadius: '8px',
        backgroundColor: theme.isDark ? theme.bgSecondary : '#f9fafb',
        border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
      }}>
        {/* Watched Directories */}
        <div>
          <label style={{
            display: 'block',
            marginBottom: '8px',
            fontSize: '13px',
            fontWeight: 600,
            color: theme.text,
          }}>
            Watched Directories
          </label>

          {/* List of watched directories with command counts */}
          {watchedDirs.length > 0 && (
            <div style={{
              marginBottom: '12px',
              border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
              borderRadius: '6px',
              backgroundColor: theme.isDark ? theme.surface2 : '#fff',
              overflow: 'hidden',
            }}>
              {watchedDirs.map((dir, index) => {
                const count = commandCountsByDir[dir.path] || 0;
                return (
                  <div
                    key={dir.path}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderBottom: index < watchedDirs.length - 1
                        ? `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`
                        : 'none',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0, marginRight: '8px' }}>
                      <code style={{
                        fontSize: '12px',
                        fontFamily: 'monospace',
                        color: theme.text,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        display: 'block',
                      }}>
                        {formatPath(dir.path)}
                      </code>
                      <span style={{
                        fontSize: '11px',
                        color: theme.textSecondary,
                      }}>
                        {count} command{count !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemoveDirectory(dir.path)}
                      style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        fontWeight: 500,
                        color: theme.error,
                        backgroundColor: 'transparent',
                        border: `1px solid ${theme.isDark ? 'rgba(248,113,113,0.3)' : '#fecaca'}`,
                        borderRadius: '4px',
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Add directory input */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddDirectory()}
              placeholder="Enter path (e.g., ~/.cursor/commands)"
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
              onClick={handleAddDirectory}
              disabled={!newPath.trim()}
              style={{
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: 500,
                color: newPath.trim() ? '#fff' : theme.textSecondary,
                backgroundColor: newPath.trim() ? theme.info : 'transparent',
                border: newPath.trim() ? 'none' : `1px solid ${theme.border}`,
                borderRadius: '6px',
                cursor: newPath.trim() ? 'pointer' : 'not-allowed',
                opacity: newPath.trim() ? 1 : 0.5,
              }}
            >
              Add
            </button>
          </div>

          {/* Common paths hint */}
          {watchedDirs.length === 0 && (
            <p style={{
              fontSize: '11px',
              color: theme.textSecondary,
              marginTop: '8px',
              marginBottom: '0',
              lineHeight: '1.5',
            }}>
              <strong>Common locations:</strong><br />
              • <code style={{ fontSize: '10px', backgroundColor: theme.isDark ? '#2d2d2d' : '#f3f4f6', padding: '1px 4px', borderRadius: '3px' }}>~/.cursor/commands</code> — Cursor commands<br />
              • <code style={{ fontSize: '10px', backgroundColor: theme.isDark ? '#2d2d2d' : '#f3f4f6', padding: '1px 4px', borderRadius: '3px' }}>~/.claude/commands</code> — Claude commands
            </p>
          )}
        </div>

        {/* Error display */}
        {error && (
          <p style={{
            marginTop: '8px',
            marginBottom: '0',
            fontSize: '12px',
            color: theme.error,
          }}>
            {error}
          </p>
        )}

        {/* View commands note */}
        {watchedDirs.length > 0 && (
          <p style={{
            marginTop: '12px',
            marginBottom: '0',
            fontSize: '12px',
            color: theme.textSecondary,
          }}>
            View and edit commands in the <strong>Commands</strong> tab.
          </p>
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
