/**
 * CommandsSettings - Configure portable commands directories.
 *
 * Allows users to point to multiple folders containing markdown files
 * (like Claude skills, Cursor rules, etc.) that can be invoked
 * by name during transcription.
 */

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import {
  SettingsBadge,
  SettingsCard,
  SettingsDivider,
  SettingsNotice,
  SettingsSectionHeading,
  SettingsToggle,
} from './settings/SettingsPrimitives';

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
  const [fieldTheorySyncEnabled, setFieldTheorySyncEnabled] = useState(false);

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
      window.fieldTheorySyncAPI?.getStatus(),
    ]).then(async ([dirs, cmds, syncStatus]) => {
      const syncEnabled = syncStatus?.enabled === true;
      setWatchedDirs(dirs || []);
      setCommands(cmds);
      setFieldTheorySyncEnabled(syncEnabled);
      setRemoteCount(syncEnabled ? await window.commandsAPI!.getRemoteCommandCount() : 0);
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

  const renderPathRow = (dir: WatchedDir, index: number) => {
    const count = commandCountsByDir[dir.path] || 0;
    const isSyncing = syncingDir === dir.path;

    return (
      <div key={dir.path}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '11px 0',
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: '7px',
              height: '7px',
              borderRadius: '999px',
              backgroundColor: dir.enabled
                ? (theme.isDark ? '#5bb88a' : '#3d8b6a')
                : theme.textSecondary,
              opacity: dir.enabled ? 1 : 0.45,
              flexShrink: 0,
            }}
          />
          <code
            style={{
              fontSize: '12px',
              fontFamily: "'SF Mono', Monaco, monospace",
              color: theme.text,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'block',
              flex: 1,
              minWidth: 0,
            }}
          >
            {formatPath(dir.path)}
          </code>
          <span
            style={{
              fontSize: '10.5px',
              color: theme.textSecondary,
              fontFamily: "'SF Mono', Monaco, monospace",
              fontVariantNumeric: 'tabular-nums',
              minWidth: '72px',
              textAlign: 'right',
              flexShrink: 0,
            }}
          >
            {count} command{count !== 1 ? 's' : ''}
          </span>
          <SettingsBadge theme={theme} tone={dir.enabled ? 'success' : 'neutral'}>
            {dir.enabled ? 'watching' : 'off'}
          </SettingsBadge>
          <button
            onClick={() => handleRemoveDirectory(dir.path)}
            title="Remove watched directory"
            style={{
              padding: '0 4px',
              fontSize: '16px',
              lineHeight: 1,
              color: theme.textSecondary,
              backgroundColor: 'transparent',
              border: 'none',
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
        {fieldTheorySyncEnabled && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              padding: '0 0 10px 19px',
              marginTop: '-3px',
            }}
          >
            <span style={{ fontSize: '11px', color: theme.textSecondary }}>
              Available on mobile
            </span>
            <SettingsToggle
              theme={theme}
              checked={dir.mobileSyncEnabled}
              onClick={() => handleToggleMobileSync(dir.path, !dir.mobileSyncEnabled)}
              disabled={isSyncing}
              activeColor={theme.success}
              title={isSyncing ? 'Syncing...' : undefined}
            />
          </div>
        )}
        {index < watchedDirs.length - 1 && <SettingsDivider theme={theme} margin="0" />}
      </div>
    );
  };

  return (
    <div style={{ padding: '0', display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <p style={{
        fontSize: '12px',
        color: theme.textSecondary,
        margin: '4px 0 0',
        lineHeight: '1.5',
      }}>
        Point to folders containing your command markdown files.
        Use <strong>⌘⇧K</strong> to invoke a command in any application, or say "use the [name] command" during transcription.
      </p>

      <SettingsCard theme={theme}>
        <SettingsSectionHeading
          theme={theme}
          title="Watched directories"
          description="Field Theory watches these folders and exposes the markdown commands they contain."
        />

        {watchedDirs.length > 0 ? (
          <div style={{ marginTop: '-4px', marginBottom: '14px' }}>
            {watchedDirs.map(renderPathRow)}
          </div>
        ) : (
          <div style={{ fontSize: '12px', color: theme.textSecondary, lineHeight: 1.5, marginBottom: '14px' }}>
            No watched directories yet.
          </div>
        )}

        {/* Add directory input */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddDirectory()}
            placeholder="Enter path (e.g., ~/.fieldtheory/library/Commands)"
            style={{
              flex: 1,
              minWidth: 0,
              padding: '8px 12px',
              fontSize: '12px',
              fontFamily: "'SF Mono', Monaco, monospace",
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
              minWidth: '76px',
            }}
          >
            Add path
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
            • <code style={{ fontSize: '10px', backgroundColor: theme.isDark ? '#2d2d2d' : '#f3f4f6', padding: '1px 4px', borderRadius: '3px' }}>~/.fieldtheory/library/Commands</code> — Field Theory commands
          </p>
        )}
      </SettingsCard>

      {/* Error display */}
      {error && (
        <SettingsNotice theme={theme} tone="warning">
          {error}
        </SettingsNotice>
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
