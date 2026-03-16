// =============================================================================
// SoundsSettings - Sound configuration for various app events.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { SettingsDivider, SettingsRow, SettingsToggle } from './settings/SettingsPrimitives';

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
    <div style={{ padding: 0 }}>
      <SettingsRow
        theme={theme}
        label="Librarian Sound"
        hint="Plays when a new Librarian artifact is created."
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

      <SettingsDivider theme={theme} margin="12px 0" />

      <SettingsRow
        theme={theme}
        label="Other Sounds"
        hint="Recording, transcription, window, and paste sounds."
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
    </div>
  );
}
