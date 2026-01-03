import { useEffect, useState, useCallback, useRef } from 'react';
import { buildHotkeyString, formatHotkeyDisplay, isModifierOnly } from '../utils/hotkeys';

// =============================================================================
// Onboarding - 3-phase onboarding flow for Field Theory
// Phase 1: Permissions (microphone, accessibility, screen recording)
// Phase 2: Setup (model selection, keyboard shortcuts)
// Phase 3: Tutorial (interactive hands-on practice)
// =============================================================================

type OnboardingPhase = 'permissions' | 'setup' | 'tutorial';

type PermissionStatus = {
  microphone: 'granted' | 'denied' | 'not-determined';
  accessibility: boolean;
  screenRecording: boolean;
};

type ModelSize = 'base' | 'small' | 'medium' | 'large';

interface ModelInfo {
  name: string;
  size: string;
  description: string;
}

const MODELS: Record<ModelSize, ModelInfo> = {
  base: { name: 'Base', size: '142 MB', description: 'Fast, good accuracy' },
  small: { name: 'Small', size: '466 MB', description: 'Better accuracy' },
  medium: { name: 'Medium', size: '1.4 GB', description: 'High accuracy' },
  large: { name: 'Large', size: '2.9 GB', description: 'Best accuracy (multilingual)' },
};

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
// Phase 2: Setup
// =============================================================================

interface SetupPhaseProps {
  selectedModel: ModelSize;
  onSelectModel: (model: ModelSize) => void;
  modelDownloaded: boolean;
  modelDownloading: boolean;
  downloadProgress: number;
  onDownloadModel: () => void;
  recordingHotkey: string;
  screenshotHotkey: string;
  openHotkey: string;
  onSetRecordingHotkey: (hotkey: string) => void;
  onSetScreenshotHotkey: (hotkey: string) => void;
  onSetOpenHotkey: (hotkey: string) => void;
  onContinue: () => void;
}

