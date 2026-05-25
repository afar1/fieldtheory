import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';

import { createLogger } from './logger';
import { ModelSize } from './modelManager';
import {
  createDefaultGazeWindowFocusConfig,
  type GazeDebugOverlayBounds,
  type GazePersonalOffsets,
  type GazeWindowFocusConfig,
} from './types/gaze';

const log = createLogger('Preferences');
import { UserDataManager, getUserDataManager } from './userDataManager';

/**
 * Window state for persistence.
 */
interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

/**
 * Clipboard history dialog bounds for persistence.
 * Supports both old format (x, y in absolute screen coordinates) and new format
 * (relativeX, relativeY relative to display, with displayId for matching).
 */
export interface ClipboardHistoryBounds {
  // Legacy absolute coordinates (for backward compatibility)
  x?: number;
  y?: number;
  // New display-relative coordinates
  relativeX?: number;
  relativeY?: number;
  width: number;
  height: number;
  // Display identifier (e.g., "1920x1080@0,0") for matching displays
  displayId?: string;
  displayConfig: string; // Hash of display arrangement to detect changes
}

/**
 * Logical "size profile" the clipboard-history window uses. Each view kind
 * persists its own bounds so switching views restores the user's preferred
 * dims for that view.
 */
export type ClipboardHistorySizeKey = 'fields' | 'library' | 'canvas' | 'draw';
export type FieldTheoryWindowMode = 'panel' | 'app';
export const LAUNCHER_ROOT_SEARCH_KINDS = [
  'system-setting',
  'contact',
  'file',
  'recent-document',
  'url',
  'web-search',
  'calculator',
  'dictionary',
  'calendar',
  'system-command',
] as const;
export type LauncherRootSearchKind = typeof LAUNCHER_ROOT_SEARCH_KINDS[number];
export type LauncherRootSearchEnabledKinds = Partial<Record<LauncherRootSearchKind, boolean>>;
export const DEFAULT_LAUNCHER_ROOT_SEARCH_ENABLED_KINDS: Record<LauncherRootSearchKind, boolean> = {
  'system-setting': false,
  contact: false,
  file: true,
  'recent-document': false,
  url: false,
  'web-search': false,
  calculator: false,
  dictionary: false,
  calendar: false,
  'system-command': false,
};

export const DEFAULT_MEETING_SUMMARY_PROMPT = [
  'Given this meeting markdown, update only the Summary section.',
  'Preserve frontmatter, Notes, Transcript, speaker labels and stable speaker IDs if present, links, figures, and checkboxes.',
  'Do not renumber speakers or invent speaker names unless they are already present in the meeting note.',
  'Keep user-written notes intact. Do not delete or rewrite raw transcript text.',
  'Use concise organized markdown with Decisions, Action Items, Open Questions, and Notable Context when present.',
  'Return the full replacement markdown document.',
].join('\n');

export function normalizeLauncherRootSearchEnabledKinds(
  value: LauncherRootSearchEnabledKinds | undefined,
): Record<LauncherRootSearchKind, boolean> {
  const normalized = { ...DEFAULT_LAUNCHER_ROOT_SEARCH_ENABLED_KINDS };
  if (!value || typeof value !== 'object') return normalized;
  for (const kind of LAUNCHER_ROOT_SEARCH_KINDS) {
    if (typeof value[kind] === 'boolean') normalized[kind] = value[kind];
  }
  return normalized;
}

export interface FieldTheoryWindowModePreferenceSnapshot {
  fieldTheoryWindowMode?: FieldTheoryWindowMode;
  showInDock?: boolean;
  clickAwayToDismiss?: boolean;
}

export type ClipboardHistoryBoundsByView = Partial<Record<ClipboardHistorySizeKey, ClipboardHistoryBounds>>;

export function normalizeClipboardHistorySizeKey(key: ClipboardHistorySizeKey): ClipboardHistorySizeKey {
  return key === 'canvas' ? 'draw' : key;
}

