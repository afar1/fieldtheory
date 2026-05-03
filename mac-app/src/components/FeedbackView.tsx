import { useEffect, useState } from 'react';
import { useTheme } from '../contexts/ThemeContext';

const GITHUB_ISSUES_URL = 'https://github.com/afar1/field-releases/issues';
const SUPPORT_EMAIL = 'support@fieldtheory.dev';
const X_PROFILE_URL = 'https://x.com/andrewfarah';

interface FeedbackViewProps {
  onSwitchToClipboard?: () => void;
}

export default function FeedbackView({ onSwitchToClipboard }: FeedbackViewProps) {
  const { theme } = useTheme();
  const [copiedEmail, setCopiedEmail] = useState(false);

  const openExternal = (url: string) => {
    void window.shellAPI?.openExternal(url);
  };

  const copySupportEmail = async () => {
    await navigator.clipboard.writeText(SUPPORT_EMAIL);
    setCopiedEmail(true);
    window.setTimeout(() => setCopiedEmail(false), 1600);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      event.preventDefault();
      if (onSwitchToClipboard) {
        onSwitchToClipboard();
      } else {
        window.clipboardAPI?.closeWindow();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSwitchToClipboard]);

  return (
    <div
      style={{
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        minHeight: 0,
        backgroundColor: theme.bg,
        color: theme.text,
        borderTop: `1px solid ${theme.border}`,
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: '520px',
            border: `1px solid ${theme.inputBorder}`,
            borderRadius: '8px',
            backgroundColor: theme.bgSecondary,
            padding: '22px',
          }}
        >
          <div
            style={{
              fontSize: '13px',
              lineHeight: 1.5,
              color: theme.textSecondary,
              marginBottom: '18px',
              textAlign: 'center',
            }}
          >
            Submit a github issue, email us at{' '}
            <span style={{ color: theme.accent }}>
              {SUPPORT_EMAIL}
            </span>,
            <br />
            or reach out to{' '}
            <a
              href={X_PROFILE_URL}
              onClick={(event) => {
                event.preventDefault();
                openExternal(X_PROFILE_URL);
              }}
              style={{
                color: theme.accent,
                textDecoration: 'underline',
                textUnderlineOffset: '2px',
              }}
            >
              @andrewfarah
            </a>
            {' '}on X.
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => openExternal(GITHUB_ISSUES_URL)}
              style={{
                padding: '8px 12px',
                fontSize: '12px',
                fontWeight: 500,
                color: '#fff',
                backgroundColor: theme.accent,
                border: 'none',
                borderRadius: '5px',
                cursor: 'pointer',
              }}
            >
              Github Issues
            </button>

            <button
              type="button"
              onClick={copySupportEmail}
              style={{
                padding: '8px 12px',
                fontSize: '12px',
                fontWeight: 500,
                color: theme.text,
                backgroundColor: 'transparent',
                border: `1px solid ${theme.inputBorder}`,
                borderRadius: '5px',
                cursor: 'pointer',
              }}
            >
              {copiedEmail ? 'Copied Email' : 'Copy Email'}
            </button>

            <button
              type="button"
              onClick={() => openExternal(X_PROFILE_URL)}
              style={{
                padding: '8px 12px',
                fontSize: '12px',
                fontWeight: 500,
                color: theme.text,
                backgroundColor: 'transparent',
                border: `1px solid ${theme.inputBorder}`,
                borderRadius: '5px',
                cursor: 'pointer',
              }}
            >
              X @andrewfarah
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
