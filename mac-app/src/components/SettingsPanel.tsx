// =============================================================================
// SettingsPanel - Consolidated settings UI for the clipboard history window.
// Shows audio, transcription, and clipboard settings in one view.
// Styled consistently with the clipboard history window's design language.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import AudioSettingsPanel from './AudioSettingsPanel';
import TranscriptionSettings from './TranscriptionSettings';
import PromptSettings from './PromptSettings';
import { supabase } from '../supabaseClient';
import type { Session } from '@supabase/supabase-js';
import { useTheme } from '../contexts/ThemeContext';

/**
 * SettingsPanel - Settings content designed to live inside the clipboard history window.
 * Keeps the same functionality as the original App.tsx settings, but styled for the
 * clipboard history context.
 */
export default function SettingsPanel() {
  const { theme } = useTheme();
  // Permissions state
  const [permissions, setPermissions] = useState<{ accessibilityGranted: boolean } | null>(null);
  const [showPermissionsGate, setShowPermissionsGate] = useState(false);
  
  // Clipboard hotkey configuration
  const [clipboardHotkeys, setClipboardHotkeys] = useState<{ screenshot?: string; history?: string }>({
    screenshot: 'CommandOrControl+Shift+4',
    history: 'CommandOrControl+Shift+V',
  });
  const [isCapturingScreenshotHotkey, setIsCapturingScreenshotHotkey] = useState(false);
  const [isCapturingHistoryHotkey, setIsCapturingHistoryHotkey] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  
  // Continuous Context configuration
  const [continuousContextEnabled, setContinuousContextEnabled] = useState(false);
  const [continuousContextHotkey, setContinuousContextHotkey] = useState('Shift+Alt+1');
  const [isCapturingContinuousContextHotkey, setIsCapturingContinuousContextHotkey] = useState(false);
  
  // Todo hotkey configuration
  const [todoHotkey, setTodoHotkey] = useState('Command+Shift+T');
  const [isCapturingTodoHotkey, setIsCapturingTodoHotkey] = useState(false);
  
  // Mobile sync state - sign-in is handled via TeamView, we just listen for session.
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  
  // API key state - for Engineer feature (Anthropic API)
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [apiKeyError, setApiKeyError] = useState<string | null>(null);
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  
  // Load clipboard hotkeys on mount
  useEffect(() => {
    if (window.clipboardAPI) {
      window.clipboardAPI.getHotkeys().then(hotkeys => {
        setClipboardHotkeys(hotkeys);
      });
      
      // Load continuous context settings
      window.clipboardAPI.getContinuousContextEnabled?.().then(enabled => {
        setContinuousContextEnabled(enabled);
      });
      window.clipboardAPI.getContinuousContextHotkey?.().then(hotkey => {
        if (hotkey) {
          setContinuousContextHotkey(hotkey);
        }
      });
      
      // Load API key status
      window.clipboardAPI.getApiKeyStatus?.().then(status => {
        setHasApiKey(status.hasKey);
      });
    }
    
    // Load todo hotkey
    if (window.todoAPI) {
      window.todoAPI.getHotkey().then(hotkey => {
        if (hotkey) {
          setTodoHotkey(hotkey);
        }
      });
    }
  }, []);
  
  // Handler for saving API key
  const handleSaveApiKey = async () => {
    if (!window.clipboardAPI?.setApiKey || !apiKeyInput.trim()) return;
    
    setApiKeySaving(true);
    setApiKeyError(null);
    
    try {
      const result = await window.clipboardAPI.setApiKey(apiKeyInput.trim());
      if (result.success) {
        setHasApiKey(true);
        setApiKeyInput('');
        setShowApiKey(false);
      } else {
        setApiKeyError(result.error || 'Failed to save API key');
      }
    } catch (err) {
      setApiKeyError(err instanceof Error ? err.message : 'Failed to save API key');
    } finally {
      setApiKeySaving(false);
    }
  };
  
  // Handler for clearing API key
  const handleClearApiKey = async () => {
    if (!window.clipboardAPI?.clearApiKey) return;
    
    try {
      const result = await window.clipboardAPI.clearApiKey();
      if (result.success) {
        setHasApiKey(false);
        setApiKeyInput('');
      }
    } catch (err) {
      console.error('Failed to clear API key:', err);
    }
  };
  
  // Handler for toggling continuous context enabled state
  const handleToggleContinuousContext = async (enabled: boolean) => {
    if (!window.clipboardAPI?.setContinuousContextEnabled) return;
    
    try {
      const success = await window.clipboardAPI.setContinuousContextEnabled(enabled);
      if (success) {
        setContinuousContextEnabled(enabled);
      }
    } catch (err) {
      console.error('Failed to toggle continuous context:', err);
    }
  };
  
  
  // Check Supabase auth state on mount and listen for changes.
  // When authenticated, pass session to main process for mobile sync.
  // The sign-in form is in TeamView - this just listens for session changes.
  useEffect(() => {
    // If supabase client is not available, skip auth. This can happen if
    // environment variables are missing during development.
    if (!supabase) {
      console.warn('[SettingsPanel] Supabase client not available');
      return;
    }

    // Get initial session.
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        // Pass session to main process for MobileSync.
        window.clipboardAPI?.setSyncSession?.(
          session.access_token,
          session.refresh_token
        );
      }
    });

    // Listen for auth changes (triggered by TeamView sign-in or token refresh).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        window.clipboardAPI?.setSyncSession?.(
          session.access_token,
          session.refresh_token
        );
      } else {
        window.clipboardAPI?.clearSyncSession?.();
      }
    });

    return () => subscription.unsubscribe();
  }, []);
  
  // Handle sign out.
  const handleSignOut = async () => {
    setAuthLoading(true);
    try {
      await window.authAPI?.signOut();
      if (supabase) {
        await supabase.auth.signOut();
      }
      setSyncStatus(null);
    } catch (err) {
      console.error('Sign out error:', err);
    } finally {
      setAuthLoading(false);
    }
  };
  
  // Handle manual sync trigger - syncs both transcripts and todos.
  const handleManualSync = async () => {
    setIsSyncing(true);
    setSyncStatus('Syncing...');
    
    try {
      // Sync transcripts.
      let transcriptCount = 0;
      if (window.clipboardAPI?.syncMobileTranscripts) {
        transcriptCount = await window.clipboardAPI.syncMobileTranscripts();
      }
      
      // Sync todos.
      let todoCount = 0;
      if (window.todoAPI?.syncTodos) {
        const todos = await window.todoAPI.syncTodos();
        todoCount = todos.length;
      }
      
      // Build status message.
      const parts: string[] = [];
      if (transcriptCount > 0) {
        parts.push(`${transcriptCount} transcript${transcriptCount === 1 ? '' : 's'}`);
      }
      if (todoCount > 0) {
        parts.push(`${todoCount} task${todoCount === 1 ? '' : 's'}`);
      }
      
      setSyncStatus(parts.length > 0 
        ? `Synced ${parts.join(' and ')} from iOS`
        : 'Already up to date'
      );
    } catch (err) {
      setSyncStatus('Sync failed');
      console.error('Sync error:', err);
    } finally {
      setIsSyncing(false);
    }
  };
  
  // Force full re-sync - fixes source attribution for existing items
  const handleForceSync = async () => {
    if (!window.clipboardAPI?.forceSyncAll) return;
    
    setIsSyncing(true);
    setSyncStatus('Re-syncing all transcripts...');
    
    try {
      const count = await window.clipboardAPI.forceSyncAll();
      setSyncStatus(count > 0 
        ? `Fixed attribution for ${count} transcript${count === 1 ? '' : 's'}`
        : 'All transcripts already correctly attributed'
      );
    } catch (err) {
      setSyncStatus('Re-sync failed');
      console.error('Force sync error:', err);
    } finally {
      setIsSyncing(false);
    }
  };
  
  // Helper function to build hotkey string from keyboard event (uses physical key codes)
  const buildHotkeyString = (event: KeyboardEvent): string => {
    const parts: string[] = [];
    if (event.metaKey) parts.push('Command');
    if (event.ctrlKey) parts.push('Control');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');

    // Use physical key code to avoid locale-specific characters
    let key = event.code;

    if (key.startsWith('Key')) {
      key = key.substring(3).toUpperCase();
    } else if (key.startsWith('Digit')) {
      key = key.substring(5);
    } else {
      const codeMap: Record<string, string> = {
        'Space': 'Space',
        'Backquote': '`',
        'Backslash': '\\',
        'BracketLeft': '[',
        'BracketRight': ']',
        'Comma': ',',
        'Equal': '=',
        'Minus': '-',
        'Period': '.',
        'Quote': "'",
        'Semicolon': ';',
        'Slash': '/',
        'CapsLock': 'CapsLock',
        'Escape': 'Escape',
        'Enter': 'Enter',
        'Tab': 'Tab',
        'Backspace': 'Backspace',
        'Delete': 'Delete',
        'ArrowUp': 'Up',
        'ArrowDown': 'Down',
        'ArrowLeft': 'Left',
        'ArrowRight': 'Right',
        'PageUp': 'PageUp',
        'PageDown': 'PageDown',
        'Home': 'Home',
        'End': 'End',
        'Insert': 'Insert',
        'F1': 'F1', 'F2': 'F2', 'F3': 'F3', 'F4': 'F4',
        'F5': 'F5', 'F6': 'F6', 'F7': 'F7', 'F8': 'F8',
        'F9': 'F9', 'F10': 'F10', 'F11': 'F11', 'F12': 'F12',
      };
      if (codeMap[key]) {
        key = codeMap[key];
      } else {
        const fallback = event.key;
        if (fallback && fallback.length === 1 && fallback.charCodeAt(0) < 128) {
          key = fallback.toUpperCase();
        } else {
          console.warn(`[Hotkey] Unsupported key: ${event.code} (key: ${event.key})`);
          return '';
        }
      }
    }

    if (key === 'Meta' || key === 'Control' || key === 'Alt' || key === 'Shift') {
      return '';
    }

    return parts.length > 0 ? `${parts.join('+')}+${key}` : key;
  };

  const isModifierOnly = (s: string) => {
    return s === 'Command' || s === 'Control' || s === 'Alt' || s === 'Shift';
  };
  
  // Handler for setting screenshot hotkey
  const handleSetScreenshotHotkey = useCallback(async (hotkeyString: string) => {
    setIsCapturingScreenshotHotkey(false);
    setHotkeyError(null);
    
    if (!window.clipboardAPI) return;
    
    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const success = await window.clipboardAPI.setHotkeys({ screenshot: hotkeyString });
      if (!success) {
        setHotkeyError('Failed to register screenshot hotkey. It may be in use by another application.');
      } else {
        setClipboardHotkeys(prev => ({ ...prev, screenshot: hotkeyString }));
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set screenshot hotkey');
      console.error('Failed to set screenshot hotkey:', err);
    }
  }, []);
  
  // Handler for setting history hotkey
  const handleSetHistoryHotkey = useCallback(async (hotkeyString: string) => {
    setIsCapturingHistoryHotkey(false);
    setHotkeyError(null);
    
    if (!window.clipboardAPI) return;
    
    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const success = await window.clipboardAPI.setHotkeys({ history: hotkeyString });
      if (!success) {
        setHotkeyError('Failed to register history hotkey. It may be in use by another application.');
      } else {
        setClipboardHotkeys(prev => ({ ...prev, history: hotkeyString }));
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set history hotkey');
      console.error('Failed to set history hotkey:', err);
    }
  }, []);
  
  // Handler for setting continuous context hotkey
  const handleSetContinuousContextHotkey = useCallback(async (hotkeyString: string) => {
    setIsCapturingContinuousContextHotkey(false);
    setHotkeyError(null);
    
    if (!window.clipboardAPI?.setContinuousContextHotkey) return;
    
    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const success = await window.clipboardAPI.setContinuousContextHotkey(hotkeyString);
      if (!success) {
        setHotkeyError('Failed to register continuous context hotkey. It may be in use by another application.');
      } else {
        setContinuousContextHotkey(hotkeyString);
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set continuous context hotkey');
      console.error('Failed to set continuous context hotkey:', err);
    }
  }, []);

  // Handler for setting todo hotkey
  const handleSetTodoHotkey = useCallback(async (hotkeyString: string) => {
    setIsCapturingTodoHotkey(false);
    setHotkeyError(null);
    
    if (!window.todoAPI?.setHotkey) return;
    
    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const success = await window.todoAPI.setHotkey(hotkeyString);
      if (!success) {
        setHotkeyError('Failed to register todo hotkey. It may be in use by another application.');
      } else {
        setTodoHotkey(hotkeyString);
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set todo hotkey');
      console.error('Failed to set todo hotkey:', err);
    }
  }, []);
  
  // Capture hotkey when user is setting screenshot, history, continuous context, or todo shortcut.
  useEffect(() => {
    const capturing = isCapturingScreenshotHotkey ? 'screenshot' 
      : isCapturingHistoryHotkey ? 'history' 
      : isCapturingContinuousContextHotkey ? 'continuousContext'
      : isCapturingTodoHotkey ? 'todo'
      : null;
    if (!capturing) return;
    
    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const hotkeyString = buildHotkeyString(event);
      if (hotkeyString) {
        if (capturing === 'screenshot') {
          handleSetScreenshotHotkey(hotkeyString);
        } else if (capturing === 'history') {
          handleSetHistoryHotkey(hotkeyString);
        } else if (capturing === 'continuousContext') {
          handleSetContinuousContextHotkey(hotkeyString);
        } else if (capturing === 'todo') {
          handleSetTodoHotkey(hotkeyString);
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCapturingScreenshotHotkey, isCapturingHistoryHotkey, isCapturingContinuousContextHotkey, isCapturingTodoHotkey, handleSetScreenshotHotkey, handleSetHistoryHotkey, handleSetContinuousContextHotkey, handleSetTodoHotkey]);

  // Check permissions on mount and when status changes
  useEffect(() => {
    const permissionsAPI = window.permissionsAPI;
    if (!permissionsAPI) {
      console.log('[SettingsPanel] permissionsAPI not available, assuming permissions granted');
      setPermissions({ accessibilityGranted: true });
      setShowPermissionsGate(false);
      return;
    }

    const checkPermissions = async () => {
      try {
        const status = await permissionsAPI.check();
        setPermissions(status);
        setShowPermissionsGate(!status.accessibilityGranted);
      } catch (error) {
        console.error('Failed to check permissions:', error);
        setPermissions({ accessibilityGranted: true });
        setShowPermissionsGate(false);
      }
    };

    checkPermissions();

    const unsubscribeStatus = permissionsAPI.onStatusChanged((status: { accessibilityGranted: boolean }) => {
      setPermissions(status);
      setShowPermissionsGate(!status.accessibilityGranted);
    });

    const unsubscribeRevoked = permissionsAPI.onRevoked(() => {
      setShowPermissionsGate(true);
      checkPermissions();
    });

    let pollInterval: ReturnType<typeof setInterval> | null = null;
    if (showPermissionsGate) {
      pollInterval = setInterval(() => {
        checkPermissions();
      }, 2000);
    }

    return () => {
      unsubscribeStatus?.();
      unsubscribeRevoked?.();
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [showPermissionsGate]);

  // Show loading state while checking permissions
  if (permissions === null) {
    return (
      <div style={styles.loading}>
        <div style={styles.loadingText}>Loading...</div>
      </div>
    );
  }

  // Permissions gate - show inline warning instead of blocking the whole UI
  const permissionsWarning = showPermissionsGate && permissions && !permissions.accessibilityGranted && (
    <div style={styles.permissionsWarning}>
      <div style={styles.permissionsContent}>
        <h3 style={styles.permissionsTitle}>⚠️ Accessibility Permission Required</h3>
        <p style={styles.permissionsText}>
          Oscar needs Accessibility permission to paste clipboard items.
        </p>
        <button
          onClick={() => {
            window.open('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility', '_blank');
          }}
          style={styles.permissionsButton}
        >
          Open Settings
        </button>
      </div>
    </div>
  );

  // Section header component for consistent divider styling
  const SectionHeader = ({ title }: { title: string }) => (
    <div style={styles.sectionHeader}>
      <span style={styles.sectionTitle}>{title}</span>
      <div style={styles.sectionLine} />
    </div>
  );

  return (
    <div style={styles.container}>
      {permissionsWarning}

      {/* Audio Section */}
      <div style={styles.section}>
        <SectionHeader title="Audio" />
        <AudioSettingsPanel />
      </div>

      {/* Transcription Section */}
      <div style={styles.section}>
        <SectionHeader title="Transcription" />
        <TranscriptionSettings />
      </div>

      {/* AI Features Section */}
      <div style={styles.section}>
        <SectionHeader title="AI Features" />
        
        {/* API Key Row */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Anthropic API Key</span>
          <div style={styles.rowControls}>
            {hasApiKey ? (
              <>
                <span style={{ ...styles.rowValue, color: '#10b981' }}>✓ Configured</span>
                <button onClick={handleClearApiKey} style={{ ...styles.btn, ...styles.btnDanger }}>
                  Clear
                </button>
              </>
            ) : (
              <>
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="sk-ant-..."
                  style={{ ...styles.input, fontFamily: 'monospace', width: '180px' }}
                />
                <button onClick={() => setShowApiKey(!showApiKey)} style={styles.btnGhost}>
                  {showApiKey ? 'Hide' : 'Show'}
                </button>
                <button
                  onClick={handleSaveApiKey}
                  disabled={apiKeySaving || !apiKeyInput.trim()}
                  style={{
                    ...styles.btn,
                    ...(apiKeySaving || !apiKeyInput.trim() ? {} : styles.btnSuccess),
                    opacity: apiKeySaving || !apiKeyInput.trim() ? 0.5 : 1,
                    cursor: apiKeySaving || !apiKeyInput.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {apiKeySaving ? 'Saving...' : 'Save'}
                </button>
              </>
            )}
          </div>
        </div>
        {apiKeyError && <p style={styles.error}>{apiKeyError}</p>}
        
        {/* Prompt Settings */}
        <PromptSettings />
      </div>

      {/* Keyboard Shortcuts Section */}
      <div style={styles.section}>
        <SectionHeader title="Keyboard Shortcuts" />
        
        {/* Screenshot */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Screenshot</span>
          <div style={styles.rowControls}>
            <button
              onClick={() => { setIsCapturingScreenshotHotkey(true); setHotkeyError(null); }}
              disabled={isCapturingScreenshotHotkey || isCapturingHistoryHotkey || isCapturingContinuousContextHotkey || isCapturingTodoHotkey}
              style={{ ...styles.btn, ...(isCapturingScreenshotHotkey ? styles.btnActive : {}) }}
            >
              {isCapturingScreenshotHotkey ? 'Press keys...' : clipboardHotkeys.screenshot || '⌘⇧4'}
            </button>
            {isCapturingScreenshotHotkey && (
              <button onClick={() => { setIsCapturingScreenshotHotkey(false); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
            )}
          </div>
        </div>
        
        {/* Clipboard History */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Clipboard History</span>
          <div style={styles.rowControls}>
            <button
              onClick={() => { setIsCapturingHistoryHotkey(true); setHotkeyError(null); }}
              disabled={isCapturingScreenshotHotkey || isCapturingHistoryHotkey || isCapturingContinuousContextHotkey || isCapturingTodoHotkey}
              style={{ ...styles.btn, ...(isCapturingHistoryHotkey ? styles.btnActive : {}) }}
            >
              {isCapturingHistoryHotkey ? 'Press keys...' : clipboardHotkeys.history || '⌘⇧V'}
            </button>
            {isCapturingHistoryHotkey && (
              <button onClick={() => { setIsCapturingHistoryHotkey(false); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
            )}
          </div>
        </div>
        
        {/* Continuous Context */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Continuous Context</span>
          <div style={styles.rowControls}>
            <button
              onClick={() => handleToggleContinuousContext(!continuousContextEnabled)}
              style={{ ...styles.toggle, backgroundColor: continuousContextEnabled ? '#10b981' : '#d1d5db' }}
            >
              <span style={{ ...styles.toggleKnob, transform: continuousContextEnabled ? 'translateX(20px)' : 'translateX(2px)' }} />
            </button>
            <button
              onClick={() => { setIsCapturingContinuousContextHotkey(true); setHotkeyError(null); }}
              disabled={!continuousContextEnabled || isCapturingScreenshotHotkey || isCapturingHistoryHotkey || isCapturingContinuousContextHotkey || isCapturingTodoHotkey}
              style={{ ...styles.btn, ...(isCapturingContinuousContextHotkey ? styles.btnActive : {}), opacity: continuousContextEnabled ? 1 : 0.5 }}
            >
              {isCapturingContinuousContextHotkey ? 'Press keys...' : continuousContextHotkey || '⌥⇧1'}
            </button>
            {isCapturingContinuousContextHotkey && (
              <button onClick={() => { setIsCapturingContinuousContextHotkey(false); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
            )}
          </div>
        </div>
        
        {/* Todo List */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Todo List</span>
          <div style={styles.rowControls}>
            <button
              onClick={() => { setIsCapturingTodoHotkey(true); setHotkeyError(null); }}
              disabled={isCapturingScreenshotHotkey || isCapturingHistoryHotkey || isCapturingContinuousContextHotkey || isCapturingTodoHotkey}
              style={{ ...styles.btn, ...(isCapturingTodoHotkey ? styles.btnActive : {}) }}
            >
              {isCapturingTodoHotkey ? 'Press keys...' : todoHotkey || '⌘⇧T'}
            </button>
            {isCapturingTodoHotkey && (
              <button onClick={() => { setIsCapturingTodoHotkey(false); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
            )}
          </div>
        </div>
        
        {hotkeyError && <p style={styles.error}>{hotkeyError}</p>}
      </div>

      {/* Mobile Sync Section */}
      <div style={styles.section}>
        <SectionHeader title="Mobile Sync" />
        
        {session ? (
          <>
            <div style={styles.row}>
              <div style={styles.syncUserInfo}>
                <span style={styles.syncUserIcon}>✓</span>
                <span style={styles.rowValue}>{session.user.email}</span>
              </div>
              <div style={styles.rowControls}>
                <button onClick={handleManualSync} disabled={isSyncing} style={styles.btn}>
                  {isSyncing ? 'Syncing...' : 'Sync'}
                </button>
                <button onClick={handleForceSync} disabled={isSyncing} style={styles.btn} title="Fix source attribution">
                  Fix
                </button>
                <button onClick={handleSignOut} disabled={authLoading} style={styles.btnGhost}>
                  {authLoading ? '...' : 'Sign Out'}
                </button>
              </div>
            </div>
            {syncStatus && <p style={styles.syncStatusText}>{syncStatus}</p>}
          </>
        ) : (
          // Not signed in - direct user to Team tab.
          <div style={styles.row}>
            <span style={{ ...styles.rowValue, color: theme.textSecondary }}>
              Sign in via the Team tab to enable mobile sync.
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// Styles consistent with ClipboardHistory styling
const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '16px',
    overflowY: 'auto',
    height: '100%',
    boxSizing: 'border-box',
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  loadingText: {
    color: '#6b7280',
    fontSize: '13px',
  },
  
  // ==========================================================================
  // NEW UNIFIED DESIGN SYSTEM - Only 2 font sizes: 13px body, 11px headers
  // ==========================================================================
  
  title: {
    fontSize: '13px',
    fontWeight: 600,
    marginTop: 0,
    marginBottom: '24px',
    color: '#111827',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  
  // Section with divider line
  section: {
    marginBottom: '20px',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '8px',
  },
  sectionTitle: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#9ca3af',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    whiteSpace: 'nowrap' as const,
  },
  sectionLine: {
    flex: 1,
    height: '1px',
    backgroundColor: '#e5e7eb',
  },
  
  // Flat row layout: label left, control right
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '4px 0',
    minHeight: '32px',
  },
  rowLabel: {
    fontSize: '13px',
    color: '#374151',
    fontWeight: 400,
  },
  rowValue: {
    fontSize: '13px',
    color: '#111827',
    fontWeight: 500,
  },
  rowControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  
  // Unified button styles
  btn: {
    padding: '6px 12px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#374151',
    backgroundColor: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
    minWidth: '80px',
    textAlign: 'center' as const,
  },
  btnActive: {
    backgroundColor: '#3b82f6',
    color: '#fff',
    borderColor: '#3b82f6',
  },
  btnDanger: {
    color: '#dc2626',
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
  },
  btnSuccess: {
    color: '#fff',
    backgroundColor: '#10b981',
    borderColor: '#10b981',
  },
  btnGhost: {
    backgroundColor: 'transparent',
    border: 'none',
    color: '#6b7280',
    minWidth: 'auto',
    padding: '6px 8px',
  },
  
  // Toggle switch
  toggle: {
    position: 'relative' as const,
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
  },
  toggleKnob: {
    position: 'absolute' as const,
    top: '2px',
    left: 0,
    width: '20px',
    height: '20px',
    borderRadius: '10px',
    backgroundColor: '#fff',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    transition: 'transform 0.2s',
  },
  
  // Select dropdown
  select: {
    padding: '6px 12px',
    fontSize: '13px',
    color: '#374151',
    backgroundColor: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
    minWidth: '160px',
  },
  
  // Input field
  input: {
    padding: '6px 12px',
    fontSize: '13px',
    color: '#111827',
    backgroundColor: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    outline: 'none',
    flex: 1,
  },
  
  // Status indicators
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    display: 'inline-block',
    marginRight: '6px',
  },
  statusGreen: { backgroundColor: '#22c55e' },
  statusYellow: { backgroundColor: '#f59e0b' },
  statusRed: { backgroundColor: '#ef4444' },
  statusGray: { backgroundColor: '#9ca3af' },
  
  // Error text
  error: {
    fontSize: '13px',
    color: '#ef4444',
    marginTop: '4px',
  },
  
  // Model list (compact)
  modelRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 0',
    borderBottom: '1px solid #f3f4f6',
  },
  modelName: {
    fontSize: '13px',
    color: '#374151',
  },
  modelSize: {
    fontSize: '13px',
    color: '#9ca3af',
    marginLeft: '8px',
  },
  
  // Permissions warning (compact)
  permissionsWarning: {
    backgroundColor: '#fffbeb',
    border: '1px solid #f59e0b',
    borderRadius: '6px',
    padding: '12px',
    marginBottom: '20px',
  },
  permissionsContent: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  permissionsText: {
    fontSize: '13px',
    color: '#92400e',
    margin: 0,
  },
  permissionsButton: {
    padding: '6px 12px',
    backgroundColor: '#f59e0b',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
  },
  
  // Mobile sync (logged in state)
  syncUserInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  syncUserIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '18px',
    height: '18px',
    backgroundColor: '#10b981',
    color: '#fff',
    borderRadius: '50%',
    fontSize: '10px',
    fontWeight: 600,
  },
  
  // Login form (compact)
  loginForm: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  },
  
  // Legacy compatibility - keeping for nested components
  hotkeyCard: {
    padding: 0,
  },
  hotkeyRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 0',
    minHeight: '36px',
  },
  hotkeyLabel: {
    fontSize: '13px',
    color: '#374151',
  },
  hotkeyButtonRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  hotkeyButton: {
    padding: '6px 12px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#374151',
    backgroundColor: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  hotkeyButtonActive: {
    backgroundColor: '#3b82f6',
    color: '#fff',
    borderColor: '#3b82f6',
  },
  cancelButton: {
    padding: '6px 8px',
    fontSize: '13px',
    color: '#6b7280',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
  },
  hotkeyError: {
    fontSize: '13px',
    color: '#ef4444',
    marginTop: '4px',
  },
  loginInput: {
    padding: '8px 12px',
    fontSize: '13px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  loginButton: {
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#fff',
    backgroundColor: '#007AFF',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  signOutButton: {
    padding: '6px 12px',
    fontSize: '13px',
    color: '#6b7280',
    backgroundColor: 'transparent',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  syncControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  syncButton: {
    padding: '6px 12px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#374151',
    backgroundColor: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  fixButton: {
    padding: '6px 12px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#6b7280',
    backgroundColor: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  syncStatusText: {
    fontSize: '13px',
    color: '#6b7280',
    marginTop: '4px',
  },
  sectionDescription: {
    display: 'none', // Hide verbose descriptions in new design
  },
  hotkeyTitle: {
    display: 'none', // Hide nested titles in new design
  },
  hotkeyHelp: {
    display: 'none', // Hide help text in new design
  },
};
