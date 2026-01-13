import { useEffect, useState, useCallback } from 'react';

// =============================================================================
// Onboarding - 2-phase onboarding flow for Field Theory
// Phase 1: Permissions (microphone, accessibility, screen recording)
// Phase 2: Model (voice model selection and download)
// =============================================================================

type OnboardingPhase = 'permissions' | 'model';

type PermissionStatus = {
  microphone: 'granted' | 'denied' | 'not-determined';
  accessibility: boolean;
  screenRecording: boolean;
};

type ModelSize = 'small' | 'medium' | 'large';

interface ModelInfo {
  name: string;
  size: string;
  description: string;
  recommended?: boolean;
}

const MODELS: Record<ModelSize, ModelInfo> = {
  small: { name: 'Small', size: '466 MB', description: 'Faster, good for simple notes' },
  medium: { name: 'Medium', size: '1.4 GB', description: 'Best balance of speed and accuracy', recommended: true },
  large: { name: 'Large', size: '2.9 GB', description: 'Highest accuracy, slower' },
};

// Model selection order (natural size order: small to large).
const MODEL_ORDER: ModelSize[] = ['small', 'medium', 'large'];

// =============================================================================
// Phase 1: Permissions
// =============================================================================

interface PermissionsPhaseProps {
  permissions: PermissionStatus;
  onRequestMicrophone: () => void;
  onOpenAccessibility: () => void;
  onOpenScreenRecording: () => void;
  onRefreshPermissions: () => void;
  onContinue: () => void;
}

