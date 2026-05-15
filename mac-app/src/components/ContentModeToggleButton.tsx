import { useTheme } from '../contexts/ThemeContext';

export type ContentModeToggleButtonMode = 'rendered' | 'markdown';

interface ContentModeToggleButtonProps {
  mode: ContentModeToggleButtonMode;
  onSwitchToSource: () => void;
  onSwitchToRendered: () => void;
  disabled?: boolean;
  sourceLabel?: string;
  renderedLabel?: string;
}

export default function ContentModeToggleButton({
  mode,
  onSwitchToSource,
  onSwitchToRendered,
  disabled = false,
  sourceLabel = 'Switch to Markdown source',
  renderedLabel = 'Switch to rendered view',
}: ContentModeToggleButtonProps) {
  const { theme } = useTheme();
  const label = disabled ? 'Source only' : mode === 'markdown' ? renderedLabel : sourceLabel;

  return (
    <button
      type="button"
      onClick={() => {
        if (disabled) return;
        if (mode === 'markdown') {
          onSwitchToRendered();
        } else {
          onSwitchToSource();
        }
      }}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={mode === 'markdown'}
      style={{
        padding: '4px 8px',
        fontSize: '11px',
        color: theme.textSecondary,
        backgroundColor: 'transparent',
        border: `1px solid ${theme.border}`,
        borderRadius: '6px',
        cursor: disabled ? 'default' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        opacity: disabled ? 0.45 : 1,
        // @ts-ignore - toolbar controls should not be treated as a window drag region.
        WebkitAppRegion: 'no-drag',
      }}
      onMouseEnter={(event) => {
        if (!disabled) event.currentTarget.style.backgroundColor = theme.hoverBg;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      {mode === 'markdown' && !disabled ? (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2 4h12M2 8h12M2 12h8" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="5 4 2 8 5 12" />
          <polyline points="11 4 14 8 11 12" />
        </svg>
      )}
    </button>
  );
}
