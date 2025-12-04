// =============================================================================
// VisionSettings - UI for managing local vision model settings.
// Displays model download status and controls for image captioning.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';

type VisionModelStatus = 'downloaded' | 'downloading' | 'missing';

type VisionModelInfo = {
  name: string;
  repo: string;
  sizeBytes: number;
  description: string;
};

/**
 * VisionSettings displays vision model status and management.
 */
export default function VisionSettings() {
  const [modelStatus, setModelStatus] = useState<VisionModelStatus>('missing');
  const [downloadProgress, setDownloadProgress] = useState<{ downloaded: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
  const [deletingModel, setDeletingModel] = useState<string | null>(null);
  const [modelDownloadProgress, setModelDownloadProgress] = useState<Record<string, { downloaded: number; total: number }>>({});
  const [availableModels, setAvailableModels] = useState<Record<string, VisionModelInfo>>({});
  const [selectedModel, setSelectedModel] = useState<string>('nano');
  const [modelDownloadStatus, setModelDownloadStatus] = useState<Record<string, boolean>>({});

  const isMacOS = typeof window !== 'undefined' && window.platform?.isMacOS;

  // Fetch initial state and subscribe to changes.
  useEffect(() => {
    if (!isMacOS || !window.visionAPI) {
      return;
    }

    const fetchStatus = async () => {
      try {
        const [currentModelStatus, models, currentSelectedModel, downloadStatus] = await Promise.all([
          window.visionAPI!.getModelStatus(),
          window.visionAPI!.getAvailableModels(),
          window.visionAPI!.getSelectedModel(),
          window.visionAPI!.getModelDownloadStatus(),
        ]);
        setModelStatus(currentModelStatus);
        setAvailableModels(models);
        setSelectedModel(currentSelectedModel);
        setModelDownloadStatus(downloadStatus);
      } catch (err) {
        console.error('Failed to fetch vision model status:', err);
      }
    };

    fetchStatus();

    const unsubscribeProgress = window.visionAPI!.onModelDownloadProgress((downloaded, total) => {
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

    const unsubscribeDescription = window.visionAPI!.onDescriptionReady((itemId, description) => {
      console.log(`Vision description ready for item ${itemId}:`, description);
    });

    const unsubscribeError = window.visionAPI!.onError((itemId, errorMsg) => {
      console.error(`Vision processing error for item ${itemId}:`, errorMsg);
    });

    return () => {
      unsubscribeProgress();
      unsubscribeDescription();
      unsubscribeError();
    };
  }, [isMacOS, downloadingModel]);

  // Handler for downloading a specific model.
  const handleDownloadModelForSize = useCallback(async (modelSize: string) => {
    if (!window.visionAPI || downloadingModel) return;

    setDownloadingModel(modelSize);
    setError(null);
    setModelStatus('downloading');

    try {
      await window.visionAPI.downloadModel(modelSize);
      // Refresh download status for all models
      const downloadStatus = await window.visionAPI.getModelDownloadStatus();
      setModelDownloadStatus(downloadStatus);
      setModelStatus('downloaded');
      setModelDownloadProgress(prev => {
        const next = { ...prev };
        delete next[modelSize];
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to download ${modelSize} model`);
      setModelStatus('missing');
      console.error(`Failed to download ${modelSize} model:`, err);
    } finally {
      setDownloadingModel(null);
    }
  }, [downloadingModel]);

  // Handler for deleting a specific model.
  const handleDeleteModel = useCallback(async (modelSize: string) => {
    if (!window.visionAPI || deletingModel) return;

    setDeletingModel(modelSize);
    setError(null);

    try {
      await window.visionAPI.deleteModel(modelSize);
      // Refresh download status for all models
      const newDownloadStatus = await window.visionAPI.getModelDownloadStatus();
      setModelDownloadStatus(newDownloadStatus);
      
      // Update model status if we deleted the selected model
      if (modelSize === selectedModel) {
        setModelStatus('missing');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to delete ${modelSize} model`);
      console.error(`Failed to delete ${modelSize} model:`, err);
    } finally {
      setDeletingModel(null);
    }
  }, [deletingModel, selectedModel]);

  // If not on macOS, show a message.
  if (!isMacOS) {
    return (
      <div style={styles.container}>
        <h2 style={styles.heading}>Local Vision Model</h2>
        <p style={styles.notAvailable}>
          Local vision model is only available on macOS.
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
      <h2 style={styles.heading}>Local Vision Model</h2>

      {/* Status section */}
      <div style={styles.statusCard}>
        <div style={styles.statusRow}>
          <span style={styles.statusLabel}>Model Status:</span>
          <span style={{
            ...styles.statusValue,
            color: modelStatus === 'downloaded' ? '#22c55e' : modelStatus === 'downloading' ? '#f59e0b' : '#ef4444',
          }}>
            {modelStatus === 'downloaded' && 'Downloaded'}
            {modelStatus === 'downloading' && 'Downloading...'}
            {modelStatus === 'missing' && 'Not downloaded'}
          </span>
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
          Download a vision model to automatically generate brief descriptions for screenshots and images.
          Models are downloaded to your app data directory. You can delete and redownload any model at any time.
        </p>
        <p style={{ ...styles.helpText, fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
          <strong>Note:</strong> This requires Python 3 and the mlx-vlm package to be installed.
          Install with: <code>pip install mlx-vlm</code>
        </p>

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
                          disabled={isDeletingThis || isDownloadingThis}
                          style={{
                            ...styles.deleteButton,
                            opacity: (isDeletingThis || isDownloadingThis) ? 0.5 : 1,
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
        <h3 style={styles.subheading}>How It Works</h3>
        <p style={styles.helpText}>
          When you capture a screenshot or copy an image to your clipboard, the vision model will automatically
          generate a brief description in the background. The description will appear in the clipboard history,
          formatted as "Screenshot - [description]" for screenshots.
        </p>
        <p style={styles.noteText}>
          <strong>Note:</strong> Processing happens asynchronously and won't block your workflow.
          Descriptions are generated after images are added to your clipboard history.
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
  instructionsSection: {
    marginTop: '24px',
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



