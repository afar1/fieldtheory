// =============================================================================
// DataPolicyNotice - Simple, contextual data privacy notice.
// Shows users where their data lives in plain, human language.
// =============================================================================

import { useTheme } from '../contexts/ThemeContext';

// Policy types for different views.
export type PolicyContext = 
  | 'local'        // Fields (clipboard history, recordings, screenshots)
  | 'shared'       // Shared Fields (team clipboard)
  | 'feedback'     // Feedback to Field Theory team
  | 'dm';          // Hot Mic (direct messages)

interface DataPolicyNoticeProps {
  context: PolicyContext;
  style?: React.CSSProperties;
}

// Policy messages - plain language, no legalese.
const POLICY_TITLES: Record<PolicyContext, string> = {
  local: 'Data stored locally',
  shared: 'Data shared with your team',
  feedback: 'Data sent to Field Theory',
  dm: 'Data private to recipient',
};

/**
 * DataPolicyNotice - A simple badge showing data privacy context.
 * No overlay, just a clean info badge.
 */
export default function DataPolicyNotice({ context, style }: DataPolicyNoticeProps) {
  const { theme } = useTheme();
  const title = POLICY_TITLES[context];

  // Determine icon color based on context.
  const getIconColor = () => {
    switch (context) {
      case 'local':
        return theme.isDark ? '#10b981' : '#059669'; // Green for local/private
      case 'shared':
        return theme.isDark ? '#3b82f6' : '#2563eb'; // Blue for shared
      case 'feedback':
        return theme.isDark ? '#f59e0b' : '#d97706'; // Amber for feedback
      case 'dm':
        return theme.isDark ? '#a855f7' : '#9333ea'; // Purple for DMs
      default:
        return theme.textSecondary;
    }
  };

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '3px 6px',
        fontSize: '9px',
        fontWeight: 500,
        color: getIconColor(),
        backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
        borderRadius: '4px',
        ...style,
      }}
    >
      {/* Info circle icon */}
      <svg 
        width="10" 
        height="10" 
        viewBox="0 0 16 16" 
        fill="currentColor"
        style={{ flexShrink: 0 }}
      >
        <path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm.93 4.588l-.002.015c-.042.3-.228.553-.488.703a.888.888 0 0 1-.673.092.888.888 0 0 1-.573-.407.888.888 0 0 1-.108-.69c.055-.25.194-.467.396-.615a.888.888 0 0 1 .955-.074c.28.146.48.408.52.712l-.027.264zm-.413 9.97c-.256 0-.507-.08-.717-.23a1.236 1.236 0 0 1-.467-.62 1.236 1.236 0 0 1 .066-.773L8.58 9.614l-.71.042c-.259.014-.513-.066-.712-.224a1.12 1.12 0 0 1-.387-.556 1.12 1.12 0 0 1 .022-.681c.077-.218.22-.404.41-.533l.953-.633c.192-.127.419-.197.654-.197.235 0 .462.07.654.197l.002.001c.19.13.334.316.41.534.077.218.088.45.03.677l-1.15 3.317c-.08.23-.02.482.154.65.174.168.427.23.66.159l.726-.213c.257-.076.53-.04.76.099.23.139.39.362.445.617.055.255.003.518-.148.728a1.12 1.12 0 0 1-.599.433l-1.917.564c-.134.04-.274.06-.414.06z"/>
      </svg>
      <span>{title}</span>
    </div>
  );
}
