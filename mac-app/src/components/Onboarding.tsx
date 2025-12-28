import { useEffect, useState, useCallback } from 'react';

/**
 * Onboarding step identifiers matching the Electron main process.
 */
enum OnboardingStep {
  WELCOME = 0,
  MICROPHONE = 1,
  ACCESSIBILITY = 2,
  MODEL_DOWNLOAD = 3,
  SCREEN_RECORDING = 4,
  COMPLETE = 5,
}

type PermissionStatus = {
  microphone: 'granted' | 'denied' | 'not-determined';
  accessibility: boolean;
  screenRecording: boolean;
};

/**
 * Progress indicator dots showing current step.
 */
function ProgressDots({ currentStep, totalSteps }: { currentStep: number; totalSteps: number }) {
  return (
    <div style={styles.progressDots}>
      {Array.from({ length: totalSteps }, (_, i) => (
        <div
          key={i}
          style={{
            ...styles.dot,
            backgroundColor: i === currentStep ? '#3b82f6' : '#d1d5db',
          }}
        />
      ))}
      <span style={styles.progressText}>
        {currentStep + 1} of {totalSteps}
      </span>
    </div>
  );
}

/**
 * Screen 1: Welcome - Brand intro and privacy messaging.
 */
function WelcomeScreen({ onNext, onSkip }: { onNext: () => void; onSkip: () => void }) {
  return (
    <div style={styles.screen}>
      <div style={styles.iconLarge}>🎙️</div>
      <h1 style={styles.title}>Welcome to Field Theory</h1>
      <p style={styles.subtitle}>
        Fast, private voice transcription for Mac.
      </p>
      <p style={styles.description}>
        Your voice never leaves your computer. Field Theory uses Whisper, 
        an open-source AI model that runs entirely on your Mac.
      </p>
      <button style={styles.primaryButton} onClick={onNext}>
        Get Started
      </button>
      <button style={styles.skipButton} onClick={onSkip}>
        Set up later
      </button>
    </div>
  );
}

/**
 * Screen 2: Microphone - Permission request with privacy assurance.
 */
