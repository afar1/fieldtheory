/**
 * LibrarianSettings - Configure watched directories for reading collection.
 *
 * Allows users to add/remove directories that Field Theory watches for
 * markdown readings from AI coding assistants.
 */

import { useEffect, useState, useCallback, useRef, useMemo, type MouseEvent } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { FEATURE_NARRATION_ENABLED } from '../featureFlags';
import { RENDERED_EDIT_CLICK_MODE_CHANGED_EVENT, persistRenderedEditClickMode, restoreRenderedEditClickMode } from '../utils/editorShortcuts';
import { SettingsDisabledBlock } from './settings/SettingsPrimitives';

interface LibrarianSettingsProps {
  librarianEnabled?: boolean;
  onLibrarianEnabledChange?: (enabled: boolean) => void;
}

const LIBRARY_FOLDER_TOGGLES = [
  { id: 'artifacts', label: 'Artifacts', hint: 'Agent-written reading artifacts' },
  { id: 'scratchpad', label: 'Scratchpad', hint: 'Quick notes and captures' },
  { id: 'debates', label: 'Debates', hint: 'Structured debate notes' },
  { id: 'Plans', label: 'Plans', hint: 'Saved planning notes' },
  { id: 'bookmarks-from-x', label: 'Bookmarks from x.com', hint: 'Synced bookmark categories, domains, and entities' },
  { id: 'entries', label: 'Entries', hint: 'Authored wiki entries' },
] as const;
const LIBRARY_FOLDER_TOGGLE_IDS = new Set<string>(LIBRARY_FOLDER_TOGGLES.map((folder) => folder.id));

