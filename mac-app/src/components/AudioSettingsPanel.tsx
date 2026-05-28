// =============================================================================
// AudioSettingsPanel - Renderer UI for audio device management.
// Displays device list, connection status, and priority lock controls.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useTheme, Theme } from '../contexts/ThemeContext';
import { getSettingsDividerColor } from './settings/SettingsPrimitives';

// Import types for the API exposed via preload.
// Note: These are available on window.audioAPI and window.platform.
interface AudioDevice {
  id: string;
  name: string;
  isInput: boolean;
  isOutput: boolean;
  manufacturer?: string;
  transportType?: string;
}

interface AudioState {
  devices: AudioDevice[];
  defaultInputId: string | null;
  priorityMode: boolean;
  priorityDeviceId: string | null;
  userOverrideId: string | null;
}

/**
 * AudioSettingsPanel displays the current audio state and provides controls
 * for managing Little One's priority lock feature.
 */
export default function AudioSettingsPanel() {
  const { theme } = useTheme();
  const [audioState, setAudioState] = useState<AudioState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [favoriteDeviceName, setFavoriteDeviceName] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<'hot-mic' | 'standard'>('standard');

  const styles = getStyles(theme);

  // Check if we're on macOS (audio features only available there).
  const isMacOS = typeof window !== 'undefined' && window.platform?.isMacOS;

  // Fetch initial state and subscribe to changes.
  useEffect(() => {
    // Don't do anything if not on macOS or API not available.
    if (!isMacOS || !window.audioAPI) {
      setIsLoading(false);
      return;
    }

    // Fetch initial state.
    const fetchState = async () => {
      try {
        const state = await window.audioAPI!.getState();
        setAudioState(state);
        // Also fetch the favorite device name
        const [favName, mode] = await Promise.all([
          window.audioAPI!.getFavoriteDeviceName(),
          window.hotMicAPI?.getInputMode?.()
            ?? (window.hotMicAPI?.getEnabled?.().then((enabled) => enabled ? 'hot-mic' : 'standard') ?? Promise.resolve<'standard'>('standard')),
        ]);
        setFavoriteDeviceName(favName);
        setInputMode(mode);
        setError(null);
      } catch (err) {
        setError('Failed to fetch audio state');
        console.error('Failed to fetch audio state:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchState();

    // Subscribe to state changes.
    const unsubscribe = window.audioAPI!.onStateChanged(async (state) => {
      setAudioState(state);
      // Refresh favorite name when state changes (e.g., after setting priority device)
      const favName = await window.audioAPI!.getFavoriteDeviceName();
      setFavoriteDeviceName(favName);
    });
    const unsubscribeInputMode = window.hotMicAPI?.onInputModeChanged?.((mode) => {
      setInputMode(mode);
    }) ?? (() => {});

    return () => {
      unsubscribe();
      unsubscribeInputMode();
    };
  }, [isMacOS]);

  // Handler for setting priority device.
  const handleSetPriorityDevice = useCallback(async (deviceId: string | null) => {
    if (!window.audioAPI) return;

    try {
      await window.audioAPI.setPriorityDevice(deviceId);
    } catch (err) {
      console.error('Failed to set priority device:', err);
    }
  }, []);

  const handleSetInputMode = useCallback(async (mode: 'hot-mic' | 'standard') => {
    if (!window.hotMicAPI?.setInputMode) return;
    const previousMode = inputMode;
    setInputMode(mode);
    try {
      const savedMode = await window.hotMicAPI.setInputMode(mode);
      setInputMode(savedMode);
    } catch (err) {
      setInputMode(previousMode);
      console.error('Failed to set input mode:', err);
    }
  }, [inputMode]);

  // Handler for resetting user override.
  const handleResetOverride = useCallback(async () => {
    if (!window.audioAPI) return;

    try {
      await window.audioAPI.resetOverride();
    } catch (err) {
      console.error('Failed to reset override:', err);
    }
  }, []);

  // Handler for clearing favorite device.
  const handleClearFavorite = useCallback(async () => {
    if (!window.audioAPI) return;

    try {
      await window.audioAPI.clearFavoriteDevice();
      setFavoriteDeviceName(null);
    } catch (err) {
      console.error('Failed to clear favorite device:', err);
    }
  }, []);

  // Handler for setting current priority device as favorite.
  const handleSetAsFavorite = useCallback(async () => {
    if (!window.audioAPI || !audioState?.priorityDeviceId) return;

    try {
      const success = await window.audioAPI.setFavoriteDevice(audioState.priorityDeviceId);
      if (success) {
        const favName = await window.audioAPI.getFavoriteDeviceName();
        setFavoriteDeviceName(favName);
      }
    } catch (err) {
      console.error('Failed to set favorite device:', err);
    }
  }, [audioState?.priorityDeviceId]);

  // If not on macOS, show a message.
  if (!isMacOS) {
    return (
      <div style={styles.container}>
        <p style={styles.notAvailable}>Audio priority is only available on macOS.</p>
      </div>
    );
  }

  // Show loading state.
  if (isLoading) {
    return (
      <div style={styles.container}>
        <p style={{ fontSize: '12px', color: '#6b7280' }}>Loading devices...</p>
      </div>
    );
  }

  // Show error state.
  if (error || !audioState) {
    return (
      <div style={styles.container}>
        <p style={styles.error}>{error || 'Failed to load audio state'}</p>
      </div>
    );
  }

  // Get input devices only for the list.
  const inputDevices = audioState.devices.filter((d) => d.isInput);
  const currentDefault = inputDevices.find((d) => d.id === audioState.defaultInputId);
  const priorityDevice = inputDevices.find((d) => d.id === audioState.priorityDeviceId);

  return (
    <div style={styles.container}>
      <section style={styles.card}>
        <header style={styles.cardHeader}>
          <div style={styles.cardTitle}>Input</div>
          <div style={styles.cardSub}>
            Field Theory uses your system default mic unless you choose a priority mic here.
            {currentDefault ? ` Current default: ${currentDefault.name}.` : ''}
          </div>
        </header>

        {/* Priority microphone selector - selecting a mic auto-enables priority mode */}
        <div style={styles.row}>
          <div style={styles.rowText}>
            <span style={styles.rowLabel}>Priority mic</span>
            <span style={styles.rowHint}>
              Locks recording to this device and prevents automatic input switching.
            </span>
          </div>
          <div style={styles.rowControls}>
            <select
              value={audioState.priorityDeviceId || ''}
              onChange={async (e) => {
                const deviceId = e.target.value || null;
                await handleSetPriorityDevice(deviceId);
                // Auto-enable priority mode when selecting a device.
                if (deviceId && !audioState.priorityMode && window.audioAPI) {
                  await window.audioAPI.setPriorityMode(true);
                }
              }}
              style={styles.select}
            >
              <option value="">None</option>
              {inputDevices.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name}
                </option>
              ))}
            </select>
            {audioState.userOverrideId && audioState.priorityMode && priorityDevice && (
              <button onClick={handleResetOverride} style={styles.btn}>
                Reset
              </button>
            )}
          </div>
        </div>

        <div style={styles.row}>
          <div style={styles.rowText}>
            <span style={styles.rowLabel}>Input mode</span>
            <span style={styles.rowHint}>
              Standard records on demand. Hot Mic keeps the voice command path active.
            </span>
          </div>
          <div style={styles.rowControls}>
            <div style={styles.modeSegment}>
              <button
                type="button"
                onClick={() => handleSetInputMode('standard')}
                style={{
                  ...styles.modeButton,
                  ...(inputMode === 'standard' ? styles.modeButtonActive : {}),
                }}
              >
                Standard
              </button>
              <button
                type="button"
                onClick={() => handleSetInputMode('hot-mic')}
                style={{
                  ...styles.modeButton,
                  ...(inputMode === 'hot-mic' ? styles.modeButtonActive : {}),
                }}
              >
                Hot Mic
              </button>
            </div>
          </div>
        </div>

        {audioState.priorityDeviceId && (
          <div style={styles.callout}>
            <span>Your microphone will not auto-switch while a priority mic is selected.</span>
            {priorityDevice && priorityDevice.name !== favoriteDeviceName && (
              <button onClick={handleSetAsFavorite} style={styles.inlineBtn}>
                set as favorite
              </button>
            )}
          </div>
        )}
      </section>

      <section style={styles.card}>
        <header style={styles.cardHeader}>
          <div style={styles.cardTitle}>Favorite</div>
          <div style={styles.cardSub}>
            Restores a known microphone when Field Theory starts or when the device reconnects.
          </div>
        </header>

        {favoriteDeviceName ? (
          <div style={{ ...styles.row, borderBottom: 0 }}>
            <div style={styles.rowText}>
              <span style={styles.rowLabel}>Saved device</span>
              <span style={styles.rowHint}>{favoriteDeviceName}</span>
            </div>
            <div style={styles.rowControls}>
              <button onClick={handleClearFavorite} style={styles.btn}>
                Clear
              </button>
            </div>
          </div>
        ) : (
          <div style={styles.emptyMessage}>
            No favorite set. Select a priority mic and click "set as favorite" to auto-restore it on startup.
          </div>
        )}
      </section>
    </div>
  );
}

