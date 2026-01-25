/**
 * Scenario Testing Panel
 *
 * A floating panel for superadmin users to simulate different app states
 * for testing purposes. Supports tier switching, quota simulation, and
 * auth state simulation.
 *
 * Controls:
 * - Tier Override: Real / Free / Pro
 * - Quota Sliders: Priority Mic, Auto-Stack, Text Improve (0-100%)
 * - Auth State: Real / Logged Out / Offline
 * - Reset All: Clear all overrides
 */

import React, { useState, useEffect, useCallback } from 'react';
import ReactDOM from 'react-dom/client';

// =============================================================================
// Types
// =============================================================================

interface DevOverrides {
  tier?: 'free' | 'pro';
  quotaPercentages?: {
    priorityMic?: number;
    autoStack?: number;
    textImprove?: number;
  };
  authState?: 'logged_out' | 'offline';
}

// Type-safe accessor for scenario API
const scenarioAPI = window.scenarioAPI!;

// =============================================================================
// Styles
// =============================================================================

const styles = {
  container: {
    width: '100%',
    height: '100%',
    backgroundColor: '#1a1a1a',
    color: '#e5e5e5',
    display: 'flex',
    flexDirection: 'column' as const,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: '12px',
    overflow: 'hidden',
    borderRadius: '8px',
    border: '1px solid #333',
  },
  header: {
    padding: '10px 12px',
    backgroundColor: '#252525',
    borderBottom: '1px solid #333',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    cursor: 'move',
    WebkitAppRegion: 'drag' as const,
    userSelect: 'none' as const,
  },
  headerTitle: {
    fontWeight: 600,
    fontSize: '13px',
    color: '#fff',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: '#888',
    fontSize: '18px',
    cursor: 'pointer',
    padding: '0 4px',
    WebkitAppRegion: 'no-drag' as const,
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: '12px',
  },
  section: {
    marginBottom: '16px',
  },
  sectionTitle: {
    fontSize: '10px',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    color: '#888',
    marginBottom: '8px',
  },
  radioGroup: {
    display: 'flex',
    gap: '8px',
  },
  radioLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '4px',
    backgroundColor: '#252525',
    border: '1px solid #333',
    transition: 'all 0.15s ease',
  },
  radioLabelActive: {
    backgroundColor: '#3b82f6',
    borderColor: '#3b82f6',
    color: '#fff',
  },
  sliderContainer: {
    marginBottom: '12px',
  },
  sliderLabel: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '4px',
    fontSize: '11px',
  },
  slider: {
    width: '100%',
    height: '4px',
    WebkitAppearance: 'none' as const,
    appearance: 'none' as const,
    backgroundColor: '#333',
    borderRadius: '2px',
    outline: 'none',
    cursor: 'pointer',
  },
  select: {
    width: '100%',
    padding: '8px 10px',
    backgroundColor: '#252525',
    border: '1px solid #333',
    borderRadius: '4px',
    color: '#e5e5e5',
    fontSize: '12px',
    cursor: 'pointer',
    outline: 'none',
  },
  resetButton: {
    width: '100%',
    padding: '10px',
    backgroundColor: '#dc2626',
    color: '#fff',
    border: 'none',
    borderRadius: '4px',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    marginTop: '8px',
  },
  indicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 10px',
    backgroundColor: '#422006',
    border: '1px solid #854d0e',
    borderRadius: '4px',
    marginBottom: '12px',
    fontSize: '11px',
    color: '#fbbf24',
  },
};

// =============================================================================
// Components
// =============================================================================

