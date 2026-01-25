// =============================================================================
// SoundsSettings - Sound configuration for various app events.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import { useTheme, Theme } from '../contexts/ThemeContext';

interface SoundConfig {
  enabled: boolean;
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

export default function SoundsSettings() {
  const { theme } = useTheme();

  const [soundsEnabled, setSoundsEnabled] = useState(true);
  const [recordingStartSound, setRecordingStartSound] = useState<string | undefined>('ButtonClickDown.mp3');
  const [recordingStopSound, setRecordingStopSound] = useState<string | undefined>('ButtonClickUp.mp3');
  const [recordingCancelSound, setRecordingCancelSound] = useState<string | undefined>('AlertBonk.mp3');
  const [windowOpenSound, setWindowOpenSound] = useState<string | undefined>('WindowOpen.mp3');
  const [windowCloseSound, setWindowCloseSound] = useState<string | undefined>('WindowClose.mp3');
  const [transcribingSound, setTranscribingSound] = useState<string | undefined>('ButtonClickUp.mp3');
  const [pasteSound, setPasteSound] = useState<string | undefined>('Click.mp3');
  const [availableSounds, setAvailableSounds] = useState<SoundOption[]>([]);

  const styles = getStyles(theme);

  useEffect(() => {
    if (!window.transcribeAPI) return;

    const fetchSounds = async () => {
      try {
        const defaultConfig: SoundConfig = {
          enabled: true,
          recordingStart: 'ButtonClickDown.mp3',
          recordingStop: 'ButtonClickUp.mp3',
          recordingCancel: 'AlertBonk.mp3',
          windowOpen: 'WindowOpen.mp3',
          windowClose: 'WindowClose.mp3',
          transcribing: 'ButtonClickUp.mp3',
          paste: 'Click.mp3',
        };
        const [soundConfig, sounds] = await Promise.all([
          window.transcribeAPI!.getSoundConfig?.() ?? defaultConfig,
          window.transcribeAPI!.getAvailableSounds?.() ?? [],
        ]);
        setSoundsEnabled(soundConfig.enabled);
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

  const handleSoundsEnabledChange = useCallback(async (enabled: boolean) => {
    if (!window.transcribeAPI?.setSoundConfig) return;

    setSoundsEnabled(enabled);
    try {
      await window.transcribeAPI.setSoundConfig({ enabled });
    } catch (err) {
      console.error('Failed to change sounds enabled setting:', err);
    }
  }, []);

  const handleSoundChange = useCallback(async (event: 'recordingStart' | 'recordingStop' | 'recordingCancel' | 'windowOpen' | 'windowClose' | 'transcribing' | 'paste', soundId: string) => {
    if (!window.transcribeAPI?.setSoundConfig) return;

    if (event === 'recordingStart') setRecordingStartSound(soundId);
    if (event === 'recordingStop') setRecordingStopSound(soundId);
    if (event === 'recordingCancel') setRecordingCancelSound(soundId);
    if (event === 'windowOpen') setWindowOpenSound(soundId);
    if (event === 'windowClose') setWindowCloseSound(soundId);
    if (event === 'transcribing') setTranscribingSound(soundId);
    if (event === 'paste') setPasteSound(soundId);

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

  const renderSoundRow = (label: string, value: string | undefined, event: 'recordingStart' | 'recordingStop' | 'recordingCancel' | 'windowOpen' | 'windowClose' | 'transcribing' | 'paste') => (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <div style={styles.rowControls}>
        <select
          value={value || ''}
          onChange={(e) => handleSoundChange(event, e.target.value)}
          style={styles.selectSmall}
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
          style={styles.btnGhost}
          title="Preview sound"
        >
          ▶
        </button>
      </div>
    </div>
  );

  return (
    <div style={styles.container}>
      {/* Master toggle */}
      <div style={styles.row}>
        <span style={styles.rowLabel}>Enable Sounds</span>
        <button
          onClick={() => handleSoundsEnabledChange(!soundsEnabled)}
          style={{ ...styles.toggle, backgroundColor: soundsEnabled ? theme.success : '#d1d5db' }}
          title={soundsEnabled ? 'Sounds enabled' : 'Sounds disabled'}
        >
          <span style={{ ...styles.toggleKnob, transform: soundsEnabled ? 'translateX(20px)' : 'translateX(2px)' }} />
        </button>
      </div>

      {soundsEnabled && (
        <>
          <div style={styles.divider} />

          {renderSoundRow('Start Recording', recordingStartSound, 'recordingStart')}
          {renderSoundRow('Stop Recording', recordingStopSound, 'recordingStop')}
          {renderSoundRow('Cancel Recording', recordingCancelSound, 'recordingCancel')}
          {renderSoundRow('Transcribing', transcribingSound, 'transcribing')}
          {renderSoundRow('Open Window', windowOpenSound, 'windowOpen')}
          {renderSoundRow('Close Window', windowCloseSound, 'windowClose')}
          {renderSoundRow('Paste Item', pasteSound, 'paste')}

          <p style={styles.note}>
            Window open/close sounds require restart to take effect.
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
  note: {
    fontSize: '11px',
    color: theme.textSecondary,
    marginTop: '12px',
    lineHeight: 1.4,
  },
});