/**
 * Resolve the saved bounds for a given size-key from a preferences snapshot.
 * Falls back to the legacy single-bounds field (`clipboardHistoryBounds`) only
 * for the 'fields' key, so users upgrading from a build with no per-view
 * bounds don't lose their remembered position for the default surface.
 */
export function pickSavedBoundsByKey(
  prefs: { clipboardHistoryBoundsByView?: ClipboardHistoryBoundsByView; clipboardHistoryBounds?: ClipboardHistoryBounds } | null | undefined,
  key: ClipboardHistorySizeKey
): ClipboardHistoryBounds | undefined {
  const normalizedKey = normalizeClipboardHistorySizeKey(key);
  const byView = prefs?.clipboardHistoryBoundsByView?.[normalizedKey];
  if (byView) return byView;
  if (normalizedKey === 'fields') return prefs?.clipboardHistoryBounds;
  return undefined;
}

export function resolveFieldTheoryWindowMode(
  prefs: FieldTheoryWindowModePreferenceSnapshot | null | undefined
): FieldTheoryWindowMode {
  if (prefs?.fieldTheoryWindowMode === 'app' || prefs?.fieldTheoryWindowMode === 'panel') {
    return prefs.fieldTheoryWindowMode;
  }

  if (prefs?.showInDock === true || prefs?.clickAwayToDismiss === false) {
    return 'app';
  }
  if (prefs?.showInDock === false || prefs?.clickAwayToDismiss === true) {
    return 'panel';
  }

  return 'app';
}

function normalizeFieldTheoryWindowMode(prefs: Partial<Preferences>): Partial<Preferences> {
  const hasExplicitMode = prefs.fieldTheoryWindowMode === 'app' || prefs.fieldTheoryWindowMode === 'panel';
  const hasLegacyAppMode = prefs.showInDock === true || prefs.clickAwayToDismiss === false;
  const hasLegacyPanelMode = prefs.showInDock === false || prefs.clickAwayToDismiss === true;

  if (hasExplicitMode || hasLegacyAppMode || hasLegacyPanelMode) {
    const mode = resolveFieldTheoryWindowMode(prefs);
    return { ...prefs, fieldTheoryWindowMode: mode, showInDock: mode === 'app', clickAwayToDismiss: mode === 'panel' };
  }

  return prefs;
}

function normalizeFieldTheoryWindowModeSavePatch(prefs: Partial<Preferences>): Partial<Preferences> {
  if (prefs.fieldTheoryWindowMode === 'app' || prefs.fieldTheoryWindowMode === 'panel') {
    const mode = prefs.fieldTheoryWindowMode;
    return { ...prefs, fieldTheoryWindowMode: mode, showInDock: mode === 'app', clickAwayToDismiss: mode === 'panel' };
  }

  if (prefs.showInDock === true || prefs.showInDock === false) {
    const mode = prefs.showInDock ? 'app' : 'panel';
    return { ...prefs, fieldTheoryWindowMode: mode, showInDock: mode === 'app', clickAwayToDismiss: mode === 'panel' };
  }

  return prefs;
}

// Note: LocalQuotas interface removed - server is now single source of truth for usage tracking.

/**
 * Application preferences stored in userData directory.
 */
interface Preferences {
  transcriptionHotkey: string;
  transcriptionSecondaryHotkey?: string | null;
  selectedModel: ModelSize;
  windowState?: WindowState;
  clipboardScreenshotHotkey?: string | null;
  clipboardDesktopScreenshotHotkey?: string | null;
  clipboardFullScreenHotkey?: string | null;
  clipboardActiveWindowHotkey?: string | null;
  clipboardHistoryHotkey?: string | null;
  priorityDeviceId?: string | null;
  favoriteDeviceName?: string | null; // For auto-reconnect when device reappears
  clipboardHistoryBounds?: ClipboardHistoryBounds;
  /** Per-view-kind bounds. Takes precedence over clipboardHistoryBounds. */
  clipboardHistoryBoundsByView?: ClipboardHistoryBoundsByView;
  /** Last active size profile, so reopen starts at the same view size. */
  clipboardHistoryLastSizeKey?: ClipboardHistorySizeKey;
  /** Last bounds for standalone Library document windows. */
  libraryDocumentWindowBounds?: ClipboardHistoryBounds;

