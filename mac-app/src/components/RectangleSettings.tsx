// =============================================================================
// RectangleSettings - Window management keyboard + voice command settings.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useTheme, Theme } from '../contexts/ThemeContext';

type SquaresHotkeyAction =
  | 'leftHalf'
  | 'rightHalf'
  | 'topHalf'
  | 'bottomHalf'
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight'
  | 'firstThird'
  | 'centerThird'
  | 'lastThird'
  | 'firstTwoThirds'
  | 'lastTwoThirds'
  | 'maximize'
  | 'almostMaximize'
  | 'center'
  | 'restore'
  | 'grid'
  | 'focus'
  | 'horizontalSpread'
  | 'verticalSpread'
  | 'cascade';

type SquaresHotkeysMap = Record<SquaresHotkeyAction, string>;

type ActionMeta = { label: string; description: string };

/** Voice command metadata for display. */
const VOICE_ACTION_META: Record<string, ActionMeta> = {
  grid: { label: 'Grid / Tile', description: 'Arrange all windows in a grid layout' },
  showAll: { label: 'Show All', description: 'Show all windows/apps after focus mode' },
  focus: { label: 'Focus', description: 'Hide other windows and focus current app' },
  horizontalSpread: { label: 'Horizontal', description: 'Spread windows horizontally' },
  verticalSpread: { label: 'Vertical', description: 'Stack windows vertically' },
  cascade: { label: 'Cascade', description: 'Cascade windows diagonally' },
  leftHalf: { label: 'Snap Left', description: 'Snap active window to left side' },
  rightHalf: { label: 'Snap Right', description: 'Snap active window to right side' },
  topLeft: { label: 'Top Left Corner', description: 'Move active window to top-left corner' },
  topRight: { label: 'Top Right Corner', description: 'Move active window to top-right corner' },
  bottomLeft: { label: 'Bottom Left Corner', description: 'Move active window to bottom-left corner' },
  bottomRight: { label: 'Bottom Right Corner', description: 'Move active window to bottom-right corner' },
  maximize: { label: 'Maximize', description: 'Maximize active window' },
  fullScreen: { label: 'Enter Full Screen', description: 'Enter macOS full-screen mode' },
  exitFullScreen: { label: 'Exit Full Screen', description: 'Exit macOS full-screen mode' },
  center: { label: 'Center', description: 'Center active window without resizing' },
  restore: { label: 'Restore', description: 'Restore previous window state' },
};

/** Ordered voice actions for consistent rendering. */
const VOICE_ACTION_ORDER = [
  'grid',
  'showAll',
  'focus',
  'horizontalSpread',
  'verticalSpread',
  'cascade',
  'leftHalf',
  'rightHalf',
  'topLeft',
  'topRight',
  'bottomLeft',
  'bottomRight',
  'maximize',
  'fullScreen',
  'exitFullScreen',
  'center',
  'restore',
];

const HOTKEY_ACTION_META: Record<SquaresHotkeyAction, ActionMeta> = {
  leftHalf: { label: 'Snap Left', description: 'Move active window to the left half' },
  rightHalf: { label: 'Snap Right', description: 'Move active window to the right half' },
  topHalf: { label: 'Snap Top', description: 'Move active window to the top half' },
  bottomHalf: { label: 'Snap Bottom', description: 'Move active window to the bottom half' },
  topLeft: { label: 'Top Left', description: 'Move active window to top-left quarter' },
  topRight: { label: 'Top Right', description: 'Move active window to top-right quarter' },
  bottomLeft: { label: 'Bottom Left', description: 'Move active window to bottom-left quarter' },
  bottomRight: { label: 'Bottom Right', description: 'Move active window to bottom-right quarter' },
  firstThird: { label: 'First Third', description: 'Move active window to first vertical third' },
  centerThird: { label: 'Center Third', description: 'Move active window to center vertical third' },
  lastThird: { label: 'Last Third', description: 'Move active window to last vertical third' },
  firstTwoThirds: { label: 'First Two Thirds', description: 'Move active window to first two vertical thirds' },
  lastTwoThirds: { label: 'Last Two Thirds', description: 'Move active window to last two vertical thirds' },
  maximize: { label: 'Maximize', description: 'Maximize active window' },
  almostMaximize: { label: 'Almost Maximize', description: 'Maximize with a small margin' },
  center: { label: 'Center', description: 'Center active window without resizing' },
  restore: { label: 'Restore', description: 'Restore previous window state' },
  grid: { label: 'Grid / Tile', description: 'Arrange all windows in a grid layout' },
  focus: { label: 'Focus', description: 'Hide other windows and focus current app' },
  horizontalSpread: { label: 'Horizontal Spread', description: 'Spread windows horizontally' },
  verticalSpread: { label: 'Vertical Spread', description: 'Stack windows vertically' },
  cascade: { label: 'Cascade', description: 'Cascade windows diagonally' },
};

