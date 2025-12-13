// =============================================================================
// TranscriptionSettings - UI for managing local transcription settings.
// Displays model download status, transcription status, and controls.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';

type TranscriptionStatus = 'idle' | 'recording' | 'transcribing';
type ModelStatus = 'downloaded' | 'downloading' | 'missing';

type ModelInfo = {
  name: string;
  url: string;
  sizeBytes: number;
  description: string;
};

/**
 * TranscriptionSettings displays transcription status and model management.
 */
export default function TranscriptionSettings() {
  const [status, setStatus] = useState<TranscriptionStatus>('idle');
  const [modelStatus, setModelStatus] = useState<ModelStatus>('missing');
  const [downloadProgress, setDownloadProgress] = useState<{ downloaded: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [hotkey, setHotkey] = useState<string>('Alt+Space');
  const [isCapturingHotkey, setIsCapturingHotkey] = useState(false);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<Record<string, ModelInfo>>({});
  const [selectedModel, setSelectedModel] = useState<string>('base');
  const [modelDownloadStatus, setModelDownloadStatus] = useState<Record<string, boolean>>({});
  const [overlayStyle, setOverlayStyle] = useState<'rectangle' | 'top-emerging'>('rectangle');
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
  const [deletingModel, setDeletingModel] = useState<string | null>(null);
  const [modelDownloadProgress, setModelDownloadProgress] = useState<Record<string, { downloaded: number; total: number }>>({});
  
  // Abandon recording settings.
  const [abandonHotkey, setAbandonHotkey] = useState<string>('Escape');
  const [isCapturingAbandonHotkey, setIsCapturingAbandonHotkey] = useState(false);
  const [abandonHotkeyError, setAbandonHotkeyError] = useState<string | null>(null);
  const [abandonConfirmation, setAbandonConfirmation] = useState(true);

  const isMacOS = typeof window !== 'undefined' && window.platform?.isMacOS;

  // Fetch initial state and subscribe to changes.
  useEffect(() => {
    if (!isMacOS || !window.transcribeAPI) {
      return;
    }

    const fetchStatus = async () => {
      try {
        const [currentStatus, currentModelStatus, currentHotkey, models, currentSelectedModel, downloadStatus, currentOverlayStyle, currentAbandonHotkey, currentAbandonConfirmation] = await Promise.all([
          window.transcribeAPI!.getStatus(),
          window.transcribeAPI!.getModelStatus(),
          window.transcribeAPI!.getHotkey(),
          window.transcribeAPI!.getAvailableModels(),
          window.transcribeAPI!.getSelectedModel(),
          window.transcribeAPI!.getModelDownloadStatus(),
          window.transcribeAPI!.getOverlayStyle(),
          window.transcribeAPI!.getAbandonHotkey?.() ?? 'Escape',
          window.transcribeAPI!.getAbandonConfirmation?.() ?? true,
        ]);
        setStatus(currentStatus);
        setModelStatus(currentModelStatus);
        setHotkey(currentHotkey);
        setAvailableModels(models);
        setSelectedModel(currentSelectedModel);
        setModelDownloadStatus(downloadStatus);
        setOverlayStyle(currentOverlayStyle);
        setAbandonHotkey(currentAbandonHotkey);
        setAbandonConfirmation(currentAbandonConfirmation);
      } catch (err) {
        console.error('Failed to fetch transcription status:', err);
      }
    };

    fetchStatus();

    // Subscribe to status changes.
    const unsubscribeStatus = window.transcribeAPI!.onStatusChanged((newStatus) => {
      setStatus(newStatus);
    });

    const unsubscribeResult = window.transcribeAPI!.onResult((text) => {
      console.log('Transcription result:', text);
      // Could show a toast notification here
    });

    const unsubscribeError = window.transcribeAPI!.onError((errorMsg) => {
      setError(errorMsg);
      console.error('Transcription error:', errorMsg);
    });

    const unsubscribeProgress = window.transcribeAPI!.onModelDownloadProgress((downloaded, total) => {
      setDownloadProgress({ downloaded, total });
      // Also track progress for the currently downloading model
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

  // Handler for downloading the model.
  const handleDownloadModel = useCallback(async () => {
    if (!window.transcribeAPI || isDownloading) return;

    setIsDownloading(true);
    setError(null);
    setModelStatus('downloading');

    try {
      await window.transcribeAPI.downloadModel(selectedModel);
      setModelStatus('downloaded');
      setDownloadProgress(null);
      // Refresh download status for all models
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

  // Handler for downloading a specific model.
  const handleDownloadModelForSize = useCallback(async (modelSize: string) => {
    if (!window.transcribeAPI || downloadingModel) return;

    setDownloadingModel(modelSize);
    setError(null);

    try {
      await window.transcribeAPI.downloadModel(modelSize);
      // Refresh download status for all models
      const downloadStatus = await window.transcribeAPI.getModelDownloadStatus();
      setModelDownloadStatus(downloadStatus);
      setModelDownloadProgress(prev => {
        const next = { ...prev };
        delete next[modelSize];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to download ${modelSize} model`);
      console.error(`Failed to download ${modelSize} model:`, err);
    } finally {
      setDownloadingModel(null);
    }
  }, [downloadingModel]);

  // Handler for changing the selected model.
  const handleModelChange = useCallback(async (newModel: string) => {
    if (!window.transcribeAPI || isDownloading) return;
    
    setSelectedModel(newModel);
    setError(null);
    try {
      await window.transcribeAPI.setSelectedModel(newModel);
      // Refresh model status for the new model
      const newModelStatus = await window.transcribeAPI.getModelStatus();
      setModelStatus(newModelStatus);
      setDownloadProgress(null);
      // Refresh download status for all models
      const downloadStatus = await window.transcribeAPI.getModelDownloadStatus();
      setModelDownloadStatus(downloadStatus);
    } catch (err) {
      console.error('Failed to change model:', err);
      setError(err instanceof Error ? err.message : 'Failed to change model');
    }
  }, [isDownloading]);

  // Handler for deleting a specific model.
  const handleDeleteModel = useCallback(async (modelSize: string) => {
    if (!window.transcribeAPI || deletingModel) return;

    // Don't allow deleting the currently selected model if it's the only one downloaded
    const downloadStatus = await window.transcribeAPI.getModelDownloadStatus();
    const downloadedCount = Object.values(downloadStatus).filter(Boolean).length;
    if (modelSize === selectedModel && downloadedCount === 1) {
      setError('Cannot delete the only downloaded model. Please download another model first.');
      return;
    }

    setDeletingModel(modelSize);
    setError(null);

    try {
      await window.transcribeAPI.deleteModel(modelSize);
      // Refresh download status for all models
      const newDownloadStatus = await window.transcribeAPI.getModelDownloadStatus();
      setModelDownloadStatus(newDownloadStatus);
      
      // If we deleted the selected model, switch to another downloaded model or base
      if (modelSize === selectedModel) {
        const availableModel = Object.entries(newDownloadStatus).find(([size, downloaded]) => 
          downloaded && size !== modelSize
        )?.[0] || 'base';
        await handleModelChange(availableModel);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to delete ${modelSize} model`);
      console.error(`Failed to delete ${modelSize} model:`, err);
    } finally {
      setDeletingModel(null);
    }
  }, [deletingModel, selectedModel, handleModelChange]);

  // Handler for changing overlay style.
  const handleOverlayStyleChange = useCallback(async (newStyle: 'rectangle' | 'top-emerging') => {
    if (!window.transcribeAPI) return;
    
    setOverlayStyle(newStyle);
    setError(null);
    try {
      await window.transcribeAPI.setOverlayStyle(newStyle);
    } catch (err) {
      console.error('Failed to change overlay style:', err);
      setError(err instanceof Error ? err.message : 'Failed to change overlay style');
    }
  }, []);
  
  // Handler for setting abandon recording hotkey.
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
  
  // Handler for changing abandon confirmation setting.
  const handleAbandonConfirmationChange = useCallback(async (enabled: boolean) => {
    if (!window.transcribeAPI?.setAbandonConfirmation) return;
    
    setAbandonConfirmation(enabled);
    try {
      await window.transcribeAPI.setAbandonConfirmation(enabled);
    } catch (err) {
      console.error('Failed to change abandon confirmation setting:', err);
    }
  }, []);

  // Handler for capturing hotkey.
  const handleStartCaptureHotkey = useCallback(() => {
    setIsCapturingHotkey(true);
    setHotkeyError(null);
  }, []);

  // Handler for setting hotkey.
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

  // Handler for keydown events when capturing hotkey (transcription or abandon).
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

      // Get the key name
      let key = event.key;
      
      // Handle special keys
      if (key === ' ') {
        key = 'Space';
      } else if (key === '`' || key === 'Backquote') {
        key = '`';
      } else if (key === 'CapsLock') {
        key = 'CapsLock';
      } else if (key.length === 1 && key.match(/[a-z]/i)) {
        key = key.toUpperCase();
      }

      // Map common key names to Electron format
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

      if (keyMap[key]) {
        key = keyMap[key];
      }

      // Filter out modifier keys from the key itself
      if (key === 'Meta' || key === 'Control' || key === 'Alt' || key === 'Shift') {
        // This is a modifier-only press
        if (parts.length === 0) {
          // Single modifier key
          handleSetHotkey(key);
          return;
        }
        // Modifier is already in parts, skip
        return;
      }

      // Build hotkey string
      let hotkeyString: string;
      if (parts.length > 0) {
        // Modifier + key combination
        hotkeyString = parts.join('+') + '+' + key;
      } else {
        // Single key (no modifiers)
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

  // If not on macOS, show a message.
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

  // Calculate download progress percentage.
  const downloadPercent = downloadProgress
    ? Math.round((downloadProgress.downloaded / downloadProgress.total) * 100)
    : 0;

  // Status indicator with colored dot.
  const StatusDot = ({ color }: { color: string }) => (
    <span style={{ ...styles.statusDot, backgroundColor: color }} />
  );

  // Get status color.
  const getStatusColor = () => {
    if (status === 'recording') return '#3b82f6';
    if (status === 'transcribing') return '#f59e0b';
    return '#22c55e';
  };

  const getStatusText = () => {
    if (status === 'recording') return 'Recording';
    if (status === 'transcribing') return 'Transcribing';
    return 'Ready';
  };

  return (
    <div style={styles.container}>
      {/* Compact status row */}
      <div style={styles.row}>
        <span style={styles.rowLabel}>Status</span>
        <span style={{ ...styles.rowValue, color: getStatusColor() }}>
          <StatusDot color={getStatusColor()} />
          {getStatusText()} • {selectedModel} {modelStatus === 'downloaded' ? '✓' : modelStatus === 'downloading' ? '↓' : '✗'}
        </span>
      </div>

      {/* Recording hotkey */}
      <div style={styles.row}>
        <span style={styles.rowLabel}>Hotkey</span>
        <div style={styles.rowControls}>
          <button
            onClick={handleStartCaptureHotkey}
            disabled={isCapturingHotkey}
            style={{ ...styles.btn, ...(isCapturingHotkey ? styles.btnActive : {}) }}
          >
            {isCapturingHotkey ? 'Press keys...' : hotkey}
          </button>
          {isCapturingHotkey && (
            <button onClick={() => { setIsCapturingHotkey(false); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
          )}
        </div>
      </div>
      {hotkeyError && <p style={styles.error}>{hotkeyError}</p>}

      {/* Overlay style */}
      <div style={styles.row}>
        <span style={styles.rowLabel}>Overlay</span>
        <select
          value={overlayStyle}
          onChange={(e) => handleOverlayStyleChange(e.target.value as 'rectangle' | 'top-emerging')}
          style={styles.select}
        >
          <option value="rectangle">Rectangle</option>
          <option value="top-emerging">Dynamic Island</option>
        </select>
      </div>

      {/* Abandon hotkey */}
      <div style={styles.row}>
        <span style={styles.rowLabel}>Abandon</span>
        <div style={styles.rowControls}>
          <button
            onClick={() => { setIsCapturingAbandonHotkey(true); setAbandonHotkeyError(null); }}
            disabled={isCapturingAbandonHotkey || isCapturingHotkey}
            style={{ ...styles.btn, ...(isCapturingAbandonHotkey ? styles.btnActive : {}) }}
          >
            {isCapturingAbandonHotkey ? 'Press keys...' : abandonHotkey}
          </button>
          {isCapturingAbandonHotkey && (
            <button onClick={() => { setIsCapturingAbandonHotkey(false); setAbandonHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
          )}
          <button
            onClick={() => handleAbandonConfirmationChange(!abandonConfirmation)}
            style={{ ...styles.toggle, backgroundColor: abandonConfirmation ? '#22c55e' : '#d1d5db' }}
            title={abandonConfirmation ? 'Confirm enabled' : 'Confirm disabled'}
          >
            <span style={{ ...styles.toggleKnob, transform: abandonConfirmation ? 'translateX(20px)' : 'translateX(2px)' }} />
          </button>
        </div>
      </div>
      {abandonHotkeyError && <p style={styles.error}>{abandonHotkeyError}</p>}

      {/* Error display */}
      {error && <p style={styles.error}>{error}</p>}

      {/* Models section with sub-header */}
      <div style={styles.modelsSection}>
        <div style={styles.sectionHeader}>
          <span style={styles.sectionTitle}>MODELS</span>
          <div style={styles.sectionLine} />
        </div>
        
        {/* Active model selector */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Active</span>
          <select
            value={selectedModel}
            onChange={(e) => handleModelChange(e.target.value)}
            disabled={isDownloading || downloadingModel !== null}
            style={styles.select}
          >
            {Object.entries(availableModels)
              .filter(([size]) => size !== 'base')
              .map(([size, info]) => {
                const isDownloaded = modelDownloadStatus[size] || false;
                return (
                  <option key={size} value={size} disabled={!isDownloaded}>
                    {info.description} {isDownloaded ? '' : '(not downloaded)'}
                  </option>
                );
              })}
          </select>
        </div>

        {/* Model cards with more context */}
        <div style={styles.modelsList}>
          {Object.entries(availableModels)
            .filter(([size]) => size !== 'base')
            .map(([size, info]) => {
              const isDownloaded = modelDownloadStatus[size] || false;
              const isSelected = size === selectedModel;
              const isDownloadingThis = downloadingModel === size;
              const isDeletingThis = deletingModel === size;
              const progress = modelDownloadProgress[size];
              const progressPercent = progress ? Math.round((progress.downloaded / progress.total) * 100) : 0;
              const sizeMB = (info.sizeBytes / 1024 / 1024).toFixed(0);
              
              // Model quality hints.
              const qualityHint = size === 'small' ? 'Good for quick tasks'
                : size === 'medium' ? 'Balanced accuracy'
                : size === 'large' ? 'Best accuracy'
                : size === 'turbo' ? 'Fast + accurate'
                : '';

              return (
                <div
                  key={size}
                  style={{
                    ...styles.modelCard,
                    borderLeft: isSelected ? '3px solid #3b82f6' : isDownloaded ? '3px solid #22c55e' : '3px solid #e5e7eb',
                    backgroundColor: isSelected ? '#f0f9ff' : 'transparent',
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
                          disabled={isDeletingThis || (isSelected && Object.values(modelDownloadStatus).filter(Boolean).length === 1)}
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
    </div>
  );
}

// =============================================================================
// Unified Design System - Only 2 font sizes: 13px body, 11px headers
// =============================================================================
const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: 0,
  },
  notAvailable: {
    color: '#6b7280',
    fontStyle: 'italic',
    fontSize: '13px',
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
    fontSize: '13px',
    color: '#374151',
    fontWeight: 400,
  },
  rowValue: {
    fontSize: '13px',
    color: '#111827',
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
    fontSize: '13px',
    fontWeight: 500,
    color: '#374151',
    backgroundColor: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
    minWidth: '80px',
    textAlign: 'center' as const,
  },
  btnActive: {
    backgroundColor: '#3b82f6',
    color: '#fff',
    borderColor: '#3b82f6',
  },
  btnGhost: {
    backgroundColor: 'transparent',
    border: 'none',
    color: '#6b7280',
    minWidth: 'auto',
    padding: '6px 8px',
    fontSize: '13px',
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
    fontSize: '13px',
    color: '#374151',
    backgroundColor: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
    minWidth: '160px',
  },
  
  // Error text.
  error: {
    fontSize: '13px',
    color: '#ef4444',
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
    color: '#9ca3af',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    whiteSpace: 'nowrap' as const,
  },
  sectionLine: {
    flex: 1,
    height: '1px',
    backgroundColor: '#e5e7eb',
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
    border: '1px solid #e5e7eb',
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
    fontSize: '13px',
    color: '#9ca3af',
  },
  modelHint: {
    fontSize: '11px',
    color: '#9ca3af',
  },
  downloadedBadge: {
    fontSize: '11px',
    fontWeight: 500,
    color: '#22c55e',
  },
  
  // Progress bar for downloads.
  progressBar: {
    position: 'relative' as const,
    width: '80px',
    height: '6px',
    backgroundColor: '#e5e7eb',
    borderRadius: '3px',
    overflow: 'hidden',
  },
  progressFill: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    height: '100%',
    backgroundColor: '#3b82f6',
    borderRadius: '3px',
    transition: 'width 0.3s ease',
  },
  progressText: {
    position: 'absolute' as const,
    top: '10px',
    left: 0,
    fontSize: '11px',
    color: '#6b7280',
  },
};

