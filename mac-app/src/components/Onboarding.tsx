import { useEffect, useState, useCallback, useRef } from 'react';
import { formatHotkeyDisplay } from '../utils/hotkeys';

// =============================================================================
// Onboarding - 4-phase onboarding flow for Field Theory
// Phase 1: Permissions (microphone, accessibility, screen recording)
// Phase 2: Model (voice model selection and download)
// Phase 3: Core Mechanics (interactive recording + screenshots mini-game)
// Phase 4: Open Field Theory (teaching the app-opening shortcut)
// =============================================================================

type OnboardingPhase = 'permissions' | 'model' | 'core-mechanics' | 'open-field-theory';

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
  const allGranted = 
    permissions.microphone === 'granted' && 
    permissions.accessibility && 
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
          label="Microphone Access"
          description="Capture your voice for transcription"
          granted={permissions.microphone === 'granted'}
          denied={permissions.microphone === 'denied'}
          onGrant={onRequestMicrophone}
        />

        {/* Accessibility */}
        <PermissionRow
          label="Accessibility Access"
          description="Paste transcribed text into any app"
          granted={permissions.accessibility}
          onGrant={onOpenAccessibility}
          instructions="Toggle on Field Theory in System Settings"
        />

        {/* Screen Recording */}
        <PermissionRow
          label="Screen Recording Access"
          description="Take screenshots for AI context"
          granted={permissions.screenRecording}
          onGrant={onOpenScreenRecording}
          instructions="Toggle on Field Theory in System Settings"
        />
      </div>

      {allGranted && (
        <div style={styles.successBanner}>
          All permissions granted
        </div>
      )}

      <button 
        style={{
          ...styles.primaryButton,
          opacity: allGranted ? 1 : 0.5,
          cursor: allGranted ? 'pointer' : 'not-allowed',
        }}
        onClick={onContinue}
        disabled={!allGranted}
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
  instructions?: string;
}

function PermissionRow({ label, description, granted, denied, onGrant, instructions }: PermissionRowProps) {
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
        <div style={styles.permissionLabel}>{label}</div>
        <div style={styles.permissionDescription}>{description}</div>
        {denied && (
          <div style={styles.deniedText}>
            Access denied. Please enable in System Settings.
          </div>
        )}
        {instructions && !granted && (
          <div style={styles.instructionsText}>{instructions}</div>
        )}
      </div>
      {!granted && (
        <button style={styles.grantButton} onClick={onGrant}>
          Grant
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
  onContinue: () => void;
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
  onContinue,
}: ModelPhaseProps) {
  const isSelectedModelDownloaded = modelDownloadStatus[selectedModel] || false;

  // Can continue if the selected model is downloaded.
  const canContinue = isSelectedModelDownloaded;

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
          opacity: canContinue ? 1 : 0.5,
          cursor: canContinue ? 'pointer' : 'not-allowed',
          marginTop: '12px',
        }}
        onClick={onContinue}
        disabled={!canContinue}
      >
        Continue
      </button>
    </div>
  );
}

// =============================================================================
// Phase 3: Core Mechanics (interactive recording + screenshots)
// Users learn by actually performing the shortcuts. The cursor status dot
// displays tutorial prompts to guide them through each step.
// =============================================================================

interface CoreMechanicsPhaseProps {
  recordingHotkey: string;
  screenshotHotkey: string;
  isRecording: boolean;
  onContinue: () => void;
}

type CoreMechanicsStep = 
  | 'start-recording'
  | 'describing-1'
  | 'take-screenshot-1'
  | 'take-screenshot-2'
  | 'take-screenshot-3'
  | 'show-input'
  | 'done';

// Derive screenshot count from current step (avoids storing full image data).
const getScreenshotCount = (s: CoreMechanicsStep): number => {
  if (s === 'take-screenshot-2') return 1;
  if (s === 'take-screenshot-3') return 2;
  if (s === 'show-input' || s === 'done') return 3;
  return 0;
};