  // Onboarding state - tracks whether user has completed first-run setup.
  onboardingComplete?: boolean;
  onboardingStep?: number; // For resuming interrupted onboarding
  
  // Continuous Context feature - allows continuous screenshotting with stacked results
  continuousContextEnabled?: boolean;
  continuousContextHotkey?: string;
  
  // Tasks tab visibility - hidden by default
  tasksTabEnabled?: boolean;

  // Previously hardcoded hotkeys - now customizable
  superPasteHotkey?: string;
  commandLauncherHotkey?: string;
  scratchpadHotkey?: string;
  autoImproveHotkey?: string;
  
  // Note: improvedPromptsCount removed - server tracks text improve usage via improve-text edge function

  // Abandon recording settings - hotkey to cancel recording and whether to confirm
  abandonRecordingHotkey?: string;
  abandonRecordingConfirmation?: boolean;

  // Auto-improve transcripts - automatically run AI improvement on completed transcripts
  autoImproveTranscripts?: boolean;
  // Minimum word count for auto-improve - only improve transcripts with at least this many words
  autoImproveMinWords?: number;  // Default: 100, Range: 0-500, Increment: 10

  // Auto-improve usage stats - cumulative all-time tracking
  autoImproveStats?: {
    wordsImproved: number;
    apiCalls: number;
    inputTokens: number;
    outputTokens: number;
  };

  // Sound settings - optional sounds for recording actions.
  // soundsEnabled controls "other sounds" (recording, window, paste, etc.)
  // librarianSoundEnabled controls the artifact discovery sound separately
  soundsEnabled?: boolean;
  librarianSoundEnabled?: boolean; // Librarian artifact discovery sound (separate from other sounds)
  
  // Permission banner settings - hide banner prompting for Screen Recording permission.
  hideScreenRecordingBanner?: boolean;
  
  // Cursor status indicator - shows colored dot next to cursor during recording/transcribing.
  cursorStatusEnabled?: boolean;
  
  // Hide status text labels - show only colored dots (red/purple/green).
  hideStatusLabels?: boolean;

  // Note: localQuotas removed - server is now single source of truth for usage tracking.
  
  // Show in Dock and Cmd+Tab - when enabled, app appears in Dock and application switcher.
  showInDock?: boolean;

  // Field Theory window behavior - panel uses the current floating overlay mechanics,
  // app behaves like a normal app window with Dock/Cmd+Tab presence.
  fieldTheoryWindowMode?: FieldTheoryWindowMode;

  // Click-away dismissal - when enabled, the panel hides after focus moves to another app.
  clickAwayToDismiss?: boolean;

  // Show fieldtheory.dev link in footer - toggleable per user preference.
  showFieldTheoryLink?: boolean;

  // In-app Performance HUD - lightweight CPU/RAM/FPS overlay for debugging.
  performanceHudEnabled?: boolean;

  // Hidden internal switch for unfinished Field Theory cloud sync surfaces.
  // Add a Supabase allowlist before enabling this outside dev.
  fieldTheoryInternalSyncEnabled?: boolean;

  // Launch at login - start Field Theory automatically when macOS starts.
  launchAtLogin?: boolean;

  // Portable Commands - directory path where user's command markdown files are stored.
  // Can point to Claude skills, Cursor rules, or any directory with .md files.
  commandsDirectory?: string;

  // Maxwell local command memory. Content lives in maxwell/memory.md.
  maxwellMemoryEnabled?: boolean;

  // Maxwell meeting summaries - user-customizable prompt/style contract.
  meetingSummaryPrompt?: string;