function MicrophoneScreen({
  status,
  onRequest,
  onNext,
  onSkip,
}: {
  status: PermissionStatus['microphone'];
  onRequest: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  const isGranted = status === 'granted';

  return (
    <div style={styles.screen}>
      <div style={styles.iconLarge}>🎤</div>
      <h1 style={styles.title}>Microphone Access</h1>
      <p style={styles.subtitle}>
        Field Theory needs access to your microphone to capture your voice for transcription.
      </p>
      
      <div style={styles.privacyBox}>
        <span style={styles.privacyIcon}>🔒</span>
        <span>Your audio is processed entirely on your Mac. Nothing is sent to the cloud.</span>
      </div>

      {status === 'denied' && (
        <div style={styles.warningBox}>
          <span style={styles.warningIcon}>⚠️</span>
          <span>
            Microphone access was denied. Please enable it in{' '}
            <strong>System Settings → Privacy & Security → Microphone</strong>
          </span>
        </div>
      )}

      {isGranted ? (
        <>
          <div style={styles.successBox}>
            <span style={styles.successIcon}>✓</span>
            <span>Microphone access granted</span>
          </div>
          <button style={styles.primaryButton} onClick={onNext}>
            Continue
          </button>
        </>
      ) : (
        <button style={styles.primaryButton} onClick={onRequest}>
          Grant Microphone Access
        </button>
      )}
      
      <button style={styles.skipButton} onClick={onSkip}>
        Set up later
      </button>
    </div>
  );
}

/**
 * Screen 3: Accessibility - Permission for paste functionality.
 */
function AccessibilityScreen({
  status,
  onOpenSettings,
  onRefresh,
  onNext,
  onSkip,
}: {
  status: boolean;
  onOpenSettings: () => void;
  onRefresh: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  return (
    <div style={styles.screen}>
      <div style={styles.iconLarge}>⌨️</div>
      <h1 style={styles.title}>Accessibility Permission</h1>
      <p style={styles.subtitle}>
        Field Theory needs accessibility access to paste transcribed text into your apps.
      </p>

      <div style={styles.infoBox}>
        <strong>Why this is needed:</strong>
        <p style={{ margin: '8px 0 0 0' }}>
          After transcription, Field Theory simulates a paste command (⌘V) to insert 
          text where your cursor is. This requires accessibility permission.
        </p>
      </div>

      {status ? (
        <>
          <div style={styles.successBox}>
            <span style={styles.successIcon}>✓</span>
            <span>Accessibility access granted</span>
          </div>
          <button style={styles.primaryButton} onClick={onNext}>
            Continue
          </button>
        </>
      ) : (
        <>
          <div style={styles.steps}>
            <div style={styles.step}>
              <span style={styles.stepNumber}>1</span>
              <span>Click "Open Settings" below</span>
            </div>
            <div style={styles.step}>
              <span style={styles.stepNumber}>2</span>
              <span>Find "Field Theory" in the list and enable it</span>
            </div>
            <div style={styles.step}>
              <span style={styles.stepNumber}>3</span>
              <span>Come back here and click "I've Enabled It"</span>
            </div>
          </div>
          
          <div style={styles.buttonRow}>
            <button style={styles.secondaryButton} onClick={onOpenSettings}>
              Open Settings
            </button>
            <button style={styles.primaryButton} onClick={onRefresh}>
              I've Enabled It
            </button>
          </div>
        </>
      )}
      
      <button style={styles.skipButton} onClick={onSkip}>
        Set up later
      </button>
    </div>
  );
}

/**
 * Screen 4: Screen Recording - Permission for screenshots.
 */
function ScreenRecordingScreen({
  status,
  onOpenSettings,
  onRefresh,
  onNext,
  onSkip,
}: {
  status: boolean;
  onOpenSettings: () => void;
  onRefresh: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  // Trigger screen capture on mount to add the app to the permissions list.
  // This saves users from manually clicking "+" to add the app.
  useEffect(() => {
    window.onboardingAPI?.triggerScreenRecordingPrompt();
  }, []);

  return (
    <div style={styles.screen}>
      <div style={styles.iconLarge}>📸</div>
      <h1 style={styles.title}>Screen Recording Permission</h1>
      <p style={styles.subtitle}>
        Field Theory needs screen recording access to capture screenshots for AI analysis.
      </p>

      <div style={styles.infoBox}>
        <strong>Why this is needed:</strong>
        <p style={{ margin: '8px 0 0 0' }}>
          When you take a screenshot, Field Theory captures the selected area and sends it to
          Claude for analysis. This requires screen recording permission.
        </p>
      </div>

      {status ? (
        <>
          <div style={styles.successBox}>
            <span style={styles.successIcon}>✓</span>
            <span>Screen recording access granted</span>
          </div>
          <button style={styles.primaryButton} onClick={onNext}>
            Continue
          </button>
        </>
      ) : (
        <>
          <div style={styles.steps}>
            <div style={styles.step}>
              <span style={styles.stepNumber}>1</span>
              <span>Click "Open Settings" below</span>
            </div>
            <div style={styles.step}>
              <span style={styles.stepNumber}>2</span>
              <span>Find "Field Theory" in the list and enable its toggle</span>
            </div>
            <div style={styles.step}>
              <span style={styles.stepNumber}>3</span>
              <span>Come back here and click "I've Enabled It"</span>
            </div>
          </div>

          <div style={styles.buttonRow}>
            <button style={styles.secondaryButton} onClick={onOpenSettings}>
              Open Settings
            </button>
            <button style={styles.primaryButton} onClick={onRefresh}>
              I've Enabled It
            </button>
          </div>
        </>
      )}

      <button style={styles.skipButton} onClick={onSkip}>
        Set up later
      </button>
    </div>
  );
}

/**
 * Screen 5: Model Download - Download Whisper model.
 */
function ModelDownloadScreen({
  downloaded,
  downloading,
  progress,
  onDownload,
  onNext,
  onSkip,
}: {
  downloaded: boolean;
  downloading: boolean;
  progress: number;
  onDownload: () => void;
  onNext: () => void;
  onSkip: () => void;
}) {
  return (
    <div style={styles.screen}>
      <div style={styles.iconLarge}>🧠</div>
      <h1 style={styles.title}>Download AI Model</h1>
      <p style={styles.subtitle}>
        Field Theory uses the Whisper AI model for transcription. 
        This download is required for the app to work.
      </p>

      <div style={styles.infoBox}>
        <strong>Model: whisper-small.en</strong>
        <p style={{ margin: '8px 0 0 0' }}>
          Size: ~150 MB • Optimized for English • Runs locally on your Mac
        </p>
      </div>

      {downloaded ? (
        <>
          <div style={styles.successBox}>
            <span style={styles.successIcon}>✓</span>
            <span>Model downloaded and ready</span>
          </div>
          <button style={styles.primaryButton} onClick={onNext}>
            Continue
          </button>
        </>
      ) : downloading ? (
        <div style={styles.downloadProgress}>
          <div style={styles.progressBar}>
            <div 
              style={{ 
                ...styles.progressFill, 
                width: `${progress}%` 
              }} 
            />
          </div>
          <span style={styles.progressPercent}>{Math.round(progress)}%</span>
        </div>
      ) : (
        <button style={styles.primaryButton} onClick={onDownload}>
          Download Model (~150 MB)
        </button>
      )}
      
      <button style={styles.skipButton} onClick={onSkip}>
        Set up later
      </button>
    </div>
  );
}

/**
 * Screen 5: Complete - Show hotkey and ready to use.
 */
function CompleteScreen({ onFinish }: { onFinish: () => void }) {
  return (
    <div style={styles.screen}>
      <div style={styles.iconLarge}>🎉</div>
      <h1 style={styles.title}>You're All Set!</h1>
      <p style={styles.subtitle}>
        Field Theory is ready to transcribe your voice.
      </p>

      <div style={styles.hotkeyBox}>
        <div style={styles.hotkeyLabel}>Press and hold to record:</div>
        <div style={styles.hotkeyKeys}>
          <kbd style={styles.key}>⌃</kbd>
          <span style={styles.keyPlus}>+</span>
          <kbd style={styles.key}>⌥</kbd>
          <span style={styles.keyPlus}>+</span>
          <kbd style={styles.key}>Space</kbd>
        </div>
        <p style={styles.hotkeyHint}>
          Hold these keys while speaking, then release to transcribe and paste.
        </p>
      </div>

      <div style={styles.tipsBox}>
        <strong>Quick Tips:</strong>
        <ul style={styles.tipsList}>
          <li>Field Theory lives in your menu bar (look for the 🎙️ icon)</li>
          <li>Right-click the icon to access settings</li>
          <li>You can change the hotkey in Settings</li>
        </ul>
      </div>

      <button style={styles.primaryButton} onClick={onFinish}>
        Start Using Field Theory
      </button>
    </div>
  );
}

/**
 * Main onboarding wizard component.
 * Manages state and navigation between screens.
 */
export default function Onboarding() {
  // Parse initial step from URL hash (e.g., #/onboarding?step=2).
  const getInitialStep = (): OnboardingStep => {
    const hash = window.location.hash;
    const match = hash.match(/step=(\d+)/);
    if (match) {
      const step = parseInt(match[1], 10);
      if (step >= 0 && step <= 4) return step;
    }
    return OnboardingStep.WELCOME;
  };

  const [currentStep, setCurrentStep] = useState<OnboardingStep>(getInitialStep);
  const [permissions, setPermissions] = useState<PermissionStatus>({
    microphone: 'not-determined',
    accessibility: false,
    screenRecording: false,
  });
  const [modelDownloaded, setModelDownloaded] = useState(false);
  const [modelDownloading, setModelDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  // Load initial state from Electron.
  useEffect(() => {
    const loadState = async () => {
      // If onboardingAPI is not available, wait a moment for preload to initialize.
      // This handles the race condition where renderer loads before preload completes.
      if (!window.onboardingAPI) {
        console.warn('[Onboarding] onboardingAPI not available, rendering with defaults');
        setIsLoading(false);
        return;
      }
      
      try {
        const state = await window.onboardingAPI.getState();
        setPermissions(state.permissions);
        setModelDownloaded(state.modelDownloaded);
        
        // If resuming, use saved step (but respect URL param if present).
        if (state.currentStep > 0 && !window.location.hash.includes('step=')) {
          setCurrentStep(state.currentStep);
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

  // Save step to preferences when it changes.
  useEffect(() => {
    if (window.onboardingAPI) {
      window.onboardingAPI.setStep(currentStep);
    }
  }, [currentStep]);

  // Refresh permissions status (for accessibility check).
  const refreshPermissions = useCallback(async () => {
    if (!window.onboardingAPI) return;
    const status = await window.onboardingAPI.getPermissionStatus();
    setPermissions(status);
    return status;
  }, []);

  // Request microphone permission.
  const requestMicrophone = useCallback(async () => {
    if (!window.onboardingAPI) return;
    const granted = await window.onboardingAPI.requestMicrophone();
    if (granted) {
      setPermissions(prev => ({ ...prev, microphone: 'granted' }));
    } else {
      // Refresh to get actual status.
      await refreshPermissions();
    }
  }, [refreshPermissions]);

  // Open accessibility settings.
  const openAccessibilitySettings = useCallback(async () => {
    if (!window.onboardingAPI) return;
    await window.onboardingAPI.openAccessibilitySettings();
  }, []);

  // Open screen recording settings.
  const openScreenRecordingSettings = useCallback(async () => {
    if (!window.onboardingAPI) return;
    await window.onboardingAPI.openScreenRecordingSettings();
  }, []);

  // Start model download.
  const downloadModel = useCallback(async () => {
    if (!window.transcribeAPI) return;
    setModelDownloading(true);
    setDownloadProgress(0);
    
    try {
      await window.transcribeAPI.downloadModel('small.en');
      setModelDownloaded(true);
    } catch (error) {
      console.error('Model download failed:', error);
    } finally {
      setModelDownloading(false);
    }
  }, []);

  // Navigation.
  const goToNext = useCallback(() => {
    setCurrentStep(prev => Math.min(prev + 1, OnboardingStep.COMPLETE));
  }, []);

  // Skip onboarding entirely.
  const skip = useCallback(async () => {
    if (window.onboardingAPI) {
      await window.onboardingAPI.skip();
    }
  }, []);

  // Complete onboarding and open main app.
  const finish = useCallback(async () => {
    if (window.onboardingAPI) {
      await window.onboardingAPI.complete();
    }
  }, []);

  // Check accessibility and proceed if granted.
  const checkAccessibilityAndProceed = useCallback(async () => {
    const status = await refreshPermissions();
    if (status?.accessibility) {
      goToNext();
    }
  }, [refreshPermissions, goToNext]);

  // Check screen recording and proceed if granted.
  const checkScreenRecordingAndProceed = useCallback(async () => {
    const status = await refreshPermissions();
    if (status?.screenRecording) {
      goToNext();
    }
  }, [refreshPermissions, goToNext]);

  // Render current step.
  const renderStep = () => {
    switch (currentStep) {
      case OnboardingStep.WELCOME:
        return <WelcomeScreen onNext={goToNext} onSkip={skip} />;
        
      case OnboardingStep.MICROPHONE:
        return (
          <MicrophoneScreen
            status={permissions.microphone}
            onRequest={requestMicrophone}
            onNext={goToNext}
            onSkip={skip}
          />
        );
        
      case OnboardingStep.ACCESSIBILITY:
        return (
          <AccessibilityScreen
            status={permissions.accessibility}
            onOpenSettings={openAccessibilitySettings}
            onRefresh={checkAccessibilityAndProceed}
            onNext={goToNext}
            onSkip={skip}
          />
        );
        
      case OnboardingStep.MODEL_DOWNLOAD:
        return (
          <ModelDownloadScreen
            downloaded={modelDownloaded}
            downloading={modelDownloading}
            progress={downloadProgress}
            onDownload={downloadModel}
            onNext={goToNext}
            onSkip={skip}
          />
        );
        
      case OnboardingStep.SCREEN_RECORDING:
        return (
          <ScreenRecordingScreen
            status={permissions.screenRecording}
            onOpenSettings={openScreenRecordingSettings}
            onRefresh={checkScreenRecordingAndProceed}
            onNext={goToNext}
            onSkip={skip}
          />
        );
        
      case OnboardingStep.COMPLETE:
        return <CompleteScreen onFinish={finish} />;
        
      default:
        return <WelcomeScreen onNext={goToNext} onSkip={skip} />;
    }
  };

  // Show a loading state while waiting for the API.
  if (isLoading) {
    return (
      <div style={styles.container}>
        <div style={styles.content}>
          <div style={styles.screen}>
            <div style={styles.iconLarge}>🎙️</div>
            <h1 style={styles.title}>Loading...</h1>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        {renderStep()}
      </div>
      <ProgressDots currentStep={currentStep} totalSteps={6} />
    </div>
  );
}

// ==========================================================================
// Styles - Clean, minimal design inspired by macOS onboarding
// ==========================================================================

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    backgroundColor: '#ffffff',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    // Account for macOS title bar.
    paddingTop: '38px',
  },
  content: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
  },
  screen: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    maxWidth: '440px',
  },
  iconLarge: {
    fontSize: '64px',
    marginBottom: '16px',
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
    margin: '0 0 16px 0',
    lineHeight: 1.5,
  },
  description: {
    fontSize: '14px',
    color: '#6b7280',
    margin: '0 0 24px 0',
    lineHeight: 1.6,
  },
  primaryButton: {
    backgroundColor: '#3b82f6',
    color: '#ffffff',
    border: 'none',
    borderRadius: '8px',
    padding: '12px 32px',
    fontSize: '16px',
    fontWeight: 500,
    cursor: 'pointer',
    marginTop: '8px',
    transition: 'background-color 0.2s',
  },
  secondaryButton: {
    backgroundColor: '#f3f4f6',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: '8px',
    padding: '12px 24px',
    fontSize: '16px',
    fontWeight: 500,
    cursor: 'pointer',
    marginTop: '8px',
    transition: 'background-color 0.2s',
  },
  skipButton: {
    backgroundColor: 'transparent',
    color: '#9ca3af',
    border: 'none',
    padding: '12px',
    fontSize: '14px',
    cursor: 'pointer',
    marginTop: '16px',
  },
  buttonRow: {
    display: 'flex',
    gap: '12px',
    marginTop: '8px',
  },
  privacyBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: '8px',
    padding: '12px 16px',
    marginBottom: '16px',
    fontSize: '14px',
    color: '#166534',
  },
  privacyIcon: {
    fontSize: '16px',
  },
  infoBox: {
    backgroundColor: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '16px',
    textAlign: 'left',
    width: '100%',
    fontSize: '14px',
    color: '#475569',
  },
  successBox: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    backgroundColor: '#f0fdf4',
    border: '1px solid #bbf7d0',
    borderRadius: '8px',
    padding: '12px 16px',
    marginBottom: '16px',
    fontSize: '14px',
    color: '#166534',
  },
  successIcon: {
    fontSize: '16px',
    color: '#22c55e',
  },
  warningBox: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    backgroundColor: '#fef3c7',
    border: '1px solid #fcd34d',
    borderRadius: '8px',
    padding: '12px 16px',
    marginBottom: '16px',
    fontSize: '14px',
    color: '#92400e',
    textAlign: 'left',
  },
  warningIcon: {
    fontSize: '16px',
    flexShrink: 0,
  },
  steps: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    marginBottom: '16px',
    width: '100%',
  },
  step: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    backgroundColor: '#f8fafc',
    borderRadius: '8px',
    padding: '12px 16px',
    textAlign: 'left',
    fontSize: '14px',
    color: '#475569',
  },
  stepNumber: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '24px',
    height: '24px',
    backgroundColor: '#3b82f6',
    color: '#ffffff',
    borderRadius: '50%',
    fontSize: '12px',
    fontWeight: 600,
    flexShrink: 0,
  },
  downloadProgress: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    width: '100%',
    marginBottom: '16px',
  },
  progressBar: {
    flex: 1,
    height: '8px',
    backgroundColor: '#e5e7eb',
    borderRadius: '4px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#3b82f6',
    transition: 'width 0.3s ease',
  },
  progressPercent: {
    fontSize: '14px',
    color: '#6b7280',
    minWidth: '48px',
    textAlign: 'right',
  },
  hotkeyBox: {
    backgroundColor: '#1e293b',
    borderRadius: '12px',
    padding: '24px',
    marginBottom: '16px',
    width: '100%',
  },
  hotkeyLabel: {
    color: '#94a3b8',
    fontSize: '14px',
    marginBottom: '12px',
  },
  hotkeyKeys: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    marginBottom: '12px',
  },
  key: {
    backgroundColor: '#374151',
    color: '#f9fafb',
    border: '1px solid #4b5563',
    borderRadius: '6px',
    padding: '8px 16px',
    fontSize: '18px',
    fontWeight: 500,
    fontFamily: '-apple-system, BlinkMacSystemFont, monospace',
  },
  keyPlus: {
    color: '#6b7280',
    fontSize: '16px',
  },
  hotkeyHint: {
    color: '#9ca3af',
    fontSize: '13px',
    margin: 0,
  },
  tipsBox: {
    backgroundColor: '#f8fafc',
    border: '1px solid #e2e8f0',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '16px',
    textAlign: 'left',
    width: '100%',
    fontSize: '14px',
    color: '#475569',
  },
  tipsList: {
    margin: '8px 0 0 0',
    paddingLeft: '20px',
    lineHeight: 1.8,
  },
  progressDots: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '16px',
    borderTop: '1px solid #f1f5f9',
  },
  dot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    transition: 'background-color 0.2s',
  },
  progressText: {
    marginLeft: '8px',
    fontSize: '12px',
    color: '#9ca3af',
  },
};

