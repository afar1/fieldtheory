import { useCallback, useState, type CSSProperties } from 'react';
import type { Theme } from '../contexts/ThemeContext';
import type { ParakeetSetupProgress } from '../types/window';
import DiagnosticsModal from './DiagnosticsModal';

interface ParakeetSupportPanelProps {
  theme: Theme;
  title: string;
  summary?: string | null;
  recoveryMessage?: string | null;
  recoveryCommand?: string | null;
  detail?: string | null;
  progress?: ParakeetSetupProgress | null;
}

export default function ParakeetSupportPanel({
  theme,
  title,
  summary,
  recoveryMessage,
  recoveryCommand,
  detail,
  progress,
}: ParakeetSupportPanelProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [sendingDiagnostics, setSendingDiagnostics] = useState(false);
  const [diagnosticsSent, setDiagnosticsSent] = useState(false);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);

  const detailText = detail?.trim() || null;
  const commandText = recoveryCommand?.trim() || null;
  if (!summary && !progress) {
    return null;
  }

  const tone = summary
    ? {
        border: theme.isDark ? 'rgba(239, 68, 68, 0.35)' : '#fecaca',
        background: theme.isDark ? 'rgba(239, 68, 68, 0.08)' : '#fef2f2',
      }
    : {
        border: theme.isDark ? 'rgba(59, 130, 246, 0.35)' : '#bfdbfe',
        background: theme.isDark ? 'rgba(59, 130, 246, 0.1)' : '#eff6ff',
      };

  const handleCopyDetails = useCallback(async () => {
    if (!detailText) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(detailText);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = detailText;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (error) {
      console.error('Failed to copy Parakeet detail:', error);
    }
  }, [detailText]);

  const handleCopyCommand = useCallback(async () => {
    if (!commandText) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(commandText);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = commandText;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedCommand(true);
      window.setTimeout(() => setCopiedCommand(false), 1800);
    } catch (error) {
      console.error('Failed to copy Parakeet recovery command:', error);
    }
  }, [commandText]);

  const handleSendDiagnostics = useCallback(async () => {
    setSendingDiagnostics(true);
    setDiagnosticsError(null);
    setDiagnosticsSent(false);

    try {
      const diagnosticsText = await window.diagnosticsAPI?.getDiagnosticsMarkdown?.();
      if (!diagnosticsText?.trim()) {
        setDiagnosticsError('Diagnostics were not available. Open Diagnostics and copy the report instead.');
        return;
      }

      const result = await window.socialAPI?.submitTextFeedback?.(diagnosticsText);
      if (!result) {
        setDiagnosticsError('Could not send diagnostics. Sign in first, or copy the report from Diagnostics.');
        return;
      }

      setDiagnosticsSent(true);
    } catch (error) {
      console.error('Failed to send diagnostics:', error);
      setDiagnosticsError('Could not send diagnostics. Open Diagnostics and copy the report instead.');
    } finally {
      setSendingDiagnostics(false);
    }
  }, []);

  const progressPercent = progress?.percent != null
    ? Math.max(0, Math.min(100, progress.percent))
    : null;
  const progressDetail = progress?.detail?.trim() || null;

  return (
    <>
      <div
        style={{
          padding: '10px 12px',
          borderRadius: '6px',
          border: `1px solid ${tone.border}`,
          backgroundColor: tone.background,
          marginBottom: '4px',
        }}
      >
        {progress && (
          <div style={{ marginBottom: summary ? '10px' : 0 }}>
            <div style={{ fontSize: '12px', fontWeight: 500, color: theme.text, marginBottom: '4px' }}>
              {title}
            </div>
            <div style={{ fontSize: '11px', color: theme.textSecondary, lineHeight: 1.4 }}>
              {progress.message}
            </div>
            {progressPercent != null && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                <div
                  style={{
                    position: 'relative',
                    flex: 1,
                    height: '6px',
                    backgroundColor: theme.border,
                    borderRadius: '999px',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: `${progressPercent}%`,
                      backgroundColor: theme.info,
                      borderRadius: '999px',
                      transition: 'width 0.2s ease',
                    }}
                  />
                </div>
                <span style={{ fontSize: '11px', color: theme.textSecondary }}>
                  {Math.round(progressPercent)}%
                </span>
              </div>
            )}
            {progressDetail && (
              <div style={{ fontSize: '11px', color: theme.textSecondary, lineHeight: 1.4, marginTop: '6px' }}>
                {progressDetail}
              </div>
            )}
          </div>
        )}

        {summary && (
          <>
            <div style={{ fontSize: '12px', fontWeight: 500, color: theme.text, marginBottom: '4px' }}>
              {title}
            </div>
            <div style={{ fontSize: '11px', color: theme.textSecondary, lineHeight: 1.4 }}>
              {summary}
            </div>
            {recoveryMessage && (
              <div style={{ fontSize: '11px', color: theme.textSecondary, lineHeight: 1.4, marginTop: '6px' }}>
                {recoveryMessage}
              </div>
            )}
            {commandText && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginTop: '8px',
                }}
              >
                <code
                  style={{
                    flex: 1,
                    padding: '6px 8px',
                    borderRadius: '6px',
                    border: `1px solid ${theme.border}`,
                    backgroundColor: theme.isDark ? 'rgba(15, 23, 42, 0.5)' : '#fff',
                    color: theme.text,
                    fontSize: '11px',
                    lineHeight: 1.35,
                    userSelect: 'text',
                  }}
                >
                  {commandText}
                </code>
                <button
                  onClick={() => void handleCopyCommand()}
                  style={buttonStyle(theme)}
                >
                  {copiedCommand ? 'Copied' : 'Copy command'}
                </button>
              </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px' }}>
              {detailText && (
                <button
                  onClick={() => setShowDetails((current) => !current)}
                  style={buttonStyle(theme)}
                >
                  {showDetails ? 'Hide details' : 'Show details'}
                </button>
              )}
              {detailText && (
                <button
                  onClick={() => void handleCopyDetails()}
                  style={buttonStyle(theme)}
                >
                  {copied ? 'Copied' : 'Copy details'}
                </button>
              )}
              <button
                onClick={() => {
                  setShowDiagnostics(true);
                  setDiagnosticsError(null);
                }}
                style={buttonStyle(theme)}
              >
                Open diagnostics
              </button>
              <button
                onClick={() => void handleSendDiagnostics()}
                disabled={sendingDiagnostics}
                style={{
                  ...buttonStyle(theme),
                  opacity: sendingDiagnostics ? 0.6 : 1,
                }}
              >
                {diagnosticsSent ? 'Sent diagnostics' : sendingDiagnostics ? 'Sending diagnostics...' : 'Send diagnostics'}
              </button>
            </div>

            {diagnosticsError && (
              <div style={{ fontSize: '11px', color: theme.error, lineHeight: 1.4, marginTop: '8px' }}>
                {diagnosticsError}
              </div>
            )}

            {showDetails && detailText && (
              <pre
                style={{
                  margin: '10px 0 0 0',
                  padding: '10px',
                  borderRadius: '6px',
                  border: `1px solid ${theme.border}`,
                  backgroundColor: theme.isDark ? 'rgba(15, 23, 42, 0.5)' : '#fff',
                  color: theme.text,
                  fontSize: '11px',
                  lineHeight: 1.35,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  userSelect: 'text',
                }}
              >
                {detailText}
              </pre>
            )}
          </>
        )}
      </div>

      <DiagnosticsModal
        isOpen={showDiagnostics}
        onClose={() => setShowDiagnostics(false)}
      />
    </>
  );
}

function buttonStyle(theme: Theme): CSSProperties {
  return {
    padding: '5px 10px',
    fontSize: '11px',
    fontWeight: 500,
    color: theme.text,
    backgroundColor: theme.isDark ? theme.surface1 : '#fff',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
    cursor: 'pointer',
  };
}
