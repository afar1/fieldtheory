// =============================================================================
// SettingsPanel - Consolidated settings UI for the clipboard history window.
// Shows audio, transcription, vision, and clipboard settings in one view.
// Styled consistently with the clipboard history window's design language.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import AudioSettingsPanel from './AudioSettingsPanel';
import TranscriptionSettings from './TranscriptionSettings';
import VisionSettings from './VisionSettings';
import { supabase } from '../supabaseClient';
import type { Session } from '@supabase/supabase-js';

/**
 * SettingsPanel - Settings content designed to live inside the clipboard history window.
 * Keeps the same functionality as the original App.tsx settings, but styled for the
 * clipboard history context.
 */
export default function SettingsPanel() {
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
  
  // Mobile sync state - for syncing iOS transcriptions to clipboard history
  const [session, setSession] = useState<Session | null>(null);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
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
  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        // Pass session to main process for MobileSync
        window.clipboardAPI?.setSyncSession?.(
          session.access_token,
          session.refresh_token
        );
      }
    });

    // Listen for auth changes
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
  
  // Handle email/password login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);
    
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password: authPassword,
      });
      
      if (error) {
        setAuthError(error.message);
      } else {
        // Clear form on success
        setAuthEmail('');
        setAuthPassword('');
        setSyncStatus('Logged in! Syncing transcripts...');
        // Trigger initial sync
        handleManualSync();
      }
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setAuthLoading(false);
    }
  };
  
  // Handle sign out
  const handleSignOut = async () => {
    setAuthLoading(true);
    try {
      await supabase.auth.signOut();
      setSyncStatus(null);
    } catch (err) {
      console.error('Sign out error:', err);
    } finally {
      setAuthLoading(false);
    }
  };
  
  // Handle manual sync trigger
  const handleManualSync = async () => {
    if (!window.clipboardAPI?.syncMobileTranscripts) return;
    
    setIsSyncing(true);
    setSyncStatus('Syncing...');
    
    try {
      const count = await window.clipboardAPI.syncMobileTranscripts();
      setSyncStatus(count > 0 
        ? `Synced ${count} new transcript${count === 1 ? '' : 's'} from iOS`
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
  
  // Capture hotkey when user is setting screenshot, history, or continuous context shortcut.
  useEffect(() => {
    const capturing = isCapturingScreenshotHotkey ? 'screenshot' 
      : isCapturingHistoryHotkey ? 'history' 
      : isCapturingContinuousContextHotkey ? 'continuousContext' 
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
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCapturingScreenshotHotkey, isCapturingHistoryHotkey, isCapturingContinuousContextHotkey, handleSetScreenshotHotkey, handleSetHistoryHotkey, handleSetContinuousContextHotkey]);

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

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Settings</h2>

      {permissionsWarning}

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Audio</h3>
        <AudioSettingsPanel />
      </div>

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Transcription</h3>
        <TranscriptionSettings />
      </div>

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Vision</h3>
        <VisionSettings />
      </div>

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>AI Features</h3>
        <p style={styles.sectionDescription}>
          Configure API keys for AI-powered features like the Engineer prompt refinement.
        </p>
        
        <div style={styles.hotkeyCard}>
          <h4 style={styles.hotkeyTitle}>Anthropic API Key</h4>
          <p style={{ fontSize: '12px', color: '#6b7280', marginBottom: '12px' }}>
            Required for the Engineer feature. Your key is stored securely in the system keychain.
          </p>
          
          {hasApiKey ? (
            <div style={styles.hotkeyRow}>
              <div>
                <span style={{ color: '#10b981', fontWeight: 500 }}>✓ API Key Configured</span>
                <p style={{ fontSize: '11px', color: '#6b7280', margin: '2px 0 0 0' }}>
                  Engineer feature is ready to use
                </p>
              </div>
              <button
                onClick={handleClearApiKey}
                style={{
                  ...styles.cancelButton,
                  backgroundColor: '#fef2f2',
                  color: '#dc2626',
                  borderColor: '#fecaca',
                }}
              >
                Remove Key
              </button>
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="sk-ant-..."
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    fontSize: '13px',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    fontFamily: 'monospace',
                  }}
                />
                <button
                  onClick={() => setShowApiKey(!showApiKey)}
                  style={{
                    padding: '8px 12px',
                    fontSize: '12px',
                    color: '#374151',
                    backgroundColor: '#f9fafb',
                    border: '1px solid #d1d5db',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  {showApiKey ? 'Hide' : 'Show'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  onClick={handleSaveApiKey}
                  disabled={apiKeySaving || !apiKeyInput.trim()}
                  style={{
                    padding: '8px 16px',
                    fontSize: '12px',
                    fontWeight: 500,
                    color: '#fff',
                    backgroundColor: apiKeySaving || !apiKeyInput.trim() ? '#9ca3af' : '#3b82f6',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: apiKeySaving || !apiKeyInput.trim() ? 'not-allowed' : 'pointer',
                  }}
                >
                  {apiKeySaving ? 'Saving...' : 'Save API Key'}
                </button>
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: '12px', color: '#3b82f6' }}
                >
                  Get an API key →
                </a>
              </div>
              {apiKeyError && (
                <p style={{ color: '#dc2626', fontSize: '12px', marginTop: '8px' }}>
                  {apiKeyError}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>Clipboard History</h3>
        <p style={styles.sectionDescription}>
          Configure hotkeys for clipboard history features.
        </p>
        
        <div style={styles.hotkeyCard}>
          <h4 style={styles.hotkeyTitle}>Hotkey Configuration</h4>
          
          {/* Screenshot Hotkey */}
          <div style={styles.hotkeyRow}>
            <label style={styles.hotkeyLabel}>Screenshot Hotkey</label>
            <div style={styles.hotkeyButtonRow}>
              <button
                onClick={() => {
                  setIsCapturingScreenshotHotkey(true);
                  setHotkeyError(null);
                }}
                disabled={isCapturingScreenshotHotkey || isCapturingHistoryHotkey || isCapturingContinuousContextHotkey}
                style={{
                  ...styles.hotkeyButton,
                  ...(isCapturingScreenshotHotkey ? styles.hotkeyButtonActive : {}),
                }}
              >
                {isCapturingScreenshotHotkey ? 'Press key combination...' : `Change (${clipboardHotkeys.screenshot || 'Not set'})`}
              </button>
              {isCapturingScreenshotHotkey && (
                <button
                  onClick={() => {
                    setIsCapturingScreenshotHotkey(false);
                    setHotkeyError(null);
                  }}
                  style={styles.cancelButton}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
          
          {/* History Hotkey */}
          <div style={styles.hotkeyRow}>
            <label style={styles.hotkeyLabel}>History Hotkey</label>
            <div style={styles.hotkeyButtonRow}>
              <button
                onClick={() => {
                  setIsCapturingHistoryHotkey(true);
                  setHotkeyError(null);
                }}
                disabled={isCapturingScreenshotHotkey || isCapturingHistoryHotkey || isCapturingContinuousContextHotkey}
                style={{
                  ...styles.hotkeyButton,
                  ...(isCapturingHistoryHotkey ? styles.hotkeyButtonActive : {}),
                }}
              >
                {isCapturingHistoryHotkey ? 'Press key combination...' : `Change (${clipboardHotkeys.history || 'Not set'})`}
              </button>
              {isCapturingHistoryHotkey && (
                <button
                  onClick={() => {
                    setIsCapturingHistoryHotkey(false);
                    setHotkeyError(null);
                  }}
                  style={styles.cancelButton}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
          
          {/* Continuous Context Enable/Disable */}
          <div style={styles.hotkeyRow}>
            <div>
              <label style={styles.hotkeyLabel}>Continuous Context Mode</label>
              <p style={{ fontSize: '11px', color: '#6b7280', margin: '2px 0 0 0' }}>
                Take multiple screenshots in a row, grouped together
              </p>
            </div>
            <button
              onClick={() => handleToggleContinuousContext(!continuousContextEnabled)}
              style={{
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 500,
                color: continuousContextEnabled ? '#fff' : '#374151',
                backgroundColor: continuousContextEnabled ? '#10b981' : '#fff',
                border: `1px solid ${continuousContextEnabled ? '#10b981' : '#d1d5db'}`,
                borderRadius: '6px',
                cursor: 'pointer',
                minWidth: '50px',
              }}
            >
              {continuousContextEnabled ? 'On' : 'Off'}
            </button>
          </div>
          
          {/* Continuous Context Hotkey */}
          <div style={{ ...styles.hotkeyRow, opacity: continuousContextEnabled ? 1 : 0.5 }}>
            <label style={styles.hotkeyLabel}>Continuous Context Hotkey</label>
            <div style={styles.hotkeyButtonRow}>
              <button
                onClick={() => {
                  setIsCapturingContinuousContextHotkey(true);
                  setHotkeyError(null);
                }}
                disabled={!continuousContextEnabled || isCapturingScreenshotHotkey || isCapturingHistoryHotkey || isCapturingContinuousContextHotkey}
                style={{
                  ...styles.hotkeyButton,
                  ...(isCapturingContinuousContextHotkey ? styles.hotkeyButtonActive : {}),
                  cursor: continuousContextEnabled ? 'pointer' : 'not-allowed',
                }}
              >
                {isCapturingContinuousContextHotkey ? 'Press key combination...' : `Change (${continuousContextHotkey || 'Not set'})`}
              </button>
              {isCapturingContinuousContextHotkey && (
                <button
                  onClick={() => {
                    setIsCapturingContinuousContextHotkey(false);
                    setHotkeyError(null);
                  }}
                  style={styles.cancelButton}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
          
          {hotkeyError && (
            <p style={styles.hotkeyError}>{hotkeyError}</p>
          )}
          
          <p style={styles.hotkeyHelp}>
            Supports 2-3 modifier keys + primary key (e.g., Command+Shift+Control+Space). 
            Screenshot hotkey captures selected area and adds to prompt stack.
            Continuous Context hotkey starts multi-screenshot capture mode (press Escape to stop).
          </p>
        </div>
      </div>

      {/* Mobile Sync Section - Sync iOS transcriptions to clipboard history */}
      <div style={styles.section}>
        <h3 style={styles.sectionTitle}>📱 Mobile Sync</h3>
        <p style={styles.sectionDescription}>
          Sync transcriptions from your iOS device to this Mac's clipboard history.
        </p>
        
        <div style={styles.hotkeyCard}>
          {session ? (
            // Logged in state - show user info and sync controls
            <>
              <div style={styles.syncUserInfo}>
                <div style={styles.syncUserEmail}>
                  <span style={styles.syncUserIcon}>✓</span>
                  {session.user.email}
                </div>
                <button
                  onClick={handleSignOut}
                  disabled={authLoading}
                  style={styles.signOutButton}
                >
                  {authLoading ? 'Signing out...' : 'Sign Out'}
                </button>
              </div>
              
              <div style={styles.syncControls}>
                <button
                  onClick={handleManualSync}
                  disabled={isSyncing}
                  style={styles.syncButton}
                >
                  {isSyncing ? 'Syncing...' : '🔄 Sync Now'}
                </button>
                <button
                  onClick={handleForceSync}
                  disabled={isSyncing}
                  style={styles.fixButton}
                  title="Re-sync all transcripts and fix source attribution"
                >
                  🔧 Fix Attribution
                </button>
              </div>
              {syncStatus && (
                <div style={styles.syncStatusText}>{syncStatus}</div>
              )}
              
              <p style={styles.hotkeyHelp}>
                iOS transcriptions sync automatically every 30 seconds. 
                Use "Fix Attribution" if iOS items show as Mac.
              </p>
            </>
          ) : (
            // Logged out state - show login form
            <>
              <h4 style={styles.hotkeyTitle}>Sign in to sync</h4>
              <p style={{ ...styles.hotkeyHelp, marginTop: 0, marginBottom: '12px' }}>
                Use the same account as your iOS app to sync transcriptions.
              </p>
              
              <form onSubmit={handleLogin} style={styles.loginForm}>
                <input
                  type="email"
                  placeholder="Email"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  disabled={authLoading}
                  style={styles.loginInput}
                  required
                />
                <input
                  type="password"
                  placeholder="Password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  disabled={authLoading}
                  style={styles.loginInput}
                  required
                />
                {authError && (
                  <p style={styles.hotkeyError}>{authError}</p>
                )}
                <button
                  type="submit"
                  disabled={authLoading || !authEmail || !authPassword}
                  style={styles.loginButton}
                >
                  {authLoading ? 'Signing in...' : 'Sign In'}
                </button>
              </form>
            </>
          )}
        </div>
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
    color: '#666',
    fontSize: '13px',
  },
  title: {
    fontSize: '18px',
    fontWeight: 600,
    marginTop: 0,
    marginBottom: '20px',
    color: '#111',
  },
  section: {
    marginBottom: '24px',
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: '#374151',
    marginTop: 0,
    marginBottom: '12px',
  },
  sectionDescription: {
    fontSize: '13px',
    color: '#6b7280',
    marginTop: 0,
    marginBottom: '12px',
  },
  permissionsWarning: {
    backgroundColor: '#fff3e0',
    border: '1px solid #ff9800',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '20px',
  },
  permissionsContent: {
    textAlign: 'center',
  },
  permissionsTitle: {
    fontSize: '14px',
    fontWeight: 600,
    marginTop: 0,
    marginBottom: '8px',
    color: '#e65100',
  },
  permissionsText: {
    fontSize: '13px',
    color: '#666',
    marginBottom: '12px',
  },
  permissionsButton: {
    padding: '8px 16px',
    backgroundColor: '#007AFF',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 500,
  },
  hotkeyCard: {
    padding: '16px',
    borderRadius: '8px',
    backgroundColor: '#f9fafb',
    border: '1px solid #e5e7eb',
  },
  hotkeyTitle: {
    marginTop: 0,
    marginBottom: '16px',
    fontSize: '14px',
    fontWeight: 600,
    color: '#374151',
  },
  hotkeyRow: {
    marginBottom: '12px',
  },
  hotkeyLabel: {
    display: 'block',
    marginBottom: '6px',
    fontSize: '13px',
    color: '#6b7280',
  },
  hotkeyButtonRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  hotkeyButton: {
    padding: '6px 12px',
    fontSize: '12px',
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
    padding: '6px 12px',
    fontSize: '12px',
    color: '#6b7280',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
  },
  hotkeyError: {
    marginTop: '8px',
    marginBottom: 0,
    fontSize: '12px',
    color: '#ef4444',
  },
  hotkeyHelp: {
    marginTop: '12px',
    marginBottom: 0,
    fontSize: '11px',
    color: '#6b7280',
    lineHeight: '1.5',
  },
  // Mobile sync styles
  loginForm: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '10px',
  },
  loginInput: {
    padding: '10px 12px',
    fontSize: '13px',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  loginButton: {
    padding: '10px 16px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#fff',
    backgroundColor: '#007AFF',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    marginTop: '4px',
  },
  syncUserInfo: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: '16px',
  },
  syncUserEmail: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#374151',
  },
  syncUserIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '20px',
    height: '20px',
    backgroundColor: '#10b981',
    color: '#fff',
    borderRadius: '50%',
    fontSize: '11px',
    fontWeight: 600,
  },
  signOutButton: {
    padding: '6px 12px',
    fontSize: '12px',
    color: '#6b7280',
    backgroundColor: 'transparent',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  syncControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '12px',
  },
  syncButton: {
    padding: '8px 14px',
    fontSize: '12px',
    fontWeight: 500,
    color: '#374151',
    backgroundColor: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  fixButton: {
    padding: '8px 14px',
    fontSize: '12px',
    fontWeight: 500,
    color: '#6b7280',
    backgroundColor: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  syncStatusText: {
    fontSize: '12px',
    color: '#6b7280',
    marginTop: '8px',
  },
};
