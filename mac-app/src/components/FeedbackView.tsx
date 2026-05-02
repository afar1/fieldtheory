import { useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';

const GITHUB_ISSUES_URL = 'https://github.com/afar1/field-releases/issues';
const SUPPORT_EMAIL = 'support@fieldtheory.dev';

interface FeedbackViewProps {
  onSwitchToClipboard?: () => void;
}

export default function FeedbackView({ onSwitchToClipboard }: FeedbackViewProps) {
  const { theme } = useTheme();

  const openExternal = (url: string) => {
    void window.shellAPI?.openExternal(url);
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
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: theme.bg,
        color: theme.text,
      }}
    >
      <div
        style={{
          padding: '18px 24px',
          borderBottom: `1px solid ${theme.border}`,
          backgroundColor: theme.bg,
        }}
      >
        <div
          style={{
            fontSize: '13px',
            fontWeight: 600,
            color: theme.text,
          }}
        >
          Feedback
        </div>
      </div>

      <div
        style={{
          flex: 1,
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
            }}
          >
            Add a GitHub issue or email{' '}
            <button
              type="button"
              onClick={() => openExternal(`mailto:${SUPPORT_EMAIL}`)}
              style={{
                padding: 0,
                fontSize: '13px',
                color: theme.accent,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              {SUPPORT_EMAIL}
            </button>
            .
          </div>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
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
              Open GitHub Issues
            </button>

            <button
              type="button"
              onClick={() => openExternal(`mailto:${SUPPORT_EMAIL}`)}
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
              Email Support
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
