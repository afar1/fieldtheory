import { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../contexts/ThemeContext';

interface DiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSendAsFeedback?: () => void;
}

/**
 * DiagnosticsModal displays system and app diagnostics for troubleshooting.
 * Users can copy the formatted output to share with support, or send directly as feedback.
 */
export default function DiagnosticsModal({ isOpen, onClose, onSendAsFeedback }: DiagnosticsModalProps) {
  const { theme } = useTheme();
  const [diagnosticsText, setDiagnosticsText] = useState<string>('Loading diagnostics...');
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  // Load diagnostics when modal opens.
  useEffect(() => {
    if (!isOpen) return;

    const loadDiagnostics = async () => {
      setIsLoading(true);
      setCopied(false);
      setSendError(null);
      setSent(false);
      try {
        const markdown = await window.diagnosticsAPI?.getDiagnosticsMarkdown();
        setDiagnosticsText(markdown || 'Failed to load diagnostics');
      } catch (error) {
        setDiagnosticsText(`Error loading diagnostics: ${error}`);
      } finally {
        setIsLoading(false);
      }
    };

    loadDiagnostics();
  }, [isOpen]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(diagnosticsText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }, [diagnosticsText]);

  // Send diagnostics as feedback, then navigate to feedback view.
  const handleSendAsFeedback = useCallback(async () => {
    if (!window.socialAPI?.submitTextFeedback) return;
    
    setSending(true);
    setSendError(null);
    try {
      const result = await window.socialAPI.submitTextFeedback(diagnosticsText);
      if (result) {
        setSent(true);
        // Brief pause to show success, then navigate to feedback.
        setTimeout(() => {
          onClose();
          onSendAsFeedback?.();
        }, 500);
      } else {
        setSendError('Could not send diagnostics. Sign in first, or copy the report instead.');
      }
    } catch (error) {
      console.error('Failed to send feedback:', error);
      setSendError('Could not send diagnostics. Copy the report instead.');
    } finally {
      setSending(false);
    }
  }, [diagnosticsText, onClose, onSendAsFeedback]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div style={styles.backdrop} onClick={handleBackdropClick}>
      <div style={{ ...styles.modal, backgroundColor: theme.bg, borderColor: theme.border }}>
        <div style={{ ...styles.header, borderBottomColor: theme.border }}>
          <h2 style={{ ...styles.title, color: theme.text }}>Diagnostics</h2>
          <button onClick={onClose} style={{ ...styles.closeButton, color: theme.textSecondary }}>
            ×
          </button>
        </div>
        
        <div style={styles.content}>
          <p style={{ ...styles.description, color: theme.textSecondary }}>
            Copy this information and share it when reporting an issue.
          </p>
          {sendError && (
            <p style={{ ...styles.description, color: theme.error, marginBottom: '12px' }}>
              {sendError}
            </p>
          )}
          
          <pre style={{ ...styles.diagnosticsBox, backgroundColor: theme.bgSecondary, borderColor: theme.border, color: theme.text }}>
            {isLoading ? 'Loading...' : diagnosticsText}
          </pre>
        </div>
        
        <div style={{ ...styles.footer, borderTopColor: theme.border }}>
          <button
            onClick={handleSendAsFeedback}
            disabled={isLoading || sending || sent}
            style={{
              ...styles.sendButton,
              backgroundColor: sent ? theme.success : theme.accent,
              opacity: isLoading || sending ? 0.5 : 1,
            }}
          >
            {sent ? 'Sent!' : sending ? 'Sending...' : 'Send as Feedback'}
          </button>
          <button
            onClick={handleCopy}
            disabled={isLoading}
            style={{
              ...styles.copyButton,
              borderColor: theme.border,
              color: theme.text,
              opacity: isLoading ? 0.5 : 1,
            }}
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>
          <button onClick={onClose} style={{ ...styles.closeButtonSecondary, borderColor: theme.border, color: theme.text }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    width: '90%',
    maxWidth: '600px',
    maxHeight: '80vh',
    borderRadius: '12px',
    border: '1px solid',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 20px',
    borderBottom: '1px solid',
  },
  title: {
    margin: 0,
    fontSize: '16px',
    fontWeight: 600,
  },
  closeButton: {
    background: 'none',
    border: 'none',
    fontSize: '24px',
    cursor: 'pointer',
    padding: '0 4px',
    lineHeight: 1,
  },
  content: {
    flex: 1,
    overflow: 'hidden',
    padding: '16px 20px',
    display: 'flex',
    flexDirection: 'column',
  },
  description: {
    margin: '0 0 12px 0',
    fontSize: '13px',
  },
  diagnosticsBox: {
    flex: 1,
    overflow: 'auto',
    padding: '12px',
    borderRadius: '8px',
    border: '1px solid',
    fontSize: '11px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    margin: 0,
    minHeight: '200px',
    maxHeight: '400px',
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: '12px',
    padding: '16px 20px',
    borderTop: '1px solid',
  },
  sendButton: {
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: 500,
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'background-color 0.15s',
  },
  copyButton: {
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: 500,
    backgroundColor: 'transparent',
    border: '1px solid',
    borderRadius: '6px',
    cursor: 'pointer',
    transition: 'background-color 0.15s',
  },
  cancelButton: {
    padding: '8px 16px',
    fontSize: '13px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
  },
  closeButtonSecondary: {
    padding: '8px 16px',
    fontSize: '13px',
    fontWeight: 500,
    backgroundColor: 'transparent',
    border: '1px solid',
    borderRadius: '6px',
    cursor: 'pointer',
  },
};
