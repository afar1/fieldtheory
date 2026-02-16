// =============================================================================
// HotMicSettings - Continuous voice input for Claude Code terminals.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useTheme, Theme } from '../contexts/ThemeContext';

export default function HotMicSettings() {
  const { theme } = useTheme();

  const [enabled, setEnabled] = useState(false);
  const [targetBundleId, setTargetBundleId] = useState<string | null>(null);
  const [soundsEnabled, setSoundsEnabled] = useState(true);
  const [knownTerminals, setKnownTerminals] = useState<Array<{ name: string; bundleId: string }>>([]);
  const [customBundleId, setCustomBundleId] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [currentState, setCurrentState] = useState('idle');
  const [hookInstalled, setHookInstalled] = useState(false);
  const [hookLoading, setHookLoading] = useState(false);
  const [submitWord, setSubmitWord] = useState('go');

  const styles = getStyles(theme);

  useEffect(() => {
    if (!window.hotMicAPI) return;

    const load = async () => {
      const [en, target, sounds, terminals, state, hookStatus, submit] = await Promise.all([
        window.hotMicAPI!.getEnabled(),
        window.hotMicAPI!.getTargetApp(),
        window.hotMicAPI!.getSoundsEnabled(),
        window.hotMicAPI!.getKnownTerminals(),
        window.hotMicAPI!.getState(),
        window.hotMicAPI!.isHookInstalled(),
        window.hotMicAPI!.getSubmitWord(),
      ]);
      setEnabled(en);
      setTargetBundleId(target);
      setSoundsEnabled(sounds);
      setKnownTerminals(terminals);
      setCurrentState(state);
      setHookInstalled(hookStatus);
      setSubmitWord(submit);

      // Check if target is a known terminal or custom
      if (target && !terminals.some(t => t.bundleId === target)) {
        setShowCustom(true);
        setCustomBundleId(target);
      }
    };

    load();

    const unsub = window.hotMicAPI!.onStateChanged((state) => {
      setCurrentState(state);
    });

    return unsub;
  }, []);

  const handleEnabledChange = useCallback(async (value: boolean) => {
    if (!window.hotMicAPI) return;
    setEnabled(value);
    await window.hotMicAPI.setEnabled(value);
  }, []);

  const handleTargetChange = useCallback(async (bundleId: string) => {
    if (!window.hotMicAPI) return;
    if (bundleId === '__custom__') {
      setShowCustom(true);
      return;
    }
    setShowCustom(false);
    setTargetBundleId(bundleId);
    await window.hotMicAPI.setTargetApp(bundleId);
  }, []);

  const handleCustomBundleIdSave = useCallback(async () => {
    if (!window.hotMicAPI || !customBundleId.trim()) return;
    const id = customBundleId.trim();
    setTargetBundleId(id);
    await window.hotMicAPI.setTargetApp(id);
  }, [customBundleId]);

  const handleSoundsChange = useCallback(async (value: boolean) => {
    if (!window.hotMicAPI) return;
    setSoundsEnabled(value);
    await window.hotMicAPI.setSoundsEnabled(value);
  }, []);

  const handleSubmitWordSave = useCallback(async () => {
    if (!window.hotMicAPI || !submitWord.trim()) return;
    await window.hotMicAPI.setSubmitWord(submitWord.trim());
  }, [submitWord]);

  const handleStop = useCallback(async () => {
    if (!window.hotMicAPI) return;
    await window.hotMicAPI.stop();
  }, []);

  const handleToggleHook = useCallback(async () => {
    if (!window.hotMicAPI) return;
    setHookLoading(true);
    try {
      if (hookInstalled) {
        const result = await window.hotMicAPI.uninstallHook();
        if (result.success) setHookInstalled(false);
      } else {
        const result = await window.hotMicAPI.installHook();
        if (result.success) setHookInstalled(true);
      }
    } finally {
      setHookLoading(false);
    }
  }, [hookInstalled]);

  const isActive = currentState !== 'idle';
  const targetName = knownTerminals.find(t => t.bundleId === targetBundleId)?.name || targetBundleId || 'Not set';

  return (
    <div style={styles.container}>
      {/* Enable toggle */}
      <div style={styles.row}>
        <span style={styles.rowLabel}>Enable Hot Mic</span>
        <button
          onClick={() => handleEnabledChange(!enabled)}
          style={{ ...styles.toggle, backgroundColor: enabled ? theme.success : '#d1d5db' }}
        >
          <span style={{ ...styles.toggleKnob, transform: enabled ? 'translateX(20px)' : 'translateX(2px)' }} />
        </button>
      </div>
      <p style={styles.description}>
        Hands-free voice input for multiple Claude Code terminals. When Claude finishes a turn,
        the terminal is queued. Speak freely — your words buffer until you say the submit word
        to flush and send. Say "skip" to cycle or "dismiss" to remove from queue.
      </p>

      <div style={styles.divider} />

      {/* Target app */}
      <div style={styles.row}>
        <span style={styles.rowLabel}>Target Terminal</span>
        <select
          value={showCustom ? '__custom__' : (targetBundleId || '')}
          onChange={(e) => handleTargetChange(e.target.value)}
          style={styles.select}
        >
          <option value="">Select...</option>
          {knownTerminals.map(t => (
            <option key={t.bundleId} value={t.bundleId}>{t.name}</option>
          ))}
          <option value="__custom__">Custom...</option>
        </select>
      </div>
      {showCustom && (
        <div style={{ ...styles.row, marginTop: '4px' }}>
          <input
            type="text"
            value={customBundleId}
            onChange={(e) => setCustomBundleId(e.target.value)}
            placeholder="com.example.terminal"
            style={styles.input}
            onBlur={handleCustomBundleIdSave}
            onKeyDown={(e) => e.key === 'Enter' && handleCustomBundleIdSave()}
          />
        </div>
      )}
      <p style={styles.description}>
        The terminal app where transcribed text will be typed.
      </p>

      <div style={styles.divider} />

      {/* Sounds toggle */}
      <div style={styles.row}>
        <span style={styles.rowLabel}>Hot Mic Sounds</span>
        <button
          onClick={() => handleSoundsChange(!soundsEnabled)}
          style={{ ...styles.toggle, backgroundColor: soundsEnabled ? theme.success : '#d1d5db' }}
        >
          <span style={{ ...styles.toggleKnob, transform: soundsEnabled ? 'translateX(20px)' : 'translateX(2px)' }} />
        </button>
      </div>
      <p style={styles.description}>
        Play audio feedback during Hot Mic recording cycles.
      </p>

      <div style={styles.divider} />

      {/* Submit word */}
      <div style={styles.row}>
        <span style={styles.rowLabel}>Submit Word</span>
        <input
          type="text"
          value={submitWord}
          onChange={(e) => setSubmitWord(e.target.value)}
          placeholder="go"
          style={{ ...styles.input, maxWidth: '120px', textAlign: 'right' as const }}
          onBlur={handleSubmitWordSave}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmitWordSave()}
        />
      </div>
      <p style={styles.description}>
        Say this word at the end of a phrase to flush the buffer and submit to Claude.
      </p>

      <div style={styles.divider} />

      {/* Current state */}
      {isActive && (
        <>
          <div style={styles.row}>
            <span style={styles.rowLabel}>Status</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ ...styles.stateBadge, backgroundColor: getStateColor(currentState) }}>
                {currentState}
              </span>
              <button onClick={handleStop} style={styles.stopButton}>Stop</button>
            </div>
          </div>
          <p style={styles.description}>
            Target: {targetName}
          </p>
          <div style={styles.divider} />
        </>
      )}

      {/* Claude Code hook */}
      <div style={styles.row}>
        <div>
          <span style={styles.rowLabel}>Claude Code Hook</span>
          <p style={styles.description}>
            {hookInstalled
              ? 'Installed — Hot Mic triggers when Claude finishes a turn.'
              : 'Adds a Stop hook to ~/.claude/settings.json.'}
          </p>
        </div>
        <button
          onClick={handleToggleHook}
          disabled={hookLoading}
          style={{
            ...styles.hookButton,
            backgroundColor: hookInstalled ? theme.surface0 : theme.success,
            color: hookInstalled ? theme.text : '#fff',
            opacity: hookLoading ? 0.6 : 1,
          }}
        >
          {hookLoading ? '...' : hookInstalled ? 'Remove' : 'Install'}
        </button>
      </div>
    </div>
  );
}

