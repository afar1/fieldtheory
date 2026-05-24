import { useTheme } from '../contexts/ThemeContext';
import { getNextMarkdownContentMode, type MarkdownContentMode } from '../utils/markdownContentMode';
import { FOCUS_TOOLBAR_BUTTON_WIDTH } from './ImmersiveToggle';

export type ContentModeToggleButtonMode = MarkdownContentMode;

interface ContentModeToggleButtonProps {
  mode: ContentModeToggleButtonMode;
  onSwitchToSource: () => void;
  onSwitchToRendered: () => void;
  onSwitchToTypedown?: () => void;
  disabled?: boolean;
  sourceLabel?: string;
  renderedLabel?: string;
  typedownEnabled?: boolean;
  typedownLabel?: string;
}

export default function ContentModeToggleButton({
  mode,
  onSwitchToSource,
  onSwitchToRendered,
  onSwitchToTypedown,
  disabled = false,
  sourceLabel = 'Switch to Markdown source',
  renderedLabel = 'Switch to rendered view',
  typedownEnabled = false,
  typedownLabel = 'Switch to Typedown',
}: ContentModeToggleButtonProps) {
  const { theme } = useTheme();
  const nextMode = getNextMarkdownContentMode(mode, { typedownEnabled });
  const label = disabled
    ? 'Source only'
    : nextMode === 'markdown'
      ? sourceLabel
      : nextMode === 'typedown'
        ? typedownLabel
        : renderedLabel;

  return (
    <button
      type="button"
      onClick={() => {
        if (disabled) return;
        if (nextMode === 'rendered') {
          onSwitchToRendered();
        } else if (nextMode === 'markdown') {
          onSwitchToSource();
        } else {
          onSwitchToTypedown?.();
        }
      }}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={mode !== 'rendered'}
      style={{
        width: `${FOCUS_TOOLBAR_BUTTON_WIDTH}px`,
        boxSizing: 'border-box',
        justifyContent: 'center',
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
      ) : mode === 'typedown' && !disabled ? (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 4h10" />
          <path d="M8 4v8" />
          <path d="M5.5 12h5" />
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
