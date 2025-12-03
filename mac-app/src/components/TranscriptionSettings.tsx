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

  const isMacOS = typeof window !== 'undefined' && window.platform?.isMacOS;

  // Fetch initial state and subscribe to changes.
  useEffect(() => {
    if (!isMacOS || !window.transcribeAPI) {
      return;
    }

    const fetchStatus = async () => {
      try {
        const [currentStatus, currentModelStatus, currentHotkey, models, currentSelectedModel, downloadStatus, currentOverlayStyle] = await Promise.all([
          window.transcribeAPI!.getStatus(),
          window.transcribeAPI!.getModelStatus(),
          window.transcribeAPI!.getHotkey(),
          window.transcribeAPI!.getAvailableModels(),
          window.transcribeAPI!.getSelectedModel(),
          window.transcribeAPI!.getModelDownloadStatus(),
          window.transcribeAPI!.getOverlayStyle(),
        ]);
        setStatus(currentStatus);
        setModelStatus(currentModelStatus);
        setHotkey(currentHotkey);
        setAvailableModels(models);
        setSelectedModel(currentSelectedModel);
        setModelDownloadStatus(downloadStatus);
        setOverlayStyle(currentOverlayStyle);
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

  // Handler for keydown events when capturing hotkey.
  useEffect(() => {
    if (!isCapturingHotkey) return;

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

      handleSetHotkey(hotkeyString);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isCapturingHotkey, handleSetHotkey]);

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

  return (
    <div style={styles.container}>
      <h2 style={styles.heading}>Local Transcription</h2>

      {/* Status section */}
      <div style={styles.statusCard}>
        <div style={styles.statusRow}>
          <span style={styles.statusLabel}>Status:</span>
          <span style={{
            ...styles.statusValue,
            color: status === 'recording' ? '#3b82f6' : status === 'transcribing' ? '#f59e0b' : '#6b7280',
          }}>
            {status === 'idle' && 'Ready'}
            {status === 'recording' && 'Recording...'}
            {status === 'transcribing' && 'Transcribing...'}
          </span>
        </div>

        <div style={styles.statusRow}>
          <span style={styles.statusLabel}>Model:</span>
          <span style={{
            ...styles.statusValue,
            color: modelStatus === 'downloaded' ? '#22c55e' : modelStatus === 'downloading' ? '#f59e0b' : '#ef4444',
          }}>
            {modelStatus === 'downloaded' && 'Downloaded'}
            {modelStatus === 'downloading' && 'Downloading...'}
            {modelStatus === 'missing' && 'Not downloaded'}
          </span>
        </div>

        <div style={styles.statusRow}>
          <span style={styles.statusLabel}>Hotkey:</span>
          <span style={styles.statusValue}>{hotkey}</span>
        </div>
      </div>

      {/* Hotkey configuration section */}
      <div style={styles.controlsSection}>
        <h3 style={styles.subheading}>Keyboard Shortcut</h3>
        <p style={styles.helpText}>
          Click the button below and press your desired key or key combination to set a new hotkey.
          You can use single keys (like Caps Lock or backtick `), modifier keys alone, or combinations.
          Press the hotkey once to start recording, press again to stop and transcribe.
        </p>
        <p style={{ ...styles.helpText, fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
          Note: Some single keys may not be supported by the system. If registration fails, try a modifier combination instead.
        </p>

        <div style={styles.hotkeyContainer}>
          <button
            onClick={handleStartCaptureHotkey}
            disabled={isCapturingHotkey}
            style={{
              ...styles.hotkeyButton,
              ...(isCapturingHotkey ? styles.hotkeyButtonActive : {}),
            }}
          >
            {isCapturingHotkey ? 'Press your key combination...' : `Change Hotkey (Current: ${hotkey})`}
          </button>
          {isCapturingHotkey && (
            <button
              onClick={() => {
                setIsCapturingHotkey(false);
                setHotkeyError(null);
              }}
              style={styles.cancelButton}
            >
              Cancel
            </button>
          )}
        </div>

        {hotkeyError && (
          <p style={styles.hotkeyErrorText}>{hotkeyError}</p>
        )}
      </div>

      {/* Overlay style configuration section */}
      <div style={styles.controlsSection}>
        <h3 style={styles.subheading}>Recording Overlay Style</h3>
        <p style={styles.helpText}>
          Choose how the recording indicator appears when you're recording audio.
          The top-emerging style mimics the Dynamic Island on iPhone, appearing to emerge from the top notch area.
        </p>

        <div style={styles.modelSelector}>
          <label style={styles.label}>Overlay Style:</label>
          <select
            value={overlayStyle}
            onChange={(e) => handleOverlayStyleChange(e.target.value as 'rectangle' | 'top-emerging')}
            style={styles.select}
          >
            <option value="rectangle">Rectangle (Centered)</option>
            <option value="top-emerging">Top Emerging (Dynamic Island style)</option>
          </select>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div style={styles.errorCard}>
          <p style={styles.errorText}>{error}</p>
        </div>
      )}

      {/* Model download section */}
      <div style={{ ...styles.controlsSection, marginTop: '24px' }}>
        <h3 style={styles.subheading}>Model Management</h3>
        <p style={styles.helpText}>
          Select a Whisper model size. Larger models provide better accuracy but require more disk space and processing time.
          Models are downloaded to your app data directory. You can delete and redownload any model at any time.
        </p>

        <div style={styles.modelSelector}>
          <label style={styles.label}>Selected Model:</label>
          <select
            value={selectedModel}
            onChange={(e) => handleModelChange(e.target.value)}
            disabled={isDownloading || downloadingModel !== null}
            style={styles.select}
          >
            {Object.entries(availableModels).map(([size, info]) => {
              const isDownloaded = modelDownloadStatus[size] || false;
              return (
                <option key={size} value={size}>
                  {info.description} {isDownloaded ? '✓' : ''}
                </option>
              );
            })}
          </select>
        </div>

        {/* List of all models with actions */}
        <div style={styles.modelsList}>
          {Object.entries(availableModels).map(([size, info]) => {
            const isDownloaded = modelDownloadStatus[size] || false;
            const isSelected = size === selectedModel;
            const isDownloadingThis = downloadingModel === size;
            const isDeletingThis = deletingModel === size;
            const progress = modelDownloadProgress[size];
            const progressPercent = progress ? Math.round((progress.downloaded / progress.total) * 100) : 0;

            return (
              <div key={size} style={{
                ...styles.modelItem,
                backgroundColor: isSelected ? '#f0f9ff' : '#f9fafb',
                borderColor: isSelected ? '#3b82f6' : '#e5e7eb',
              }}>
                <div style={styles.modelItemHeader}>
                  <div>
                    <div style={styles.modelItemName}>
                      {info.description}
                      {isSelected && <span style={styles.selectedBadge}>Selected</span>}
                      {isDownloaded && !isSelected && <span style={styles.downloadedBadge}>Downloaded</span>}
                    </div>
                    <div style={styles.modelItemSize}>
                      {(info.sizeBytes / 1024 / 1024).toFixed(0)}MB
                    </div>
                  </div>
                  <div style={styles.modelItemActions}>
                    {isDownloaded ? (
                      <>
                        <button
                          onClick={() => handleDeleteModel(size)}
                          disabled={isDeletingThis || isDownloadingThis || (isSelected && Object.values(modelDownloadStatus).filter(Boolean).length === 1)}
                          style={{
                            ...styles.deleteButton,
                            opacity: (isDeletingThis || isDownloadingThis || (isSelected && Object.values(modelDownloadStatus).filter(Boolean).length === 1)) ? 0.5 : 1,
                          }}
                        >
                          {isDeletingThis ? 'Deleting...' : 'Delete'}
                        </button>
                        <button
                          onClick={() => handleDeleteModel(size).then(() => handleDownloadModelForSize(size))}
                          disabled={isDeletingThis || isDownloadingThis}
                          style={{
                            ...styles.redownloadButton,
                            opacity: (isDeletingThis || isDownloadingThis) ? 0.5 : 1,
                          }}
                        >
                          Redownload
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => handleDownloadModelForSize(size)}
                        disabled={isDownloadingThis || downloadingModel !== null}
                        style={{
                          ...styles.downloadButtonSmall,
                          opacity: (isDownloadingThis || downloadingModel !== null) ? 0.5 : 1,
                        }}
                      >
                        {isDownloadingThis ? 'Downloading...' : 'Download'}
                      </button>
                    )}
                  </div>
                </div>
                {isDownloadingThis && progress && (
                  <div style={styles.progressContainer}>
                    <div style={styles.progressBar}>
                      <div
                        style={{
                          ...styles.progressFill,
                          width: `${progressPercent}%`,
                        }}
                      />
                    </div>
                    <p style={styles.progressText}>
                      {progressPercent}% ({Math.round(progress.downloaded / 1024 / 1024)}MB / {Math.round(progress.total / 1024 / 1024)}MB)
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Usage instructions */}
      <div style={styles.instructionsSection}>
        <h3 style={styles.subheading}>How to Use</h3>
        <ol style={styles.instructionsList}>
          <li>Press your hotkey (<strong>{hotkey}</strong>) once to start recording</li>
          <li>Speak your text</li>
          <li>Press the hotkey again to stop recording and transcribe</li>
          <li>The transcribed text will be copied to clipboard and pasted into the active app</li>
        </ol>
        <p style={styles.noteText}>
          <strong>Note:</strong> You may need to grant Accessibility permissions for automatic pasting.
          If paste fails, the text will remain in your clipboard for manual pasting.
        </p>
      </div>
    </div>
  );
}

// Styles for the component.
const styles: Record<string, React.CSSProperties> = {
  container: {
    padding: '24px',
    maxWidth: '600px',
  },
  heading: {
    marginTop: 0,
    marginBottom: '16px',
    fontSize: '20px',
    fontWeight: 600,
  },
  subheading: {
    marginTop: 0,
    marginBottom: '12px',
    fontSize: '16px',
    fontWeight: 600,
  },
  notAvailable: {
    color: '#6b7280',
    fontStyle: 'italic',
  },
  statusCard: {
    backgroundColor: '#f9fafb',
    borderRadius: '12px',
    padding: '16px',
    marginBottom: '20px',
  },
  statusRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 0',
    borderBottom: '1px solid #e5e7eb',
  },
  statusLabel: {
    fontSize: '14px',
    color: '#374151',
  },
  statusValue: {
    fontSize: '14px',
    fontWeight: 500,
  },
  errorCard: {
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '8px',
    padding: '12px',
    marginBottom: '20px',
  },
  errorText: {
    margin: 0,
    color: '#dc2626',
    fontSize: '14px',
  },
  controlsSection: {
    marginBottom: '24px',
  },
  helpText: {
    marginBottom: '16px',
    fontSize: '14px',
    color: '#6b7280',
  },
  downloadButton: {
    padding: '12px 24px',
    fontSize: '15px',
    fontWeight: 500,
    color: '#fff',
    backgroundColor: '#111827',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
  },
  downloadButtonSmall: {
    padding: '6px 12px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#fff',
    backgroundColor: '#111827',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  progressContainer: {
    marginTop: '16px',
  },
  progressBar: {
    width: '100%',
    height: '8px',
    backgroundColor: '#e5e7eb',
    borderRadius: '4px',
    overflow: 'hidden',
    marginBottom: '8px',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#3b82f6',
    transition: 'width 0.3s ease',
  },
  progressText: {
    margin: 0,
    fontSize: '13px',
    color: '#6b7280',
  },
  successText: {
    marginTop: '12px',
    fontSize: '14px',
    color: '#22c55e',
    fontWeight: 500,
  },
  instructionsSection: {
    marginTop: '24px',
  },
  instructionsList: {
    paddingLeft: '20px',
    fontSize: '14px',
    color: '#374151',
    lineHeight: '1.8',
  },
  noteText: {
    marginTop: '16px',
    padding: '12px',
    backgroundColor: '#fef3c7',
    border: '1px solid #fde047',
    borderRadius: '8px',
    fontSize: '13px',
    color: '#92400e',
  },
  hotkeyContainer: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    marginTop: '12px',
  },
  hotkeyButton: {
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: 500,
    color: '#111827',
    backgroundColor: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    cursor: 'pointer',
  },
  hotkeyButtonActive: {
    backgroundColor: '#3b82f6',
    color: '#fff',
    borderColor: '#3b82f6',
  },
  cancelButton: {
    padding: '10px 20px',
    fontSize: '14px',
    fontWeight: 500,
    color: '#6b7280',
    backgroundColor: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    cursor: 'pointer',
  },
  hotkeyErrorText: {
    marginTop: '8px',
    fontSize: '13px',
    color: '#ef4444',
  },
  modelSelector: {
    marginBottom: '16px',
  },
  label: {
    display: 'block',
    marginBottom: '8px',
    fontSize: '14px',
    fontWeight: 500,
    color: '#374151',
  },
  select: {
    width: '100%',
    padding: '10px 12px',
    fontSize: '14px',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    backgroundColor: '#fff',
    color: '#111827',
    cursor: 'pointer',
  },
  modelsList: {
    marginTop: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  modelItem: {
    padding: '16px',
    borderRadius: '8px',
    border: '1px solid #e5e7eb',
    backgroundColor: '#f9fafb',
  },
  modelItemHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '16px',
  },
  modelItemName: {
    fontSize: '15px',
    fontWeight: 500,
    color: '#111827',
    marginBottom: '4px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  modelItemSize: {
    fontSize: '13px',
    color: '#6b7280',
  },
  modelItemActions: {
    display: 'flex',
    gap: '8px',
    flexShrink: 0,
  },
  selectedBadge: {
    fontSize: '11px',
    fontWeight: 500,
    color: '#3b82f6',
    backgroundColor: '#dbeafe',
    padding: '2px 8px',
    borderRadius: '4px',
  },
  downloadedBadge: {
    fontSize: '11px',
    fontWeight: 500,
    color: '#22c55e',
    backgroundColor: '#dcfce7',
    padding: '2px 8px',
    borderRadius: '4px',
  },
  deleteButton: {
    padding: '6px 12px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#dc2626',
    backgroundColor: '#fff',
    border: '1px solid #fecaca',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  redownloadButton: {
    padding: '6px 12px',
    fontSize: '13px',
    fontWeight: 500,
    color: '#111827',
    backgroundColor: '#fff',
    border: '1px solid #d1d5db',
    borderRadius: '6px',
    cursor: 'pointer',
  },
};

