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

  // Auto-run frequency
  const [autoRunFrequency, setAutoRunFrequency] = useState<string>('off');

  // Auto-show on new reading
  const [autoShowEnabled, setAutoShowEnabled] = useState(true);

  // Cursor instructions modal
  const [showCursorModal, setShowCursorModal] = useState(false);
  const [cursorInstructions, setCursorInstructions] = useState('');
  const [copied, setCopied] = useState(false);

  // Claude Code status
  const [claudeConfigError, setClaudeConfigError] = useState(false);

  // Load initial state
  useEffect(() => {
    if (!window.librarianAPI) {
      setLoading(false);
      return;
    }

    Promise.all([
      window.librarianAPI.getWatchedDirs(),
      window.librarianAPI.getAutoRunFrequency(),
      window.librarianAPI.getAutoShowEnabled(),
    ])
      .then(([dirs, frequency, autoShow]) => {
        setWatchedDirs(dirs);
        setAutoRunFrequency(frequency);
        setAutoShowEnabled(autoShow);
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

  // Handle frequency change
  const handleFrequencyChange = useCallback(async (frequency: string) => {
    if (!window.librarianAPI) return;
    setAutoRunFrequency(frequency);
    setClaudeConfigError(false);
    const success = await window.librarianAPI.setAutoRunFrequency(frequency);
    if (!success && frequency !== 'off') {
      setClaudeConfigError(true);
    }
  }, []);

  // Handle auto-show toggle
  const handleAutoShowToggle = useCallback(async () => {
    if (!window.librarianAPI) return;
    const newValue = !autoShowEnabled;
    setAutoShowEnabled(newValue);
    await window.librarianAPI.setAutoShowEnabled(newValue);
  }, [autoShowEnabled]);

  // Handle showing Cursor instructions
  const handleShowCursorInstructions = useCallback(async () => {
    if (!window.librarianAPI) return;
    const instructions = await window.librarianAPI.getCursorInstructions();
    setCursorInstructions(instructions);
    setShowCursorModal(true);
  }, []);

  // Copy to clipboard with feedback
  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

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
          backgroundColor: theme.isDark ? theme.bgSecondary : '#f9fafb',
          border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
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
                    backgroundColor: theme.isDark ? theme.surface2 : '#fff',
                    border: `1px solid ${theme.isDark ? theme.border : '#d1d5db'}`,
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
                    border: `1px solid ${theme.isDark ? theme.border : '#d1d5db'}`,
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
                fontSize: '12px',
                fontWeight: 500,
                color: manualPath.trim() ? '#fff' : theme.textSecondary,
                backgroundColor: manualPath.trim() ? theme.accent : 'transparent',
                border: manualPath.trim() ? 'none' : `1px solid ${theme.isDark ? theme.border : '#d1d5db'}`,
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

      {/* Auto-show on new reading */}
      <div
        style={{
          marginTop: '24px',
          padding: '16px',
          borderRadius: '8px',
          backgroundColor: theme.isDark ? theme.bgSecondary : '#f9fafb',
          border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
        }}
      >
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            cursor: 'pointer',
          }}
        >
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600, color: theme.text }}>
              Auto-open on new reading
            </div>
            <div style={{ fontSize: '12px', color: theme.textSecondary, marginTop: '2px' }}>
              Bring Field Theory to foreground when a new reading appears
            </div>
          </div>
          <input
            type="checkbox"
            checked={autoShowEnabled}
            onChange={handleAutoShowToggle}
            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
          />
        </label>
      </div>

      {/* Auto-generate readings */}
      <div
        style={{
          marginTop: '24px',
          padding: '16px',
          borderRadius: '8px',
          backgroundColor: theme.isDark ? theme.bgSecondary : '#f9fafb',
          border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
        }}
      >
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '13px', fontWeight: 600, color: theme.text }}>
            Auto-generate readings
          </div>
          <div style={{ fontSize: '12px', color: theme.textSecondary, marginTop: '2px' }}>
            Configure how often AI assistants should create readings
          </div>
        </div>

        {/* Frequency options */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px' }}>
          {[
            { value: 'off', label: 'Off' },
            { value: 'occasionally', label: 'Occasionally' },
            { value: 'regularly', label: 'Regularly' },
            { value: 'frequently', label: 'Frequently' },
          ].map((option) => (
            <button
              key={option.value}
              onClick={() => handleFrequencyChange(option.value)}
              style={{
                padding: '8px 16px',
                fontSize: '12px',
                fontWeight: autoRunFrequency === option.value ? 600 : 400,
                color: autoRunFrequency === option.value ? '#fff' : theme.text,
                backgroundColor: autoRunFrequency === option.value ? theme.accent : 'transparent',
                border: `1px solid ${autoRunFrequency === option.value ? theme.accent : (theme.isDark ? theme.border : '#d1d5db')}`,
                borderRadius: '6px',
                cursor: 'pointer',
              }}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Platform buttons */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              fontSize: '12px',
              color: claudeConfigError
                ? theme.error
                : autoRunFrequency !== 'off'
                  ? theme.success
                  : theme.textSecondary,
              backgroundColor: theme.isDark ? theme.surface2 : '#fff',
              border: `1px solid ${claudeConfigError ? theme.error : (theme.isDark ? theme.border : '#d1d5db')}`,
              borderRadius: '6px',
            }}
          >
            Claude Code {claudeConfigError ? '✗' : autoRunFrequency !== 'off' ? '✓' : ''}
          </div>
          <button
            onClick={handleShowCursorInstructions}
            disabled={autoRunFrequency === 'off'}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              color: autoRunFrequency !== 'off' ? theme.text : theme.textSecondary,
              backgroundColor: theme.isDark ? theme.surface2 : '#fff',
              border: `1px solid ${theme.isDark ? theme.border : '#d1d5db'}`,
              borderRadius: '6px',
              cursor: autoRunFrequency !== 'off' ? 'pointer' : 'default',
              opacity: autoRunFrequency === 'off' ? 0.5 : 1,
            }}
          >
            Cursor Instructions
          </button>
        </div>

        {autoRunFrequency !== 'off' && !claudeConfigError && (
          <p style={{ fontSize: '11px', color: theme.textSecondary, marginTop: '12px' }}>
            Claude Code instructions are automatically updated in ~/.claude/CLAUDE.md
          </p>
        )}
        {claudeConfigError && (
          <p style={{ fontSize: '11px', color: theme.error, marginTop: '12px' }}>
            Failed to update ~/.claude/CLAUDE.md. Check file permissions.
          </p>
        )}
      </div>

      {/* Cursor Instructions Modal */}
      {showCursorModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => setShowCursorModal(false)}
        >
          <div
            style={{
              backgroundColor: theme.bg,
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '500px',
              width: '90%',
              maxHeight: '80vh',
              overflow: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: '16px', color: theme.text }}>
              Cursor Instructions
            </h3>
            <p style={{ fontSize: '13px', color: theme.textSecondary, marginBottom: '16px' }}>
              Copy this text and paste it into Cursor Settings → General → Rules for AI
            </p>
            <pre
              style={{
                padding: '12px',
                backgroundColor: theme.isDark ? theme.bgSecondary : '#f3f4f6',
                borderRadius: '8px',
                fontSize: '12px',
                color: theme.text,
                whiteSpace: 'pre-wrap',
                overflowX: 'auto',
              }}
            >
              {cursorInstructions}
            </pre>
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  copyToClipboard(cursorInstructions);
                }}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  fontWeight: 500,
                  color: '#fff',
                  backgroundColor: copied ? theme.success : theme.accent,
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  minWidth: '140px',
                }}
              >
                {copied ? 'Copied!' : 'Copy to Clipboard'}
              </button>
              <button
                onClick={() => setShowCursorModal(false)}
                style={{
                  padding: '8px 16px',
                  fontSize: '13px',
                  color: theme.text,
                  backgroundColor: 'transparent',
                  border: `1px solid ${theme.isDark ? theme.border : '#d1d5db'}`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