function PermissionsPhase({
  permissions,
  onRequestMicrophone,
  onOpenAccessibility,
  onOpenScreenRecording,
  onRefreshPermissions,
  onContinue,
}: PermissionsPhaseProps) {
  // Require microphone + accessibility (core permissions).
  // Screen recording is optional but recommended.
  const corePermissionsGranted =
    permissions.microphone === 'granted' &&
    permissions.accessibility;

  const allGranted =
    corePermissionsGranted &&
    permissions.screenRecording;

  // Auto-refresh permissions when window gains focus.
  useEffect(() => {
    const handleFocus = () => onRefreshPermissions();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [onRefreshPermissions]);

  return (
    <div style={styles.phase}>
      <h1 style={styles.title}>Set Up Field Theory</h1>
      <p style={styles.subtitle}>
        Field Theory needs a few permissions to work properly.
      </p>

      <div style={styles.checklist}>
        {/* Microphone */}
        <PermissionRow
          label="Microphone"
          description="Required for voice transcription"
          granted={permissions.microphone === 'granted'}
          denied={permissions.microphone === 'denied'}
          onGrant={onRequestMicrophone}
          grantButtonText="Allow"
          required={true}
        />

        {/* Accessibility */}
        <PermissionRow
          label="Accessibility"
          description="Required to paste text into apps"
          granted={permissions.accessibility}
          onGrant={onOpenAccessibility}
          grantButtonText="Open Settings"
          required={true}
        />

        {/* Screen Recording */}
        <PermissionRow
          label="Screen Recording"
          description="Optional: Enables screenshot context"
          granted={permissions.screenRecording}
          onGrant={onOpenScreenRecording}
          grantButtonText="Open Settings"
          required={false}
        />
      </div>

      {allGranted && (
        <div style={styles.successBanner}>
          All permissions granted
        </div>
      )}

      {corePermissionsGranted && !allGranted && (
        <div style={styles.warningBanner}>
          Screen Recording is recommended for screenshots but not required
        </div>
      )}

      {/* Shortcut hint */}
      <div style={styles.shortcutHint}>
        <span style={styles.shortcutLabel}>Open Field Theory anytime:</span>
        <kbd style={styles.kbd}>Option</kbd>
        <span style={styles.shortcutPlus}>+</span>
        <kbd style={styles.kbd}>Space</kbd>
      </div>

      <button
        style={{
          ...styles.primaryButton,
          opacity: corePermissionsGranted ? 1 : 0.5,
          cursor: corePermissionsGranted ? 'pointer' : 'not-allowed',
        }}
        onClick={onContinue}
        disabled={!corePermissionsGranted}
      >
        Continue
      </button>
    </div>
  );
}

interface PermissionRowProps {
  label: string;
  description: string;
  granted: boolean;
  denied?: boolean;
  onGrant: () => void;
  grantButtonText?: string;
  required?: boolean;
}

function PermissionRow({ label, description, granted, denied, onGrant, grantButtonText = "Grant", required = false }: PermissionRowProps) {
  return (
    <div style={styles.permissionRow}>
      <div style={styles.permissionCheck}>
        {granted ? (
          <span style={styles.checkmark}>✓</span>
        ) : (
          <span style={styles.unchecked}>○</span>
        )}
      </div>
      <div style={styles.permissionContent}>
        <div style={styles.permissionLabel}>
          {label}
          {required && <span style={styles.requiredBadge}>Required</span>}
        </div>
        <div style={styles.permissionDescription}>{description}</div>
        {denied && (
          <div style={styles.deniedText}>
            Access denied. Please enable in System Settings.
          </div>
        )}
      </div>
      {!granted && (
        <button style={styles.grantButton} onClick={onGrant}>
          {grantButtonText}
        </button>
      )}
    </div>
  );
}

// =============================================================================
// Phase 2: Model Selection
// =============================================================================

interface ModelPhaseProps {
  selectedModel: ModelSize;
  onSelectModel: (model: ModelSize) => void;
  modelDownloadStatus: Record<string, boolean>;
  downloadingModel: string | null;
  downloadProgress: number;
  onDownloadModel: (model: ModelSize) => void;
  onCancelDownload: () => void;
  onDeleteModel: (model: ModelSize) => void;
  onFinish: () => void;
}

function ModelPhase({
  selectedModel,
  onSelectModel,
  modelDownloadStatus,
  downloadingModel,
  downloadProgress,
  onDownloadModel,
  onCancelDownload,
  onDeleteModel,
  onFinish,
}: ModelPhaseProps) {
  const isSelectedModelDownloaded = modelDownloadStatus[selectedModel] || false;

  // Can finish if the selected model is downloaded.
  const canFinish = isSelectedModelDownloaded;

  return (
    <div style={styles.phase}>
      <h1 style={styles.title}>Choose Voice Model</h1>
      <p style={styles.subtitle}>
        Select a model for transcription. Medium is recommended.
      </p>

      <div style={styles.modelList}>
        {MODEL_ORDER.map((modelKey) => {
          const info = MODELS[modelKey];
          if (!info) return null;
          const isDownloaded = modelDownloadStatus[modelKey] || false;
          const isDownloading = downloadingModel === modelKey;
          const isSelected = selectedModel === modelKey;
          
          return (
            <div 
              key={modelKey}
              onClick={() => isDownloaded && onSelectModel(modelKey)}
              style={{
                ...styles.modelCard,
                borderColor: isSelected && isDownloaded ? '#14372A' : '#e5e7eb',
                backgroundColor: isSelected && isDownloaded ? '#f0fdf4' : '#fff',
                cursor: isDownloaded ? 'pointer' : 'default',
              }}
            >
              {/* Checkmark only for the active/selected model */}
              <div style={styles.modelCardCheck}>
                {isSelected && isDownloaded ? (
                  <span style={styles.checkmark}>✓</span>
                ) : (
                  <span style={styles.unchecked}>○</span>
                )}
              </div>
              <div style={styles.modelCardLeft}>
                <div style={styles.modelCardHeader}>
                  <span style={{ fontWeight: 500, fontSize: '12px', color: '#1a1a1a' }}>
                    {info.name}
                  </span>
                  <span style={{ fontSize: '11px', color: '#9ca3af' }}>
                    {info.size}
                  </span>
                  {info.recommended && (
                    <span style={styles.recommendedBadge}>Recommended</span>
                  )}
                </div>
                <div style={{ fontSize: '11px', color: '#6b7280' }}>
                  {info.description}
                </div>
                {isDownloading && (
                  <div style={styles.progressContainer}>
                    <div style={styles.progressBar}>
                      <div style={{ ...styles.progressFill, width: `${downloadProgress}%` }} />
                    </div>
                    <span style={styles.progressText}>{Math.round(downloadProgress)}%</span>
                  </div>
                )}
              </div>
              <div style={styles.modelCardRight}>
                {isDownloaded ? (
                  <div style={styles.modelCardActions}>
                    {isSelected ? (
                      <span style={{ fontSize: '11px', color: '#22c55e', fontWeight: 500 }}>Active</span>
                    ) : (
                      <span style={{ fontSize: '11px', color: '#9ca3af' }}>Ready</span>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); onDeleteModel(modelKey); }}
                      style={styles.deleteButton}
                      title="Delete model"
                    >
                      ✕
                    </button>
                  </div>
                ) : isDownloading ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); onCancelDownload(); }}
                    style={styles.cancelButton}
                  >
                    Cancel
                  </button>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDownloadModel(modelKey); }}
                    disabled={downloadingModel !== null}
                    style={{
                      ...styles.downloadButton,
                      opacity: downloadingModel !== null ? 0.5 : 1,
                    }}
                  >
                    Download
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <button 
        style={{
          ...styles.primaryButton,
          opacity: canFinish ? 1 : 0.5,
          cursor: canFinish ? 'pointer' : 'not-allowed',
          marginTop: '12px',
        }}
        onClick={onFinish}
        disabled={!canFinish}
      >
        Done
      </button>
    </div>
  );
}