const HOTKEY_ACTION_ORDER: SquaresHotkeyAction[] = [
  'leftHalf',
  'rightHalf',
  'topHalf',
  'bottomHalf',
  'topLeft',
  'topRight',
  'bottomLeft',
  'bottomRight',
  'firstThird',
  'centerThird',
  'lastThird',
  'firstTwoThirds',
  'lastTwoThirds',
  'maximize',
  'almostMaximize',
  'center',
  'restore',
  'grid',
  'focus',
  'horizontalSpread',
  'verticalSpread',
  'cascade',
];

export default function RectangleSettings() {
  const { theme } = useTheme();
  const [commands, setCommands] = useState<Record<string, string>>({});
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [hotkeys, setHotkeys] = useState<Partial<SquaresHotkeysMap>>({});
  const [hotkeyEdits, setHotkeyEdits] = useState<Partial<SquaresHotkeysMap>>({});
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const styles = getStyles(theme);

  useEffect(() => {
    if (!window.hotMicAPI) return;
    window.hotMicAPI.getRectangleCommands().then((cmds) => {
      setCommands(cmds);
      setEditValues(cmds);
    });
  }, []);

  useEffect(() => {
    if (!window.squaresAPI) return;
    let mounted = true;
    window.squaresAPI.getHotkeys()
      .then((values) => {
        if (!mounted) return;
        const next = (values ?? {}) as Partial<SquaresHotkeysMap>;
        setHotkeys(next);
        setHotkeyEdits(next);
      })
      .catch((err) => {
        if (!mounted) return;
        setHotkeyError(err instanceof Error ? err.message : 'Failed to load window shortcuts');
      });
    return () => {
      mounted = false;
    };
  }, []);

  const handleVoiceSave = useCallback(async (action: string) => {
    if (!window.hotMicAPI) return;
    const val = editValues[action]?.trim();
    if (!val) return;
    const updated = { ...commands, [action]: val };
    setCommands(updated);
    await window.hotMicAPI.setRectangleCommands(updated);
  }, [commands, editValues]);

  const handleVoiceChange = useCallback((action: string, value: string) => {
    setEditValues((prev) => ({ ...prev, [action]: value }));
  }, []);

  const handleHotkeyChange = useCallback((action: SquaresHotkeyAction, value: string) => {
    setHotkeyEdits((prev) => ({ ...prev, [action]: value }));
  }, []);

  const handleHotkeySave = useCallback(async (action: SquaresHotkeyAction) => {
    if (!window.squaresAPI?.setHotkeys) return;
    const nextValue = (hotkeyEdits[action] ?? '').trim();
    try {
      await window.squaresAPI.setHotkeys({ [action]: nextValue });
      setHotkeys((prev) => ({ ...prev, [action]: nextValue }));
      setHotkeyEdits((prev) => ({ ...prev, [action]: nextValue }));
      setHotkeyError(null);
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : `Failed to update shortcut: ${action}`);
    }
  }, [hotkeyEdits]);

  const handleHotkeyClear = useCallback(async (action: SquaresHotkeyAction) => {
    if (!window.squaresAPI?.setHotkeys) return;
    try {
      await window.squaresAPI.setHotkeys({ [action]: '' });
      setHotkeys((prev) => ({ ...prev, [action]: '' }));
      setHotkeyEdits((prev) => ({ ...prev, [action]: '' }));
      setHotkeyError(null);
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : `Failed to clear shortcut: ${action}`);
    }
  }, []);

  const handleResetHotkeys = useCallback(async () => {
    if (!window.squaresAPI?.resetHotkeys || !window.squaresAPI.getHotkeys) return;
    try {
      await window.squaresAPI.resetHotkeys();
      const refreshed = await window.squaresAPI.getHotkeys();
      const next = (refreshed ?? {}) as Partial<SquaresHotkeysMap>;
      setHotkeys(next);
      setHotkeyEdits(next);
      setHotkeyError(null);
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to reset window shortcuts');
    }
  }, []);

  // Voice actions to show: defaults first, then custom keys from saved preferences
  const allVoiceActions = [...VOICE_ACTION_ORDER];
  for (const key of Object.keys(commands)) {
    if (!allVoiceActions.includes(key)) allVoiceActions.push(key);
  }

  return (
    <div style={styles.container}>
      <div style={styles.group}>
        <h3 style={styles.groupTitle}>Keyboard Shortcuts (Squares)</h3>
        <p style={styles.headerDescription}>
          Rectangle-style keyboard shortcuts for window actions. Clearing these only disables
          keyboard triggers and does not disable Hot Mic voice commands.
        </p>

        {HOTKEY_ACTION_ORDER.map((action, i) => {
          const meta = HOTKEY_ACTION_META[action];
          return (
            <div key={`hotkey-${action}`}>
              {i > 0 && <div style={styles.divider} />}
              <div style={{ padding: '4px 0' }}>
                <div style={styles.actionHeader}>
                  <span style={styles.actionLabel}>{meta.label}</span>
                  <span style={styles.actionName}>{action}</span>
                </div>
                <div style={styles.hotkeyRow}>
                  <input
                    type="text"
                    value={hotkeyEdits[action] ?? hotkeys[action] ?? ''}
                    onChange={(e) => handleHotkeyChange(action, e.target.value)}
                    placeholder={`Shortcut for ${action}`}
                    style={styles.input}
                    onBlur={() => handleHotkeySave(action)}
                    onKeyDown={(e) => e.key === 'Enter' && handleHotkeySave(action)}
                  />
                  <button
                    type="button"
                    onClick={() => handleHotkeyClear(action)}
                    style={styles.clearButton}
                  >
                    Clear
                  </button>
                </div>
              </div>
              <p style={styles.description}>{meta.description}</p>
            </div>
          );
        })}

        <div style={styles.hotkeyFooter}>
          <button
            type="button"
            onClick={handleResetHotkeys}
            style={styles.resetButton}
          >
            Reset Keyboard Shortcuts to Defaults
          </button>
        </div>
        {hotkeyError && <p style={styles.error}>{hotkeyError}</p>}
      </div>

      <div style={styles.sectionDivider} />

      <div style={styles.group}>
        <h3 style={styles.groupTitle}>Voice Commands (Hot Mic)</h3>
        <p style={styles.headerDescription}>
          Voice commands that trigger window management actions. Edit the comma-separated
          trigger phrases for each action.
        </p>

        {allVoiceActions.map((action, i) => {
          const meta = VOICE_ACTION_META[action];
          const label = meta?.label || action;
          const desc = meta?.description || `Window action: ${action}`;

          return (
            <div key={action}>
              {i > 0 && <div style={styles.divider} />}
              <div style={{ padding: '4px 0' }}>
                <div style={styles.actionHeader}>
                  <span style={styles.actionLabel}>{label}</span>
                  <span style={styles.actionName}>{action}</span>
                </div>
                <input
                  type="text"
                  value={editValues[action] ?? commands[action] ?? ''}
                  onChange={(e) => handleVoiceChange(action, e.target.value)}
                  placeholder={`Trigger phrases for ${action}`}
                  style={{ ...styles.input, marginTop: '4px', width: '100%' }}
                  onBlur={() => handleVoiceSave(action)}
                  onKeyDown={(e) => e.key === 'Enter' && handleVoiceSave(action)}
                />
              </div>
              <p style={styles.description}>{desc}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const getStyles = (theme: Theme): Record<string, React.CSSProperties> => ({
  container: {
    padding: 0,
  },
  group: {
    padding: 0,
  },
  groupTitle: {
    fontSize: '11px',
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: theme.textSecondary,
    margin: '0 0 8px 0',
  },
  sectionDivider: {
    height: '1px',
    backgroundColor: theme.border,
    margin: '16px 0',
  },
  headerDescription: {
    fontSize: '11px',
    color: theme.textSecondary,
    margin: '0 0 12px 0',
    lineHeight: 1.4,
  },
  divider: {
    height: '1px',
    backgroundColor: theme.border,
    margin: '12px 0',
  },
  actionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  actionLabel: {
    fontSize: '12px',
    color: theme.text,
    fontWeight: 400,
  },
  actionName: {
    fontSize: '10px',
    color: theme.textSecondary,
    fontFamily: 'monospace',
  },
  description: {
    fontSize: '11px',
    color: theme.textSecondary,
    margin: '4px 0 0 0',
    lineHeight: 1.4,
  },
  hotkeyRow: {
    display: 'flex',
    gap: '8px',
    marginTop: '4px',
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
  clearButton: {
    backgroundColor: 'transparent',
    border: `1px solid ${theme.border}`,
    color: theme.textSecondary,
    borderRadius: '6px',
    fontSize: '11px',
    padding: '4px 10px',
    cursor: 'pointer',
  },
  hotkeyFooter: {
    marginTop: '12px',
  },
  resetButton: {
    backgroundColor: theme.isDark ? theme.bg : '#fff',
    border: `1px solid ${theme.border}`,
    color: theme.text,
    borderRadius: '6px',
    fontSize: '11px',
    padding: '6px 10px',
    cursor: 'pointer',
  },
  error: {
    fontSize: '11px',
    color: theme.error,
    margin: '8px 0 0 0',
  },
});
