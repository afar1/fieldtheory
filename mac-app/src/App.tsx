import { useEffect, useState, useRef, useCallback } from 'react';
import AudioSettingsPanel from './components/AudioSettingsPanel';
import TranscriptionSettings from './components/TranscriptionSettings';

export default function App() {
  const [darkMode, setDarkMode] = useState(() => {
    // Load dark mode preference from localStorage
    const saved = localStorage.getItem('darkMode');
    return saved === 'true';
  });
  
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
  
  // Load clipboard hotkeys on mount
  useEffect(() => {
    if (window.clipboardAPI) {
      window.clipboardAPI.getHotkeys().then(hotkeys => {
        setClipboardHotkeys(hotkeys);
      });
    }
  }, []);
  
  // Helper function to build hotkey string from keyboard event (uses physical key codes)
  const buildHotkeyString = (event: KeyboardEvent): string => {
    const parts: string[] = [];
    if (event.metaKey) parts.push('Command');
    if (event.ctrlKey) parts.push('Control');
    if (event.altKey) parts.push('Alt');
    if (event.shiftKey) parts.push('Shift');

    // Use physical key code to avoid locale-specific characters (e.g., Alt+¡)
    let key = event.code;

    if (key.startsWith('Key')) {
      key = key.substring(3).toUpperCase(); // KeyA -> A
    } else if (key.startsWith('Digit')) {
      key = key.substring(5); // Digit1 -> 1
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
        // Fallback only for single ASCII characters
        const fallback = event.key;
        if (fallback && fallback.length === 1 && fallback.charCodeAt(0) < 128) {
          key = fallback.toUpperCase();
        } else {
          console.warn(`[Hotkey] Unsupported key: ${event.code} (key: ${event.key})`);
          return '';
        }
      }
    }

    // If only a modifier was pressed, return empty to indicate invalid
    if (key === 'Meta' || key === 'Control' || key === 'Alt' || key === 'Shift') {
      return '';
    }

    return parts.length > 0 ? `${parts.join('+')}+${key}` : key;
  };

  // Utility: detect modifier-only strings
  const isModifierOnly = (s: string) => {
    return s === 'Command' || s === 'Control' || s === 'Alt' || s === 'Shift';
  };
  
  // Handler for setting screenshot hotkey
  const handleSetScreenshotHotkey = useCallback(async (hotkeyString: string) => {
    setIsCapturingScreenshotHotkey(false);
    setHotkeyError(null);
    
    if (!window.clipboardAPI) return;
    
    // Guard invalid or modifier-only strings
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
    
    // Guard invalid or modifier-only strings
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
  
  // Capture hotkey when user is setting screenshot or history shortcut.
  useEffect(() => {
    const capturing = isCapturingScreenshotHotkey ? 'screenshot' : isCapturingHistoryHotkey ? 'history' : null;
    if (!capturing) return;
    
    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const hotkeyString = buildHotkeyString(event);
      if (hotkeyString) {
        capturing === 'screenshot' ? handleSetScreenshotHotkey(hotkeyString) : handleSetHistoryHotkey(hotkeyString);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCapturingScreenshotHotkey, isCapturingHistoryHotkey, handleSetScreenshotHotkey, handleSetHistoryHotkey]);

  // Check permissions on mount and when status changes
  useEffect(() => {
    const permissionsAPI = window.permissionsAPI;
    if (!permissionsAPI) {
      // If permissionsAPI is not available (e.g., in browser), assume permissions are granted
      console.log('[App] permissionsAPI not available, assuming permissions granted');
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
        // On error, assume permissions granted to avoid blocking UI
        setPermissions({ accessibilityGranted: true });
        setShowPermissionsGate(false);
      }
    };

    checkPermissions();

    // Listen for permission status changes
    const unsubscribeStatus = permissionsAPI.onStatusChanged((status: { accessibilityGranted: boolean }) => {
      setPermissions(status);
      setShowPermissionsGate(!status.accessibilityGranted);
    });

    // Listen for permission revocation
    const unsubscribeRevoked = permissionsAPI.onRevoked(() => {
      setShowPermissionsGate(true);
      checkPermissions();
    });

    // Poll for permission changes every 2 seconds while gate is visible
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

  // Permissions gate UI - blocks app until permissions are granted
  // Show loading state while checking permissions
  if (permissions === null) {
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: darkMode ? '#1a1a1a' : '#f5f5f5',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}>
        <div style={{ color: darkMode ? '#e5e5e5' : '#111' }}>Loading...</div>
      </div>
    );
  }

  if (showPermissionsGate && permissions) {
    const openAccessibility = () => {
      // Deep link to Accessibility settings
      window.open('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility', '_blank');
    };

    const handleRecheck = async () => {
      if (window.permissionsAPI) {
        try {
          const status = await window.permissionsAPI.check();
          setPermissions(status);
          setShowPermissionsGate(!status.accessibilityGranted);
        } catch (error) {
          console.error('Failed to recheck permissions:', error);
        }
      }
    };

    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        zIndex: 10000,
      }}>
        <div style={{
          maxWidth: '600px',
          padding: '40px',
          textAlign: 'center',
        }}>
          <h1 style={{ fontSize: '24px', fontWeight: '600', marginBottom: '16px' }}>
            Permissions Required
          </h1>
          <p style={{ fontSize: '16px', color: '#666', marginBottom: '32px', lineHeight: '1.5' }}>
            Oscar needs Accessibility permission to paste clipboard items:
          </p>

          <div style={{ marginBottom: '24px', textAlign: 'left' }}>
            <div style={{
              padding: '16px',
              backgroundColor: permissions.accessibilityGranted ? '#e8f5e9' : '#fff3e0',
              borderRadius: '8px',
              marginBottom: '12px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h3 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '4px' }}>
                    Accessibility
                  </h3>
                  <p style={{ fontSize: '14px', color: '#666' }}>
                    Required for pasting clipboard items
                  </p>
                </div>
                {permissions.accessibilityGranted ? (
                  <span style={{ color: '#4caf50', fontSize: '14px', fontWeight: '600' }}>✓ Granted</span>
                ) : (
                  <button
                    onClick={openAccessibility}
                    style={{
                      padding: '8px 16px',
                      backgroundColor: '#007AFF',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '14px',
                    }}
                  >
                    Open Settings
                  </button>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
            <button
              onClick={handleRecheck}
              style={{
                padding: '12px 24px',
                backgroundColor: '#f0f0f0',
                color: '#333',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500',
              }}
            >
              Recheck Permissions
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Draggable region for window movement */}
      <div style={styles.draggableRegion}></div>
      <div 
        style={{
          ...styles.root,
          backgroundColor: darkMode ? '#1a1a1a' : '#f5f5f5',
          color: darkMode ? '#e5e5e5' : '#111',
        }}
      >
        <div style={{
          ...styles.settingsContent,
          backgroundColor: darkMode ? '#2d2d2d' : '#fff',
          color: darkMode ? '#e5e5e5' : '#111',
        }}>
          <h2 style={styles.settingsTitle}>Settings</h2>

          <div style={styles.settingsSection}>
            <h3 style={styles.sectionTitle}>Audio</h3>
            <AudioSettingsPanel />
          </div>

          <div style={styles.settingsSection}>
            <h3 style={styles.sectionTitle}>Transcription</h3>
            <TranscriptionSettings />
          </div>

          <div style={styles.settingsSection}>
            <h3 style={styles.sectionTitle}>Clipboard History</h3>
            <p style={{
              fontSize: '13px',
              color: darkMode ? '#9ca3af' : '#6b7280',
              marginBottom: '16px',
              marginTop: '4px',
            }}>
              Configure hotkeys for clipboard history features.
            </p>
            
            <div style={{
              padding: '16px',
              borderRadius: '8px',
              backgroundColor: darkMode ? '#1a1a1a' : '#f9fafb',
              border: `1px solid ${darkMode ? '#404040' : '#e5e7eb'}`,
            }}>
              <h4 style={{
                marginTop: 0,
                marginBottom: '12px',
                fontSize: '14px',
                fontWeight: 600,
                color: darkMode ? '#e5e5e5' : '#374151',
              }}>
                Hotkey Configuration
              </h4>
              
              {/* Screenshot Hotkey */}
              <div style={{ marginBottom: '12px' }}>
                <label style={{
                  display: 'block',
                  marginBottom: '6px',
                  fontSize: '13px',
                  color: darkMode ? '#d1d5db' : '#6b7280',
                }}>
                  Screenshot Hotkey
                </label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    onClick={() => {
                      setIsCapturingScreenshotHotkey(true);
                      setHotkeyError(null);
                    }}
                    disabled={isCapturingScreenshotHotkey || isCapturingHistoryHotkey}
                    style={{
                      padding: '6px 12px',
                      fontSize: '12px',
                      fontWeight: 500,
                      color: isCapturingScreenshotHotkey ? '#fff' : (darkMode ? '#e5e5e5' : '#374151'),
                      backgroundColor: isCapturingScreenshotHotkey ? '#3b82f6' : (darkMode ? '#2d2d2d' : '#fff'),
                      border: `1px solid ${darkMode ? '#404040' : '#d1d5db'}`,
                      borderRadius: '6px',
                      cursor: isCapturingScreenshotHotkey || isCapturingHistoryHotkey ? 'not-allowed' : 'pointer',
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
                      style={{
                        padding: '6px 12px',
                        fontSize: '12px',
                        color: darkMode ? '#9ca3af' : '#6b7280',
                        backgroundColor: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
              
              {/* History Hotkey */}
              <div style={{ marginBottom: '12px' }}>
                <label style={{
                  display: 'block',
                  marginBottom: '6px',
                  fontSize: '13px',
                  color: darkMode ? '#d1d5db' : '#6b7280',
                }}>
                  History Hotkey
                </label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    onClick={() => {
                      setIsCapturingHistoryHotkey(true);
                      setHotkeyError(null);
                    }}
                    disabled={isCapturingScreenshotHotkey || isCapturingHistoryHotkey}
                    style={{
                      padding: '6px 12px',
                      fontSize: '12px',
                      fontWeight: 500,
                      color: isCapturingHistoryHotkey ? '#fff' : (darkMode ? '#e5e5e5' : '#374151'),
                      backgroundColor: isCapturingHistoryHotkey ? '#3b82f6' : (darkMode ? '#2d2d2d' : '#fff'),
                      border: `1px solid ${darkMode ? '#404040' : '#d1d5db'}`,
                      borderRadius: '6px',
                      cursor: isCapturingScreenshotHotkey || isCapturingHistoryHotkey ? 'not-allowed' : 'pointer',
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
                      style={{
                        padding: '6px 12px',
                        fontSize: '12px',
                        color: darkMode ? '#9ca3af' : '#6b7280',
                        backgroundColor: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
              
              {hotkeyError && (
                <p style={{
                  marginTop: '8px',
                  fontSize: '12px',
                  color: '#ef4444',
                }}>
                  {hotkeyError}
                </p>
              )}
              
              <p style={{
                marginTop: '12px',
                marginBottom: 0,
                fontSize: '11px',
                color: darkMode ? '#9ca3af' : '#6b7280',
                lineHeight: '1.5',
              }}>
                Supports 2-3 modifier keys + primary key (e.g., Command+Shift+Control+Space). Screenshot hotkey captures selected area and adds to prompt stack.
              </p>
            </div>
          </div>
        </div>

        {/* Dark mode toggle button */}
        <div style={styles.bottomButtons}>
          <button
            style={{
              ...styles.settingsButton,
              backgroundColor: darkMode ? '#374151' : '#fff',
              color: darkMode ? '#fff' : '#6b7280',
              borderColor: darkMode ? '#374151' : '#e5e7eb',
            }}
            onClick={() => {
              const newDarkMode = !darkMode;
              setDarkMode(newDarkMode);
              localStorage.setItem('darkMode', String(newDarkMode));
            }}
            title={darkMode ? 'Light mode' : 'Dark mode'}
          >
            {darkMode ? '☀️' : '🌙'}
          </button>
        </div>
      </div>
    </>
  );
}

const styles: Record<string, React.CSSProperties & { WebkitAppRegion?: string }> = {
  draggableRegion: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    height: '44px', // Standard macOS title bar height
    WebkitAppRegion: 'drag',
    zIndex: 1000,
    pointerEvents: 'auto',
  },
  root: {
    minHeight: '100vh',
    padding: '20px',
    paddingTop: '64px', // Add padding to account for draggable region
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    backgroundColor: '#f5f5f5',
    width: '100%',
    boxSizing: 'border-box',
    overflowX: 'hidden',
  },
  settingsContent: {
    backgroundColor: '#fff',
    borderRadius: '10px',
    padding: '20px',
    width: '90%',
    maxWidth: '800px',
    minWidth: 'min(320px, 90vw)',
    maxHeight: 'min(80vh, 700px)',
    overflow: 'auto',
    boxShadow: '0 10px 25px rgba(15, 23, 42, 0.15)',
  },
  settingsTitle: {
    fontSize: '18px',
    fontWeight: 400,
    marginBottom: '24px',
    color: '#111',
  },
  settingsSection: {
    marginBottom: '32px',
  },
  sectionTitle: {
    fontSize: '13px',
    fontWeight: 400,
    color: '#374151',
    marginBottom: '12px',
  },
  bottomButtons: {
    position: 'fixed',
    bottom: '16px',
    left: '16px',
    display: 'flex',
    gap: '8px',
    zIndex: 100,
  },
  settingsButton: {
    padding: '6px 10px',
    fontSize: '14px',
    fontWeight: 400,
    color: '#6b7280',
    backgroundColor: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
  },
};
