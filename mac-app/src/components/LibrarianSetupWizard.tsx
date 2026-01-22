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
  const [hookInstalled, setHookInstalled] = useState(false);
  const [hookInstalling, setHookInstalling] = useState(false);

  // Fetch initial data for platform phase
  useEffect(() => {
    if (phase === 'platform') {
      Promise.all([
        window.librarianAPI?.getClaudeCodeStatus(),
        window.librarianAPI?.isClaudeCodeHookInstalled(),
      ]).then(([status, hook]) => {
        if (status) setClaudeCodeStatus(status as 'installed' | 'directory-only' | 'not-installed');
        setHookInstalled(hook ?? false);
      });
    }
  }, [phase]);

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
        Ready to Go
      </h2>
      <p style={{
        fontSize: '13px',
        color: theme.textSecondary,
        marginBottom: '24px',
        textAlign: 'center',
        lineHeight: '1.6',
      }}>
        The Librarian works with your AI coding assistant to create contextual artifacts
        that connect your work to engineering history and systems theory.
      </p>

      {/* Status info */}
      <div
        style={{
          padding: '16px',
          borderRadius: '8px',
          backgroundColor: theme.isDark ? 'rgba(99, 102, 241, 0.15)' : 'rgba(99, 102, 241, 0.08)',
          border: `1px solid ${theme.accent}`,
          marginBottom: '24px',
        }}
      >
        <div style={{ fontSize: '13px', color: theme.text, lineHeight: '1.6' }}>
          {claudeCodeStatus === 'installed' ? (
            <>
              <strong>Claude Code detected.</strong> The Librarian will automatically
              integrate with your coding sessions.
            </>
          ) : claudeCodeStatus === 'directory-only' ? (
            <>
              <strong>Claude config found.</strong> Add a watched directory to start
              collecting artifacts.
            </>
          ) : (
            <>
              Works with <strong>Claude Code</strong> and <strong>Cursor</strong>.
              Add a watched directory to get started.
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
        <button
          onClick={() => setPhase('welcome')}
          style={secondaryButtonStyle}
        >
          Back
        </button>
        <button
          onClick={handleComplete}
          disabled={isProcessing}
          style={{
            ...primaryButtonStyle,
            opacity: isProcessing ? 0.5 : 1,
            cursor: isProcessing ? 'not-allowed' : 'pointer',
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