function CoreMechanicsPhase({
  recordingHotkey,
  screenshotHotkey,
  isRecording,
  onContinue,
}: CoreMechanicsPhaseProps) {
  const [step, setStep] = useState<CoreMechanicsStep>('start-recording');
  const [inputText, setInputText] = useState('');
  const [pastedImages, setPastedImages] = useState<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Ref to access current step in listener callback without stale closure.
  const stepRef = useRef(step);
  stepRef.current = step;

  // Handle paste to capture images from clipboard.
  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile();
        if (blob) {
          const url = URL.createObjectURL(blob);
          setPastedImages(prev => [...prev, url]);
        }
      }
    }
  };

  // Send tutorial hints to cursor status dot based on current step.
  useEffect(() => {
    const sendHint = (hint: string | null) => {
      window.onboardingAPI?.setTutorialHint?.(hint);
    };

    switch (step) {
      case 'describing-1':
        sendHint('Describe what you see in this painting...');
        // After a delay, prompt for screenshot.
        const timer1 = setTimeout(() => {
          sendHint(`Press ${formatHotkeyDisplay(screenshotHotkey)} to screenshot`);
        }, 4000);
        return () => { clearTimeout(timer1); sendHint(null); };

      case 'take-screenshot-1':
        sendHint(`Press ${formatHotkeyDisplay(screenshotHotkey)} to screenshot`);
        return () => sendHint(null);

      case 'take-screenshot-2':
        sendHint(`Now screenshot this one (${formatHotkeyDisplay(screenshotHotkey)})`);
        return () => sendHint(null);

      case 'take-screenshot-3':
        sendHint(`One more! Describe & screenshot (${formatHotkeyDisplay(screenshotHotkey)})`);
        return () => sendHint(null);

      case 'show-input':
        sendHint(null); // Clear hint, let normal transcription flow happen.
        return;

      default:
        sendHint(null);
        return;
    }
  }, [step, screenshotHotkey]);

  // Listen for recording state changes.
  useEffect(() => {
    if (step === 'start-recording' && isRecording) {
      setStep('describing-1');
    }
  }, [step, isRecording]);

  // Listen for screenshots - register once to avoid duplicate listeners.
  useEffect(() => {
    if (!window.clipboardAPI) return;

    const handleItemAdded = (_id: number) => {
      const currentStep = stepRef.current;

      // Progress through screenshot steps.
      if (currentStep === 'describing-1' || currentStep === 'take-screenshot-1') {
        setStep('take-screenshot-2');
      } else if (currentStep === 'take-screenshot-2') {
        setStep('take-screenshot-3');
      } else if (currentStep === 'take-screenshot-3') {
        setStep('show-input');
      }
    };

    window.clipboardAPI.onItemAdded?.(handleItemAdded);
  }, []);

  // For the input field, detect when content is pasted/typed.
  useEffect(() => {
    if (step !== 'show-input') return;

    const handleInput = () => {
      if (inputRef.current && inputRef.current.value.length > 0) {
        setInputText(inputRef.current.value);
      }
    };

    const input = inputRef.current;
    if (input) {
      input.addEventListener('input', handleInput);
      input.focus();
      return () => input.removeEventListener('input', handleInput);
    }
  }, [step]);

  // Auto-advance when content is pasted, then to next phase when done.
  useEffect(() => {
    if (step !== 'show-input') return;
    if (inputText.length > 0 || pastedImages.length > 0) {
      const timer = setTimeout(() => setStep('done'), 1500);
      return () => clearTimeout(timer);
    }
  }, [step, inputText, pastedImages]);

  // When done, advance to next phase after brief delay.
  useEffect(() => {
    if (step === 'done') {
      const timer = setTimeout(onContinue, 1500);
      return () => clearTimeout(timer);
    }
  }, [step, onContinue]);

  // Clean up tutorial hint when unmounting.
  useEffect(() => {
    return () => {
      window.onboardingAPI?.setTutorialHint?.(null);
    };
  }, []);

  const renderContent = () => {
    switch (step) {
      case 'start-recording':
        return (
          <>
            <div style={styles.artworkContainer}>
              <img 
                src="/onboarding-art-1.jpg" 
                alt="Artwork 1" 
                style={styles.artwork}
              />
            </div>
            <p style={styles.tutorialPrompt}>
              Press <kbd style={styles.kbd}>{formatHotkeyDisplay(recordingHotkey)}</kbd> to start recording.
            </p>
            <p style={styles.subtitle}>
              Look for the recording indicator next to your cursor.
            </p>
          </>
        );

      case 'describing-1':
      case 'take-screenshot-1':
        return (
          <>
            <div style={styles.artworkContainer}>
              <img 
                src="/onboarding-art-1.jpg" 
                alt="Artwork 1" 
                style={styles.artwork}
              />
            </div>
            <p style={styles.tutorialPrompt}>
              Describe what you see, then press <kbd style={styles.kbd}>{formatHotkeyDisplay(screenshotHotkey)}</kbd> to screenshot.
            </p>
          </>
        );

      case 'take-screenshot-2':
        return (
          <>
            <div style={styles.artworkRow}>
              <div style={styles.artworkWithStack}>
                <img 
                  src="/onboarding-art-1.jpg" 
                  alt="Artwork 1" 
                  style={{ ...styles.artworkSmall, opacity: 0.5 }}
                />
                {getScreenshotCount(step) > 0 && (
                  <div style={styles.stackIndicator}>✓</div>
                )}
              </div>
              <img 
                src="/onboarding-art-2.jpg" 
                alt="Artwork 2" 
                style={styles.artworkSmall}
              />
            </div>
            <p style={styles.tutorialPrompt}>
              Now describe and screenshot this one (<kbd style={styles.kbd}>{formatHotkeyDisplay(screenshotHotkey)}</kbd>).
            </p>
          </>
        );

      case 'take-screenshot-3':
        return (
          <>
            <div style={styles.artworkRow}>
              <div style={styles.artworkWithStack}>
                <img 
                  src="/onboarding-art-1.jpg" 
                  alt="Artwork 1" 
                  style={{ ...styles.artworkSmall, opacity: 0.5 }}
                />
                <div style={styles.stackIndicator}>✓</div>
              </div>
              <div style={styles.artworkWithStack}>
                <img 
                  src="/onboarding-art-2.jpg" 
                  alt="Artwork 2" 
                  style={{ ...styles.artworkSmall, opacity: 0.5 }}
                />
                {getScreenshotCount(step) > 1 && (
                  <div style={styles.stackIndicator}>✓</div>
                )}
              </div>
              <img 
                src="/onboarding-art-3.jpg" 
                alt="Artwork 3" 
                style={styles.artworkSmall}
              />
            </div>
            <p style={styles.tutorialPrompt}>
              One more! Describe and screenshot (<kbd style={styles.kbd}>{formatHotkeyDisplay(screenshotHotkey)}</kbd>).
            </p>
          </>
        );

      case 'show-input':
        return (
          <>
            <p style={styles.tutorialPrompt}>
              Press <kbd style={styles.kbd}>{formatHotkeyDisplay(recordingHotkey)}</kbd> to stop recording. Your content will paste below.
            </p>
            <div style={styles.composedInput}>
              {pastedImages.length > 0 && (
                <div style={styles.imageChipsRow}>
                  {pastedImages.map((url, i) => (
                    <img key={i} src={url} alt="" style={styles.imageChip} />
                  ))}
                </div>
              )}
              <textarea
                ref={inputRef}
                style={styles.textareaInner}
                placeholder="Your stacked content will appear here..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onPaste={handlePaste}
              />
            </div>
          </>
        );

      case 'done':
        return (
          <>
            <div style={styles.successIcon}>✓</div>
            <p style={styles.successText}>
              That's context stacking! Your voice and screenshots combined.
            </p>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <div style={styles.phase}>
      <h1 style={styles.title}>Try Recording & Screenshots</h1>
      {renderContent()}
    </div>
  );
}

// =============================================================================
// Phase 4: Open Field Theory
// Dedicated screen for teaching the app-opening shortcut.
// =============================================================================

interface OpenFieldTheoryPhaseProps {
  openHotkey: string;
  onFinish: () => void;
}

function OpenFieldTheoryPhase({ openHotkey, onFinish }: OpenFieldTheoryPhaseProps) {
  const [opened, setOpened] = useState(false);

  // Listen for Field Theory window opening.
  useEffect(() => {
    const handleWindowOpen = () => {
      setOpened(true);
      // Brief delay then finish onboarding.
      setTimeout(onFinish, 800);
    };

    window.onboardingAPI?.onFieldTheoryOpened?.(handleWindowOpen);
  }, [onFinish]);

  return (
    <div style={styles.phase}>
      <h1 style={styles.title}>Open Field Theory</h1>
      
      {opened ? (
        <>
          <div style={styles.successIcon}>✓</div>
          <p style={styles.successText}>You're ready! Have fun.</p>
        </>
      ) : (
        <>
          <p style={styles.tutorialPrompt}>
            Press <kbd style={styles.kbd}>{formatHotkeyDisplay(openHotkey)}</kbd> to open Field Theory.
          </p>
          <p style={styles.subtitle}>
            This is how you'll access your context window anytime.
          </p>
        </>
      )}
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

  // Hotkey state.
  const [recordingHotkey, setRecordingHotkey] = useState('Command+\\');
  const [screenshotHotkey, setScreenshotHotkey] = useState('Command+4');
  const [openHotkey, setOpenHotkey] = useState('Alt+Space');

  // Recording state (for tutorial).
  const [isRecording, setIsRecording] = useState(false);

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
          const transcribeHotkey = await window.transcribeAPI.getHotkey();
          if (transcribeHotkey) setRecordingHotkey(transcribeHotkey);
          
          // Load the currently selected model.
          const currentModel = await window.transcribeAPI.getSelectedModel();
          if (currentModel && ['small', 'medium', 'large'].includes(currentModel)) {
            setSelectedModel(currentModel as ModelSize);
          }
          
          // Load download status for all models.
          const downloadStatus = await window.transcribeAPI.getModelDownloadStatus();
          setModelDownloadStatus(downloadStatus);
        }
        if (window.clipboardAPI) {
          const hotkeys = await window.clipboardAPI.getHotkeys();
          if (hotkeys.screenshot) setScreenshotHotkey(hotkeys.screenshot);
          if (hotkeys.history) setOpenHotkey(hotkeys.history);
        }
      } catch (err) {
        console.error('[Onboarding] Failed to load state:', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadState();
  }, []);

  // Listen for recording state changes.
  useEffect(() => {
    if (!window.transcribeAPI) return;

    const unsubscribe = window.transcribeAPI.onStatusChanged((status) => {
      setIsRecording(status === 'recording');
    });

    return () => unsubscribe();
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
  const goToCoreMechanics = useCallback(() => {
    // Expand window for interactive tutorial.
    window.onboardingAPI?.expandWindow?.();
    setPhase('core-mechanics');
  }, []);
  const goToOpenFieldTheory = useCallback(() => setPhase('open-field-theory'), []);

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
            onContinue={goToCoreMechanics}
          />
        );

      case 'core-mechanics':
        return (
          <CoreMechanicsPhase
            recordingHotkey={recordingHotkey}
            screenshotHotkey={screenshotHotkey}
            isRecording={isRecording}
            onContinue={goToOpenFieldTheory}
          />
        );

      case 'open-field-theory':
        return (
          <OpenFieldTheoryPhase
            openHotkey={openHotkey}
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
  const phases: OnboardingPhase[] = ['permissions', 'model', 'core-mechanics', 'open-field-theory'];
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
  downloading: {
    color: '#3b82f6',
    fontSize: '14px',
  },
  permissionContent: {
    flex: 1,
  },
  permissionLabel: {
    fontSize: '13px',
    fontWeight: 500,
    color: '#1a1a1a',
  },
  permissionDescription: {
    display: 'none',
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

  // Setup row styles.
  setupRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    padding: '8px 10px',
    textAlign: 'left',
  },
  setupCheck: {
    width: '18px',
    height: '18px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  setupContent: {
    flex: 1,
  },
  setupLabel: {
    fontSize: '13px',
    fontWeight: 500,
    color: '#1a1a1a',
  },
  setupDescription: {
    fontSize: '11px',
    color: '#6b7280',
  },
  noteText: {
    display: 'none',
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

  // Hotkey capture.
  hotkeyCapture: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '2px',
    flexShrink: 0,
  },
  hotkeyDisplay: {
    fontFamily: '-apple-system, monospace',
    fontSize: '12px',
    fontWeight: 500,
    color: '#1a1a1a',
    backgroundColor: '#f3f4f6',
    padding: '4px 10px',
    borderRadius: '4px',
    minWidth: '60px',
    textAlign: 'center',
  },
  capturingBox: {
    fontFamily: '-apple-system, monospace',
    fontSize: '12px',
    color: '#3b82f6',
    backgroundColor: '#eff6ff',
    border: '1px solid #3b82f6',
    padding: '4px 10px',
    borderRadius: '4px',
    minWidth: '60px',
    textAlign: 'center',
  },
  hotkeyActions: {
    display: 'flex',
    gap: '2px',
  },
  changeButton: {
    fontSize: '10px',
    color: '#6b7280',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: '1px 4px',
  },
  confirmButton: {
    fontSize: '10px',
    color: '#14372A',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: '1px 4px',
    fontWeight: 500,
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

  // Tutorial styles.
  artworkContainer: {
    width: '100%',
    maxWidth: '320px',
    marginBottom: '10px',
  },
  artwork: {
    width: '100%',
    height: 'auto',
    borderRadius: '6px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
  },
  artworkRow: {
    display: 'flex',
    gap: '10px',
    justifyContent: 'center',
    marginBottom: '10px',
  },
  artworkSmall: {
    width: '140px',
    height: 'auto',
    borderRadius: '6px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
  },
  tutorialPrompt: {
    fontSize: '13px',
    color: '#4b5563',
    lineHeight: 1.5,
    marginBottom: '10px',
  },
  kbd: {
    display: 'inline-block',
    backgroundColor: '#1e293b',
    color: '#f9fafb',
    padding: '3px 8px',
    borderRadius: '3px',
    fontFamily: '-apple-system, monospace',
    fontSize: '12px',
    fontWeight: 500,
    margin: '0 2px',
  },
  recordingIndicator: {
    backgroundColor: '#dc2626',
    color: '#ffffff',
    padding: '5px 12px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: 500,
    marginBottom: '10px',
  },
  testInput: {
    width: '100%',
    maxWidth: '320px',
    padding: '10px',
    fontSize: '13px',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    marginBottom: '10px',
    textAlign: 'center',
  },
  successIcon: {
    fontSize: '32px',
    color: '#14372A',
    marginBottom: '8px',
  },
  successText: {
    fontSize: '13px',
    color: '#166534',
    fontWeight: 500,
  },
  // New styles for enhanced tutorial flow.
  artworkWithStack: {
    position: 'relative',
    display: 'inline-block',
  },
  stackIndicator: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    backgroundColor: 'rgba(34, 197, 94, 0.9)',
    color: '#fff',
    borderRadius: '50%',
    width: '28px',
    height: '28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '16px',
    fontWeight: 'bold',
  },
  composedInput: {
    width: '100%',
    maxWidth: '400px',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  imageChipsRow: {
    display: 'flex',
    gap: '6px',
    padding: '8px 12px',
    borderBottom: '1px solid #f1f5f9',
    flexWrap: 'wrap',
  },
  imageChip: {
    width: '48px',
    height: '48px',
    objectFit: 'cover',
    borderRadius: '6px',
    border: '1px solid #e5e7eb',
  },
  textareaInner: {
    width: '100%',
    minHeight: '60px',
    padding: '12px',
    fontSize: '13px',
    border: 'none',
    outline: 'none',
    resize: 'none',
    textAlign: 'left',
    fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
    lineHeight: 1.5,
  },
};
