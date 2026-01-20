/**
 * LibrarianSetupWizard - First-time setup flow for Librarian feature.
 *
 * Phases:
 * 1. Welcome - Introduce Librarian concept
 * 2. Platform Setup - Configure Claude Code/Cursor integration + auto-complete
 *
 * Directory is auto-created at ~/.librarian (no user choice needed).
 */

import { useState, useCallback, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';

interface LibrarianSetupWizardProps {
  onComplete: () => void;
}

type Phase = 'welcome' | 'platform';

export default function LibrarianSetupWizard({ onComplete }: LibrarianSetupWizardProps) {
  const { theme } = useTheme();

  const [phase, setPhase] = useState<Phase>('welcome');
  const [isProcessing, setIsProcessing] = useState(false);

  // Platform setup state
  const [claudeCodeStatus, setClaudeCodeStatus] = useState<'installed' | 'directory-only' | 'not-installed'>('installed');
  const [triggerMode, setTriggerMode] = useState<'prompt' | 'judgment'>('judgment'); // Default to judgment
  const [hookInstalled, setHookInstalled] = useState(false);
  const [hookInstalling, setHookInstalling] = useState(false);

  // Fetch initial data for platform phase
  useEffect(() => {
    if (phase === 'platform') {
      Promise.all([
        window.librarianAPI?.getClaudeCodeStatus(),
        window.librarianAPI?.getTriggerMode(),
        window.librarianAPI?.isClaudeCodeHookInstalled(),
      ]).then(([status, mode, hook]) => {
        if (status) setClaudeCodeStatus(status as 'installed' | 'directory-only' | 'not-installed');
        if (mode) setTriggerMode(mode as 'prompt' | 'judgment');
        setHookInstalled(hook ?? false);
      });
    }
  }, [phase]);

  // Handle trigger mode change
  const handleTriggerModeChange = useCallback(async (mode: 'prompt' | 'judgment') => {
    setTriggerMode(mode);
    await window.librarianAPI?.setTriggerMode(mode);
    // Also enable Librarian
    await window.librarianAPI?.setEnabled(true);
  }, []);

  // Handle hook installation
  const handleInstallHook = useCallback(async () => {
    setHookInstalling(true);
    try {
      const success = await window.librarianAPI?.installClaudeCodeHook();
      if (success) setHookInstalled(true);
    } finally {
      setHookInstalling(false);
    }
  }, []);

  // Handle final completion - auto-creates ~/.librarian
  const handleComplete = useCallback(async () => {
    setIsProcessing(true);
    try {
      // Auto-create ~/.librarian and add as watched directory
      const result = await window.librarianAPI?.addWatchedDir('~/.librarian');

      if (result) {
        // Create welcome artifact in the new directory
        await window.librarianAPI?.createWelcomeArtifact(result.path);
      }

      // Ensure Librarian is enabled and files are synced
      // (This writes CLAUDE.md + command file even if user didn't change trigger mode)
      await window.librarianAPI?.setEnabled(true);

      // Mark setup as complete
      await window.librarianAPI?.setSetupComplete(true);

      // Notify parent
      onComplete();
    } finally {
      setIsProcessing(false);
    }
  }, [onComplete]);

  // Common button style
  const primaryButtonStyle = {
    padding: '10px 24px',
    fontSize: '14px',
    fontWeight: 500 as const,
    color: '#fff',
    backgroundColor: theme.accent,
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
  };

  const secondaryButtonStyle = {
    padding: '10px 24px',
    fontSize: '14px',
    fontWeight: 500 as const,
    color: theme.text,
    backgroundColor: 'transparent',
    border: `1px solid ${theme.border}`,
    borderRadius: '8px',
    cursor: 'pointer',
  };

  // Render Welcome phase
  const renderWelcome = () => (
    <div style={{ textAlign: 'center', maxWidth: '500px' }}>
      {/* Braille art preview */}
      <pre
        style={{
          fontFamily: 'monospace',
          fontSize: '8px',
          lineHeight: '1.1',
          color: theme.text,
          marginBottom: '24px',
          userSelect: 'none',
        }}
      >
{`⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣤⣴⣶⣶⣶⣦⣤⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣴⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣦⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣄⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣿⣿⣿⣿⣿⣿⣿⡿⠿⠿⠿⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⡀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⢀⣾⣿⣿⣿⣿⣿⡿⠋⠁⠀⠀⠀⠀⠀⠀⠈⠙⢿⣿⣿⣿⣿⣿⣿⣷⡀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⣾⣿⣿⣿⣿⣿⠏⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠹⣿⣿⣿⣿⣿⣿⣷⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⡏⠀⠀⠀⠀⢀⣀⣀⣀⠀⠀⠀⠀⠀⠀⢻⣿⣿⣿⣿⣿⣿⡇⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⣿⣿⣿⣿⣿⣿⠁⠀⠀⠀⣴⣿⣿⣿⣿⣷⡄⠀⠀⠀⠀⠈⣿⣿⣿⣿⣿⣿⣿⠀⠀⠀`}
      </pre>

      <h2 style={{
        fontSize: '24px',
        fontWeight: 600,
        color: theme.text,
        marginBottom: '12px'
      }}>
        Welcome to Librarian
      </h2>

      <p style={{
        fontSize: '14px',
        color: theme.textSecondary,
        lineHeight: '1.6',
        marginBottom: '32px'
      }}>
        Librarian connects your coding sessions to the deeper history of engineering thought.
        Each artifact captures not just what you're building, but why it matters—drawing threads
        to physics, systems theory, and the accumulated wisdom of those who built before us.
      </p>

      <button
        onClick={() => setPhase('platform')}
        style={primaryButtonStyle}
      >
        Get Started
      </button>
    </div>
  );

  // Render Platform phase
  const renderPlatform = () => (
    <div style={{ maxWidth: '500px', width: '100%' }}>
      <h2 style={{
        fontSize: '20px',
        fontWeight: 600,
        color: theme.text,
        marginBottom: '8px',
        textAlign: 'center',
      }}>
        Platform Setup
      </h2>
      <p style={{
        fontSize: '13px',
        color: theme.textSecondary,
        marginBottom: '24px',
        textAlign: 'center',
      }}>
        Choose how Librarian should remind your AI to create artifacts
      </p>

      {/* Trigger mode selection */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              cursor: 'pointer',
              padding: '16px',
              borderRadius: '8px',
              backgroundColor: triggerMode === 'judgment'
                ? (theme.isDark ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.08)')
                : (theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)'),
              border: `1px solid ${triggerMode === 'judgment' ? theme.accent : 'transparent'}`,
            }}
          >
            <input
              type="radio"
              name="triggerMode"
              value="judgment"
              checked={triggerMode === 'judgment'}
              onChange={() => handleTriggerModeChange('judgment')}
              style={{ marginTop: '4px', accentColor: theme.accent }}
            />
            <div>
              <div style={{ fontSize: '14px', fontWeight: 500, color: theme.text, marginBottom: '4px' }}>
                AI judgment (Recommended)
              </div>
              <div style={{ fontSize: '12px', color: theme.textSecondary, lineHeight: '1.5' }}>
                Let your AI decide when to create artifacts based on work volume.
                Works with Claude Code and Cursor with no extra setup.
              </div>
            </div>
          </label>

          <label
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '12px',
              cursor: 'pointer',
              padding: '16px',
              borderRadius: '8px',
              backgroundColor: triggerMode === 'prompt'
                ? (theme.isDark ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.08)')
                : (theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)'),
              border: `1px solid ${triggerMode === 'prompt' ? theme.accent : 'transparent'}`,
            }}
          >
            <input
              type="radio"
              name="triggerMode"
              value="prompt"
              checked={triggerMode === 'prompt'}
              onChange={() => handleTriggerModeChange('prompt')}
              style={{ marginTop: '4px', accentColor: theme.accent }}
            />
            <div>
              <div style={{ fontSize: '14px', fontWeight: 500, color: theme.text, marginBottom: '4px' }}>
                Prompt count
              </div>
              <div style={{ fontSize: '12px', color: theme.textSecondary, lineHeight: '1.5' }}>
                Remind after a set number of prompts. Requires Claude Code hook installation.
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Hook installation for prompt mode */}
      {triggerMode === 'prompt' && claudeCodeStatus !== 'not-installed' && (
        <div
          style={{
            padding: '16px',
            borderRadius: '8px',
            backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
            marginBottom: '24px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: '13px', fontWeight: 500, color: theme.text }}>
                Claude Code Hook
              </div>
              <div style={{ fontSize: '12px', color: theme.textSecondary }}>
                {hookInstalled ? 'Connected and tracking prompts' : 'Required for prompt counting'}
              </div>
            </div>
            {!hookInstalled && (
              <button
                onClick={handleInstallHook}
                disabled={hookInstalling}
                style={{
                  ...primaryButtonStyle,
                  padding: '8px 16px',
                  fontSize: '12px',
                  opacity: hookInstalling ? 0.6 : 1,
                }}
              >
                {hookInstalling ? 'Installing...' : 'Install'}
              </button>
            )}
            {hookInstalled && (
              <span style={{
                fontSize: '12px',
                color: theme.success,
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>
                </svg>
                Connected
              </span>
            )}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
        <button
          onClick={() => setPhase('welcome')}
          style={secondaryButtonStyle}
        >
          Back
        </button>
        <button
          onClick={handleComplete}
          disabled={isProcessing || (triggerMode === 'prompt' && !hookInstalled && claudeCodeStatus !== 'not-installed')}
          style={{
            ...primaryButtonStyle,
            opacity: (isProcessing || (triggerMode === 'prompt' && !hookInstalled && claudeCodeStatus !== 'not-installed')) ? 0.5 : 1,
            cursor: (isProcessing || (triggerMode === 'prompt' && !hookInstalled && claudeCodeStatus !== 'not-installed')) ? 'not-allowed' : 'pointer',
          }}
        >
          {isProcessing ? 'Setting up...' : 'Complete Setup'}
        </button>
      </div>
    </div>
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: '32px',
        backgroundColor: theme.bg,
      }}
    >
      {/* Progress indicator */}
      <div style={{
        display: 'flex',
        gap: '8px',
        marginBottom: '32px',
      }}>
        {['welcome', 'platform'].map((p, i) => (
          <div
            key={p}
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor:
                phase === p ? theme.accent :
                ['welcome', 'platform'].indexOf(phase) > i ? theme.accent :
                theme.isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)',
              opacity: phase === p ? 1 : 0.5,
            }}
          />
        ))}
      </div>

      {phase === 'welcome' && renderWelcome()}
      {phase === 'platform' && renderPlatform()}
    </div>
  );
}