function getStateColor(state: string): string {
  switch (state) {
    case 'armed': return '#3b82f6';
    case 'listening': return '#10b981';
    case 'recording': return '#ef4444';
    default: return '#6b7280';
  }
}

const getStyles = (theme: Theme): Record<string, React.CSSProperties> => ({
  container: {
    padding: 0,
  },
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
  divider: {
    height: '1px',
    backgroundColor: theme.border,
    margin: '12px 0',
  },
  description: {
    fontSize: '11px',
    color: theme.textSecondary,
    margin: '4px 0 0 0',
    lineHeight: 1.4,
  },
  select: {
    fontSize: '12px',
    padding: '4px 8px',
    borderRadius: '6px',
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.surface0,
    color: theme.text,
    cursor: 'pointer',
    minWidth: '140px',
  },
  input: {
    fontSize: '12px',
    padding: '4px 8px',
    borderRadius: '6px',
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.surface0,
    color: theme.text,
    flex: 1,
  },
  stateBadge: {
    fontSize: '10px',
    color: '#fff',
    padding: '2px 8px',
    borderRadius: '10px',
    fontWeight: 500,
    textTransform: 'uppercase' as const,
  },
  stopButton: {
    fontSize: '11px',
    padding: '2px 10px',
    borderRadius: '6px',
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.surface0,
    color: '#ef4444',
    cursor: 'pointer',
  },
  hookButton: {
    fontSize: '11px',
    padding: '4px 14px',
    borderRadius: '6px',
    border: 'none',
    cursor: 'pointer',
    fontWeight: 500,
    flexShrink: 0,
  },
});
