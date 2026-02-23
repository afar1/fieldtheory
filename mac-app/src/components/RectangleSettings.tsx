// =============================================================================
// RectangleSettings - Voice-triggered window management commands.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useTheme, Theme } from '../contexts/ThemeContext';

/** Window action metadata for display. */
const ACTION_META: Record<string, { label: string; description: string }> = {
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

/** Ordered list of actions for consistent rendering. */
const ACTION_ORDER = [
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

export default function RectangleSettings() {
  const { theme } = useTheme();
  const [commands, setCommands] = useState<Record<string, string>>({});
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const styles = getStyles(theme);

  useEffect(() => {
    if (!window.hotMicAPI) return;
    window.hotMicAPI.getRectangleCommands().then((cmds) => {
      setCommands(cmds);
      setEditValues(cmds);
    });
  }, []);

  const handleSave = useCallback(async (action: string) => {
    if (!window.hotMicAPI) return;
    const val = editValues[action]?.trim();
    if (!val) return;
    const updated = { ...commands, [action]: val };
    setCommands(updated);
    await window.hotMicAPI.setRectangleCommands(updated);
  }, [commands, editValues]);

  const handleChange = useCallback((action: string, value: string) => {
    setEditValues(prev => ({ ...prev, [action]: value }));
  }, []);

  // Get actions to show: all from ACTION_ORDER, plus any custom ones in saved prefs
  const allActions = [...ACTION_ORDER];
  for (const key of Object.keys(commands)) {
    if (!allActions.includes(key)) allActions.push(key);
  }

  return (
    <div style={styles.container}>
      <p style={styles.headerDescription}>
        Voice commands that trigger window management actions. Edit the comma-separated
        trigger phrases for each action.
      </p>

      {allActions.map((action, i) => {
        const meta = ACTION_META[action];
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
                onChange={(e) => handleChange(action, e.target.value)}
                placeholder={`Trigger phrases for ${action}`}
                style={{ ...styles.input, marginTop: '4px', width: '100%' }}
                onBlur={() => handleSave(action)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave(action)}
              />
            </div>
            <p style={styles.description}>{desc}</p>
          </div>
        );
      })}
    </div>
  );
}

const getStyles = (theme: Theme): Record<string, React.CSSProperties> => ({
  container: {
    padding: 0,
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
  input: {
    fontSize: '12px',
    padding: '4px 8px',
    borderRadius: '6px',
    border: `1px solid ${theme.border}`,
    backgroundColor: theme.surface0,
    color: theme.text,
    flex: 1,
  },
});
