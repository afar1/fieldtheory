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
  '0.1.94': [
    '__SECTION__:Features',
    'Codex now works with Librarian in a simpler setup flow',
    'Artifacts have clearer titles and show which model wrote them',
    'Artifacts can open without pulling you out of the app you are using',
    'New users now get built-in commands like refactor, review, and commit',
    'Parakeet is now the recommended speech-to-text engine, with multilingual support',
    'Dynamic Island and Window Management settings are easier to tune',
    '__SECTION__:Fixes',
    'Fixed clipboard focus issues when closing, hiding, or clicking away',
    'Fixed clipboard history opening slower than expected',
    'Fixed screenshot stack behavior when left idle in Dynamic Island',
    'Fixed Dynamic Island layout issues across different display setups',
    'Fixed command keyboard handling issues in Portable Commands',
    'Fixed Codex and Cursor hook setup problems and shortened Codex block messages',
    'Fixed Parakeet installs failing silently and made reinstall status clearer',
    'Fixed several settings sync and visibility issues',
  ],
  '0.1.93': [
    'Dynamic Island pills now hidden from Mission Control and hot corners',
    'Fixed white background flash when clicking pills or using Super Paste',
    'Screenshots now stack idle — take multiple, then ⌘⇧V to paste all at once',
    'Focus voice command expands window to 80% height and centers it',
  ],
  '0.1.92': [
    'Refactored Dynamic Island: 4-slot layout with cancel button and waveform',
    'Command launcher now supports access to all window management shortcuts',
    'NVIDIA Parakeet now the primary voice-to-text model for Hot Mic and Standard',
    'Transcription button now submits Hot Mic content instead of discarding it',
    'Fixed a half dozen user-reported bugs',
  ],
  '0.1.91': [
    'Refactored Dynamic Island: 4-slot layout with cancel button and waveform',
    'Command launcher now supports access to all window management shortcuts',
    'NVIDIA Parakeet now the primary voice-to-text model for Hot Mic and Standard',
    'Transcription button now submits Hot Mic content instead of discarding it',
    'Fixed a half dozen user-reported bugs',
  ],
  '0.1.87': [
    'Improved login persistence across installs by hardening session restore paths',
    'Windows settings now include editable/clearable Squares keyboard shortcuts',
    'Separated window keyboard shortcuts from Hot Mic voice window commands',
  ],
  '0.1.86': [
    'Fixed startup crash on some downloaded builds caused by missing runtime updater module',
    'Packaging now blocks symlinked node_modules to prevent broken release artifacts',
  ],
  '0.1.85': [
    'Fixed startup crashes tied to invalid transcription hotkeys and diagnostics collection',
    'Improved Qwen reliability across sleep/wake and startup warmup paths',
    'Default transcription hotkey is now Option+/ and auto-improve starts disabled by default',
    'Reduced production log noise and fixed missing startup sound preload warnings',
  ],
  '0.1.84': [
    'Qwen setup now finds Homebrew python@3.12/3.13 even when python3 points to 3.14',
    'Added one-click "Copy error" for Qwen setup/transcription failures in Settings',
    'Improved Qwen compatibility guidance for faster recovery on new machines',
  ],
  '0.1.83': [
    'Qwen setup now avoids incompatible Python 3.14 environments',
    'Improved setup/runtime errors with clear Python 3.12 guidance',
    'Prevented repeated Qwen startup retry loops on fatal runtime failures',
  ],
  '0.1.82': [
    'Qwen setup now auto-rebuilds incompatible Python environments',
    'Fixed repeated Python crash loops when Qwen runtime is invalid in production',
    'Improved Qwen startup errors with clearer setup guidance',
  ],
  '0.1.81': [
    'Qwen3-ASR setup now works in packaged production builds',
    'Dynamic Island is fully hidden when Hot Mic is disabled',
    'Fixed right-pill visibility returning after re-enabling Hot Mic',
  ],
  '0.1.80': [
    'Hot Mic hamburger now toggles transcript history and closes on second click',
    'Transcript history opening is decoupled from Dynamic Island resizing',
    'Dynamic Island Geometry controls are now collapsible in Hot Mic settings',
  ],
  '0.1.79': [
    'Fixed transcription failure on M5 Macs running macOS Tahoe',
    'Fixed custom hotkeys reverting to defaults on startup',
  ],
  '0.1.77': [
    'Super paste detects SSH sessions and copies images to the remote machine',
    'Fixed ⌘⇧T shortcut conflict',
    'Fixed previous app detection for Electron-based apps like Superhuman',
  ],
  '0.1.76': [
    'Fixed ⌘⇧T shortcut conflict (no longer registers a global hotkey)',
  ],
  '0.1.75': [
    'Global session handoffs: access handoffs from any project via ⌘⇧K',
    'Handoffs show project path context (e.g., ↩ fieldtheory/mac-app · Feb 11)',
    'Type "handoff" in command launcher to see recent sessions across all projects',
  ],
  '0.1.74': [
    'New collecting mode: double-tap transcribe hotkey to silently capture without transcribing',
    'Share button to contribute your commands to the shared pool',
    'Renamed command tabs to "Internal" and "Shared"',
    'Commands tab now appears before Librarian in navigation',
  ],
  '0.1.71': [
    'Fixed footer layout shift when checking for updates',
  ],
  '0.1.70': [
    'Fixed clipboard not capturing consecutive text copies (e.g., JSON strings)',
  ],
  '0.1.69': [
    'Fixed Librarian sharing in production builds',
  ],
  '0.1.68': [
    'Fixed high CPU usage when images are on clipboard',
    'Fixed random logouts caused by refresh token race condition',
    'Fixed Command Launcher readability in light mode',
    'Improved empty state with keyboard shortcuts',
  ],
  '0.1.67': [
    'Fixed random logouts caused by refresh token race condition',
    'Fixed Command Launcher readability in light mode',
    'Improved empty state with keyboard shortcuts',
  ],
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
    'Fixed ⌘⇧V to paste all item types including paths',
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
    'Librarian: ⌘⌫ deletes readings, plus a toggle to hide the tab',
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
  '0.1.94': 'Mar 15 2026',
  '0.1.93': 'Mar 10 2026',
  '0.1.92': 'Mar 9 2026',
  '0.1.91': 'Mar 9 2026',
  '0.1.87': 'Feb 26 2026',
  '0.1.86': 'Feb 25 2026',
  '0.1.85': 'Feb 25 2026',
  '0.1.84': 'Feb 22 2026',
  '0.1.83': 'Feb 22 2026',
  '0.1.82': 'Feb 22 2026',
  '0.1.81': 'Feb 22 2026',
  '0.1.80': 'Feb 22 2026',
  '0.1.79': 'Feb 18 2026',
  '0.1.77': 'Feb 17 2026',
  '0.1.76': 'Feb 17 2026',
  '0.1.75': 'Feb 11 2026',
  '0.1.74': 'Feb 10 2026',
  '0.1.71': 'Feb 6 2026',
  '0.1.70': 'Feb 6 2026',
  '0.1.69': 'Feb 6 2026',
  '0.1.68': 'Feb 5 2026',
  '0.1.67': 'Feb 5 2026',
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

  const isSectionNote = (note: string) => note.startsWith('__SECTION__:');
  const getSectionTitle = (note: string) => note.replace('__SECTION__:', '');

  if (!isVisible) {
    return null;
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '40px',
        right: '8px',
        width: '340px',
        maxWidth: 'calc(100vw - 16px)',
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
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}
    >
      {/* Header with version and dismiss button */}
      <div style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: 0,
        flexShrink: 0,
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
      <div style={{
        maxHeight: '320px',
        overflowY: 'auto',
        paddingRight: '4px',
        marginRight: '-4px',
      }}>
        <ul style={{
          margin: 0,
          padding: 0,
          listStyle: 'none',
        }}>
          {notes.map((note, index) => (
            isSectionNote(note) ? (
              <li
                key={index}
                style={{
                  marginTop: index === 0 ? 0 : '12px',
                  marginBottom: '6px',
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: theme.textSecondary,
                }}
              >
                {getSectionTitle(note)}
              </li>
            ) : (
              <li
                key={index}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '8px',
                  marginBottom: index < notes.length - 1 ? '8px' : 0,
                  fontSize: '12px',
                  color: theme.text,
                  lineHeight: '1.45',
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
            )
          ))}
        </ul>
      </div>
    </div>
  );
}
