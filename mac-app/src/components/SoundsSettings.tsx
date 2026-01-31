// =============================================================================
// SoundsSettings - Sound configuration for various app events.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useTheme, Theme } from '../contexts/ThemeContext';

interface SoundConfig {
  enabled: boolean;
  librarianEnabled: boolean;
}

export default function SoundsSettings() {
  const { theme } = useTheme();

  const [librarianSoundEnabled, setLibrarianSoundEnabled] = useState(true);
  const [soundsEnabled, setSoundsEnabled] = useState(false);

  const styles = getStyles(theme);

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
    <div style={styles.container}>
      {/* Librarian Sound Toggle */}
      <div style={styles.row}>
        <span style={styles.rowLabel}>Librarian Sound</span>
        <button
          onClick={() => handleLibrarianSoundChange(!librarianSoundEnabled)}
          style={{ ...styles.toggle, backgroundColor: librarianSoundEnabled ? theme.success : '#d1d5db' }}
          title={librarianSoundEnabled ? 'Librarian sound enabled' : 'Librarian sound disabled'}
        >
          <span style={{ ...styles.toggleKnob, transform: librarianSoundEnabled ? 'translateX(20px)' : 'translateX(2px)' }} />
        </button>
      </div>
      <p style={styles.description}>
        Plays when a new Librarian reading is created.
      </p>

      <div style={styles.divider} />

      {/* Other Sounds Toggle */}
      <div style={styles.row}>
        <span style={styles.rowLabel}>Other Sounds</span>
        <button
          onClick={() => handleSoundsEnabledChange(!soundsEnabled)}
          style={{ ...styles.toggle, backgroundColor: soundsEnabled ? theme.success : '#d1d5db' }}
          title={soundsEnabled ? 'Other sounds enabled' : 'Other sounds disabled'}
        >
          <span style={{ ...styles.toggleKnob, transform: soundsEnabled ? 'translateX(20px)' : 'translateX(2px)' }} />
        </button>
      </div>
      <p style={styles.description}>
        Recording, transcription, window, and paste sounds.
      </p>
    </div>
  );
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
});
