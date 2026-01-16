import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';

// =============================================================================
// Onboarding - 4-phase onboarding flow for Field Theory
// Phase 1: Permissions (microphone, accessibility, screen recording)
// Phase 2: Model (voice model selection and download)
// Phase 3: Account (email sign-in required)
// Phase 4: Shortcuts (keyboard shortcuts reference - no dot indicator)
// =============================================================================

type OnboardingPhase = 'permissions' | 'model' | 'account' | 'shortcuts';

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

// Phase to step number mapping for persistence.
const PHASE_TO_STEP: Record<OnboardingPhase, number> = {
  permissions: 0,
  model: 1,
  account: 2,
  shortcuts: 3,
};

const STEP_TO_PHASE: Record<number, OnboardingPhase> = {
  0: 'permissions',
  1: 'model',
  2: 'account',
  3: 'shortcuts',
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
  // All three permissions are required to continue.
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
          label="Microphone"
          description="Handles voice transcription"
          granted={permissions.microphone === 'granted'}
          denied={permissions.microphone === 'denied'}
          onGrant={onRequestMicrophone}
          grantButtonText={permissions.microphone === 'denied' ? 'Open Settings' : 'Allow'}
        />

        {/* Accessibility */}
        <PermissionRow
          label="Accessibility"
          description="Handles copying and pasting into applications"
          granted={permissions.accessibility}
          onGrant={onOpenAccessibility}
          grantButtonText="Open Settings"
        />

        {/* Screen Recording */}
        <PermissionRow
          label="Screen Recording"
          description="Enables ability to take screenshots"
          granted={permissions.screenRecording}
          onGrant={onOpenScreenRecording}
          grantButtonText="Open Settings"
          showRestartHint={!permissions.screenRecording}
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
  grantButtonText?: string;
  showRestartHint?: boolean;
}