  // Launcher root search categories. Apps and file search are the first active slices.
  launcherRootSearchEnabledKinds?: LauncherRootSearchEnabledKinds;

  // Dark mode preference - synced across all windows.
  darkMode?: boolean;

  // Word substitutions - pairs of [from, to] for transcription correction.
  // Example: ["main", "main"] for correcting "main" state to "main" branch.
  wordSubstitutions?: Array<{ from: string; to: string }>;

  // Data retention - how long to keep clipboard history items.
  // Values: 2, 7, 30, 90 (days) or -1 (never delete)
  dataRetentionDays?: number;

  // Cached tier - persisted locally so Pro users don't get downgraded on startup.
  // Server is authoritative; this is only for offline/startup display.
  cachedTier?: 'free' | 'pro';

  // Transcription engine selection. See TranscriptionEngine type in types/transcribe.ts.
  transcriptionEngine?: 'whisper' | 'mlx-whisper' | 'parakeet' | 'parakeet-multilingual';
  transcriptionInputSource?: 'microphone' | 'system-audio';

  // Hot Mic - continuous voice input for Claude Code terminals.
  // When enabled, auto-records voice fragments and injects them into a target terminal.
  hotMicEnabled?: boolean;
  hotMicMuted?: boolean;
  hotMicTranscriptionEngine?: 'default' | 'whisper' | 'mlx-whisper' | 'parakeet' | 'parakeet-multilingual'; // Deprecated: Hot Mic now follows transcriptionEngine
  hotMicAllowWhisperFallback?: boolean; // Deprecated: Hot Mic no longer silently falls back to whisper.cpp
  hotMicWhisperModel?: ModelSize; // Deprecated: Hot Mic now follows selectedModel
  hotMicTargetBundleId?: string; // e.g., "com.mitchellh.ghostty"
  hotMicSoundsEnabled?: boolean;
  hotMicWakeWord?: string; // Deprecated — use hotMicSubmitWord
  hotMicSubmitWord?: string; // Word that flushes the transcript buffer (default: "go")
  hotMicBufferDiscardMs?: number; // Silence timeout to discard buffer (default: 15000)
  hotMicPasteWords?: string; // Comma-separated words that flush buffer without submitting
  hotMicCancelWords?: string; // Comma-separated words that send Ctrl+C to terminal
  hotMicScrapWords?: string; // Comma-separated words that clear current hot mic draft text
  hotMicShowWordCount?: boolean; // Show word count on cursor indicator (default: false)
  hotMicPrevWindowWords?: string; // Comma-separated words that cycle to previous window (Cmd+Shift+`)
  hotMicNewWindowWords?: string; // Comma-separated phrases that open a new window (Cmd+N)
  hotMicCloseWindowWords?: string; // Comma-separated phrases that close the window (Cmd+W)
  hotMicMinimizePhrases?: string; // Comma-separated phrases that minimize the window (Cmd+M)
  hotMicHidePhrases?: string; // Comma-separated phrases that hide the app (Cmd+H)
  hotMicQuitPhrases?: string; // Comma-separated phrases that quit the current app (Cmd+Q) or quit by name
  hotMicSwitchWords?: string; // Comma-separated words that trigger Cmd+` window cycling
  hotMicOpenAppPrefixes?: string; // Comma-separated app-open prefixes (e.g. "open, switch to, go to")
  hotMicQuitAppPrefixes?: string; // Comma-separated app-quit prefixes (e.g. "quit, close, kill")
  hotMicRunClaudeWords?: string; // Comma-separated phrases that type "claude" and submit (start a session)
  hotMicRunCodexWords?: string; // Comma-separated phrases that type "codex" and submit (start a session)
  hotMicRestartServerWords?: string; // Comma-separated phrases that trigger restart (Ctrl+C then run command)
  hotMicFocusPhrases?: string; // Comma-separated phrases that trigger focus (next-display + center)
  hotMicCascadePhrases?: string; // Comma-separated phrases that trigger cascade + center
  hotMicBackgroundFilterEnabled?: boolean; // Filter ambient/far-field speech before chunk transcription
  hotMicBackgroundFilterStrength?: number; // 0-100 strictness slider for background filtering
  hotMicDrawerTextSize?: number; // Drawer transcript text size in px
  hotMicRectangleCommands?: Record<string, string>; // Window action name → comma-separated trigger phrases
  hotMicRestartServerCommand?: string; // Terminal command to run after Ctrl+C (e.g. "npm run dev")
  hotMicHotkey?: string | null; // Hotkey to toggle Hot Mic on/off (unset by default)
  hotMicAppAliases?: Array<{ appName: string; aliases: string }>; // Voice aliases for app switching