function SetupPhase({
  selectedModel,
  onSelectModel,
  modelDownloaded,
  modelDownloading,
  downloadProgress,
  onDownloadModel,
  recordingHotkey,
  screenshotHotkey,
  openHotkey,
  onSetRecordingHotkey,
  onSetScreenshotHotkey,
  onSetOpenHotkey,
  onContinue,
}: SetupPhaseProps) {
  const [recordingConfirmed, setRecordingConfirmed] = useState(false);
  const [screenshotConfirmed, setScreenshotConfirmed] = useState(false);
  const [openConfirmed, setOpenConfirmed] = useState(false);
  const [capturingHotkey, setCapturingHotkey] = useState<'recording' | 'screenshot' | 'open' | null>(null);

  // Download must be started (or complete) and all shortcuts confirmed.
  const canContinue = (modelDownloading || modelDownloaded) && 
    recordingConfirmed && screenshotConfirmed && openConfirmed;

  // Handle hotkey capture.
  useEffect(() => {
    if (!capturingHotkey) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const hotkeyString = buildHotkeyString(event);
      if (hotkeyString && !isModifierOnly(hotkeyString)) {
        if (capturingHotkey === 'recording') {
          onSetRecordingHotkey(hotkeyString);
          setRecordingConfirmed(true);
        } else if (capturingHotkey === 'screenshot') {
          onSetScreenshotHotkey(hotkeyString);
          setScreenshotConfirmed(true);
        } else if (capturingHotkey === 'open') {
          onSetOpenHotkey(hotkeyString);
          setOpenConfirmed(true);
        }
        setCapturingHotkey(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [capturingHotkey, onSetRecordingHotkey, onSetScreenshotHotkey, onSetOpenHotkey]);

  return (
    <div style={styles.phase}>
      <h1 style={styles.title}>Configure Field Theory</h1>
      <p style={styles.subtitle}>
        Set up your voice model and keyboard shortcuts.
      </p>

      <div style={styles.checklist}>
        {/* Model Selection */}
        <div style={styles.setupRow}>
          <div style={styles.setupCheck}>
            {modelDownloaded ? (
              <span style={styles.checkmark}>✓</span>
            ) : modelDownloading ? (
              <span style={styles.downloading}>↓</span>
            ) : (
              <span style={styles.unchecked}>○</span>
            )}
          </div>
          <div style={styles.setupContent}>
            <div style={styles.setupLabel}>Voice Model</div>
            <div style={styles.setupDescription}>
              {modelDownloaded 
                ? `${MODELS[selectedModel].name} model ready`
                : modelDownloading
                  ? `Downloading ${MODELS[selectedModel].name}...`
                  : 'Select and download a voice model'}
            </div>
            
            {!modelDownloading && !modelDownloaded && (
              <div style={styles.modelSelector}>
                <select 
                  style={styles.modelSelect}
                  value={selectedModel}
                  onChange={(e) => onSelectModel(e.target.value as ModelSize)}
                >
                  {Object.entries(MODELS).map(([key, info]) => (
                    <option key={key} value={key}>
                      {info.name} ({info.size}) - {info.description}
                    </option>
                  ))}
                </select>
                <button style={styles.downloadButton} onClick={onDownloadModel}>
                  Download
                </button>
              </div>
            )}
            
            {modelDownloading && (
              <div style={styles.progressContainer}>
                <div style={styles.progressBar}>
                  <div 
                    style={{ 
                      ...styles.progressFill, 
                      width: `${downloadProgress}%` 
                    }} 
                  />
                </div>
                <span style={styles.progressText}>{Math.round(downloadProgress)}%</span>
              </div>
            )}
          </div>
        </div>

        {/* Recording Shortcut */}
        <HotkeyRow
          label="Recording Shortcut"
          description="Press to start/stop recording"
          hotkey={recordingHotkey}
          confirmed={recordingConfirmed}
          capturing={capturingHotkey === 'recording'}
          onStartCapture={() => setCapturingHotkey('recording')}
          onConfirm={() => setRecordingConfirmed(true)}
        />

        {/* Screenshot Shortcut */}
        <HotkeyRow
          label="Screenshot Shortcut"
          description="Capture screen for AI context"
          hotkey={screenshotHotkey}
          confirmed={screenshotConfirmed}
          capturing={capturingHotkey === 'screenshot'}
          onStartCapture={() => setCapturingHotkey('screenshot')}
          onConfirm={() => setScreenshotConfirmed(true)}
          note="You can also use Apple's Shift+Cmd+3/4"
        />

        {/* Open Field Theory Shortcut */}
        <HotkeyRow
          label="Open Field Theory"
          description="Quick access to your context window"
          hotkey={openHotkey}
          confirmed={openConfirmed}
          capturing={capturingHotkey === 'open'}
          onStartCapture={() => setCapturingHotkey('open')}
          onConfirm={() => setOpenConfirmed(true)}
        />
      </div>

      <button 
        style={{
          ...styles.primaryButton,
          opacity: canContinue ? 1 : 0.5,
          cursor: canContinue ? 'pointer' : 'not-allowed',
        }}
        onClick={onContinue}
        disabled={!canContinue}
      >
        Try It Out
      </button>
    </div>
  );
}

interface HotkeyRowProps {
  label: string;
  description: string;
  hotkey: string;
  confirmed: boolean;
  capturing: boolean;
  onStartCapture: () => void;
  onConfirm: () => void;
  note?: string;
}

function HotkeyRow({ 
  label, 
  description, 
  hotkey, 
  confirmed, 
  capturing, 
  onStartCapture, 
  onConfirm,
  note,
}: HotkeyRowProps) {
  return (
    <div style={styles.setupRow}>
      <div style={styles.setupCheck}>
        {confirmed ? (
          <span style={styles.checkmark}>✓</span>
        ) : (
          <span style={styles.unchecked}>○</span>
        )}
      </div>
      <div style={styles.setupContent}>
        <div style={styles.setupLabel}>{label}</div>
        <div style={styles.setupDescription}>{description}</div>
        {note && <div style={styles.noteText}>{note}</div>}
      </div>
      <div style={styles.hotkeyCapture}>
        {capturing ? (
          <div style={styles.capturingBox}>Press keys...</div>
        ) : (
          <div style={styles.hotkeyDisplay}>{formatHotkeyDisplay(hotkey)}</div>
        )}
        {!confirmed && !capturing && (
          <div style={styles.hotkeyActions}>
            <button style={styles.changeButton} onClick={onStartCapture}>
              Change
            </button>
            <button style={styles.confirmButton} onClick={onConfirm}>
              Confirm
            </button>
          </div>
        )}
        {confirmed && !capturing && (
          <button style={styles.changeButton} onClick={onStartCapture}>
            Change
          </button>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Phase 3: Tutorial
// =============================================================================

interface TutorialPhaseProps {
  recordingHotkey: string;
  screenshotHotkey: string;
  openHotkey: string;
  isRecording: boolean;
  onFinish: () => void;
}

type TutorialStep = 
  | 'start-recording'
  | 'take-screenshot-1'
  | 'take-screenshot-2'
  | 'field-stacking'
  | 'open-ft'
  | 'complete';

function TutorialPhase({
  recordingHotkey,
  screenshotHotkey,
  openHotkey,
  isRecording,
  onFinish,
}: TutorialPhaseProps) {
  const [step, setStep] = useState<TutorialStep>('start-recording');
  const [screenshotCount, setScreenshotCount] = useState(0);
  const [fieldText, setFieldText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Listen for recording state changes.
  useEffect(() => {
    if (step === 'start-recording' && isRecording) {
      setStep('take-screenshot-1');
    }
  }, [step, isRecording]);

  // Listen for screenshots.
  useEffect(() => {
    if (!window.clipboardAPI) return;

    const handleItemAdded = (_event: any, _id: number) => {
      if (step === 'take-screenshot-1') {
        setScreenshotCount(1);
        setStep('take-screenshot-2');
      } else if (step === 'take-screenshot-2') {
        setScreenshotCount(2);
        // After second screenshot, stop recording to move to field stacking.
        setStep('field-stacking');
      }
    };

    window.clipboardAPI.onItemAdded?.(handleItemAdded);
    return () => {
      // Note: cleanup would require the API to expose a removeListener method.
    };
  }, [step]);

  // For field stacking demo, detect text being pasted.
  useEffect(() => {
    if (step !== 'field-stacking') return;

    const handleInput = () => {
      if (inputRef.current && inputRef.current.value.length > 0) {
        setFieldText(inputRef.current.value);
        // Give a moment for user to see the result.
        setTimeout(() => setStep('open-ft'), 1500);
      }
    };

    const input = inputRef.current;
    if (input) {
      input.addEventListener('input', handleInput);
      return () => input.removeEventListener('input', handleInput);
    }
  }, [step]);

  // Listen for Field Theory window opening.
  useEffect(() => {
    if (step !== 'open-ft') return;

    // When user presses the open shortcut, the FT window opens and we're done.
    // The onboarding window will close after a brief delay.
    const handleWindowOpen = () => {
      setStep('complete');
      setTimeout(onFinish, 500);
    };

    window.onboardingAPI?.onFieldTheoryOpened?.(handleWindowOpen);
  }, [step, onFinish]);

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
              <br />
              Describe what you see in this painting.
            </p>
          </>
        );

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
            <div style={styles.recordingIndicator}>Recording...</div>
            <p style={styles.tutorialPrompt}>
              Now press <kbd style={styles.kbd}>{formatHotkeyDisplay(screenshotHotkey)}</kbd> to take a screenshot of it.
            </p>
          </>
        );

      case 'take-screenshot-2':
        return (
          <>
            <div style={styles.artworkRow}>
              <img 
                src="/onboarding-art-1.jpg" 
                alt="Artwork 1" 
                style={styles.artworkSmall}
              />
              <img 
                src="/onboarding-art-2.jpg" 
                alt="Artwork 2" 
                style={styles.artworkSmall}
              />
            </div>
            <div style={styles.recordingIndicator}>Recording...</div>
            <p style={styles.tutorialPrompt}>
              Now describe and screenshot this one too.
            </p>
          </>
        );

      case 'field-stacking':
        return (
          <>
            <p style={styles.tutorialPrompt}>
              Click the field below, then press <kbd style={styles.kbd}>{formatHotkeyDisplay(recordingHotkey)}</kbd> to record.
            </p>
            <input
              ref={inputRef}
              type="text"
              style={styles.testInput}
              placeholder="Click here and record your thoughts..."
              value={fieldText}
              onChange={(e) => setFieldText(e.target.value)}
            />
            {fieldText && (
              <p style={styles.successText}>
                That's called Field Stacking (or Context Stacking).
              </p>
            )}
          </>
        );

      case 'open-ft':
        return (
          <>
            <p style={styles.tutorialPrompt}>
              Now press <kbd style={styles.kbd}>{formatHotkeyDisplay(openHotkey)}</kbd> to open Field Theory.
            </p>
          </>
        );

      case 'complete':
        return (
          <>
            <div style={styles.successIcon}>✓</div>
            <p style={styles.successText}>You're ready! Have fun.</p>
          </>
        );

      default:
        return null;
    }
  };

  return (
    <div style={styles.phase}>
      <h1 style={styles.title}>How to Use Field Theory</h1>
      {renderContent()}
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
  const [selectedModel, setSelectedModel] = useState<ModelSize>('base');
  const [modelDownloaded, setModelDownloaded] = useState(false);
  const [modelDownloading, setModelDownloading] = useState(false);
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
        setModelDownloaded(state.modelDownloaded);
        
        // Load current hotkeys.
        if (window.transcribeAPI) {
          const transcribeHotkey = await window.transcribeAPI.getHotkey();
          if (transcribeHotkey) setRecordingHotkey(transcribeHotkey);
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

    const unsubscribe = window.transcribeAPI.onModelDownloadProgress((downloaded, total) => {
      const percent = total > 0 ? (downloaded / total) * 100 : 0;
      setDownloadProgress(percent);

      if (downloaded >= total && total > 0) {
        setModelDownloaded(true);
        setModelDownloading(false);
      }
    });

    return () => unsubscribe();
  }, []);

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
  const downloadModel = useCallback(async () => {
    if (!window.transcribeAPI) return;
    setModelDownloading(true);
    setDownloadProgress(0);

    try {
      await window.transcribeAPI.downloadModel(selectedModel);
      setModelDownloaded(true);
    } catch (error) {
      console.error('Model download failed:', error);
    } finally {
      setModelDownloading(false);
    }
  }, [selectedModel]);

  // Hotkey handlers.
  const handleSetRecordingHotkey = useCallback(async (hotkey: string) => {
    setRecordingHotkey(hotkey);
    if (window.transcribeAPI) {
      await window.transcribeAPI.setHotkey(hotkey);
    }
  }, []);

  const handleSetScreenshotHotkey = useCallback(async (hotkey: string) => {
    setScreenshotHotkey(hotkey);
    if (window.clipboardAPI) {
      await window.clipboardAPI.setHotkeys({ screenshot: hotkey });
    }
  }, []);

  const handleSetOpenHotkey = useCallback(async (hotkey: string) => {
    setOpenHotkey(hotkey);
    if (window.clipboardAPI) {
      await window.clipboardAPI.setHotkeys({ history: hotkey });
    }
  }, []);

  // Phase navigation.
  const goToSetup = useCallback(() => setPhase('setup'), []);
  const goToTutorial = useCallback(() => {
    // Expand window for tutorial.
    window.onboardingAPI?.expandWindow?.();
    setPhase('tutorial');
  }, []);

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
            onContinue={goToSetup}
          />
        );

      case 'setup':
        return (
          <SetupPhase
            selectedModel={selectedModel}
            onSelectModel={setSelectedModel}
            modelDownloaded={modelDownloaded}
            modelDownloading={modelDownloading}
            downloadProgress={downloadProgress}
            onDownloadModel={downloadModel}
            recordingHotkey={recordingHotkey}
            screenshotHotkey={screenshotHotkey}
            openHotkey={openHotkey}
            onSetRecordingHotkey={handleSetRecordingHotkey}
            onSetScreenshotHotkey={handleSetScreenshotHotkey}
            onSetOpenHotkey={handleSetOpenHotkey}
            onContinue={goToTutorial}
          />
        );

      case 'tutorial':
        return (
          <TutorialPhase
            recordingHotkey={recordingHotkey}
            screenshotHotkey={screenshotHotkey}
            openHotkey={openHotkey}
            isRecording={isRecording}
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
      <PhaseIndicator current={phase} />
    </div>
  );
}

// =============================================================================
// Phase Indicator
// =============================================================================

function PhaseIndicator({ current }: { current: OnboardingPhase }) {
  const phases: OnboardingPhase[] = ['permissions', 'setup', 'tutorial'];
  const currentIndex = phases.indexOf(current);

  return (
    <div style={styles.phaseIndicator}>
      {phases.map((p, i) => (
        <div
          key={p}
          style={{
            ...styles.phaseDot,
            backgroundColor: i <= currentIndex ? '#14372A' : '#d1d5db',
          }}
        />
      ))}
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
    paddingTop: '38px', // Account for macOS title bar.
  },
  content: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    overflowY: 'auto',
  },
  phase: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    maxWidth: '500px',
    width: '100%',
  },
  title: {
    fontSize: '28px',
    fontWeight: 600,
    color: '#1a1a1a',
    margin: '0 0 8px 0',
  },
  subtitle: {
    fontSize: '16px',
    color: '#4b5563',
    margin: '0 0 24px 0',
    lineHeight: 1.5,
  },
  loadingIcon: {
    fontSize: '48px',
    marginBottom: '16px',
  },

  // Checklist styles.
  checklist: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginBottom: '24px',
  },
  permissionRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '16px',
    textAlign: 'left',
  },
  permissionCheck: {
    width: '24px',
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  checkmark: {
    color: '#14372A',
    fontSize: '18px',
    fontWeight: 'bold',
  },
  unchecked: {
    color: '#d1d5db',
    fontSize: '18px',
  },
  downloading: {
    color: '#3b82f6',
    fontSize: '18px',
  },
  permissionContent: {
    flex: 1,
  },
  permissionLabel: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#1a1a1a',
    marginBottom: '2px',
  },
  permissionDescription: {
    fontSize: '13px',
    color: '#6b7280',
  },
  deniedText: {
    fontSize: '12px',
    color: '#dc2626',
    marginTop: '4px',
  },
  instructionsText: {
    fontSize: '12px',
    color: '#9ca3af',
    marginTop: '4px',
  },
  grantButton: {
    backgroundColor: '#14372A',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
    flexShrink: 0,
  },

  // Setup row styles.
  setupRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '12px',
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '12px',
    padding: '16px',
    textAlign: 'left',
  },
  setupCheck: {
    width: '24px',
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  setupContent: {
    flex: 1,
  },
  setupLabel: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#1a1a1a',
    marginBottom: '2px',
  },
  setupDescription: {
    fontSize: '13px',
    color: '#6b7280',
  },
  noteText: {
    fontSize: '11px',
    color: '#9ca3af',
    marginTop: '4px',
    fontStyle: 'italic',
  },

  // Model selector.
  modelSelector: {
    display: 'flex',
    gap: '8px',
    marginTop: '8px',
  },
  modelSelect: {
    flex: 1,
    padding: '8px',
    fontSize: '13px',
    borderRadius: '6px',
    border: '1px solid #d1d5db',
    backgroundColor: '#ffffff',
  },
  downloadButton: {
    backgroundColor: '#14372A',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: 'pointer',
  },

  // Progress bar.
  progressContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginTop: '8px',
  },
  progressBar: {
    flex: 1,
    height: '6px',
    backgroundColor: '#e5e7eb',
    borderRadius: '3px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#14372A',
    transition: 'width 0.3s ease',
  },
  progressText: {
    fontSize: '12px',
    color: '#6b7280',
    minWidth: '40px',
    textAlign: 'right',
  },

  // Hotkey capture.
  hotkeyCapture: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '4px',
    flexShrink: 0,
  },
  hotkeyDisplay: {
    fontFamily: '-apple-system, monospace',
    fontSize: '14px',
    fontWeight: 500,
    color: '#1a1a1a',
    backgroundColor: '#f3f4f6',
    padding: '6px 12px',
    borderRadius: '6px',
    minWidth: '80px',
    textAlign: 'center',
  },
  capturingBox: {
    fontFamily: '-apple-system, monospace',
    fontSize: '14px',
    color: '#3b82f6',
    backgroundColor: '#eff6ff',
    border: '2px solid #3b82f6',
    padding: '6px 12px',
    borderRadius: '6px',
    minWidth: '80px',
    textAlign: 'center',
  },
  hotkeyActions: {
    display: 'flex',
    gap: '4px',
  },
  changeButton: {
    fontSize: '11px',
    color: '#6b7280',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: '2px 6px',
  },
  confirmButton: {
    fontSize: '11px',
    color: '#14372A',
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
    padding: '2px 6px',
    fontWeight: 500,
  },

  // Success banner.
  successBanner: {
    backgroundColor: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: '8px',
    padding: '12px 16px',
    marginBottom: '16px',
    fontSize: '14px',
    color: '#166534',
    width: '100%',
    textAlign: 'center',
  },

  // Primary button.
  primaryButton: {
    backgroundColor: '#14372A',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    padding: '14px 32px',
    fontSize: '16px',
    fontWeight: 500,
    cursor: 'pointer',
    transition: 'opacity 0.2s',
  },

  // Phase indicator.
  phaseIndicator: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '16px',
    borderTop: '1px solid #f1f5f9',
  },
  phaseDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    transition: 'background-color 0.2s',
  },

  // Tutorial styles.
  artworkContainer: {
    width: '100%',
    maxWidth: '400px',
    marginBottom: '16px',
  },
  artwork: {
    width: '100%',
    height: 'auto',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
  },
  artworkRow: {
    display: 'flex',
    gap: '16px',
    justifyContent: 'center',
    marginBottom: '16px',
  },
  artworkSmall: {
    width: '180px',
    height: 'auto',
    borderRadius: '8px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
  },
  tutorialPrompt: {
    fontSize: '16px',
    color: '#4b5563',
    lineHeight: 1.6,
    marginBottom: '16px',
  },
  kbd: {
    display: 'inline-block',
    backgroundColor: '#1e293b',
    color: '#f9fafb',
    padding: '4px 10px',
    borderRadius: '4px',
    fontFamily: '-apple-system, monospace',
    fontSize: '14px',
    fontWeight: 500,
    margin: '0 2px',
  },
  recordingIndicator: {
    backgroundColor: '#dc2626',
    color: '#ffffff',
    padding: '8px 16px',
    borderRadius: '20px',
    fontSize: '13px',
    fontWeight: 500,
    marginBottom: '16px',
  },
  testInput: {
    width: '100%',
    maxWidth: '400px',
    padding: '16px',
    fontSize: '15px',
    border: '2px solid #e5e7eb',
    borderRadius: '8px',
    marginBottom: '16px',
    textAlign: 'center',
  },
  successIcon: {
    fontSize: '48px',
    color: '#14372A',
    marginBottom: '16px',
  },
  successText: {
    fontSize: '16px',
    color: '#166534',
    fontWeight: 500,
  },
};
