/**
 * ReleaseNotesPopup - Shows a brief summary of what's new after an update.
 * Appears in the bottom-left corner after the app restarts from an update.
 */

import { useState, useEffect } from 'react';
import { useTheme } from '../contexts/ThemeContext';

// Helper to check if release notes exist for a version
export function hasReleaseNotes(version: string): boolean {
  return version in RELEASE_NOTES && RELEASE_NOTES[version].length > 0;
}

// Release notes are embedded in the app. Update this with each release.
// Keep it brief: 1-4 bullet points highlighting the main changes.
const RELEASE_NOTES: Record<string, string[]> = {
  '0.1.66': [
    'Fixed random logouts caused by refresh token race condition',
    'Fixed Command Launcher readability in light mode',
    'Improved empty state with keyboard shortcuts',
  ],
  '0.1.65': [
    'Fixed random logouts caused by refresh token race condition',
    'Fixed Command Launcher readability in light mode',
    'Improved empty state with keyboard shortcuts',
  ],
  '0.1.64': [
    'Fixed onboarding shortcuts - hotkey configuration now works properly for new users',
    'Fixed popular commands display in Commands tab',
    'Removed unexpected todo tab from Tab key navigation',
  ],
  '0.1.63': [
    'Fixed daily logout bug - authentication no longer expires automatically',
    'Pro status now persists across app restarts',
  ],
  '0.1.62': [
    'Fixed priority microphone not persisting after app restart',
  ],
  '0.1.61': [
    'Fixed favorite microphone not persisting after restart',
    'Removed duplicate accessibility permission banner from Settings',
  ],
  '0.1.60': [
    'Favorite microphone: Set a preferred mic that auto-restores on startup',
    'Quota warning shows in footer at 85% usage',
    'Account deletion now removes local user data',
  ],
  '0.1.58': [
    'Stats now sync properly from cloud on startup',
    'Fixed bug where local data could overwrite cloud backups',
    'Unified metrics tracking to single source of truth',
  ],
  '0.1.57': [
    'Release notes now show automatically after updates',
    'Major refactoring: simplified auth and quota systems, removed 9k lines of unused code',
    'Fixed blank screen crash and tier sync issues',
    'Redesigned footer with cycling stats for Pro users',
  ],
  '0.1.56': [
    'Major refactoring: simplified auth and quota systems, removed 9k lines of unused code',
    'Fixed blank screen crash on Account page',
    'Fixed tier sync: footer now correctly shows Pro status',
    'Redesigned footer with cycling stats for Pro users',
  ],
  '0.1.55': [
    'Major refactoring: simplified auth and quota systems, removed 9k lines of unused code',
    'Fixed white rectangle artifacts on multi-monitor setups',
    'Fixed cursor overlay not hiding after recording',
    'Fixed startup hang caused by medium model loading',
    'Fixed draw tool auto-reopen behavior',
  ],
  '0.1.54': [
    'Major refactoring: simplified auth and quota systems, removed 9k lines of unused code',
    'Fixed white rectangle artifacts on multi-monitor setups',
    'Fixed cursor overlay not hiding after recording',
    'Fixed startup hang caused by medium model loading',
    'Fixed draw tool auto-reopen behavior',
  ],
  '0.1.53': [
    'Major cleanup: removed unused features (Local LLM, Team/Shared Clipboard, DMs)',
    'Simplified sound settings and cursor status labels',
    'Improved logging with structured logger utility',
  ],
  '0.1.51': [
    'Sound settings redesigned: Librarian sound on by default, quick toggles',
    'Librarian tab moved to secondary position for cleaner navigation',
    'Release notes toggle button in footer',
    'Fixed Cmd+Shift+V to paste all item types including paths',
  ],
  '0.1.50': [
    'Fixed Command Launcher paste in Claude Code',
    'Fixed spurious logouts from refresh token race condition',
    'Improved Claude session disconnect handling',
  ],
  '0.1.48': [
    'Librarian now supports serendipitous artifact creation',
    'Portable Commands: run markdown commands in any app (⌘⇧K)',
    'Stats: view your usage metrics in Settings',
  ],
  '0.1.47': [
    'Settings redesign with sidebar navigation',
    'Librarian: Cmd+Delete to delete readings, toggle to hide tab',
    'Fixed Settings dark mode colors',
  ],
  '0.1.46': [
    'Librarian: new reading collection accessible via book icon',
    'Dark mode with system-aware theme (Settings → Appearance)',
    'Sketch canvas and exports now respect light/dark mode',
  ],
  '0.1.45': [
    'No more keychain approval prompts',
    'Faster onboarding for returning users (skip shortcuts practice)',
    'Cleaner version hover UI',
  ],
  '0.1.44': [
    'Customizable hotkeys for Super Paste and Command Launcher in Settings',
    'Improved local LLM with 8K output tokens for longer transcripts',
    'Fixed screenshot hotkeys showing "Not set" incorrectly',
    'Fixed Super Paste double-trigger issue',
  ],
  '0.1.37': [
    'Fixed critical onboarding crash preventing first-run setup',
    'Fixed release notes button not opening',
    'Fixed update button showing wrong text when up to date',
    'Allow deleting last model and show proper "no model" state',
  ],
  '0.1.36': [
    'Fixed onboarding not showing on fresh install',
    'Fixed model status showing green before download',
    'Removed non-existent base model references',
    'Removed Message button from preview mode',
  ],
  '0.1.33': [
    'Renamed Commands to Popular Commands with admin delete controls',
    'Improved release notes popup with hover delay and positioning',
    'Fixed Settings page loading and TypeScript errors',
    'Version number shows "Check for updates" on hover',
  ],
  '0.1.32': [
    'Added full screen (⌘3) and active window (⌘⇧3) screenshot hotkeys',
    'Fixed inline [Figure X] references in transcripts with multiple screenshots',
    'Screenshots now use readable macOS-style filenames',
    'Paths shown as ~/field-theory/ for cleaner appearance',
  ],
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

// Release dates for each version (format: 'Jan 10 2026')
const RELEASE_DATES: Record<string, string> = {
  '0.1.66': 'Feb 5 2026',
  '0.1.65': 'Feb 5 2026',
  '0.1.64': 'Feb 4 2026',
  '0.1.63': 'Feb 3 2026',
  '0.1.62': 'Feb 3 2026',
  '0.1.61': 'Feb 3 2026',
  '0.1.60': 'Feb 3 2026',
  '0.1.58': 'Feb 2 2026',
  '0.1.57': 'Feb 2 2026',
  '0.1.56': 'Feb 2 2026',
  '0.1.55': 'Feb 2 2026',
  '0.1.54': 'Feb 2 2026',
  '0.1.53': 'Jan 30 2026',
  '0.1.51': 'Jan 29 2026',
  '0.1.50': 'Jan 28 2026',
  '0.1.48': 'Jan 19 2026',
  '0.1.47': 'Jan 18 2026',
  '0.1.46': 'Jan 17 2026',
  '0.1.45': 'Jan 15 2026',
  '0.1.44': 'Jan 15 2026',
  '0.1.37': 'Jan 11 2026',
  '0.1.36': 'Jan 11 2026',
  '0.1.33': 'Jan 10 2026',
  '0.1.32': 'Jan 10 2026',
  '0.1.31': 'Dec 15 2025',
  '0.1.30': 'Dec 1 2025',
};

interface ReleaseNotesPopupProps {
  currentVersion: string;
  onDismiss: () => void;
  // When true, shows "Latest" instead of "What's new" (for uptodate/hover cases).
  isLatestMode?: boolean;
}

export default function ReleaseNotesPopup({ currentVersion, onDismiss, isLatestMode = false }: ReleaseNotesPopupProps) {
  const { theme } = useTheme();
  const [isVisible, setIsVisible] = useState(true);
  const [isClosing, setIsClosing] = useState(false);

  const notes = RELEASE_NOTES[currentVersion] || [];
  const releaseDate = RELEASE_DATES[currentVersion] || '';

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
        bottom: '40px',
        right: '8px',
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
        transition: 'opacity 0.3s ease, transform 0.3s ease',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Header with version and dismiss button */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: '12px',
      }}>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '2px',
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
              color: isLatestMode ? theme.success : theme.textSecondary,
              fontWeight: 400,
            }}>
              {isLatestMode ? 'Latest' : "What's new"}
            </span>
          </div>
          {releaseDate && (
            <span style={{
              fontSize: '10px',
              color: theme.textSecondary,
              fontWeight: 400,
            }}>
              Released {releaseDate}
            </span>
          )}
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
