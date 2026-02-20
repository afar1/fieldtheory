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

export default function TranscriptionSettings() {
  const { theme } = useTheme();
  const [status, setStatus] = useState<TranscriptionStatus>('idle');
  const [modelStatus, setModelStatus] = useState<ModelStatus>('missing');
  const [downloadProgress, setDownloadProgress] = useState<{ downloaded: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [hotkey, setHotkey] = useState<string>('Command+\\');
  const [isCapturingHotkey, setIsCapturingHotkey] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<Record<string, ModelInfo>>({});
  const [selectedModel, setSelectedModel] = useState<string>('small');
  const [modelDownloadStatus, setModelDownloadStatus] = useState<Record<string, boolean>>({});
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
  const [deletingModel, setDeletingModel] = useState<string | null>(null);
  const [modelDownloadProgress, setModelDownloadProgress] = useState<Record<string, { downloaded: number; total: number }>>({});
  const [engine, setEngine] = useState<'whisper' | 'qwen'>('whisper');
  const [qwenInstalled, setQwenInstalled] = useState(false);
  const [appleSilicon, setAppleSilicon] = useState(true);
  const [qwenSetupStatus, setQwenSetupStatus] = useState<'idle' | 'installing' | 'done' | 'error'>('idle');
  const [qwenSetupError, setQwenSetupError] = useState<string | null>(null);

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
        const [currentStatus, currentModelStatus, currentHotkey, models, currentSelectedModel, downloadStatus, downloadingModels, currentAbandonHotkey] = await Promise.all([
          window.transcribeAPI!.getStatus(),
          window.transcribeAPI!.getModelStatus(),
          window.transcribeAPI!.getHotkey(),
          window.transcribeAPI!.getAvailableModels(),
          window.transcribeAPI!.getSelectedModel(),
          window.transcribeAPI!.getModelDownloadStatus(),
          window.transcribeAPI!.getDownloadingModels?.() ?? [],
          window.transcribeAPI!.getAbandonHotkey?.() ?? 'Escape',
        ]);
        setStatus(currentStatus);
        setModelStatus(currentModelStatus);
        setHotkey(currentHotkey);
        setAvailableModels(models);
        setSelectedModel(currentSelectedModel);
        setModelDownloadStatus(downloadStatus);
        // If a download is in progress, restore that state.
        if (downloadingModels.length > 0) {
          setDownloadingModel(downloadingModels[0]);
        }
        setAbandonHotkey(currentAbandonHotkey);

        // Fetch transcription engine
        const currentEngine = await window.transcribeAPI!.getTranscriptionEngine?.() ?? 'whisper';
        setEngine(currentEngine);

        // Fetch Qwen installation status
        const [qi, as] = await Promise.all([
          window.transcribeAPI!.isQwenInstalled?.() ?? false,
          window.transcribeAPI!.isAppleSilicon?.() ?? true,
        ]);
        setQwenInstalled(qi);
        setAppleSilicon(as);
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
      setDownloadProgress({ downloaded, total });
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

  const handleDownloadModel = useCallback(async () => {
    if (!window.transcribeAPI || isDownloading) return;

    setIsDownloading(true);
    setError(null);
    setModelStatus('downloading');

    try {
      await window.transcribeAPI.downloadModel(selectedModel);
      setModelStatus('downloaded');
      setDownloadProgress(null);
      const downloadStatus = await window.transcribeAPI.getModelDownloadStatus();
      setModelDownloadStatus(downloadStatus);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download model');
      setModelStatus('missing');
      console.error('Failed to download model:', err);
    } finally {
      setIsDownloading(false);
    }
  }, [isDownloading, selectedModel]);

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
    if (!window.transcribeAPI || isDownloading) return;
    
    setSelectedModel(newModel);
    setError(null);
    try {
      await window.transcribeAPI.setSelectedModel(newModel);
      const newModelStatus = await window.transcribeAPI.getModelStatus();
      setModelStatus(newModelStatus);
      setDownloadProgress(null);
      const downloadStatus = await window.transcribeAPI.getModelDownloadStatus();
      setModelDownloadStatus(downloadStatus);
    } catch (err) {
      console.error('Failed to change model:', err);
      setError(err instanceof Error ? err.message : 'Failed to change model');
    }
  }, [isDownloading]);

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

  const handleSetupQwen = useCallback(async () => {
    if (!window.transcribeAPI?.setupQwen) return;
    setQwenSetupStatus('installing');
    setQwenSetupError(null);
    try {
      const result = await window.transcribeAPI.setupQwen();
      if (result.success) {
        setQwenSetupStatus('done');
        setQwenInstalled(true);
        // Auto-switch engine to Qwen
        if (window.transcribeAPI.setTranscriptionEngine) {
          await window.transcribeAPI.setTranscriptionEngine('qwen');
          setEngine('qwen');
        }
      } else {
        setQwenSetupStatus('error');
        setQwenSetupError(result.error || 'Setup failed');
      }
    } catch (err) {
      setQwenSetupStatus('error');
      setQwenSetupError(err instanceof Error ? err.message : 'Setup failed');
    }
  }, []);

  const handleEngineChange = useCallback(async (newEngine: 'whisper' | 'qwen') => {
    if (!window.transcribeAPI?.setTranscriptionEngine) return;
    setEngine(newEngine);
    try {
      await window.transcribeAPI.setTranscriptionEngine(newEngine);
    } catch (err) {
      console.error('Failed to set transcription engine:', err);
      setEngine(engine); // revert on failure
    }
  }, [engine]);

  const handleStartCaptureHotkey = useCallback(() => {
    setIsCapturingHotkey(true);
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

  useEffect(() => {
    const capturing = isCapturingHotkey ? 'transcription' : isCapturingAbandonHotkey ? 'abandon' : null;
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
      } else if (capturing === 'abandon') {
        handleSetAbandonHotkey(hotkeyString);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isCapturingHotkey, isCapturingAbandonHotkey, handleSetHotkey, handleSetAbandonHotkey]);

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
          <span style={styles.sectionTitle}>TRANSCRIPTION ENGINE</span>
          <div style={styles.sectionLine} />
        </div>
        <div style={styles.row}>
          <span style={styles.rowLabel}>Engine</span>
          <select
            value={engine}
            onChange={(e) => handleEngineChange(e.target.value as 'whisper' | 'qwen')}
            style={styles.select}
          >
            <option value="whisper">Whisper (default)</option>
            <option value="qwen" disabled={!appleSilicon}>Qwen3-ASR{!appleSilicon ? ' (requires Apple Silicon)' : ''}</option>
          </select>
        </div>
        {!appleSilicon && engine !== 'qwen' && (
          <div style={{ fontSize: '11px', color: theme.textSecondary, marginTop: '4px' }}>
            Qwen requires Apple Silicon (M1 or later).
          </div>
        )}
        {appleSilicon && !qwenInstalled && (
          <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {qwenSetupStatus === 'installing' ? (
              <span style={{ fontSize: '12px', color: theme.textSecondary }}>Installing Qwen voice model...</span>
            ) : qwenSetupStatus === 'done' ? (
              <span style={{ fontSize: '12px', color: theme.success }}>Installed</span>
            ) : (
              <button
                onClick={handleSetupQwen}
                style={{
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: '#fff',
                  backgroundColor: theme.info,
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                }}
              >
                Download Qwen Voice Model
              </button>
            )}
            {qwenSetupStatus === 'error' && qwenSetupError && (
              <span style={{ fontSize: '11px', color: theme.error }}>{qwenSetupError}</span>
            )}
          </div>
        )}
        {appleSilicon && qwenInstalled && engine === 'qwen' && (
          <div style={{ fontSize: '11px', color: theme.success, marginTop: '4px' }}>
            Qwen voice model installed.
          </div>
        )}
      </div>

      <div style={{ ...styles.modelsSection, opacity: engine === 'qwen' ? 0.4 : 1, pointerEvents: engine === 'qwen' ? 'none' : 'auto' }}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionTitle}>LOCAL TRANSCRIPTION MODELS</span>
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
            disabled={isDownloading || downloadingModel !== null}
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

              const qualityHint = size === 'small' ? 'Fast and reliable accuracy' : '';

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

      {error && <p style={styles.error}>{error}</p>}
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