  // System voice commands — user-customizable trigger phrases
  hotMicPlayPausePhrases?: string;
  hotMicNextTrackPhrases?: string;
  hotMicPrevTrackPhrases?: string;
  hotMicVolumeUpPhrases?: string;
  hotMicVolumeDownPhrases?: string;
  hotMicMutePhrases?: string;
  hotMicUnmutePhrases?: string;
  hotMicSleepPhrases?: string;
  hotMicLockPhrases?: string;

  // Dynamic Island display preference.
  // When true, the island stays on the built-in laptop display even when an external monitor is primary.
  hotMicIslandStayOnLaptop?: boolean;
  recordingIndicatorMode?: 'auto' | 'notch' | 'floating';
  floatingIndicatorPosition?: { x: number; y: number } | null;

  // Auto-hide the Dynamic Island pills (left + right + gap filler) until
  // the cursor approaches the notch or a non-idle state / hot-mic becomes active.
  hotMicIslandAutoHide?: boolean;

  // Dynamic Island geometry tuning (Hot Mic settings).
  // notchWidthOverride: 0 means automatic profile-based notch width.
  hotMicIslandNotchWidthOverride?: number;
  hotMicIslandPillWidth?: number;
  hotMicIslandPillHeight?: number;
  hotMicIslandOffsetX?: number;
  hotMicIslandOffsetY?: number;

  // Squares - window management config and hotkeys.
  // Window management.
  squaresConfig?: any;   // SquaresConfig from types/squares.ts
  squaresHotkeys?: any;  // SquaresHotkeys from types/squares.ts

  // Eye tracking / gaze pipeline.
  // Disabled by default and only starts capture when explicitly enabled.
  gazeTrackingEnabled?: boolean;
  gazePersonalOffsets?: GazePersonalOffsets | null;
  gazeLastCalibratedAtMs?: number | null;
  gazeWindowFocusConfig?: GazeWindowFocusConfig;
  gazeDebugOverlayEnabled?: boolean;
  gazeDebugOverlayBounds?: GazeDebugOverlayBounds | null;
  gazeScreenOverlayEnabled?: boolean;
}

