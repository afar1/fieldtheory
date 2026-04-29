// =============================================================================
// SettingsPanel - Consolidated settings UI for the clipboard history window.
// Shows audio, transcription, and clipboard settings in one view.
// Styled consistently with the clipboard history window's design language.
// =============================================================================

import { useEffect, useState, useCallback } from 'react';
import AudioSettingsPanel from './AudioSettingsPanel';
import TranscriptionSettings from './TranscriptionSettings';
import SoundsSettings from './SoundsSettings';
import HotMicSettings from './HotMicSettings';
import RectangleSettings from './RectangleSettings';
import DiagnosticsModal from './DiagnosticsModal';
import CommandsSettings from './CommandsSettings';
import ClaudeSettings from './ClaudeSettings';
import LibrarianSettings from './LibrarianSettings';
import UserStatsPanel from './UserStatsPanel';
import { supabase } from '../supabaseClient';
import { useTheme, Theme } from '../contexts/ThemeContext';
import { accentPresets, AccentPreset } from '../design/tokens';
import { buildHotkeyString, isModifierOnly } from '../utils/hotkeys';
import { normalizeSquaresConfig } from '../utils/squaresConfig';
import { getSettingsSurfaceStyle } from './settings/SettingsPrimitives';
import { useAuthSessionBridge } from '../hooks/useAuthSessionBridge';

// Settings sections in alphabetical order
type SettingsSection =
  | 'account'
  | 'appearance'
  | 'audio'
  | 'keyboard'
  | 'librarian'
  | 'commands'
  | 'sounds'
  | 'stats'
  | 'terminal-commands'
  | 'hot-mic'
  | 'rectangle';

type FieldTheoryWindowMode = 'panel' | 'app';

// Hotkey capture state - only one hotkey can be captured at a time
type HotkeyCapture =
  | 'screenshot'
  | 'history'
  | 'fullScreen'
  | 'activeWindow'
  | 'continuousContext'
  | 'todo'
  | 'transcription'
  | 'secondaryTranscription'
  | 'abandon'
  | 'superPaste'
  | 'commandLauncher'
  | 'scratchpad'
  | 'hotMic'
  | null;

const SECTION_LABELS: Record<SettingsSection, string> = {
  'account': 'Account',
  'appearance': 'Appearance & System',
  'audio': 'Audio & Transcription',
  'keyboard': 'Keyboard Shortcuts',
  'librarian': 'Librarian',
  'commands': 'Portable Commands',
  'sounds': 'Sounds',
  'stats': 'Stats',
  'terminal-commands': 'Allowlist',
  'hot-mic': 'Hot Mic',
  'rectangle': 'Window Management',
};

// Alphabetically ordered sections for navigation
const SECTIONS_ORDER: SettingsSection[] = [
  'account',
  'terminal-commands', // Allowlist
  'appearance',
  'audio',
  'hot-mic', // Hot Mic
  'keyboard',
  'librarian',
  'commands', // Portable Commands
  'sounds',
  'stats',
  'rectangle', // Window Management
];

interface SettingsPanelProps {
  onNavigateToSignIn?: () => void;
  onNavigateToFeedback?: () => void;
  librarianEnabled?: boolean;
  onLibrarianEnabledChange?: (enabled: boolean) => void;
  onPerformanceHudEnabledChange?: (enabled: boolean) => void;
  initialSection?: SettingsSection;
}

// =============================================================================
// Island Geometry Sliders — self-contained, renders in the Appearance section.
// =============================================================================

interface IslandGeometrySettings {
  notchWidthOverride: number;
  pillWidth: number;
  pillHeight: number;
  offsetX: number;
  offsetY: number;
}

const DEFAULT_ISLAND_GEOMETRY: IslandGeometrySettings = {
  notchWidthOverride: 0,
  pillWidth: 0,
  pillHeight: 0,
  offsetX: 0,
  offsetY: 0,
};

const ISLAND_GEOMETRY_LIMITS = {
  notchWidthOverride: { min: 0, max: 320, step: 1 },
  pillWidth: { min: 0, max: 120, step: 1 },
  pillHeight: { min: 0, max: 120, step: 1 },
  offsetX: { min: -240, max: 240, step: 1 },
  offsetY: { min: -160, max: 160, step: 1 },
} as const;

const ISLAND_GEOMETRY_FIELDS: Array<{ key: keyof IslandGeometrySettings; label: string; help: string }> = [
  { key: 'notchWidthOverride', label: 'Notch Width', help: '0 = auto' },
  { key: 'pillWidth', label: 'Pill Width', help: '0 = auto' },
  { key: 'pillHeight', label: 'Pill Height', help: '0 = auto' },
  { key: 'offsetX', label: 'Horizontal Offset', help: '' },
  { key: 'offsetY', label: 'Vertical Offset', help: '' },
];

