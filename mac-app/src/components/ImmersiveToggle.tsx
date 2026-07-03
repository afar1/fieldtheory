import { useTheme } from '../contexts/ThemeContext';

export const FOCUS_TOOLBAR_BUTTON_WIDTH = 30;

interface ImmersiveToggleProps {
  isFullScreen: boolean;
  onToggle: () => void;
  /** Optional tooltip override. */
  title?: string;
}

/**
 * Standardized immersive-mode toggle. Used in the top-right of each view's
 * toolbar (bookmarks, library artifact reading, etc.) so the control looks
 * and sits in the same place everywhere.
 */
export default function ImmersiveToggle({ isFullScreen, onToggle, title }: ImmersiveToggleProps) {
  const { theme } = useTheme();
  return (
    <button
      type="button"
      onClick={onToggle}
      title={title ?? (isFullScreen ? 'Exit immersive view' : 'Enter immersive view')}
      aria-label={isFullScreen ? 'Exit immersive view' : 'Enter immersive view'}
      style={{
        height: `${FOCUS_TOOLBAR_BUTTON_WIDTH}px`,
        width: `${FOCUS_TOOLBAR_BUTTON_WIDTH}px`,
        boxSizing: 'border-box',
        justifyContent: 'center',
        padding: 0,
        fontSize: '11px',
        color: theme.textSecondary,
        backgroundColor: 'transparent',
        border: `1px solid ${theme.border}`,
        borderRadius: '5px',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        // @ts-ignore - toolbar controls should not be treated as a window drag region.
        WebkitAppRegion: 'no-drag',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = theme.hoverBg)}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
    >
      {isFullScreen ? (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M10 2v4h4M2 10h4v4M14 6h-3V3M6 14v-3H3" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3" />
        </svg>
      )}
    </button>
  );
}