function PermissionRow({ label, description, granted, denied, onGrant, grantButtonText = "Grant", showRestartHint }: PermissionRowProps) {
  const handleRestart = () => {
    window.electronAPI?.relaunch?.();
  };

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
        </div>
        <div style={styles.permissionDescription}>{description}</div>
        {denied && (
          <div style={styles.restartHint}>
            Access denied. Enable in System Settings.
          </div>
        )}
        {showRestartHint && (
          <div style={styles.restartHint}>
            May need to{' '}
            <span style={styles.restartLink} onClick={handleRestart}>
              restart app
            </span>
            {' '}to take effect.
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
          
          // Determine border and shadow styles
          const isRecommended = info.recommended;
          let borderColor = '#e5e7eb';
          let boxShadow = 'none';

          if (isSelected && isDownloaded) {
            borderColor = '#14372A';
          } else if (isRecommended) {
            borderColor = '#3b82f6'; // Blue border for recommended
            boxShadow = '0 2px 8px rgba(59, 130, 246, 0.15)'; // Subtle blue shadow
          }

          return (
            <div
              key={modelKey}
              onClick={() => isDownloaded && onSelectModel(modelKey)}
              style={{
                ...styles.modelCard,
                borderColor,
                boxShadow,
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
        Continue
      </button>
    </div>
  );
}

// =============================================================================
// Phase 3: Account (Email Sign-In)
// =============================================================================

interface AccountPhaseProps {
  onFinish: () => void;
  onFinishReturning?: () => void; // Skip shortcuts for returning users
}

function AccountPhase({ onFinish, onFinishReturning }: AccountPhaseProps) {
  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [isRequestingOtp, setIsRequestingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [existingEmail, setExistingEmail] = useState<string | null>(null);
  const [launchAtLogin, setLaunchAtLogin] = useState(true);
  const [launchAtLoginError, setLaunchAtLoginError] = useState(false);

  // Load launch at login setting on mount (checks actual system state).
  useEffect(() => {
    window.clipboardAPI?.getLaunchAtLogin?.().then((enabled) => {
      setLaunchAtLogin(enabled);
    });
  }, []);

  // Check if user is already logged in on mount.
  useEffect(() => {
    const checkSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.email) {
          setExistingEmail(session.user.email);
        }
      } catch (err) {
        console.error('[Onboarding] Failed to check session:', err);
      } finally {
        setIsCheckingSession(false);
      }
    };
    checkSession();
  }, []);

  const handleLaunchAtLoginChange = async (checked: boolean) => {
    setLaunchAtLogin(checked);
    setLaunchAtLoginError(false);
    const result = await window.clipboardAPI?.setLaunchAtLogin?.(checked);
    if (result && !result.success) {
      // Setting failed - update checkbox to actual state and show error
      setLaunchAtLogin(result.enabled);
      setLaunchAtLoginError(true);
    }
  };

  const openLoginItemsSettings = () => {
    window.electronAPI?.openExternal?.('x-apple.systempreferences:com.apple.LoginItems-Settings.extension');
  };

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || isRequestingOtp) return;

    setIsRequestingOtp(true);
    setError(null);

    try {
      const result = await window.authAPI?.requestOtp(email.trim());
      if (result?.error) {
        setError(result.error);
      } else {
        setOtpSent(true);
      }
    } catch (err) {
      setError('Failed to send verification code. Please try again.');
    } finally {
      setIsRequestingOtp(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode.trim() || isVerifyingOtp) return;

    setIsVerifyingOtp(true);
    setError(null);

    try {
      const result = await window.authAPI?.verifyOtp(email.trim(), otpCode.trim());
      if (result?.error) {
        setError(result.error);
      } else if (result?.session) {
        // Set session in Supabase client
        if (supabase) {
          await supabase.auth.setSession({
            access_token: result.session.access_token,
            refresh_token: result.session.refresh_token,
          });
        }
        // Forward session to main process for sync
        await window.clipboardAPI?.setSyncSession?.(
          result.session.access_token,
          result.session.refresh_token
        );
        // Complete onboarding
        onFinish();
      }
    } catch (err) {
      setError('Failed to verify code. Please try again.');
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  // Show loading state while checking session.
  if (isCheckingSession) {
    return (
      <div style={styles.phase}>
        <h1 style={styles.title}>Checking account...</h1>
      </div>
    );
  }

  // If already logged in, show confirmation and continue button.
  if (existingEmail) {
    return (
      <div style={styles.phase}>
        <h1 style={styles.title}>Welcome Back</h1>
        <p style={styles.subtitle}>
          You're signed in as {existingEmail}
        </p>

        <div style={{ marginTop: '20px' }}>
          <label style={styles.launchAtLoginLabel}>
            <input
              type="checkbox"
              checked={launchAtLogin}
              onChange={(e) => handleLaunchAtLoginChange(e.target.checked)}
              style={styles.launchAtLoginCheckbox}
            />
            Launch Field Theory on login
          </label>
          {launchAtLoginError && (
            <div style={styles.launchAtLoginError}>
              Enable in{' '}
              <span style={styles.launchAtLoginLink} onClick={openLoginItemsSettings}>
                System Settings
              </span>
            </div>
          )}
        </div>

        <button
          style={{ ...styles.primaryButton, marginTop: '16px' }}
          onClick={onFinishReturning || onFinish}
        >
          Continue
        </button>
      </div>
    );
  }

  return (
    <div style={styles.phase}>
      <h1 style={styles.title}>Create Your Free Account</h1>
      <p style={styles.subtitle}>
        Sign in to get started with Field Theory.
      </p>

      <div style={styles.accountForm}>
        {!otpSent ? (
          <form onSubmit={handleRequestOtp} style={styles.form}>
            <input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isRequestingOtp}
              style={styles.input}
              autoFocus
            />
            <button
              type="submit"
              disabled={isRequestingOtp || !email.trim()}
              style={{
                ...styles.primaryButton,
                opacity: isRequestingOtp || !email.trim() ? 0.5 : 1,
                cursor: isRequestingOtp || !email.trim() ? 'not-allowed' : 'pointer',
                width: '100%',
              }}
            >
              {isRequestingOtp ? 'Sending...' : 'Send Verification Code'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} style={styles.form}>
            <p style={styles.otpSentText}>
              Code sent to {email}
            </p>
            <input
              type="text"
              placeholder="Enter code"
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
              disabled={isVerifyingOtp}
              style={styles.otpInput}
              autoFocus
            />
            <button
              type="submit"
              disabled={isVerifyingOtp || !otpCode.trim()}
              style={{
                ...styles.primaryButton,
                opacity: isVerifyingOtp || !otpCode.trim() ? 0.5 : 1,
                cursor: isVerifyingOtp || !otpCode.trim() ? 'not-allowed' : 'pointer',
                width: '100%',
              }}
            >
              {isVerifyingOtp ? 'Verifying...' : 'Verify Code'}
            </button>
            <button
              type="button"
              onClick={() => { setOtpSent(false); setOtpCode(''); setError(null); }}
              style={styles.secondaryButton}
            >
              Use a different email
            </button>
          </form>
        )}

        {error && (
          <div style={styles.errorBanner}>
            {error}
          </div>
        )}

        {!otpSent && (
          <div style={{ marginTop: '16px' }}>
            <label style={styles.launchAtLoginLabel}>
              <input
                type="checkbox"
                checked={launchAtLogin}
                onChange={(e) => handleLaunchAtLoginChange(e.target.checked)}
                style={styles.launchAtLoginCheckbox}
              />
              Launch Field Theory on login
            </label>
            {launchAtLoginError && (
              <div style={styles.launchAtLoginError}>
                Enable in{' '}
                <span style={styles.launchAtLoginLink} onClick={openLoginItemsSettings}>
                  System Settings
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Phase 4: Shortcuts (final screen - practice keyboard shortcuts)
// =============================================================================

interface ShortcutsPhaseProps {
  onFinish: () => void;
}

interface ShortcutDef {
  id: string;
  label: string;
  keys: string[];
  match: (e: KeyboardEvent) => boolean;
}

// Parse a hotkey string like "Command+Shift+4" into display keys and a match function.
function parseHotkey(hotkeyStr: string): { keys: string[]; match: (e: KeyboardEvent) => boolean } {
  const parts = hotkeyStr.split('+').map(p => p.trim());
  const displayKeys: string[] = [];

  let needsMeta = false;
  let needsAlt = false;
  let needsShift = false;
  let needsCtrl = false;
  let mainKey = '';

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'command' || lower === 'cmd' || lower === '⌘') {
      needsMeta = true;
      displayKeys.push('⌘');
    } else if (lower === 'alt' || lower === 'option') {
      needsAlt = true;
      displayKeys.push('Option');
    } else if (lower === 'shift') {
      needsShift = true;
      displayKeys.push('Shift');
    } else if (lower === 'ctrl' || lower === 'control') {
      needsCtrl = true;
      displayKeys.push('Ctrl');
    } else {
      // Main key
      mainKey = lower;
      // Display the key nicely
      if (lower === 'space') {
        displayKeys.push('Space');
      } else if (lower === 'escape' || lower === 'esc') {
        displayKeys.push('Esc');
      } else if (lower === '\\') {
        displayKeys.push('\\');
      } else {
        displayKeys.push(part.toUpperCase());
      }
    }
  }

  // Build match function
  const match = (e: KeyboardEvent): boolean => {
    if (needsMeta !== e.metaKey) return false;
    if (needsAlt !== e.altKey) return false;
    if (needsShift !== e.shiftKey) return false;
    if (needsCtrl !== e.ctrlKey) return false;

    // Check the main key
    if (mainKey === 'space') return e.code === 'Space';
    if (mainKey === 'escape' || mainKey === 'esc') return e.code === 'Escape';
    if (mainKey === '\\') return e.code === 'Backslash';
    if (/^[0-9]$/.test(mainKey)) return e.code === `Digit${mainKey}`;
    if (/^[a-z]$/.test(mainKey)) return e.code === `Key${mainKey.toUpperCase()}`;
    if (/^f[0-9]+$/.test(mainKey)) return e.code === mainKey.toUpperCase();

    return false;
  };

  return { keys: displayKeys, match };
}

// Default shortcuts (used as fallback).
const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  {
    id: 'transcription',
    label: 'Start / End transcription',
    keys: ['Option', 'Shift', 'Space'],
    match: (e: KeyboardEvent) => e.altKey && e.shiftKey && e.code === 'Space',
  },
  {
    id: 'screenshot',
    label: 'Take screenshot',
    keys: ['⌘', '4'],
    match: (e: KeyboardEvent) => e.metaKey && !e.shiftKey && e.code === 'Digit4',
  },
  {
    id: 'commandLauncher',
    label: 'Open command launcher',
    keys: ['⌘', 'Shift', 'K'],
    match: (e: KeyboardEvent) => e.metaKey && e.shiftKey && e.code === 'KeyK',
  },
  {
    id: 'openApp',
    label: 'Open Field Theory',
    keys: ['Option', 'Space'],
    match: (e: KeyboardEvent) => e.altKey && !e.shiftKey && e.code === 'Space',
  },
];

function ShortcutsPhase({ onFinish }: ShortcutsPhaseProps) {
  const [completedCount, setCompletedCount] = useState(0);
  const [hasCompletedOnce, setHasCompletedOnce] = useState(false);
  const [shortcuts, setShortcuts] = useState<ShortcutDef[]>(DEFAULT_SHORTCUTS);

  // Load user's actual hotkey preferences on mount.
  useEffect(() => {
    const loadHotkeys = async () => {
      try {
        const [transcriptionHotkey, clipboardHotkeys] = await Promise.all([
          window.transcribeAPI?.getHotkey?.(),
          window.clipboardAPI?.getHotkeys?.(),
        ]);

        const newShortcuts: ShortcutDef[] = [];

        // Transcription hotkey
        if (transcriptionHotkey) {
          const parsed = parseHotkey(transcriptionHotkey);
          newShortcuts.push({
            id: 'transcription',
            label: 'Start / End transcription',
            ...parsed,
          });
        } else {
          newShortcuts.push(DEFAULT_SHORTCUTS[0]);
        }

        // Screenshot hotkey
        if (clipboardHotkeys?.screenshot) {
          const parsed = parseHotkey(clipboardHotkeys.screenshot);
          newShortcuts.push({
            id: 'screenshot',
            label: 'Take screenshot',
            ...parsed,
          });
        } else {
          newShortcuts.push(DEFAULT_SHORTCUTS[1]);
        }

        // Command launcher (hardcoded, not configurable)
        newShortcuts.push(DEFAULT_SHORTCUTS[2]);

        // Open Field Theory (clipboard history hotkey)
        if (clipboardHotkeys?.history) {
          const parsed = parseHotkey(clipboardHotkeys.history);
          newShortcuts.push({
            id: 'openApp',
            label: 'Open Field Theory',
            ...parsed,
          });
        } else {
          newShortcuts.push(DEFAULT_SHORTCUTS[3]);
        }

        setShortcuts(newShortcuts);
      } catch (err) {
        console.error('[Onboarding] Failed to load hotkeys:', err);
        // Keep default shortcuts on error
      }
    };

    loadHotkeys();
  }, []);

  // Listen for keyboard shortcuts.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (completedCount >= shortcuts.length) return;

      const currentShortcut = shortcuts[completedCount];
      if (currentShortcut.match(e)) {
        e.preventDefault();
        e.stopPropagation();
        const newCount = completedCount + 1;
        setCompletedCount(newCount);
        if (newCount >= shortcuts.length) {
          setHasCompletedOnce(true);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [completedCount, shortcuts]);

  const allComplete = completedCount >= shortcuts.length;

  return (
    <div style={styles.phase}>
      <h1 style={styles.title}>Practice these shortcuts</h1>
      <p style={styles.subtitle}>
        Press each shortcut to continue
      </p>

      <div style={{ ...styles.shortcutsList, gap: '2px' }}>
        {shortcuts.map((shortcut, index) => {
          const isCompleted = index < completedCount;
          const isCurrent = index === completedCount;

          return (
            <div
              key={shortcut.id}
              style={{
                ...styles.shortcutRow,
                backgroundColor: isCompleted ? 'rgba(34, 197, 94, 0.1)' : isCurrent ? 'rgba(59, 130, 246, 0.1)' : 'transparent',
                borderRadius: '6px',
                padding: '8px 10px',
                margin: '0 -10px',
                transition: 'background-color 0.2s ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{
                  width: '20px',
                  height: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '13px',
                  color: isCompleted ? '#22c55e' : isCurrent ? '#3b82f6' : '#9ca3af',
                }}>
                  {isCompleted ? '✓' : isCurrent ? '→' : '○'}
                </span>
                <span style={{
                  ...styles.shortcutAction,
                  fontSize: '13px',
                  color: isCompleted ? '#22c55e' : isCurrent ? '#111827' : '#9ca3af',
                  fontWeight: isCurrent ? 600 : 400,
                }}>
                  {shortcut.label}
                </span>
              </div>
              <div style={styles.shortcutKeys}>
                {shortcut.keys.map((key, keyIndex) => (
                  <span key={keyIndex} style={{ display: 'flex', alignItems: 'center' }}>
                    {keyIndex > 0 && <span style={{ ...styles.shortcutPlus, fontSize: '11px' }}>+</span>}
                    <kbd style={{
                      ...styles.kbd,
                      fontSize: '11px',
                      padding: '2px 6px',
                      backgroundColor: isCompleted ? '#dcfce7' : isCurrent ? '#dbeafe' : '#f3f4f6',
                      color: isCompleted ? '#16a34a' : isCurrent ? '#2563eb' : '#6b7280',
                      borderColor: isCompleted ? '#bbf7d0' : isCurrent ? '#bfdbfe' : '#e5e7eb',
                    }}>
                      {key}
                    </kbd>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
        {allComplete && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '2px' }}>
            <button
              onClick={() => setCompletedCount(0)}
              style={{
                background: 'none',
                border: 'none',
                color: '#9ca3af',
                fontSize: '10px',
                cursor: 'pointer',
                padding: '2px 6px',
              }}
            >
              practice again
            </button>
          </div>
        )}
      </div>

      <button
        style={{
          ...styles.primaryButton,
          marginTop: '16px',
          opacity: hasCompletedOnce ? 1 : 0.5,
          cursor: hasCompletedOnce ? 'pointer' : 'not-allowed',
        }}
        onClick={onFinish}
        disabled={!hasCompletedOnce}
      >
        Get Started
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
        // Read initial step from URL params (set by main process).
        // With hash routing, params are in the hash: #/onboarding?step=2
        const hash = window.location.hash;
        const queryIndex = hash.indexOf('?');
        if (queryIndex !== -1) {
          const queryString = hash.slice(queryIndex + 1);
          const urlParams = new URLSearchParams(queryString);
          const stepParam = urlParams.get('step');
          if (stepParam) {
            const stepNum = parseInt(stepParam, 10);
            const initialPhase = STEP_TO_PHASE[stepNum];
            if (initialPhase) {
              setPhase(initialPhase);
            }
          }
        }

        const state = await window.onboardingAPI.getState();
        setPermissions(state.permissions);

        // Load current hotkeys, selected model, and download status for all models.
        if (window.transcribeAPI) {
          // Load the currently selected model.
          let currentModel = await window.transcribeAPI.getSelectedModel();

          // Load download status for all models.
          const downloadStatus = await window.transcribeAPI.getModelDownloadStatus();
          setModelDownloadStatus(downloadStatus);

          // If the current model isn't downloaded but another model is, auto-select a downloaded model.
          if (currentModel && !downloadStatus[currentModel]) {
            const downloadedModel = MODEL_ORDER.find(m => downloadStatus[m]);
            if (downloadedModel) {
              currentModel = downloadedModel;
              await window.transcribeAPI.setSelectedModel(downloadedModel);
            }
          }

          if (currentModel && ['small', 'medium', 'large'].includes(currentModel)) {
            setSelectedModel(currentModel as ModelSize);
          }

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

  // Phase navigation - saves step to preferences for resume on restart.
  const goToModel = useCallback(async () => {
    setPhase('model');
    await window.onboardingAPI?.setStep?.(PHASE_TO_STEP.model);
  }, []);
  const goToAccount = useCallback(async () => {
    setPhase('account');
    await window.onboardingAPI?.setStep?.(PHASE_TO_STEP.account);
  }, []);
  const goToShortcuts = useCallback(async () => {
    setPhase('shortcuts');
    await window.onboardingAPI?.setStep?.(PHASE_TO_STEP.shortcuts);
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
            onFinish={goToAccount}
          />
        );

      case 'account':
        return (
          <AccountPhase onFinish={goToShortcuts} onFinishReturning={finish} />
        );

      case 'shortcuts':
        return (
          <ShortcutsPhase onFinish={finish} />
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
  const allPhases: OnboardingPhase[] = ['permissions', 'model', 'account', 'shortcuts'];
  const currentIndex = allPhases.indexOf(current);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  return (
    <div style={styles.phaseIndicator}>
      {allPhases.map((p, i) => {
        // Can only click on completed phases (before current) to go back.
        const canClick = i < currentIndex;
        const isCurrentOrPast = i <= currentIndex;
        // When hovering a clickable dot, only that dot stays filled
        const isFilled = hoveredIndex !== null && canClick
          ? i === hoveredIndex
          : isCurrentOrPast;
        return (
          <div
            key={p}
            onClick={canClick ? () => onGoToPhase(p) : undefined}
            style={{
              ...styles.phaseDot,
              backgroundColor: isFilled ? '#14372A' : '#d1d5db',
              cursor: canClick ? 'pointer' : 'default',
              transition: 'background-color 0.15s ease',
            }}
            onMouseEnter={() => {
              if (canClick) setHoveredIndex(i);
            }}
            onMouseLeave={() => {
              setHoveredIndex(null);
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
  permissionDescription: {
    fontSize: '11px',
    color: '#6b7280',
    marginTop: '2px',
  },
  restartHint: {
    fontSize: '10px',
    color: '#9ca3af',
    marginTop: '4px',
  },
  restartLink: {
    color: '#3b82f6',
    cursor: 'pointer',
    textDecoration: 'underline',
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
    textAlign: 'left',
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

  // Shortcut hint (used on permissions phase).
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

  // Shortcuts list (used on final shortcuts phase).
  shortcutsList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    width: '100%',
    marginBottom: '20px',
  },
  shortcutRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    backgroundColor: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '8px',
  },
  shortcutAction: {
    fontSize: '13px',
    fontWeight: 500,
    color: '#1a1a1a',
  },
  shortcutKeys: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
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

  // Secondary button.
  secondaryButton: {
    backgroundColor: 'transparent',
    color: '#6b7280',
    border: 'none',
    padding: '8px 16px',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    marginTop: '8px',
  },

  // Account form styles.
  accountForm: {
    width: '100%',
    maxWidth: '300px',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    fontSize: '14px',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    outline: 'none',
    boxSizing: 'border-box',
  },
  otpInput: {
    width: '100%',
    padding: '12px',
    fontSize: '18px',
    textAlign: 'center',
    letterSpacing: '4px',
    border: '1px solid #e5e7eb',
    borderRadius: '6px',
    outline: 'none',
    boxSizing: 'border-box',
  },
  otpSentText: {
    fontSize: '12px',
    color: '#6b7280',
    textAlign: 'center',
    margin: '0 0 4px 0',
  },
  errorBanner: {
    backgroundColor: '#fef2f2',
    border: '1px solid #fecaca',
    borderRadius: '4px',
    padding: '8px 12px',
    marginTop: '12px',
    fontSize: '12px',
    color: '#dc2626',
    textAlign: 'center',
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

  // Launch at login checkbox (subtle, account phase).
  launchAtLoginLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    marginTop: '20px',
    fontSize: '11px',
    color: '#9ca3af',
    cursor: 'pointer',
  },
  launchAtLoginCheckbox: {
    width: '12px',
    height: '12px',
    cursor: 'pointer',
    accentColor: '#9ca3af',
  },
  launchAtLoginError: {
    fontSize: '10px',
    color: '#9ca3af',
    marginTop: '4px',
    marginLeft: '18px',
  },
  launchAtLoginLink: {
    color: '#3b82f6',
    cursor: 'pointer',
    textDecoration: 'underline',
  },
};
