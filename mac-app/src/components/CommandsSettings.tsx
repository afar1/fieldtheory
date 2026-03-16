/**
 * CommandsSettings - Configure portable commands directories.
 *
 * Allows users to point to multiple folders containing markdown files
 * (like Claude skills, Cursor rules, etc.) that can be invoked
 * by name during transcription.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { SettingsInsetGroup, SettingsNotice, SettingsSectionHeading } from './settings/SettingsPrimitives';

type PortableCommandInfo = {
  name: string;
  displayName: string;
  filePath: string;
};

type WatchedDir = {
  path: string;
  enabled: boolean;
  mobileSyncEnabled: boolean;
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

  // Mobile sync state.
  const [syncingDir, setSyncingDir] = useState<string | null>(null);
  const [remoteCount, setRemoteCount] = useState<number>(0);

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
      window.commandsAPI.getRemoteCommandCount(),
    ]).then(([dirs, cmds, count]) => {
      setWatchedDirs(dirs || []);
      setCommands(cmds);
      setRemoteCount(count);
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
        // Update remote count
        const count = await window.commandsAPI.getRemoteCommandCount();
        setRemoteCount(count);
      } else {
        setError('Failed to remove directory');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, []);

  // Handle toggling mobile sync for a directory.
  const handleToggleMobileSync = useCallback(async (dirPath: string, enabled: boolean) => {
    if (!window.commandsAPI) return;

    setSyncingDir(dirPath);
    setError(null);
    try {
      const success = await window.commandsAPI.setMobileSync(dirPath, enabled);
      if (success) {
        setWatchedDirs((prev) => prev.map((d) =>
          d.path === dirPath ? { ...d, mobileSyncEnabled: enabled } : d
        ));
        // Update remote count after sync
        const count = await window.commandsAPI.getRemoteCommandCount();
        setRemoteCount(count);
      } else {
        setError('Failed to update mobile sync setting');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setSyncingDir(null);
    }
  }, []);

  if (loading) {
    return (
      <div style={{ padding: '16px' }}>
        <span style={{ color: theme.textSecondary, fontSize: '12px' }}>
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
        fontSize: '12px',
        color: theme.textSecondary,
        marginBottom: '16px',
        marginTop: '4px',
        lineHeight: '1.5',
      }}>
        Point to folders containing your command markdown files.
        Use <strong>⌘⇧K</strong> to invoke a command in any application, or say "use the [name] command" during transcription.
      </p>

      <SettingsInsetGroup theme={theme}>
        {/* Watched Directories */}
        <div>
          <SettingsSectionHeading
            theme={theme}
            title="Watched Directories"
            description="Field Theory watches these folders and exposes the markdown commands they contain."
          />

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
                const isSyncing = syncingDir === dir.path;
                return (
                  <div
                    key={dir.path}
                    style={{
                      padding: '8px 12px',
                      borderBottom: index < watchedDirs.length - 1
                        ? `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`
                        : 'none',
                    }}
                  >
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}>
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
                    {/* Mobile sync toggle */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: '6px',
                      paddingTop: '6px',
                      borderTop: `1px dashed ${theme.isDark ? theme.border : '#e5e7eb'}`,
                    }}>
                      <span style={{
                        fontSize: '11px',
                        color: theme.textSecondary,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/>
                          <line x1="12" y1="18" x2="12" y2="18"/>
                        </svg>
                        Available on mobile
                      </span>
                      <button
                        onClick={() => handleToggleMobileSync(dir.path, !dir.mobileSyncEnabled)}
                        disabled={isSyncing}
                        style={{
                          padding: '3px 8px',
                          fontSize: '10px',
                          fontWeight: 500,
                          color: dir.mobileSyncEnabled ? '#fff' : theme.textSecondary,
                          backgroundColor: dir.mobileSyncEnabled
                            ? (theme.isDark ? '#059669' : '#10b981')
                            : 'transparent',
                          border: dir.mobileSyncEnabled
                            ? 'none'
                            : `1px solid ${theme.border}`,
                          borderRadius: '4px',
                          cursor: isSyncing ? 'not-allowed' : 'pointer',
                          opacity: isSyncing ? 0.6 : 1,
                          minWidth: '50px',
                        }}
                      >
                        {isSyncing ? '...' : dir.mobileSyncEnabled ? 'On' : 'Off'}
                      </button>
                    </div>
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
                fontSize: '12px',
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
                fontSize: '12px',
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
              • <code style={{ fontSize: '10px', backgroundColor: theme.isDark ? '#2d2d2d' : '#f3f4f6', padding: '1px 4px', borderRadius: '3px' }}>~/.cursor/commands</code> — Cursor commands
            </p>
          )}
        </div>

        {/* Error display */}
        {error && (
          <SettingsNotice theme={theme} tone="warning">
            {error}
          </SettingsNotice>
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

        {/* Mobile sync status */}
        {remoteCount > 0 && (
          <SettingsNotice theme={theme} tone="success">
            <strong>{remoteCount}</strong> command{remoteCount !== 1 ? 's' : ''} synced to mobile
          </SettingsNotice>
        )}

        {/* Usage instructions */}
        <SettingsNotice theme={theme}>
          <strong>How it works:</strong> During transcription, say something like
          {' '}"please use the debug command" or "use the review command".
          The markdown content will be injected into your prompt.
        </SettingsNotice>
      </SettingsInsetGroup>

      {/* Keyboard shortcut notice */}
      <div style={{
        fontSize: '10px',
        color: theme.textSecondary,
        marginTop: '16px',
        textAlign: 'center',
        padding: '8px 12px',
      }}>
        Use <strong style={{ color: theme.text }}>⌘⇧K</strong> to invoke a command in any application
      </div>
    </div>
  );
}
