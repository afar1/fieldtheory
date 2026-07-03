import { useEffect, useState, useCallback } from 'react';
import type { ChangeEvent } from 'react';
import { useTheme, Theme } from '../contexts/ThemeContext';
import { SETTINGS_CARD_GAP, getSettingsDividerColor } from './settings/SettingsPrimitives';
import type { ParakeetSetupError, ParakeetSetupProgress, ParakeetStatus } from '../types/window';
import ParakeetSupportPanel from './ParakeetSupportPanel';
import {
  DEFAULT_VISIBLE_TRANSCRIPTION_ENGINE,
  PARAKEET_ONE_TIME_SETUP_NOTE,
  PARAKEET_VISIBLE_ENGINE_OPTIONS,
  getVisibleParakeetActionLabel,
  getVisibleParakeetEngineStatus,
  getVisibleParakeetPendingActionLabel,
  getVisibleParakeetRecoveryMessage,
  hasVisibleParakeetRuntime,
  isVisibleParakeetEngineVerified,
  normalizeVisibleTranscriptionEngine,
  type VisibleParakeetEngine,
  type VisibleTranscriptionEngine,
} from '../utils/transcriptionEngines';

type TranscriptionStatus = 'idle' | 'recording' | 'transcribing';
type ModelStatus = 'downloaded' | 'downloading' | 'missing';
type AutoImproveProvider = 'local' | 'codex' | 'claude';
type AutoImproveEffort = 'fast' | 'balanced' | 'deep';
type AutoImproveModelOptions = {
  codexModel: string;
  codexEffort: AutoImproveEffort;
  claudeModel: string;
  claudeEffort: AutoImproveEffort;
};
type AutoImproveContextFile = {
  path: string;
  enabled: boolean;
};
type AutoImproveProviderStatus = {
  provider: AutoImproveProvider;
  installed: boolean;
  authenticated: boolean;
  available: boolean;
  message: string;
};
type TranscriptionSettingsMode = 'transcription' | 'auto-improve';
interface TranscriptionSettingsProps {
  mode?: TranscriptionSettingsMode;
}
const AUTO_IMPROVE_PROVIDER_OPTIONS: Array<{
  id: AutoImproveProvider;
  label: string;
}> = [
  { id: 'local', label: 'Local' },
  { id: 'codex', label: 'Codex' },
  { id: 'claude', label: 'Claude' },
];
const AUTO_IMPROVE_EFFORT_OPTIONS: Array<{ id: AutoImproveEffort; label: string }> = [
  { id: 'fast', label: 'Fast' },
  { id: 'balanced', label: 'Balanced' },
  { id: 'deep', label: 'Deep' },
];

function getParakeetVerifiedBadge(isSelected: boolean): {
  label: 'Selected' | 'Installed';
  muted: boolean;
} {
  if (isSelected) {
    return { label: 'Selected', muted: false };
  }

  return {
    label: 'Installed',
    muted: true,
  };
}

