import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useTheme, Theme } from '../contexts/ThemeContext';
import type { ParakeetSetupError, ParakeetSetupProgress, ParakeetStatus } from '../types/window';
import { buildHotkeyString, formatHotkeyDisplay } from '../utils/hotkeys';
import {
  DEFAULT_VISIBLE_PARAKEET_ENGINE,
  DEFAULT_VISIBLE_TRANSCRIPTION_ENGINE,
  PARAKEET_ONE_TIME_SETUP_NOTE,
  PARAKEET_VISIBLE_ENGINE_OPTIONS,
  getVisibleParakeetActionLabel,
  getVisibleParakeetEngineStatus,
  getVisibleParakeetPendingActionLabel,
  getVisibleParakeetRecoveryMessage,
  isVisibleParakeetEngineVerified,
  normalizeVisibleTranscriptionEngine,
  type VisibleParakeetEngine,
  type VisibleTranscriptionEngine,
} from '../utils/transcriptionEngines';
import ParakeetSupportPanel from './ParakeetSupportPanel';

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
  theme: Theme;
  styles: Record<string, React.CSSProperties>;
}

function PermissionsPhase({
  permissions,
  onRequestMicrophone,
  onOpenAccessibility,
  onOpenScreenRecording,
  onRefreshPermissions,
  onContinue,
  theme,
  styles,
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
          theme={theme}
          styles={styles}
        />

        {/* Accessibility */}
        <PermissionRow
          label="Accessibility"
          description="Handles copying and pasting into applications"
          granted={permissions.accessibility}
          onGrant={onOpenAccessibility}
          grantButtonText="Open Settings"
          theme={theme}
          styles={styles}
        />

        {/* Screenshot Permission (macOS calls this "Screen Recording") */}
        <PermissionRow
          label="Screenshots"
          description="Allows taking screenshots of your screen"
          granted={permissions.screenRecording}
          onGrant={onOpenScreenRecording}
          grantButtonText="Open Settings"
          showRestartHint={!permissions.screenRecording}
          theme={theme}
          styles={styles}
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
  theme: Theme;
  styles: Record<string, React.CSSProperties>;
}

function PermissionRow({ label, description, granted, denied, onGrant, grantButtonText = "Grant", showRestartHint, theme, styles }: PermissionRowProps) {
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

interface AIIntegrationStatus {
  claudeCode: { available: boolean; connected: boolean };
  cursor: { available: boolean; connected: boolean };
}

interface ModelPhaseProps {
  onFinish: () => void;
  selectedEngine: VisibleTranscriptionEngine;
  onSelectEngine: (engine: VisibleTranscriptionEngine) => void;
  parakeetStatus: ParakeetStatus | null;
  settingUpParakeet: boolean;
  settingUpParakeetEngine: VisibleParakeetEngine | null;
  parakeetSetupProgress: ParakeetSetupProgress | null;
  parakeetSetupError: ParakeetSetupError | null;
  onSetupParakeet: (engine: VisibleParakeetEngine) => void;
  theme: Theme;
  styles: Record<string, React.CSSProperties>;
}

function ModelPhase({
  onFinish,
  selectedEngine,
  onSelectEngine,
  parakeetStatus,
  settingUpParakeet,
  settingUpParakeetEngine,
  parakeetSetupProgress,
  parakeetSetupError,
  onSetupParakeet,
  theme,
  styles,
}: ModelPhaseProps) {
  // Can finish if the chosen engine is ready.
  const canFinish = isVisibleParakeetEngineVerified(parakeetStatus, selectedEngine);
  const selectedParakeetEngineStatus = getVisibleParakeetEngineStatus(parakeetStatus, selectedEngine);
  const selectedParakeetProgress = parakeetSetupProgress?.engine === selectedEngine
    ? parakeetSetupProgress
    : null;
  const selectedParakeetSetupActive = Boolean(
    selectedParakeetProgress &&
    selectedParakeetProgress.stage !== 'completed' &&
    selectedParakeetProgress.stage !== 'failed'
  );
  const selectedParakeetSetupError = selectedParakeetSetupActive
    ? null
    : selectedParakeetEngineStatus?.setupError ?? parakeetSetupError;
  const selectedParakeetSupportSummary = selectedParakeetSetupActive
    ? null
    : selectedParakeetSetupError?.summary ?? selectedParakeetEngineStatus?.lastError ?? null;
  const selectedParakeetRecoveryMessage = getVisibleParakeetRecoveryMessage(selectedParakeetSupportSummary);
  const selectedParakeetErrorDetail = selectedParakeetSetupActive
    ? null
    : selectedParakeetSetupError?.detail ?? selectedParakeetEngineStatus?.lastErrorDetail ?? null;

  // AI integration state - shown when either engine is ready
  const [aiStatus, setAiStatus] = useState<AIIntegrationStatus | null>(null);
  const [claudeConnecting, setClaudeConnecting] = useState(false);
  const [cursorConnecting, setCursorConnecting] = useState(false);

  // Load AI integration status on mount
  useEffect(() => {
    window.onboardingAPI?.getAIIntegrationStatus?.().then(setAiStatus).catch(() => {});
  }, []);

  // Handle Claude Code connection
  const handleClaudeConnect = async () => {
    if (claudeConnecting || !aiStatus?.claudeCode.available) return;
    setClaudeConnecting(true);
    try {
      const result = await window.onboardingAPI?.installClaudeHook?.();
      if (result?.success) {
        setAiStatus(prev => prev ? {
          ...prev,
          claudeCode: { ...prev.claudeCode, connected: true }
        } : null);
      }
    } finally {
      setClaudeConnecting(false);
    }
  };

  // Handle Cursor connection
  const handleCursorConnect = async () => {
    if (cursorConnecting || !aiStatus?.cursor.available) return;
    setCursorConnecting(true);
    try {
      const result = await window.onboardingAPI?.installCursorHook?.();
      if (result?.success) {
        setAiStatus(prev => prev ? {
          ...prev,
          cursor: { ...prev.cursor, connected: true }
        } : null);
      }
    } finally {
      setCursorConnecting(false);
    }
  };

  // Show AI integration section when either engine is ready
  const showAIIntegration = canFinish || settingUpParakeet;
  const hasAnyAITool = aiStatus && (aiStatus.claudeCode.available || aiStatus.cursor.available);

  return (
    <div style={styles.phase}>
      <h1 style={styles.title}>Choose Your Transcription Engine</h1>
      <p style={styles.subtitle}>
        Runs locally on your Mac after setup. {PARAKEET_ONE_TIME_SETUP_NOTE}
      </p>

      <div style={styles.modelList}>
        {PARAKEET_VISIBLE_ENGINE_OPTIONS.map((engineOption) => {
          const isSelected = selectedEngine === engineOption.id;
          const engineStatus = getVisibleParakeetEngineStatus(parakeetStatus, engineOption.id);
          const engineVerified = isVisibleParakeetEngineVerified(parakeetStatus, engineOption.id);
          const actionLabel = getVisibleParakeetActionLabel(engineStatus, Boolean(parakeetStatus?.runtimeInstalled));
          const pendingActionLabel = getVisibleParakeetPendingActionLabel(actionLabel);
          const isPendingAction = settingUpParakeet && settingUpParakeetEngine === engineOption.id;
          return (
            <div
              key={engineOption.id}
              onClick={() => onSelectEngine(engineOption.id)}
              style={{
                ...styles.modelCard,
                borderColor: isSelected ? theme.accent : theme.border,
                boxShadow: isSelected
                  ? (theme.isDark ? '0 2px 8px rgba(59, 130, 246, 0.1)' : '0 2px 8px rgba(59, 130, 246, 0.15)')
                  : 'none',
                backgroundColor: isSelected
                  ? (theme.isDark ? theme.surface1 : '#fff')
                  : 'transparent',
                cursor: 'pointer',
              }}
            >
              <div style={styles.modelCardCheck}>
                {isSelected ? (
                  <span style={styles.checkmark}>✓</span>
                ) : (
                  <span style={styles.unchecked}>○</span>
                )}
              </div>
              <div style={styles.modelCardLeft}>
                <div style={styles.modelCardHeader}>
                  <span style={{ fontWeight: 500, fontSize: '12px', color: theme.text }}>
                    {engineOption.label}
                  </span>
                  {engineOption.sizeLabel && (
                    <span style={{ fontSize: '11px', color: theme.textSecondary }}>
                      {engineOption.sizeLabel}
                    </span>
                  )}
                  {engineOption.recommended && (
                    <span style={styles.recommendedBadge}>Recommended</span>
                  )}
                </div>
                <div style={{ fontSize: '11px', color: theme.textSecondary }}>
                  {engineOption.description}
                </div>
              </div>
              <div style={styles.modelCardRight}>
                {engineVerified ? (
                  <span style={{ fontSize: '11px', color: theme.success, fontWeight: 500 }}>Installed</span>
                ) : isPendingAction ? (
                  <span style={{ fontSize: '11px', color: theme.info, fontWeight: 500 }}>{pendingActionLabel}</span>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); onSetupParakeet(engineOption.id); }}
                    style={styles.downloadButton}
                  >
                    {actionLabel}
                  </button>
                )}
              </div>
            </div>
          );
        })}
        {(selectedParakeetProgress || selectedParakeetSupportSummary) && (
          <ParakeetSupportPanel
            theme={theme}
            title={
              selectedParakeetSupportSummary
                ? `${PARAKEET_VISIBLE_ENGINE_OPTIONS.find((option) => option.id === selectedEngine)?.label ?? 'Parakeet'} needs attention`
                : `Setting up ${PARAKEET_VISIBLE_ENGINE_OPTIONS.find((option) => option.id === selectedEngine)?.label ?? 'Parakeet'}`
            }
            summary={selectedParakeetSupportSummary}
            recoveryMessage={
              selectedParakeetSetupError?.moreInfo
              ?? selectedParakeetRecoveryMessage
              ?? 'Open Diagnostics if the error repeats so support can inspect the Parakeet failure.'
            }
            recoveryCommand={selectedParakeetSetupError?.recoveryCommand}
            detail={selectedParakeetErrorDetail}
            progress={selectedParakeetProgress}
          />
        )}

      </div>

      {/* AI Integration Section - shown when either engine is ready */}
      {showAIIntegration && aiStatus && hasAnyAITool && (
        <div style={{
          marginTop: '16px',
          padding: '12px',
          backgroundColor: theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
          borderRadius: '8px',
          border: `1px solid ${theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'}`,
        }}>
          <div style={{
            fontSize: '11px',
            fontWeight: 600,
            color: theme.text,
            marginBottom: '8px',
          }}>
            AI Code Editor Integration
          </div>
          <div style={{
            fontSize: '10px',
            color: theme.textSecondary,
            marginBottom: '10px',
            lineHeight: 1.4,
          }}>
            Let AI agents read your screenshots without permission prompts.
          </div>

          {/* Claude Code */}
          {aiStatus.claudeCode.available && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 10px',
              backgroundColor: theme.isDark ? theme.surface2 : '#fff',
              border: `1px solid ${theme.border}`,
              borderRadius: '6px',
              marginBottom: '6px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: 500, color: theme.text }}>Claude Code</span>
                {aiStatus.claudeCode.connected && (
                  <span style={{
                    fontSize: '9px',
                    color: theme.success,
                    padding: '2px 5px',
                    backgroundColor: theme.isDark ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.1)',
                    borderRadius: '3px',
                  }}>
                    Connected
                  </span>
                )}
              </div>
              {!aiStatus.claudeCode.connected && (
                <button
                  onClick={handleClaudeConnect}
                  disabled={claudeConnecting}
                  style={{
                    padding: '4px 10px',
                    fontSize: '10px',
                    fontWeight: 500,
                    color: '#fff',
                    backgroundColor: theme.accent,
                    border: 'none',
                    borderRadius: '4px',
                    cursor: claudeConnecting ? 'wait' : 'pointer',
                    opacity: claudeConnecting ? 0.5 : 1,
                  }}
                >
                  {claudeConnecting ? '...' : 'Connect'}
                </button>
              )}
            </div>
          )}

          {/* Cursor */}
          {aiStatus.cursor.available && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '8px 10px',
              backgroundColor: theme.isDark ? theme.surface2 : '#fff',
              border: `1px solid ${theme.border}`,
              borderRadius: '6px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', fontWeight: 500, color: theme.text }}>Cursor</span>
                {aiStatus.cursor.connected && (
                  <span style={{
                    fontSize: '9px',
                    color: theme.success,
                    padding: '2px 5px',
                    backgroundColor: theme.isDark ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.1)',
                    borderRadius: '3px',
                  }}>
                    Connected
                  </span>
                )}
              </div>
              {!aiStatus.cursor.connected && (
                <button
                  onClick={handleCursorConnect}
                  disabled={cursorConnecting}
                  style={{
                    padding: '4px 10px',
                    fontSize: '10px',
                    fontWeight: 500,
                    color: '#fff',
                    backgroundColor: theme.accent,
                    border: 'none',
                    borderRadius: '4px',
                    cursor: cursorConnecting ? 'wait' : 'pointer',
                    opacity: cursorConnecting ? 0.5 : 1,
                  }}
                >
                  {cursorConnecting ? '...' : 'Connect'}
                </button>
              )}
            </div>
          )}

          <div style={{
            fontSize: '9px',
            color: theme.textSecondary,
            marginTop: '8px',
            textAlign: 'center',
          }}>
            Can also be configured in Settings → Claude Code
          </div>
        </div>
      )}

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
  onLocalSetup: () => Promise<void>;
  theme: Theme;
  styles: Record<string, React.CSSProperties>;
}

