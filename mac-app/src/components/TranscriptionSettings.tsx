import { useEffect, useState, useCallback } from 'react';
import { useTheme, Theme } from '../contexts/ThemeContext';

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

  // Engine selection state.
  const [selectedEngine, setSelectedEngine] = useState<'whisper' | 'parakeet'>('whisper');
  const [parakeetInstalled, setParakeetInstalled] = useState(false);
  const [settingUpParakeet, setSettingUpParakeet] = useState(false);
  const [parakeetSetupError, setParakeetSetupError] = useState<string | null>(null);

  const [abandonHotkey, setAbandonHotkey] = useState<string>('Escape');
  const [isCapturingAbandonHotkey, setIsCapturingAbandonHotkey] = useState(false);
  const [abandonHotkeyError, setAbandonHotkeyError] = useState<string | null>(null);

  const isMacOS = typeof window !== 'undefined' && window.platform?.isMacOS;

  const styles = getStyles(theme);

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
        setModelDownloadStatus(downloadStatus);
        // If a download is in progress, restore that state.
        if (downloadingModels.length > 0) {
          setDownloadingModel(downloadingModels[0]);
        }
        setAbandonHotkey(currentAbandonHotkey);
        setHotMicHotkey(currentHotMicHotkey);

        // Fetch current engine selection. Only Whisper and Parakeet are user-facing.
        const currentEngine = await window.transcribeAPI!.getTranscriptionEngine?.() ?? 'whisper';
        setSelectedEngine(currentEngine === 'parakeet' ? 'parakeet' : 'whisper');

        // Check Parakeet installation status.
        const parakeetInstalled = await window.transcribeAPI!.isParakeetInstalled?.() ?? false;
        setParakeetInstalled(parakeetInstalled);
      } catch (err) {
        console.error('Failed to fetch transcription status:', err);
      }
    };

    fetchStatus();

    const unsubscribeStatus = window.transcribeAPI!.onStatusChanged((newStatus) => {
      setStatus(newStatus);
    });

    const unsubscribeResult = window.transcribeAPI!.onResult((text) => {
      console.log('Transcription result:', text);
    });

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

    const unsubscribeHotkey = window.transcribeAPI!.onHotkeyChanged((newHotkey) => {
      setHotkey(newHotkey);
    });

    return () => {
      unsubscribeStatus();
      unsubscribeResult();
      unsubscribeError();
      unsubscribeProgress();
      unsubscribeHotkey();
    };
  }, [isMacOS, downloadingModel]);

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

  const handleEngineChange = useCallback(async (engine: 'whisper' | 'parakeet') => {
    if (!window.transcribeAPI) return;
    setSelectedEngine(engine);
    try {
      await window.transcribeAPI.setTranscriptionEngine?.(engine);
    } catch (err) {
      console.error('Failed to set transcription engine:', err);
    }
  }, []);

  const handleSetupParakeet = useCallback(async () => {
    if (!window.transcribeAPI || settingUpParakeet) return;
    setSettingUpParakeet(true);
    setParakeetSetupError(null);
    try {
      const result = await window.transcribeAPI.setupParakeet?.();
      if (result?.success) {
        setParakeetInstalled(true);
      } else {
        setParakeetSetupError(result?.error ?? 'Setup failed');
      }
    } catch (err) {
      setParakeetSetupError(err instanceof Error ? err.message : 'Setup failed');
    } finally {
      setSettingUpParakeet(false);
    }
  }, [settingUpParakeet]);

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

  const handleSetHotkey = useCallback(async (newHotkey: string) => {
    if (!window.transcribeAPI) return;

    setIsCapturingHotkey(false);
    setHotkeyError(null);

    try {
      const success = await window.transcribeAPI.setHotkey(newHotkey);
      if (!success) {
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
          <span style={styles.sectionTitle}>SHORTCUTS</span>
          <div style={styles.sectionLine} />
        </div>
        <div style={styles.row}>
          <span style={styles.rowLabel}>Standard Recording</span>
          <div style={styles.rowControls}>
            <button
              onClick={handleStartCaptureHotkey}
              disabled={isCapturingHotMicHotkey || isCapturingAbandonHotkey}
              style={{ ...styles.btn, ...(isCapturingHotkey ? styles.btnActive : {}) }}
            >
              {isCapturingHotkey ? 'Press keys...' : hotkey}
            </button>
            {isCapturingHotkey && (
              <button
                onClick={() => {
                  setIsCapturingHotkey(false);
                  setHotkeyError(null);
                }}
                style={styles.btnGhost}
              >
                Cancel
              </button>
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

        <div style={{ height: '12px' }} />
      </div>

      <div style={styles.modelsSection}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionTitle}>PRIMARY ENGINE</span>
          <div style={styles.sectionLine} />
        </div>

        <div style={styles.modelsList}>
          {/* Whisper engine option */}
          <div
            style={{
              ...styles.modelCard,
              borderLeft: selectedEngine === 'whisper'
                ? `3px solid ${theme.info}`
                : `3px solid ${theme.isDark ? '#404040' : '#e5e7eb'}`,
              backgroundColor: selectedEngine === 'whisper'
                ? (theme.isDark ? 'rgba(59, 130, 246, 0.15)' : '#f0f9ff')
                : 'transparent',
              cursor: 'pointer',
            }}
            onClick={() => handleEngineChange('whisper')}
          >
            <div style={styles.modelCardContent}>
              <div style={styles.modelCardHeader}>
                <span style={{ ...styles.rowValue, fontWeight: selectedEngine === 'whisper' ? 600 : 500 }}>
                  Whisper
                </span>
              </div>
              <span style={styles.modelHint}>whisper.cpp — fast local transcription</span>
            </div>
            {selectedEngine === 'whisper' && (
              <span style={styles.downloadedBadge}>Active</span>
            )}
          </div>

          {/* Parakeet engine option */}
          <div
            style={{
              ...styles.modelCard,
              borderLeft: selectedEngine === 'parakeet'
                ? `3px solid ${theme.info}`
                : `3px solid ${theme.isDark ? '#404040' : '#e5e7eb'}`,
              backgroundColor: selectedEngine === 'parakeet'
                ? (theme.isDark ? 'rgba(59, 130, 246, 0.15)' : '#f0f9ff')
                : 'transparent',
              cursor: parakeetInstalled ? 'pointer' : 'default',
            }}
            onClick={() => parakeetInstalled && handleEngineChange('parakeet')}
          >
            <div style={styles.modelCardContent}>
              <div style={styles.modelCardHeader}>
                <span style={{ ...styles.rowValue, fontWeight: selectedEngine === 'parakeet' ? 600 : 500 }}>
                  Parakeet
                </span>
                <span style={styles.modelSize}>~600MB</span>
              </div>
              <span style={styles.modelHint}>NVIDIA Parakeet TDT 0.6B — high-accuracy English ASR</span>
            </div>
            <div style={styles.rowControls}>
              {parakeetInstalled ? (
                selectedEngine === 'parakeet' ? (
                  <span style={styles.downloadedBadge}>Active</span>
                ) : (
                  <span style={{ ...styles.downloadedBadge, color: theme.textSecondary }}>Installed</span>
                )
              ) : settingUpParakeet ? (
                <span style={{ fontSize: '11px', color: theme.warning }}>Installing...</span>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); handleSetupParakeet(); }}
                  style={styles.btn}
                >
                  Install
                </button>
              )}
            </div>
          </div>
          {parakeetSetupError && (
            <div style={{ fontSize: '11px', color: theme.error, marginTop: '4px', padding: '0 4px' }}>
              {parakeetSetupError}
            </div>
          )}
        </div>
      </div>

      <div style={styles.modelsSection}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionTitle}>WHISPER MODELS</span>
          <div style={styles.sectionLine} />
        </div>

        <div style={styles.row}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={styles.rowLabel}>Active</span>
            <span style={{ fontSize: '10px', color: getStatusColor(), display: 'flex', alignItems: 'center', gap: '4px' }}>
              <span style={{ ...styles.statusDot, backgroundColor: getStatusColor(), width: '6px', height: '6px' }} />
              {selectedModel === 'none' ? 'No model' : `${getStatusText()} • ${selectedModel} ${modelStatus === 'downloaded' ? '✓' : modelStatus === 'downloading' ? '↓' : '✗'}`}
            </span>
          </div>
          <select
            value={selectedModel}
            onChange={(e) => handleModelChange(e.target.value)}
            disabled={downloadingModel !== null}
            style={styles.select}
          >
            {!Object.values(modelDownloadStatus).some(Boolean) && (
              <option value="none">No models downloaded</option>
            )}
            {Object.entries(availableModels).map(([size, info]) => {
                const isDownloaded = modelDownloadStatus[size] || false;
                return (
                  <option key={size} value={size} disabled={!isDownloaded}>
                    {info.description} {isDownloaded ? '' : '(not downloaded)'}
                  </option>
                );
              })}
          </select>
        </div>

        <div style={styles.modelsList}>
          {Object.entries(availableModels).map(([size, info]) => {
              const isDownloaded = modelDownloadStatus[size] || false;
              const isSelected = size === selectedModel;
              const isDownloadingThis = downloadingModel === size;
              const isDeletingThis = deletingModel === size;
              const progress = modelDownloadProgress[size];
              const progressPercent = progress ? Math.round((progress.downloaded / progress.total) * 100) : 0;
              const sizeMB = (info.sizeBytes / 1024 / 1024).toFixed(0);

              const qualityHint = size === 'small'
                ? 'Fast and reliable accuracy'
                : '';

              return (
                <div
                  key={size}
                  style={{
                    ...styles.modelCard,
                    borderLeft: isSelected ? `3px solid ${theme.info}` : isDownloaded ? `3px solid ${theme.success}` : `3px solid ${theme.isDark ? '#404040' : '#e5e7eb'}`,
                    backgroundColor: isSelected
                      ? (theme.isDark ? 'rgba(59, 130, 246, 0.15)' : '#f0f9ff')
                      : 'transparent',
                  }}
                >
                  <div style={styles.modelCardContent}>
                    <div style={styles.modelCardHeader}>
                      <span style={{ ...styles.rowValue, fontWeight: isSelected ? 600 : 500 }}>
                        {info.description.split(' - ')[0]}
                      </span>
                      <span style={styles.modelSize}>{sizeMB}MB</span>
                    </div>
                    <span style={styles.modelHint}>{qualityHint}</span>
                  </div>

                  <div style={styles.rowControls}>
                    {isDownloadingThis && progress ? (
                      <div style={styles.progressBar}>
                        <div style={{ ...styles.progressFill, width: `${progressPercent}%` }} />
                        <span style={styles.progressText}>{progressPercent}%</span>
                      </div>
                    ) : isDownloaded ? (
                      <>
                        <span style={styles.downloadedBadge}>Downloaded</span>
                        <button
                          onClick={() => handleDeleteModel(size)}
                          disabled={isDeletingThis}
                          style={{ ...styles.btnGhost, color: '#9ca3af', opacity: isDeletingThis ? 0.5 : 1 }}
                          title="Delete model"
                        >
                          {isDeletingThis ? '...' : '×'}
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleDownloadModelForSize(size)}
                        disabled={downloadingModel !== null}
                        style={{ ...styles.btn, opacity: downloadingModel !== null ? 0.5 : 1 }}
                      >
                        Download
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
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
    gap: '12px',
    marginBottom: '8px',
  },
  sectionTitle: {
    fontSize: '11px',
    fontWeight: 600,
    color: theme.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    whiteSpace: 'nowrap' as const,
  },
  sectionLine: {
    flex: 1,
    height: '1px',
    backgroundColor: theme.border,
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
