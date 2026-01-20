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

  // New v2 settings
  const [enabled, setEnabled] = useState(true);
  const [triggerMode, setTriggerMode] = useState<'prompt' | 'judgment'>('prompt');
  const [promptThreshold, setPromptThreshold] = useState<number>(5);


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

  // Edit status for prompt count mode
  const [editStatus, setEditStatus] = useState<{ edits: number; threshold: number } | null>(null);

  // Configuration file paths and preview/edit
  const [configPaths, setConfigPaths] = useState<{ claudeMd: string; librarianCommand: string } | null>(null);
  const [expandedConfigFile, setExpandedConfigFile] = useState<'claudeMd' | 'librarianCommand' | null>(null);
  const [configFileContent, setConfigFileContent] = useState<string | null>(null);
  const [configFileEditContent, setConfigFileEditContent] = useState<string>('');
  const [configFileLoading, setConfigFileLoading] = useState(false);
  const [configFileSaving, setConfigFileSaving] = useState(false);
  const [configFileSaved, setConfigFileSaved] = useState(false);
  const [configFileHasChanges, setConfigFileHasChanges] = useState(false);

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

  // Fetch edit status for status banner (prompt count mode)
  useEffect(() => {
    if (!enabled || triggerMode !== 'prompt' || !window.librarianAPI?.getEditStatus) return;

    const fetchStatus = async () => {
      const status = await window.librarianAPI!.getEditStatus();
      setEditStatus(status);
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 2000); // Refresh every 2s
    return () => clearInterval(interval);
  }, [enabled, triggerMode]);

  // Load initial state
  useEffect(() => {
    if (!window.librarianAPI) {
      setLoading(false);
      return;
    }

    Promise.all([
      window.librarianAPI.getWatchedDirs(),
      window.librarianAPI.getReadings(),
      // New v2 APIs
      window.librarianAPI.isEnabled(),
      window.librarianAPI.getTriggerMode(),
      window.librarianAPI.getPromptThreshold(),
      // Other settings
      window.librarianAPI.getAutoShowEnabled(),
      window.librarianAPI.getClaudeCodeStatus(),
      window.librarianAPI.isClaudeCodeHookInstalled(),
      window.librarianAPI.getDefaultContentGuidance(),
      window.librarianAPI.getCustomContentGuidance(),
      window.librarianAPI.getConfigPaths(),
    ])
      .then(([dirs, readingsList, isEnabled, mode, threshold, autoShow, ccStatus, hookStatus, defaultGuidance, customGuidance, paths]) => {
        setWatchedDirs(dirs);
        setReadings(readingsList);
        // New v2 settings
        setEnabled(isEnabled);
        setTriggerMode(mode as 'prompt' | 'judgment');
        setPromptThreshold(threshold);
        // Other settings
        setAutoShowEnabled(autoShow);
        setClaudeCodeStatus(ccStatus as 'installed' | 'directory-only' | 'not-installed');
        setHookInstalled(hookStatus);
        setDefaultContentGuidance(defaultGuidance);
        setCustomContentGuidance(customGuidance);
        setContentGuidanceText(customGuidance || defaultGuidance);
        setIsUsingCustomGuidance(!!customGuidance);
        setConfigPaths(paths);
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

  // Handle enable toggle
  const handleEnabledToggle = useCallback(async () => {
    if (!window.librarianAPI) return;
    const newValue = !enabled;
    setEnabled(newValue);
    setClaudeConfigError(false);
    setSaved(false);
    const success = await window.librarianAPI.setEnabled(newValue);
    if (!success) {
      setClaudeConfigError(true);
      setEnabled(!newValue); // Revert on failure
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }, [enabled]);

  // Handle trigger mode change
  const handleTriggerModeChange = useCallback(async (mode: 'prompt' | 'judgment') => {
    if (!window.librarianAPI) return;
    setTriggerMode(mode);
    setClaudeConfigError(false);
    setSaved(false);
    const success = await window.librarianAPI.setTriggerMode(mode);
    if (!success) {
      setClaudeConfigError(true);
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }, []);

  // Handle threshold change via slider (debounced)
  const handleThresholdChange = useCallback((threshold: number) => {
    // Update local state immediately for responsive UI
    setPromptThreshold(threshold);
    setSaved(false);

    // Clear any existing debounce timeout
    if (thresholdDebounceRef.current) {
      clearTimeout(thresholdDebounceRef.current);
    }

    // Debounce the API call
    thresholdDebounceRef.current = setTimeout(async () => {
      if (!window.librarianAPI) return;
      setClaudeConfigError(false);

      const success = await window.librarianAPI.setPromptThreshold(threshold);
      if (success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        setClaudeConfigError(true);
      }
    }, 300);
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

  // Handle toggling config file preview/edit
  const handleToggleConfigFile = useCallback(async (file: 'claudeMd' | 'librarianCommand') => {
    if (!window.librarianAPI || !configPaths) return;

    // If already expanded, collapse it
    if (expandedConfigFile === file) {
      setExpandedConfigFile(null);
      setConfigFileContent(null);
      setConfigFileEditContent('');
      setConfigFileHasChanges(false);
      setConfigFileSaved(false);
      return;
    }

    // Load and expand the file
    setConfigFileLoading(true);
    setExpandedConfigFile(file);
    setConfigFileSaved(false);
    try {
      const filePath = file === 'claudeMd' ? configPaths.claudeMd : configPaths.librarianCommand;
      const content = await window.librarianAPI.readConfigFile(filePath);
      setConfigFileContent(content);
      setConfigFileEditContent(content || '');
      setConfigFileHasChanges(false);
    } catch (error) {
      console.error('Failed to load config file:', error);
      setConfigFileContent(null);
      setConfigFileEditContent('');
    } finally {
      setConfigFileLoading(false);
    }
  }, [configPaths, expandedConfigFile]);

  // Handle config file content change
  const handleConfigFileChange = useCallback((newContent: string) => {
    setConfigFileEditContent(newContent);
    setConfigFileHasChanges(newContent !== configFileContent);
    setConfigFileSaved(false);
  }, [configFileContent]);

  // Handle saving config file
  const handleSaveConfigFile = useCallback(async () => {
    if (!window.librarianAPI || !configPaths || !expandedConfigFile) return;

    setConfigFileSaving(true);
    try {
      const filePath = expandedConfigFile === 'claudeMd' ? configPaths.claudeMd : configPaths.librarianCommand;
      const success = await window.librarianAPI.writeConfigFile(filePath, configFileEditContent);
      if (success) {
        setConfigFileContent(configFileEditContent);
        setConfigFileHasChanges(false);
        setConfigFileSaved(true);
        setTimeout(() => setConfigFileSaved(false), 2000);
      }
    } catch (error) {
      console.error('Failed to save config file:', error);
    } finally {
      setConfigFileSaving(false);
    }
  }, [configPaths, expandedConfigFile, configFileEditContent]);

  // Handle resetting config file changes
  const handleResetConfigFile = useCallback(() => {
    setConfigFileEditContent(configFileContent || '');
    setConfigFileHasChanges(false);
  }, [configFileContent]);

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

      {/* Status Banner */}
      <div
        style={{
          marginTop: '24px',
          padding: '12px 16px',
          borderRadius: '8px',
          backgroundColor: enabled
            ? (theme.isDark ? 'rgba(34, 197, 94, 0.1)' : 'rgba(34, 197, 94, 0.08)')
            : (theme.isDark ? theme.bgSecondary : '#f9fafb'),
          border: `1px solid ${enabled
            ? (theme.isDark ? 'rgba(34, 197, 94, 0.3)' : 'rgba(34, 197, 94, 0.2)')
            : (theme.isDark ? theme.border : '#e5e7eb')}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: enabled ? '#22c55e' : theme.textSecondary,
            }}
          />
          <span style={{ fontSize: '12px', fontWeight: 600, color: theme.text }}>
            {enabled ? 'ACTIVE' : 'OFF'}
          </span>
          {enabled && triggerMode === 'prompt' && editStatus && (
            <>
              <span style={{ fontSize: '12px', color: theme.textSecondary }}>
                {editStatus.edits}/{editStatus.threshold} prompts
              </span>
            </>
          )}
          {enabled && triggerMode === 'judgment' && (
            <span style={{ fontSize: '12px', color: theme.textSecondary }}>
              AI judgment mode
            </span>
          )}
        </div>
        {enabled && triggerMode === 'prompt' && editStatus && (
          <button
            onClick={async () => {
              await window.librarianAPI?.resetAllCounters();
              const status = await window.librarianAPI?.getEditStatus();
              if (status) setEditStatus(status);
            }}
            style={{
              padding: '4px 8px',
              fontSize: '10px',
              color: theme.textSecondary,
              backgroundColor: 'transparent',
              border: `1px solid ${theme.isDark ? theme.border : '#d1d5db'}`,
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            Reset
          </button>
        )}
      </div>

      {/* Librarian Settings */}
      <div
        style={{
          marginTop: '16px',
          padding: '16px',
          borderRadius: '8px',
          backgroundColor: theme.isDark ? theme.bgSecondary : '#f9fafb',
          border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
        }}
      >
        {/* Enable toggle */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: theme.text }}>
            Librarian
          </div>
          <button
            onClick={handleEnabledToggle}
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
              backgroundColor: enabled ? theme.accent : '#d1d5db',
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
                transform: enabled ? 'translateX(22px)' : 'translateX(2px)',
              }}
            />
          </button>
        </div>

        {/* Trigger mode selection */}
        {enabled && (
          <>
            <div style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '11px', color: theme.textSecondary, marginBottom: '8px' }}>
                Trigger mode
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    backgroundColor: triggerMode === 'prompt'
                      ? (theme.isDark ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.08)')
                      : 'transparent',
                    border: `1px solid ${triggerMode === 'prompt' ? theme.accent : 'transparent'}`,
                  }}
                >
                  <input
                    type="radio"
                    name="triggerMode"
                    value="prompt"
                    checked={triggerMode === 'prompt'}
                    onChange={() => handleTriggerModeChange('prompt')}
                    style={{ accentColor: theme.accent }}
                  />
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>
                      Prompt count
                    </div>
                    <div style={{ fontSize: '11px', color: theme.textSecondary }}>
                      Remind after a set number of prompts
                    </div>
                  </div>
                </label>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    backgroundColor: triggerMode === 'judgment'
                      ? (theme.isDark ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.08)')
                      : 'transparent',
                    border: `1px solid ${triggerMode === 'judgment' ? theme.accent : 'transparent'}`,
                  }}
                >
                  <input
                    type="radio"
                    name="triggerMode"
                    value="judgment"
                    checked={triggerMode === 'judgment'}
                    onChange={() => handleTriggerModeChange('judgment')}
                    style={{ accentColor: theme.accent }}
                  />
                  <div>
                    <div style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>
                      AI judgment
                    </div>
                    <div style={{ fontSize: '11px', color: theme.textSecondary }}>
                      Let AI decide based on work volume (~50K tokens)
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {/* Prompt threshold slider (only for prompt mode) */}
            {triggerMode === 'prompt' && (
              <div
                style={{
                  padding: '12px',
                  marginBottom: '16px',
                  borderRadius: '6px',
                  backgroundColor: theme.isDark ? theme.surface2 : '#fff',
                  border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '11px', color: theme.textSecondary }}>
                    Prompts between readings
                  </span>
                  <span style={{ fontSize: '12px', color: theme.text, fontWeight: 500 }}>
                    {promptThreshold}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '11px', color: theme.textSecondary, minWidth: '16px' }}>1</span>
                  <input
                    type="range"
                    min="1"
                    max="15"
                    value={promptThreshold}
                    onChange={(e) => handleThresholdChange(parseInt(e.target.value, 10))}
                    style={{
                      flex: 1,
                      height: '4px',
                      cursor: 'pointer',
                      accentColor: theme.accent,
                    }}
                  />
                  <span style={{ fontSize: '11px', color: theme.textSecondary, minWidth: '16px' }}>15</span>
                </div>
              </div>
            )}
          </>
        )}

        {/* Platforms section */}
        {enabled && (
          <div style={{ marginTop: '4px' }}>
            <div style={{ fontSize: '11px', color: theme.textSecondary, marginBottom: '8px' }}>
              Platforms
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {/* Claude Code */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  backgroundColor: theme.isDark ? theme.surface2 : '#fff',
                  border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>Claude Code</span>
                  {claudeCodeStatus === 'not-installed' ? (
                    <span style={{ fontSize: '10px', color: theme.textSecondary, padding: '2px 6px', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)', borderRadius: '4px' }}>
                      Not detected
                    </span>
                  ) : hookInstalled || triggerMode === 'judgment' ? (
                    <span style={{ fontSize: '10px', color: theme.success, padding: '2px 6px', backgroundColor: theme.isDark ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.1)', borderRadius: '4px' }}>
                      Connected
                    </span>
                  ) : (
                    <span style={{ fontSize: '10px', color: theme.warning, padding: '2px 6px', backgroundColor: theme.isDark ? 'rgba(234, 179, 8, 0.15)' : 'rgba(234, 179, 8, 0.1)', borderRadius: '4px' }}>
                      Setup needed
                    </span>
                  )}
                </div>
                {claudeCodeStatus !== 'not-installed' && triggerMode === 'prompt' && (
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
                      padding: '4px 10px',
                      fontSize: '11px',
                      fontWeight: 500,
                      color: hookInstalled ? theme.textSecondary : '#fff',
                      backgroundColor: hookInstalled ? 'transparent' : theme.accent,
                      border: hookInstalled ? `1px solid ${theme.border}` : 'none',
                      borderRadius: '4px',
                      cursor: hookInstalling ? 'wait' : 'pointer',
                      opacity: hookInstalling ? 0.5 : 1,
                    }}
                  >
                    {hookInstalling ? '...' : hookInstalled ? 'Disconnect' : 'Connect'}
                  </button>
                )}
              </div>

              {/* Cursor */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  backgroundColor: theme.isDark ? theme.surface2 : '#fff',
                  border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>Cursor</span>
                  <span style={{ fontSize: '10px', color: theme.textSecondary, padding: '2px 6px', backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)', borderRadius: '4px' }}>
                    Manual
                  </span>
                </div>
                <button
                  onClick={handleShowCursorInstructions}
                  style={{
                    padding: '4px 10px',
                    fontSize: '11px',
                    fontWeight: 500,
                    color: theme.textSecondary,
                    backgroundColor: 'transparent',
                    border: `1px solid ${theme.border}`,
                    borderRadius: '4px',
                    cursor: 'pointer',
                  }}
                >
                  Setup...
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
      </div>

      {/* Content guidance customization */}
      {enabled && (
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
                Saved — instructions updated
              </span>
            )}
          </div>

          <p style={{ fontSize: '11px', color: theme.textSecondary, marginTop: '12px', lineHeight: '1.5' }}>
            This shapes the intellectual content produced in each reading. Technical users might prefer
            deeper technical content, while others might enjoy broader cultural connections.
          </p>
        </div>
      )}

      {/* Configuration Files */}
      {configPaths && (
        <div
          style={{
            marginTop: '24px',
            padding: '16px',
            borderRadius: '8px',
            backgroundColor: theme.isDark ? theme.bgSecondary : '#f9fafb',
            border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
          }}
        >
          <div style={{ fontSize: '12px', fontWeight: 600, color: theme.text, marginBottom: '12px' }}>
            Configuration Files
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* CLAUDE.md */}
            <div>
              <button
                onClick={() => handleToggleConfigFile('claudeMd')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '10px 12px',
                  backgroundColor: expandedConfigFile === 'claudeMd'
                    ? (theme.isDark ? 'rgba(99, 102, 241, 0.1)' : 'rgba(99, 102, 241, 0.05)')
                    : 'transparent',
                  border: `1px solid ${expandedConfigFile === 'claudeMd' ? theme.accent : (theme.isDark ? theme.border : '#d1d5db')}`,
                  borderRadius: expandedConfigFile === 'claudeMd' ? '6px 6px 0 0' : '6px',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>
                    CLAUDE.md
                  </div>
                  <div style={{ fontSize: '10px', color: theme.textSecondary, fontFamily: 'monospace' }}>
                    ~/.claude/CLAUDE.md
                  </div>
                </div>
                <span style={{ fontSize: '11px', color: theme.textSecondary }}>
                  {expandedConfigFile === 'claudeMd' ? '▼' : '▶'}
                </span>
              </button>
              {expandedConfigFile === 'claudeMd' && (
                <div
                  style={{
                    backgroundColor: theme.isDark ? 'rgba(0,0,0,0.2)' : '#fff',
                    border: `1px solid ${theme.accent}`,
                    borderTop: 'none',
                    borderRadius: '0 0 6px 6px',
                    overflow: 'hidden',
                  }}
                >
                  {configFileLoading ? (
                    <div style={{ padding: '12px', fontSize: '11px', color: theme.textSecondary }}>Loading...</div>
                  ) : configFileContent !== null ? (
                    <>
                      <textarea
                        value={configFileEditContent}
                        onChange={(e) => handleConfigFileChange(e.target.value)}
                        style={{
                          width: '100%',
                          minHeight: '150px',
                          maxHeight: '500px',
                          padding: '12px',
                          fontSize: '11px',
                          fontFamily: 'monospace',
                          color: theme.text,
                          backgroundColor: 'transparent',
                          border: 'none',
                          outline: 'none',
                          resize: 'vertical',
                          lineHeight: '1.5',
                        }}
                      />
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        borderTop: `1px solid ${theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                        backgroundColor: theme.isDark ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.02)',
                      }}>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            onClick={handleSaveConfigFile}
                            disabled={!configFileHasChanges || configFileSaving}
                            style={{
                              padding: '4px 12px',
                              fontSize: '11px',
                              fontWeight: 500,
                              color: configFileHasChanges ? '#fff' : theme.textSecondary,
                              backgroundColor: configFileHasChanges ? theme.accent : 'transparent',
                              border: `1px solid ${configFileHasChanges ? theme.accent : theme.border}`,
                              borderRadius: '4px',
                              cursor: configFileHasChanges && !configFileSaving ? 'pointer' : 'default',
                              opacity: configFileSaving ? 0.6 : 1,
                            }}
                          >
                            {configFileSaving ? 'Saving...' : 'Save'}
                          </button>
                          {configFileHasChanges && (
                            <button
                              onClick={handleResetConfigFile}
                              style={{
                                padding: '4px 12px',
                                fontSize: '11px',
                                color: theme.textSecondary,
                                backgroundColor: 'transparent',
                                border: `1px solid ${theme.border}`,
                                borderRadius: '4px',
                                cursor: 'pointer',
                              }}
                            >
                              Reset
                            </button>
                          )}
                        </div>
                        {configFileSaved && (
                          <span style={{ fontSize: '10px', color: theme.success }}>Saved</span>
                        )}
                        {configFileHasChanges && !configFileSaved && (
                          <span style={{ fontSize: '10px', color: theme.textSecondary }}>Unsaved changes</span>
                        )}
                      </div>
                    </>
                  ) : (
                    <div style={{ padding: '12px', fontSize: '11px', color: theme.textSecondary }}>File not found</div>
                  )}
                </div>
              )}
            </div>

            {/* Librarian Instructions */}
            <div>
              <button
                onClick={() => handleToggleConfigFile('librarianCommand')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  padding: '10px 12px',
                  backgroundColor: expandedConfigFile === 'librarianCommand'
                    ? (theme.isDark ? 'rgba(99, 102, 241, 0.1)' : 'rgba(99, 102, 241, 0.05)')
                    : 'transparent',
                  border: `1px solid ${expandedConfigFile === 'librarianCommand' ? theme.accent : (theme.isDark ? theme.border : '#d1d5db')}`,
                  borderRadius: expandedConfigFile === 'librarianCommand' ? '6px 6px 0 0' : '6px',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>
                    Librarian Instructions
                  </div>
                  <div style={{ fontSize: '10px', color: theme.textSecondary, fontFamily: 'monospace' }}>
                    ~/.fieldtheory/commands/librarian.md
                  </div>
                </div>
                <span style={{ fontSize: '11px', color: theme.textSecondary }}>
                  {expandedConfigFile === 'librarianCommand' ? '▼' : '▶'}
                </span>
              </button>
              {expandedConfigFile === 'librarianCommand' && (
                <div
                  style={{
                    backgroundColor: theme.isDark ? 'rgba(0,0,0,0.2)' : '#fff',
                    border: `1px solid ${theme.accent}`,
                    borderTop: 'none',
                    borderRadius: '0 0 6px 6px',
                    overflow: 'hidden',
                  }}
                >
                  {configFileLoading ? (
                    <div style={{ padding: '12px', fontSize: '11px', color: theme.textSecondary }}>Loading...</div>
                  ) : configFileContent !== null ? (
                    <>
                      <textarea
                        value={configFileEditContent}
                        onChange={(e) => handleConfigFileChange(e.target.value)}
                        style={{
                          width: '100%',
                          minHeight: '150px',
                          maxHeight: '500px',
                          padding: '12px',
                          fontSize: '11px',
                          fontFamily: 'monospace',
                          color: theme.text,
                          backgroundColor: 'transparent',
                          border: 'none',
                          outline: 'none',
                          resize: 'vertical',
                          lineHeight: '1.5',
                        }}
                      />
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 12px',
                        borderTop: `1px solid ${theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`,
                        backgroundColor: theme.isDark ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.02)',
                      }}>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button
                            onClick={handleSaveConfigFile}
                            disabled={!configFileHasChanges || configFileSaving}
                            style={{
                              padding: '4px 12px',
                              fontSize: '11px',
                              fontWeight: 500,
                              color: configFileHasChanges ? '#fff' : theme.textSecondary,
                              backgroundColor: configFileHasChanges ? theme.accent : 'transparent',
                              border: `1px solid ${configFileHasChanges ? theme.accent : theme.border}`,
                              borderRadius: '4px',
                              cursor: configFileHasChanges && !configFileSaving ? 'pointer' : 'default',
                              opacity: configFileSaving ? 0.6 : 1,
                            }}
                          >
                            {configFileSaving ? 'Saving...' : 'Save'}
                          </button>
                          {configFileHasChanges && (
                            <button
                              onClick={handleResetConfigFile}
                              style={{
                                padding: '4px 12px',
                                fontSize: '11px',
                                color: theme.textSecondary,
                                backgroundColor: 'transparent',
                                border: `1px solid ${theme.border}`,
                                borderRadius: '4px',
                                cursor: 'pointer',
                              }}
                            >
                              Reset
                            </button>
                          )}
                        </div>
                        {configFileSaved && (
                          <span style={{ fontSize: '10px', color: theme.success }}>Saved</span>
                        )}
                        {configFileHasChanges && !configFileSaved && (
                          <span style={{ fontSize: '10px', color: theme.textSecondary }}>Unsaved changes</span>
                        )}
                      </div>
                    </>
                  ) : (
                    <div style={{ padding: '12px', fontSize: '11px', color: theme.textSecondary }}>File not found</div>
                  )}
                </div>
              )}
            </div>
          </div>
          <p style={{ fontSize: '10px', color: theme.textSecondary, marginTop: '10px', lineHeight: '1.4' }}>
            CLAUDE.md references the Librarian instructions file. Changes you make in Settings automatically update both files.
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
              Auto-open on new artifact
            </div>
            <div style={{ fontSize: '12px', color: theme.textSecondary, marginTop: '2px' }}>
              Bring Field Theory to foreground when a new artifact appears
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
        Add directories to watch for markdown artifacts. Field Theory will import new artifacts
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
                        {count} artifact{count !== 1 ? 's' : ''}
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
            View artifacts in the <strong>Librarian</strong> tab.
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