function AccountPhase({ onFinish, onFinishReturning, onLocalSetup, theme, styles }: AccountPhaseProps) {
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
  // Name input state (shown after OTP verification for new users)
  const [showNameInput, setShowNameInput] = useState(false);
  const [fullName, setFullName] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  // Loading state for session setup after OTP verification
  const [isSettingUpSession, setIsSettingUpSession] = useState(false);
  // Call sign state - fetched after OTP verification
  const [callsign, setCallsign] = useState<string | null>(null);
  // Completion screen for returning users (shows call sign before continuing)
  const [showCompletionScreen, setShowCompletionScreen] = useState(false);
  const [isReturningUser, setIsReturningUser] = useState(false);
  // Loading state for completing onboarding (clicking "Done")
  const [isCompleting, setIsCompleting] = useState(false);
  const [isCompletingLocalSetup, setIsCompletingLocalSetup] = useState(false);

  // Load launch at login setting on mount (checks actual system state).
  useEffect(() => {
    window.clipboardAPI?.getLaunchAtLogin?.().then((enabled) => {
      setLaunchAtLogin(enabled);
    });
  }, []);

  // Check if user is already logged in on mount, and fetch their call sign.
  useEffect(() => {
    const checkSession = async () => {
      try {
        const mainProcessSession = await window.authAPI?.getSession?.();
        const rendererSession = mainProcessSession
          ? null
          : supabase
            ? (await supabase.auth.getSession()).data.session
            : null;
        const session = mainProcessSession ?? rendererSession;

        if (session?.user?.email) {
          setExistingEmail(session.user.email);
          const callsignFromSession = (session.user.user_metadata as { callsign?: string } | undefined)?.callsign;
          if (callsignFromSession) {
            setCallsign(callsignFromSession);
          }

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
    window.shellAPI?.openExternal?.('x-apple.systempreferences:com.apple.LoginItems-Settings.extension');
  };

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || isRequestingOtp) return;

    setIsRequestingOtp(true);
    setError(null);

    try {
      // Clear any existing session before new login (prevents session bleed from aliases)
      await window.authAPI?.prepareForNewLogin();
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
        // Show loading state while setting up session
        setIsVerifyingOtp(false);
        setIsSettingUpSession(true);

        // Fetch profile to check if returning user (has name) or new user
        let hasExistingProfile = false;
        if (supabase && result.session.user?.id) {
          try {
            const { data } = await supabase
              .from('profiles')
              .select('callsign, full_name')
              .eq('id', result.session.user.id)
              .maybeSingle();
            if (data?.callsign) {
              setCallsign(data.callsign);
            }
            hasExistingProfile = !!data?.full_name;
          } catch (err) {
            console.warn('[Onboarding] Failed to fetch profile:', err);
          }
        }

        setIsSettingUpSession(false);

        // Returning users (have name set) skip shortcuts, new users go through full flow
        if (hasExistingProfile && onFinishReturning) {
          setIsReturningUser(true);
          setShowCompletionScreen(true);
        } else {
          setShowNameInput(true);
        }
      }
    } catch (err) {
      setError('Failed to verify code. Please try again.');
      setIsSettingUpSession(false);
    } finally {
      setIsVerifyingOtp(false);
    }
  };

  const handleSaveName = async () => {
    if (isSavingName) return;

    if (fullName.trim()) {
      setIsSavingName(true);
      try {
        await window.authAPI?.updateFullName?.(fullName.trim());
      } catch (err) {
        console.error('[Onboarding] Failed to save name:', err);
      } finally {
        setIsSavingName(false);
      }
    }
    onFinish();
  };

  // Show loading state while checking session.
  if (isCheckingSession) {
    return (
      <div style={styles.phase}>
        <h1 style={styles.title}>Checking account...</h1>
      </div>
    );
  }

  // Show loading state while setting up session after OTP verification.
  if (isSettingUpSession) {
    return (
      <div style={styles.phase}>
        <div style={{ marginBottom: '16px' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={theme.accent} strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
            <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="10" />
          </svg>
        </div>
        <h1 style={styles.title}>Signing in...</h1>
        <p style={styles.subtitle}>Setting up your account</p>
      </div>
    );
  }

  // Show name input after OTP verification for new users.
  if (showNameInput) {
    return (
      <div style={styles.phase}>
        <h1 style={styles.title}>Welcome to Field Theory</h1>

        {/* Show call sign prominently */}
        {callsign && (
          <div style={{
            marginBottom: '16px',
            padding: '12px 16px',
            backgroundColor: theme.isDark ? 'rgba(139, 92, 246, 0.1)' : 'rgba(139, 92, 246, 0.08)',
            borderRadius: '8px',
            border: `1px solid ${theme.isDark ? 'rgba(139, 92, 246, 0.3)' : 'rgba(139, 92, 246, 0.2)'}`,
          }}>
            <div style={{
              fontSize: '11px',
              color: theme.textSecondary,
              marginBottom: '4px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              Your Call Sign
            </div>
            <div style={{
              fontFamily: 'SF Mono, Monaco, Consolas, monospace',
              fontSize: '18px',
              fontWeight: 600,
              color: theme.isDark ? '#a78bfa' : '#7c3aed',
              letterSpacing: '2px',
            }}>
              {callsign}
            </div>
          </div>
        )}

        <p style={styles.subtitle}>
          Add your name below, or skip to continue.
        </p>

        <div style={styles.accountForm}>
          <input
            type="text"
            placeholder="Full name (optional)"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={isSavingName}
            style={styles.input}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSaveName();
              }
            }}
          />
          <button
            onClick={handleSaveName}
            disabled={isSavingName}
            style={{
              ...styles.primaryButton,
              opacity: isSavingName ? 0.5 : 1,
              cursor: isSavingName ? 'not-allowed' : 'pointer',
              width: '100%',
            }}
          >
            {fullName.trim() ? 'Continue' : 'Skip'}
          </button>
        </div>
      </div>
    );
  }

  // Completion screen for returning users after OTP verification
  if (showCompletionScreen) {
    return (
      <div style={styles.phase}>
        <h1 style={styles.title}>Welcome Back</h1>

        {/* Show call sign prominently */}
        {callsign && (
          <div style={{
            marginBottom: '16px',
            padding: '12px 16px',
            backgroundColor: theme.isDark ? 'rgba(139, 92, 246, 0.1)' : 'rgba(139, 92, 246, 0.08)',
            borderRadius: '8px',
            border: `1px solid ${theme.isDark ? 'rgba(139, 92, 246, 0.3)' : 'rgba(139, 92, 246, 0.2)'}`,
          }}>
            <div style={{
              fontSize: '11px',
              color: theme.textSecondary,
              marginBottom: '4px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              Your Call Sign
            </div>
            <div style={{
              fontFamily: 'SF Mono, Monaco, Consolas, monospace',
              fontSize: '18px',
              fontWeight: 600,
              color: theme.isDark ? '#a78bfa' : '#7c3aed',
              letterSpacing: '2px',
            }}>
              {callsign}
            </div>
          </div>
        )}

        <p style={styles.subtitle}>
          You're all set. Ready to continue?
        </p>

        <button
          style={{
            ...styles.primaryButton,
            marginTop: '16px',
            width: '100%',
            opacity: isCompleting ? 0.7 : 1,
            cursor: isCompleting ? 'wait' : 'pointer',
          }}
          onClick={async () => {
            setIsCompleting(true);
            const handler = isReturningUser ? onFinishReturning : onFinish;
            await handler?.();
            // Note: if handler closes the window, this won't run
          }}
          disabled={isCompleting}
        >
          {isCompleting ? 'Finishing setup...' : 'Done'}
        </button>
      </div>
    );
  }

  // If already logged in, show confirmation and continue button.
  if (existingEmail) {
    return (
      <div style={styles.phase}>
        <h1 style={styles.title}>Welcome Back</h1>

        {/* Show call sign prominently */}
        {callsign && (
          <div style={{
            marginBottom: '16px',
            padding: '12px 16px',
            backgroundColor: theme.isDark ? 'rgba(139, 92, 246, 0.1)' : 'rgba(139, 92, 246, 0.08)',
            borderRadius: '8px',
            border: `1px solid ${theme.isDark ? 'rgba(139, 92, 246, 0.3)' : 'rgba(139, 92, 246, 0.2)'}`,
          }}>
            <div style={{
              fontSize: '11px',
              color: theme.textSecondary,
              marginBottom: '4px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              Your Call Sign
            </div>
            <div style={{
              fontFamily: 'SF Mono, Monaco, Consolas, monospace',
              fontSize: '18px',
              fontWeight: 600,
              color: theme.isDark ? '#a78bfa' : '#7c3aed',
              letterSpacing: '2px',
            }}>
              {callsign}
            </div>
          </div>
        )}

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
          style={{
            ...styles.primaryButton,
            marginTop: '16px',
            opacity: isCompleting ? 0.7 : 1,
            cursor: isCompleting ? 'wait' : 'pointer',
          }}
          onClick={async () => {
            setIsCompleting(true);
            const handler = onFinishReturning || onFinish;
            await handler?.();
          }}
          disabled={isCompleting}
        >
          {isCompleting ? 'Finishing setup...' : 'Continue'}
        </button>

        <button
          type="button"
          onClick={async () => {
            // Clear session to allow signing in with a different account
            await window.authAPI?.prepareForNewLogin();
            setExistingEmail(null);
          }}
          style={styles.secondaryButton}
        >
          Use a different account
        </button>
      </div>
    );
  }

  return (
    <div style={styles.phase}>
      <h1 style={styles.title}>Use Field Theory</h1>
      <p style={styles.subtitle}>
        Sign in for shared and account-backed features, or continue with local setup.
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
            <button
              type="button"
              onClick={async () => {
                setError(null);
                const result = await window.authAPI?.requestOtp(email.trim());
                if (result?.error) {
                  setError(result.error);
                }
              }}
              style={{
                background: 'none',
                border: 'none',
                color: theme.textSecondary,
                fontSize: '12px',
                cursor: 'pointer',
                marginTop: '8px',
                textDecoration: 'underline',
              }}
            >
              Resend code
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

        {!otpSent && (
          <a
            href="#"
            onClick={async (event) => {
              event.preventDefault();
              if (isCompletingLocalSetup) return;
              setIsCompletingLocalSetup(true);
              setError(null);
              try {
                await onLocalSetup();
              } catch (err) {
                console.error('[Onboarding] Failed to complete local setup:', err);
                setError('Could not finish local setup. Please try again.');
                setIsCompletingLocalSetup(false);
              }
            }}
            style={{
              ...styles.localSetupLink,
              opacity: isCompletingLocalSetup ? 0.6 : 1,
              cursor: isCompletingLocalSetup ? 'wait' : 'pointer',
            }}
          >
            {isCompletingLocalSetup ? 'Starting local setup...' : 'local setup'}
          </a>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Phase 4: Shortcuts (final screen - configure and practice keyboard shortcuts)
// =============================================================================

interface ShortcutsPhaseProps {
  onFinish: () => void;
  theme: Theme;
  styles: Record<string, React.CSSProperties>;
}

type ShortcutCapture = 'history' | 'transcription' | 'screenshot' | null;

function ShortcutsPhase({ onFinish, theme, styles }: ShortcutsPhaseProps) {
  // Current hotkey values
  const [historyHotkey, setHistoryHotkey] = useState('Alt+Space');
  const [transcriptionHotkey, setTranscriptionHotkey] = useState('Option+/');
  const [screenshotHotkey, setScreenshotHotkey] = useState('Command+4');

  // Capture state
  const [capturing, setCapturing] = useState<ShortcutCapture>(null);
  const [error, setError] = useState<string | null>(null);
  // Loading state for completing onboarding
  const [isCompleting, setIsCompleting] = useState(false);

  // Hotkey conflict detection state
  const [testingHotkeys, setTestingHotkeys] = useState(false);
  const [hotkeyStatuses, setHotkeyStatuses] = useState<Record<string, HotkeyTestResult | null>>({});
  const [hotkeysLoaded, setHotkeysLoaded] = useState(false);

  // Load current hotkeys on mount
  useEffect(() => {
    const loadHotkeys = async () => {
      try {
        const [transcription, clipboard] = await Promise.all([
          window.transcribeAPI?.getHotkey?.(),
          window.clipboardAPI?.getHotkeys?.(),
        ]);

        if (transcription) setTranscriptionHotkey(transcription);
        if (clipboard?.history) setHistoryHotkey(clipboard.history);
        if (clipboard?.screenshot) setScreenshotHotkey(clipboard.screenshot);
        setHotkeysLoaded(true);
      } catch (err) {
        console.error('[Onboarding] Failed to load hotkeys:', err);
        setHotkeysLoaded(true);
      }
    };

    loadHotkeys();
  }, []);

  // Auto-test hotkeys for conflicts after they're loaded
  useEffect(() => {
    if (!hotkeysLoaded || testingHotkeys) return;

    const runTests = async () => {
      if (!window.hotkeyAPI?.testHotkey) {
        return;
      }

      setTestingHotkeys(true);

      const hotkeysToTest = [
        { id: 'history', key: historyHotkey },
        { id: 'transcription', key: transcriptionHotkey },
        { id: 'screenshot', key: screenshotHotkey },
      ];

      const results: Record<string, HotkeyTestResult | null> = {};

      for (const { id, key } of hotkeysToTest) {
        if (key) {
          try {
            // Short timeout since we're just checking registration, not waiting for user input
            const result = await window.hotkeyAPI.testHotkey(key, 500);
            results[id] = result;
          } catch (err) {
            console.error(`[Onboarding] Failed to test hotkey ${id}:`, err);
            results[id] = null;
          }
        }
      }

      setHotkeyStatuses(results);
      setTestingHotkeys(false);
    };

    runTests();
  }, [hotkeysLoaded, historyHotkey, transcriptionHotkey, screenshotHotkey]);

  // Handle hotkey capture - always save the user's choice, warn if registration may fail
  const handleSetHistoryHotkey = useCallback(async (hotkeyString: string) => {
    setCapturing(null);
    setError(null);
    setHistoryHotkey(hotkeyString);

    if (!window.clipboardAPI) return;

    try {
      await window.clipboardAPI.setHotkeys({ history: hotkeyString });
    } catch (err) {
      console.warn('History hotkey registration warning:', err);
    }
  }, []);

  const handleSetTranscriptionHotkey = useCallback(async (hotkeyString: string) => {
    setCapturing(null);
    setError(null);
    setTranscriptionHotkey(hotkeyString);

    if (!window.transcribeAPI?.setHotkey) return;

    try {
      await window.transcribeAPI.setHotkey(hotkeyString);
    } catch (err) {
      console.warn('Transcription hotkey registration warning:', err);
    }
  }, []);

  const handleSetScreenshotHotkey = useCallback(async (hotkeyString: string) => {
    setCapturing(null);
    setError(null);
    setScreenshotHotkey(hotkeyString);

    if (!window.clipboardAPI) return;

    try {
      await window.clipboardAPI.setHotkeys({ screenshot: hotkeyString });
    } catch (err) {
      console.warn('Screenshot hotkey registration warning:', err);
    }
  }, []);

  // Capture keydown when recording
  useEffect(() => {
    if (!capturing) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const hotkeyString = buildHotkeyString(event);
      if (hotkeyString) {
        if (capturing === 'history') {
          handleSetHistoryHotkey(hotkeyString);
        } else if (capturing === 'transcription') {
          handleSetTranscriptionHotkey(hotkeyString);
        } else if (capturing === 'screenshot') {
          handleSetScreenshotHotkey(hotkeyString);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [capturing, handleSetHistoryHotkey, handleSetTranscriptionHotkey, handleSetScreenshotHotkey]);

  const shortcuts = [
    { id: 'history', label: 'Open Field Theory', hotkey: historyHotkey },
    { id: 'transcription', label: 'Record Transcription', hotkey: transcriptionHotkey },
    { id: 'screenshot', label: 'Take Screenshot', hotkey: screenshotHotkey },
  ];

  const btnStyle: React.CSSProperties = {
    padding: '6px 10px',
    fontSize: '11px',
    fontWeight: 500,
    backgroundColor: theme.isDark ? theme.surface2 : '#f3f4f6',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
    color: theme.text,
    cursor: 'pointer',
    minWidth: '60px',
    textAlign: 'center',
  };

  const btnActiveStyle: React.CSSProperties = {
    ...btnStyle,
    backgroundColor: theme.infoBg,
    borderColor: theme.info,
    color: theme.info,
  };

  const btnCancelStyle: React.CSSProperties = {
    padding: '6px 10px',
    fontSize: '11px',
    backgroundColor: 'transparent',
    border: 'none',
    color: theme.textSecondary,
    cursor: 'pointer',
  };

  return (
    <div style={styles.phase}>
      <h1 style={styles.title}>Configure your shortcuts</h1>
      <p style={styles.subtitle}>
        Click to customize, or keep the defaults
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
        {shortcuts.map((shortcut) => {
          const isCapturing = capturing === shortcut.id;
          const status = hotkeyStatuses[shortcut.id];
          const hasConflict = status?.status === 'conflict';

          return (
            <div key={shortcut.id}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  backgroundColor: theme.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                  borderRadius: hasConflict ? '8px 8px 0 0' : '8px',
                  border: `1px solid ${hasConflict ? '#f59e0b' : (theme.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)')}`,
                  borderBottom: hasConflict ? 'none' : undefined,
                }}
              >
                <span style={{ fontSize: '13px', fontWeight: 500, color: theme.text }}>
                  {shortcut.label}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    onClick={() => {
                      if (!isCapturing) {
                        setCapturing(shortcut.id as ShortcutCapture);
                        setError(null);
                      }
                    }}
                    disabled={capturing !== null && !isCapturing}
                    style={isCapturing ? btnActiveStyle : btnStyle}
                  >
                    {isCapturing ? 'Press keys...' : (formatHotkeyDisplay(shortcut.hotkey) || 'Not set')}
                  </button>
                  {isCapturing && (
                    <button
                      onClick={() => { setCapturing(null); setError(null); }}
                      style={btnCancelStyle}
                    >
                      Cancel
                    </button>
                  )}
                  {/* Status indicator */}
                  {!isCapturing && (
                    testingHotkeys ? (
                      <span style={{ fontSize: '11px', color: theme.textSecondary }}>...</span>
                    ) : status?.status === 'working' ? (
                      <span style={{ color: '#10b981', fontSize: '14px' }} title="Working">✓</span>
                    ) : hasConflict ? (
                      <span style={{ color: '#f59e0b', fontSize: '14px' }} title={status?.conflictApp || 'May be captured by another app'}>!</span>
                    ) : null
                  )}
                </div>
              </div>
              {/* Conflict warning */}
              {hasConflict && (
                <div style={{
                  fontSize: '11px',
                  color: '#f59e0b',
                  padding: '6px 12px',
                  backgroundColor: 'rgba(245, 158, 11, 0.1)',
                  borderRadius: '0 0 8px 8px',
                  border: '1px solid #f59e0b',
                  borderTop: 'none',
                }}>
                  {status?.conflictApp
                    ? `May conflict with ${status.conflictApp}. Consider changing.`
                    : 'May be captured by another app. Consider changing.'}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && (
        <p style={{ fontSize: '12px', color: theme.error, marginTop: '8px', textAlign: 'center' }}>
          {error}
        </p>
      )}

      <p style={{ fontSize: '11px', color: theme.textSecondary, marginTop: '12px', textAlign: 'center' }}>
        You can change these anytime in Settings → Keyboard Shortcuts
      </p>

      <button
        style={{
          ...styles.primaryButton,
          marginTop: '16px',
          opacity: isCompleting ? 0.7 : 1,
          cursor: isCompleting ? 'wait' : 'pointer',
        }}
        onClick={async () => {
          setIsCompleting(true);
          await onFinish?.();
        }}
        disabled={isCompleting}
      >
        {isCompleting ? 'Starting up...' : 'Get Started'}
      </button>
    </div>
  );
}

// =============================================================================
// Main Onboarding Component
// =============================================================================

export default function Onboarding() {
  const { theme } = useTheme();
  const styles = getStyles(theme);
  const [phase, setPhase] = useState<OnboardingPhase>('permissions');
  const [isLoading, setIsLoading] = useState(true);
  
  // Permissions state.
  const [permissions, setPermissions] = useState<PermissionStatus>({
    microphone: 'not-determined',
    accessibility: false,
    screenRecording: false,
  });

  // Engine selection state.
  const [selectedEngine, setSelectedEngine] = useState<VisibleTranscriptionEngine>(DEFAULT_VISIBLE_PARAKEET_ENGINE);
  const [parakeetStatus, setParakeetStatus] = useState<ParakeetStatus | null>(null);
  const [settingUpParakeet, setSettingUpParakeet] = useState(false);
  const [settingUpParakeetEngine, setSettingUpParakeetEngine] = useState<VisibleParakeetEngine | null>(null);
  const [parakeetSetupProgress, setParakeetSetupProgress] = useState<ParakeetSetupProgress | null>(null);
  const [parakeetSetupError, setParakeetSetupError] = useState<ParakeetSetupError | null>(null);

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

        // Load engine selection and Parakeet status.
        if (window.transcribeAPI) {
          const currentEngine = await window.transcribeAPI.getTranscriptionEngine?.() ?? DEFAULT_VISIBLE_TRANSCRIPTION_ENGINE;
          const normalizedEngine = normalizeVisibleTranscriptionEngine(currentEngine);
          setSelectedEngine(normalizedEngine);

          const status = await window.transcribeAPI.getParakeetStatus?.() ?? null;
          setParakeetStatus(status);
        }
      } catch (err) {
        console.error('[Onboarding] Failed to load state:', err);
      } finally {
        setIsLoading(false);
      }
    };
    loadState();
  }, []);

  useEffect(() => {
    if (!window.transcribeAPI?.onParakeetSetupProgress) return;
    return window.transcribeAPI.onParakeetSetupProgress((progress) => {
      setParakeetSetupProgress(progress);
    });
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
    // Trigger a screen capture first to auto-add the app to the permissions list.
    // This saves users from having to manually click "+" to add the app.
    await window.onboardingAPI.triggerScreenRecordingPrompt();
    await window.onboardingAPI.openScreenRecordingSettings();
  }, []);

  // Engine selection handlers.
  const handleEngineChange = useCallback((engine: VisibleTranscriptionEngine) => {
    setSelectedEngine(engine);
  }, []);

  const handleSetupParakeet = useCallback(async (engine: VisibleParakeetEngine) => {
    if (!window.transcribeAPI || settingUpParakeet) return;
    setSelectedEngine(engine);
    setSettingUpParakeet(true);
    setSettingUpParakeetEngine(engine);
    setParakeetSetupProgress({
      engine,
      stage: 'installing-runtime',
      message: 'Installing the Parakeet runtime…',
      percent: null,
      detail: null,
    });
    setParakeetSetupError(null);
    try {
      const result = await window.transcribeAPI.setupParakeet?.(engine);
      if (result?.success) {
        const status = await window.transcribeAPI.getParakeetStatus?.() ?? null;
        setParakeetStatus(status);
      } else {
        setParakeetSetupError(result?.setupError ?? {
          code: 'setup-failed',
          summary: result?.error ?? 'Setup failed',
          detail: result?.error ?? 'Setup failed',
          recoveryCommand: '',
          moreInfo: 'Retry Parakeet setup. If it fails again, open Diagnostics so support can inspect the setup log.',
        });
        const status = await window.transcribeAPI.getParakeetStatus?.() ?? null;
        setParakeetStatus(status);
      }
    } catch (err) {
      const summary = err instanceof Error ? err.message : 'Setup failed';
      setParakeetSetupError({
        code: 'setup-failed',
        summary,
        detail: summary,
        recoveryCommand: '',
        moreInfo: 'Retry Parakeet setup. If it fails again, open Diagnostics so support can inspect the setup log.',
      });
      const status = await window.transcribeAPI.getParakeetStatus?.() ?? null;
      setParakeetStatus(status);
    } finally {
      setSettingUpParakeet(false);
      setSettingUpParakeetEngine(null);
      setParakeetSetupProgress(null);
    }
  }, [settingUpParakeet]);

  // Phase navigation - saves step to preferences for resume on restart.
  const goToModel = useCallback(async () => {
    setPhase('model');
    await window.onboardingAPI?.setStep?.(PHASE_TO_STEP.model);
  }, []);
  const goToAccount = useCallback(async () => {
    // Persist engine choice before navigating.
    await window.transcribeAPI?.setTranscriptionEngine?.(selectedEngine);
    setPhase('account');
    await window.onboardingAPI?.setStep?.(PHASE_TO_STEP.account);
  }, [selectedEngine]);
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

  const finishLocalSetup = useCallback(async () => {
    await window.transcribeAPI?.setTranscriptionEngine?.(selectedEngine);
    await window.onboardingAPI?.completeLocalSetup?.();
  }, [selectedEngine]);

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
            theme={theme}
            styles={styles}
          />
        );

      case 'model':
        return (
          <ModelPhase
            onFinish={goToAccount}
            selectedEngine={selectedEngine}
            onSelectEngine={handleEngineChange}
            parakeetStatus={parakeetStatus}
            settingUpParakeet={settingUpParakeet}
            settingUpParakeetEngine={settingUpParakeetEngine}
            parakeetSetupProgress={parakeetSetupProgress}
            parakeetSetupError={parakeetSetupError}
            onSetupParakeet={handleSetupParakeet}
            theme={theme}
            styles={styles}
          />
        );

      case 'account':
        return (
          <AccountPhase
            onFinish={goToShortcuts}
            onFinishReturning={finish}
            onLocalSetup={finishLocalSetup}
            theme={theme}
            styles={styles}
          />
        );

      case 'shortcuts':
        return (
          <ShortcutsPhase onFinish={finish} theme={theme} styles={styles} />
        );
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.content}>
        {renderPhase()}
      </div>
      <PhaseIndicator current={phase} onGoToPhase={setPhase} theme={theme} styles={styles} />
    </div>
  );
}

// =============================================================================
// Phase Indicator - clickable dots for back navigation
// =============================================================================

interface PhaseIndicatorProps {
  current: OnboardingPhase;
  onGoToPhase: (phase: OnboardingPhase) => void;
  theme: Theme;
  styles: Record<string, React.CSSProperties>;
}

function PhaseIndicator({ current, onGoToPhase, theme, styles }: PhaseIndicatorProps) {
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
              backgroundColor: isFilled ? theme.accent : theme.border,
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

const getStyles = (theme: Theme): Record<string, React.CSSProperties> => ({
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    backgroundColor: theme.background,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    paddingTop: '28px', // Account for macOS title bar.
  },
  content: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '12px',
  },
  phase: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    textAlign: 'center',
    maxWidth: '400px',
    width: '100%',
    margin: 'auto 0',
  },
  title: {
    fontSize: '18px',
    fontWeight: 600,
    color: theme.text,
    margin: '0 0 2px 0',
  },
  subtitle: {
    fontSize: '12px',
    color: theme.textSecondary,
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
    backgroundColor: theme.isDark ? theme.surface1 : '#ffffff',
    border: `1px solid ${theme.border}`,
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
    color: theme.success,
    fontSize: '14px',
    fontWeight: 'bold',
  },
  unchecked: {
    color: theme.border,
    fontSize: '14px',
  },
  permissionContent: {
    flex: 1,
  },
  permissionLabel: {
    fontSize: '13px',
    fontWeight: 500,
    color: theme.text,
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  permissionDescription: {
    fontSize: '11px',
    color: theme.textSecondary,
    marginTop: '2px',
  },
  restartHint: {
    fontSize: '10px',
    color: theme.textSecondary,
    marginTop: '4px',
  },
  restartLink: {
    color: theme.info,
    cursor: 'pointer',
    textDecoration: 'underline',
  },
  instructionsText: {
    fontSize: '11px',
    color: theme.textSecondary,
    marginTop: '2px',
  },
  grantButton: {
    backgroundColor: theme.accent,
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
    border: `1px solid ${theme.border}`,
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
    color: theme.isDark ? theme.success : '#14372A',
    backgroundColor: theme.successBg,
    padding: '1px 5px',
    borderRadius: '3px',
    textTransform: 'uppercase',
    letterSpacing: '0.02em',
  },
  downloadButton: {
    backgroundColor: theme.accent,
    color: '#ffffff',
    border: 'none',
    borderRadius: '4px',
    padding: '5px 12px',
    fontSize: '11px',
    fontWeight: 500,
    cursor: 'pointer',
  },
  cancelButton: {
    backgroundColor: theme.isDark ? theme.surface2 : '#f3f4f6',
    color: theme.textSecondary,
    border: `1px solid ${theme.border}`,
    borderRadius: '4px',
    padding: '5px 12px',
    fontSize: '11px',
    fontWeight: 500,
    cursor: 'pointer',
  },
  deleteButton: {
    backgroundColor: 'transparent',
    color: theme.textSecondary,
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
    backgroundColor: theme.border,
    borderRadius: '2px',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: theme.accent,
    transition: 'width 0.3s ease',
  },
  progressText: {
    fontSize: '11px',
    color: theme.textSecondary,
    minWidth: '32px',
    textAlign: 'right',
  },

  // Success banner.
  successBanner: {
    backgroundColor: theme.successBg,
    border: `1px solid ${theme.isDark ? 'rgba(74,222,128,0.3)' : '#bbf7d0'}`,
    borderRadius: '4px',
    padding: '6px 10px',
    marginBottom: '8px',
    fontSize: '12px',
    color: theme.isDark ? theme.success : '#166534',
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
    color: theme.textSecondary,
    marginRight: '4px',
  },
  shortcutPlus: {
    fontSize: '11px',
    color: theme.textSecondary,
  },
  kbd: {
    display: 'inline-block',
    padding: '3px 8px',
    fontSize: '11px',
    fontWeight: 500,
    color: theme.text,
    backgroundColor: theme.isDark ? theme.surface2 : '#f3f4f6',
    border: `1px solid ${theme.border}`,
    borderRadius: '4px',
    boxShadow: `0 1px 0 ${theme.border}`,
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
    backgroundColor: theme.isDark ? theme.surface1 : '#ffffff',
    border: `1px solid ${theme.border}`,
    borderRadius: '8px',
  },
  shortcutAction: {
    fontSize: '13px',
    fontWeight: 500,
    color: theme.text,
  },
  shortcutKeys: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },

  // Primary button.
  primaryButton: {
    backgroundColor: theme.accent,
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
    color: theme.textSecondary,
    border: 'none',
    padding: '8px 16px',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    marginTop: '8px',
  },
  localSetupLink: {
    display: 'block',
    background: 'none',
    border: 'none',
    color: theme.info,
    padding: 0,
    margin: '14px auto 0',
    fontSize: '12px',
    fontWeight: 500,
    textDecoration: 'underline',
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
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
    outline: 'none',
    boxSizing: 'border-box',
    backgroundColor: theme.isDark ? theme.surface1 : '#fff',
    color: theme.text,
  },
  otpInput: {
    width: '100%',
    padding: '12px',
    fontSize: '18px',
    textAlign: 'center',
    letterSpacing: '4px',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
    outline: 'none',
    boxSizing: 'border-box',
    backgroundColor: theme.isDark ? theme.surface1 : '#fff',
    color: theme.text,
  },
  otpSentText: {
    fontSize: '12px',
    color: theme.textSecondary,
    textAlign: 'center',
    margin: '0 0 4px 0',
  },
  errorBanner: {
    backgroundColor: theme.errorBg,
    border: `1px solid ${theme.isDark ? 'rgba(248,113,113,0.3)' : '#fecaca'}`,
    borderRadius: '4px',
    padding: '8px 12px',
    marginTop: '12px',
    fontSize: '12px',
    color: theme.error,
    textAlign: 'center',
  },

  // Phase indicator.
  phaseIndicator: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    padding: '10px',
    borderTop: `1px solid ${theme.border}`,
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
    color: theme.textSecondary,
    cursor: 'pointer',
  },
  launchAtLoginCheckbox: {
    width: '12px',
    height: '12px',
    cursor: 'pointer',
    accentColor: theme.textSecondary,
  },
  launchAtLoginError: {
    fontSize: '10px',
    color: theme.textSecondary,
    marginTop: '4px',
    marginLeft: '18px',
  },
  launchAtLoginLink: {
    color: theme.info,
    cursor: 'pointer',
    textDecoration: 'underline',
  },
});
