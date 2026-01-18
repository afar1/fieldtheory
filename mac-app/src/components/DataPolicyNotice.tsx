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

// Policy messages - plain language, no legalese. Lowercase for visual consistency.
const POLICY_TITLES: Record<PolicyContext, string> = {
  local: 'data on page is stored locally',
  shared: 'data shared with your team',
  feedback: 'data sent to Field Theory',
  dm: 'data private to recipient',
};

/**
 * DataPolicyNotice - A simple badge showing data privacy context.
 * No overlay, just a clean info badge.
 */
export default function DataPolicyNotice({ context, style }: DataPolicyNoticeProps) {
  const { theme } = useTheme();
  const title = POLICY_TITLES[context];

  // Determine color based on context - subtle and unobtrusive
  const getTextColor = () => {
    switch (context) {
      case 'local':
        return theme.textSecondary; // Subtle muted text for local
      case 'shared':
        return theme.info; // Blue for shared
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
        padding: '3px 6px',
        fontSize: '9px',
        fontWeight: 400,
        fontStyle: 'italic',
        color: getTextColor(),
        backgroundColor: 'transparent',
        borderRadius: '4px',
        whiteSpace: 'nowrap',
        flexShrink: 0,
        ...style,
      }}
    >
      <span>{title}</span>
    </div>
  );
}