function clampGeometry(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

interface ResolvedGeometry extends IslandGeometrySettings {
  _detected?: { modeWidth: number; scaleFactor: number; menuBarHeight: number; isInternal: boolean };
}

function IslandGeometrySliders({ theme }: { theme: Theme }) {
  const [geometry, setGeometry] = useState<IslandGeometrySettings>(DEFAULT_ISLAND_GEOMETRY);
  const [resolved, setResolved] = useState<ResolvedGeometry | null>(null);
  const [stayOnLaptop, setStayOnLaptop] = useState(false);

  useEffect(() => {
    window.hotMicAPI?.getIslandGeometry?.().then((g) => {
      if (g) setGeometry(g);
    }).catch(() => {});
    window.hotMicAPI?.getResolvedIslandGeometry?.().then((r: ResolvedGeometry | null) => {
      if (r) setResolved(r);
    }).catch(() => {});
    window.hotMicAPI?.getIslandStayOnLaptop?.().then((v) => {
      setStayOnLaptop(v);
    }).catch(() => {});
  }, []);

  const isAllAuto = geometry.notchWidthOverride === 0 && geometry.pillWidth === 0 && geometry.pillHeight === 0
    && geometry.offsetX === 0 && geometry.offsetY === 0;

  const handleChange = useCallback((key: keyof IslandGeometrySettings, value: number) => {
    const limits = ISLAND_GEOMETRY_LIMITS[key];
    const normalized = clampGeometry(value, limits.min, limits.max);
    setGeometry((prev) => ({ ...prev, [key]: normalized }));
    void window.hotMicAPI?.setIslandGeometry({ [key]: normalized });
  }, []);

  const handleAuto = useCallback(async () => {
    if (!window.hotMicAPI) return;
    const reset = await window.hotMicAPI.resetIslandGeometry();
    setGeometry(reset ?? DEFAULT_ISLAND_GEOMETRY);
    const r = await window.hotMicAPI.getResolvedIslandGeometry?.();
    if (r) setResolved(r);
  }, []);

  const formatValue = (key: keyof IslandGeometrySettings, val: number): string => {
    const field = ISLAND_GEOMETRY_FIELDS.find((f) => f.key === key);
    if (val === 0 && field?.help) {
      return resolved ? `auto (${resolved[key]})` : 'auto';
    }
    return String(val);
  };

  const btnStyle = (active: boolean) => ({
    padding: '4px 10px',
    fontSize: '11px',
    color: active ? theme.text : theme.textSecondary,
    backgroundColor: active ? (theme.isDark ? theme.surface1 : '#fff') : 'transparent',
    border: `1px solid ${active ? theme.border : 'transparent'}`,
    borderRadius: '4px',
    cursor: active ? 'default' as const : 'pointer' as const,
    opacity: active ? 1 : 0.7,
  });

  const displayValues = isAllAuto && resolved
    ? { ...resolved, _detected: undefined } as IslandGeometrySettings
    : geometry;

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
        <button onClick={() => void handleAuto()} style={btnStyle(isAllAuto)}>
          Auto
        </button>
        <button
          onClick={() => {
            if (isAllAuto && resolved) {
              const custom: IslandGeometrySettings = {
                notchWidthOverride: resolved.notchWidthOverride,
                pillWidth: resolved.pillWidth,
                pillHeight: resolved.pillHeight,
                offsetX: 0,
                offsetY: 0,
              };
              setGeometry(custom);
              void window.hotMicAPI?.setIslandGeometry(custom);
            }
          }}
          style={btnStyle(!isAllAuto)}
        >
          Custom
        </button>
        {resolved?._detected && (
          <span style={{ marginLeft: '4px', fontSize: '10px', color: theme.textSecondary }}>
            {resolved._detected.modeWidth}pt {resolved._detected.scaleFactor}x
            {resolved._detected.isInternal ? ' internal' : ' external'}
            , menu bar {resolved._detected.menuBarHeight}pt
          </span>
        )}
      </div>
      {ISLAND_GEOMETRY_FIELDS.map(({ key, label }) => (
        <div key={key} style={{ padding: '4px 0', opacity: isAllAuto ? 0.35 : 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
            <span style={{ fontSize: '12px', color: theme.text }}>{label}</span>
            <span style={{ fontSize: '11px', color: theme.textSecondary }}>
              {formatValue(key, geometry[key])}
            </span>
          </div>
          <input
            type="range"
            disabled={isAllAuto}
            min={ISLAND_GEOMETRY_LIMITS[key].min}
            max={ISLAND_GEOMETRY_LIMITS[key].max}
            step={ISLAND_GEOMETRY_LIMITS[key].step}
            value={displayValues[key]}
            onChange={(e) => handleChange(key, Number(e.target.value))}
            style={{
              width: '100%',
              height: '4px',
              WebkitAppearance: 'none',
              appearance: 'none',
              background: theme.border,
              borderRadius: '2px',
              outline: 'none',
              cursor: isAllAuto ? 'default' : 'pointer',
            }}
          />
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0 0 0' }}>
        <div>
          <span style={{ fontSize: '12px', color: theme.text }}>Stay on laptop display</span>
          <span style={{ display: 'block', fontSize: '10px', color: theme.textSecondary }}>
            Keep the island on the built-in display when an external monitor is primary.
          </span>
        </div>
        <input
          type="checkbox"
          checked={stayOnLaptop}
          onChange={(e) => {
            const next = e.target.checked;
            setStayOnLaptop(next);
            void window.hotMicAPI?.setIslandStayOnLaptop?.(next);
          }}
          style={{ cursor: 'pointer' }}
        />
      </div>
    </>
  );
}

/**
 * SettingsPanel - Settings content designed to live inside the clipboard history window.
 * Keeps the same functionality as the original App.tsx settings, but styled for the
 * clipboard history context.
 */
export default function SettingsPanel({
  onNavigateToSignIn,
  onNavigateToFeedback,
  librarianEnabled,
  onLibrarianEnabledChange,
  onPerformanceHudEnabledChange,
  initialSection,
}: SettingsPanelProps) {
  const { theme, toggleDarkMode, accentPreset, setAccentPreset, darkModeIntensity, setDarkModeIntensity } = useTheme();

  // Selected section state for sidebar navigation
  const [selectedSection, setSelectedSection] = useState<SettingsSection>(() => {
    // Use initialSection if provided, otherwise restore from localStorage
    if (initialSection) {
      return initialSection;
    }
    const saved = localStorage.getItem('fieldTheorySettingsSection');
    if (saved && SECTIONS_ORDER.includes(saved as SettingsSection)) {
      return saved as SettingsSection;
    }
    return 'appearance';
  });

  // Persist selected section
  useEffect(() => {
    localStorage.setItem('fieldTheorySettingsSection', selectedSection);
  }, [selectedSection]);

  // Navigate to initialSection when it changes (e.g., from Commands "Command Settings" button)
  useEffect(() => {
    if (initialSection) {
      setSelectedSection(initialSection);
    }
  }, [initialSection]);

  // Keyboard navigation for settings sections (up/down arrows, Escape to close)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Escape closes the window (same as other tabs)
      if (e.key === 'Escape') {
        e.preventDefault();
        window.clipboardAPI?.closeWindow();
        return;
      }

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const currentIndex = SECTIONS_ORDER.indexOf(selectedSection);
        let newIndex: number;

        if (e.key === 'ArrowUp') {
          newIndex = currentIndex > 0 ? currentIndex - 1 : SECTIONS_ORDER.length - 1;
        } else {
          newIndex = currentIndex < SECTIONS_ORDER.length - 1 ? currentIndex + 1 : 0;
        }

        setSelectedSection(SECTIONS_ORDER[newIndex]);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedSection]);

  // System Access permissions state (microphone, accessibility, screen recording)
  const [systemPermissions, setSystemPermissions] = useState<{
    microphone: 'granted' | 'denied' | 'not-determined';
    accessibility: boolean;
    screenRecording: boolean;
  } | null>(null);
  
  // Clipboard hotkey configuration
  const [clipboardHotkeys, setClipboardHotkeys] = useState<{ screenshot?: string; history?: string; fullScreen?: string; activeWindow?: string }>({
    screenshot: 'CommandOrControl+Shift+4',
    history: 'CommandOrControl+Shift+V',
    fullScreen: 'Command+3',
    activeWindow: 'Command+Shift+3',
  });
  // Consolidated hotkey capture state - only one can be active at a time
  const [capturingHotkey, setCapturingHotkey] = useState<HotkeyCapture>(null);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);

  // Hotkey conflict detection state (auto-tested when keyboard section loads)
  const [hotkeyTestResults, setHotkeyTestResults] = useState<Record<string, HotkeyTestResult | null>>({});

  // Continuous Context configuration
  const [continuousContextEnabled, setContinuousContextEnabled] = useState(false);
  const [continuousContextHotkey, setContinuousContextHotkey] = useState('Shift+Command+4');

  // Additional hotkeys (SuperPaste, CommandLauncher, Scratchpad)
  const [superPasteHotkey, setSuperPasteHotkey] = useState('Command+Shift+V');
  const [commandLauncherHotkey, setCommandLauncherHotkey] = useState('Command+Shift+K');
  const [scratchpadHotkey, setScratchpadHotkey] = useState('Control+Option+Command+Space');

  // Transcription hotkey configuration
  const [transcriptionHotkey, setTranscriptionHotkey] = useState('Option+/');
  const [secondaryTranscriptionHotkey, setSecondaryTranscriptionHotkey] = useState<string | null>(null);

  // Abandon recording hotkey configuration
  const [abandonHotkey, setAbandonHotkey] = useState('Escape');

  // Hot Mic hotkey
  const [hotMicHotkey, setHotMicHotkey] = useState<string | null>(null);

  const [initialAuthLoading, setInitialAuthLoading] = useState(true);
  const [authLoading, setAuthLoading] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const {
    session,
    setSession,
    initialized: authSessionInitialized,
  } = useAuthSessionBridge({
    supabase,
    syncRendererSessionToMain: true,
  });
  
  // Delete account state.
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Callsign state
  const [callsign, setCallsign] = useState<string | null>(null);

  // Full name editing state
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);

  // Permission banner state - whether to show reminders for missing permissions.
  const [showPermissionReminders, setShowPermissionReminders] = useState(true);
  
  // Hide status labels - show only colored dots.
  // hideStatusLabels toggle removed from UI

  // Window management (Squares) enabled state.
  const [squaresEnabled, setSquaresEnabled] = useState(true);

  // Cursor status debug mode - shows blue background to prove we control the overlay.
  const [cursorStatusDebugMode, setCursorStatusDebugMode] = useState(false);

  // Cursor status window color debug - shows magenta native window background.
  const [cursorStatusWindowColorDebug, setCursorStatusWindowColorDebug] = useState(false);

  // Field Theory window behavior - panel uses current overlay mechanics, app behaves like a normal app.
  const [fieldTheoryWindowMode, setFieldTheoryWindowMode] = useState<FieldTheoryWindowMode>('panel');

  // Show fieldtheory.dev link in footer.
  // showFieldTheoryLink always true — toggle removed from UI

  // In-app performance HUD toggle.
  const [performanceHudEnabled, setPerformanceHudEnabled] = useState(false);

  // Dynamic Island auto-hide toggle.
  const [dynamicIslandAutoHide, setDynamicIslandAutoHide] = useState(false);

  // Launch at login - start app when macOS starts.
  const [launchAtLogin, setLaunchAtLogin] = useState(true);

  // Subscription tier state - 'free' or 'pro'.
  const [userTier, setUserTier] = useState<'free' | 'pro'>('free');

  // Quota usage for free users (formatted strings).
  const [quotaUsage, setQuotaUsage] = useState<{ priorityMic: string; autoStack: string; textImprove: string; portableCommands: string } | null>(null);

  // Full quota status for progress bars and exhaustion checks.
  const [quotaStatus, setQuotaStatus] = useState<{
    priorityMic: { used: number; limit: number; remaining: number; allowed: boolean; percentUsed: number };
    autoStack: { used: number; limit: number; remaining: number; allowed: boolean; percentUsed: number };
    textImprove: { used: number; limit: number; remaining: number; allowed: boolean; percentUsed: number };
    portableCommands: { used: number; limit: number; remaining: number; allowed: boolean; percentUsed: number };
  } | null>(null);

  // Days until quota reset and limits for display.
  const [daysUntilReset, setDaysUntilReset] = useState<number>(0);
  const [quotaLimits, setQuotaLimits] = useState<{ priorityMicMinutes: number; autoStackSessions: number; textImprovementWords: number; portableCommands: number } | null>(null);

  // Diagnostics modal visibility.
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  // Word substitutions for transcription correction.
  const [wordSubstitutions, setWordSubstitutions] = useState<Array<{ from: string; to: string }>>([]);
  const [newSubFrom, setNewSubFrom] = useState('');
  const [newSubTo, setNewSubTo] = useState('');

  // Data retention - how long to keep clipboard history.
  const [dataRetentionDays, setDataRetentionDays] = useState<number>(-1);

  const styles = getStyles(theme);

  // Load system permissions on mount and when window gains focus
  useEffect(() => {
    const loadSystemPermissions = async () => {
      if (window.onboardingAPI?.getPermissionStatus) {
        try {
          const status = await window.onboardingAPI.getPermissionStatus();
          setSystemPermissions(status);
        } catch (err) {
          console.error('[SettingsPanel] Failed to load system permissions:', err);
        }
      }
    };
    
    loadSystemPermissions();
    
    // Refresh when window gains focus (user may have just changed settings)
    const handleFocus = () => loadSystemPermissions();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  // Load clipboard hotkeys on mount
  useEffect(() => {
    if (window.clipboardAPI) {
      window.clipboardAPI.getHotkeys().then(hotkeys => {
        setClipboardHotkeys(hotkeys);
      });
      
      // Load continuous context settings
      window.clipboardAPI.getContinuousContextEnabled?.().then(enabled => {
        setContinuousContextEnabled(enabled);
      });
      window.clipboardAPI.getContinuousContextHotkey?.().then(hotkey => {
        if (hotkey) {
          setContinuousContextHotkey(hotkey);
        }
      });
      
      // Load permission banner setting
      window.clipboardAPI.getHideScreenRecordingBanner?.().then(hide => {
        setShowPermissionReminders(!hide);
      });
      
      // Load cursor status debug mode setting
      window.clipboardAPI.getCursorStatusDebugMode?.().then(enabled => {
        setCursorStatusDebugMode(enabled);
      });

      // Load cursor status window color debug setting
      window.clipboardAPI.getCursorStatusWindowColorDebug?.().then(enabled => {
        setCursorStatusWindowColorDebug(enabled);
      });

      // Load word substitutions
      window.clipboardAPI.getWordSubstitutions?.().then(subs => {
        setWordSubstitutions(subs || []);
      });

      // Load data retention setting
      window.clipboardAPI.getDataRetentionDays?.().then(days => {
        setDataRetentionDays(days);
      });
      
      // Load Field Theory window behavior.
      window.clipboardAPI.getFieldTheoryWindowMode?.().then(mode => {
        setFieldTheoryWindowMode(mode);
      });

      // Load in-app performance HUD setting.
      window.clipboardAPI.getPerformanceHudEnabled?.().then(enabled => {
        setPerformanceHudEnabled(enabled);
      });

      // Load Dynamic Island auto-hide setting.
      window.hotMicAPI?.getIslandAutoHide?.().then(enabled => {
        setDynamicIslandAutoHide(enabled);
      }).catch(() => {});

      // Load launch at login setting
      window.clipboardAPI.getLaunchAtLogin?.().then(enabled => {
        setLaunchAtLogin(enabled);
      });
    }
    
    // Load additional hotkeys (SuperPaste, CommandLauncher)
    if (window.hotkeyAPI) {
      window.hotkeyAPI.getHotkey('superPaste').then(hotkey => {
        if (hotkey) setSuperPasteHotkey(hotkey);
      });
      window.hotkeyAPI.getHotkey('commandLauncher').then(hotkey => {
        if (hotkey) setCommandLauncherHotkey(hotkey);
      });
      window.hotkeyAPI.getHotkey('scratchpad').then(hotkey => {
        if (hotkey) setScratchpadHotkey(hotkey);
      });
    }

    // Load Hot Mic hotkey
    if (window.hotMicAPI) {
      window.hotMicAPI.getHotkey().then(hotkey => {
        setHotMicHotkey(hotkey);
      });
    }

    // Load transcription hotkeys
    if (window.transcribeAPI) {
      window.transcribeAPI.getHotkey().then(hotkey => {
        if (hotkey) {
          setTranscriptionHotkey(hotkey);
        }
      });
      window.transcribeAPI.getSecondaryHotkey?.().then(hotkey => {
        setSecondaryTranscriptionHotkey(hotkey);
      });
      window.transcribeAPI.getAbandonHotkey?.().then(hotkey => {
        if (hotkey) {
          setAbandonHotkey(hotkey);
        }
      });
    }
    
    // Load user tier and quota usage from quota manager.
    if (window.quotaAPI?.getQuotas) {
      window.quotaAPI.getQuotas().then(quotas => {
        if (quotas) {
          setUserTier(quotas.tier);
          setQuotaStatus({
            priorityMic: quotas.priorityMic,
            autoStack: quotas.autoStack,
            textImprove: quotas.textImprove,
            portableCommands: quotas.portableCommands,
          });
        }
      });
    }
    if (window.quotaAPI?.getFormattedUsage) {
      window.quotaAPI.getFormattedUsage().then(formatted => {
        if (formatted) setQuotaUsage(formatted);
      });
    }
    if (window.quotaAPI?.getDaysUntilReset) {
      window.quotaAPI.getDaysUntilReset().then(days => {
        setDaysUntilReset(days);
      });
    }
    if (window.quotaAPI?.getLimits) {
      window.quotaAPI.getLimits().then(limits => {
        setQuotaLimits(limits);
      });
    }

    // Listen for tier changes (e.g., after Stripe checkout).
    let unsubscribeTier: (() => void) | undefined;
    if (window.quotaAPI?.onTierChanged) {
      unsubscribeTier = window.quotaAPI.onTierChanged((tier) => {
        setUserTier(tier);
      });
    }

    // Listen for quota changes to update usage in real-time.
    let unsubscribeQuota: (() => void) | undefined;
    if (window.quotaAPI?.onQuotaChanged) {
      unsubscribeQuota = window.quotaAPI.onQuotaChanged((formatted) => {
        setQuotaUsage(formatted);
        // Also refresh the full status for progress bars
        window.quotaAPI?.getQuotas?.().then(quotas => {
          if (quotas) {
            setQuotaStatus({
              priorityMic: quotas.priorityMic,
              autoStack: quotas.autoStack,
              textImprove: quotas.textImprove,
              portableCommands: quotas.portableCommands,
            });
          }
        });
      });
    }
    
    return () => {
      unsubscribeTier?.();
      unsubscribeQuota?.();
    };
  }, []);
  
  // Handler for toggling continuous context enabled state
  const handleToggleContinuousContext = async (enabled: boolean) => {
    if (!window.clipboardAPI?.setContinuousContextEnabled) return;

    try {
      const success = await window.clipboardAPI.setContinuousContextEnabled(enabled);
      if (success) {
        setContinuousContextEnabled(enabled);
      }
    } catch (err) {
      console.error('Failed to toggle continuous context:', err);
    }
  };

  // Handler for toggling permission reminders (screen recording banner)
  const handleTogglePermissionReminders = async (show: boolean) => {
    if (!window.clipboardAPI?.setHideScreenRecordingBanner) return;

    try {
      // Invert the value because we store "hide" but display as "show reminders"
      const success = await window.clipboardAPI.setHideScreenRecordingBanner(!show);
      if (success) {
        setShowPermissionReminders(show);
      }
    } catch (err) {
      console.error('Failed to toggle permission reminders:', err);
    }
  };
  
  // Handler for toggling cursor status debug mode (shows blue background).
  const handleToggleCursorStatusDebugMode = async (enabled: boolean) => {
    if (!window.clipboardAPI?.setCursorStatusDebugMode) return;

    try {
      const success = await window.clipboardAPI.setCursorStatusDebugMode(enabled);
      if (success) {
        setCursorStatusDebugMode(enabled);
      }
    } catch (err) {
      console.error('Failed to toggle cursor status debug mode:', err);
    }
  };

  // Handler for toggling cursor status window color debug (shows magenta BrowserWindow background).
  const handleToggleCursorStatusWindowColorDebug = async (enabled: boolean) => {
    if (!window.clipboardAPI?.setCursorStatusWindowColorDebug) return;

    try {
      const success = await window.clipboardAPI.setCursorStatusWindowColorDebug(enabled);
      if (success) {
        setCursorStatusWindowColorDebug(enabled);
      }
    } catch (err) {
      console.error('Failed to toggle cursor status window color debug:', err);
    }
  };

  // Handler for adding a word substitution pair.
  const handleAddWordSubstitution = async () => {
    if (!window.clipboardAPI?.setWordSubstitutions || !newSubFrom.trim()) return;

    const updated = [...wordSubstitutions, { from: newSubFrom.trim(), to: newSubTo.trim() }];
    try {
      const success = await window.clipboardAPI.setWordSubstitutions(updated);
      if (success) {
        setWordSubstitutions(updated);
        setNewSubFrom('');
        setNewSubTo('');
      }
    } catch (err) {
      console.error('Failed to add word substitution:', err);
    }
  };

  // Handler for removing a word substitution pair.
  const handleRemoveWordSubstitution = async (index: number) => {
    if (!window.clipboardAPI?.setWordSubstitutions) return;

    const updated = wordSubstitutions.filter((_, i) => i !== index);
    try {
      const success = await window.clipboardAPI.setWordSubstitutions(updated);
      if (success) {
        setWordSubstitutions(updated);
      }
    } catch (err) {
      console.error('Failed to remove word substitution:', err);
    }
  };

  // Handler for changing data retention setting.
  const handleDataRetentionChange = async (days: number) => {
    if (!window.clipboardAPI?.setDataRetentionDays) return;

    try {
      const success = await window.clipboardAPI.setDataRetentionDays(days);
      if (success) {
        setDataRetentionDays(days);
      }
    } catch (err) {
      console.error('Failed to change data retention:', err);
    }
  };

  // Handler for toggling in-app performance HUD.
  const handleTogglePerformanceHud = async (enabled: boolean) => {
    if (!window.clipboardAPI?.setPerformanceHudEnabled) return;

    try {
      const success = await window.clipboardAPI.setPerformanceHudEnabled(enabled);
      if (success) {
        setPerformanceHudEnabled(enabled);
        onPerformanceHudEnabledChange?.(enabled);
      }
    } catch (err) {
      console.error('Failed to toggle performance HUD:', err);
    }
  };

  const handleSetFieldTheoryWindowMode = async (mode: FieldTheoryWindowMode) => {
    if (!window.clipboardAPI?.setFieldTheoryWindowMode) return;

    try {
      const success = await window.clipboardAPI.setFieldTheoryWindowMode(mode);
      if (success) {
        setFieldTheoryWindowMode(mode);
      }
    } catch (err) {
      console.error('Failed to change Field Theory window behavior:', err);
    }
  };

  useEffect(() => {
    if (authSessionInitialized) {
      setInitialAuthLoading(false);
    }
  }, [authSessionInitialized]);

  // Fetch callsign when session changes
  useEffect(() => {
    if (!session?.user?.id || !supabase) {
      setCallsign(null);
      return;
    }
    supabase
      .from('profiles')
      .select('callsign')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        setCallsign(data?.callsign || null);
      });
  }, [session?.user?.id]);

  // Handle sign out - redirects to onboarding/login screen after successful sign out.
  const handleSignOut = async () => {
    setAuthLoading(true);
    try {
      // Main process will show onboarding window after successful sign out.
      await window.authAPI?.signOut();
    } catch (err) {
      console.error('Sign out error:', err);
    } finally {
      setAuthLoading(false);
    }
  };
  
  // Handle account deletion.
  const handleDeleteAccount = async () => {
    if (!window.authAPI?.deleteAccount) {
      setDeleteError('Account deletion not available');
      return;
    }
    
    setDeleteLoading(true);
    setDeleteError(null);
    
    try {
      const result = await window.authAPI.deleteAccount();
      if (result.error) {
        setDeleteError(result.error);
        setDeleteLoading(false);
      } else {
        await supabase?.auth.signOut();
        setShowDeleteModal(false);
        setSession(null);
      }
    } catch (err) {
      console.error('Delete account error:', err);
      setDeleteError('An unexpected error occurred');
      setDeleteLoading(false);
    }
  };
  
  // Handle manual sync trigger - syncs both transcripts and todos.
  const handleManualSync = async () => {
    setIsSyncing(true);
    setSyncStatus('Syncing...');
    
    try {
      // Sync transcripts.
      let transcriptCount = 0;
      if (window.clipboardAPI?.syncMobileTranscripts) {
        transcriptCount = await window.clipboardAPI.syncMobileTranscripts();
      }
      
      // Sync todos.
      let todoCount = 0;
      if (window.todoAPI?.syncTodos) {
        const todos = await window.todoAPI.syncTodos();
        todoCount = todos.length;
      }
      
      // Build status message.
      const parts: string[] = [];
      if (transcriptCount > 0) {
        parts.push(`${transcriptCount} transcript${transcriptCount === 1 ? '' : 's'}`);
      }
      if (todoCount > 0) {
        parts.push(`${todoCount} task${todoCount === 1 ? '' : 's'}`);
      }
      
      setSyncStatus(parts.length > 0 
        ? `Synced ${parts.join(' and ')} from iOS`
        : 'Already up to date'
      );
    } catch (err) {
      setSyncStatus('Sync failed');
      console.error('Sync error:', err);
    } finally {
      setIsSyncing(false);
    }
  };
  
  // Force full re-sync - fixes source attribution for existing items
  const handleForceSync = async () => {
    if (!window.clipboardAPI?.forceSyncAll) return;
    
    setIsSyncing(true);
    setSyncStatus('Re-syncing all transcripts...');
    
    try {
      const count = await window.clipboardAPI.forceSyncAll();
      setSyncStatus(count > 0 
        ? `Fixed attribution for ${count} transcript${count === 1 ? '' : 's'}`
        : 'All transcripts already correctly attributed'
      );
    } catch (err) {
      setSyncStatus('Re-sync failed');
      console.error('Force sync error:', err);
    } finally {
      setIsSyncing(false);
    }
  };
  
  // Handler for setting screenshot hotkey
  const handleSetScreenshotHotkey = useCallback(async (hotkeyString: string) => {
    setCapturingHotkey(null);
    setHotkeyError(null);

    if (!window.clipboardAPI) return;

    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const success = await window.clipboardAPI.setHotkeys({ screenshot: hotkeyString });
      if (!success) {
        setHotkeyError('Failed to register screenshot hotkey. It may be in use by another application.');
      } else {
        setClipboardHotkeys(prev => ({ ...prev, screenshot: hotkeyString }));
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set screenshot hotkey');
      console.error('Failed to set screenshot hotkey:', err);
    }
  }, []);

  useEffect(() => {
    if (!window.squaresAPI) return;

    window.squaresAPI.getConfig().then(config => {
      setSquaresEnabled(normalizeSquaresConfig(config).enabled);
    });

    return window.squaresAPI.onConfigChanged((config) => {
      setSquaresEnabled(normalizeSquaresConfig(config).enabled);
    });
  }, []);

  // Handler for clearing screenshot hotkey
  const handleClearScreenshotHotkey = useCallback(async () => {
    if (!window.clipboardAPI) return;
    try {
      await window.clipboardAPI.setHotkeys({ screenshot: '' });
      setClipboardHotkeys(prev => ({ ...prev, screenshot: '' }));
    } catch (err) {
      console.error('Failed to clear screenshot hotkey:', err);
    }
  }, []);
  
  // Handler for setting full screen screenshot hotkey
  const handleSetFullScreenHotkey = useCallback(async (hotkeyString: string) => {
    setCapturingHotkey(null);
    setHotkeyError(null);

    if (!window.clipboardAPI) return;

    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const success = await window.clipboardAPI.setHotkeys({ fullScreen: hotkeyString });
      if (!success) {
        setHotkeyError('Failed to register full screen screenshot hotkey. It may be in use by another application.');
      } else {
        setClipboardHotkeys(prev => ({ ...prev, fullScreen: hotkeyString }));
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set full screen screenshot hotkey');
      console.error('Failed to set full screen screenshot hotkey:', err);
    }
  }, []);

  // Handler for clearing full screen screenshot hotkey
  const handleClearFullScreenHotkey = useCallback(async () => {
    if (!window.clipboardAPI) return;
    try {
      await window.clipboardAPI.setHotkeys({ fullScreen: '' });
      setClipboardHotkeys(prev => ({ ...prev, fullScreen: '' }));
    } catch (err) {
      console.error('Failed to clear full screen screenshot hotkey:', err);
    }
  }, []);

  // Handler for setting active window screenshot hotkey
  const handleSetActiveWindowHotkey = useCallback(async (hotkeyString: string) => {
    setCapturingHotkey(null);
    setHotkeyError(null);

    if (!window.clipboardAPI) return;

    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const success = await window.clipboardAPI.setHotkeys({ activeWindow: hotkeyString });
      if (!success) {
        setHotkeyError('Failed to register active window screenshot hotkey. It may be in use by another application.');
      } else {
        setClipboardHotkeys(prev => ({ ...prev, activeWindow: hotkeyString }));
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set active window screenshot hotkey');
      console.error('Failed to set active window screenshot hotkey:', err);
    }
  }, []);

  // Handler for clearing active window screenshot hotkey
  const handleClearActiveWindowHotkey = useCallback(async () => {
    if (!window.clipboardAPI) return;
    try {
      await window.clipboardAPI.setHotkeys({ activeWindow: '' });
      setClipboardHotkeys(prev => ({ ...prev, activeWindow: '' }));
    } catch (err) {
      console.error('Failed to clear active window screenshot hotkey:', err);
    }
  }, []);

  // Handler for clearing all screenshot hotkeys (use Mac defaults)
  const handleClearAllScreenshotHotkeys = useCallback(async () => {
    if (!window.clipboardAPI) return;
    try {
      await window.clipboardAPI.setHotkeys({ screenshot: '', fullScreen: '', activeWindow: '' });
      setClipboardHotkeys(prev => ({ ...prev, screenshot: '', fullScreen: '', activeWindow: '' }));
    } catch (err) {
      console.error('Failed to clear screenshot hotkeys:', err);
    }
  }, []);

  // Auto-test hotkeys for conflicts when keyboard section is selected
  useEffect(() => {
    if (selectedSection !== 'keyboard' || !window.hotkeyAPI?.testHotkey) return;

    const testHotkeys = async () => {
      const hotkeysToTest = [
        { id: 'history', key: clipboardHotkeys.history },
        { id: 'transcription', key: transcriptionHotkey },
        { id: 'secondaryTranscription', key: secondaryTranscriptionHotkey },
        { id: 'screenshot', key: clipboardHotkeys.screenshot },
        { id: 'fullScreen', key: clipboardHotkeys.fullScreen },
        { id: 'activeWindow', key: clipboardHotkeys.activeWindow },
      ];

      const results: Record<string, HotkeyTestResult | null> = {};
      for (const { id, key } of hotkeysToTest) {
        if (key) {
          try {
            results[id] = await window.hotkeyAPI!.testHotkey(key, 500);
          } catch {
            results[id] = null;
          }
        }
      }
      setHotkeyTestResults(results);
    };

    testHotkeys();
  }, [selectedSection, clipboardHotkeys.history, clipboardHotkeys.screenshot, clipboardHotkeys.fullScreen, clipboardHotkeys.activeWindow, transcriptionHotkey, secondaryTranscriptionHotkey]);

  // Handler for setting history hotkey
  const handleSetHistoryHotkey = useCallback(async (hotkeyString: string) => {
    setCapturingHotkey(null);
    setHotkeyError(null);
    
    if (!window.clipboardAPI) return;
    
    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const success = await window.clipboardAPI.setHotkeys({ history: hotkeyString });
      if (!success) {
        setHotkeyError('Failed to register history hotkey. It may be in use by another application.');
      } else {
        setClipboardHotkeys(prev => ({ ...prev, history: hotkeyString }));
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set history hotkey');
      console.error('Failed to set history hotkey:', err);
    }
  }, []);
  
  // Handler for setting continuous context hotkey
  const handleSetContinuousContextHotkey = useCallback(async (hotkeyString: string) => {
    setCapturingHotkey(null);
    setHotkeyError(null);
    
    if (!window.clipboardAPI?.setContinuousContextHotkey) return;
    
    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const success = await window.clipboardAPI.setContinuousContextHotkey(hotkeyString);
      if (!success) {
        setHotkeyError('Failed to register continuous context hotkey. It may be in use by another application.');
      } else {
        setContinuousContextHotkey(hotkeyString);
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set continuous context hotkey');
      console.error('Failed to set continuous context hotkey:', err);
    }
  }, []);

  // Handler for setting Super Paste hotkey
  const handleSetSuperPasteHotkey = useCallback(async (hotkeyString: string) => {
    setCapturingHotkey(null);
    setHotkeyError(null);

    if (!window.hotkeyAPI?.setHotkey) return;

    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const result = await window.hotkeyAPI.setHotkey('superPaste', hotkeyString);
      if (!result.success) {
        setHotkeyError(result.error || 'Failed to register Super Paste hotkey.');
      } else {
        setSuperPasteHotkey(hotkeyString);
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set Super Paste hotkey');
      console.error('Failed to set Super Paste hotkey:', err);
    }
  }, []);

  // Handler for setting Command Launcher hotkey
  const handleSetCommandLauncherHotkey = useCallback(async (hotkeyString: string) => {
    setCapturingHotkey(null);
    setHotkeyError(null);

    if (!window.hotkeyAPI?.setHotkey) return;

    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const result = await window.hotkeyAPI.setHotkey('commandLauncher', hotkeyString);
      if (!result.success) {
        setHotkeyError(result.error || 'Failed to register Command Launcher hotkey.');
      } else {
        setCommandLauncherHotkey(hotkeyString);
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set Command Launcher hotkey');
      console.error('Failed to set Command Launcher hotkey:', err);
    }
  }, []);

  const handleSetScratchpadHotkey = useCallback(async (hotkeyString: string) => {
    setCapturingHotkey(null);
    setHotkeyError(null);

    if (!window.hotkeyAPI?.setHotkey) return;

    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const result = await window.hotkeyAPI.setHotkey('scratchpad', hotkeyString);
      if (!result.success) {
        setHotkeyError(result.error || 'Failed to register Scratchpad hotkey.');
      } else {
        setScratchpadHotkey(hotkeyString);
        window.dispatchEvent(new CustomEvent('fieldtheory:scratchpad-hotkey-changed', { detail: hotkeyString }));
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set Scratchpad hotkey');
      console.error('Failed to set Scratchpad hotkey:', err);
    }
  }, []);

  // Handler for setting Hot Mic hotkey
  const handleSetHotMicHotkey = useCallback(async (hotkeyString: string) => {
    setCapturingHotkey(null);
    setHotkeyError(null);

    if (!window.hotMicAPI?.setHotkey) return;

    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const success = await window.hotMicAPI.setHotkey(hotkeyString);
      if (!success) {
        setHotkeyError('Failed to register Hot Mic hotkey. It may be in use by another application.');
      } else {
        setHotMicHotkey(hotkeyString);
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set Hot Mic hotkey');
    }
  }, []);

  // Handler for clearing Hot Mic hotkey
  const handleClearHotMicHotkey = useCallback(async () => {
    setHotkeyError(null);
    if (window.hotMicAPI?.setHotkey) {
      await window.hotMicAPI.setHotkey(null);
    }
    setHotMicHotkey(null);
  }, []);

  // Handler for setting transcription hotkey
  const handleSetTranscriptionHotkey = useCallback(async (hotkeyString: string) => {
    setCapturingHotkey(null);
    setHotkeyError(null);

    if (!window.transcribeAPI?.setHotkey) return;

    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const success = await window.transcribeAPI.setHotkey(hotkeyString);
      if (!success) {
        setHotkeyError('Failed to register transcription hotkey. It may be in use by another application.');
      } else {
        setTranscriptionHotkey(hotkeyString);
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set transcription hotkey');
      console.error('Failed to set transcription hotkey:', err);
    }
  }, []);

  // Handler for setting secondary transcription hotkey
  const handleSetSecondaryTranscriptionHotkey = useCallback(async (hotkeyString: string) => {
    setCapturingHotkey(null);
    setHotkeyError(null);

    if (!window.transcribeAPI?.setSecondaryHotkey) return;

    if (!hotkeyString || isModifierOnly(hotkeyString)) {
      setHotkeyError('Please include a non-modifier key (e.g., ⇧⌥⌘ + key).');
      return;
    }

    try {
      const success = await window.transcribeAPI.setSecondaryHotkey(hotkeyString);
      if (!success) {
        setHotkeyError('Failed to register secondary hotkey. It may be in use by another application.');
      } else {
        setSecondaryTranscriptionHotkey(hotkeyString);
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set secondary hotkey');
      console.error('Failed to set secondary hotkey:', err);
    }
  }, []);

  // Handler for clearing secondary transcription hotkey
  const handleClearSecondaryHotkey = useCallback(async () => {
    if (!window.transcribeAPI?.setSecondaryHotkey) return;

    try {
      await window.transcribeAPI.setSecondaryHotkey(null);
      setSecondaryTranscriptionHotkey(null);
      setHotkeyError(null);
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to clear secondary hotkey');
      console.error('Failed to clear secondary hotkey:', err);
    }
  }, []);

  // Handler for setting abandon recording hotkey
  const handleSetAbandonHotkey = useCallback(async (hotkeyString: string) => {
    setCapturingHotkey(null);
    setHotkeyError(null);
    
    if (!window.transcribeAPI?.setAbandonHotkey) return;
    
    // Abandon hotkey can be a single key like Escape
    try {
      const success = await window.transcribeAPI.setAbandonHotkey(hotkeyString);
      if (!success) {
        setHotkeyError('Failed to register abandon hotkey. It may be in use by another application.');
      } else {
        setAbandonHotkey(hotkeyString);
      }
    } catch (err) {
      setHotkeyError(err instanceof Error ? err.message : 'Failed to set abandon hotkey');
      console.error('Failed to set abandon hotkey:', err);
    }
  }, []);

  // Capture hotkey when user is setting any shortcut.
  useEffect(() => {
    if (!capturingHotkey) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const hotkeyString = buildHotkeyString(event);
      if (hotkeyString) {
        if (capturingHotkey === 'screenshot') {
          handleSetScreenshotHotkey(hotkeyString);
        } else if (capturingHotkey === 'history') {
          handleSetHistoryHotkey(hotkeyString);
        } else if (capturingHotkey === 'fullScreen') {
          handleSetFullScreenHotkey(hotkeyString);
        } else if (capturingHotkey === 'activeWindow') {
          handleSetActiveWindowHotkey(hotkeyString);
        } else if (capturingHotkey === 'transcription') {
          handleSetTranscriptionHotkey(hotkeyString);
        } else if (capturingHotkey === 'secondaryTranscription') {
          handleSetSecondaryTranscriptionHotkey(hotkeyString);
        } else if (capturingHotkey === 'abandon') {
          handleSetAbandonHotkey(hotkeyString);
        } else if (capturingHotkey === 'superPaste') {
          handleSetSuperPasteHotkey(hotkeyString);
        } else if (capturingHotkey === 'commandLauncher') {
          handleSetCommandLauncherHotkey(hotkeyString);
        } else if (capturingHotkey === 'scratchpad') {
          handleSetScratchpadHotkey(hotkeyString);
        } else if (capturingHotkey === 'hotMic') {
          handleSetHotMicHotkey(hotkeyString);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [capturingHotkey, handleSetScreenshotHotkey, handleSetHistoryHotkey, handleSetFullScreenHotkey, handleSetActiveWindowHotkey, handleSetContinuousContextHotkey, handleSetTranscriptionHotkey, handleSetSecondaryTranscriptionHotkey, handleSetAbandonHotkey, handleSetSuperPasteHotkey, handleSetCommandLauncherHotkey, handleSetScratchpadHotkey, handleSetHotMicHotkey]);

  // Section header component for consistent divider styling
  const SectionHeader = ({ title }: { title: string }) => (
    <div style={styles.sectionHeader}>
      <span style={styles.sectionTitle}>{title}</span>
      <div style={styles.sectionLine} />
    </div>
  );

  return (
    <div style={styles.settingsLayout}>
      {/* Left Sidebar Navigation */}
      <div style={styles.sidebar}>
        <div style={styles.sidebarNav}>
          {SECTIONS_ORDER.map((section) => {
            return (
            <button
              key={section}
              onClick={() => setSelectedSection(section)}
              style={{
                ...styles.sidebarItem,
                backgroundColor: selectedSection === section ? theme.selectedBg : 'transparent',
                borderColor: selectedSection === section ? theme.border : 'transparent',
                color: selectedSection === section ? theme.text : theme.textSecondary,
                boxShadow: selectedSection === section
                  ? (theme.isDark ? 'inset 0 1px 0 rgba(255,255,255,0.03)' : '0 1px 1px rgba(15, 23, 42, 0.04)')
                  : 'none',
                cursor: 'pointer',
              }}
            >
              {SECTION_LABELS[section]}
            </button>
            );
          })}
        </div>
      </div>

      {/* Right Content Area */}
      <div style={styles.content}>
      <div style={styles.contentInner}>
      {/* Appearance Section - Dark mode toggle, accent colors, intensity */}
      {selectedSection === 'appearance' && (
        <>
      <div style={styles.section}>
        <SectionHeader title="Appearance" />
        <div style={styles.row}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={styles.rowLabel}>Dark Mode</span>
            <span style={{ fontSize: '11px', color: theme.textSecondary }}>
              Switch between light and dark themes
            </span>
          </div>
          <button
            onClick={toggleDarkMode}
            style={{ ...styles.toggle, backgroundColor: theme.isDark ? theme.success : '#d1d5db' }}
          >
            <span style={{ ...styles.toggleKnob, transform: theme.isDark ? 'translateX(20px)' : 'translateX(2px)' }} />
          </button>
        </div>

        {/* Accent Color Presets */}
        <div style={styles.row}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={styles.rowLabel}>Accent Color</span>
            <span style={{ fontSize: '11px', color: theme.textSecondary }}>
              Personalize your interface
            </span>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            {(Object.keys(accentPresets) as AccentPreset[]).map((preset) => {
              const isSelected = preset === accentPreset;
              const color = theme.isDark ? accentPresets[preset].dark : accentPresets[preset].light;
              return (
                <button
                  key={preset}
                  onClick={() => setAccentPreset(preset)}
                  title={accentPresets[preset].name}
                  style={{
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    backgroundColor: color,
                    border: isSelected ? `2px solid ${theme.text}` : `2px solid transparent`,
                    cursor: 'pointer',
                    transition: 'transform 0.1s, border-color 0.15s',
                    transform: isSelected ? 'scale(1.1)' : 'scale(1)',
                    boxShadow: isSelected ? `0 0 0 2px ${theme.bg}` : 'none',
                  }}
                />
              );
            })}
          </div>
        </div>

        {/* Dark Mode Intensity Slider - only show when dark mode is enabled */}
        {theme.isDark && (
          <div style={styles.row}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
              <span style={styles.rowLabel}>Dark Mode Intensity</span>
              <span style={{ fontSize: '11px', color: theme.textSecondary }}>
                Adjust background darkness
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '11px', color: theme.textSecondary, width: '50px' }}>Lighter</span>
              <input
                type="range"
                min="0"
                max="100"
                value={darkModeIntensity}
                onChange={(e) => setDarkModeIntensity(parseInt(e.target.value, 10))}
                style={{
                  width: '100px',
                  height: '4px',
                  WebkitAppearance: 'none',
                  appearance: 'none',
                  background: `linear-gradient(to right, ${theme.accent} 0%, ${theme.accent} ${darkModeIntensity}%, ${theme.border} ${darkModeIntensity}%, ${theme.border} 100%)`,
                  borderRadius: '2px',
                  outline: 'none',
                  cursor: 'pointer',
                }}
              />
              <span style={{ fontSize: '11px', color: theme.textSecondary, width: '50px', textAlign: 'right' }}>Darker</span>
            </div>
          </div>
        )}

        {/* In-app Performance HUD */}
        <div style={styles.row}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={styles.rowLabel}>Performance HUD</span>
            <span style={{ fontSize: '11px', color: theme.textSecondary }}>
              Show CPU, RAM, and FPS overlay while using the app
            </span>
          </div>
          <button
            onClick={() => handleTogglePerformanceHud(!performanceHudEnabled)}
            style={{ ...styles.toggle, backgroundColor: performanceHudEnabled ? theme.success : '#d1d5db' }}
          >
            <span style={{ ...styles.toggleKnob, transform: performanceHudEnabled ? 'translateX(20px)' : 'translateX(2px)' }} />
          </button>
        </div>

        <div style={styles.row}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={styles.rowLabel}>Normal app window</span>
            <span style={{ fontSize: '11px', color: theme.textSecondary }}>
              Show Field Theory in the Dock and let it behave like a regular macOS window
            </span>
          </div>
          <button
            onClick={() => handleSetFieldTheoryWindowMode(fieldTheoryWindowMode === 'app' ? 'panel' : 'app')}
            style={{ ...styles.toggle, backgroundColor: fieldTheoryWindowMode === 'app' ? theme.success : '#d1d5db' }}
          >
            <span style={{ ...styles.toggleKnob, transform: fieldTheoryWindowMode === 'app' ? 'translateX(20px)' : 'translateX(2px)' }} />
          </button>
        </div>
      </div>

      {/* Dynamic Island */}
      <div style={styles.section}>
        <SectionHeader title="Dynamic Island" />

        <div style={styles.row}>
          <div>
            <span style={styles.rowLabel}>Auto-hide until active or hovered</span>
            <span style={{ display: 'block', fontSize: '11px', color: theme.textSecondary, marginTop: '2px' }}>
              Pills stay hidden until you move your cursor near the notch, or until a recording / hot-mic is active.
            </span>
          </div>
          <button
            onClick={async () => {
              const next = !dynamicIslandAutoHide;
              setDynamicIslandAutoHide(next);
              try {
                await window.hotMicAPI?.setIslandAutoHide?.(next);
              } catch (err) {
                console.error('Failed to toggle Dynamic Island auto-hide:', err);
                setDynamicIslandAutoHide(!next);
              }
            }}
            style={{ ...styles.toggle, backgroundColor: dynamicIslandAutoHide ? theme.success : '#d1d5db' }}
          >
            <span style={{ ...styles.toggleKnob, transform: dynamicIslandAutoHide ? 'translateX(20px)' : 'translateX(2px)' }} />
          </button>
        </div>

        <p style={{ fontSize: '11px', color: theme.textSecondary, margin: '12px 0 8px 0' }}>
          Tune notch alignment. Changes apply immediately.
        </p>
        <IslandGeometrySliders theme={theme} />
      </div>

      {/* System Access Section - Permission status with quick links to settings */}
      {systemPermissions && (
        <div style={styles.section}>
          <SectionHeader title="System Access" />
          
          {/* Microphone */}
          <div style={styles.row}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                ...styles.statusDot,
                backgroundColor: systemPermissions.microphone === 'granted' ? theme.success : theme.error,
              }} />
              <span style={styles.rowLabel}>Microphone</span>
            </div>
            <button
              onClick={() => window.shellAPI?.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')}
              style={styles.linkBtn}
            >
              {systemPermissions.microphone === 'granted' ? 'Open Settings' : 'Grant Access'}
            </button>
          </div>
          
          {/* Accessibility */}
          <div style={styles.row}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                ...styles.statusDot,
                backgroundColor: systemPermissions.accessibility ? theme.success : theme.error,
              }} />
              <span style={styles.rowLabel}>Accessibility</span>
            </div>
            <button
              onClick={() => window.shellAPI?.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')}
              style={styles.linkBtn}
            >
              {systemPermissions.accessibility ? 'Open Settings' : 'Grant Access'}
            </button>
          </div>
          
          {/* Screen Recording */}
          <div style={styles.row}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                ...styles.statusDot,
                backgroundColor: systemPermissions.screenRecording ? theme.success : theme.error,
              }} />
              <span style={styles.rowLabel}>Screen Recording</span>
            </div>
            <button
              onClick={() => window.shellAPI?.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')}
              style={styles.linkBtn}
            >
              {systemPermissions.screenRecording ? 'Open Settings' : 'Grant Access'}
            </button>
          </div>
        </div>
      )}

      {/* Data Retention Section */}
      <div style={styles.section}>
        <SectionHeader title="Data Retention" />
        <p style={{ fontSize: '12px', color: theme.textSecondary, marginBottom: '12px' }}>
          Automatically delete clipboard history older than the selected period.
        </p>
        <div style={styles.row}>
          <span style={styles.rowLabel}>Delete after</span>
          <select
            value={dataRetentionDays}
            onChange={(e) => handleDataRetentionChange(parseInt(e.target.value, 10))}
            style={styles.select}
          >
            <option value={2}>2 days</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>3 months</option>
            <option value={-1}>Never</option>
          </select>
        </div>
        {dataRetentionDays !== -1 && (
          <p style={{
            fontSize: '11px',
            color: theme.textSecondary,
            marginTop: '8px',
          }}>
            Items older than {dataRetentionDays} days will be automatically deleted.
          </p>
        )}
      </div>
        </>
      )}

      {/* Keyboard Shortcuts Section - First for easy access */}
      {selectedSection === 'keyboard' && (
      <div style={styles.section}>
        <SectionHeader title="Keyboard Shortcuts" />
        
        {/* Open Field Theory - primary action, shown first */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Open Field Theory</span>
          <div style={styles.rowControls}>
            <button
              onClick={() => { setCapturingHotkey('history'); setHotkeyError(null); }}
              disabled={capturingHotkey !== null}
              style={{ ...styles.btn, ...(capturingHotkey === 'history' ? styles.btnActive : {}) }}
            >
              {capturingHotkey === 'history' ? 'Press keys...' : clipboardHotkeys.history || '⌥Space'}
            </button>
            {capturingHotkey === 'history' && (
              <button onClick={() => { setCapturingHotkey(null); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
            )}
          </div>
        </div>
        
        {/* Transcription (Record) */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Record Transcription</span>
          <div style={styles.rowControls}>
            <button
              onClick={() => { setCapturingHotkey('transcription'); setHotkeyError(null); }}
              disabled={capturingHotkey !== null}
              style={{ ...styles.btn, ...(capturingHotkey === 'transcription' ? styles.btnActive : {}) }}
            >
              {capturingHotkey === 'transcription' ? 'Press keys...' : transcriptionHotkey}
            </button>
            {capturingHotkey === 'transcription' && (
              <button onClick={() => { setCapturingHotkey(null); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
            )}
          </div>
        </div>

        {/* Secondary Transcription Hotkey */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Record Transcription (Alt)</span>
          <div style={styles.rowControls}>
            {capturingHotkey !== 'secondaryTranscription' && (
              <button
                onClick={handleClearSecondaryHotkey}
                disabled={!secondaryTranscriptionHotkey}
                style={{ ...styles.btnGhost, fontSize: '11px', padding: '4px 8px' }}
              >
                Clear
              </button>
            )}
            <button
              onClick={() => { setCapturingHotkey('secondaryTranscription'); setHotkeyError(null); }}
              disabled={capturingHotkey !== null}
              style={{ ...styles.btn, ...(capturingHotkey === 'secondaryTranscription' ? styles.btnActive : {}) }}
            >
              {capturingHotkey === 'secondaryTranscription' ? 'Press keys...' : (secondaryTranscriptionHotkey || 'Not set')}
            </button>
            {capturingHotkey === 'secondaryTranscription' && (
              <button onClick={() => { setCapturingHotkey(null); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
            )}
          </div>
        </div>

        {/* Screenshot */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Take Screenshot</span>
          <div style={styles.rowControls}>
            {capturingHotkey !== 'screenshot' && (
              <button
                onClick={handleClearScreenshotHotkey}
                disabled={!clipboardHotkeys.screenshot}
                style={{ ...styles.btnGhost, fontSize: '11px', padding: '4px 8px' }}
              >
                Clear
              </button>
            )}
            <button
              onClick={() => { setCapturingHotkey('screenshot'); setHotkeyError(null); }}
              disabled={capturingHotkey !== null}
              style={{ ...styles.btn, ...(capturingHotkey === 'screenshot' ? styles.btnActive : {}) }}
            >
              {capturingHotkey === 'screenshot' ? 'Press keys...' : clipboardHotkeys.screenshot || 'Not set'}
            </button>
            {capturingHotkey === 'screenshot' && (
              <button onClick={() => { setCapturingHotkey(null); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
            )}
          </div>
        </div>

        {/* Full Screen Screenshot */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Take Full Screen Screenshot</span>
          <div style={styles.rowControls}>
            {capturingHotkey !== 'fullScreen' && (
              <button
                onClick={handleClearFullScreenHotkey}
                disabled={!clipboardHotkeys.fullScreen}
                style={{ ...styles.btnGhost, fontSize: '11px', padding: '4px 8px' }}
              >
                Clear
              </button>
            )}
            <button
              onClick={() => { setCapturingHotkey('fullScreen'); setHotkeyError(null); }}
              disabled={capturingHotkey !== null}
              style={{ ...styles.btn, ...(capturingHotkey === 'fullScreen' ? styles.btnActive : {}) }}
            >
              {capturingHotkey === 'fullScreen' ? 'Press keys...' : clipboardHotkeys.fullScreen || 'Not set'}
            </button>
            {capturingHotkey === 'fullScreen' && (
              <button onClick={() => { setCapturingHotkey(null); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
            )}
          </div>
        </div>

        {/* Active Window Screenshot */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Take Active Window Screenshot</span>
          <div style={styles.rowControls}>
            {capturingHotkey !== 'activeWindow' && (
              <button
                onClick={handleClearActiveWindowHotkey}
                disabled={!clipboardHotkeys.activeWindow}
                style={{ ...styles.btnGhost, fontSize: '11px', padding: '4px 8px' }}
              >
                Clear
              </button>
            )}
            <button
              onClick={() => { setCapturingHotkey('activeWindow'); setHotkeyError(null); }}
              disabled={capturingHotkey !== null}
              style={{ ...styles.btn, ...(capturingHotkey === 'activeWindow' ? styles.btnActive : {}) }}
            >
              {capturingHotkey === 'activeWindow' ? 'Press keys...' : clipboardHotkeys.activeWindow || 'Not set'}
            </button>
            {capturingHotkey === 'activeWindow' && (
              <button onClick={() => { setCapturingHotkey(null); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
            )}
          </div>
        </div>

        {/* Clear all screenshot shortcuts helper */}
        {(clipboardHotkeys.screenshot || clipboardHotkeys.fullScreen || clipboardHotkeys.activeWindow) && (
          <div style={{ marginTop: '-4px', marginBottom: '8px', paddingLeft: '12px' }}>
            <button
              onClick={handleClearAllScreenshotHotkeys}
              style={{
                ...styles.btnGhost,
                fontSize: '11px',
                color: theme.textSecondary,
                padding: '2px 0',
              }}
            >
              Clear all screenshot shortcuts (use Mac defaults)
            </button>
          </div>
        )}

        {/* Terminal Image Paste - Pastes images in terminal-compatible format */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>
            Terminal Image Paste
            <span style={{ marginLeft: '8px', fontSize: '10px', color: theme.textSecondary }}>
              (pastes images as base64 for terminals)
            </span>
          </span>
          <div style={styles.rowControls}>
            <button
              onClick={() => { setCapturingHotkey('superPaste'); setHotkeyError(null); }}
              disabled={capturingHotkey !== null}
              style={{ ...styles.btn, ...(capturingHotkey === 'superPaste' ? styles.btnActive : {}) }}
            >
              {capturingHotkey === 'superPaste' ? 'Press keys...' : (superPasteHotkey || 'Not set')}
            </button>
            {capturingHotkey === 'superPaste' && (
              <button onClick={() => { setCapturingHotkey(null); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
            )}
          </div>
        </div>

        {/* Command Launcher */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>
            Command Launcher
            <span style={{ marginLeft: '8px', fontSize: '10px', color: theme.textSecondary }}>
              (quick access to commands)
            </span>
          </span>
          <div style={styles.rowControls}>
            <button
              onClick={() => { setCapturingHotkey('commandLauncher'); setHotkeyError(null); }}
              disabled={capturingHotkey !== null}
              style={{ ...styles.btn, ...(capturingHotkey === 'commandLauncher' ? styles.btnActive : {}) }}
            >
              {capturingHotkey === 'commandLauncher' ? 'Press keys...' : (commandLauncherHotkey || 'Not set')}
            </button>
            {capturingHotkey === 'commandLauncher' && (
              <button onClick={() => { setCapturingHotkey(null); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
            )}
          </div>
        </div>

        {/* Scratchpad */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>
            New Scratchpad
            <span style={{ marginLeft: '8px', fontSize: '10px', color: theme.textSecondary }}>
              (create a markdown note)
            </span>
          </span>
          <div style={styles.rowControls}>
            <button
              onClick={() => { setCapturingHotkey('scratchpad'); setHotkeyError(null); }}
              disabled={capturingHotkey !== null}
              style={{ ...styles.btn, ...(capturingHotkey === 'scratchpad' ? styles.btnActive : {}) }}
            >
              {capturingHotkey === 'scratchpad' ? 'Press keys...' : (scratchpadHotkey || 'Not set')}
            </button>
            {capturingHotkey === 'scratchpad' && (
              <button onClick={() => { setCapturingHotkey(null); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
            )}
          </div>
        </div>

        {/* Hot Mic */}
        <div style={styles.row}>
          <span style={styles.rowLabel}>Toggle Hot Mic</span>
          <div style={styles.rowControls}>
            {capturingHotkey !== 'hotMic' && hotMicHotkey && (
              <button
                onClick={handleClearHotMicHotkey}
                style={{ ...styles.btnGhost, fontSize: '11px', padding: '4px 8px' }}
              >
                Clear
              </button>
            )}
            <button
              onClick={() => { setCapturingHotkey('hotMic'); setHotkeyError(null); }}
              disabled={capturingHotkey !== null}
              style={{ ...styles.btn, ...(capturingHotkey === 'hotMic' ? styles.btnActive : {}) }}
            >
              {capturingHotkey === 'hotMic' ? 'Press keys...' : (hotMicHotkey || 'Not set')}
            </button>
            {capturingHotkey === 'hotMic' && (
              <button onClick={() => { setCapturingHotkey(null); setHotkeyError(null); }} style={styles.btnGhost}>Cancel</button>
            )}
          </div>
        </div>

        <div style={styles.row}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={styles.rowLabel}>Window management</span>
            <span style={styles.rowHint}>Turn spoken window actions on or off. Portable command visibility is configured in Window Management.</span>
          </div>
          <div style={styles.rowControls}>
            <button
              onClick={() => {
                const newEnabled = !squaresEnabled;
                setSquaresEnabled(newEnabled);
                window.squaresAPI?.setConfig({ enabled: newEnabled });
              }}
              style={{ ...styles.toggle, backgroundColor: squaresEnabled ? theme.accent : '#d1d5db' }}
            >
              <span style={{ ...styles.toggleKnob, transform: squaresEnabled ? 'translateX(20px)' : 'translateX(2px)' }} />
            </button>
          </div>
        </div>

        <div style={styles.row}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span style={styles.rowLabel}>Window voice commands</span>
            <span style={styles.rowHint}>
              Configure spoken window actions and portable-command availability.
            </span>
          </div>
          <div style={styles.rowControls}>
            <button
              onClick={() => setSelectedSection('rectangle')}
              style={styles.btn}
            >
              Open Windows
            </button>
          </div>
        </div>

        {/* Show in Dock - WIP feature, hidden until ready */}
        {/* Permission Reminders - removed, always show until permissions granted */}
        {/* Cursor Status Indicator - removed, always show the dot */}

        {hotkeyError && <p style={styles.error}>{hotkeyError}</p>}
      </div>
      )}

      {/* Audio & Transcription Section (combined) */}
      {selectedSection === 'audio' && (
      <>
      <div style={styles.section}>
        <SectionHeader title="Microphone" />
        <AudioSettingsPanel />
      </div>

      {/* Transcription Section */}
      <div style={styles.section}>
        <TranscriptionSettings />
      </div>

      {/* Word Substitutions Section */}
      <div style={styles.section}>
        <SectionHeader title="Word Corrections" />
        <p style={{ fontSize: '12px', color: theme.textSecondary, marginBottom: '12px' }}>
          Fix common transcription mistakes. Words on the left will be replaced with words on the right.
        </p>

        {/* Existing substitutions list */}
        {wordSubstitutions.length > 0 && (
          <div style={{
            marginBottom: '12px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}>
            {wordSubstitutions.map((sub, index) => (
              <div
                key={index}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  backgroundColor: theme.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)',
                  border: `1px solid ${theme.border}`,
                }}
              >
                <span style={{
                  flex: 1,
                  fontSize: '12px',
                  color: theme.text,
                  fontFamily: 'monospace',
                }}>
                  {sub.from}
                </span>
                <span style={{ color: theme.textSecondary, fontSize: '12px' }}>→</span>
                <span style={{
                  flex: 1,
                  fontSize: '12px',
                  color: theme.text,
                  fontFamily: 'monospace',
                }}>
                  {sub.to || '(remove)'}
                </span>
                <button
                  onClick={() => handleRemoveWordSubstitution(index)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: theme.textSecondary,
                    cursor: 'pointer',
                    padding: '4px',
                    fontSize: '14px',
                    lineHeight: 1,
                  }}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Add new substitution form */}
        <div style={{
          display: 'flex',
          gap: '8px',
          alignItems: 'center',
        }}>
          <input
            type="text"
            value={newSubFrom}
            onChange={(e) => setNewSubFrom(e.target.value)}
            placeholder="Heard as..."
            style={{
              ...styles.input,
              flex: 1,
              minWidth: 0,
              fontFamily: 'monospace',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newSubFrom.trim()) handleAddWordSubstitution();
            }}
          />
          <span style={{ color: theme.textSecondary, fontSize: '12px' }}>→</span>
          <input
            type="text"
            value={newSubTo}
            onChange={(e) => setNewSubTo(e.target.value)}
            placeholder="Change to..."
            style={{
              ...styles.input,
              flex: 1,
              minWidth: 0,
              fontFamily: 'monospace',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newSubFrom.trim()) handleAddWordSubstitution();
            }}
          />
          <button
            onClick={handleAddWordSubstitution}
            disabled={!newSubFrom.trim()}
            style={{
              ...styles.btn,
              opacity: newSubFrom.trim() ? 1 : 0.5,
              minWidth: '60px',
            }}
          >
            Add
          </button>
        </div>

        {wordSubstitutions.length === 0 && (
          <p style={{
            fontSize: '11px',
            color: theme.textSecondary,
            marginTop: '8px',
            fontStyle: 'italic',
          }}>
            Example: "main" → "main" (for git branches)
          </p>
        )}
      </div>
      </>
      )}

      {/* Portable Commands Section */}
      {selectedSection === 'commands' && (
      <>
      <div style={styles.section}>
        <SectionHeader title="Portable Commands" />
        <CommandsSettings />
      </div>

      </>
      )}

      {/* Librarian Section */}
      {selectedSection === 'librarian' && (
      <div style={styles.section}>
        <SectionHeader title="Librarian" />
        <LibrarianSettings
          librarianEnabled={librarianEnabled}
          onLibrarianEnabledChange={onLibrarianEnabledChange}
        />
      </div>
      )}

      {/* Allowlist Section */}
      {selectedSection === 'terminal-commands' && (
      <div style={styles.section}>
        <SectionHeader title="Allowlist" />
        <ClaudeSettings />
      </div>
      )}

      {/* Your Stats Section - user-visible usage metrics */}
      {selectedSection === 'stats' && (
      <div style={styles.section}>
        <UserStatsPanel />
      </div>
      )}

      {/* Hot Mic Section */}
      {selectedSection === 'hot-mic' && (
      <div style={styles.section}>
        <SectionHeader title="Hot Mic" />
        <HotMicSettings />
      </div>
      )}

      {/* Windows Section */}
      {selectedSection === 'rectangle' && (
      <div style={styles.section}>
        <RectangleSettings />
      </div>
      )}

      {/* Sounds Section */}
      {selectedSection === 'sounds' && (
      <div style={styles.section}>
        <SectionHeader title="Sounds" />
        <SoundsSettings />
      </div>
      )}

      {/* Account Section - combines account info, subscription, and support */}
      {selectedSection === 'account' && (() => {
        // Only trust cached 'pro' tier if user is actually signed in.
        const displayTier = session ? userTier : 'free';
        const tierDisplayName = displayTier === 'pro' ? 'Pro Plan' : 'Basic Plan';

        // Get display name from user metadata, fallback to email.
        const userFullName = session?.user?.user_metadata?.full_name as string | undefined;
        const userEmail = session?.user?.email;

        return (
          <div style={styles.section}>
            <SectionHeader title="Account" />

            {initialAuthLoading ? (
              <div style={styles.row}>
                <span style={{ color: theme.textSecondary, fontSize: '13px' }}>Loading...</span>
              </div>
            ) : session ? (
              <>
                {/* Email row with sign out */}
                <div style={styles.row}>
                  <span style={styles.rowValue}>{userEmail}</span>
                  <button
                    onClick={handleSignOut}
                    disabled={authLoading}
                    style={styles.linkBtn}
                  >
                    {authLoading ? 'Signing out...' : 'Sign Out'}
                  </button>
                </div>

                {/* Editable name row */}
                <div style={styles.row}>
                  <span style={styles.rowLabel}>Name</span>
                  {editingName ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <input
                        type="text"
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        placeholder="Full name"
                        disabled={savingName}
                        autoFocus
                        style={{
                          padding: '4px 8px',
                          fontSize: '13px',
                          border: `1px solid ${theme.border}`,
                          borderRadius: '4px',
                          backgroundColor: theme.bg,
                          color: theme.text,
                          width: '150px',
                        }}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            setSavingName(true);
                            try {
                              await window.authAPI?.updateFullName?.(nameInput.trim());
                              // Refresh session to get updated user data
                              const newSession = await window.authAPI?.getSession?.();
                              if (newSession) setSession(newSession);
                            } catch (err) {
                              console.error('Failed to save name:', err);
                            } finally {
                              setSavingName(false);
                              setEditingName(false);
                            }
                          } else if (e.key === 'Escape') {
                            setEditingName(false);
                            setNameInput(userFullName || '');
                          }
                        }}
                      />
                      <button
                        onClick={async () => {
                          setSavingName(true);
                          try {
                            await window.authAPI?.updateFullName?.(nameInput.trim());
                            const newSession = await window.authAPI?.getSession?.();
                            if (newSession) setSession(newSession);
                          } catch (err) {
                            console.error('Failed to save name:', err);
                          } finally {
                            setSavingName(false);
                            setEditingName(false);
                          }
                        }}
                        disabled={savingName}
                        style={styles.linkBtn}
                      >
                        {savingName ? '...' : 'Save'}
                      </button>
                      <button
                        onClick={() => {
                          setEditingName(false);
                          setNameInput(userFullName || '');
                        }}
                        disabled={savingName}
                        style={{ ...styles.linkBtn, color: theme.textSecondary }}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ ...styles.rowValue, color: userFullName ? theme.text : theme.textSecondary }}>
                        {userFullName || 'Not set'}
                      </span>
                      <button
                        onClick={() => {
                          setNameInput(userFullName || '');
                          setEditingName(true);
                        }}
                        style={styles.linkBtn}
                      >
                        {userFullName ? 'Edit' : 'Add'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Callsign row */}
                {callsign && (
                  <div style={styles.row}>
                    <span style={styles.rowLabel}>Callsign</span>
                    <span style={{
                      ...styles.rowValue,
                      fontFamily: 'SF Mono, Monaco, Consolas, monospace',
                      fontSize: '13px',
                      letterSpacing: '0.5px',
                    }}>
                      {callsign}
                    </span>
                  </div>
                )}

                {syncStatus && <p style={styles.syncStatusText}>{syncStatus}</p>}
                
                {/* Subscription row */}
                <div style={styles.row}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={styles.rowLabel}>Current Plan</span>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: '4px',
                          fontSize: '10px',
                          fontWeight: 600,
                          backgroundColor: displayTier === 'pro' ? theme.accent : theme.bgSecondary,
                          color: displayTier === 'pro' ? '#fff' : theme.textSecondary,
                        }}>
                          {tierDisplayName}
                        </span>
                      </div>
                      {displayTier === 'free' ? (
                        <button
                          onClick={() => {
                            const userId = session.user.id;
                            const paymentLink = window.stripeConfig?.paymentLink || '';
                            window.shellAPI?.openExternal(
                              `${paymentLink}?client_reference_id=${userId}`
                            );
                          }}
                          style={{
                            ...styles.linkBtn,
                            color: theme.accent,
                            fontWeight: 500,
                          }}
                        >
                          Upgrade
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            const portalLink = window.stripeConfig?.portalLink || '';
                            window.shellAPI?.openExternal(portalLink);
                          }}
                          style={styles.linkBtn}
                        >
                          Manage
                        </button>
                      )}
                    </div>

                    {displayTier === 'pro' ? (
                      <p style={styles.rowHint}>Unlimited priority mic and auto-stacking.</p>
                    ) : quotaStatus && quotaLimits ? (
                      <div style={{
                        marginTop: '12px',
                        padding: '12px',
                        borderRadius: '8px',
                        backgroundColor: theme.isDark ? theme.bgSecondary : '#f9fafb',
                        border: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}`,
                      }}>
                        {/* Priority Mic */}
                        <div style={{ marginBottom: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <span style={{ fontSize: '12px', color: theme.text }}>Priority Mic</span>
                            <span style={{ fontSize: '11px', color: quotaStatus.priorityMic.allowed ? theme.textSecondary : theme.error }}>
                              {Math.floor(quotaStatus.priorityMic.used / 60)} of {quotaLimits.priorityMicMinutes} mins
                            </span>
                          </div>
                          <div style={{ height: '4px', backgroundColor: theme.isDark ? theme.border : '#e5e7eb', borderRadius: '2px', overflow: 'hidden' }}>
                            <div style={{
                              height: '100%',
                              width: `${Math.min(100, quotaStatus.priorityMic.percentUsed)}%`,
                              backgroundColor: quotaStatus.priorityMic.allowed ? theme.accent : theme.error,
                              borderRadius: '2px',
                              transition: 'width 0.3s ease',
                            }} />
                          </div>
                        </div>

                        {/* Auto-Stack */}
                        <div style={{ marginBottom: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <span style={{ fontSize: '12px', color: theme.text }}>Auto-Stack</span>
                            <span style={{ fontSize: '11px', color: quotaStatus.autoStack.allowed ? theme.textSecondary : theme.error }}>
                              {quotaStatus.autoStack.used} of {quotaLimits.autoStackSessions} sessions
                            </span>
                          </div>
                          <div style={{ height: '4px', backgroundColor: theme.isDark ? theme.border : '#e5e7eb', borderRadius: '2px', overflow: 'hidden' }}>
                            <div style={{
                              height: '100%',
                              width: `${Math.min(100, quotaStatus.autoStack.percentUsed)}%`,
                              backgroundColor: quotaStatus.autoStack.allowed ? theme.accent : theme.error,
                              borderRadius: '2px',
                              transition: 'width 0.3s ease',
                            }} />
                          </div>
                        </div>

                        {/* Text Improvements */}
                        <div style={{ marginBottom: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <span style={{ fontSize: '12px', color: theme.text }}>Text Improvements</span>
                            <span style={{ fontSize: '11px', color: quotaStatus.textImprove.allowed ? theme.textSecondary : theme.error }}>
                              {(quotaStatus?.textImprove?.used ?? 0).toLocaleString()} of {(quotaLimits?.textImprovementWords ?? 0).toLocaleString()} words
                            </span>
                          </div>
                          <div style={{ height: '4px', backgroundColor: theme.isDark ? theme.border : '#e5e7eb', borderRadius: '2px', overflow: 'hidden' }}>
                            <div style={{
                              height: '100%',
                              width: `${Math.min(100, quotaStatus.textImprove.percentUsed)}%`,
                              backgroundColor: quotaStatus.textImprove.allowed ? theme.accent : theme.error,
                              borderRadius: '2px',
                              transition: 'width 0.3s ease',
                            }} />
                          </div>
                        </div>

                        {/* Portable Commands (includes voice commands) */}
                        <div style={{ marginBottom: '12px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                            <span style={{ fontSize: '12px', color: theme.text }}>Portable Commands</span>
                            <span style={{ fontSize: '11px', color: quotaStatus.portableCommands?.allowed !== false ? theme.textSecondary : theme.error }}>
                              {quotaStatus?.portableCommands?.used ?? 0} of {quotaLimits?.portableCommands ?? 0}
                            </span>
                          </div>
                          <div style={{ height: '4px', backgroundColor: theme.isDark ? theme.border : '#e5e7eb', borderRadius: '2px', overflow: 'hidden' }}>
                            <div style={{
                              height: '100%',
                              width: `${Math.min(100, quotaStatus?.portableCommands?.percentUsed ?? 0)}%`,
                              backgroundColor: quotaStatus?.portableCommands?.allowed !== false ? theme.accent : theme.error,
                              borderRadius: '2px',
                              transition: 'width 0.3s ease',
                            }} />
                          </div>
                        </div>

                        {/* Reset info */}
                        <div style={{ fontSize: '11px', color: theme.textSecondary, textAlign: 'center', paddingTop: '4px', borderTop: `1px solid ${theme.isDark ? theme.border : '#e5e7eb'}` }}>
                          Resets in {daysUntilReset} day{daysUntilReset !== 1 ? 's' : ''}
                        </div>
                      </div>
                    ) : (
                      <p style={styles.rowHint}>Loading quota info...</p>
                    )}
                  </div>
                </div>

              </>
            ) : (
              <>
                {/* Not signed in state */}
                <div style={styles.row}>
                  <span style={styles.rowValue}>Not signed in</span>
                  <button onClick={onNavigateToSignIn} style={styles.linkBtn}>
                    Sign in
                  </button>
                </div>
              </>
            )}

            {/* Support section - shown for all users */}
            <SectionHeader title="Support" />
            <div style={styles.row}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={styles.rowLabel}>Launch on Login</span>
                <span style={styles.rowHint}>Start Field Theory when you log in</span>
              </div>
              <label style={styles.toggleContainer}>
                <input
                  type="checkbox"
                  checked={launchAtLogin}
                  onChange={async (e) => {
                    const enabled = e.target.checked;
                    setLaunchAtLogin(enabled);
                    await window.clipboardAPI?.setLaunchAtLogin?.(enabled);
                  }}
                  style={styles.toggleInput}
                />
                <span style={styles.toggleSlider} />
              </label>
            </div>
            <div style={styles.row}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={styles.rowLabel}>Diagnostics</span>
                <span style={styles.rowHint}>View system info for troubleshooting</span>
              </div>
              <button
                onClick={() => setShowDiagnostics(true)}
                style={styles.linkBtn}
              >
                View
              </button>
            </div>
            <div style={styles.row}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={styles.rowLabel}>Restart Onboarding</span>
                <span style={styles.rowHint}>Go through the setup flow again</span>
              </div>
              <button
                onClick={() => window.onboardingAPI?.reset?.()}
                style={styles.linkBtn}
              >
                Start
              </button>
            </div>
            <div style={styles.row}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={styles.rowLabel}>Contact Support</span>
                <span style={styles.rowHint}>
                  Email us at{' '}
                  <span
                    onClick={() => window.shellAPI?.openExternal('mailto:support@fieldtheory.dev')}
                    style={{ color: theme.accent, cursor: 'pointer' }}
                  >
                    support@fieldtheory.dev
                  </span>
                  {' '}or use the Feedback button
                </span>
              </div>
              <button
                onClick={onNavigateToFeedback}
                style={styles.linkBtn}
              >
                Feedback
              </button>
            </div>

            {/* Delete Account - only show when signed in */}
            {session && (
              <div style={{ ...styles.row, marginTop: '24px', borderTop: `1px solid ${theme.border}`, paddingTop: '16px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span style={{ ...styles.rowLabel, color: theme.error }}>Delete Account</span>
                  <span style={styles.rowHint}>Permanently delete your account and all data</span>
                </div>
                <button
                  onClick={() => setShowDeleteModal(true)}
                  style={{ ...styles.linkBtn, color: theme.error }}
                >
                  Delete
                </button>
              </div>
            )}

          </div>
        );
      })()}

      </div>
      {/* End of content area */}


      {/* Delete Account Confirmation Modal */}
      {showDeleteModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => {
            setShowDeleteModal(false);
            setDeleteConfirmEmail('');
            setDeleteError(null);
          }}
        >
          <div
            style={{
              backgroundColor: theme.bg,
              borderRadius: '12px',
              padding: '20px',
              width: '400px',
              maxWidth: '90%',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 12px 0', fontSize: '15px', fontWeight: 600, color: theme.text }}>
              Delete Account / Cancel Subscription
            </h3>
            <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: theme.textSecondary, lineHeight: 1.5 }}>
              This will permanently delete:
            </p>
            <ul style={{ margin: '0 0 12px 0', paddingLeft: '20px', fontSize: '12px', color: theme.textSecondary, lineHeight: 1.5 }}>
              <li>Your account and profile</li>
              <li>All shared items</li>
              {userTier === 'pro' && <li>Any existing Pro subscription ($14/month)</li>}
            </ul>
            <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: theme.textSecondary, lineHeight: 1.5 }}>
              <strong>Important:</strong> You may continue to use the Basic plan without an account.
              Sign in again anytime to access Pro features.
            </p>
            <input
              type="email"
              placeholder="Type your email to confirm"
              value={deleteConfirmEmail}
              onChange={(e) => setDeleteConfirmEmail(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '12px',
                border: `1px solid ${theme.border}`,
                borderRadius: '6px',
                backgroundColor: theme.bg,
                color: theme.text,
                marginBottom: '12px',
                boxSizing: 'border-box',
              }}
            />
            {deleteError && (
              <p style={{ margin: '0 0 12px 0', fontSize: '12px', color: theme.error }}>
                {deleteError}
              </p>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteConfirmEmail('');
                  setDeleteError(null);
                }}
                style={{
                  ...styles.btn,
                  backgroundColor: 'transparent',
                  color: theme.textSecondary,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deleteLoading || deleteConfirmEmail.toLowerCase() !== session?.user?.email?.toLowerCase()}
                style={{
                  ...styles.btn,
                  backgroundColor: theme.error,
                  color: '#fff',
                  border: 'none',
                  opacity: deleteLoading || deleteConfirmEmail.toLowerCase() !== session?.user?.email?.toLowerCase() ? 0.5 : 1,
                }}
              >
                {deleteLoading ? 'Deleting...' : userTier === 'pro' ? 'Delete and Cancel' : 'Delete Account'}
              </button>
            </div>
          </div>
        </div>
      )}

      </div>

      {/* Diagnostics Modal */}
      <DiagnosticsModal
        isOpen={showDiagnostics}
        onClose={() => setShowDiagnostics(false)}
        onSendAsFeedback={onNavigateToFeedback}
      />
    </div>
  );
}

// Styles consistent with ClipboardHistory styling
const getStyles = (theme: Theme): Record<string, React.CSSProperties> => ({
  // New sidebar layout
  settingsLayout: {
    display: 'flex',
    flex: 1,
    minHeight: 0, // Required for flex children to shrink below content size
    boxSizing: 'border-box',
    borderTop: `1px solid ${theme.border}`,
    position: 'relative' as const,
  },
  sidebar: {
    width: '208px',
    minWidth: '208px',
    padding: '16px 14px 24px 14px',
    borderRight: `1px solid ${theme.border}`,
    backgroundColor: theme.surface0,
    overflowY: 'auto',
    boxSizing: 'border-box',
  },
  sidebarNav: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  sidebarItem: {
    padding: '9px 12px',
    fontSize: '12px',
    fontWeight: 500,
    textAlign: 'left',
    border: '1px solid transparent',
    borderRadius: '10px',
    cursor: 'pointer',
    transition: 'background-color 0.15s, color 0.15s, border-color 0.15s',
    outline: 'none',
  },
  content: {
    flex: 1,
    minHeight: 0, // Required for flex children to shrink below content size
    padding: '24px 28px 40px 28px',
    overflowY: 'auto',
    boxSizing: 'border-box',
  },
  contentInner: {
    width: '100%',
    maxWidth: '780px',
    margin: '0 auto',
  },
  // Legacy container (kept for compatibility)
  container: {
    padding: '16px',
    overflowY: 'auto',
    height: '100%',
    boxSizing: 'border-box',
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  loadingText: {
    color: theme.textSecondary,
    fontSize: '12px',
  },

  // ==========================================================================
  // NEW UNIFIED DESIGN SYSTEM - Only 2 font sizes: 13px body, 11px headers
  // ==========================================================================

  title: {
    fontSize: '12px',
    fontWeight: 600,
    marginTop: 0,
    marginBottom: '24px',
    color: theme.text,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },

  // Section with divider line
  section: {
    ...getSettingsSurfaceStyle(theme),
    marginBottom: '20px',
  },
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginTop: 0,
    marginBottom: '14px',
  },
  sectionTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: theme.text,
    letterSpacing: '-0.01em',
    whiteSpace: 'nowrap' as const,
  },
  sectionLine: {
    flex: 1,
    height: '1px',
    backgroundColor: theme.isDark ? theme.border : '#edf1f5',
  },

  // Flat row layout: label left, control right
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 0',
    minHeight: '42px',
  },
  rowLabel: {
    fontSize: '12px',
    color: theme.text,
    fontWeight: 500,
  },
  rowValue: {
    fontSize: '12px',
    color: theme.text,
    fontWeight: 500,
  },
  rowControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  rowHint: {
    fontSize: '11px',
    color: theme.textSecondary,
    fontWeight: 400,
    lineHeight: 1.45,
  },

  // Unified button styles
  btn: {
    padding: '7px 12px',
    fontSize: '12px',
    fontWeight: 500,
    color: theme.text,
    backgroundColor: theme.isDark ? theme.surface2 : '#fff',
    border: `1px solid ${theme.border}`,
    borderRadius: '8px',
    cursor: 'pointer',
    minWidth: '80px',
    textAlign: 'center' as const,
  },
  btnActive: {
    backgroundColor: theme.accent,
    color: '#fff',
    borderColor: theme.accent,
  },
  btnDanger: {
    color: theme.error,
    borderColor: theme.isDark ? 'rgba(248,113,113,0.3)' : '#fecaca',
    backgroundColor: theme.errorBg,
  },
  btnSuccess: {
    color: '#fff',
    backgroundColor: theme.accent,
    borderColor: theme.accent,
  },
  btnGhost: {
    backgroundColor: 'transparent',
    border: 'none',
    color: theme.textSecondary,
    minWidth: 'auto',
    padding: '6px 8px',
  },
  linkBtn: {
    backgroundColor: 'transparent',
    border: 'none',
    color: theme.textSecondary,
    fontSize: '12px',
    padding: '4px 0',
    cursor: 'pointer',
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
  },

  // Toggle switch
  toggle: {
    position: 'relative' as const,
    width: '44px',
    minWidth: '44px',
    height: '24px',
    minHeight: '24px',
    borderRadius: '12px',
    cursor: 'pointer',
    border: 'none',
    padding: 0,
    flexShrink: 0,
    transition: 'background-color 0.2s',
  },
  toggleKnob: {
    position: 'absolute' as const,
    top: '2px',
    left: 0,
    width: '20px',
    height: '20px',
    borderRadius: '10px',
    backgroundColor: '#fff',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
    transition: 'transform 0.2s',
  },

  // Select dropdown
  select: {
    padding: '8px 12px',
    fontSize: '12px',
    color: theme.text,
    backgroundColor: theme.isDark ? theme.surface2 : '#fff',
    border: `1px solid ${theme.border}`,
    borderRadius: '8px',
    cursor: 'pointer',
    minWidth: '160px',
  },

  // Input field
  input: {
    padding: '8px 12px',
    fontSize: '12px',
    color: theme.text,
    backgroundColor: theme.isDark ? theme.surface2 : '#fff',
    border: `1px solid ${theme.border}`,
    borderRadius: '8px',
    outline: 'none',
    flex: 1,
  },

  // Status indicators
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    display: 'inline-block',
    marginRight: '6px',
  },
  statusGreen: { backgroundColor: theme.success },
  statusYellow: { backgroundColor: theme.warning },
  statusRed: { backgroundColor: theme.error },
  statusGray: { backgroundColor: theme.textSecondary },

  // Error text
  error: {
    fontSize: '12px',
    color: theme.error,
    marginTop: '4px',
  },

  // Model list (compact)
  modelRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 0',
    borderBottom: `1px solid ${theme.border}`,
  },
  modelName: {
    fontSize: '12px',
    color: theme.text,
  },
  modelSize: {
    fontSize: '12px',
    color: theme.textSecondary,
    marginLeft: '8px',
  },

  // Permissions warning (compact)
  permissionsWarning: {
    backgroundColor: theme.warningBg,
    border: `1px solid ${theme.warning}`,
    borderRadius: '6px',
    padding: '12px',
    marginBottom: '20px',
  },
  permissionsContent: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  permissionsText: {
    fontSize: '12px',
    color: theme.isDark ? theme.warning : '#92400e',
    margin: 0,
  },
  permissionsButton: {
    padding: '6px 12px',
    backgroundColor: theme.warning,
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 500,
  },

  // Login form (compact)
  loginForm: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  },

  // Legacy compatibility - keeping for nested components
  hotkeyCard: {
    padding: 0,
  },
  hotkeyRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 0',
    minHeight: '36px',
  },
  hotkeyLabel: {
    fontSize: '12px',
    color: theme.text,
  },
  hotkeyButtonRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  hotkeyButton: {
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: 500,
    color: theme.text,
    backgroundColor: theme.isDark ? theme.bg : '#fff',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
    cursor: 'pointer',
  },
  hotkeyButtonActive: {
    backgroundColor: theme.accent,
    color: '#fff',
    borderColor: theme.accent,
  },
  cancelButton: {
    padding: '6px 8px',
    fontSize: '12px',
    color: theme.textSecondary,
    backgroundColor: 'transparent',
    border: 'none',
    cursor: 'pointer',
  },
  hotkeyError: {
    fontSize: '12px',
    color: theme.error,
    marginTop: '4px',
  },
  loginInput: {
    padding: '8px 12px',
    fontSize: '12px',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
    backgroundColor: theme.isDark ? theme.bg : '#fff',
    color: theme.text,
  },
  loginButton: {
    padding: '8px 16px',
    fontSize: '12px',
    fontWeight: 500,
    color: '#fff',
    backgroundColor: theme.accent,
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
  },
  signOutButton: {
    padding: '6px 12px',
    fontSize: '12px',
    color: theme.textSecondary,
    backgroundColor: 'transparent',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
    cursor: 'pointer',
  },
  syncControls: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  syncButton: {
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: 500,
    color: theme.text,
    backgroundColor: theme.isDark ? theme.bg : '#fff',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
    cursor: 'pointer',
  },
  fixButton: {
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: 500,
    color: theme.textSecondary,
    backgroundColor: theme.isDark ? theme.bg : '#f9fafb',
    border: `1px solid ${theme.border}`,
    borderRadius: '6px',
    cursor: 'pointer',
  },
  syncStatusText: {
    fontSize: '12px',
    color: theme.textSecondary,
    marginTop: '4px',
  },
  sectionDescription: {
    display: 'none', // Hide verbose descriptions in new design
  },
  hotkeyTitle: {
    display: 'none', // Hide nested titles in new design
  },
  hotkeyHelp: {
    display: 'none', // Hide help text in new design
  },
});
