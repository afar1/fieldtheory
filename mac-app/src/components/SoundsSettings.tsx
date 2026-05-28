// =============================================================================
// SoundsSettings - Sound configuration for various app events.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import {
  SETTINGS_CARD_GAP,
  SettingsCard,
  SettingsRow,
  SettingsSectionHeading,
  SettingsToggle,
} from './settings/SettingsPrimitives';

interface SoundConfig {
  enabled: boolean;
  librarianEnabled: boolean;
}

export default function SoundsSettings() {
  const { theme } = useTheme();

  const [librarianSoundEnabled, setLibrarianSoundEnabled] = useState(true);
  const [soundsEnabled, setSoundsEnabled] = useState(false);
  useEffect(() => {
    if (!window.transcribeAPI) return;

    const fetchSounds = async () => {
      try {
        const defaultConfig: SoundConfig = {
          enabled: false,
          librarianEnabled: true,
        };
        const soundConfig = await window.transcribeAPI!.getSoundConfig?.() ?? defaultConfig;
        setLibrarianSoundEnabled(soundConfig.librarianEnabled ?? true);
        setSoundsEnabled(soundConfig.enabled ?? false);
      } catch (err) {
        console.error('Failed to fetch sound config:', err);
      }
    };

    fetchSounds();
  }, []);

  const handleLibrarianSoundChange = useCallback(async (enabled: boolean) => {
    if (!window.transcribeAPI?.setSoundConfig) return;

    setLibrarianSoundEnabled(enabled);
    try {
      await window.transcribeAPI.setSoundConfig({ librarianEnabled: enabled });
    } catch (err) {
      console.error('Failed to change librarian sound setting:', err);
    }
  }, []);

  const handleSoundsEnabledChange = useCallback(async (enabled: boolean) => {
    if (!window.transcribeAPI?.setSoundConfig) return;

    setSoundsEnabled(enabled);
    try {
      await window.transcribeAPI.setSoundConfig({ enabled });
    } catch (err) {
      console.error('Failed to change sounds enabled setting:', err);
    }
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SETTINGS_CARD_GAP }}>
      <SettingsCard theme={theme}>
        <SettingsSectionHeading
          theme={theme}
          title="Librarian"
          description="Plays when a new Librarian artifact is created. Quiet by design."
        />
        <SettingsRow
          theme={theme}
          label="Librarian sound"
          hint="Use the existing artifact-created sound."
          last
          control={(
            <SettingsToggle
              theme={theme}
              checked={librarianSoundEnabled}
              onClick={() => handleLibrarianSoundChange(!librarianSoundEnabled)}
              activeColor={theme.success}
              title={librarianSoundEnabled ? 'Librarian sound enabled' : 'Librarian sound disabled'}
            />
          )}
        />
      </SettingsCard>

      <SettingsCard theme={theme}>
        <SettingsSectionHeading
          theme={theme}
          title="Other sounds"
          description="Recording, transcription, window, and paste sounds."
        />
        <SettingsRow
          theme={theme}
          label="Other sounds"
          hint="Uses the current single app-wide sound toggle."
          last
          control={(
            <SettingsToggle
              theme={theme}
              checked={soundsEnabled}
              onClick={() => handleSoundsEnabledChange(!soundsEnabled)}
              activeColor={theme.success}
              title={soundsEnabled ? 'Other sounds enabled' : 'Other sounds disabled'}
            />
          )}
        />
      </SettingsCard>
    </div>
  );
}
