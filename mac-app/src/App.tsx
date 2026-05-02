import { useEffect, useState, useRef, useCallback } from 'react';
import AudioSettingsPanel from './components/AudioSettingsPanel';
import TranscriptionSettings from './components/TranscriptionSettings';
import CommandsSettings from './components/CommandsSettings';
import { buildHotkeyString, isModifierOnly } from './utils/hotkeys';

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
  
  // Continuous Context feature settings
  const [continuousContextEnabled, setContinuousContextEnabled] = useState(false);
  const [continuousContextHotkey, setContinuousContextHotkey] = useState('Shift+Command+4');
  const [isCapturingContinuousContextHotkey, setIsCapturingContinuousContextHotkey] = useState(false);
  const [continuousContextState, setContinuousContextState] = useState<{ active: boolean; stackId: string | null; screenshotCount: number }>({
    active: false,
    stackId: null,
    screenshotCount: 0,
  });
  
  
  // Load clipboard hotkeys on mount
  useEffect(() => {
    if (window.clipboardAPI) {
      window.clipboardAPI.getHotkeys().then(hotkeys => {
        setClipboardHotkeys(hotkeys);
      });
    }
  }, []);
  
  // Load continuous context settings on mount and listen for state changes
  useEffect(() => {
    if (!window.clipboardAPI) return;
    
    // Load initial settings
    window.clipboardAPI.getContinuousContextEnabled?.().then(enabled => {
      setContinuousContextEnabled(enabled);
    });
    window.clipboardAPI.getContinuousContextHotkey?.().then(hotkey => {
      setContinuousContextHotkey(hotkey);
    });
    window.clipboardAPI.getContinuousContextState?.().then(state => {
      setContinuousContextState(state);
    });
    
    // Listen for state changes
    const unsubscribe = window.clipboardAPI.onContinuousContextChanged?.((state) => {
      setContinuousContextState(state);
    });
    
    return () => {
      unsubscribe?.();
    };
  }, []);
  
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
  
  // Handler for setting continuous context hotkey
  const handleSetContinuousContextHotkey = useCallback(async (hotkeyString: string) => {
    setIsCapturingContinuousContextHotkey(false);
    setHotkeyError(null);
    
    if (!window.clipboardAPI) return;
    
    // Guard invalid or modifier-only strings
    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const success = await window.clipboardAPI.setContinuousContextHotkey?.(hotkeyString);
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
  
  // Handler for toggling continuous context feature
  const handleToggleContinuousContext = useCallback(async (enabled: boolean) => {
    if (!window.clipboardAPI) return;
    
    try {
      const success = await window.clipboardAPI.setContinuousContextEnabled?.(enabled);
      if (success) {
        setContinuousContextEnabled(enabled);
      }
    } catch (err) {
      console.error('Failed to toggle continuous context:', err);
    }
  }, []);
  
  // Capture hotkey when user is setting screenshot, history, or continuous context shortcut.
  useEffect(() => {
    const capturing = isCapturingScreenshotHotkey 
      ? 'screenshot' 
      : isCapturingHistoryHotkey 
        ? 'history' 
        : isCapturingContinuousContextHotkey 
          ? 'continuousContext' 
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
        } else {
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
      // If permissionsAPI is not available (e.g., in browser), assume permissions are granted
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
            Field Theory needs Accessibility permission to paste clipboard items:
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

          {/* Continuous Context Section */}
          <div style={styles.settingsSection}>
            <h3 style={styles.sectionTitle}>Continuous Context</h3>
            <p style={{
              fontSize: '13px',
              color: darkMode ? '#9ca3af' : '#6b7280',
              marginBottom: '16px',
              marginTop: '4px',
            }}>
              Take multiple screenshots in a row without re-pressing the hotkey. All screenshots are stacked together, and you can transcribe while capturing.
            </p>
            
            <div style={{
              padding: '16px',
              borderRadius: '8px',
              backgroundColor: darkMode ? '#1a1a1a' : '#f9fafb',
              border: `1px solid ${darkMode ? '#404040' : '#e5e7eb'}`,
            }}>
              {/* Enable Toggle */}
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between',
                marginBottom: '16px',
              }}>
                <div>
                  <h4 style={{
                    margin: 0,
                    fontSize: '14px',
                    fontWeight: 600,
                    color: darkMode ? '#e5e5e5' : '#374151',
                  }}>
                    Enable Continuous Context
                  </h4>
                  <p style={{
                    margin: '4px 0 0 0',
                    fontSize: '12px',
                    color: darkMode ? '#9ca3af' : '#6b7280',
                  }}>
                    Press hotkey to start, Escape to stop
                  </p>
                </div>
                <button
                  onClick={() => handleToggleContinuousContext(!continuousContextEnabled)}
                  style={{
                    padding: '6px 12px',
                    fontSize: '12px',
                    fontWeight: 500,
                    color: continuousContextEnabled ? '#fff' : (darkMode ? '#e5e5e5' : '#374151'),
                    backgroundColor: continuousContextEnabled ? '#10b981' : (darkMode ? '#2d2d2d' : '#fff'),
                    border: `1px solid ${continuousContextEnabled ? '#10b981' : (darkMode ? '#404040' : '#d1d5db')}`,
                    borderRadius: '6px',
                    cursor: 'pointer',
                    minWidth: '60px',
                  }}
                >
                  {continuousContextEnabled ? 'On' : 'Off'}
                </button>
              </div>
              
              {/* Status Indicator - only show when active */}
              {continuousContextState.active && (
                <div style={{
                  padding: '12px',
                  marginBottom: '16px',
                  borderRadius: '6px',
                  backgroundColor: darkMode ? '#064e3b' : '#d1fae5',
                  border: `1px solid ${darkMode ? '#059669' : '#10b981'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      backgroundColor: '#10b981',
                      animation: 'pulse 2s infinite',
                    }} />
                    <span style={{
                      fontSize: '13px',
                      fontWeight: 500,
                      color: darkMode ? '#a7f3d0' : '#047857',
                    }}>
                      Continuous Context Active — {continuousContextState.screenshotCount} screenshot{continuousContextState.screenshotCount !== 1 ? 's' : ''} captured
                    </span>
                  </div>
                </div>
              )}
              
              {/* Hotkey Configuration */}
              <div>
                <label style={{
                  display: 'block',
                  marginBottom: '6px',
                  fontSize: '13px',
                  color: darkMode ? '#d1d5db' : '#6b7280',
                }}>
                  Continuous Context Hotkey
                </label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button
                    onClick={() => {
                      setIsCapturingContinuousContextHotkey(true);
                      setHotkeyError(null);
                    }}
                    disabled={isCapturingScreenshotHotkey || isCapturingHistoryHotkey || isCapturingContinuousContextHotkey || !continuousContextEnabled}
                    style={{
                      padding: '6px 12px',
                      fontSize: '12px',
                      fontWeight: 500,
                      color: isCapturingContinuousContextHotkey ? '#fff' : (darkMode ? '#e5e5e5' : '#374151'),
                      backgroundColor: isCapturingContinuousContextHotkey ? '#3b82f6' : (darkMode ? '#2d2d2d' : '#fff'),
                      border: `1px solid ${darkMode ? '#404040' : '#d1d5db'}`,
                      borderRadius: '6px',
                      cursor: (!continuousContextEnabled || isCapturingScreenshotHotkey || isCapturingHistoryHotkey || isCapturingContinuousContextHotkey) ? 'not-allowed' : 'pointer',
                      opacity: !continuousContextEnabled ? 0.5 : 1,
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
              
              <p style={{
                marginTop: '12px',
                marginBottom: 0,
                fontSize: '11px',
                color: darkMode ? '#9ca3af' : '#6b7280',
                lineHeight: '1.5',
              }}>
                When enabled, press the hotkey to start continuous screenshotting. Each screenshot is automatically saved and stacked. Press Escape during capture to stop. Transcription during capture will be added to the same stack.
              </p>
            </div>
          </div>

          {/* Portable Commands Section */}
          <div style={styles.settingsSection}>
            <h3 style={styles.sectionTitle}>Portable Commands</h3>
            <CommandsSettings />
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
  footerStatus: {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    padding: '6px 10px',
    fontSize: '11px',
    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
    letterSpacing: '0.3px',
    border: '1px solid',
    borderRadius: '999px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
    zIndex: 100,
    pointerEvents: 'none',
  },
};
