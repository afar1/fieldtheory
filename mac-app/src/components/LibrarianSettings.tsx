/**
 * LibrarianSettings - Configure watched directories for reading collection.
 *
 * Allows users to add/remove directories that Field Theory watches for
 * markdown readings from AI coding assistants.
 */

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useTheme } from '../contexts/ThemeContext';

interface LibrarianSettingsProps {
  librarianEnabled?: boolean;
  onLibrarianEnabledChange?: (enabled: boolean) => void;
}

export default function LibrarianSettings({ librarianEnabled = true, onLibrarianEnabledChange }: LibrarianSettingsProps) {
  const { theme } = useTheme();

  // Watched directories
  const [watchedDirs, setWatchedDirs] = useState<WatchedDir[]>([]);
  const [readings, setReadings] = useState<ReadingMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Count readings per directory
  const readingCountsByDir = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const dir of watchedDirs) {
      counts[dir.path] = readings.filter(r => r.path.startsWith(dir.path)).length;
    }
    return counts;
  }, [watchedDirs, readings]);

  // Path input
  const [manualPath, setManualPath] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [scanningDots, setScanningDots] = useState('.');

  // Auto-run frequency
  const [autoRunFrequency, setAutoRunFrequency] = useState<string>('off');

  // Custom threshold (direct control via slider)
  const [customThreshold, setCustomThreshold] = useState<number>(5);

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
  const [hookInstalled, setHookInstalled] = useState(false);
  const [hookInstalling, setHookInstalling] = useState(false);

  // Content guidance customization
  const [defaultContentGuidance, setDefaultContentGuidance] = useState('');
  const [customContentGuidance, setCustomContentGuidance] = useState<string | undefined>(undefined);
  const [contentGuidanceText, setContentGuidanceText] = useState('');
  const [contentGuidanceSaved, setContentGuidanceSaved] = useState(false);
  const [contentGuidanceSaving, setContentGuidanceSaving] = useState(false);
  const [isUsingCustomGuidance, setIsUsingCustomGuidance] = useState(false);

  // Debug logs state
  const [logsExpanded, setLogsExpanded] = useState(true); // Default open while debugging
  const [editStatus, setEditStatus] = useState<{ edits: number; threshold: number } | null>(null);

  // Debounce ref for threshold slider
  const thresholdDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Animate scanning dots
  useEffect(() => {
    if (!isScanning) return;
    const interval = setInterval(() => {
      setScanningDots((prev) => (prev.length >= 3 ? '.' : prev + '.'));
    }, 400);
    return () => clearInterval(interval);
  }, [isScanning]);

  // Fetch edit status when logs expanded or periodically
  useEffect(() => {
    if (!logsExpanded || !window.librarianAPI?.getEditStatus) return;

    const fetchStatus = async () => {
      const status = await window.librarianAPI!.getEditStatus();
      setEditStatus(status);
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 2000); // Refresh every 2s
    return () => clearInterval(interval);
  }, [logsExpanded]);

  // Load initial state
  useEffect(() => {
    if (!window.librarianAPI) {
      setLoading(false);
      return;
    }

    Promise.all([
      window.librarianAPI.getWatchedDirs(),
      window.librarianAPI.getReadings(),
      window.librarianAPI.getAutoRunFrequency(),
      window.librarianAPI.getAutoShowEnabled(),
      window.librarianAPI.getClaudeCodeStatus(),
      window.librarianAPI.isClaudeCodeHookInstalled(),
      window.librarianAPI.getDefaultContentGuidance(),
      window.librarianAPI.getCustomContentGuidance(),
      window.librarianAPI.getCustomThreshold(),
    ])
      .then(([dirs, readingsList, frequency, autoShow, ccStatus, hookStatus, defaultGuidance, customGuidance, threshold]) => {
        setWatchedDirs(dirs);
        setReadings(readingsList);
        setAutoRunFrequency(frequency);
        setAutoShowEnabled(autoShow);
        setClaudeCodeStatus(ccStatus as 'installed' | 'directory-only' | 'not-installed');
        setHookInstalled(hookStatus);
        setDefaultContentGuidance(defaultGuidance);
        setCustomContentGuidance(customGuidance);
        setContentGuidanceText(customGuidance || defaultGuidance);
        setIsUsingCustomGuidance(!!customGuidance);
        // Default to 5 if no custom threshold is set
        setCustomThreshold(threshold ?? 5);
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
        // Refresh readings to update counts
        const readingsList = await window.librarianAPI.getReadings();
        setReadings(readingsList);
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
        // Refresh readings to get updated counts
        const readingsList = await window.librarianAPI.getReadings();
        setReadings(readingsList);
      } else {
        setError('Directory already added or not found');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsScanning(false);
    }
  }, [manualPath, isScanning]);

  // Handle frequency change (kept for backwards compatibility, but buttons are disabled)
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

  // Handle threshold change via slider (debounced)
  const handleThresholdChange = useCallback((threshold: number) => {
    // Update local state immediately for responsive UI
    setCustomThreshold(threshold);
    setSaved(false);

    // Clear any existing debounce timeout
    if (thresholdDebounceRef.current) {
      clearTimeout(thresholdDebounceRef.current);
    }

    // Debounce the API call
    thresholdDebounceRef.current = setTimeout(async () => {
      if (!window.librarianAPI) return;
      setClaudeConfigError(false);

      // If threshold is being set (not off), also ensure frequency is set to 'always' for CLAUDE.md instructions
      if (autoRunFrequency === 'off') {
        await window.librarianAPI.setAutoRunFrequency('always');
        setAutoRunFrequency('always');
      }

      const success = await window.librarianAPI.setCustomThreshold(threshold);
      if (success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setClaudeConfigError(true);
      }
    }, 300);
  }, [autoRunFrequency]);

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

  // Handle saving custom content guidance
  const handleSaveContentGuidance = useCallback(async () => {
    if (!window.librarianAPI) return;

    setContentGuidanceSaving(true);
    setContentGuidanceSaved(false);

    try {
      // If text matches default, clear custom guidance
      const trimmedText = contentGuidanceText.trim();
      const guidanceToSave = trimmedText === defaultContentGuidance.trim() ? undefined : trimmedText;

      const success = await window.librarianAPI.setCustomContentGuidance(guidanceToSave);
      if (success) {
        setCustomContentGuidance(guidanceToSave);
        setIsUsingCustomGuidance(!!guidanceToSave);
        setContentGuidanceSaved(true);
        setTimeout(() => setContentGuidanceSaved(false), 3000);
      }
    } finally {
      setContentGuidanceSaving(false);
    }
  }, [contentGuidanceText, defaultContentGuidance]);

  // Handle resetting content guidance to default
  const handleResetContentGuidance = useCallback(async () => {
    if (!window.librarianAPI) return;

    setContentGuidanceSaving(true);
    setContentGuidanceSaved(false);

    try {
      const success = await window.librarianAPI.resetContentGuidance();
      if (success) {
        setContentGuidanceText(defaultContentGuidance);
        setCustomContentGuidance(undefined);
        setIsUsingCustomGuidance(false);
        setContentGuidanceSaved(true);
        setTimeout(() => setContentGuidanceSaved(false), 3000);
      }
    } finally {
      setContentGuidanceSaving(false);
    }
  }, [defaultContentGuidance]);

  // Check if content guidance has unsaved changes
  const hasUnsavedGuidanceChanges = customContentGuidance
    ? contentGuidanceText.trim() !== customContentGuidance.trim()
    : contentGuidanceText.trim() !== defaultContentGuidance.trim();

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
        <span style={{ color: theme.textSecondary, fontSize: '12px' }}>Loading...</span>
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
          <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>
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
          <div style={{ fontSize: '12px', fontWeight: 600, color: theme.text }}>
            Auto-generate readings
          </div>
          <div style={{ fontSize: '12px', color: theme.textSecondary, marginTop: '2px' }}>
            Configure how often AI assistants should create readings
          </div>
        </div>

        {/* Threshold slider */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button
                onClick={() => handleFrequencyChange(autoRunFrequency === 'off' ? 'always' : 'off')}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: autoRunFrequency !== 'off' ? '#fff' : theme.text,
                  backgroundColor: autoRunFrequency !== 'off' ? theme.accent : 'transparent',
                  border: `1px solid ${autoRunFrequency !== 'off' ? theme.accent : (theme.isDark ? theme.border : '#d1d5db')}`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                {autoRunFrequency !== 'off' ? 'Enabled' : 'Disabled'}
              </button>
            </div>
            {autoRunFrequency !== 'off' && (
              <span style={{ fontSize: '12px', color: theme.text, fontWeight: 500 }}>
                Every <span style={{ color: theme.accent }}>{customThreshold}</span> {customThreshold === 1 ? 'prompt' : 'prompts'}
              </span>
            )}
          </div>

          {autoRunFrequency !== 'off' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '11px', color: theme.textSecondary, minWidth: '20px' }}>1</span>
              <input
                type="range"
                min="1"
                max="15"
                value={customThreshold}
                onChange={(e) => handleThresholdChange(parseInt(e.target.value, 10))}
                style={{
                  flex: 1,
                  height: '4px',
                  cursor: 'pointer',
                  accentColor: theme.accent,
                }}
              />
              <span style={{ fontSize: '11px', color: theme.textSecondary, minWidth: '20px' }}>15</span>
            </div>
          )}

          {autoRunFrequency !== 'off' && (
            <p style={{ fontSize: '11px', color: theme.textSecondary, marginTop: '8px' }}>
              Claude will be reminded to create a reading after {customThreshold} {customThreshold === 1 ? 'prompt' : 'prompts'} in a session.
            </p>
          )}
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
              {/* Hook installation */}
              {claudeCodeStatus === 'installed' && (
                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      onClick={async () => {
                        setHookInstalling(true);
                        try {
                          if (hookInstalled) {
                            const success = await window.librarianAPI?.uninstallClaudeCodeHook();
                            if (success) setHookInstalled(false);
                          } else {
                            const success = await window.librarianAPI?.installClaudeCodeHook();
                            if (success) setHookInstalled(true);
                          }
                        } finally {
                          setHookInstalling(false);
                        }
                      }}
                      disabled={hookInstalling}
                      style={{
                        padding: '4px 8px',
                        fontSize: '11px',
                        fontWeight: 500,
                        color: hookInstalled ? theme.error : theme.accent,
                        backgroundColor: 'transparent',
                        border: `1px solid ${hookInstalled ? theme.error : theme.accent}`,
                        borderRadius: '4px',
                        cursor: hookInstalling ? 'wait' : 'pointer',
                        opacity: hookInstalling ? 0.5 : 1,
                      }}
                    >
                      {hookInstalling ? '...' : hookInstalled ? 'Disable Auto-Remind' : 'Enable Auto-Remind'}
                    </button>
                    <span style={{ fontSize: '10px', color: theme.textSecondary }}>
                      {hookInstalled
                        ? '✓ Claude will be reminded to create readings'
                        : 'Automatically remind Claude to create readings'}
                    </span>
                  </div>

                  {/* Debug logs toggle */}
                  {hookInstalled && (
                    <div style={{ marginTop: '8px' }}>
                      <button
                        onClick={() => setLogsExpanded(!logsExpanded)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '4px 0',
                          fontSize: '10px',
                          color: theme.textSecondary,
                          backgroundColor: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          opacity: 0.7,
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.7'; }}
                      >
                        <span style={{ fontFamily: 'monospace', fontSize: '8px' }}>
                          {logsExpanded ? '▼' : '▶'}
                        </span>
                        <span>Debug logs</span>
                      </button>

                      {logsExpanded && (
                        <div
                          style={{
                            marginTop: '8px',
                            padding: '12px',
                            backgroundColor: theme.isDark ? theme.surface2 : '#fff',
                            border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
                            borderRadius: '6px',
                            fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
                            fontSize: '11px',
                          }}
                        >
                          {editStatus ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: theme.textSecondary }}>Prompts since reading:</span>
                                <span style={{
                                  color: editStatus.edits >= editStatus.threshold ? theme.success : theme.text,
                                  fontWeight: editStatus.edits >= editStatus.threshold ? 600 : 400,
                                }}>
                                  {editStatus.edits}
                                </span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: theme.textSecondary }}>Threshold:</span>
                                <span style={{ color: theme.text }}>{editStatus.threshold}</span>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: theme.textSecondary }}>Status:</span>
                                <span style={{
                                  color: editStatus.edits >= editStatus.threshold ? theme.success : theme.warning,
                                }}>
                                  {editStatus.edits >= editStatus.threshold ? '● Triggering' : '○ Waiting'}
                                </span>
                              </div>
                              <div style={{
                                marginTop: '8px',
                                paddingTop: '8px',
                                borderTop: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
                                fontSize: '10px',
                                color: theme.textSecondary,
                              }}>
                                Hook will remind Claude when prompts ≥ threshold
                              </div>
                              <button
                                onClick={async () => {
                                  await window.librarianAPI?.resetAllCounters();
                                  const status = await window.librarianAPI?.getEditStatus();
                                  if (status) setEditStatus(status);
                                }}
                                style={{
                                  marginTop: '4px',
                                  padding: '4px 8px',
                                  fontSize: '10px',
                                  color: theme.textSecondary,
                                  backgroundColor: 'transparent',
                                  border: `1px solid ${theme.isDark ? theme.border : '#d1d5db'}`,
                                  borderRadius: '4px',
                                  cursor: 'pointer',
                                  alignSelf: 'flex-start',
                                }}
                              >
                                Reset counter
                              </button>
                            </div>
                          ) : (
                            <span style={{ color: theme.textSecondary }}>
                              No status file found. Add a watched directory first.
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
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

      {/* Content guidance customization */}
      {autoRunFrequency !== 'off' && (
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 600, color: theme.text }}>
                  Content guidance
                </div>
                <div style={{ fontSize: '12px', color: theme.textSecondary, marginTop: '2px' }}>
                  Customize what type of content is produced in readings
                </div>
              </div>
              {isUsingCustomGuidance && (
                <span
                  style={{
                    fontSize: '10px',
                    color: theme.accent,
                    backgroundColor: theme.isDark ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.1)',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontWeight: 500,
                  }}
                >
                  Customized
                </span>
              )}
            </div>
          </div>

          <textarea
            value={contentGuidanceText}
            onChange={(e) => setContentGuidanceText(e.target.value)}
            placeholder={defaultContentGuidance}
            style={{
              width: '100%',
              minHeight: '120px',
              padding: '12px',
              fontSize: '12px',
              fontFamily: "'SF Mono', Monaco, 'Cascadia Code', monospace",
              lineHeight: '1.5',
              backgroundColor: theme.isDark ? theme.surface2 : '#fff',
              border: `1px solid ${theme.isDark ? theme.border : '#d1d5db'}`,
              borderRadius: '6px',
              color: theme.text,
              resize: 'vertical',
              outline: 'none',
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = theme.accent;
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = theme.isDark ? theme.border : '#d1d5db';
            }}
          />

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                onClick={handleSaveContentGuidance}
                disabled={contentGuidanceSaving || !hasUnsavedGuidanceChanges}
                style={{
                  padding: '6px 12px',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: hasUnsavedGuidanceChanges ? '#fff' : theme.textSecondary,
                  backgroundColor: hasUnsavedGuidanceChanges ? theme.accent : 'transparent',
                  border: hasUnsavedGuidanceChanges ? 'none' : `1px solid ${theme.isDark ? theme.border : '#d1d5db'}`,
                  borderRadius: '6px',
                  cursor: hasUnsavedGuidanceChanges && !contentGuidanceSaving ? 'pointer' : 'default',
                  opacity: contentGuidanceSaving ? 0.5 : 1,
                }}
              >
                {contentGuidanceSaving ? 'Saving...' : 'Save'}
              </button>
              {isUsingCustomGuidance && (
                <button
                  onClick={handleResetContentGuidance}
                  disabled={contentGuidanceSaving}
                  style={{
                    padding: '6px 12px',
                    fontSize: '12px',
                    fontWeight: 500,
                    color: theme.textSecondary,
                    backgroundColor: 'transparent',
                    border: `1px solid ${theme.isDark ? theme.border : '#d1d5db'}`,
                    borderRadius: '6px',
                    cursor: contentGuidanceSaving ? 'default' : 'pointer',
                    opacity: contentGuidanceSaving ? 0.5 : 1,
                  }}
                >
                  Reset to Default
                </button>
              )}
            </div>
            {contentGuidanceSaved && (
              <span style={{ fontSize: '11px', color: theme.success, display: 'flex', alignItems: 'center', gap: '4px' }}>
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
                </svg>
                Saved to CLAUDE.md — Claude is now aware
              </span>
            )}
          </div>

          <p style={{ fontSize: '11px', color: theme.textSecondary, marginTop: '12px', lineHeight: '1.5' }}>
            This shapes the intellectual content produced in each reading. Technical users might prefer
            deeper technical content, while others might enjoy broader cultural connections.
          </p>
        </div>
      )}

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
            <div style={{ fontSize: '12px', fontWeight: 600, color: theme.text }}>
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
          fontSize: '12px',
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
        {/* Watched Directories */}
        <div>
          <label style={{
            display: 'block',
            marginBottom: '8px',
            fontSize: '12px',
            fontWeight: 600,
            color: theme.text,
          }}>
            Watched Directories
          </label>

          {/* List of watched directories with reading counts */}
          {watchedDirs.length > 0 && (
            <div style={{
              marginBottom: '12px',
              border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
              borderRadius: '6px',
              backgroundColor: theme.isDark ? theme.surface2 : '#fff',
              overflow: 'hidden',
            }}>
              {watchedDirs.map((dir, index) => {
                const count = readingCountsByDir[dir.path] || 0;
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
                        {count} reading{count !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemove(dir.path)}
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
              value={manualPath}
              onChange={(e) => setManualPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleManualPathSubmit()}
              placeholder="Enter path (e.g., ~/.librarian)"
              disabled={isScanning}
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
                  backgroundColor: manualPath.trim() ? theme.info : 'transparent',
                  border: manualPath.trim() ? 'none' : `1px solid ${theme.border}`,
                  borderRadius: '6px',
                  cursor: manualPath.trim() ? 'pointer' : 'not-allowed',
                  opacity: manualPath.trim() ? 1 : 0.5,
                }}
              >
                Add
              </button>
            )}
          </div>

          {/* Common paths hint - only show when empty */}
          {watchedDirs.length === 0 && (
            <p style={{
              fontSize: '11px',
              color: theme.textSecondary,
              marginTop: '8px',
              marginBottom: '0',
              lineHeight: '1.5',
            }}>
              <strong>Common locations:</strong><br />
              • <code style={{ fontSize: '10px', backgroundColor: theme.isDark ? '#2d2d2d' : '#f3f4f6', padding: '1px 4px', borderRadius: '3px' }}>~/.librarian</code> — Global readings<br />
              • <code style={{ fontSize: '10px', backgroundColor: theme.isDark ? '#2d2d2d' : '#f3f4f6', padding: '1px 4px', borderRadius: '3px' }}>~/project/.librarian</code> — Project readings
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

        {/* View readings note */}
        {watchedDirs.length > 0 && (
          <p style={{
            marginTop: '12px',
            marginBottom: '0',
            fontSize: '12px',
            color: theme.textSecondary,
          }}>
            View readings in the <strong>Librarian</strong> tab.
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
            <p style={{ fontSize: '12px', color: theme.textSecondary, marginBottom: '16px' }}>
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
                  fontSize: '12px',
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
                  fontSize: '12px',
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