function ScenarioTestingPanel() {
  const [overrides, setOverrides] = useState<DevOverrides | null>(null);
  const [loading, setLoading] = useState(true);

  // Load current overrides on mount
  useEffect(() => {
    scenarioAPI.getOverrides().then((o) => {
      setOverrides(o);
      setLoading(false);
    });

    // Listen for override changes
    const unsubscribe = scenarioAPI.onOverridesChanged((newOverrides) => {
      setOverrides(newOverrides);
    });

    return unsubscribe;
  }, []);

  // Close button handler
  const handleClose = useCallback(() => {
    scenarioAPI.hidePanel();
  }, []);

  // Tier change handler
  const handleTierChange = useCallback((tier: 'free' | 'pro' | null) => {
    scenarioAPI.setTierOverride(tier);
  }, []);

  // Quota slider handlers
  const handleQuotaChange = useCallback((feature: 'priorityMic' | 'autoStack' | 'textImprove', value: number | null) => {
    scenarioAPI.setQuotaOverride(feature, value);
  }, []);

  // Auth state handler
  const handleAuthStateChange = useCallback((state: 'logged_out' | 'offline' | null) => {
    scenarioAPI.setAuthStateOverride(state);
  }, []);

  // Reset all handler
  const handleResetAll = useCallback(() => {
    scenarioAPI.resetAll();
  }, []);

  // Check if any overrides are active
  const hasActiveOverrides = overrides && (
    overrides.tier !== undefined ||
    overrides.authState !== undefined ||
    (overrides.quotaPercentages && Object.keys(overrides.quotaPercentages).length > 0)
  );

  // Get current values
  const currentTier = overrides?.tier ?? null;
  const currentAuthState = overrides?.authState ?? null;
  const priorityMic = overrides?.quotaPercentages?.priorityMic ?? null;
  const autoStack = overrides?.quotaPercentages?.autoStack ?? null;
  const textImprove = overrides?.quotaPercentages?.textImprove ?? null;

  if (loading) {
    return (
      <div style={styles.container}>
        <div style={{ ...styles.content, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          Loading...
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Draggable header */}
      <div style={styles.header}>
        <span style={styles.headerTitle}>Scenario Testing</span>
        <button
          style={styles.closeButton}
          onClick={handleClose}
          title="Close"
        >
          &times;
        </button>
      </div>

      <div style={styles.content}>
        {/* Active overrides indicator */}
        {hasActiveOverrides && (
          <div style={styles.indicator}>
            <span>&#9888;</span>
            <span>Overrides Active</span>
          </div>
        )}

        {/* Tier Override */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Tier Override</div>
          <div style={styles.radioGroup}>
            {(['real', 'free', 'pro'] as const).map((tier) => (
              <label
                key={tier}
                style={{
                  ...styles.radioLabel,
                  ...(
                    (tier === 'real' && currentTier === null) ||
                    (tier !== 'real' && currentTier === tier)
                      ? styles.radioLabelActive
                      : {}
                  ),
                }}
              >
                <input
                  type="radio"
                  name="tier"
                  checked={
                    (tier === 'real' && currentTier === null) ||
                    (tier !== 'real' && currentTier === tier)
                  }
                  onChange={() => handleTierChange(tier === 'real' ? null : tier)}
                  style={{ display: 'none' }}
                />
                {tier.charAt(0).toUpperCase() + tier.slice(1)}
              </label>
            ))}
          </div>
        </div>

        {/* Quota Sliders */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Quota Simulation</div>

          {/* Priority Mic */}
          <div style={styles.sliderContainer}>
            <div style={styles.sliderLabel}>
              <span>Priority Mic</span>
              <span>{priorityMic !== null ? `${priorityMic}%` : 'Real'}</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={priorityMic ?? 0}
              onChange={(e) => handleQuotaChange('priorityMic', parseInt(e.target.value))}
              onDoubleClick={() => handleQuotaChange('priorityMic', null)}
              style={styles.slider}
              title="Double-click to reset to real value"
            />
          </div>

          {/* Auto-Stack */}
          <div style={styles.sliderContainer}>
            <div style={styles.sliderLabel}>
              <span>Auto-Stack</span>
              <span>{autoStack !== null ? `${autoStack}%` : 'Real'}</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={autoStack ?? 0}
              onChange={(e) => handleQuotaChange('autoStack', parseInt(e.target.value))}
              onDoubleClick={() => handleQuotaChange('autoStack', null)}
              style={styles.slider}
              title="Double-click to reset to real value"
            />
          </div>

          {/* Text Improve */}
          <div style={styles.sliderContainer}>
            <div style={styles.sliderLabel}>
              <span>Text Improve</span>
              <span>{textImprove !== null ? `${textImprove}%` : 'Real'}</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={textImprove ?? 0}
              onChange={(e) => handleQuotaChange('textImprove', parseInt(e.target.value))}
              onDoubleClick={() => handleQuotaChange('textImprove', null)}
              style={styles.slider}
              title="Double-click to reset to real value"
            />
          </div>
        </div>

        {/* Auth State */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Auth State</div>
          <select
            style={styles.select}
            value={currentAuthState ?? 'real'}
            onChange={(e) => {
              const value = e.target.value;
              handleAuthStateChange(value === 'real' ? null : value as 'logged_out' | 'offline');
            }}
          >
            <option value="real">Real</option>
            <option value="logged_out">Logged Out</option>
            <option value="offline">Offline Mode</option>
          </select>
        </div>

        {/* Reset All Button */}
        <button
          style={{
            ...styles.resetButton,
            opacity: hasActiveOverrides ? 1 : 0.5,
            cursor: hasActiveOverrides ? 'pointer' : 'not-allowed',
          }}
          onClick={handleResetAll}
          disabled={!hasActiveOverrides}
        >
          Reset All Overrides
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Mount
// =============================================================================

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<ScenarioTestingPanel />);
