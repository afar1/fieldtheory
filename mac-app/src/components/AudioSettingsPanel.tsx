// =============================================================================
// AudioSettingsPanel - Renderer UI for audio device management.
// Displays device list, connection status, and priority lock controls.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useTheme, Theme } from '../contexts/ThemeContext';

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
        const favName = await window.audioAPI!.getFavoriteDeviceName();
        setFavoriteDeviceName(favName);
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

    return () => {
      unsubscribe();
    };
  }, [isMacOS]);

  // Handler for toggling priority mode.
  const handleTogglePriority = useCallback(async () => {
    if (!audioState || !window.audioAPI) return;

    try {
      await window.audioAPI.setPriorityMode(!audioState.priorityMode);
    } catch (err) {
      console.error('Failed to toggle priority mode:', err);
    }
  }, [audioState]);

  // Handler for setting priority device.
  const handleSetPriorityDevice = useCallback(async (deviceId: string | null) => {
    if (!window.audioAPI) return;

    try {
      await window.audioAPI.setPriorityDevice(deviceId);
    } catch (err) {
      console.error('Failed to set priority device:', err);
    }
  }, []);

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
      {/* Priority microphone selector - selecting a mic auto-enables priority mode */}
      <div style={styles.row}>
        <span style={styles.rowLabel}>Priority Mic</span>
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
      
      {/* Priority microphone helper text and Set as Favorite button */}
      {audioState.priorityDeviceId && (
        <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '12px', paddingLeft: '2px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Your microphone will not auto-switch while a priority mic is selected.</span>
          {priorityDevice && priorityDevice.name !== favoriteDeviceName && (
            <button onClick={handleSetAsFavorite} style={{ ...styles.btn, fontSize: '11px', padding: '2px 6px', marginLeft: 'auto' }}>
              set as favorite
            </button>
          )}
        </div>
      )}

      {/* Favorite - shows the saved device that auto-connects on startup */}
      {favoriteDeviceName ? (
        <>
          <div style={styles.row}>
            <span style={styles.rowLabel}>Favorite</span>
            <div style={styles.rowControls}>
              <span style={{ fontSize: '13px', color: theme.text, marginRight: '8px' }}>
                {favoriteDeviceName}
              </span>
              <button onClick={handleClearFavorite} style={styles.btn}>
                Clear
              </button>
            </div>
          </div>
          <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '12px', paddingLeft: '2px' }}>
            Your favorite is automatically restored when you restart the app or when the device reconnects.
          </div>
        </>
      ) : (
        <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '12px', paddingLeft: '2px' }}>
          No favorite set. Select a priority mic and click "set as favorite" to auto-restore it on startup.
        </div>
      )}

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
    padding: '4px 0',
    minHeight: '32px',
  },
  rowLabel: {
    fontSize: '12px',
    color: theme.text,
    fontWeight: 400,
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

  // Section header with divider line.
  devicesSection: {
    marginTop: '12px',
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
    color: theme.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    whiteSpace: 'nowrap' as const,
  },
  sectionLine: {
    flex: 1,
    height: '1px',
    backgroundColor: theme.border,
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
    padding: '12px',
    color: theme.textSecondary,
    fontStyle: 'italic',
    fontSize: '12px',
  },
});