// =============================================================================
// Main Onboarding Component
// =============================================================================

export default function Onboarding() {
  const [phase, setPhase] = useState<OnboardingPhase>('permissions');
  const [isLoading, setIsLoading] = useState(true);
  
  // Permissions state.
  const [permissions, setPermissions] = useState<PermissionStatus>({
    microphone: 'not-determined',
    accessibility: false,
    screenRecording: false,
  });

  // Model state.
  const [selectedModel, setSelectedModel] = useState<ModelSize>('medium');
  const [modelDownloadStatus, setModelDownloadStatus] = useState<Record<string, boolean>>({});
  const [downloadingModel, setDownloadingModel] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);

  // Load initial state from Electron.
  useEffect(() => {
    const loadState = async () => {
      if (!window.onboardingAPI) {
        console.warn('[Onboarding] onboardingAPI not available');
        setIsLoading(false);
        return;
      }

      try {
        const state = await window.onboardingAPI.getState();
        setPermissions(state.permissions);
        
        // Load current hotkeys, selected model, and download status for all models.
        if (window.transcribeAPI) {
          // Load the currently selected model.
          const currentModel = await window.transcribeAPI.getSelectedModel();
          if (currentModel && ['small', 'medium', 'large'].includes(currentModel)) {
            setSelectedModel(currentModel as ModelSize);
          }
          
          // Load download status for all models.
          const downloadStatus = await window.transcribeAPI.getModelDownloadStatus();
          setModelDownloadStatus(downloadStatus);
          
          // Check if a download is already in progress.
          const downloadingModels = await window.transcribeAPI.getDownloadingModels?.() ?? [];
          if (downloadingModels.length > 0) {
            setDownloadingModel(downloadingModels[0]);
          }
        }
      } catch (err) {
        console.error('[Onboarding] Failed to load state:', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadState();
  }, []);

  // Listen for model download progress.
  useEffect(() => {
    if (!window.transcribeAPI) return;

    const unsubscribe = window.transcribeAPI.onModelDownloadProgress(async (downloaded, total) => {
      const percent = total > 0 ? (downloaded / total) * 100 : 0;
      setDownloadProgress(percent);

      // When download completes, refresh the download status.
      if (downloaded >= total && total > 0 && downloadingModel) {
        const downloadStatus = await window.transcribeAPI!.getModelDownloadStatus();
        setModelDownloadStatus(downloadStatus);
        setDownloadingModel(null);
      }
    });

    return () => unsubscribe();
  }, [downloadingModel]);

  // Permission handlers.
  const refreshPermissions = useCallback(async () => {
    if (!window.onboardingAPI) return;
    const status = await window.onboardingAPI.getPermissionStatus();
    setPermissions(status);
  }, []);

  const requestMicrophone = useCallback(async () => {
    if (!window.onboardingAPI) return;
    const granted = await window.onboardingAPI.requestMicrophone();
    if (granted) {
      setPermissions(prev => ({ ...prev, microphone: 'granted' }));
    } else {
      await refreshPermissions();
    }
  }, [refreshPermissions]);

  const openAccessibilitySettings = useCallback(async () => {
    if (!window.onboardingAPI) return;
    await window.onboardingAPI.openAccessibilitySettings();
  }, []);

  const openScreenRecordingSettings = useCallback(async () => {
    if (!window.onboardingAPI) return;
    // Trigger a screen capture first to auto-add the app to the permissions list.
    // This saves users from having to manually click "+" to add the app.
    await window.onboardingAPI.triggerScreenRecordingPrompt();
    await window.onboardingAPI.openScreenRecordingSettings();
  }, []);

  // Model handlers.
  const downloadModel = useCallback(async (modelToDownload: ModelSize) => {
    if (!window.transcribeAPI || downloadingModel) return;
    setDownloadingModel(modelToDownload);
    setDownloadProgress(0);

    try {
      await window.transcribeAPI.downloadModel(modelToDownload);
      // Set as selected model after download completes.
      setSelectedModel(modelToDownload);
      await window.transcribeAPI.setSelectedModel(modelToDownload);
    } catch (error) {
      console.error('Model download failed:', error);
      setDownloadingModel(null);
    }
  }, [downloadingModel]);
  
  // Cancel a download in progress.
  // Note: This clears the UI state but the download continues in background.
  // True cancellation would require backend support.
  const cancelDownload = useCallback(() => {
    setDownloadingModel(null);
    setDownloadProgress(0);
  }, []);
  
  // Delete a downloaded model.
  const deleteModel = useCallback(async (model: ModelSize) => {
    if (!window.transcribeAPI) return;
    
    try {
      const success = await window.transcribeAPI.deleteModel(model);
      if (success) {
        // Refresh the download status.
        const downloadStatus = await window.transcribeAPI.getModelDownloadStatus();
        setModelDownloadStatus(downloadStatus);
        
        // If we deleted the selected model, select another downloaded model if available.
        if (model === selectedModel) {
          const stillDownloaded = MODEL_ORDER.find(m => downloadStatus[m]);
          if (stillDownloaded) {
            setSelectedModel(stillDownloaded);
            await window.transcribeAPI.setSelectedModel(stillDownloaded);
          }
        }
      }
    } catch (error) {
      console.error('Failed to delete model:', error);
    }
  }, [selectedModel]);
  
  // Handle model selection (for already-downloaded models).
  const handleSelectModel = useCallback(async (model: ModelSize) => {
    if (!window.transcribeAPI) return;
    setSelectedModel(model);
    await window.transcribeAPI.setSelectedModel(model);
  }, []);

  // Phase navigation.
  const goToModel = useCallback(() => setPhase('model'), []);

  // Complete onboarding.
  const finish = useCallback(async () => {
    if (window.onboardingAPI) {
      await window.onboardingAPI.complete();
    }
  }, []);

  // Show loading state.
  if (isLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.content}>
          <div style={styles.phase}>
            <div style={styles.loadingIcon}>⏳</div>
            <h1 style={styles.title}>Loading...</h1>
          </div>
        </div>
      </div>
    );
  }

  // Render current phase.
  const renderPhase = () => {
    switch (phase) {
      case 'permissions':
        return (
          <PermissionsPhase
            permissions={permissions}
            onRequestMicrophone={requestMicrophone}
            onOpenAccessibility={openAccessibilitySettings}
            onOpenScreenRecording={openScreenRecordingSettings}
            onRefreshPermissions={refreshPermissions}
            onContinue={goToModel}
          />
        );

      case 'model':
        return (
          <ModelPhase
            selectedModel={selectedModel}
            onSelectModel={handleSelectModel}
            modelDownloadStatus={modelDownloadStatus}
            downloadingModel={downloadingModel}
            downloadProgress={downloadProgress}
            onDownloadModel={downloadModel}
            onCancelDownload={cancelDownload}
            onDeleteModel={deleteModel}
            onFinish={finish}
          />
        );
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        {renderPhase()}
      </div>
      <PhaseIndicator current={phase} onGoToPhase={setPhase} />
    </div>
  );
}

// =============================================================================
// Phase Indicator - clickable dots for back navigation
// =============================================================================

interface PhaseIndicatorProps {
  current: OnboardingPhase;
  onGoToPhase: (phase: OnboardingPhase) => void;
}

function PhaseIndicator({ current, onGoToPhase }: PhaseIndicatorProps) {
  const phases: OnboardingPhase[] = ['permissions', 'model'];
  const currentIndex = phases.indexOf(current);

  return (
    <div style={styles.phaseIndicator}>
      {phases.map((p, i) => {
        // Can click on completed phases (before current) to go back.
        const canClick = i < currentIndex;
        return (
          <div
            key={p}
            onClick={canClick ? () => onGoToPhase(p) : undefined}
            style={{
              ...styles.phaseDot,
              backgroundColor: i <= currentIndex ? '#14372A' : '#d1d5db',
              cursor: canClick ? 'pointer' : 'default',
              transition: 'transform 0.15s ease',
              transform: canClick ? 'scale(1)' : 'scale(1)',
            }}
            onMouseEnter={(e) => {
              if (canClick) e.currentTarget.style.transform = 'scale(1.3)';
            }}
            onMouseLeave={(e) => {
              if (canClick) e.currentTarget.style.transform = 'scale(1)';
            }}
          />
        );
      })}
    </div>
  );
}

// =============================================================================
// Styles
// =============================================================================

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    backgroundColor: '#faf9f7',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    paddingTop: '28px', // Account for macOS title bar.
  },
  content: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '12px',
  },
  phase: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    maxWidth: '400px',
    width: '100%',
  },
  title: {
    fontSize: '18px',
    fontWeight: 600,
    color: '#1a1a1a',
    margin: '0 0 2px 0',
  },
  subtitle: {
    fontSize: '12px',
    color: '#6b7280',
    margin: '0 0 12px 0',
    lineHeight: 1.3,
  },
  loadingIcon: {
    fontSize: '32px',
    marginBottom: '8px',
  },

  // Checklist styles.
  checklist: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginBottom: '12px',
  },
  permissionRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    padding: '8px 10px',
    textAlign: 'left',
  },
  permissionCheck: {
    width: '18px',
    height: '18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  checkmark: {
    color: '#22c55e',
    fontSize: '14px',
    fontWeight: 'bold',
  },
  unchecked: {
    color: '#d1d5db',
    fontSize: '14px',
  },
  permissionContent: {
    flex: 1,
  },
  permissionLabel: {
    fontSize: '13px',
    fontWeight: 500,
    color: '#1a1a1a',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  requiredBadge: {
    fontSize: '9px',
    fontWeight: 600,
    color: '#dc2626',
    backgroundColor: '#fee2e2',
    padding: '1px 5px',
    borderRadius: '3px',
    textTransform: 'uppercase',
    letterSpacing: '0.02em',
  },
  permissionDescription: {
    fontSize: '11px',
    color: '#6b7280',
    marginTop: '2px',
  },
  deniedText: {
    fontSize: '11px',
    color: '#dc2626',
    marginTop: '2px',
  },
  instructionsText: {
    fontSize: '11px',
    color: '#9ca3af',
    marginTop: '2px',
  },
  grantButton: {
    backgroundColor: '#14372A',
    color: '#ffffff',
    border: 'none',
    borderRadius: '4px',
    padding: '5px 12px',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    flexShrink: 0,
  },

  // Model list and cards.
  modelList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    width: '100%',
  },
  modelCard: {
    display: 'flex',
    alignItems: 'center',
    padding: '10px 12px',
    borderRadius: '6px',
    border: '1px solid #e5e7eb',
    transition: 'border-color 0.15s, background-color 0.15s',
  },
  modelCardCheck: {
    width: '20px',
    height: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginRight: '10px',
  },
  modelCardLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
    flex: 1,
  },
  modelCardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  modelCardRight: {
    flexShrink: 0,
    marginLeft: '8px',
  },
  modelCardActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  recommendedBadge: {
    fontSize: '9px',
    fontWeight: 600,
    color: '#14372A',
    backgroundColor: '#dcfce7',
    padding: '1px 5px',
    borderRadius: '3px',
    textTransform: 'uppercase',
    letterSpacing: '0.02em',
  },
  downloadButton: {
    backgroundColor: '#14372A',
    color: '#ffffff',
    border: 'none',
    borderRadius: '4px',
    padding: '5px 12px',
    fontSize: '11px',
    fontWeight: 500,
    cursor: 'pointer',
  },
  cancelButton: {
    backgroundColor: '#f3f4f6',
    color: '#6b7280',
    border: '1px solid #e5e7eb',
    borderRadius: '4px',
    padding: '5px 12px',
    fontSize: '11px',
    fontWeight: 500,
    cursor: 'pointer',
  },
  deleteButton: {
    backgroundColor: 'transparent',
    color: '#9ca3af',
    border: 'none',
    padding: '2px 6px',
    fontSize: '12px',
    cursor: 'pointer',
    borderRadius: '3px',
    transition: 'color 0.15s, background-color 0.15s',
  },

  // Progress bar.
  progressContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginTop: '6px',
  },
  progressBar: {
    flex: 1,
    height: '4px',
    backgroundColor: '#e5e7eb',
    borderRadius: '2px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#14372A',
    transition: 'width 0.3s ease',
  },
  progressText: {
    fontSize: '11px',
    color: '#6b7280',
    minWidth: '32px',
    textAlign: 'right',
  },

  // Success banner.
  successBanner: {
    backgroundColor: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: '4px',
    padding: '6px 10px',
    marginBottom: '8px',
    fontSize: '12px',
    color: '#166534',
    width: '100%',
    textAlign: 'center',
  },

  // Warning banner (for optional permissions).
  warningBanner: {
    backgroundColor: '#fffbeb',
    border: '1px solid #fcd34d',
    borderRadius: '4px',
    padding: '6px 10px',
    marginBottom: '8px',
    fontSize: '11px',
    color: '#92400e',
    width: '100%',
    textAlign: 'center',
  },

  // Shortcut hint.
  shortcutHint: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '10px 0',
    marginBottom: '8px',
  },
  shortcutLabel: {
    fontSize: '11px',
    color: '#6b7280',
    marginRight: '4px',
  },
  shortcutPlus: {
    fontSize: '11px',
    color: '#9ca3af',
  },
  kbd: {
    display: 'inline-block',
    padding: '3px 8px',
    fontSize: '11px',
    fontWeight: 500,
    color: '#374151',
    backgroundColor: '#f3f4f6',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    boxShadow: '0 1px 0 #d1d5db',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
  },

  // Primary button.
  primaryButton: {
    backgroundColor: '#14372A',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    padding: '10px 24px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'opacity 0.2s',
  },

  // Phase indicator.
  phaseIndicator: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '10px',
    borderTop: '1px solid #f1f5f9',
  },
  phaseDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    transition: 'background-color 0.2s',
  },
};
