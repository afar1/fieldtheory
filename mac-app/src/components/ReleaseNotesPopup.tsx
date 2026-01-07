/**
 * ReleaseNotesPopup - Shows a brief summary of what's new after an update.
 * Appears in the bottom-left corner after the app restarts from an update.
 */

import { useState, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';

// Release notes are embedded in the app. Update this with each release.
// Keep it brief: 1-4 bullet points highlighting the main changes.
const RELEASE_NOTES: Record<string, string[]> = {
  '0.1.31': [
    'Hot Mic messaging for real-time team communication',
    'Data policy notices showing where your data is stored',
    'Fixed auto-updater for prerelease versions',
  ],
  '0.1.30': [
    'Hot Mic tab with fire emoji toggle',
    'Authentication required for Hot Mic and Feedback',
    'Improved unread message indicators',
  ],
};

interface ReleaseNotesPopupProps {
  currentVersion: string;
  onDismiss: () => void;
}

export default function ReleaseNotesPopup({ currentVersion, onDismiss }: ReleaseNotesPopupProps) {
  const { theme } = useTheme();
  const [isVisible, setIsVisible] = useState(true);
  const [isClosing, setIsClosing] = useState(false);

  const notes = RELEASE_NOTES[currentVersion] || [];

  // If no notes for this version, don't show anything.
  if (notes.length === 0) {
    return null;
  }

  const handleDismiss = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsVisible(false);
      onDismiss();
    }, 200);
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '16px',
        left: '16px',
        width: '280px',
        backgroundColor: theme.isDark ? '#1a1a1a' : '#ffffff',
        border: `1px solid ${theme.border}`,
        borderRadius: '12px',
        boxShadow: theme.isDark 
          ? '0 8px 32px rgba(0,0,0,0.5)' 
          : '0 8px 32px rgba(0,0,0,0.15)',
        padding: '16px',
        zIndex: 10000,
        opacity: isClosing ? 0 : 1,
        transform: isClosing ? 'translateY(10px)' : 'translateY(0)',
        transition: 'opacity 0.2s ease, transform 0.2s ease',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Header with version and dismiss button */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '12px',
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <span style={{
            fontSize: '14px',
            fontWeight: 600,
            color: theme.text,
          }}>
            v{currentVersion}
          </span>
          <span style={{
            fontSize: '11px',
            color: theme.textSecondary,
            fontWeight: 400,
          }}>
            What's new
          </span>
        </div>
        <button
          onClick={handleDismiss}
          style={{
            background: 'none',
            border: 'none',
            padding: '4px',
            cursor: 'pointer',
            color: theme.textSecondary,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '4px',
            transition: 'background-color 0.1s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = theme.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          title="Dismiss"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Release notes list */}
      <ul style={{
        margin: 0,
        padding: 0,
        listStyle: 'none',
      }}>
        {notes.map((note, index) => (
          <li
            key={index}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              marginBottom: index < notes.length - 1 ? '8px' : 0,
              fontSize: '12px',
              color: theme.text,
              lineHeight: '1.4',
            }}
          >
            <span style={{
              color: theme.accent,
              flexShrink: 0,
              marginTop: '2px',
            }}>
              •
            </span>
            <span>{note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
