/**
 * LibrarianSettings - Configure watched directories for reading collection.
 *
 * Allows users to add/remove directories that Field Theory watches for
 * markdown readings from AI coding assistants.
 */

import { useEffect, useState, useCallback } from 'react';
import { useTheme } from '../contexts/ThemeContext';

export default function LibrarianSettings() {
  const { theme } = useTheme();

  // Watched directories
  const [watchedDirs, setWatchedDirs] = useState<WatchedDir[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Path input
  const [manualPath, setManualPath] = useState('');

  // Load initial state
  useEffect(() => {
    if (!window.librarianAPI) {
      setLoading(false);
      return;
    }

    window.librarianAPI
      .getWatchedDirs()
      .then((dirs) => {
        setWatchedDirs(dirs);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load librarian settings:', err);
        setLoading(false);
      });
  }, []);

  // Handle remove directory
  const handleRemove = useCallback(async (id: number) => {
    if (!window.librarianAPI) return;

    setError(null);
    try {
      const success = await window.librarianAPI.removeWatchedDir(id);
      if (success) {
        setWatchedDirs((prev) => prev.filter((d) => d.id !== id));
      } else {
        setError('Failed to remove directory');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, []);

  // Handle path submission
  const handleManualPathSubmit = useCallback(async () => {
    if (!window.librarianAPI || !manualPath.trim()) return;

    setError(null);
    try {
      const result = await window.librarianAPI.addWatchedDir(manualPath.trim());
      if (result) {
        setWatchedDirs((prev) => [...prev, result]);
        setManualPath('');
      } else {
        setError('Directory already added or not found');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, [manualPath]);

  // Format path for display
  const formatPath = (path: string): string => {
    if (path.startsWith('/Users/')) {
      const parts = path.split('/');
      if (parts.length > 2) {
        return '~' + path.slice(('/Users/' + parts[2]).length);
      }
    }
    return path;
  };

  if (loading) {
    return (
      <div style={{ padding: '16px' }}>
        <span style={{ color: theme.textSecondary, fontSize: '13px' }}>Loading...</span>
      </div>
    );
  }

  return (
    <div style={{ padding: '0' }}>
      <p
        style={{
          fontSize: '13px',
          color: theme.textSecondary,
          marginBottom: '16px',
          marginTop: '4px',
          lineHeight: '1.5',
        }}
      >
        Add directories to watch for markdown readings. Field Theory will import new readings
        automatically and display them in the Librarian tab.
      </p>

      <div
        style={{
          padding: '16px',
          borderRadius: '8px',
          backgroundColor: theme.isDark ? '#1a1a1a' : '#f9fafb',
          border: `1px solid ${theme.isDark ? '#404040' : '#e5e7eb'}`,
        }}
      >
        {/* Watched directories list */}
        {watchedDirs.length > 0 && (
          <div style={{ marginBottom: '16px' }}>
            <label
              style={{
                display: 'block',
                marginBottom: '8px',
                fontSize: '13px',
                fontWeight: 600,
                color: theme.text,
              }}
            >
              Watched Directories
            </label>

            {watchedDirs.map((dir) => (
              <div
                key={dir.id}
                style={{
                  display: 'flex',
                  gap: '8px',
                  alignItems: 'center',
                  marginBottom: '8px',
                }}
              >
                <code
                  style={{
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
                  }}
                >
                  {formatPath(dir.path)}
                </code>
                <button
                  onClick={() => handleRemove(dir.id)}
                  style={{
                    padding: '8px 12px',
                    fontSize: '12px',
                    fontWeight: 500,
                    color: theme.error,
                    backgroundColor: 'transparent',
                    border: `1px solid ${theme.isDark ? '#404040' : '#d1d5db'}`,
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add directory section */}
        <div>
          <label
            style={{
              display: 'block',
              marginBottom: '8px',
              fontSize: '13px',
              fontWeight: 600,
              color: theme.text,
            }}
          >
            {watchedDirs.length > 0 ? 'Add Another Directory' : 'Add a Directory'}
          </label>

          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleManualPathSubmit()}
              placeholder="~/path/to/directory"
              style={{
                flex: 1,
                padding: '8px 12px',
                fontSize: '13px',
                backgroundColor: theme.isDark ? '#2d2d2d' : '#fff',
                border: `1px solid ${theme.isDark ? '#404040' : '#d1d5db'}`,
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
                fontSize: '12px',
                fontWeight: 500,
                color: manualPath.trim() ? '#fff' : theme.textSecondary,
                backgroundColor: manualPath.trim() ? theme.accent : 'transparent',
                border: manualPath.trim() ? 'none' : `1px solid ${theme.isDark ? '#404040' : '#d1d5db'}`,
                borderRadius: '6px',
                cursor: manualPath.trim() ? 'pointer' : 'default',
              }}
            >
              Add
            </button>
          </div>
        </div>

        {/* Error display */}
        {error && (
          <p
            style={{
              marginTop: '12px',
              fontSize: '12px',
              color: theme.error,
            }}
          >
            {error}
          </p>
        )}
      </div>

      {/* Hint about common directories */}
      <p
        style={{
          fontSize: '12px',
          color: theme.textSecondary,
          marginTop: '12px',
          lineHeight: '1.5',
        }}
      >
        Common directories: <code style={{ fontSize: '11px' }}>~/.librarian</code>,{' '}
        <code style={{ fontSize: '11px' }}>~/project/.librarian</code>
      </p>
    </div>
  );
}