const DEFAULT_PREFERENCES: Preferences = {
  transcriptionHotkey: 'Option+/',
  selectedModel: 'small',
  clipboardHistoryLastSizeKey: 'fields',
  transcriptionInputSource: 'microphone',
  clipboardScreenshotHotkey: 'Alt+4',
  clipboardDesktopScreenshotHotkey: 'Alt+3',
  clipboardHistoryHotkey: 'Alt+Space',
  continuousContextEnabled: false,
  continuousContextHotkey: 'Shift+Alt+4', // Default: Shift + screenshot hotkey
  abandonRecordingHotkey: 'Escape', // Default: Escape key to cancel recording
  abandonRecordingConfirmation: true, // Default: confirm before abandoning if there's audio
  // Previously hardcoded hotkeys - now customizable
  superPasteHotkey: 'Command+Shift+V',
  commandLauncherHotkey: 'Command+Shift+K',
  scratchpadHotkey: 'Control+Option+Command+Space',
  autoImproveHotkey: 'Command+Shift+\\',
  autoImproveTranscripts: false,

  // Sound settings - librarian sound ON by default, other sounds OFF by default
  soundsEnabled: false,  // Other sounds (recording, window, paste) - off by default
  librarianSoundEnabled: true,  // Librarian artifact discovery sound - on by default
  
  // Cursor status indicator - enabled by default
  cursorStatusEnabled: true,
  
  // Hide status text labels - show only colored dots (red/purple/green). Disabled by default.
  hideStatusLabels: false,

  // Show in Dock by default. Kept for legacy callers.
  showInDock: true,

  // Field Theory opens as a normal app window by default.
  fieldTheoryWindowMode: 'app',

  // App-window mode does not hide just because focus moves elsewhere.
  clickAwayToDismiss: false,

  // Dark mode - disabled by default (light mode).
  darkMode: false,

  // Performance HUD - disabled by default.
  performanceHudEnabled: false,

  // Field Theory cloud sync is internal-only for this release.
  fieldTheoryInternalSyncEnabled: false,

  // Word substitutions - empty by default.
  wordSubstitutions: [],

  // Maxwell memory is explicit, visible, and opt-out.
  maxwellMemoryEnabled: true,

  // Meeting summary prompt defaults to preserving the note as the source of truth.
  meetingSummaryPrompt: DEFAULT_MEETING_SUMMARY_PROMPT,

  // Launcher root search starts with apps and Spotlight-backed file search.
  launcherRootSearchEnabledKinds: DEFAULT_LAUNCHER_ROOT_SEARCH_ENABLED_KINDS,

  // Data retention - never delete by default.
  dataRetentionDays: -1,

  // Hot Mic background filtering is opt-in by default.
  hotMicMuted: false,
  hotMicTranscriptionEngine: 'default',
  hotMicAllowWhisperFallback: false,
  hotMicWhisperModel: 'small',
  hotMicBackgroundFilterEnabled: false,
  hotMicBackgroundFilterStrength: 4,
  hotMicDrawerTextSize: 14,
  hotMicIslandStayOnLaptop: false,
  recordingIndicatorMode: 'auto',
  floatingIndicatorPosition: null,
  hotMicIslandAutoHide: false,
  hotMicIslandNotchWidthOverride: 0,
  hotMicIslandPillWidth: 72,
  hotMicIslandPillHeight: 38,
  hotMicIslandOffsetX: 0,
  hotMicIslandOffsetY: 0,

  // Gaze tracking is opt-in.
  gazeTrackingEnabled: false,
  gazePersonalOffsets: null,
  gazeLastCalibratedAtMs: null,
  gazeWindowFocusConfig: createDefaultGazeWindowFocusConfig(),
  gazeDebugOverlayEnabled: false,
  gazeDebugOverlayBounds: null,
  gazeScreenOverlayEnabled: false,
};

const SHARED_HOTKEY_PREFERENCE_KEYS = [
  'transcriptionHotkey',
  'transcriptionSecondaryHotkey',
  'clipboardScreenshotHotkey',
  'clipboardDesktopScreenshotHotkey',
  'clipboardFullScreenHotkey',
  'clipboardActiveWindowHotkey',
  'clipboardHistoryHotkey',
  'continuousContextHotkey',
  'superPasteHotkey',
  'commandLauncherHotkey',
  'autoImproveHotkey',
  'abandonRecordingHotkey',
  'hotMicHotkey',
] as const satisfies ReadonlyArray<keyof Preferences>;

const SHARED_SURFACE_PREFERENCE_KEYS = [
  'fieldTheoryWindowMode',
  'showInDock',
  'clickAwayToDismiss',
  'recordingIndicatorMode',
  'hotMicIslandAutoHide',
] as const satisfies ReadonlyArray<keyof Preferences>;

const SHARED_PREFERENCE_KEYS = [
  ...SHARED_HOTKEY_PREFERENCE_KEYS,
  ...SHARED_SURFACE_PREFERENCE_KEYS,
] as const satisfies ReadonlyArray<keyof Preferences>;

