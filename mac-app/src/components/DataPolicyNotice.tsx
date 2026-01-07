// =============================================================================
// DataPolicyNotice - Simple, contextual data privacy notice.
// Shows users where their data lives in plain, human language.
// =============================================================================

import { useState, useRef, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';

// Policy types for different views.
export type PolicyContext = 
  | 'local'        // Fields (clipboard history, recordings, screenshots)
  | 'shared'       // Shared Fields (team clipboard)
  | 'feedback'     // Feedback to Field Theory team
  | 'dm';          // Hot Mike (direct messages)

interface DataPolicyNoticeProps {
  context: PolicyContext;
  style?: React.CSSProperties;
}

// Policy messages - plain language, no legalese.
const POLICY_MESSAGES: Record<PolicyContext, { title: string; description: string }> = {
  local: {
    title: 'Stored locally',
    description: 'Everything here stays on your device. Field Theory\'s cloud has no access to your clipboard history, recordings, transcripts, or screenshots unless you explicitly share them.',
  },
  shared: {
    title: 'Shared with your team',
    description: 'Items here are stored in Field Theory\'s cloud and visible to everyone on your team. Anyone on the team can delete shared items.',
  },
  feedback: {
    title: 'Sent to Field Theory',
    description: 'Feedback you submit is sent to the Field Theory team. We use it to improve the product and may respond directly.',
  },
  dm: {
    title: 'Private to recipient',
    description: 'Messages here are only visible to you and the person you send them to. Either party can delete any message.',
  },
};

/**
 * DataPolicyNotice - An unobtrusive info widget showing data privacy context.
 * Displays a small info icon that expands to show the full message on hover/click.
 */
export default function DataPolicyNotice({ context, style }: DataPolicyNoticeProps) {
  const { theme } = useTheme();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const policy = POLICY_MESSAGES[context];

  // Clean up timeout on unmount.
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  // Show tooltip after brief hover delay.
  const handleMouseEnter = () => {
    setIsHovering(true);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setIsExpanded(true);
    }, 200);
  };

  // Hide tooltip when mouse leaves (with small delay to allow moving to tooltip).
  const handleMouseLeave = () => {
    setIsHovering(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setIsExpanded(false);
    }, 150);
  };

  // Toggle on click for touch devices.
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

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
      ref={containerRef}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        ...style,
      }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {/* Info icon with subtle background */}
      <button
        onClick={handleClick}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          padding: '3px 6px',
          fontSize: '9px',
          fontWeight: 500,
          color: getIconColor(),
          backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          outline: 'none',
          transition: 'background-color 0.15s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)';
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
        <span>{policy.title}</span>
      </button>

      {/* Tooltip popup */}
      {isExpanded && (
        <div
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: '6px',
            padding: '10px 12px',
            maxWidth: '280px',
            backgroundColor: theme.isDark ? '#1f1f1f' : '#fff',
            border: `1px solid ${theme.isDark ? '#404040' : '#e5e7eb'}`,
            borderRadius: '8px',
            boxShadow: theme.isDark 
              ? '0 4px 12px rgba(0,0,0,0.4)' 
              : '0 4px 12px rgba(0,0,0,0.1)',
            zIndex: 1000,
            animation: 'fadeIn 0.15s ease',
          }}
          onMouseEnter={() => {
            // Keep tooltip open when hovering over it.
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
            }
            setIsExpanded(true);
          }}
          onMouseLeave={handleMouseLeave}
        >
          {/* Title with icon */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            marginBottom: '6px',
          }}>
            <span style={{
              fontSize: '11px',
              fontWeight: 600,
              color: theme.text,
            }}>
              {policy.title}
            </span>
          </div>

          {/* Description */}
          <p style={{
            margin: 0,
            fontSize: '11px',
            lineHeight: 1.5,
            color: theme.textSecondary,
          }}>
            {policy.description}
          </p>

          {/* Arrow pointing down */}
          <div style={{
            position: 'absolute',
            bottom: '-6px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: `6px solid ${theme.isDark ? '#1f1f1f' : '#fff'}`,
          }} />
          {/* Arrow border */}
          <div style={{
            position: 'absolute',
            bottom: '-7px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 0,
            height: 0,
            borderLeft: '7px solid transparent',
            borderRight: '7px solid transparent',
            borderTop: `7px solid ${theme.isDark ? '#404040' : '#e5e7eb'}`,
            zIndex: -1,
          }} />
        </div>
      )}

      {/* CSS animation */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateX(-50%) translateY(4px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
    </div>
  );
}