export default function LibrarianSettings({ librarianEnabled = true, onLibrarianEnabledChange }: LibrarianSettingsProps) {
  const { theme } = useTheme();

  // Watched directories
  const [watchedDirs, setWatchedDirs] = useState<WatchedDir[]>([]);
  const [readings, setReadings] = useState<ReadingMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hiddenLibraryFolders, setHiddenLibraryFolders] = useState<string[]>([]);
  const hiddenCustomLibraryFolders = hiddenLibraryFolders.filter((folderId) => !LIBRARY_FOLDER_TOGGLE_IDS.has(folderId));
  const [libraryMigrationPlan, setLibraryMigrationPlan] = useState<LibraryMigrationPlan | null>(null);
  const [libraryMigrationResult, setLibraryMigrationResult] = useState<LibraryMigrationExecutionResult | null>(null);
  const [libraryMigrationWorking, setLibraryMigrationWorking] = useState(false);

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

  // Settings
  const [enabled, setEnabled] = useState(true);
  const [renderedEditClickMode, setRenderedEditClickMode] = useState(() => restoreRenderedEditClickMode(localStorage));

  // State-enforced mode settings
  const [stateEnforcedThreshold, setStateEnforcedThreshold] = useState<number>(3);
  const [defaultRuleContent, setDefaultRuleContent] = useState('');
  const [customRuleContent, setCustomRuleContent] = useState<string | undefined>(undefined);
  const [ruleContentText, setRuleContentText] = useState('');
  const [ruleContentSaved, setRuleContentSaved] = useState(false);
  const [isUsingCustomRule, setIsUsingCustomRule] = useState(false);
  const [stateEnforcedHookInstalled, setStateEnforcedHookInstalled] = useState(false);
  const [cursorHookInstalled, setCursorHookInstalled] = useState(false);
  const [cursorHookInstalling, setCursorHookInstalling] = useState(false);
  const [codexHookInstalled, setCodexHookInstalled] = useState(false);
  const [codexHookInstalling, setCodexHookInstalling] = useState(false);
  const [codexStopOnPending, setCodexStopOnPending] = useState(false);

  // Discovery frequency (often/sometimes/rarely)
  const [discoveryFrequency, setDiscoveryFrequency] = useState<'often' | 'sometimes' | 'rarely'>('sometimes');

  // User expertise context
  const [userExpertiseContext, setUserExpertiseContext] = useState<string>('');
  const [expertiseText, setExpertiseText] = useState('');
  const [expertiseSaved, setExpertiseSaved] = useState(false);


  // Auto-show on new reading
  const [autoShowEnabled, setAutoShowEnabled] = useState(true);
  const [autoShowStealsFocus, setAutoShowStealsFocus] = useState(true);

  // Resume after close (return to last artifact vs clipboard)
  const [resumeAfterClose, setResumeAfterClose] = useState(false);
  const [immersiveHeightPercent, setImmersiveHeightPercent] = useState(85);

  // Mute status
  const [isMutedForToday, setIsMutedForToday] = useState(false);
  const [isUnmuting, setIsUnmuting] = useState(false);

  // Cursor instructions modal
  const [showCursorModal, setShowCursorModal] = useState(false);
  const [cursorInstructions, setCursorInstructions] = useState('');
  const [copied, setCopied] = useState(false);

  // Claude Code status
  const [claudeCodeStatus, setClaudeCodeStatus] = useState<'installed' | 'directory-only' | 'not-installed'>('installed');
  const [claudeConfigError, setClaudeConfigError] = useState(false);
  const [resynced, setResynced] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hookInstalling, setHookInstalling] = useState(false);

  // Narration settings
  const [narrationStatus, setNarrationStatus] = useState<{
    installStatus: 'not_installed' | 'installing' | 'installed' | 'install_failed';
    cacheSizeBytes: number;
    cachedItemCount: number;
  } | null>(null);

  // Voice selection
  const [librarianVoices, setLibrarianVoices] = useState<{ voiceId: string; name: string; speed?: number }[]>([]);
  const [currentVoiceId, setCurrentVoiceId] = useState<string | null>(null);

  // Debounce ref for threshold slider
  const thresholdDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      window.librarianAPI.getReadings(),
      window.librarianAPI.isEnabled(),
      window.librarianAPI.getAutoShowEnabled(),
      window.librarianAPI.getAutoShowStealsFocus(),
      window.librarianAPI.getClaudeCodeStatus(),
      // State-enforced mode settings
      window.librarianAPI.getStateEnforcedThreshold(),
      window.librarianAPI.getDefaultRuleContent(),
      window.librarianAPI.getCustomRuleContent(),
      // Discovery frequency & expertise settings
      window.librarianAPI.getDiscoveryFrequency(),
      window.librarianAPI.getUserExpertiseContext(),
      window.librarianAPI.getResumeAfterClose(),
      window.librarianAPI.getImmersiveHeightPercent(),
      window.librarianAPI.isCodexStopOnPendingEnabled(),
      // Mute status
      window.librarianAPI.isMutedForToday(),
      window.libraryAPI?.getHiddenFolders() ?? Promise.resolve([]),
    ])
      .then(([dirs, readingsList, isEnabled, autoShow, autoShowFocus, ccStatus, seThreshold, defaultRule, customRule, discFreq, expertiseCtx, resumeClose, immersiveHeight, codexStopPending, mutedStatus, hiddenFolders]) => {
        setWatchedDirs(dirs);
        setReadings(readingsList);
        setEnabled(isEnabled);
        // Sync tab visibility with feature state
        if (isEnabled !== librarianEnabled) {
          onLibrarianEnabledChange?.(isEnabled);
        }
        setAutoShowEnabled(autoShow);
        setAutoShowStealsFocus(autoShowFocus);
        setClaudeCodeStatus(ccStatus as 'installed' | 'directory-only' | 'not-installed');
        // State-enforced mode settings
        setStateEnforcedThreshold(seThreshold);
        setDefaultRuleContent(defaultRule);
        setCustomRuleContent(customRule);
        setRuleContentText(customRule || defaultRule);
        setIsUsingCustomRule(!!customRule);
        // Discovery frequency & expertise settings
        setDiscoveryFrequency(discFreq as 'often' | 'sometimes' | 'rarely');
        setUserExpertiseContext(expertiseCtx || '');
        setExpertiseText(expertiseCtx || '');
        setResumeAfterClose(resumeClose);
        setImmersiveHeightPercent(typeof immersiveHeight === 'number' ? immersiveHeight : 85);
        setCodexStopOnPending(codexStopPending);
        setIsMutedForToday(mutedStatus);
        setHiddenLibraryFolders(hiddenFolders);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load librarian settings:', err);
        setLoading(false);
      });
  }, []);

  // Check global state-enforced hook status
  useEffect(() => {
    if (!window.librarianAPI) return;

    const checkHookStatus = async () => {
      const isInstalled = await window.librarianAPI?.isStateEnforcedHookInstalled();
      setStateEnforcedHookInstalled(isInstalled ?? false);
    };

    checkHookStatus();
  }, []);

  // Check Cursor hook status
  useEffect(() => {
    if (!window.librarianAPI) return;

    const checkCursorHookStatus = async () => {
      const isInstalled = await window.librarianAPI?.isCursorHookInstalled();
      setCursorHookInstalled(isInstalled ?? false);
    };

    checkCursorHookStatus();
  }, []);

  // Check Codex hook status
  useEffect(() => {
    if (!window.librarianAPI) return;

    const checkCodexHookStatus = async () => {
      const isInstalled = await window.librarianAPI?.isCodexHookInstalled();
      setCodexHookInstalled(isInstalled ?? false);
    };

    checkCodexHookStatus();
  }, []);

  // Fetch narration status and voice options (feature flagged)
  useEffect(() => {
    if (!FEATURE_NARRATION_ENABLED || !window.narrationAPI) return;

    window.narrationAPI.getStatus().then((status) => {
      if (status) {
        setNarrationStatus({
          installStatus: status.installStatus,
          cacheSizeBytes: status.cacheSizeBytes,
          cachedItemCount: status.cachedItemCount,
        });
      }
    });

    // Fetch available voices and current selection
    window.narrationAPI.getLibrarianVoices?.().then((voices) => {
      setLibrarianVoices(voices);
    });
    window.narrationAPI.getCurrentVoiceId?.().then((voiceId) => {
      setCurrentVoiceId(voiceId);
    });
  }, []);


  // Handle voice change
  const handleVoiceChange = useCallback(async (voiceId: string) => {
    if (!window.narrationAPI) return;
    const success = await window.narrationAPI.setElevenlabsVoice(voiceId);
    if (success) {
      setCurrentVoiceId(voiceId);
    }
  }, []);

  // Handle clear narration cache
  const handleClearNarrationCache = useCallback(async () => {
    if (!window.narrationAPI) return;
    await window.narrationAPI.clearCache();
    const status = await window.narrationAPI.getStatus();
    if (status) {
      setNarrationStatus({
        installStatus: status.installStatus,
        cacheSizeBytes: status.cacheSizeBytes,
        cachedItemCount: status.cachedItemCount,
      });
    }
  }, []);

  // Format bytes for display
  const formatBytes = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

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

  // Check if any platform is connected (required for Librarian)
  const anyPlatformConnected = stateEnforcedHookInstalled || cursorHookInstalled || codexHookInstalled;

  // Handle enable toggle - controls both feature AND tab visibility
  const handleEnabledToggle = useCallback(async () => {
    if (!window.librarianAPI) return;
    const newValue = !enabled;

    // Require at least one platform to be connected to enable
    if (newValue && !anyPlatformConnected) {
      return; // Don't allow enabling without a platform
    }

    setEnabled(newValue);
    setClaudeConfigError(false);
    setSaved(false);
    const success = await window.librarianAPI.setEnabled(newValue);
    if (!success) {
      setClaudeConfigError(true);
      setEnabled(!newValue); // Revert on failure
    } else {
      // Also update tab visibility to match feature state
      onLibrarianEnabledChange?.(newValue);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  }, [enabled, onLibrarianEnabledChange, anyPlatformConnected]);

  // Handle auto-show toggle
  const handleAutoShowToggle = useCallback(async () => {
    if (!window.librarianAPI) return;
    const newValue = !autoShowEnabled;
    setAutoShowEnabled(newValue);
    await window.librarianAPI.setAutoShowEnabled(newValue);
  }, [autoShowEnabled]);

  const handleAutoShowStealsFocusToggle = useCallback(async () => {
    if (!window.librarianAPI) return;
    const newValue = !autoShowStealsFocus;
    setAutoShowStealsFocus(newValue);
    await window.librarianAPI.setAutoShowStealsFocus(newValue);
  }, [autoShowStealsFocus]);

  const handleRenderedEditClickModeToggle = useCallback(() => {
    const nextMode = renderedEditClickMode === 'click' ? 'command-click' : 'click';
    setRenderedEditClickMode(nextMode);
    persistRenderedEditClickMode(localStorage, nextMode);
    window.dispatchEvent(new Event(RENDERED_EDIT_CLICK_MODE_CHANGED_EVENT));
  }, [renderedEditClickMode]);

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

  const handleLibraryFolderVisibilityChange = useCallback(async (folderId: string, visible: boolean) => {
    const previous = hiddenLibraryFolders;
    const optimistic = visible
      ? previous.filter((id) => id !== folderId)
      : [...new Set([...previous, folderId])];
    setHiddenLibraryFolders(optimistic);

    try {
      const result = await window.libraryAPI?.setFolderHidden(folderId, !visible);
      setHiddenLibraryFolders(result ?? previous);
    } catch {
      setHiddenLibraryFolders(previous);
    }
  }, [hiddenLibraryFolders]);

  const handleLibraryMigrationClick = useCallback(async (event: MouseEvent<HTMLButtonElement>) => {
    if (!window.libraryAPI || libraryMigrationWorking) return;

    setError(null);
    setLibraryMigrationWorking(true);
    try {
      if ((event.metaKey || event.ctrlKey) && libraryMigrationPlan) {
        const result = await window.libraryAPI.executeMigration();
        setLibraryMigrationResult(result);
        setLibraryMigrationPlan(await window.libraryAPI.previewMigration());
      } else {
        setLibraryMigrationResult(null);
        setLibraryMigrationPlan(await window.libraryAPI.previewMigration());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLibraryMigrationWorking(false);
    }
  }, [libraryMigrationPlan, libraryMigrationWorking]);

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
      {/* Librarian Settings */}
      <div
        style={{
          padding: '16px',
          borderRadius: '8px',
          backgroundColor: theme.isDark ? theme.bgSecondary : '#f9fafb',
          border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
        }}
      >
        {/* Enable toggle with status tag */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: theme.text }}>
              Librarian
            </span>
            {enabled && anyPlatformConnected ? (
              <>
                {stateEnforcedHookInstalled && (
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 500,
                      color: theme.accent,
                      backgroundColor: theme.isDark ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.1)',
                      padding: '2px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    Claude Code
                  </span>
                )}
                {cursorHookInstalled && (
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 500,
                      color: theme.accent,
                      backgroundColor: theme.isDark ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.1)',
                      padding: '2px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    Cursor
                  </span>
                )}
                {codexHookInstalled && (
                  <span
                    style={{
                      fontSize: '10px',
                      fontWeight: 500,
                      color: theme.accent,
                      backgroundColor: theme.isDark ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.1)',
                      padding: '2px 6px',
                      borderRadius: '4px',
                    }}
                  >
                    Codex
                  </span>
                )}
              </>
            ) : (
              <span
                style={{
                  fontSize: '10px',
                  fontWeight: 500,
                  color: theme.textSecondary,
                  backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                  padding: '2px 6px',
                  borderRadius: '4px',
                }}
              >
                Off
              </span>
            )}
          </div>
          <button
            onClick={handleEnabledToggle}
            disabled={!enabled && !anyPlatformConnected}
            title={!enabled && !anyPlatformConnected ? 'Connect a platform first' : undefined}
            style={{
              position: 'relative',
              width: '44px',
              minWidth: '44px',
              height: '24px',
              minHeight: '24px',
              borderRadius: '12px',
              cursor: (!enabled && !anyPlatformConnected) ? 'not-allowed' : 'pointer',
              border: 'none',
              padding: 0,
              flexShrink: 0,
              transition: 'background-color 0.2s',
              backgroundColor: enabled ? theme.accent : '#d1d5db',
              opacity: (!enabled && !anyPlatformConnected) ? 0.5 : 1,
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

        {/* Platforms section - required for Librarian to function */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ marginBottom: '8px' }}>
            <span style={{ fontSize: '11px', color: theme.textSecondary }}>
              Platforms
            </span>
            <div style={{ fontSize: '10px', color: theme.textSecondary, marginTop: '2px' }}>
              At least one must be connected for Librarian to work
            </div>
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
                ) : stateEnforcedHookInstalled ? (
                  <span style={{ fontSize: '10px', color: theme.success, padding: '2px 6px', backgroundColor: theme.isDark ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.1)', borderRadius: '4px' }}>
                    Connected
                  </span>
                ) : (
                  <span style={{ fontSize: '10px', color: theme.warning, padding: '2px 6px', backgroundColor: theme.isDark ? 'rgba(234, 179, 8, 0.15)' : 'rgba(234, 179, 8, 0.1)', borderRadius: '4px' }}>
                    Setup needed
                  </span>
                )}
              </div>
              {claudeCodeStatus !== 'not-installed' && (
                <button
                  onClick={async () => {
                    setHookInstalling(true);
                    try {
                      if (stateEnforcedHookInstalled) {
                        await window.librarianAPI?.uninstallStateEnforcedHook();
                        setStateEnforcedHookInstalled(false);
                      } else {
                        const success = await window.librarianAPI?.installStateEnforcedHook();
                        setStateEnforcedHookInstalled(success ?? false);
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
                    color: stateEnforcedHookInstalled ? theme.textSecondary : '#fff',
                    backgroundColor: stateEnforcedHookInstalled ? 'transparent' : theme.accent,
                    border: stateEnforcedHookInstalled ? `1px solid ${theme.border}` : 'none',
                    borderRadius: '4px',
                    cursor: hookInstalling ? 'wait' : 'pointer',
                    opacity: hookInstalling ? 0.5 : 1,
                  }}
                >
                  {hookInstalling ? '...' : stateEnforcedHookInstalled ? 'Disconnect' : 'Connect'}
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
                {cursorHookInstalled ? (
                  <span style={{ fontSize: '10px', color: theme.success, padding: '2px 6px', backgroundColor: theme.isDark ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.1)', borderRadius: '4px' }}>
                    Connected
                  </span>
                ) : (
                  <span style={{ fontSize: '10px', color: theme.warning, padding: '2px 6px', backgroundColor: theme.isDark ? 'rgba(234, 179, 8, 0.15)' : 'rgba(234, 179, 8, 0.1)', borderRadius: '4px' }}>
                    Setup needed
                  </span>
                )}
              </div>
              <button
                onClick={async () => {
                  setCursorHookInstalling(true);
                  try {
                    if (cursorHookInstalled) {
                      await window.librarianAPI?.uninstallCursorHook();
                      setCursorHookInstalled(false);
                    } else {
                      const success = await window.librarianAPI?.installCursorHook();
                      setCursorHookInstalled(success ?? false);
                    }
                  } finally {
                    setCursorHookInstalling(false);
                  }
                }}
                disabled={cursorHookInstalling}
                style={{
                  padding: '4px 10px',
                  fontSize: '11px',
                  fontWeight: 500,
                  color: cursorHookInstalled ? theme.textSecondary : '#fff',
                  backgroundColor: cursorHookInstalled ? 'transparent' : theme.accent,
                  border: cursorHookInstalled ? `1px solid ${theme.border}` : 'none',
                  borderRadius: '4px',
                  cursor: cursorHookInstalling ? 'wait' : 'pointer',
                  opacity: cursorHookInstalling ? 0.5 : 1,
                }}
              >
                {cursorHookInstalling ? '...' : cursorHookInstalled ? 'Disconnect' : 'Connect'}
              </button>
            </div>

            {/* Codex */}
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
                <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>Codex</span>
                {codexHookInstalled ? (
                  <span style={{ fontSize: '10px', color: theme.success, padding: '2px 6px', backgroundColor: theme.isDark ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.1)', borderRadius: '4px' }}>
                    Connected
                  </span>
                ) : (
                  <span style={{ fontSize: '10px', color: theme.warning, padding: '2px 6px', backgroundColor: theme.isDark ? 'rgba(234, 179, 8, 0.15)' : 'rgba(234, 179, 8, 0.1)', borderRadius: '4px' }}>
                    Setup needed
                  </span>
                )}
              </div>
              <button
                onClick={async () => {
                  setCodexHookInstalling(true);
                  try {
                    if (codexHookInstalled) {
                      await window.librarianAPI?.uninstallCodexHook();
                      setCodexHookInstalled(false);
                    } else {
                      const success = await window.librarianAPI?.installCodexHook();
                      setCodexHookInstalled(success ?? false);
                    }
                  } finally {
                    setCodexHookInstalling(false);
                  }
                }}
                disabled={codexHookInstalling}
                style={{
                  padding: '4px 10px',
                  fontSize: '11px',
                  fontWeight: 500,
                  color: codexHookInstalled ? theme.textSecondary : '#fff',
                  backgroundColor: codexHookInstalled ? 'transparent' : theme.accent,
                  border: codexHookInstalled ? `1px solid ${theme.border}` : 'none',
                  borderRadius: '4px',
                  cursor: codexHookInstalling ? 'wait' : 'pointer',
                  opacity: codexHookInstalling ? 0.5 : 1,
                }}
              >
                {codexHookInstalling ? '...' : codexHookInstalled ? 'Disconnect' : 'Connect'}
              </button>
            </div>
            <div
              style={{
                marginTop: '-2px',
                padding: '0 2px 0 12px',
                fontSize: '10px',
                lineHeight: 1.4,
                color: theme.textSecondary,
              }}
            >
              Connect once and Field Theory will configure Codex hooks automatically.
            </div>
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
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>
                  Codex stop blocking
                </span>
                <span style={{ fontSize: '10px', color: theme.textSecondary }}>
                  Block Codex replies while a Librarian job is pending
                </span>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const next = !codexStopOnPending;
                  setCodexStopOnPending(next);
                  const success = await window.librarianAPI?.setCodexStopOnPendingEnabled(next);
                  if (!success) {
                    setCodexStopOnPending(!next);
                  }
                }}
                style={{
                  position: 'relative',
                  width: '36px',
                  minWidth: '36px',
                  height: '20px',
                  minHeight: '20px',
                  borderRadius: '10px',
                  cursor: 'pointer',
                  border: 'none',
                  padding: 0,
                  backgroundColor: codexStopOnPending ? theme.accent : '#d1d5db',
                }}
              >
                <span
                  style={{
                    position: 'absolute',
                    top: '2px',
                    left: 0,
                    width: '16px',
                    height: '16px',
                    borderRadius: '8px',
                    backgroundColor: '#fff',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    transition: 'transform 0.2s',
                    transform: codexStopOnPending ? 'translateX(18px)' : 'translateX(2px)',
                  }}
                />
              </button>
            </div>
          </div>
        </div>

        <SettingsDisabledBlock disabled={!enabled}>
        {/* Auto-open on new artifact */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 0',
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>
              Auto-open on new artifact
            </span>
            <span style={{ fontSize: '11px', color: theme.textSecondary }}>
              Open the Librarian window when a new artifact appears
            </span>
          </div>
          <input
            type="checkbox"
            checked={autoShowEnabled}
            onChange={handleAutoShowToggle}
            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
          />
        </label>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 0',
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>
              Single-click rendered command pages to open markdown source
            </span>
            <span style={{ fontSize: '11px', color: theme.textSecondary }}>
              Library rendered pages edit directly; this only affects command pages
            </span>
          </div>
          <input
            type="checkbox"
            checked={renderedEditClickMode === 'click'}
            onChange={handleRenderedEditClickModeToggle}
            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
          />
        </label>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 0',
            cursor: autoShowEnabled ? 'pointer' : 'not-allowed',
            opacity: autoShowEnabled ? 1 : 0.6,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>
              Steal focus when auto-opening
            </span>
            <span style={{ fontSize: '11px', color: theme.textSecondary }}>
              Bring Field Theory to the foreground instead of leaving focus in your current app
            </span>
          </div>
          <input
            type="checkbox"
            checked={autoShowStealsFocus}
            disabled={!autoShowEnabled}
            onChange={handleAutoShowStealsFocusToggle}
            style={{ width: '18px', height: '18px', cursor: autoShowEnabled ? 'pointer' : 'not-allowed' }}
          />
        </label>

        {/* Resume after close */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 0',
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>
              Resume on reopen
            </span>
            <span style={{ fontSize: '11px', color: theme.textSecondary }}>
              Return to last artifact instead of Fields
            </span>
          </div>
          <input
            type="checkbox"
            checked={resumeAfterClose}
            onChange={async () => {
              const newValue = !resumeAfterClose;
              setResumeAfterClose(newValue);
              await window.librarianAPI?.setResumeAfterClose(newValue);
            }}
            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
          />
        </label>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 0',
            gap: '12px',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>
              Immersive height
            </span>
            <span style={{ fontSize: '11px', color: theme.textSecondary }}>
              Target height for the expanded Library view as a percent of the screen work area
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <input
              type="number"
              min={50}
              max={100}
              step={5}
              value={immersiveHeightPercent}
              onChange={(e) => setImmersiveHeightPercent(Number(e.target.value))}
              onBlur={async () => {
                const clamped = Math.max(50, Math.min(100, isNaN(immersiveHeightPercent) ? 85 : immersiveHeightPercent));
                setImmersiveHeightPercent(clamped);
                await window.librarianAPI?.setImmersiveHeightPercent(clamped);
              }}
              style={{
                width: '52px',
                fontSize: '12px',
                padding: '4px 6px',
                borderRadius: '4px',
                border: `1px solid ${theme.border}`,
                backgroundColor: theme.isDark ? theme.surface1 : '#fff',
                color: theme.text,
                textAlign: 'center',
              }}
            />
            <span style={{ fontSize: '12px', color: theme.textSecondary }}>%</span>
          </div>
        </label>

        {/* Muted status indicator with unmute option */}
        {isMutedForToday && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 12px',
              marginTop: '8px',
              borderRadius: '6px',
              backgroundColor: theme.isDark ? 'rgba(234, 179, 8, 0.1)' : 'rgba(234, 179, 8, 0.08)',
              border: `1px solid ${theme.isDark ? 'rgba(234, 179, 8, 0.25)' : 'rgba(234, 179, 8, 0.2)'}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {/* Bell-off icon */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={theme.warning} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8.7 3A6 6 0 0 1 18 8a21.3 21.3 0 0 0 .6 5"/>
                <path d="M17 17H3s3-2 3-9a4.67 4.67 0 0 1 .3-1.7"/>
                <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>
                <path d="m2 2 20 20"/>
              </svg>
              <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>
                Muted until tomorrow
              </span>
            </div>
            <button
              onClick={async () => {
                setIsUnmuting(true);
                try {
                  const success = await window.librarianAPI?.unmute();
                  if (success) {
                    setIsMutedForToday(false);
                  }
                } finally {
                  setIsUnmuting(false);
                }
              }}
              disabled={isUnmuting}
              style={{
                padding: '4px 10px',
                fontSize: '11px',
                fontWeight: 500,
                color: theme.warning,
                backgroundColor: 'transparent',
                border: `1px solid ${theme.isDark ? 'rgba(234, 179, 8, 0.4)' : 'rgba(234, 179, 8, 0.5)'}`,
                borderRadius: '4px',
                cursor: isUnmuting ? 'wait' : 'pointer',
                opacity: isUnmuting ? 0.6 : 1,
              }}
            >
              {isUnmuting ? '...' : 'Unmute'}
            </button>
          </div>
        )}

        {/* State-enforced mode settings */}
        {enabled && (
              <div
                style={{
                  padding: '12px',
                  marginBottom: '16px',
                  borderRadius: '6px',
                  backgroundColor: theme.isDark ? theme.surface2 : '#fff',
                  border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
                }}
              >
                {/* Discovery frequency selector */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '11px', color: theme.textSecondary }}>
                      Discovery frequency
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0', borderRadius: '6px', overflow: 'hidden', border: `1px solid ${theme.border}` }}>
                    {(['often', 'sometimes', 'rarely'] as const).map((freq) => (
                      <button
                        key={freq}
                        onClick={async () => {
                          setDiscoveryFrequency(freq);
                          await window.librarianAPI?.setDiscoveryFrequency(freq);
                        }}
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          fontSize: '11px',
                          fontWeight: discoveryFrequency === freq ? 600 : 400,
                          color: discoveryFrequency === freq ? '#fff' : theme.textSecondary,
                          backgroundColor: discoveryFrequency === freq ? theme.accent : 'transparent',
                          border: 'none',
                          borderRight: freq !== 'rarely' ? `1px solid ${theme.border}` : 'none',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          textTransform: 'capitalize',
                        }}
                      >
                        {freq}
                      </button>
                    ))}
                  </div>
                </div>

                {/* User expertise context (visible to all users) */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                    <span style={{ fontSize: '11px', color: theme.textSecondary }}>
                      About you (optional)
                    </span>
                    <span style={{ fontSize: '10px', color: theme.textSecondary }}>
                      {expertiseText.length} / 400
                    </span>
                  </div>
                  <div style={{ fontSize: '10px', color: theme.textSecondary, marginBottom: '8px', lineHeight: '1.4' }}>
                    Librarian uses this to tune its voice. "Make it weirder" is valid. So is "I'm a senior engineer who likes precision."
                  </div>
                  <textarea
                    value={expertiseText}
                    onChange={(e) => {
                      if (e.target.value.length <= 400) {
                        setExpertiseText(e.target.value);
                      }
                    }}
                    placeholder="e.g., I'm a senior engineer who prefers concise technical writing"
                    style={{
                      width: '100%',
                      minHeight: '60px',
                      padding: '10px',
                      fontSize: '11px',
                      fontFamily: "'SF Mono', Monaco, monospace",
                      lineHeight: '1.5',
                      backgroundColor: theme.isDark ? 'rgba(0,0,0,0.2)' : '#fff',
                      border: `1px solid ${theme.isDark ? theme.border : '#d1d5db'}`,
                      borderRadius: '6px',
                      color: theme.text,
                      resize: 'vertical',
                      outline: 'none',
                      boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center' }}>
                    <button
                      onClick={async () => {
                        const context = expertiseText.trim() || undefined;
                        await window.librarianAPI?.setUserExpertiseContext(context);
                        setUserExpertiseContext(context || '');
                        setExpertiseSaved(true);
                        setTimeout(() => setExpertiseSaved(false), 2000);
                      }}
                      disabled={expertiseText === userExpertiseContext}
                      style={{
                        padding: '4px 10px',
                        fontSize: '11px',
                        fontWeight: 500,
                        color: expertiseText !== userExpertiseContext ? '#fff' : theme.textSecondary,
                        backgroundColor: expertiseText !== userExpertiseContext ? theme.accent : 'transparent',
                        border: expertiseText !== userExpertiseContext ? 'none' : `1px solid ${theme.border}`,
                        borderRadius: '4px',
                        cursor: expertiseText !== userExpertiseContext ? 'pointer' : 'default',
                      }}
                    >
                      {expertiseSaved ? '✓ Saved' : 'Save'}
                    </button>
                    {userExpertiseContext && (
                      <button
                        onClick={async () => {
                          await window.librarianAPI?.setUserExpertiseContext(undefined);
                          setUserExpertiseContext('');
                          setExpertiseText('');
                        }}
                        style={{
                          padding: '4px 10px',
                          fontSize: '11px',
                          color: theme.textSecondary,
                          backgroundColor: 'transparent',
                          border: `1px solid ${theme.border}`,
                          borderRadius: '4px',
                          cursor: 'pointer',
                        }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

              </div>
            )}
        </SettingsDisabledBlock>

        <div
          style={{
            padding: '12px',
            marginTop: '16px',
            borderRadius: '6px',
            backgroundColor: theme.isDark ? theme.surface2 : '#fff',
            border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
          }}
        >
          <div style={{ marginBottom: '10px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: theme.text }}>
              Library folders
            </div>
            <div style={{ fontSize: '11px', color: theme.textSecondary, marginTop: '3px', lineHeight: 1.4 }}>
              Choose which Library folders are visible. This never deletes files.
            </div>
          </div>
          {LIBRARY_FOLDER_TOGGLES.map((folder) => {
            const visible = !hiddenLibraryFolders.includes(folder.id);
            return (
              <label
                key={folder.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                  padding: '7px 0',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>
                    {folder.label}
                  </span>
                  <span style={{ fontSize: '11px', color: theme.textSecondary }}>
                    {folder.hint}
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={visible}
                  onChange={(event) => {
                    void handleLibraryFolderVisibilityChange(folder.id, event.target.checked);
                  }}
                  style={{ width: '18px', height: '18px', cursor: 'pointer' }}
                />
              </label>
            );
          })}
          {hiddenCustomLibraryFolders.map((folderId) => (
            <label
              key={folderId}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
                padding: '7px 0',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <span style={{ fontSize: '12px', fontWeight: 500, color: theme.text }}>
                  {folderId}
                </span>
                <span style={{ fontSize: '11px', color: theme.textSecondary }}>
                  Removed from FT
                </span>
              </div>
              <input
                type="checkbox"
                checked={false}
                onChange={(event) => {
                  if (event.target.checked) {
                    void handleLibraryFolderVisibilityChange(folderId, true);
                  }
                }}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
            </label>
          ))}
        </div>

        <div
          style={{
            padding: '12px',
            marginTop: '16px',
            borderRadius: '6px',
            backgroundColor: theme.isDark ? theme.surface2 : '#fff',
            border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: theme.text }}>
                Library migration
              </div>
              <div style={{ fontSize: '11px', color: theme.textSecondary, marginTop: '3px', lineHeight: 1.4 }}>
                Move markdown from the old bookmark wiki into the canonical Library folder.
              </div>
            </div>
            <button
              onClick={handleLibraryMigrationClick}
              disabled={libraryMigrationWorking}
              title="Click to preview. Command-click after preview to execute."
              style={{
                padding: '6px 10px',
                fontSize: '11px',
                fontWeight: 500,
                color: libraryMigrationWorking ? theme.textSecondary : '#fff',
                backgroundColor: libraryMigrationWorking ? 'transparent' : theme.accent,
                border: libraryMigrationWorking ? `1px solid ${theme.border}` : 'none',
                borderRadius: '4px',
                cursor: libraryMigrationWorking ? 'wait' : 'pointer',
                flexShrink: 0,
              }}
            >
              {libraryMigrationWorking ? '...' : libraryMigrationPlan ? 'Refresh report' : 'Preview'}
            </button>
          </div>

          {libraryMigrationPlan && (
            <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '6px' }}>
                {[
                  ['Copy', libraryMigrationPlan.filesToCopy.length],
                  ['Same', libraryMigrationPlan.identicalFiles.length],
                  ['Conflict', libraryMigrationPlan.conflicts.length],
                  ['New only', libraryMigrationPlan.targetOnlyFiles.length],
                ].map(([label, count]) => (
                  <div
                    key={label}
                    style={{
                      padding: '6px 8px',
                      borderRadius: '5px',
                      backgroundColor: theme.isDark ? 'rgba(255,255,255,0.04)' : '#f9fafb',
                      border: `1px solid ${theme.border}`,
                    }}
                  >
                    <div style={{ fontSize: '10px', color: theme.textSecondary }}>{label}</div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: theme.text }}>{count}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: '10px', color: theme.textSecondary, lineHeight: 1.5, fontFamily: "'SF Mono', Monaco, monospace" }}>
                <div>Old: {formatPath(libraryMigrationPlan.sourceDir)}</div>
                <div>New: {formatPath(libraryMigrationPlan.targetDir)}</div>
                <div>Backup: {formatPath(libraryMigrationPlan.backupDir)}</div>
              </div>
              {libraryMigrationPlan.blockingIssues.length > 0 && (
                <div style={{ fontSize: '11px', color: theme.error, lineHeight: 1.4 }}>
                  {libraryMigrationPlan.blockingIssues.join(' ')}
                </div>
              )}
            </div>
          )}

          {libraryMigrationResult && (
            <div
              style={{
                marginTop: '10px',
                fontSize: '11px',
                lineHeight: 1.5,
                color: libraryMigrationResult.success ? theme.success : theme.error,
              }}
            >
              {libraryMigrationResult.success
                ? `Copied ${libraryMigrationResult.copiedFiles.length}, conflict-copied ${libraryMigrationResult.conflictCopies.length}.`
                : libraryMigrationResult.errors.join(' ')}
            </div>
          )}
        </div>

        {claudeConfigError && (
          <p style={{ fontSize: '11px', color: theme.error, marginTop: '12px' }}>
            Failed to update ~/.claude/CLAUDE.md. Check file permissions.
          </p>
        )}
      </div>

      {/* Narration Settings (feature flagged) */}
      {FEATURE_NARRATION_ENABLED && narrationStatus && (
        <div
          style={{
            marginTop: '24px',
            padding: '16px',
            borderRadius: '8px',
            backgroundColor: theme.isDark ? theme.bgSecondary : '#f9fafb',
            border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: theme.text }}>
                Narration
              </div>
              <div style={{ fontSize: '11px', color: theme.textSecondary, marginTop: '2px' }}>
                Listen to readings with AI-generated voice
              </div>
            </div>
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
              ElevenLabs
            </span>
          </div>

          {/* Voice Selection */}
          {librarianVoices.length > 0 && (
            <div
              style={{
                padding: '10px 12px',
                marginBottom: '12px',
                backgroundColor: theme.isDark ? theme.surface2 : '#fff',
                border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
                borderRadius: '6px',
              }}
            >
              <div style={{ fontSize: '11px', color: theme.textSecondary, marginBottom: '8px' }}>
                Voice
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {librarianVoices.map((voice) => (
                  <button
                    key={voice.voiceId}
                    onClick={() => handleVoiceChange(voice.voiceId)}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      fontSize: '11px',
                      fontWeight: 500,
                      color: currentVoiceId === voice.voiceId ? '#fff' : theme.text,
                      backgroundColor: currentVoiceId === voice.voiceId ? theme.accent : 'transparent',
                      border: `1px solid ${currentVoiceId === voice.voiceId ? theme.accent : theme.border}`,
                      borderRadius: '6px',
                      cursor: 'pointer',
                    }}
                  >
                    {voice.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Audio Cache */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 12px',
              backgroundColor: theme.isDark ? theme.surface2 : '#fff',
              border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
              borderRadius: '6px',
            }}
          >
            <div>
              <div style={{ fontSize: '12px', color: theme.text }}>
                Audio Cache
              </div>
              <div style={{ fontSize: '11px', color: theme.textSecondary }}>
                {narrationStatus.cachedItemCount} item{narrationStatus.cachedItemCount !== 1 ? 's' : ''} ({formatBytes(narrationStatus.cacheSizeBytes)})
              </div>
            </div>
            {narrationStatus.cachedItemCount > 0 && (
              <button
                onClick={handleClearNarrationCache}
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
                Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Fresh session notice */}
      <div style={{
        fontSize: '10px',
        color: theme.text,
        marginTop: '16px',
        textAlign: 'center',
        padding: '8px 12px',
        backgroundColor: theme.isDark ? 'rgba(234, 179, 8, 0.1)' : 'rgba(234, 179, 8, 0.08)',
        border: `1px solid ${theme.isDark ? 'rgba(234, 179, 8, 0.25)' : 'rgba(234, 179, 8, 0.2)'}`,
        borderRadius: '6px',
      }}>
        Any changes to this page require a fresh Claude Code or Cursor session
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
              Optional: paste this into Cursor Settings → General → Rules for AI to reinforce the hook behavior
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