/**
 * Manages application preferences stored as JSON.
 *
 * Supports per-user data isolation via UserDataManager.
 * When a user logs in, call setUserDataManager() and then load() to load their preferences.
 * When a user logs out, call resetForSignedOutState() to clear per-user state
 * while preserving device-level shortcut settings.
 */
export class PreferencesManager {
  private prefsPath: string;
  private preferences: Preferences;
  private userDataManager: UserDataManager | null = null;
  private saveLock: Promise<void> = Promise.resolve();  // Serializes save() calls

  constructor() {
    // Default to legacy path; will be updated when user logs in
    const userDataPath = app.getPath('userData');
    this.prefsPath = path.join(userDataPath, 'preferences.json');
    this.preferences = { ...DEFAULT_PREFERENCES };
  }

  /**
   * Set the UserDataManager for per-user paths.
   * If user is already logged in, automatically reloads preferences from their path.
   */
  setUserDataManager(manager: UserDataManager): void {
    this.userDataManager = manager;
    this.updatePrefsPath();
    // Note: Don't reload here - the userChanged event handler in index.ts
    // is the authoritative place for reloading preferences after auth.
    // At this point during startup, isLoggedIn() returns false anyway.
  }

  /**
   * Update the prefs path based on current user.
   * Called automatically when UserDataManager is set.
   */
  private updatePrefsPath(): void {
    if (this.userDataManager?.isLoggedIn()) {
      this.prefsPath = this.userDataManager.getUserDataPath('preferences.json');
    } else {
      // Fallback to legacy path (should not normally be used)
      const userDataPath = app.getPath('userData');
      this.prefsPath = path.join(userDataPath, 'preferences.json');
    }
  }

  private getSharedPrefsPath(): string {
    return path.join(app.getPath('userData'), 'preferences.json');
  }

