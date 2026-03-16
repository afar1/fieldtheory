/**
 * LibrarianSetupWizard - First-time setup flow for Librarian feature.
 *
 * Phases:
 * 1. Welcome - Introduce Librarian concept
 * 2. Platforms - Connect Claude Code and/or Cursor
 * 3. Personalize - Discovery frequency + "About you"
 *
 * Directory is auto-created at ~/.librarian (no user choice needed).
 */

import { useState, useCallback, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';

interface LibrarianSetupWizardProps {
  onComplete: () => void;
}

type Phase = 'welcome' | 'platforms' | 'personalize';

export default function LibrarianSetupWizard({ onComplete }: LibrarianSetupWizardProps) {
  const { theme } = useTheme();

  const [phase, setPhase] = useState<Phase>('welcome');
  const [isProcessing, setIsProcessing] = useState(false);

  // Platform setup state
  const [claudeCodeStatus, setClaudeCodeStatus] = useState<'installed' | 'directory-only' | 'not-installed'>('not-installed');
  const [claudeHookInstalled, setClaudeHookInstalled] = useState(false);
  const [claudeHookInstalling, setClaudeHookInstalling] = useState(false);
  const [cursorHookInstalled, setCursorHookInstalled] = useState(false);
  const [cursorHookInstalling, setCursorHookInstalling] = useState(false);
  const [codexHookInstalled, setCodexHookInstalled] = useState(false);
  const [codexHookInstalling, setCodexHookInstalling] = useState(false);

  // Personalization state
  const [discoveryFrequency, setDiscoveryFrequency] = useState<'often' | 'sometimes' | 'rarely'>('sometimes');
  const [expertiseText, setExpertiseText] = useState('');

  // Fetch platform status when entering platforms phase
  useEffect(() => {
    if (phase === 'platforms') {
      Promise.all([
        window.librarianAPI?.getClaudeCodeStatus(),
        window.librarianAPI?.isStateEnforcedHookInstalled(),
        window.librarianAPI?.isCursorHookInstalled(),
        window.librarianAPI?.isCodexHookInstalled(),
      ]).then(([status, claudeHook, cursorHook, codexHook]) => {
        if (status) setClaudeCodeStatus(status as 'installed' | 'directory-only' | 'not-installed');
        setClaudeHookInstalled(claudeHook ?? false);
        setCursorHookInstalled(cursorHook ?? false);
        setCodexHookInstalled(codexHook ?? false);
      });
    }
  }, [phase]);

  // Load existing settings when entering personalize phase
  useEffect(() => {
    if (phase === 'personalize') {
      Promise.all([
        window.librarianAPI?.getDiscoveryFrequency(),
        window.librarianAPI?.getUserExpertiseContext(),
      ]).then(([freq, expertise]) => {
        if (freq) setDiscoveryFrequency(freq as 'often' | 'sometimes' | 'rarely');
        if (expertise) setExpertiseText(expertise);
      });
    }
  }, [phase]);

  // Handle Claude Code hook toggle
  const handleClaudeToggle = useCallback(async () => {
    setClaudeHookInstalling(true);
    try {
      if (claudeHookInstalled) {
        await window.librarianAPI?.uninstallStateEnforcedHook();
        setClaudeHookInstalled(false);
      } else {
        const success = await window.librarianAPI?.installStateEnforcedHook();
        setClaudeHookInstalled(success ?? false);
      }
    } finally {
      setClaudeHookInstalling(false);
    }
  }, [claudeHookInstalled]);

  // Handle Cursor hook toggle
  const handleCursorToggle = useCallback(async () => {
    setCursorHookInstalling(true);
    try {
      if (cursorHookInstalled) {
        await window.librarianAPI?.uninstallCursorHook();
        setCursorHookInstalled(false);
      } else {
        const success = await window.librarianAPI?.installCursorHook();
        setCursorHookInstalled(success ?? false);
      }
    } finally {
      setCursorHookInstalling(false);
    }
  }, [cursorHookInstalled]);

  // Handle Codex hook toggle
  const handleCodexToggle = useCallback(async () => {
    setCodexHookInstalling(true);
    try {
      if (codexHookInstalled) {
        await window.librarianAPI?.uninstallCodexHook();
        setCodexHookInstalled(false);
      } else {
        const success = await window.librarianAPI?.installCodexHook();
        setCodexHookInstalled(success ?? false);
      }
    } finally {
      setCodexHookInstalling(false);
    }
  }, [codexHookInstalled]);

  // Handle final completion
  const handleComplete = useCallback(async () => {
    setIsProcessing(true);
    try {
      // Save personalization settings
      await window.librarianAPI?.setDiscoveryFrequency(discoveryFrequency);
      if (expertiseText.trim()) {
        await window.librarianAPI?.setUserExpertiseContext(expertiseText.trim());
      }

      // Auto-create ~/.librarian and add as watched directory
      const result = await window.librarianAPI?.addWatchedDir('~/.librarian');
      if (result) {
        await window.librarianAPI?.createWelcomeArtifact(result.path);
      }

      // Enable Librarian and mark setup complete
      await window.librarianAPI?.setEnabled(true);
      await window.librarianAPI?.setSetupComplete(true);

      onComplete();
    } finally {
      setIsProcessing(false);
    }
  }, [onComplete, discoveryFrequency, expertiseText]);

  // Button styles
  const primaryButtonStyle = {
    padding: '12px 28px',
    fontSize: '14px',
    fontWeight: 500 as const,
    color: '#fff',
    backgroundColor: theme.accent,
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
  };

  const secondaryButtonStyle = {
    padding: '12px 28px',
    fontSize: '14px',
    fontWeight: 500 as const,
    color: theme.text,
    backgroundColor: 'transparent',
    border: `1px solid ${theme.border}`,
    borderRadius: '8px',
    cursor: 'pointer',
  };

  // Phase 1: Welcome
  const renderWelcome = () => (
    <div style={{ textAlign: 'center', maxWidth: '480px' }}>
      {/* Braille art */}
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
        marginBottom: '16px',
      }}>
        The Librarian
      </h2>

      <p style={{
        fontSize: '14px',
        color: theme.textSecondary,
        lineHeight: '1.7',
        marginBottom: '32px',
      }}>
        Engineering and physics have a rich history.
      </p>

      <button
        onClick={() => setPhase('platforms')}
        style={primaryButtonStyle}
      >
        Start
      </button>
    </div>
  );

  // Phase 2: Platforms
  const renderPlatforms = () => {
    const hasAnyPlatform = claudeCodeStatus !== 'not-installed' || true; // Cursor/Codex always available
    const hasConnection = claudeHookInstalled || cursorHookInstalled || codexHookInstalled;

    return (
      <div style={{ maxWidth: '480px', width: '100%' }}>
        <h2 style={{
          fontSize: '20px',
          fontWeight: 600,
          color: theme.text,
          marginBottom: '8px',
          textAlign: 'center',
        }}>
          Connect
        </h2>
        <p style={{
          fontSize: '13px',
          color: theme.textSecondary,
          marginBottom: '24px',
          textAlign: 'center',
          lineHeight: '1.6',
        }}>
          Use your tools to see how your work is connected.
        </p>

        {/* Platform cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
          {/* Claude Code */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              borderRadius: '8px',
              backgroundColor: theme.isDark ? theme.bgSecondary : '#f9fafb',
              border: `1px solid ${claudeHookInstalled ? theme.accent : theme.border}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '6px',
                backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '16px',
              }}>
                ⌘
              </div>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 500, color: theme.text }}>
                  Claude Code
                </div>
                <div style={{ fontSize: '11px', color: theme.textSecondary }}>
                  {claudeCodeStatus === 'not-installed' ? 'Not detected' :
                   claudeHookInstalled ? 'Connected' : 'Available'}
                </div>
              </div>
            </div>
            {claudeCodeStatus !== 'not-installed' && (
              <button
                onClick={handleClaudeToggle}
                disabled={claudeHookInstalling}
                style={{
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: 500,
                  color: claudeHookInstalled ? theme.textSecondary : '#fff',
                  backgroundColor: claudeHookInstalled ? 'transparent' : theme.accent,
                  border: claudeHookInstalled ? `1px solid ${theme.border}` : 'none',
                  borderRadius: '6px',
                  cursor: claudeHookInstalling ? 'wait' : 'pointer',
                  opacity: claudeHookInstalling ? 0.5 : 1,
                }}
              >
                {claudeHookInstalling ? '...' : claudeHookInstalled ? 'Disconnect' : 'Connect'}
              </button>
            )}
          </div>

          {/* Cursor */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              borderRadius: '8px',
              backgroundColor: theme.isDark ? theme.bgSecondary : '#f9fafb',
              border: `1px solid ${cursorHookInstalled ? theme.accent : theme.border}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '6px',
                backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
              }}>
                {'</>'}
              </div>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 500, color: theme.text }}>
                  Cursor
                </div>
                <div style={{ fontSize: '11px', color: theme.textSecondary }}>
                  {cursorHookInstalled ? 'Connected' : 'Available'}
                </div>
              </div>
            </div>
            <button
              onClick={handleCursorToggle}
              disabled={cursorHookInstalling}
              style={{
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 500,
                color: cursorHookInstalled ? theme.textSecondary : '#fff',
                backgroundColor: cursorHookInstalled ? 'transparent' : theme.accent,
                border: cursorHookInstalled ? `1px solid ${theme.border}` : 'none',
                borderRadius: '6px',
                cursor: cursorHookInstalling ? 'wait' : 'pointer',
                opacity: cursorHookInstalling ? 0.5 : 1,
              }}
            >
              {cursorHookInstalling ? '...' : cursorHookInstalled ? 'Disconnect' : 'Connect'}
            </button>
          </div>

          {/* Codex */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '14px 16px',
              borderRadius: '8px',
              backgroundColor: theme.isDark ? theme.bgSecondary : '#f9fafb',
              border: `1px solid ${codexHookInstalled ? theme.accent : theme.border}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '32px',
                height: '32px',
                borderRadius: '6px',
                backgroundColor: theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '14px',
                fontFamily: 'monospace',
              }}>
                {'cx'}
              </div>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 500, color: theme.text }}>
                  Codex
                </div>
                <div style={{ fontSize: '11px', color: theme.textSecondary }}>
                  {codexHookInstalled ? 'Connected' : 'Available'}
                </div>
              </div>
            </div>
            <button
              onClick={handleCodexToggle}
              disabled={codexHookInstalling}
              style={{
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 500,
                color: codexHookInstalled ? theme.textSecondary : '#fff',
                backgroundColor: codexHookInstalled ? 'transparent' : theme.accent,
                border: codexHookInstalled ? `1px solid ${theme.border}` : 'none',
                borderRadius: '6px',
                cursor: codexHookInstalling ? 'wait' : 'pointer',
                opacity: codexHookInstalling ? 0.5 : 1,
              }}
            >
              {codexHookInstalling ? '...' : codexHookInstalled ? 'Disconnect' : 'Connect'}
            </button>
          </div>
          <div style={{
            marginTop: '8px',
            padding: '0 4px',
            fontSize: '11px',
            lineHeight: 1.4,
            color: theme.textSecondary,
          }}>
            Connect once and Field Theory will configure Codex hooks automatically.
          </div>
        </div>

        {!hasConnection && (
          <p style={{
            fontSize: '12px',
            color: theme.warning,
            textAlign: 'center',
            marginBottom: '24px',
          }}>
            Connect at least one platform to enable Librarian
          </p>
        )}

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <button onClick={() => setPhase('welcome')} style={secondaryButtonStyle}>
            Back
          </button>
          <button
            onClick={() => setPhase('personalize')}
            disabled={!hasConnection}
            style={{
              ...primaryButtonStyle,
              opacity: hasConnection ? 1 : 0.5,
              cursor: hasConnection ? 'pointer' : 'not-allowed',
            }}
          >
            Continue
          </button>
        </div>
      </div>
    );
  };

  // Phase 3: Personalize
  const renderPersonalize = () => (
    <div style={{ maxWidth: '480px', width: '100%' }}>
      <h2 style={{
        fontSize: '20px',
        fontWeight: 600,
        color: theme.text,
        marginBottom: '8px',
        textAlign: 'center',
      }}>
        Make it yours
      </h2>
      <p style={{
        fontSize: '13px',
        color: theme.textSecondary,
        marginBottom: '24px',
        textAlign: 'center',
        lineHeight: '1.6',
      }}>
        These settings shape how often artifacts appear and what voice they take.
      </p>

      {/* Discovery frequency */}
      <div style={{ marginBottom: '24px' }}>
        <label style={{
          display: 'block',
          fontSize: '12px',
          fontWeight: 500,
          color: theme.text,
          marginBottom: '8px',
        }}>
          How often should artifacts appear?
        </label>
        <div style={{
          display: 'flex',
          gap: '0',
          borderRadius: '8px',
          overflow: 'hidden',
          border: `1px solid ${theme.border}`,
        }}>
          {(['often', 'sometimes', 'rarely'] as const).map((freq, i) => (
            <button
              key={freq}
              onClick={() => setDiscoveryFrequency(freq)}
              style={{
                flex: 1,
                padding: '10px 16px',
                fontSize: '13px',
                fontWeight: discoveryFrequency === freq ? 600 : 400,
                color: discoveryFrequency === freq ? '#fff' : theme.textSecondary,
                backgroundColor: discoveryFrequency === freq ? theme.accent : 'transparent',
                border: 'none',
                borderRight: i < 2 ? `1px solid ${theme.border}` : 'none',
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {freq}
            </button>
          ))}
        </div>
        <p style={{
          fontSize: '11px',
          color: theme.textSecondary,
          marginTop: '6px',
        }}>
          {discoveryFrequency === 'often' ? 'Every few prompts' :
           discoveryFrequency === 'sometimes' ? 'A few times per session' :
           'Once in a while'}
        </p>
      </div>

      {/* About you */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
          <label style={{
            fontSize: '12px',
            fontWeight: 500,
            color: theme.text,
          }}>
            About you <span style={{ fontWeight: 400, color: theme.textSecondary }}>(optional)</span>
          </label>
          <span style={{ fontSize: '11px', color: theme.textSecondary }}>
            {expertiseText.length}/400
          </span>
        </div>
        <textarea
          value={expertiseText}
          onChange={(e) => {
            if (e.target.value.length <= 400) {
              setExpertiseText(e.target.value);
            }
          }}
          placeholder="e.g., &quot;Senior engineer, prefer concise writing&quot; or &quot;Make it weird and philosophical&quot;"
          style={{
            width: '100%',
            minHeight: '80px',
            padding: '12px',
            fontSize: '13px',
            lineHeight: '1.5',
            backgroundColor: theme.isDark ? 'rgba(0,0,0,0.2)' : '#fff',
            border: `1px solid ${theme.border}`,
            borderRadius: '8px',
            color: theme.text,
            resize: 'vertical',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
        <p style={{
          fontSize: '11px',
          color: theme.textSecondary,
          marginTop: '6px',
        }}>
          The Librarian uses this to tune its voice and level of detail.
        </p>
      </div>

      {/* Note about About You impact */}
      <div style={{
        fontSize: '12px',
        color: theme.textSecondary,
        textAlign: 'center',
        marginBottom: '16px',
        padding: '12px',
        backgroundColor: theme.isDark ? 'rgba(99, 102, 241, 0.1)' : 'rgba(99, 102, 241, 0.05)',
        borderRadius: '8px',
        border: `1px solid ${theme.isDark ? 'rgba(99, 102, 241, 0.2)' : 'rgba(99, 102, 241, 0.15)'}`,
      }}>
        <strong style={{ color: theme.text }}>About You</strong> has a big impact on the Librarian's artifacts —
        it shapes tone, depth, and what gets noticed.
      </div>

      {/* Note about new session */}
      <p style={{
        fontSize: '11px',
        color: theme.textSecondary,
        textAlign: 'center',
        marginBottom: '24px',
        padding: '10px 12px',
        backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
        borderRadius: '8px',
      }}>
        Start a <strong style={{ color: theme.text }}>new Claude session</strong> after setup for changes to take effect.
        You can always adjust these in Settings → Librarian.
      </p>

      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
        <button onClick={() => setPhase('platforms')} style={secondaryButtonStyle}>
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

  const phases: Phase[] = ['welcome', 'platforms', 'personalize'];

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
        {phases.map((p, i) => (
          <div
            key={p}
            style={{
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: phases.indexOf(phase) >= i ? theme.accent :
                theme.isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.1)',
              opacity: phase === p ? 1 : 0.5,
            }}
          />
        ))}
      </div>

      {phase === 'welcome' && renderWelcome()}
      {phase === 'platforms' && renderPlatforms()}
      {phase === 'personalize' && renderPersonalize()}
    </div>
  );
}
