import { useEffect, useState, useCallback } from 'react';
import { useTheme, Theme } from '../contexts/ThemeContext';
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

type ModelInfo = {
  name: string;
  url: string;
  sizeBytes: number;
  description: string;
};

const DEFAULT_WHISPER_MODELS: Record<string, ModelInfo> = {
  small: {
    name: 'ggml-small.en.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin',
    sizeBytes: 466 * 1024 * 1024,
    description: 'Small English transcription model',
  },
};

function withDefaultWhisperModels(models: Record<string, ModelInfo>): Record<string, ModelInfo> {
  return {
    ...DEFAULT_WHISPER_MODELS,
    ...models,
  };
}

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

export default function TranscriptionSettings() {
  const { theme } = useTheme();
  const [status, setStatus] = useState<TranscriptionStatus>('idle');
  const [modelStatus, setModelStatus] = useState<ModelStatus>('missing');
  const [error, setError] = useState<string | null>(null);
  const [hotkey, setHotkey] = useState<string>('Option+/');
  const [isCapturingHotkey, setIsCapturingHotkey] = useState(false);
  const [hotMicHotkey, setHotMicHotkey] = useState<string | null>(null);
  const [isCapturingHotMicHotkey, setIsCapturingHotMicHotkey] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<Record<string, ModelInfo>>(DEFAULT_WHISPER_MODELS);
  const [selectedModel, setSelectedModel] = useState<string>('small');
  const [modelDownloadStatus, setModelDownloadStatus] = useState<Record<string, boolean>>({});
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
  const [deletingModel, setDeletingModel] = useState<string | null>(null);
  const [modelDownloadProgress, setModelDownloadProgress] = useState<Record<string, { downloaded: number; total: number }>>({});
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
          models,
          currentSelectedModel,
          currentRecordingSource,
          downloadStatus,
          downloadingModels,
          currentAbandonHotkey,
          currentHotMicHotkey,
        ] = await Promise.all([
          window.transcribeAPI!.getStatus(),
          window.transcribeAPI!.getModelStatus(),
          window.transcribeAPI!.getHotkey(),
          window.transcribeAPI!.getAvailableModels(),
          window.transcribeAPI!.getSelectedModel(),
          window.transcribeAPI!.getRecordingSource?.() ?? 'microphone',
          window.transcribeAPI!.getModelDownloadStatus(),
          window.transcribeAPI!.getDownloadingModels?.() ?? [],
          window.transcribeAPI!.getAbandonHotkey?.() ?? 'Escape',
          window.hotMicAPI?.getHotkey?.() ?? null,
        ]);
        setStatus(currentStatus);
        setModelStatus(currentModelStatus);
        setHotkey(currentHotkey);
        setAvailableModels(withDefaultWhisperModels(models));
        setSelectedModel(currentSelectedModel);
        setRecordingSource(currentRecordingSource as 'microphone' | 'system-audio');
        setModelDownloadStatus(downloadStatus);
        // If a download is in progress, restore that state.
        if (downloadingModels.length > 0) {
          setDownloadingModel(downloadingModels[0]);
        }
        setAbandonHotkey(currentAbandonHotkey);
        setHotMicHotkey(currentHotMicHotkey);

        // Fetch current engine selection. Only Whisper and Parakeet variants are user-facing.
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

    const unsubscribeProgress = window.transcribeAPI!.onModelDownloadProgress((downloaded, total) => {
      setModelDownloadProgress(prev => {
        if (downloadingModel) {
          return {
            ...prev,
            [downloadingModel]: { downloaded, total },
          };
        }
        return prev;
      });
    });

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
  }, [isMacOS, downloadingModel, mockMode, refreshParakeetStatus]);

  const handleDownloadModelForSize = useCallback(async (modelSize: string) => {
    if (!window.transcribeAPI || downloadingModel) return;

    setDownloadingModel(modelSize);
    setError(null);

    try {
      await window.transcribeAPI.downloadModel(modelSize);
      const downloadStatus = await window.transcribeAPI.getModelDownloadStatus();
      setModelDownloadStatus(downloadStatus);
      setModelDownloadProgress(prev => {
        const next = { ...prev };
        delete next[modelSize];
        return next;
      });
      
      // Auto-select the downloaded model if no valid model is currently selected.
      // This prevents the confusing case where user downloads a model but can't use it
      // because another (non-downloaded) model is still selected.
      const currentSelected = await window.transcribeAPI.getSelectedModel();
      if (!downloadStatus[currentSelected]) {
        setSelectedModel(modelSize);
        await window.transcribeAPI.setSelectedModel(modelSize);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to download ${modelSize} model`);
      console.error(`Failed to download ${modelSize} model:`, err);
    } finally {
      setDownloadingModel(null);
    }
  }, [downloadingModel]);

  const handleModelChange = useCallback(async (newModel: string) => {
    if (!window.transcribeAPI || downloadingModel) return;
    
    setSelectedModel(newModel);
    setError(null);
    try {
      await window.transcribeAPI.setSelectedModel(newModel);
      const newModelStatus = await window.transcribeAPI.getModelStatus();
      setModelStatus(newModelStatus);
      const downloadStatus = await window.transcribeAPI.getModelDownloadStatus();
      setModelDownloadStatus(downloadStatus);
    } catch (err) {
      console.error('Failed to change model:', err);
      setError(err instanceof Error ? err.message : 'Failed to change model');
    }
  }, [downloadingModel]);

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
        // Engine will have been reverted to whisper by the backend
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

  const selectedParakeetEngineStatus = selectedEngine === 'whisper'
    ? null
    : getParakeetEngineStatus(selectedEngine);
  const selectedParakeetSetupError = selectedParakeetEngineStatus?.setupError ?? parakeetSetupError;
  const selectedParakeetSupportSummary = selectedParakeetSetupError?.summary ?? selectedParakeetEngineStatus?.lastError ?? null;
  const selectedParakeetRecoveryMessage = getVisibleParakeetRecoveryMessage(selectedParakeetSupportSummary);
  const selectedParakeetErrorDetail = selectedParakeetSetupError?.detail ?? selectedParakeetEngineStatus?.lastErrorDetail ?? null;
  const selectedParakeetProgress = selectedEngine === 'whisper'
    ? null
    : parakeetSetupProgress?.engine === selectedEngine
      ? parakeetSetupProgress
      : null;

  const handleDeleteModel = useCallback(async (modelSize: string) => {
    if (!window.transcribeAPI || deletingModel) return;

    setDeletingModel(modelSize);
    setError(null);

    try {
      await window.transcribeAPI.deleteModel(modelSize);
      const newDownloadStatus = await window.transcribeAPI.getModelDownloadStatus();
      setModelDownloadStatus(newDownloadStatus);

      // If we deleted the currently selected model, switch to another or 'none'
      if (modelSize === selectedModel) {
        const availableModel = Object.entries(newDownloadStatus).find(([size, downloaded]) =>
          downloaded && size !== modelSize
        )?.[0];

        if (availableModel) {
          await handleModelChange(availableModel);
        } else {
          // No models left - set to 'none'
          await handleModelChange('none');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to delete ${modelSize} model`);
      console.error(`Failed to delete ${modelSize} model:`, err);
    } finally {
      setDeletingModel(null);
    }
  }, [deletingModel, selectedModel, handleModelChange]);

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
      <div style={{ marginTop: '16px' }}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionTitle}>Shortcuts</span>
          <div style={styles.sectionLine} />
        </div>
        <div style={styles.row}>
          <span style={styles.rowLabel}>Standard Recording</span>
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
          <span style={styles.rowLabel}>Toggle Hot Mic / Standard</span>
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

        <div style={{ ...styles.row, alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={styles.rowLabel}>Recording Source</span>
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

        <div style={{ height: '12px' }} />
      </div>

      <div style={styles.modelsSection}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionTitle}>Primary Engine</span>
          <div style={styles.sectionLine} />
        </div>

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
                    <span style={{ fontSize: '11px', color: theme.warning }}>{pendingActionLabel}</span>
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
          {(selectedParakeetProgress || selectedParakeetSupportSummary) && selectedEngine !== 'whisper' && (
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

          {/* Upgrade nudge - shown when whisper is active and parakeet is not installed */}
          {selectedEngine === 'whisper' && !parakeetInstalled && (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: '6px',
                border: `1px solid ${theme.isDark ? 'rgba(59, 130, 246, 0.3)' : '#bfdbfe'}`,
                backgroundColor: theme.isDark ? 'rgba(59, 130, 246, 0.08)' : '#eff6ff',
                marginBottom: '4px',
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: 500, color: theme.text, marginBottom: '4px' }}>
                Upgrade to Parakeet
              </div>
              <div style={{ fontSize: '11px', color: theme.textSecondary, lineHeight: 1.4 }}>
                Parakeet is faster, more reliable, and produces higher quality transcriptions than Whisper.
                Install above to switch — {PARAKEET_ONE_TIME_SETUP_NOTE.toLowerCase()} Your Whisper setup will remain as a fallback.
              </div>
            </div>
          )}

          {/* Whisper fallback - de-emphasized */}
          <div
            style={{
              ...styles.modelCard,
              borderLeft: selectedEngine === 'whisper'
                ? `3px solid ${theme.isDark ? '#6b7280' : '#9ca3af'}`
                : `3px solid ${theme.isDark ? '#404040' : '#e5e7eb'}`,
              backgroundColor: selectedEngine === 'whisper'
                ? (theme.isDark ? 'rgba(107, 114, 128, 0.1)' : '#f9fafb')
                : 'transparent',
              opacity: selectedEngine === 'whisper' ? 0.85 : 0.6,
              cursor: 'pointer',
            }}
            onClick={() => handleEngineChange('whisper')}
          >
            <div style={styles.modelCardContent}>
              <div style={styles.modelCardHeader}>
                <span style={{ ...styles.rowValue, fontWeight: selectedEngine === 'whisper' ? 600 : 500 }}>
                  Whisper
                </span>
                <span style={{ fontSize: '10px', color: theme.textSecondary }}>Legacy</span>
              </div>
              <span style={styles.modelHint}>whisper.cpp — local fallback engine</span>
            </div>
            {selectedEngine === 'whisper' && (
              <span style={{ ...styles.downloadedBadge, color: theme.textSecondary }}>Selected</span>
            )}
          </div>

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
      </div>

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
    </div>
  );
}

// =============================================================================
// Unified Design System - Only 2 font sizes: 13px body, 11px headers
// =============================================================================
const getStyles = (theme: Theme): Record<string, React.CSSProperties> => ({
  container: {
    padding: 0,
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
    padding: '4px 0',
    minHeight: '32px',
  },
  rowLabel: {
    fontSize: '12px',
    color: theme.text,
    fontWeight: 400,
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

  // Models section.
  modelsSection: {
    marginTop: '16px',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '14px',
  },
  sectionTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: theme.text,
    letterSpacing: '-0.01em',
    whiteSpace: 'nowrap' as const,
  },
  sectionLine: {
    flex: 1,
    height: '1px',
    backgroundColor: theme.isDark ? theme.border : '#edf1f5',
  },

  // Model list and cards.
  modelsList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px',
    marginTop: '8px',
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