  private async readPrefsFile(filePath: string): Promise<Partial<Preferences> | null> {
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data) as Partial<Preferences>;
    } catch {
      return null;
    }
  }

  private pickSharedPreferences(source: Partial<Preferences>): Partial<Preferences> {
    const shared: Partial<Preferences> = {};

    for (const key of SHARED_PREFERENCE_KEYS) {
      const value = source[key];
      if (value !== undefined) {
        (shared as Record<string, unknown>)[key] = value;
      }
    }

    return shared;
  }

  private async syncSharedPreferencesFromPreferences(source: Partial<Preferences>): Promise<void> {
    const sharedPrefsPath = this.getSharedPrefsPath();
    if (sharedPrefsPath === this.prefsPath) {
      return;
    }

    const nextSharedPrefs = this.pickSharedPreferences(source);
    const existingSharedPrefs = (await this.readPrefsFile(sharedPrefsPath)) ?? {};
    const existingPickedSharedPrefs = this.pickSharedPreferences(existingSharedPrefs);

    if (JSON.stringify(existingPickedSharedPrefs) === JSON.stringify(nextSharedPrefs)) {
      return;
    }

    const dir = path.dirname(sharedPrefsPath);
    await fs.mkdir(dir, { recursive: true }).catch(() => {});
    await fs.writeFile(
      sharedPrefsPath,
      JSON.stringify({ ...existingSharedPrefs, ...nextSharedPrefs }, null, 2),
      'utf-8',
    );
  }

  /**
   * Load preferences from disk.
   * If logged in with per-user path but file doesn't exist, migrates from legacy path.
   */
  async load(): Promise<Preferences> {
    // Update path in case user changed
    this.updatePrefsPath();
    const sharedPrefsPath = this.getSharedPrefsPath();
    const sharedPrefs =
      this.prefsPath === sharedPrefsPath
        ? {}
        : this.pickSharedPreferences((await this.readPrefsFile(sharedPrefsPath)) ?? {});

    const loaded = await this.readPrefsFile(this.prefsPath);
    if (loaded) {
      this.preferences = { ...DEFAULT_PREFERENCES, ...sharedPrefs, ...normalizeFieldTheoryWindowMode(loaded) };
      await this.syncSharedPreferencesFromPreferences(this.preferences);
      return this.preferences;
    }

    // File doesn't exist at current path - try migrating from legacy path if logged in
    if (this.userDataManager?.isLoggedIn()) {
      const legacyPath = path.join(app.getPath('userData'), 'preferences.json');
      if (legacyPath !== this.prefsPath) {
        const legacyPrefs = await this.readPrefsFile(legacyPath);
        if (legacyPrefs) {
          this.preferences = { ...DEFAULT_PREFERENCES, ...sharedPrefs, ...normalizeFieldTheoryWindowMode(legacyPrefs) };
          // Save to new per-user path
          await this.save({});
          return this.preferences;
        }
      }
    }

    this.preferences = { ...DEFAULT_PREFERENCES, ...sharedPrefs };
    return this.preferences;
  }

  /**
   * Save preferences to disk.
   * Serialized to prevent race conditions when multiple saves occur during user switch.
   */
  async save(prefs: Partial<Preferences>): Promise<void> {
    // Serialize save operations to prevent race conditions
    const previousLock = this.saveLock;
    let releaseLock: () => void;
    this.saveLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    try {
      await previousLock;  // Wait for previous save to complete
      await this.saveInternal(prefs);
    } finally {
      releaseLock!();
    }
  }

  /**
   * Internal save implementation.
   */
  private async saveInternal(prefs: Partial<Preferences>): Promise<void> {
    const normalizedPrefs = normalizeFieldTheoryWindowModeSavePatch(prefs);
    // Check if path needs updating (user logged in since last load)
    const oldPath = this.prefsPath;
    this.updatePrefsPath();

    // If path changed (user logged in since last load), the file at the NEW path is authoritative.
    // Don't include stale in-memory prefs from the old (legacy) path.
    if (oldPath !== this.prefsPath) {
      try {
        const data = await fs.readFile(this.prefsPath, 'utf-8');
        const filePrefs = normalizeFieldTheoryWindowMode(JSON.parse(data) as Partial<Preferences>);
        // File at new path is authoritative - only overlay the new prefs being saved
        this.preferences = { ...DEFAULT_PREFERENCES, ...filePrefs, ...normalizedPrefs };
      } catch (error) {
        // File doesn't exist at new path, use current in-memory + new prefs
        this.preferences = { ...this.preferences, ...normalizedPrefs };
      }
    } else {
      // No path change - just merge new prefs into current in-memory state
      this.preferences = { ...this.preferences, ...normalizedPrefs };
    }

    // Ensure directory exists
    const dir = path.dirname(this.prefsPath);
    await fs.mkdir(dir, { recursive: true }).catch(() => {});

    try {
      await fs.writeFile(this.prefsPath, JSON.stringify(this.preferences, null, 2), 'utf-8');
      await this.syncSharedPreferencesFromPreferences(this.preferences);
    } catch (error) {
      log.error('Failed to save preferences:', error);
      throw error;
    }
  }

  /**
   * Reset preferences to defaults. Called on logout.
   */
  reset(): void {
    this.preferences = { ...DEFAULT_PREFERENCES };
  }

  /**
   * Reset to signed-out defaults while preserving shared keyboard shortcuts.
   */
  async resetForSignedOutState(): Promise<void> {
    this.updatePrefsPath();
    const sharedPrefs = this.pickSharedPreferences(
      (await this.readPrefsFile(this.getSharedPrefsPath())) ?? {}
    );
    this.preferences = { ...DEFAULT_PREFERENCES, ...sharedPrefs };
  }

  /**
   * Get current preferences.
   */
  get(): Preferences {
    return { ...this.preferences };
  }

  /**
   * Get a specific preference value.
   */
  getPreference<K extends keyof Preferences>(key: K): Preferences[K] {
    return this.preferences[key];
  }
}
