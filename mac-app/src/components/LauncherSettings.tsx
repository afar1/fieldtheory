import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_LAUNCHER_ROOT_SEARCH_ENABLED_KINDS,
  LAUNCHER_ROOT_SEARCH_KIND_LABELS,
  normalizeLauncherRootSearchEnabledKinds,
  type LauncherRootSearchKind,
} from '../commandLauncherUtils';
import { useTheme } from '../contexts/ThemeContext';
import {
  SETTINGS_CARD_GAP,
  SettingsCard,
  SettingsRow,
  SettingsSectionHeading,
  SettingsToggle,
} from './settings/SettingsPrimitives';

const ACTIVE_LAUNCHER_ROOT_KINDS: LauncherRootSearchKind[] = ['file'];

export default function LauncherSettings() {
  const { theme } = useTheme();
  const [enabledKinds, setEnabledKinds] = useState<Record<LauncherRootSearchKind, boolean>>(
    DEFAULT_LAUNCHER_ROOT_SEARCH_ENABLED_KINDS,
  );

  useEffect(() => {
    window.commandsAPI?.getLauncherSettings?.()
      .then((settings) => {
        setEnabledKinds(normalizeLauncherRootSearchEnabledKinds(settings?.rootSearchEnabledKinds));
      })
      .catch((err) => {
        console.error('[LauncherSettings] Failed to load launcher settings:', err);
      });
  }, []);

  const persistEnabledKinds = useCallback(async (next: Record<LauncherRootSearchKind, boolean>) => {
    setEnabledKinds(next);
    try {
      const saved = await window.commandsAPI?.setLauncherSettings?.({ rootSearchEnabledKinds: next });
      if (saved?.rootSearchEnabledKinds) {
        setEnabledKinds(normalizeLauncherRootSearchEnabledKinds(saved.rootSearchEnabledKinds));
      }
    } catch (err) {
      console.error('[LauncherSettings] Failed to save launcher settings:', err);
    }
  }, []);

  const toggleKind = useCallback((kind: LauncherRootSearchKind) => {
    void persistEnabledKinds({
      ...enabledKinds,
      [kind]: !enabledKinds[kind],
    });
  }, [enabledKinds, persistEnabledKinds]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SETTINGS_CARD_GAP }}>
      <SettingsCard theme={theme}>
        <SettingsSectionHeading
          theme={theme}
          title="Launcher"
          description="Choose which supported root search sources the launcher includes."
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {ACTIVE_LAUNCHER_ROOT_KINDS.map((kind, index) => (
            <SettingsRow
              key={kind}
              theme={theme}
              label={LAUNCHER_ROOT_SEARCH_KIND_LABELS[kind]}
              hint="Indexed files in launcher root search."
              last={index === ACTIVE_LAUNCHER_ROOT_KINDS.length - 1}
              control={(
                <SettingsToggle
                  theme={theme}
                  checked={enabledKinds[kind]}
                  onClick={() => toggleKind(kind)}
                  activeColor={theme.success}
                />
              )}
            />
          ))}
        </div>
      </SettingsCard>
    </div>
  );
}
