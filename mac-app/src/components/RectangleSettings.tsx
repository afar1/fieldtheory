// =============================================================================
// RectangleSettings - Window management voice command settings.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useTheme, Theme } from '../contexts/ThemeContext';
import { normalizeSquaresConfig, type NormalizedSquaresConfig } from '../utils/squaresConfig';
import {
  SettingsDisabledBlock,
  SettingsDivider,
  SettingsRow,
  SettingsSectionHeading,
  SettingsToggle,
} from './settings/SettingsPrimitives';

type HeightConfig = Pick<
  NormalizedSquaresConfig,
  'focusHeightPercent' | 'focusKeepHeight' | 'focusWidthPercent' | 'horizontalHeightPercent' | 'horizontalKeepHeight' | 'horizontalHideOthers'
>;

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
  const [squaresEnabled, setSquaresEnabled] = useState(true);
  const [showInCommandLauncher, setShowInCommandLauncher] = useState(true);
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
    const applyConfig = (config: Partial<NormalizedSquaresConfig>) => {
      const nextConfig = normalizeSquaresConfig(config);
      setSquaresEnabled(nextConfig.enabled);
      setShowInCommandLauncher(nextConfig.showInCommandLauncher);
      setHeightConfig({
        focusHeightPercent: nextConfig.focusHeightPercent,
        focusKeepHeight: nextConfig.focusKeepHeight,
        focusWidthPercent: nextConfig.focusWidthPercent,
        horizontalHeightPercent: nextConfig.horizontalHeightPercent,
        horizontalKeepHeight: nextConfig.horizontalKeepHeight,
        horizontalHideOthers: nextConfig.horizontalHideOthers,
      });
    };

    window.squaresAPI.getConfig().then(applyConfig);
    return window.squaresAPI.onConfigChanged(applyConfig);
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
      <SettingsSectionHeading
        theme={theme}
        title="Window Management"
        description="Turn spoken window actions on or off. Portable command visibility can stay on separately."
      />

      <SettingsRow
        theme={theme}
        label="Enable window management"
        hint="When off, Field Theory will stop moving and arranging windows until you turn it back on."
        control={(
          <SettingsToggle
            theme={theme}
            checked={squaresEnabled}
            onClick={() => {
              const nextEnabled = !squaresEnabled;
              setSquaresEnabled(nextEnabled);
              window.squaresAPI?.setConfig({ enabled: nextEnabled });
            }}
          />
        )}
      />

      <SettingsDivider theme={theme} />

      <SettingsSectionHeading
        theme={theme}
        title="Portable Commands"
      />
      <SettingsRow
        theme={theme}
        label="Show in portable commands"
        hint="Keep window actions available in `⌘⇧K` even when the main window-management toggle is off."
        control={(
          <input
            type="checkbox"
            checked={showInCommandLauncher}
            onChange={(e) => {
              const next = e.target.checked;
              setShowInCommandLauncher(next);
              window.squaresAPI?.setConfig({ showInCommandLauncher: next });
            }}
            style={styles.checkbox}
          />
        )}
        align="flex-start"
      />

      <SettingsDisabledBlock disabled={!squaresEnabled}>
        <SettingsDivider theme={theme} />

        {/* Window Height Settings */}
        <div style={styles.group}>
          <SettingsSectionHeading
            theme={theme}
            title="Window Height"
            description="Control the size of windows when using Focus and Horizontal actions."
          />

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

        <SettingsDivider theme={theme} />

        {/* Voice Commands */}
        <div style={styles.group}>
          <SettingsSectionHeading
            theme={theme}
            title="Voice Commands (Hot Mic)"
            description="Voice commands trigger window management actions. Keyboard shortcuts are not configured here anymore; use your normal macOS or app shortcuts if needed."
          />

          {allVoiceActions.map((action, i) => {
            const meta = VOICE_ACTION_META[action];
            const label = meta?.label || action;
            const header = meta?.description || label;

            return (
              <div key={action}>
                {i > 0 && <div style={styles.divider} />}
                <div style={{ padding: '4px 0' }}>
                  <div style={styles.actionHeader}>
                    <span style={styles.actionLabel}>{header}</span>
                  </div>
                  <input
                    type="text"
                    value={editValues[action] ?? commands[action] ?? ''}
                    onChange={(e) => handleVoiceChange(action, e.target.value)}
                    placeholder={`Trigger phrases for ${label}`}
                    style={{ ...styles.input, marginTop: '4px', width: '100%' }}
                    onBlur={() => handleVoiceSave(action)}
                    onKeyDown={(e) => e.key === 'Enter' && handleVoiceSave(action)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </SettingsDisabledBlock>
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
  checkbox: {
    width: '16px',
    height: '16px',
    marginTop: '2px',
    flexShrink: 0,
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
    fontWeight: 600,
  },
  description: {
    margin: '4px 0 0',
    fontSize: '12px',
    lineHeight: 1.45,
    color: theme.textSecondary,
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
