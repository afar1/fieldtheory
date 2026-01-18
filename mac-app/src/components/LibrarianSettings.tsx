/**
 * LibrarianSettings - Configure watched directories for reading collection.
 *
 * Allows users to add/remove directories that Field Theory watches for
 * markdown readings from AI coding assistants.
 */

import { useEffect, useState, useCallback } from 'react';
import { useTheme } from '../contexts/ThemeContext';

interface LibrarianSettingsProps {
  librarianEnabled?: boolean;
  onLibrarianEnabledChange?: (enabled: boolean) => void;
}

export default function LibrarianSettings({ librarianEnabled = true, onLibrarianEnabledChange }: LibrarianSettingsProps) {
  const { theme } = useTheme();

  // Watched directories
  const [watchedDirs, setWatchedDirs] = useState<WatchedDir[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Path input
  const [manualPath, setManualPath] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanningDots, setScanningDots] = useState('.');

  // Auto-run frequency
  const [autoRunFrequency, setAutoRunFrequency] = useState<string>('off');

  // Auto-show on new reading
  const [autoShowEnabled, setAutoShowEnabled] = useState(true);

  // Cursor instructions modal
  const [showCursorModal, setShowCursorModal] = useState(false);
  const [cursorInstructions, setCursorInstructions] = useState('');
  const [copied, setCopied] = useState(false);

  // Claude Code status
  const [claudeCodeStatus, setClaudeCodeStatus] = useState<'installed' | 'directory-only' | 'not-installed'>('installed');
  const [claudeConfigError, setClaudeConfigError] = useState(false);
  const [resynced, setResynced] = useState(false);
  const [saved, setSaved] = useState(false);

  // Animate scanning dots
  useEffect(() => {
    if (!isScanning) return;
    const interval = setInterval(() => {
      setScanningDots((prev) => (prev.length >= 3 ? '.' : prev + '.'));
    }, 400);
    return () => clearInterval(interval);
  }, [isScanning]);

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
      window.librarianAPI.getClaudeCodeStatus(),
    ])
      .then(([dirs, frequency, autoShow, ccStatus]) => {
        setWatchedDirs(dirs);
        setAutoRunFrequency(frequency);
        setAutoShowEnabled(autoShow);
        setClaudeCodeStatus(ccStatus as 'installed' | 'directory-only' | 'not-installed');
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load librarian settings:', err);
        setLoading(false);
      });
  }, []);

  // Handle remove directory
  const handleRemove = useCallback(async (dirPath: string) => {
    if (!window.librarianAPI) return;

    setError(null);
    try {
      const success = await window.librarianAPI.removeWatchedDir(dirPath);
      if (success) {
        setWatchedDirs((prev) => prev.filter((d) => d.path !== dirPath));
      } else {
        setError('Failed to remove directory');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, []);

  // Handle path submission
  const handleManualPathSubmit = useCallback(async () => {
    if (!window.librarianAPI || !manualPath.trim() || isScanning) return;

    setError(null);
    setIsScanning(true);
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
    } finally {
      setIsScanning(false);
    }
  }, [manualPath, isScanning]);

  // Handle frequency change
  const handleFrequencyChange = useCallback(async (frequency: string) => {
    if (!window.librarianAPI) return;
    setAutoRunFrequency(frequency);
    setClaudeConfigError(false);
    setSaved(false);
    const success = await window.librarianAPI.setAutoRunFrequency(frequency);
    if (!success && frequency !== 'off') {
      setClaudeConfigError(true);
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
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
      {/* Enable/Disable Librarian toggle */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 0',
          marginBottom: '12px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ fontSize: '13px', fontWeight: 500, color: theme.text }}>
            Show Librarian Tab
          </span>
          <span style={{ fontSize: '11px', color: theme.textSecondary }}>
            Display the Librarian tab in the header
          </span>
        </div>
        <button
          onClick={() => onLibrarianEnabledChange?.(!librarianEnabled)}
          style={{
            position: 'relative',
            width: '44px',
            minWidth: '44px',
            height: '24px',
            minHeight: '24px',
            borderRadius: '12px',
            cursor: 'pointer',
            border: 'none',
            padding: 0,
            flexShrink: 0,
            transition: 'background-color 0.2s',
            backgroundColor: librarianEnabled ? theme.accent : '#d1d5db',
          }}
        >
          <span
            style={{
              position: 'absolute',
              top: '2px',
              left: 0,
              width: '20px',
              height: '20px',
              borderRadius: '10px',
              backgroundColor: '#fff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
              transition: 'transform 0.2s',
              transform: librarianEnabled ? 'translateX(22px)' : 'translateX(2px)',
            }}
          />
        </button>
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
            { value: 'always', label: 'All the time', tooltip: 'Create a reading on every implementation task (not during planning or Q&A)' },
            { value: 'frequently', label: 'Frequently', tooltip: 'Create a reading after most non-trivial tasks' },
            { value: 'regularly', label: 'Regularly', tooltip: 'Create a reading every ~3 significant implementations' },
            { value: 'occasionally', label: 'Occasionally', tooltip: 'Create a reading every ~5 significant implementations' },
            { value: 'off', label: 'Off', tooltip: 'Disable automatic reading creation' },
          ].map((option) => (
            <button
              key={option.value}
              onClick={() => handleFrequencyChange(option.value)}
              title={option.tooltip}
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

        {/* Platform setup */}
        {autoRunFrequency !== 'off' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Claude Code section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 600, fontSize: '12px', color: theme.text }}>Claude Code</span>
                {claudeCodeStatus === 'not-installed' ? (
                  <span style={{ fontSize: '11px', color: theme.textSecondary }}>not detected</span>
                ) : saved ? (
                  <span style={{ fontSize: '11px', color: theme.success, display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
                    </svg>
                    Claude is now aware
                  </span>
                ) : claudeConfigError ? (
                  <span style={{ fontSize: '11px', color: theme.error }}>✗ Error updating</span>
                ) : (
                  <span style={{ fontSize: '11px', color: theme.success }}>✓</span>
                )}
              </div>
              {claudeCodeStatus === 'not-installed' ? (
                <div style={{ fontSize: '11px', color: theme.textSecondary }}>
                  Instructions saved to ~/.claude/CLAUDE.md — will be ready when you install Claude Code
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: theme.textSecondary }}>
                  <span>Auto-synced to ~/.claude/CLAUDE.md</span>
                  <button
                    onClick={async () => {
                      const claudePath = await window.librarianAPI?.getClaudeConfigPath();
                      if (claudePath) {
                        window.shellAPI?.showItemInFolder(claudePath);
                      }
                    }}
                    style={{
                      padding: '2px 4px',
                      backgroundColor: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: theme.textSecondary,
                      display: 'flex',
                      alignItems: 'center',
                      borderRadius: '3px',
                      opacity: 0.7,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7'; }}
                    title="Show in Finder"
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M1 3.5A1.5 1.5 0 0 1 2.5 2h2.764c.958 0 1.76.56 2.311 1.184C7.985 3.648 8.48 4 9 4h4.5A1.5 1.5 0 0 1 15 5.5v7a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 1 12.5v-9zM2.5 3a.5.5 0 0 0-.5.5V6h12v-.5a.5.5 0 0 0-.5-.5H9c-.964 0-1.71-.629-2.174-1.154C6.374 3.334 5.82 3 5.264 3H2.5zM14 7H2v5.5a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V7z" />
                    </svg>
                  </button>
                  <button
                    onClick={async () => {
                      const success = await window.librarianAPI?.resyncClaudeMd();
                      if (success) {
                        setResynced(true);
                        setTimeout(() => setResynced(false), 2000);
                      }
                    }}
                    style={{
                      padding: '2px 4px',
                      backgroundColor: 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: resynced ? theme.success : theme.textSecondary,
                      display: 'flex',
                      alignItems: 'center',
                      borderRadius: '3px',
                      opacity: resynced ? 1 : 0.7,
                    }}
                    onMouseEnter={(e) => { if (!resynced) e.currentTarget.style.opacity = '1'; }}
                    onMouseLeave={(e) => { if (!resynced) e.currentTarget.style.opacity = '0.7'; }}
                    title="Re-sync instructions"
                  >
                    {resynced ? (
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
                      </svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z"/>
                        <path fillRule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"/>
                      </svg>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Cursor section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 600, fontSize: '12px', color: theme.text }}>Cursor</span>
                <span style={{ fontSize: '11px', color: theme.textSecondary }}>manual setup required</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: theme.textSecondary }}>
                <span>Copy to Settings → Rules for AI</span>
                <button
                  onClick={handleShowCursorInstructions}
                  style={{
                    padding: '2px 8px',
                    backgroundColor: 'transparent',
                    border: `1px solid ${theme.border}`,
                    borderRadius: '4px',
                    cursor: 'pointer',
                    color: theme.textSecondary,
                    fontSize: '10px',
                    opacity: 0.8,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.8'; }}
                >
                  Copy
                </button>
              </div>
            </div>
          </div>
        )}
        {claudeConfigError && (
          <p style={{ fontSize: '11px', color: theme.error, marginTop: '12px' }}>
            Failed to update ~/.claude/CLAUDE.md. Check file permissions.
          </p>
        )}
        {autoRunFrequency !== 'off' && (
          <p style={{ fontSize: '10px', color: theme.textSecondary, marginTop: '12px', opacity: 0.6, textAlign: 'right' }}>
            * Librarian will not affect your other CLAUDE.md settings
          </p>
        )}
      </div>

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

      {/* Watched Directories */}
      <p
        style={{
          fontSize: '13px',
          color: theme.textSecondary,
          marginBottom: '16px',
          marginTop: '24px',
          lineHeight: '1.5',
          opacity: librarianEnabled ? 1 : 0.5,
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
                key={dir.path}
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
                  onClick={() => handleRemove(dir.path)}
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
              disabled={isScanning}
              style={{
                flex: 1,
                padding: '8px 12px',
                fontSize: '13px',
                backgroundColor: theme.isDark ? theme.surface2 : '#fff',
                border: `1px solid ${theme.isDark ? theme.border : '#d1d5db'}`,
                borderRadius: '6px',
                color: theme.text,
                outline: 'none',
                opacity: isScanning ? 0.5 : 1,
              }}
            />
            {isScanning ? (
              <span
                style={{
                  padding: '8px 16px',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: theme.textSecondary,
                  fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
                  display: 'flex',
                  alignItems: 'center',
                  minWidth: '90px',
                }}
              >
                Scanning{scanningDots}
              </span>
            ) : (
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
            )}
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
