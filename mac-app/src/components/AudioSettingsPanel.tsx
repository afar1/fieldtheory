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
        <h2 style={styles.heading}>Audio Input Priority</h2>
        <p style={styles.notAvailable}>
          Audio input priority control is only available on macOS.
        </p>
      </div>
    );
  }

  // Show loading state.
  if (isLoading) {
    return (
      <div style={styles.container}>
        <h2 style={styles.heading}>Audio Input Priority</h2>
        <p>Loading audio devices...</p>
      </div>
    );
  }

  // Show error state.
  if (error || !audioState) {
    return (
      <div style={styles.container}>
        <h2 style={styles.heading}>Audio Input Priority</h2>
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
      <h2 style={styles.heading}>Audio Input Priority</h2>

      {/* Status section */}
      <div style={styles.statusCard}>
        <div style={styles.statusRow}>
          <span style={styles.statusLabel}>Current Microphone:</span>
          <span style={styles.statusValue}>
            {currentDefault?.name || 'None'}
          </span>
        </div>

        <div style={styles.statusRow}>
          <span style={styles.statusLabel}>Priority Device:</span>
          <span style={{
            ...styles.statusValue,
            color: audioState.priorityDeviceId ? '#3b82f6' : '#6b7280',
          }}>
            {priorityDevice?.name || 'None selected'}
          </span>
        </div>

        <div style={styles.statusRow}>
          <span style={styles.statusLabel}>Priority Lock:</span>
          <span style={{
            ...styles.statusValue,
            color: audioState.priorityMode ? '#3b82f6' : '#6b7280',
          }}>
            {audioState.priorityMode ? 'Enabled' : 'Disabled'}
          </span>
        </div>

        {audioState.userOverrideId && audioState.priorityMode && (
          <div style={styles.statusRow}>
            <span style={styles.statusLabel}>Override Active:</span>
            <span style={{ ...styles.statusValue, color: '#f59e0b' }}>
              {inputDevices.find((d) => d.id === audioState.userOverrideId)?.name || 'Unknown'}
            </span>
          </div>
        )}
      </div>

      {/* Controls section */}
      <div style={styles.controlsSection}>
        <label style={styles.selectLabel}>
          <span>Priority Device:</span>
          <select
            value={audioState.priorityDeviceId || ''}
            onChange={(e) => handleSetPriorityDevice(e.target.value || null)}
            style={styles.select}
          >
            <option value="">None</option>
            {inputDevices.map((device) => (
              <option key={device.id} value={device.id}>
                {device.name}
              </option>
            ))}
          </select>
        </label>

        <label style={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={audioState.priorityMode}
            onChange={handleTogglePriority}
            disabled={!audioState.priorityDeviceId}
            style={styles.checkbox}
          />
          <span>Lock to Priority Device</span>
        </label>

        <p style={styles.helpText}>
          {audioState.priorityDeviceId
            ? `When enabled, ${priorityDevice?.name || 'the priority device'} stays your microphone even when other devices connect or disconnect.`
            : 'Select a device above to enable priority locking.'}
        </p>

        {audioState.userOverrideId && audioState.priorityMode && priorityDevice && (
          <button
            onClick={handleResetOverride}
            style={styles.resetButton}
          >
            Reset to {priorityDevice.name}
          </button>
        )}
      </div>

      {/* Device list section */}
      <div style={styles.devicesSection}>
        <h3 style={styles.subheading}>Input Devices</h3>
        <ul style={styles.deviceList}>
          {inputDevices.map((device) => (
            <li
              key={device.id}
              style={{
                ...styles.deviceItem,
                backgroundColor: device.id === audioState.defaultInputId
                  ? '#eff6ff'
                  : device.id === audioState.priorityDeviceId
                    ? '#f0fdf4'
                    : '#fff',
                borderColor: device.id === audioState.defaultInputId
                  ? '#3b82f6'
                  : device.id === audioState.priorityDeviceId
                    ? '#22c55e'
                    : '#e5e7eb',
              }}
            >
              <div style={styles.deviceInfo}>
                <span style={styles.deviceName}>
                  {device.name}
                  {device.id === audioState.priorityDeviceId && (
                    <span style={styles.priorityBadge}>Priority</span>
                  )}
                </span>
                <span style={styles.deviceMeta}>
                  {device.manufacturer && `${device.manufacturer} • `}
                  {device.transportType?.toUpperCase() || 'Unknown'}
                  {device.id === audioState.defaultInputId && ' • Default'}
                </span>
              </div>
            </li>
          ))}
          {inputDevices.length === 0 && (
            <li style={styles.emptyMessage}>No input devices found</li>
          )}
        </ul>
      </div>
    </div>
  );
}

// Styles for the component.
const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '24px',
    maxWidth: '600px',
  },
  heading: {
    marginTop: 0,
    marginBottom: '16px',
    fontSize: '20px',
    fontWeight: 600,
  },
  subheading: {
    marginTop: 0,
    marginBottom: '12px',
    fontSize: '16px',
    fontWeight: 600,
  },
  notAvailable: {
    color: '#6b7280',
    fontStyle: 'italic',
  },
  error: {
    color: '#ef4444',
  },
  statusCard: {
    backgroundColor: '#f9fafb',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '20px',
  },
  statusRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
    borderBottom: '1px solid #e5e7eb',
  },
  statusLabel: {
    fontSize: '14px',
    color: '#374151',
  },
  statusValue: {
    fontSize: '14px',
    fontWeight: 500,
  },
  controlsSection: {
    marginBottom: '24px',
  },
  selectLabel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginBottom: '16px',
    fontSize: '15px',
    fontWeight: 500,
  },
  select: {
    padding: '8px 12px',
    fontSize: '14px',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    backgroundColor: '#fff',
    cursor: 'pointer',
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '15px',
    fontWeight: 500,
    cursor: 'pointer',
  },
  checkbox: {
    width: '18px',
    height: '18px',
    cursor: 'pointer',
  },
  helpText: {
    marginTop: '8px',
    fontSize: '13px',
    color: '#6b7280',
  },
  resetButton: {
    marginTop: '12px',
    padding: '8px 16px',
    fontSize: '14px',
    fontWeight: 500,
    color: '#fff',
    backgroundColor: '#3b82f6',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
  },
  devicesSection: {
    marginTop: '24px',
  },
  deviceList: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  deviceItem: {
    padding: '12px',
    marginBottom: '8px',
    borderRadius: '8px',
    border: '1px solid',
  },
  deviceInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  deviceName: {
    fontSize: '14px',
    fontWeight: 500,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  deviceMeta: {
    fontSize: '12px',
    color: '#6b7280',
  },
  priorityBadge: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#15803d',
    backgroundColor: '#dcfce7',
    padding: '2px 6px',
    borderRadius: '4px',
  },
  emptyMessage: {
    padding: '12px',
    color: '#6b7280',
    fontStyle: 'italic',
  },
};
