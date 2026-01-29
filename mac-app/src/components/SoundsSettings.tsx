// =============================================================================
// SoundsSettings - Sound configuration for various app events.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useTheme, Theme } from '../contexts/ThemeContext';

interface SoundConfig {
  enabled: boolean;
  librarianEnabled: boolean;
  recordingStart?: string;
  recordingStop?: string;
  recordingCancel?: string;
  windowOpen?: string;
  windowClose?: string;
  transcribing?: string;
  paste?: string;
}

interface SoundOption {
  id: string;
  name: string;
  category: string;
}

type SoundEvent = 'recordingStart' | 'recordingStop' | 'recordingCancel' | 'windowOpen' | 'windowClose' | 'transcribing' | 'paste';

export default function SoundsSettings() {
  const { theme } = useTheme();

  const [librarianSoundEnabled, setLibrarianSoundEnabled] = useState(true);
  const [soundsEnabled, setSoundsEnabled] = useState(false);
  const [recordingStartSound, setRecordingStartSound] = useState<string | undefined>('ButtonClickDown.mp3');
  const [recordingStopSound, setRecordingStopSound] = useState<string | undefined>('ButtonClickUp.mp3');
  const [recordingCancelSound, setRecordingCancelSound] = useState<string | undefined>('AlertBonk.mp3');
  const [windowOpenSound, setWindowOpenSound] = useState<string | undefined>('WindowOpen.mp3');
  const [windowCloseSound, setWindowCloseSound] = useState<string | undefined>('WindowClose.mp3');
  const [transcribingSound, setTranscribingSound] = useState<string | undefined>('Beep.mp3');
  const [pasteSound, setPasteSound] = useState<string | undefined>('Click.mp3');
  const [availableSounds, setAvailableSounds] = useState<SoundOption[]>([]);

  const styles = getStyles(theme);

  useEffect(() => {
    if (!window.transcribeAPI) return;

    const fetchSounds = async () => {
      try {
        const defaultConfig: SoundConfig = {
          enabled: false,
          librarianEnabled: true,
          recordingStart: 'ButtonClickDown.mp3',
          recordingStop: 'ButtonClickUp.mp3',
          recordingCancel: 'AlertBonk.mp3',
          windowOpen: 'WindowOpen.mp3',
          windowClose: 'WindowClose.mp3',
          transcribing: 'Beep.mp3',
          paste: 'Click.mp3',
        };
        const [soundConfig, sounds] = await Promise.all([
          window.transcribeAPI!.getSoundConfig?.() ?? defaultConfig,
          window.transcribeAPI!.getAvailableSounds?.() ?? [],
        ]);
        setLibrarianSoundEnabled(soundConfig.librarianEnabled ?? true);
        setSoundsEnabled(soundConfig.enabled ?? false);
        setRecordingStartSound(soundConfig.recordingStart);
        setRecordingStopSound(soundConfig.recordingStop);
        setRecordingCancelSound(soundConfig.recordingCancel);
        setWindowOpenSound(soundConfig.windowOpen);
        setWindowCloseSound(soundConfig.windowClose);
        setTranscribingSound(soundConfig.transcribing);
        setPasteSound(soundConfig.paste);
        setAvailableSounds(sounds);
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

  const handleSoundToggle = useCallback(async (event: SoundEvent, currentValue: string | undefined, defaultValue: string) => {
    if (!window.transcribeAPI?.setSoundConfig) return;

    // Toggle: if has value, set to empty (disabled). If empty, set to default.
    const newValue = currentValue ? '' : defaultValue;

    if (event === 'recordingStart') setRecordingStartSound(newValue || undefined);
    if (event === 'recordingStop') setRecordingStopSound(newValue || undefined);
    if (event === 'recordingCancel') setRecordingCancelSound(newValue || undefined);
    if (event === 'windowOpen') setWindowOpenSound(newValue || undefined);
    if (event === 'windowClose') setWindowCloseSound(newValue || undefined);
    if (event === 'transcribing') setTranscribingSound(newValue || undefined);
    if (event === 'paste') setPasteSound(newValue || undefined);

    try {
      await window.transcribeAPI.setSoundConfig({ [event]: newValue });
    } catch (err) {
      console.error(`Failed to toggle ${event} sound:`, err);
    }
  }, []);

  const handleSoundChange = useCallback(async (event: SoundEvent, soundId: string) => {
    if (!window.transcribeAPI?.setSoundConfig) return;

    if (event === 'recordingStart') setRecordingStartSound(soundId || undefined);
    if (event === 'recordingStop') setRecordingStopSound(soundId || undefined);
    if (event === 'recordingCancel') setRecordingCancelSound(soundId || undefined);
    if (event === 'windowOpen') setWindowOpenSound(soundId || undefined);
    if (event === 'windowClose') setWindowCloseSound(soundId || undefined);
    if (event === 'transcribing') setTranscribingSound(soundId || undefined);
    if (event === 'paste') setPasteSound(soundId || undefined);

    try {
      await window.transcribeAPI.setSoundConfig({ [event]: soundId });
    } catch (err) {
      console.error(`Failed to change ${event} sound:`, err);
    }
  }, []);

  const handlePreviewSound = useCallback(async (soundId: string) => {
    if (!window.transcribeAPI?.previewSound) return;

    try {
      await window.transcribeAPI.previewSound(soundId);
    } catch (err) {
      console.error('Failed to preview sound:', err);
    }
  }, []);

  const renderSoundRow = (
    label: string,
    value: string | undefined,
    event: SoundEvent,
    defaultValue: string
  ) => {
    const isEnabled = Boolean(value);

    return (
      <div style={styles.row}>
        <div style={styles.rowLeft}>
          {/* Quick toggle checkbox */}
          <button
            onClick={() => handleSoundToggle(event, value, defaultValue)}
            style={{
              ...styles.checkbox,
              backgroundColor: isEnabled ? theme.accent : 'transparent',
              borderColor: isEnabled ? theme.accent : theme.border,
            }}
            title={isEnabled ? 'Disable sound' : 'Enable sound'}
          >
            {isEnabled && (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </button>
          <span style={{ ...styles.rowLabel, opacity: isEnabled ? 1 : 0.5 }}>{label}</span>
        </div>
        <div style={styles.rowControls}>
          <select
            value={value || ''}
            onChange={(e) => handleSoundChange(event, e.target.value)}
            style={{ ...styles.selectSmall, opacity: isEnabled ? 1 : 0.5 }}
            disabled={!isEnabled}
          >
            <option value="">None</option>
            {availableSounds.map((sound) => (
              <option key={sound.id} value={sound.id}>
                {sound.name}
              </option>
            ))}
          </select>
          <button
            onClick={() => value && handlePreviewSound(value)}
            style={{ ...styles.btnGhost, opacity: isEnabled ? 1 : 0.3 }}
            title="Preview sound"
            disabled={!isEnabled}
          >
            ▶
          </button>
        </div>
      </div>
    );
  };

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

      {soundsEnabled && (
        <>
          <div style={{ ...styles.divider, margin: '8px 0' }} />

          {renderSoundRow('Start Recording', recordingStartSound, 'recordingStart', 'ButtonClickDown.mp3')}
          {renderSoundRow('Stop Recording', recordingStopSound, 'recordingStop', 'ButtonClickUp.mp3')}
          {renderSoundRow('Cancel Recording', recordingCancelSound, 'recordingCancel', 'AlertBonk.mp3')}
          {renderSoundRow('Transcribing', transcribingSound, 'transcribing', 'Beep.mp3')}
          {renderSoundRow('Open Window', windowOpenSound, 'windowOpen', 'WindowOpen.mp3')}
          {renderSoundRow('Close Window', windowCloseSound, 'windowClose', 'WindowClose.mp3')}
          {renderSoundRow('Paste Item', pasteSound, 'paste', 'Click.mp3')}

          <p style={styles.note}>
            Window sounds require restart to take effect.
          </p>
        </>
      )}
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
  rowLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  rowLabel: {
    fontSize: '12px',
    color: theme.text,
    fontWeight: 400,
  },
  rowControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  checkbox: {
    width: '16px',
    height: '16px',
    borderRadius: '4px',
    border: '1.5px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    padding: 0,
    flexShrink: 0,
  },
  selectSmall: {
    padding: '4px 8px',
    fontSize: '12px',
    color: theme.text,
    backgroundColor: theme.isDark ? theme.surface1 : '#fff',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
    cursor: 'pointer',
    minWidth: '140px',
  },
  btnGhost: {
    padding: '4px 8px',
    fontSize: '12px',
    color: theme.textSecondary,
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
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
  note: {
    fontSize: '11px',
    color: theme.textSecondary,
    marginTop: '12px',
    lineHeight: 1.4,
  },
});