// =============================================================================
// Unified Design System - Only 2 font sizes: 13px body, 11px headers
// =============================================================================
const getStyles = (theme: Theme): Record<string, React.CSSProperties> => ({
  container: {
    padding: 0,
  },
  card: {
    backgroundColor: theme.isDark ? theme.surface1 : '#fff',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
    padding: '18px 22px 4px',
  },
  cardHeader: {
    marginBottom: '14px',
  },
  cardTitle: {
    fontSize: '16px',
    fontWeight: 500,
    color: theme.text,
    letterSpacing: '-0.01em',
  },
  cardSub: {
    fontSize: '12px',
    color: theme.textSecondary,
    marginTop: '4px',
    lineHeight: 1.5,
  },
  heading: {
    display: 'none', // Hidden in new design - section header comes from parent
  },
  notAvailable: {
    color: theme.textSecondary,
    fontStyle: 'italic',
    fontSize: '12px',
  },
  error: {
    color: theme.error,
    fontSize: '12px',
  },

  // Flat row layout.
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    padding: '12px 0',
    minHeight: '40px',
    borderBottom: `1px solid ${getSettingsDividerColor(theme)}`,
  },
  rowText: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '3px',
    minWidth: 0,
    flex: 1,
  },
  rowLabel: {
    fontSize: '13px',
    color: theme.text,
    fontWeight: 500,
    lineHeight: 1.35,
  },
  rowHint: {
    fontSize: '11.5px',
    color: theme.textSecondary,
    lineHeight: 1.5,
  },
  rowValue: {
    fontSize: '12px',
    color: theme.text,
    fontWeight: 500,
  },
  rowControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexShrink: 0,
  },
  modeSegment: {
    display: 'flex',
    alignItems: 'center',
    padding: '2px',
    backgroundColor: theme.isDark ? '#20232a' : '#f8fafc',
    borderRadius: '6px',
    border: `1px solid ${theme.border}`,
  },
  modeButton: {
    border: '1px solid transparent',
    borderRadius: '4px',
    backgroundColor: 'transparent',
    color: theme.textSecondary,
    fontSize: '12px',
    fontWeight: 500,
    padding: '4px 12px',
    cursor: 'pointer',
  },
  modeButtonActive: {
    backgroundColor: theme.isDark ? theme.surface1 : '#fff',
    borderColor: theme.border,
    color: theme.text,
    boxShadow: theme.isDark ? 'none' : '0 1px 2px rgba(60, 40, 20, 0.06)',
  },

  // Button styles.
  btn: {
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: 500,
    color: theme.text,
    backgroundColor: theme.isDark ? theme.surface1 : '#fff',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
    cursor: 'pointer',
  },
  inlineBtn: {
    padding: '2px 6px',
    fontSize: '11px',
    fontWeight: 500,
    color: theme.text,
    backgroundColor: theme.isDark ? theme.surface1 : '#fff',
    border: `1px solid ${theme.border}`,
    borderRadius: '5px',
    cursor: 'pointer',
    marginLeft: 'auto',
  },
  callout: {
    fontSize: '11.5px',
    color: theme.textSecondary,
    padding: '12px 0 14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    lineHeight: 1.5,
  },

  // Toggle switch.
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

  // Select dropdown.
  select: {
    padding: '6px 12px',
    fontSize: '12px',
    color: theme.text,
    backgroundColor: theme.isDark ? theme.surface1 : '#fff',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
    cursor: 'pointer',
    minWidth: '180px',
  },

  devicesSection: {
    marginTop: '12px',
  },

  // Device row (compact).
  deviceRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 12px',
    marginBottom: '2px',
    borderRadius: '6px',
  },
  deviceMeta: {
    display: 'block',
    fontSize: '11px',
    color: theme.textSecondary,
    marginTop: '2px',
  },
  priorityBadge: {
    fontSize: '12px',
    color: theme.success,
  },
  emptyMessage: {
    padding: '0 0 14px',
    color: theme.textSecondary,
    fontSize: '11.5px',
    lineHeight: 1.5,
  },
});
