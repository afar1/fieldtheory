import { LAUNCHER_SECTIONS, normalizeLauncherSections, type LauncherSection } from '../../electron/shared/launcherSections';
import { useCallback, useEffect, useState } from 'react';
import {
  getLauncherDefaultPanelSourceLabel,
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
  const [sections, setSections] = useState<LauncherSection[]>([...LAUNCHER_SECTIONS]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [enabledKinds, setEnabledKinds] = useState<Record<LauncherRootSearchKind, boolean>>(
    DEFAULT_LAUNCHER_ROOT_SEARCH_ENABLED_KINDS,
  );

  useEffect(() => {
    window.commandsAPI?.getLauncherSettings?.()
      .then((settings) => {
        setEnabledKinds(normalizeLauncherRootSearchEnabledKinds(settings?.rootSearchEnabledKinds));
        setSections(normalizeLauncherSections(settings?.sections));
        setLoading(false);
      })
      .catch((err) => {
        console.error('[LauncherSettings] Failed to load launcher settings:', err);
        setError('Could not load launcher settings. Reopen Settings to try again.');
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

  const saveSections = async (next: LauncherSection[]) => {
    if (loading || saving || !next.length) return;
    setSaving(true);
    setError('');
    try {
      if (!window.commandsAPI?.setLauncherSettings) throw new Error('Launcher settings are unavailable.');
      const saved = await window.commandsAPI.setLauncherSettings({ rootSearchEnabledKinds: enabledKinds, sections: next });
      setSections(normalizeLauncherSections(saved.sections));
    } catch {
      setError('Could not save launcher sections. Try again.');
    } finally { setSaving(false); }
  };

  const moveSection = (index: number, direction: number) => {
    const next = [...sections];
    [next[index], next[index + direction]] = [next[index + direction], next[index]];
    void saveSections(next);
  };

  const toggleKind = useCallback((kind: LauncherRootSearchKind) => {
    if (loading || saving) return;
    void persistEnabledKinds({
      ...enabledKinds,
      [kind]: !enabledKinds[kind],
    });
  }, [enabledKinds, persistEnabledKinds, loading, saving]);

  const reorderButtonStyle = { background: 'transparent', color: theme.text, border: `1px solid ${theme.border ?? '#888'}`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SETTINGS_CARD_GAP }}>
      <SettingsCard theme={theme}>
        <SettingsSectionHeading theme={theme} title="Launcher sections" description="Choose the sections Tab cycles through and their order. Keep at least one enabled." />
        {[...sections, ...LAUNCHER_SECTIONS.filter(section => !sections.includes(section))].map(section => {
          const index = sections.indexOf(section);
          const enabled = index >= 0;
          const label = getLauncherDefaultPanelSourceLabel(section);
          return <div key={section} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0' }}>
            <label style={{ flex: 1, color: theme.text }}>
              <input type="checkbox" checked={enabled} disabled={loading || saving || (enabled && sections.length === 1)}
                onChange={() => void saveSections(enabled ? sections.filter(item => item !== section) : [...sections, section])} /> {label}
            </label>
            <button style={reorderButtonStyle} aria-label={`Move ${label} up`} disabled={loading || saving || index <= 0} onClick={() => moveSection(index, -1)}>↑</button>
            <button style={reorderButtonStyle} aria-label={`Move ${label} down`} disabled={loading || saving || index < 0 || index === sections.length - 1} onClick={() => moveSection(index, 1)}>↓</button>
          </div>;
        })}
        {error && <p role="alert" style={{ color: theme.error }}>{error}</p>}
      </SettingsCard>
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
