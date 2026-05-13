import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_LAUNCHER_ROOT_SEARCH_ENABLED_KINDS,
  LAUNCHER_ROOT_SEARCH_KIND_LABELS,
  normalizeLauncherRootSearchEnabledKinds,
  type LauncherRootSearchKind,
} from '../commandLauncherUtils';
import { useTheme } from '../contexts/ThemeContext';
import {
  SettingsBadge,
  SettingsInsetGroup,
  SettingsRow,
  SettingsSectionHeading,
  SettingsToggle,
} from './settings/SettingsPrimitives';

const ACTIVE_LAUNCHER_ROOT_KINDS: LauncherRootSearchKind[] = ['app', 'file'];
const PLANNED_LAUNCHER_ROOT_KINDS: LauncherRootSearchKind[] = [
  'system-setting',
  'contact',
  'recent-document',
  'url',
  'web-search',
  'calculator',
  'unit',
  'currency',
  'time-zone',
  'dictionary',
  'calendar',
  'system-command',
  'terminal-command',
];

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div>
        <SettingsSectionHeading theme={theme} title="Launcher" />
        <SettingsInsetGroup theme={theme}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {ACTIVE_LAUNCHER_ROOT_KINDS.map((kind) => (
              <SettingsRow
                key={kind}
                theme={theme}
                label={LAUNCHER_ROOT_SEARCH_KIND_LABELS[kind]}
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
        </SettingsInsetGroup>
      </div>

      <div>
        <SettingsSectionHeading theme={theme} title="Later" />
        <SettingsInsetGroup theme={theme}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {PLANNED_LAUNCHER_ROOT_KINDS.map((kind) => (
              <SettingsRow
                key={kind}
                theme={theme}
                label={LAUNCHER_ROOT_SEARCH_KIND_LABELS[kind]}
                control={(
                  <>
                    <SettingsBadge theme={theme}>{enabledKinds[kind] ? 'On' : 'Off'}</SettingsBadge>
                    <SettingsToggle
                      theme={theme}
                      checked={enabledKinds[kind]}
                      onClick={() => {}}
                      disabled
                    />
                  </>
                )}
              />
            ))}
          </div>
        </SettingsInsetGroup>
      </div>
    </div>
  );
}