export default function TranscriptionSettings({ mode = 'transcription' }: TranscriptionSettingsProps) {
  const { theme } = useTheme();
  const [status, setStatus] = useState<TranscriptionStatus>('idle');
  const [modelStatus, setModelStatus] = useState<ModelStatus>('missing');
  const [error, setError] = useState<string | null>(null);
  const [hotkey, setHotkey] = useState<string>('Option+/');
  const [isCapturingHotkey, setIsCapturingHotkey] = useState(false);
  const [hotMicHotkey, setHotMicHotkey] = useState<string | null>(null);
  const [isCapturingHotMicHotkey, setIsCapturingHotMicHotkey] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('small');
  const [copiedError, setCopiedError] = useState<'general' | null>(null);
  const [recordingSource, setRecordingSource] = useState<'microphone' | 'system-audio'>('microphone');

  // Engine selection state.
  const [selectedEngine, setSelectedEngine] = useState<VisibleTranscriptionEngine>(DEFAULT_VISIBLE_TRANSCRIPTION_ENGINE);
  const [parakeetInstalled, setParakeetInstalled] = useState(false);
  const [parakeetStatus, setParakeetStatus] = useState<ParakeetStatus | null>(null);
  const [settingUpParakeet, setSettingUpParakeet] = useState(false);
  const [settingUpParakeetEngine, setSettingUpParakeetEngine] = useState<VisibleParakeetEngine | null>(null);
  const [parakeetSetupProgress, setParakeetSetupProgress] = useState<ParakeetSetupProgress | null>(null);
  const [parakeetSetupError, setParakeetSetupError] = useState<ParakeetSetupError | null>(null);
  const [uninstallingParakeet, setUninstallingParakeet] = useState(false);

  const [abandonHotkey, setAbandonHotkey] = useState<string>('Escape');
  const [isCapturingAbandonHotkey, setIsCapturingAbandonHotkey] = useState(false);
  const [abandonHotkeyError, setAbandonHotkeyError] = useState<string | null>(null);
  const [autoImprove, setAutoImprove] = useState(false);
  const [autoImproveProvider, setAutoImproveProvider] = useState<AutoImproveProvider>('local');
  const [autoImproveProviderStatus, setAutoImproveProviderStatus] = useState<Record<AutoImproveProvider, AutoImproveProviderStatus | null>>({
    local: {
      provider: 'local',
      installed: true,
      authenticated: true,
      available: true,
      message: 'Local provider is available.',
    },
    codex: null,
    claude: null,
  });
  const [checkingAutoImproveProvider, setCheckingAutoImproveProvider] = useState<AutoImproveProvider | null>(null);
  const [autoImproveMinWords, setAutoImproveMinWords] = useState(70);
  const [autoImproveModelOptions, setAutoImproveModelOptions] = useState<AutoImproveModelOptions>({
    codexModel: '',
    codexEffort: 'balanced',
    claudeModel: '',
    claudeEffort: 'balanced',
  });
  const [autoImproveWritingPreferences, setAutoImproveWritingPreferences] = useState('');
  const [autoImproveContextFiles, setAutoImproveContextFiles] = useState<AutoImproveContextFile[]>([]);
  const [autoImproveContextPathInput, setAutoImproveContextPathInput] = useState('');

  const isMacOS = typeof window !== 'undefined' && window.platform?.isMacOS;

  // MOCK=whisper-nudge npm run dev:mock — preview the upgrade nudge banner
  const mockMode = import.meta.env.VITE_MOCK as string | undefined;

  const styles = getStyles(theme);

  const refreshParakeetStatus = useCallback(async () => {
    if (!window.transcribeAPI) return null;
    const status = await window.transcribeAPI.getParakeetStatus?.() ?? null;
    setParakeetStatus(status);
    setParakeetInstalled(hasVisibleParakeetRuntime(status));
    return status;
  }, []);

  useEffect(() => {
    if (!isMacOS || !window.transcribeAPI) {
      return;
    }

    const fetchStatus = async () => {
      try {
        const [
          currentStatus,
          currentModelStatus,
          currentHotkey,
          currentSelectedModel,
          currentRecordingSource,
          currentAbandonHotkey,
          currentAutoImprove,
          currentAutoImproveProvider,
          currentAutoImproveMinWords,
          currentAutoImproveModelOptions,
          currentAutoImproveWritingPreferences,
          currentAutoImproveContextFiles,
          currentHotMicHotkey,
        ] = await Promise.all([
          window.transcribeAPI!.getStatus(),
          window.transcribeAPI!.getModelStatus(),
          window.transcribeAPI!.getHotkey(),
          window.transcribeAPI!.getSelectedModel(),
          window.transcribeAPI!.getRecordingSource?.() ?? 'microphone',
          window.transcribeAPI!.getAbandonHotkey?.() ?? 'Escape',
          window.transcribeAPI!.getAutoImprove?.() ?? false,
          window.transcribeAPI!.getAutoImproveProvider?.() ?? 'local',
          window.transcribeAPI!.getAutoImproveMinWords?.() ?? 70,
          window.transcribeAPI!.getAutoImproveModelOptions?.() ?? {
            codexModel: '',
            codexEffort: 'balanced',
            claudeModel: '',
            claudeEffort: 'balanced',
          },
          window.transcribeAPI!.getAutoImproveWritingPreferences?.() ?? '',
          window.transcribeAPI!.getAutoImproveContextFiles?.() ?? [],
          window.hotMicAPI?.getHotkey?.() ?? null,
        ]);
        setStatus(currentStatus);
        setModelStatus(currentModelStatus);
        setHotkey(currentHotkey);
        setSelectedModel(currentSelectedModel);
        setRecordingSource(currentRecordingSource as 'microphone' | 'system-audio');
        setAbandonHotkey(currentAbandonHotkey);
        setAutoImprove(currentAutoImprove);
        setAutoImproveProvider(currentAutoImproveProvider as AutoImproveProvider);
        setAutoImproveMinWords(currentAutoImproveMinWords);
        setAutoImproveModelOptions(currentAutoImproveModelOptions as AutoImproveModelOptions);
        setAutoImproveWritingPreferences(currentAutoImproveWritingPreferences);
        setAutoImproveContextFiles(currentAutoImproveContextFiles as AutoImproveContextFile[]);
        setHotMicHotkey(currentHotMicHotkey);

        // Fetch current engine selection. Only Parakeet variants are user-facing.
        const currentEngine = mockMode === 'whisper-nudge' ? 'whisper' : (await window.transcribeAPI!.getTranscriptionEngine?.() ?? DEFAULT_VISIBLE_TRANSCRIPTION_ENGINE);
        setSelectedEngine(normalizeVisibleTranscriptionEngine(currentEngine));

        // Check Parakeet installation status.
        if (mockMode === 'whisper-nudge') {
          setParakeetStatus(null);
          setParakeetInstalled(false);
        } else {
          await refreshParakeetStatus();
        }
      } catch (err) {
        console.error('Failed to fetch transcription status:', err);
      }
    };

    fetchStatus();

    const unsubscribeStatus = window.transcribeAPI!.onStatusChanged((newStatus) => {
      setStatus(newStatus);
    });

    const unsubscribeResult = window.transcribeAPI!.onResult(() => {});

    const unsubscribeError = window.transcribeAPI!.onError((errorMsg) => {
      setError(errorMsg);
      console.error('Transcription error:', errorMsg);
    });

    const unsubscribeProgress = window.transcribeAPI!.onModelDownloadProgress(() => {});

    const unsubscribeParakeetProgress = window.transcribeAPI!.onParakeetSetupProgress?.((progress) => {
      setParakeetSetupProgress(progress);
    }) ?? (() => {});

    const unsubscribeHotkey = window.transcribeAPI!.onHotkeyChanged((newHotkey) => {
      setHotkey(newHotkey);
    });

    return () => {
      unsubscribeStatus();
      unsubscribeResult();
      unsubscribeError();
      unsubscribeProgress();
      unsubscribeParakeetProgress();
      unsubscribeHotkey();
    };
  }, [isMacOS, mockMode, refreshParakeetStatus]);

  const handleEngineChange = useCallback(async (engine: VisibleTranscriptionEngine) => {
    if (!window.transcribeAPI) return;
    setSelectedEngine(engine);
    try {
      await window.transcribeAPI.setTranscriptionEngine?.(engine);
    } catch (err) {
      console.error('Failed to set transcription engine:', err);
    }
  }, []);

  const handleRecordingSourceChange = useCallback(async (source: 'microphone' | 'system-audio') => {
    if (!window.transcribeAPI?.setRecordingSource) return;
    setRecordingSource(source);
    try {
      await window.transcribeAPI.setRecordingSource(source);
    } catch (err) {
      console.error('Failed to set recording source:', err);
    }
  }, []);

  const handleAutoImproveChange = useCallback(async (enabled: boolean) => {
    if (!window.transcribeAPI?.setAutoImprove) return;
    setAutoImprove(enabled);
    try {
      await window.transcribeAPI.setAutoImprove(enabled);
    } catch (err) {
      setAutoImprove(!enabled);
      console.error('Failed to set auto-improve:', err);
    }
  }, []);

  const checkAutoImproveProvider = useCallback(async (provider: AutoImproveProvider) => {
    if (provider === 'local') return autoImproveProviderStatus.local;
    if (!window.transcribeAPI?.getAutoImproveProviderStatus) return null;
    setCheckingAutoImproveProvider(provider);
    try {
      const status = await window.transcribeAPI.getAutoImproveProviderStatus(provider);
      setAutoImproveProviderStatus((current) => ({ ...current, [provider]: status }));
      return status;
    } catch (err) {
      const status: AutoImproveProviderStatus = {
        provider,
        installed: false,
        authenticated: false,
        available: false,
        message: err instanceof Error ? err.message : 'Could not check provider access.',
      };
      setAutoImproveProviderStatus((current) => ({ ...current, [provider]: status }));
      return status;
    } finally {
      setCheckingAutoImproveProvider(null);
    }
  }, [autoImproveProviderStatus.local]);

  const handleAutoImproveProviderChange = useCallback(async (provider: AutoImproveProvider) => {
    if (!window.transcribeAPI?.setAutoImproveProvider) return;
    const status = autoImproveProviderStatus[provider] ?? await checkAutoImproveProvider(provider);
    if (!status?.available) return;
    const previousProvider = autoImproveProvider;
    setAutoImproveProvider(provider);
    try {
      await window.transcribeAPI.setAutoImproveProvider(provider);
    } catch (err) {
      setAutoImproveProvider(previousProvider);
      console.error('Failed to set auto-improve provider:', err);
    }
  }, [autoImproveProvider, autoImproveProviderStatus, checkAutoImproveProvider]);

  const handleAutoImproveMinWordsChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const value = Math.max(30, Math.min(500, Number.parseInt(event.currentTarget.value, 10) || 70));
    setAutoImproveMinWords(value);
    try {
      await window.transcribeAPI?.setAutoImproveMinWords?.(value);
    } catch (err) {
      console.error('Failed to set auto-improve minimum words:', err);
    }
  }, []);

  const saveAutoImproveModelOptions = useCallback(async (patch: Partial<AutoImproveModelOptions>) => {
    const next = { ...autoImproveModelOptions, ...patch };
    setAutoImproveModelOptions(next);
    try {
      const saved = await window.transcribeAPI?.setAutoImproveModelOptions?.(next);
      if (saved) setAutoImproveModelOptions(saved);
    } catch (err) {
      console.error('Failed to save auto-improve model options:', err);
    }
  }, [autoImproveModelOptions]);

  const saveAutoImproveWritingPreferences = useCallback(async (value: string) => {
    setAutoImproveWritingPreferences(value);
    try {
      const saved = await window.transcribeAPI?.setAutoImproveWritingPreferences?.(value);
      if (typeof saved === 'string') setAutoImproveWritingPreferences(saved);
    } catch (err) {
      console.error('Failed to save auto-improve writing preferences:', err);
    }
  }, []);

  const saveAutoImproveContextFiles = useCallback(async (files: AutoImproveContextFile[]) => {
    setAutoImproveContextFiles(files);
    try {
      const saved = await window.transcribeAPI?.setAutoImproveContextFiles?.(files);
      if (saved) setAutoImproveContextFiles(saved);
    } catch (err) {
      console.error('Failed to save auto-improve context files:', err);
    }
  }, []);

  const handleChooseAutoImproveContextFiles = useCallback(async () => {
    try {
      const files = await window.transcribeAPI?.chooseAutoImproveContextFiles?.();
      if (files) setAutoImproveContextFiles(files);
    } catch (err) {
      console.error('Failed to choose auto-improve context files:', err);
    }
  }, []);

  const handleAddAutoImproveContextPath = useCallback(async () => {
    const filePath = autoImproveContextPathInput.trim();
    if (!filePath) return;
    setAutoImproveContextPathInput('');
    await saveAutoImproveContextFiles([
      ...autoImproveContextFiles,
      { path: filePath, enabled: true },
    ]);
  }, [autoImproveContextFiles, autoImproveContextPathInput, saveAutoImproveContextFiles]);

  const handleSetupParakeet = useCallback(async (engine: VisibleParakeetEngine) => {
    if (!window.transcribeAPI || settingUpParakeet) return;
    setSelectedEngine(engine);
    setSettingUpParakeet(true);
    setSettingUpParakeetEngine(engine);
    setParakeetSetupProgress({
      engine,
      stage: 'installing-runtime',
      message: 'Installing the Parakeet runtime…',
      percent: null,
      detail: null,
    });
    setParakeetSetupError(null);
    try {
      const result = await window.transcribeAPI.setupParakeet?.(engine);
      if (result?.success) {
        await refreshParakeetStatus();
      } else {
        setParakeetSetupError(result?.setupError ?? {
          code: 'setup-failed',
          summary: result?.error ?? 'Setup failed',
          detail: result?.error ?? 'Setup failed',
          recoveryCommand: '',
          moreInfo: 'Retry Parakeet setup. If it fails again, open Diagnostics so support can inspect the setup log.',
        });
        await refreshParakeetStatus();
      }
    } catch (err) {
      const summary = err instanceof Error ? err.message : 'Setup failed';
      setParakeetSetupError({
        code: 'setup-failed',
        summary,
        detail: summary,
        recoveryCommand: '',
        moreInfo: 'Retry Parakeet setup. If it fails again, open Diagnostics so support can inspect the setup log.',
      });
      await refreshParakeetStatus();
    } finally {
      setSettingUpParakeet(false);
      setSettingUpParakeetEngine(null);
      setParakeetSetupProgress(null);
    }
  }, [refreshParakeetStatus, settingUpParakeet]);

  const handleUninstallParakeet = useCallback(async () => {
    if (!window.transcribeAPI || uninstallingParakeet) return;
    setUninstallingParakeet(true);
    setParakeetSetupError(null);
    try {
      const result = await window.transcribeAPI.uninstallParakeet?.();
      if (result?.success) {
        await refreshParakeetStatus();
        const currentEngine = await window.transcribeAPI.getTranscriptionEngine?.() ?? DEFAULT_VISIBLE_TRANSCRIPTION_ENGINE;
        setSelectedEngine(normalizeVisibleTranscriptionEngine(currentEngine));
      } else {
        const summary = result?.error ?? 'Uninstall failed';
        setParakeetSetupError({
          code: 'setup-failed',
          summary,
          detail: summary,
          recoveryCommand: '',
          moreInfo: 'Retry the action. If it fails again, open Diagnostics so support can inspect the setup log.',
        });
      }
    } catch (err) {
      const summary = err instanceof Error ? err.message : 'Uninstall failed';
      setParakeetSetupError({
        code: 'setup-failed',
        summary,
        detail: summary,
        recoveryCommand: '',
        moreInfo: 'Retry the action. If it fails again, open Diagnostics so support can inspect the setup log.',
      });
    } finally {
      setUninstallingParakeet(false);
    }
  }, [refreshParakeetStatus, uninstallingParakeet]);

  const getParakeetEngineStatus = useCallback((engine: VisibleParakeetEngine) => {
    return getVisibleParakeetEngineStatus(parakeetStatus, engine);
  }, [parakeetStatus]);

  const selectedParakeetEngineStatus = getParakeetEngineStatus(selectedEngine);
  const selectedParakeetProgress = parakeetSetupProgress?.engine === selectedEngine
    ? parakeetSetupProgress
    : null;
  const selectedParakeetSetupActive = Boolean(
    selectedParakeetProgress &&
    selectedParakeetProgress.stage !== 'completed' &&
    selectedParakeetProgress.stage !== 'failed'
  );
  const selectedParakeetSetupError = selectedParakeetSetupActive
    ? null
    : selectedParakeetEngineStatus?.setupError ?? parakeetSetupError;
  const selectedParakeetSupportSummary = selectedParakeetSetupActive
    ? null
    : selectedParakeetSetupError?.summary ?? selectedParakeetEngineStatus?.lastError ?? null;
  const selectedParakeetRecoveryMessage = getVisibleParakeetRecoveryMessage(selectedParakeetSupportSummary);
  const selectedParakeetErrorDetail = selectedParakeetSetupActive
    ? null
    : selectedParakeetSetupError?.detail ?? selectedParakeetEngineStatus?.lastErrorDetail ?? null;

  const handleSetAbandonHotkey = useCallback(async (newHotkey: string) => {
    if (!window.transcribeAPI?.setAbandonHotkey) return;

    setIsCapturingAbandonHotkey(false);
    setAbandonHotkeyError(null);

    try {
      const success = await window.transcribeAPI.setAbandonHotkey(newHotkey);
      if (success) {
        setAbandonHotkey(newHotkey);
      } else {
        setAbandonHotkeyError('Failed to register hotkey. It may be in use by another application.');
      }
    } catch (err) {
      setAbandonHotkeyError(err instanceof Error ? err.message : 'Failed to set abandon hotkey');
      console.error('Failed to set abandon hotkey:', err);
    }
  }, []);

  const handleStartCaptureHotkey = useCallback(() => {
    setIsCapturingHotkey(true);
    setIsCapturingHotMicHotkey(false);
    setIsCapturingAbandonHotkey(false);
    setHotkeyError(null);
  }, []);

  const handleStartCaptureHotMicHotkey = useCallback(() => {
    setIsCapturingHotMicHotkey(true);
    setIsCapturingHotkey(false);
    setIsCapturingAbandonHotkey(false);
    setHotkeyError(null);
  }, []);

  const handleSetHotkey = useCallback(async (newHotkey: string | null) => {
    if (!window.transcribeAPI) return;

    setIsCapturingHotkey(false);
    setHotkeyError(null);

    try {
      const success = await window.transcribeAPI.setHotkey(newHotkey);
      if (success) {
        setHotkey(newHotkey || '');
      } else {
        setHotkeyError('Failed to register hotkey. It may be in use by another application.');
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set hotkey');
      console.error('Failed to set hotkey:', err);
    }
  }, []);

  const handleSetHotMicHotkey = useCallback(async (newHotkey: string | null) => {
    if (!window.hotMicAPI?.setHotkey) return;

    setIsCapturingHotMicHotkey(false);
    setHotkeyError(null);

    try {
      const success = await window.hotMicAPI.setHotkey(newHotkey);
      if (success) {
        const savedHotkey = await window.hotMicAPI.getHotkey();
        setHotMicHotkey(savedHotkey);
      } else {
        setHotkeyError('Failed to register Hot Mic hotkey. It may be in use by another application.');
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set Hot Mic hotkey');
      console.error('Failed to set Hot Mic hotkey:', err);
    }
  }, []);

  const copyErrorText = useCallback(async (text: string, source: 'general') => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedError(source);
      window.setTimeout(() => {
        setCopiedError((current) => (current === source ? null : current));
      }, 1800);
    } catch (err) {
      console.error('Failed to copy error text:', err);
    }
  }, []);

  useEffect(() => {
    const capturing = isCapturingHotkey
      ? 'transcription'
      : isCapturingHotMicHotkey
        ? 'hotMic'
        : isCapturingAbandonHotkey
          ? 'abandon'
          : null;
    if (!capturing) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();

      const parts: string[] = [];
      if (event.metaKey) parts.push('Command');
      if (event.ctrlKey) parts.push('Control');
      if (event.altKey) parts.push('Alt');
      if (event.shiftKey) parts.push('Shift');

      let key = event.key;
      
      // Check for both regular space (char 32) and non-breaking space (char 160).
      // macOS produces non-breaking space when Alt/Option is held with Space.
      if (key === ' ' || key === '\u00A0') {
        key = 'Space';
      } else if (key === '`' || key === 'Backquote') {
        key = '`';
      } else if (key === 'CapsLock') {
        key = 'CapsLock';
      } else if (key.length === 1 && key.match(/[a-z]/i)) {
        key = key.toUpperCase();
      }

      const keyMap: Record<string, string> = {
        'Meta': 'Command',
        'Control': 'Control',
        'Alt': 'Alt',
        'Shift': 'Shift',
        'CapsLock': 'CapsLock',
        'Backquote': '`',
        'Escape': 'Escape',
        'Enter': 'Enter',
        'Tab': 'Tab',
        'Backspace': 'Backspace',
        'Delete': 'Delete',
        'ArrowUp': 'Up',
        'ArrowDown': 'Down',
        'ArrowLeft': 'Left',
        'ArrowRight': 'Right',
        'PageUp': 'PageUp',
        'PageDown': 'PageDown',
        'Home': 'Home',
        'End': 'End',
      };

      // Check if this is a modifier-only keypress BEFORE transforming via keyMap.
      // event.key for modifiers: 'Meta', 'Control', 'Alt', 'Shift'
      const isModifierOnly = ['Meta', 'Control', 'Alt', 'Shift'].includes(event.key);
      if (isModifierOnly) {
        // If no other modifiers held, treat as a single modifier hotkey.
        // Otherwise, ignore (user is still building the combo).
        if (parts.length === 0) {
          const modifierName = event.key === 'Meta' ? 'Command' : event.key;
          if (capturing === 'transcription') {
            handleSetHotkey(modifierName);
          } else if (capturing === 'hotMic') {
            handleSetHotMicHotkey(modifierName);
          } else if (capturing === 'abandon') {
            handleSetAbandonHotkey(modifierName);
          }
        }
        return;
      }

      if (keyMap[key]) {
        key = keyMap[key];
      }

      let hotkeyString: string;
      if (parts.length > 0) {
        hotkeyString = parts.join('+') + '+' + key;
      } else {
        hotkeyString = key;
      }

      if (capturing === 'transcription') {
        handleSetHotkey(hotkeyString);
      } else if (capturing === 'hotMic') {
        handleSetHotMicHotkey(hotkeyString);
      } else if (capturing === 'abandon') {
        handleSetAbandonHotkey(hotkeyString);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    isCapturingHotkey,
    isCapturingHotMicHotkey,
    isCapturingAbandonHotkey,
    handleSetHotkey,
    handleSetHotMicHotkey,
    handleSetAbandonHotkey,
  ]);

  if (!isMacOS) {
    return (
      <div style={styles.container}>
        <h2 style={styles.heading}>Local Transcription</h2>
        <p style={styles.notAvailable}>
          Local transcription is only available on macOS.
        </p>
      </div>
    );
  }

  const getStatusColor = () => {
    if (status === 'recording') return theme.info;
    if (status === 'transcribing') return theme.warning;
    if (selectedModel === 'none' || modelStatus === 'missing') return theme.error;
    if (modelStatus === 'downloading') return theme.warning;
    return theme.success;
  };

  const getStatusText = () => {
    if (status === 'recording') return 'Recording';
    if (status === 'transcribing') return 'Transcribing';
    if (selectedModel === 'none') return 'No model';
    if (modelStatus === 'missing') return 'No model';
    if (modelStatus === 'downloading') return 'Downloading';
    return 'Ready';
  };

  return (
    <div style={styles.container}>
      {mode === 'transcription' && (
      <>
      <section style={styles.card}>
        <header style={styles.cardHeader}>
          <div style={styles.cardTitle}>Capture</div>
          <div style={styles.cardSub}>
            Shortcuts and source controls for starting and switching local recording.
          </div>
        </header>

        <div style={styles.row}>
          <div style={styles.rowText}>
            <span style={styles.rowLabel}>Standard recording</span>
            <span style={styles.modelHint}>Starts a normal one-shot recording.</span>
          </div>
          <div style={styles.rowControls}>
            {isCapturingHotkey ? (
              <>
                <button style={{ ...styles.btn, ...styles.btnActive }}>
                  Press keys...
                </button>
                <button
                  onClick={() => {
                    setIsCapturingHotkey(false);
                    setHotkeyError(null);
                  }}
                  style={styles.btnGhost}
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                {hotkey && (
                  <button
                    onClick={() => void handleSetHotkey(null)}
                    style={styles.btnGhost}
                  >
                    Clear
                  </button>
                )}
                <button
                  onClick={handleStartCaptureHotkey}
                  disabled={isCapturingHotMicHotkey || isCapturingAbandonHotkey}
                  style={styles.btn}
                >
                  {hotkey || 'Not set'}
                </button>
              </>
            )}
          </div>
        </div>

        <div style={styles.row}>
          <div style={styles.rowText}>
            <span style={styles.rowLabel}>Toggle Hot Mic / Standard</span>
            <span style={styles.modelHint}>Switches between push-to-record and always-listening command mode.</span>
          </div>
          <div style={styles.rowControls}>
            {window.hotMicAPI?.setHotkey ? (
              <>
                {isCapturingHotMicHotkey ? (
                  <>
                    <button
                      style={{ ...styles.btn, ...styles.btnActive }}
                    >
                      Press keys...
                    </button>
                    <button
                      onClick={() => {
                        setIsCapturingHotMicHotkey(false);
                        setHotkeyError(null);
                      }}
                      style={styles.btnGhost}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    {hotMicHotkey && (
                      <button
                        onClick={() => void handleSetHotMicHotkey(null)}
                        style={styles.btnGhost}
                      >
                        Clear
                      </button>
                    )}
                    <button
                      onClick={handleStartCaptureHotMicHotkey}
                      disabled={isCapturingHotkey || isCapturingAbandonHotkey}
                      style={styles.btn}
                    >
                      {hotMicHotkey || 'Not set'}
                    </button>
                  </>
                )}
              </>
            ) : (
              <span style={{ fontSize: '11px', color: theme.textSecondary }}>Unavailable</span>
            )}
          </div>
        </div>
        {hotkeyError && (
          <div style={{ fontSize: '11px', color: theme.error, marginTop: '6px' }}>
            {hotkeyError}
          </div>
        )}

        <div style={{ ...styles.row, borderBottom: 0 }}>
          <div style={styles.rowText}>
            <span style={styles.rowLabel}>Recording source</span>
            <span style={styles.modelHint}>
              System audio uses Screen Recording permission and captures call output instead of your microphone.
            </span>
          </div>
          <div style={styles.rowControls}>
            <button
              onClick={() => void handleRecordingSourceChange('microphone')}
              style={recordingSource === 'microphone' ? styles.btn : styles.btnGhost}
            >
              Microphone
            </button>
            <button
              onClick={() => void handleRecordingSourceChange('system-audio')}
              style={recordingSource === 'system-audio' ? styles.btn : styles.btnGhost}
            >
              System Audio
            </button>
          </div>
        </div>
      </section>
      </>
      )}

      {mode === 'auto-improve' && (
      <section style={styles.card}>
        <header style={styles.cardHeader}>
          <div style={styles.cardTitle}>Auto-improve</div>
          <div style={styles.cardSub}>
            Clean transcripts before paste.
          </div>
        </header>

        <div style={styles.row}>
          <div style={styles.rowText}>
            <span style={styles.rowLabel}>Enable auto-improve</span>
            <span style={styles.modelHint}>Keeps the raw transcript and pastes the improved version when available.</span>
          </div>
          <button
            onClick={() => void handleAutoImproveChange(!autoImprove)}
            style={{
              ...styles.toggle,
              backgroundColor: autoImprove ? theme.info : (theme.isDark ? '#404040' : '#d1d5db'),
            }}
            title={autoImprove ? 'Auto-improve enabled' : 'Auto-improve disabled'}
          >
            <span
              style={{
                ...styles.toggleKnob,
                transform: autoImprove ? 'translateX(22px)' : 'translateX(2px)',
              }}
            />
          </button>
        </div>

        <div style={styles.row}>
          <div style={styles.rowText}>
            <span style={styles.rowLabel}>Provider</span>
            <span style={styles.modelHint}>Use a local model, or confirm access to a logged-in Codex or Claude CLI.</span>
          </div>
          <div style={{ ...styles.rowControls, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {AUTO_IMPROVE_PROVIDER_OPTIONS.map((provider) => {
              const selected = autoImproveProvider === provider.id;
              const status = autoImproveProviderStatus[provider.id];
              const checking = checkingAutoImproveProvider === provider.id;
              const available = status?.available === true;
              const canSelect = provider.id === 'local' || available;
              return (
                <div key={provider.id} style={styles.providerControl}>
                  <button
                    onClick={() => void handleAutoImproveProviderChange(provider.id)}
                    disabled={!canSelect || checking}
                    style={{
                      ...(selected ? styles.btn : styles.btnGhost),
                      opacity: canSelect ? 1 : 0.55,
                      cursor: canSelect && !checking ? 'pointer' : 'not-allowed',
                    }}
                    title={status?.message}
                  >
                    {provider.label}
                  </button>
                  {provider.id !== 'local' && (
                    <button
                      onClick={() => void checkAutoImproveProvider(provider.id)}
                      disabled={checking}
                      style={styles.btnGhost}
                    >
                      {checking ? 'Checking...' : status?.available ? 'Ready' : 'Check'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {AUTO_IMPROVE_PROVIDER_OPTIONS
          .filter((provider) => provider.id !== 'local' && autoImproveProviderStatus[provider.id]?.message)
          .map((provider) => (
            <div key={provider.id} style={styles.providerStatus}>
              {provider.label}: {autoImproveProviderStatus[provider.id]?.message}
            </div>
          ))}
        {autoImproveProvider === 'local' && autoImproveProviderStatus.local?.message && (
          <div style={styles.providerStatus}>
            Local: {autoImproveProviderStatus.local.message}
          </div>
        )}

        <div style={styles.fieldBlock}>
          <div style={styles.modelOptionsHeader}>
            <div style={styles.rowText}>
              <span style={styles.rowLabel}>Subscription models</span>
              <span style={styles.modelHint}>Used when Codex or Claude is selected as the provider.</span>
            </div>
          </div>
          <div style={styles.modelOptionsStack}>
            <div style={styles.fieldGrid}>
              <label style={styles.fieldLabel}>
                <span style={styles.rowLabel}>Codex model</span>
                <input
                  value={autoImproveModelOptions.codexModel}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setAutoImproveModelOptions((current) => ({ ...current, codexModel: value }));
                  }}
                  onBlur={() => void saveAutoImproveModelOptions({ codexModel: autoImproveModelOptions.codexModel })}
                  placeholder="Default"
                  style={styles.textInput}
                />
              </label>
              <label style={styles.fieldLabel}>
                <span style={styles.rowLabel}>Codex reasoning</span>
                <select
                  value={autoImproveModelOptions.codexEffort}
                  onChange={(event) => void saveAutoImproveModelOptions({ codexEffort: event.currentTarget.value as AutoImproveEffort })}
                  style={styles.select}
                >
                  {AUTO_IMPROVE_EFFORT_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div style={styles.fieldGrid}>
              <label style={styles.fieldLabel}>
                <span style={styles.rowLabel}>Claude model</span>
                <input
                  value={autoImproveModelOptions.claudeModel}
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    setAutoImproveModelOptions((current) => ({ ...current, claudeModel: value }));
                  }}
                  onBlur={() => void saveAutoImproveModelOptions({ claudeModel: autoImproveModelOptions.claudeModel })}
                  placeholder="Default"
                  style={styles.textInput}
                />
              </label>
              <label style={styles.fieldLabel}>
                <span style={styles.rowLabel}>Claude reasoning</span>
                <select
                  value={autoImproveModelOptions.claudeEffort}
                  onChange={(event) => void saveAutoImproveModelOptions({ claudeEffort: event.currentTarget.value as AutoImproveEffort })}
                  style={styles.select}
                >
                  {AUTO_IMPROVE_EFFORT_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div style={styles.providerStatus}>
            Leave a model blank to use the logged-in CLI default.
          </div>
        </div>

        <div style={styles.fieldBlock}>
          <label style={styles.fieldLabel}>
            <span style={styles.rowLabel}>Writing preferences</span>
            <textarea
              value={autoImproveWritingPreferences}
              onChange={(event) => void saveAutoImproveWritingPreferences(event.currentTarget.value)}
              placeholder="Examples: keep my voice direct, avoid corporate polish, preserve uncertainty, do not add claims I did not say."
              style={styles.textArea}
            />
          </label>
        </div>

        <div style={styles.fieldBlock}>
          <div style={styles.rowText}>
            <span style={styles.rowLabel}>Style/context files</span>
            <span style={styles.modelHint}>Markdown files included as private guidance. Cloud providers receive enabled files.</span>
          </div>
          <div style={styles.contextPathRow}>
            <input
              value={autoImproveContextPathInput}
              onChange={(event) => setAutoImproveContextPathInput(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleAddAutoImproveContextPath();
                }
              }}
              placeholder="/path/to/style.md"
              style={styles.textInput}
            />
            <button onClick={() => void handleAddAutoImproveContextPath()} style={styles.btnGhost}>
              Add
            </button>
            <button onClick={() => void handleChooseAutoImproveContextFiles()} style={styles.btn}>
              Choose
            </button>
          </div>
          {autoImproveContextFiles.length > 0 && (
            <div style={styles.contextFileList}>
              {autoImproveContextFiles.map((file, index) => (
                <div key={`${file.path}-${index}`} style={styles.contextFileRow}>
                  <label style={styles.contextFileLabel}>
                    <input
                      type="checkbox"
                      checked={file.enabled}
                      onChange={(event) => {
                        const next = autoImproveContextFiles.map((item, itemIndex) => (
                          itemIndex === index ? { ...item, enabled: event.currentTarget.checked } : item
                        ));
                        void saveAutoImproveContextFiles(next);
                      }}
                    />
                    <span title={file.path} style={styles.contextFilePath}>{file.path}</span>
                  </label>
                  <button
                    onClick={() => {
                      void saveAutoImproveContextFiles(autoImproveContextFiles.filter((_, itemIndex) => itemIndex !== index));
                    }}
                    style={styles.btnGhost}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ ...styles.row, borderBottom: 0 }}>
          <div style={styles.rowText}>
            <span style={styles.rowLabel}>Minimum words</span>
            <span style={styles.modelHint}>Shorter transcripts paste as recorded.</span>
          </div>
          <input
            type="number"
            min={30}
            max={500}
            step={10}
            value={autoImproveMinWords}
            onChange={handleAutoImproveMinWordsChange}
            style={styles.numberInput}
          />
        </div>
      </section>
      )}

      {mode === 'transcription' && (
      <>
      <section style={styles.card}>
        <header style={styles.cardHeader}>
          <div style={styles.cardTitle}>Transcription</div>
          <div style={styles.cardSub}>
            Local engines and model downloads used to turn captured audio into text.
          </div>
        </header>

        <div style={styles.modelsList}>
          {PARAKEET_VISIBLE_ENGINE_OPTIONS.map((engineOption) => {
            const isActive = selectedEngine === engineOption.id;
            const engineStatus = getParakeetEngineStatus(engineOption.id);
            const engineVerified = isVisibleParakeetEngineVerified(parakeetStatus, engineOption.id);
            const engineNeedsReinstall = engineStatus?.needsReinstall ?? false;
            const actionLabel = getVisibleParakeetActionLabel(engineStatus, hasVisibleParakeetRuntime(parakeetStatus));
            const pendingActionLabel = getVisibleParakeetPendingActionLabel(actionLabel);
            const isPendingAction = settingUpParakeet && settingUpParakeetEngine === engineOption.id;
            const verifiedBadge = getParakeetVerifiedBadge(isActive);
            return (
              <div
                key={engineOption.id}
                style={{
                  ...styles.modelCard,
                  borderLeft: isActive
                    ? `3px solid ${theme.info}`
                    : `3px solid ${theme.isDark ? '#404040' : '#e5e7eb'}`,
                  backgroundColor: isActive
                    ? (theme.isDark ? 'rgba(59, 130, 246, 0.15)' : '#f0f9ff')
                    : 'transparent',
                  cursor: engineVerified ? 'pointer' : 'default',
                }}
                onClick={() => engineVerified && handleEngineChange(engineOption.id)}
              >
                <div style={styles.modelCardContent}>
                  <div style={styles.modelCardHeader}>
                    <span style={{ ...styles.rowValue, fontWeight: isActive ? 600 : 500 }}>
                      {engineOption.label}
                    </span>
                    {engineOption.sizeLabel && (
                      <span style={styles.modelSize}>{engineOption.sizeLabel}</span>
                    )}
                    {engineOption.recommended && (
                      <span style={styles.recommendedBadge}>Recommended</span>
                    )}
                  </div>
                  <span style={styles.modelHint}>{engineOption.description}</span>
                </div>
                <div style={styles.rowControls}>
                  {engineNeedsReinstall ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleSetupParakeet(engineOption.id); }}
                      style={styles.btn}
                    >
                      {isPendingAction ? pendingActionLabel : actionLabel}
                    </button>
                  ) : engineVerified ? (
                    <span
                      style={verifiedBadge.muted
                        ? { ...styles.downloadedBadge, color: theme.textSecondary }
                        : styles.downloadedBadge}
                    >
                      {verifiedBadge.label}
                    </span>
                  ) : isPendingAction ? (
                    <span style={{ fontSize: '11px', color: theme.info }}>{pendingActionLabel}</span>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleSetupParakeet(engineOption.id); }}
                      style={styles.btn}
                    >
                      {actionLabel}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {(selectedParakeetProgress || selectedParakeetSupportSummary) && (
            <ParakeetSupportPanel
              theme={theme}
              title={
                selectedParakeetSupportSummary
                  ? `${PARAKEET_VISIBLE_ENGINE_OPTIONS.find((o) => o.id === selectedEngine)?.label ?? 'Parakeet'} needs attention`
                  : `Setting up ${PARAKEET_VISIBLE_ENGINE_OPTIONS.find((o) => o.id === selectedEngine)?.label ?? 'Parakeet'}`
              }
              summary={selectedParakeetSupportSummary}
              recoveryMessage={
                selectedParakeetSetupError?.moreInfo
                ?? selectedParakeetRecoveryMessage
                ?? 'Open Diagnostics if the error repeats so support can inspect the Parakeet failure.'
              }
              recoveryCommand={selectedParakeetSetupError?.recoveryCommand}
              detail={selectedParakeetErrorDetail}
              progress={selectedParakeetProgress}
            />
          )}

          {/* Reinstall option - shown when parakeet is installed */}
          {parakeetInstalled && (
            <div style={{ marginTop: '8px', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                onClick={handleUninstallParakeet}
                disabled={uninstallingParakeet || settingUpParakeet}
                style={{
                  ...styles.btnGhost,
                  fontSize: '11px',
                  color: theme.textSecondary,
                  opacity: uninstallingParakeet ? 0.5 : 1,
                }}
              >
                {uninstallingParakeet ? 'Removing...' : 'Remove Parakeet & downloaded models'}
              </button>
            </div>
          )}
        </div>
      </section>

      {error && (
        <div style={styles.copyableErrorBlock}>
          <pre style={styles.copyableErrorText}>{error}</pre>
          <button
            onClick={() => copyErrorText(error, 'general')}
            style={styles.copyErrorButton}
          >
            {copiedError === 'general' ? 'Copied' : 'Copy error'}
          </button>
        </div>
      )}
      </>
      )}
    </div>
  );
}

// =============================================================================
// Unified Design System - Only 2 font sizes: 13px body, 11px headers
// =============================================================================
const getStyles = (theme: Theme): Record<string, React.CSSProperties> => ({
  container: {
    padding: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: SETTINGS_CARD_GAP,
  },
  card: {
    backgroundColor: theme.isDark ? theme.surface1 : '#fff',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
    padding: '18px 22px 16px',
  },
  cardHeader: {
    marginBottom: '14px',
  },
  cardTitle: {
    fontSize: '16px',
    fontWeight: 500,
    color: theme.text,
  },
  cardSub: {
    fontSize: '12px',
    color: theme.textSecondary,
    marginTop: '4px',
    lineHeight: 1.5,
  },
  notAvailable: {
    color: theme.textSecondary,
    fontStyle: 'italic',
    fontSize: '12px',
  },

  // Flat row layout: label left, control right.
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    padding: '12px 0',
    minHeight: '40px',
    borderBottom: `1px solid ${getSettingsDividerColor(theme)}`,
  },
  rowText: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '3px',
    minWidth: 0,
    flex: 1,
  },
  rowLabel: {
    fontSize: '13px',
    color: theme.text,
    fontWeight: 500,
    lineHeight: 1.35,
  },
  rowValue: {
    fontSize: '12px',
    color: theme.text,
    fontWeight: 500,
    display: 'flex',
    alignItems: 'center',
  },
  rowControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexShrink: 0,
  },
  providerControl: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  providerStatus: {
    fontSize: '11px',
    color: theme.textSecondary,
    lineHeight: 1.45,
    marginTop: '4px',
  },
  fieldBlock: {
    padding: '10px 0',
    borderBottom: `1px solid ${getSettingsDividerColor(theme)}`,
  },
  fieldGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(160px, 1fr) minmax(120px, 180px)',
    gap: '10px',
    alignItems: 'end',
  },
  modelOptionsHeader: {
    marginBottom: '10px',
  },
  modelOptionsStack: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '10px',
  },
  fieldLabel: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
    minWidth: 0,
  },
  textInput: {
    width: '100%',
    boxSizing: 'border-box' as const,
    padding: '6px 10px',
    fontSize: '12px',
    color: theme.text,
    backgroundColor: theme.isDark ? theme.surface1 : '#fff',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
  },
  textArea: {
    width: '100%',
    minHeight: '78px',
    boxSizing: 'border-box' as const,
    resize: 'vertical' as const,
    padding: '8px 10px',
    fontSize: '12px',
    lineHeight: 1.45,
    color: theme.text,
    backgroundColor: theme.isDark ? theme.surface1 : '#fff',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
  },
  contextPathRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto auto',
    gap: '8px',
    alignItems: 'center',
    marginTop: '8px',
  },
  contextFileList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
    marginTop: '8px',
  },
  contextFileRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    minWidth: 0,
  },
  contextFileLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    minWidth: 0,
    flex: 1,
  },
  contextFilePath: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    fontSize: '11px',
    color: theme.textSecondary,
  },

  // Status dot indicator.
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    display: 'inline-block',
    marginRight: '6px',
  },

  // Unified button styles.
  btn: {
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: 500,
    color: theme.text,
    backgroundColor: theme.isDark ? theme.surface1 : '#fff',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
    cursor: 'pointer',
    minWidth: '80px',
    textAlign: 'center' as const,
  },
  btnActive: {
    backgroundColor: theme.info,
    color: '#fff',
    borderColor: theme.info,
  },
  btnGhost: {
    backgroundColor: 'transparent',
    border: 'none',
    color: theme.textSecondary,
    minWidth: 'auto',
    padding: '6px 8px',
    fontSize: '12px',
    cursor: 'pointer',
  },

  // Toggle switch.
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

  // Select dropdown.
  select: {
    padding: '6px 12px',
    fontSize: '12px',
    color: theme.text,
    backgroundColor: theme.isDark ? theme.surface1 : '#fff',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
    cursor: 'pointer',
    minWidth: '160px',
  },
  numberInput: {
    width: '84px',
    padding: '6px 10px',
    fontSize: '12px',
    color: theme.text,
    backgroundColor: theme.isDark ? theme.surface1 : '#fff',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
  },

  // Error text.
  error: {
    fontSize: '12px',
    color: theme.error,
    margin: '4px 0',
  },
  copyableErrorBlock: {
    marginTop: '6px',
    border: `1px solid ${theme.error}`,
    backgroundColor: theme.errorBg,
    borderRadius: '6px',
    padding: '8px',
  },
  copyableErrorText: {
    margin: 0,
    color: theme.error,
    fontSize: '11px',
    lineHeight: 1.35,
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    userSelect: 'text' as const,
  },
  copyErrorButton: {
    marginTop: '8px',
    padding: '4px 10px',
    fontSize: '11px',
    fontWeight: 500,
    color: theme.text,
    backgroundColor: theme.isDark ? theme.surface1 : '#fff',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
    cursor: 'pointer',
  },

  // Model list and cards.
  modelsList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
  },
  modelCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderRadius: '6px',
    border: `1px solid ${theme.border}`,
  },
  modelCardContent: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '2px',
    minWidth: 0,
  },
  modelCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  modelSize: {
    fontSize: '12px',
    color: theme.textSecondary,
  },
  modelHint: {
    fontSize: '11px',
    color: theme.textSecondary,
  },
  downloadedBadge: {
    fontSize: '11px',
    fontWeight: 500,
    color: theme.success,
  },
  recommendedBadge: {
    fontSize: '9px',
    fontWeight: 600,
    color: theme.isDark ? theme.success : '#14372A',
    backgroundColor: theme.successBg,
    padding: '1px 5px',
    borderRadius: '3px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.02em',
  },

  // Progress bar for downloads.
  progressBar: {
    position: 'relative' as const,
    width: '80px',
    height: '6px',
    backgroundColor: theme.border,
    borderRadius: '3px',
    overflow: 'hidden',
  },
  progressFill: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    height: '100%',
    backgroundColor: theme.info,
    borderRadius: '3px',
    transition: 'width 0.3s ease',
  },
  progressText: {
    position: 'absolute' as const,
    top: '10px',
    left: 0,
    fontSize: '11px',
    color: theme.textSecondary,
  },
});
