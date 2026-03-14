// =============================================================================
// RectangleSettings - Window management voice command settings.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useTheme, Theme } from '../contexts/ThemeContext';

interface HeightConfig {
  focusHeightPercent: number;
  focusKeepHeight: boolean;
  focusWidthPercent: number;
  horizontalHeightPercent: number;
  horizontalKeepHeight: boolean;
  horizontalHideOthers: boolean;
}

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

export default function RectangleSettings() {
  const { theme } = useTheme();
  const [commands, setCommands] = useState<Record<string, string>>({});
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [heightConfig, setHeightConfig] = useState<HeightConfig>({
    focusHeightPercent: 80,
    focusKeepHeight: false,
    focusWidthPercent: 60,
    horizontalHeightPercent: 80,
    horizontalKeepHeight: true,
    horizontalHideOthers: true,
  });
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
    window.squaresAPI.getConfig().then((config) => {
      if (!config) return;
      setHeightConfig({
        focusHeightPercent: config.focusHeightPercent ?? 80,
        focusKeepHeight: config.focusKeepHeight ?? false,
        focusWidthPercent: config.focusWidthPercent ?? 60,
        horizontalHeightPercent: config.horizontalHeightPercent ?? 80,
        horizontalKeepHeight: config.horizontalKeepHeight ?? true,
        horizontalHideOthers: config.horizontalHideOthers ?? true,
      });
    });
  }, []);

  const saveHeightConfig = useCallback(async (updates: Partial<HeightConfig>) => {
    if (!window.squaresAPI) return;
    setHeightConfig((prev) => {
      const next = { ...prev, ...updates };
      window.squaresAPI!.setConfig(next);
      return next;
    });
  }, []);

  // Update local state without saving (for typing in number inputs)
  const updateLocalConfig = useCallback((updates: Partial<HeightConfig>) => {
    setHeightConfig((prev) => ({ ...prev, ...updates }));
  }, []);

  // Clamp and save a numeric field on blur
  const commitNumericField = useCallback((field: keyof HeightConfig, min: number, max: number) => {
    const raw = Number(heightConfig[field]);
    const clamped = Math.max(min, Math.min(max, isNaN(raw) ? min : raw));
    saveHeightConfig({ [field]: clamped });
  }, [heightConfig, saveHeightConfig]);

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

  // Voice actions to show: defaults first, then custom keys from saved preferences
  const allVoiceActions = [...VOICE_ACTION_ORDER];
  for (const key of Object.keys(commands)) {
    if (!allVoiceActions.includes(key)) allVoiceActions.push(key);
  }

  return (
    <div style={styles.container}>
      {/* Window Height Settings */}
      <div style={styles.group}>
        <h3 style={styles.groupTitle}>Window Height</h3>
        <p style={styles.headerDescription}>
          Control the size of windows when using Focus and Horizontal actions.
        </p>

        {/* Focus */}
        <div style={{ padding: '4px 0' }}>
          <div style={styles.actionHeader}>
            <span style={styles.actionLabel}>Focus</span>
          </div>
          <p style={styles.description}>Size of the focused window</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={heightConfig.focusKeepHeight}
                onChange={(e) => saveHeightConfig({ focusKeepHeight: e.target.checked })}
                style={{ accentColor: theme.accent }}
              />
              <span style={{ fontSize: '12px', color: theme.text }}>Keep current height</span>
            </label>
            {!heightConfig.focusKeepHeight && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '12px', color: theme.textSecondary }}>Height</span>
                <input
                  type="number"
                  min={30}
                  max={100}
                  step={5}
                  value={heightConfig.focusHeightPercent}
                  onChange={(e) => updateLocalConfig({ focusHeightPercent: Number(e.target.value) })}
                  onBlur={() => commitNumericField('focusHeightPercent', 30, 100)}
                  style={{ width: '48px', fontSize: '12px', padding: '2px 4px', borderRadius: '4px', border: `1px solid ${theme.border}`, backgroundColor: theme.isDark ? theme.surface1 : '#fff', color: theme.text, textAlign: 'center' }}
                />
                <span style={{ fontSize: '12px', color: theme.textSecondary }}>%</span>
              </label>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ fontSize: '12px', color: theme.textSecondary }}>Width</span>
              <input
                type="number"
                min={30}
                max={100}
                step={5}
                value={heightConfig.focusWidthPercent}
                onChange={(e) => updateLocalConfig({ focusWidthPercent: Number(e.target.value) })}
                onBlur={() => commitNumericField('focusWidthPercent', 30, 100)}
                style={{ width: '48px', fontSize: '12px', padding: '2px 4px', borderRadius: '4px', border: `1px solid ${theme.border}`, backgroundColor: theme.isDark ? theme.surface1 : '#fff', color: theme.text, textAlign: 'center' }}
              />
              <span style={{ fontSize: '12px', color: theme.textSecondary }}>%</span>
            </label>
          </div>
        </div>

        <div style={styles.divider} />

        {/* Horizontal height */}
        <div style={{ padding: '4px 0' }}>
          <div style={styles.actionHeader}>
            <span style={styles.actionLabel}>Horizontal</span>
          </div>
          <p style={styles.description}>Height of windows when spread horizontally</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={heightConfig.horizontalHideOthers}
                onChange={(e) => saveHeightConfig({ horizontalHideOthers: e.target.checked })}
                style={{ accentColor: theme.accent }}
              />
              <span style={{ fontSize: '12px', color: theme.text }}>Hide other windows</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={heightConfig.horizontalKeepHeight}
                onChange={(e) => saveHeightConfig({ horizontalKeepHeight: e.target.checked })}
                style={{ accentColor: theme.accent }}
              />
              <span style={{ fontSize: '12px', color: theme.text }}>Keep current height</span>
            </label>
            {!heightConfig.horizontalKeepHeight && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ fontSize: '12px', color: theme.textSecondary }}>Height</span>
                <input
                  type="number"
                  min={30}
                  max={100}
                  step={5}
                  value={heightConfig.horizontalHeightPercent}
                  onChange={(e) => updateLocalConfig({ horizontalHeightPercent: Number(e.target.value) })}
                  onBlur={() => commitNumericField('horizontalHeightPercent', 30, 100)}
                  style={{ width: '48px', fontSize: '12px', padding: '2px 4px', borderRadius: '4px', border: `1px solid ${theme.border}`, backgroundColor: theme.isDark ? theme.surface1 : '#fff', color: theme.text, textAlign: 'center' }}
                />
                <span style={{ fontSize: '12px', color: theme.textSecondary }}>%</span>
              </label>
            )}
          </div>
        </div>
      </div>

      <div style={styles.sectionDivider} />

      {/* Voice Commands */}
      <div style={styles.group}>
        <h3 style={styles.groupTitle}>Voice Commands (Hot Mic)</h3>
        <p style={styles.headerDescription}>
          Voice commands trigger window management actions. Keyboard shortcuts are not configured
          here anymore; use your normal macOS/app shortcuts if needed.
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
