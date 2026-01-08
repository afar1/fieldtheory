// =============================================================================
// AudioSettingsPanel - Renderer UI for audio device management.
// Displays device list, connection status, and priority lock controls.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';

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
  const [audioState, setAudioState] = useState<AudioState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    const unsubscribe = window.audioAPI!.onStateChanged((state) => {
      setAudioState(state);
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
        <p style={{ fontSize: '13px', color: '#6b7280' }}>Loading devices...</p>
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
      
      {/* Priority microphone helper text */}
      {audioState.priorityDeviceId && (
        <div style={{ fontSize: '11px', color: '#6b7280', marginBottom: '12px', paddingLeft: '2px' }}>
          Your microphone will not auto-switch while a priority mic is selected.
        </div>
      )}

    </div>
  );
}

// =============================================================================
// Unified Design System - Only 2 font sizes: 13px body, 11px headers
// =============================================================================
const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 0,
  },
  heading: {
    display: 'none', // Hidden in new design - section header comes from parent
  },
  notAvailable: {
    color: '#6b7280',
    fontStyle: 'italic',
    fontSize: '13px',
  },
  error: {
    color: '#ef4444',
    fontSize: '13px',
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
  
  // Button styles.
  btn: {
    padding: '6px 12px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#374151',
    backgroundColor: '#fff',
    border: '1px solid #d1d5db',
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
    fontSize: '13px',
    color: '#374151',
    backgroundColor: '#fff',
    border: '1px solid #d1d5db',
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
  
  // Device row (compact).
  deviceRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 10px',
    marginBottom: '2px',
    borderRadius: '6px',
  },
  deviceMeta: {
    display: 'block',
    fontSize: '11px',
    color: '#9ca3af',
    marginTop: '2px',
  },
  priorityBadge: {
    fontSize: '13px',
    color: '#22c55e',
  },
  emptyMessage: {
    padding: '12px',
    color: '#6b7280',
    fontStyle: 'italic',
    fontSize: '13px',
  },
};
