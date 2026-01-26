import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';

import { ModelSize } from './modelManager';
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
interface ClipboardHistoryBounds {
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
 * Overlay animation style options.
 */
export type OverlayStyle = 'rectangle' | 'top-emerging';

/**
 * Local quota tracking for free users.
 * Resets on per-user anniversary date (day of month they signed up).
 */
export interface LocalQuotas {
  period: string;                     // DEPRECATED: "YYYY-MM" format, kept for migration
  lastResetDate?: string;             // ISO date of last reset (YYYY-MM-DD)
  signupDay?: number;                 // Day of month user signed up (1-31)
  priorityMicSecondsUsed: number;     // Seconds of priority mic used this period
  autoStackSessionsUsed: number;      // Multi-image stack sessions (2+ images)
  textImprovementWordsUsed: number;   // Input words improved this period
  verbalCommandsUsed: number;         // Voice commands used this period
  cachedTier: 'free' | 'pro';         // Cached tier for offline access
  cachedTierUpdatedAt: string;        // ISO timestamp of last tier sync
}

/**
 * Application preferences stored in userData directory.
 */
interface Preferences {
  transcriptionHotkey: string;
  transcriptionSecondaryHotkey?: string;
  selectedModel: ModelSize;
  overlayStyle: OverlayStyle;
  windowState?: WindowState;
  clipboardScreenshotHotkey?: string;
  clipboardDesktopScreenshotHotkey?: string;
  clipboardHistoryHotkey?: string;
  priorityDeviceId?: string | null;
  favoriteDeviceName?: string | null; // For auto-reconnect when device reappears
  clipboardHistoryBounds?: ClipboardHistoryBounds;

  // Onboarding state - tracks whether user has completed first-run setup.
  onboardingComplete?: boolean;
  onboardingStep?: number; // For resuming interrupted onboarding
  
  // Continuous Context feature - allows continuous screenshotting with stacked results
  continuousContextEnabled?: boolean;
  continuousContextHotkey?: string;
  
  // Todo hotkey - opens clipboard history in todo view mode
  todoHotkey?: string;

  // Previously hardcoded hotkeys - now customizable
  superPasteHotkey?: string;
  commandLauncherHotkey?: string;
  improveTextHotkey?: string;
  autoImproveHotkey?: string;
  
  // All-time statistics tracking
  improvedPromptsCount?: number;
  
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

  // Local LLM settings - use downloaded model instead of API for transcript improvement
  useLocalLLM?: boolean;
  selectedLocalLLM?: string;  // Model size: '1b' or '3b'

  // Sound settings - optional sounds for recording actions.
  // If soundsEnabled is false, no sounds play.
  soundsEnabled?: boolean;
  recordingStartSound?: string;  // Sound file name to play when recording starts
  recordingStopSound?: string;   // Sound file name to play when recording stops
  recordingCancelSound?: string; // Sound file name to play when recording is cancelled
  windowOpenSound?: string;      // Sound file name to play when window opens
  windowCloseSound?: string;     // Sound file name to play when window closes
  pasteSound?: string;           // Sound file name to play when pasting
  transcribingSound?: string;    // Sound file name to play when transcribing starts
  artifactDiscoverySound?: string; // Sound file name to play when artifact/reading is created
  
  // Permission banner settings - hide banner prompting for Screen Recording permission.
  hideScreenRecordingBanner?: boolean;
  
  // Cursor status indicator - shows colored dot next to cursor during recording/transcribing.
  cursorStatusEnabled?: boolean;
  
  // Hide status text labels - show only colored dots (red/purple/green).
  hideStatusLabels?: boolean;
  
  // Progressive label hiding - counts shown before labels auto-hide.
  transcribingLabelShownCount?: number;
  sayAnythingLabelShownCount?: number;
  labelsExplicitlyEnabled?: boolean;
  
  // Tasks tab - experimental feature, hidden by default.
  tasksTabEnabled?: boolean;
  
  // Local quota tracking for anonymous users.
  localQuotas?: LocalQuotas;
  
  // Show in Dock and Cmd+Tab - when enabled, app appears in Dock and application switcher.
  showInDock?: boolean;

  // Launch at login - start Field Theory automatically when macOS starts.
  launchAtLogin?: boolean;

  // Portable Commands - directory path where user's command markdown files are stored.
  // Can point to Claude skills, Cursor rules, or any directory with .md files.
  commandsDirectory?: string;

  // Dark mode preference - synced across all windows.
  darkMode?: boolean;

  // Word substitutions - pairs of [from, to] for transcription correction.
  // Example: ["main", "main"] for correcting "main" state to "main" branch.
  wordSubstitutions?: Array<{ from: string; to: string }>;

  // Data retention - how long to keep clipboard history items.
  // Values: 2, 7, 30, 90 (days) or -1 (never delete)
  dataRetentionDays?: number;

  // Dev/testing overrides (superadmin only) - persists until manually cleared.
  devOverrides?: {
    tier?: 'free' | 'pro';
    quotaPercentages?: {
      priorityMic?: number;   // 0-100
      autoStack?: number;     // 0-100
      textImprove?: number;   // 0-100
    };
    authState?: 'logged_out' | 'offline';
  };

  // Scenario testing panel position.
  scenarioTestingBounds?: { x: number; y: number };
}

const DEFAULT_PREFERENCES: Preferences = {
  transcriptionHotkey: 'Command+\\',
  selectedModel: 'small',
  overlayStyle: 'rectangle',
  clipboardScreenshotHotkey: 'Alt+4',
  clipboardDesktopScreenshotHotkey: 'Alt+3',
  clipboardHistoryHotkey: 'Alt+Space',
  continuousContextEnabled: false,
  continuousContextHotkey: 'Shift+Alt+4', // Default: Shift + screenshot hotkey
  abandonRecordingHotkey: 'Escape', // Default: Escape key to cancel recording
  abandonRecordingConfirmation: true, // Default: confirm before abandoning if there's audio
  todoHotkey: 'Command+Shift+T', // Default: Cmd+Shift+T for todo list

  // Previously hardcoded hotkeys - now customizable
  superPasteHotkey: 'Command+Shift+V',
  commandLauncherHotkey: 'Command+Shift+K',
  improveTextHotkey: 'Command+Shift+I',
  autoImproveHotkey: 'Command+Shift+\\',

  // Sound settings - enabled by default with click sounds
  soundsEnabled: true,
  recordingStartSound: 'ButtonClickDown.mp3',
  recordingStopSound: 'ButtonClickUp.mp3',
  recordingCancelSound: 'AlertBonk.mp3',
  windowOpenSound: 'WindowOpen.mp3',
  windowCloseSound: 'WindowClose.mp3',
  pasteSound: 'Click.mp3',
  transcribingSound: 'Beep.mp3',
  
  // Cursor status indicator - enabled by default
  cursorStatusEnabled: true,
  
  // Hide status text labels - show only colored dots (red/purple/green). Disabled by default.
  hideStatusLabels: false,
  
  transcribingLabelShownCount: 0,
  sayAnythingLabelShownCount: 0,
  labelsExplicitlyEnabled: false,
  
  // Tasks tab - experimental feature, hidden by default.
  tasksTabEnabled: false,
  
  // Show in Dock - disabled by default (panel mode). WIP feature.
  showInDock: false,

  // Dark mode - disabled by default (light mode).
  darkMode: false,

  // Word substitutions - empty by default.
  wordSubstitutions: [],

  // Data retention - never delete by default.
  dataRetentionDays: -1,
};

/**
 * Manages application preferences stored as JSON.
 *
 * Supports per-user data isolation via UserDataManager.
 * When a user logs in, call setUserDataManager() and then load() to load their preferences.
 * When a user logs out, call reset() to clear in-memory state.
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
      console.log('[PreferencesManager] Using user-specific path:', this.prefsPath);
    } else {
      // Fallback to legacy path (should not normally be used)
      const userDataPath = app.getPath('userData');
      this.prefsPath = path.join(userDataPath, 'preferences.json');
      console.log('[PreferencesManager] Using legacy path (no user):', this.prefsPath);
    }
  }

  /**
   * Load preferences from disk.
   * If logged in with per-user path but file doesn't exist, migrates from legacy path.
   */
  async load(): Promise<Preferences> {
    console.log('[PreferencesManager] load() called, userDataManager set:', !!this.userDataManager);
    // Update path in case user changed
    this.updatePrefsPath();

    try {
      console.log('[PreferencesManager] Attempting to load from:', this.prefsPath);
      const data = await fs.readFile(this.prefsPath, 'utf-8');
      const loaded = JSON.parse(data) as Partial<Preferences>;
      this.preferences = { ...DEFAULT_PREFERENCES, ...loaded };
      console.log('[PreferencesManager] Loaded preferences from:', this.prefsPath);
      console.log('[PreferencesManager] Loaded hotkey:', this.preferences.transcriptionHotkey);
      return this.preferences;
    } catch (error) {
      // File doesn't exist at current path
      console.log('[PreferencesManager] File not found at:', this.prefsPath, '- checking migration...');
      console.log('[PreferencesManager] isLoggedIn:', this.userDataManager?.isLoggedIn());

      // If logged in with per-user path, try migrating from legacy path
      if (this.userDataManager?.isLoggedIn()) {
        const legacyPath = path.join(app.getPath('userData'), 'preferences.json');
        console.log('[PreferencesManager] Legacy path:', legacyPath);
        console.log('[PreferencesManager] Current path:', this.prefsPath);
        if (legacyPath !== this.prefsPath) {
          try {
            const legacyData = await fs.readFile(legacyPath, 'utf-8');
            const legacyPrefs = JSON.parse(legacyData) as Partial<Preferences>;
            this.preferences = { ...DEFAULT_PREFERENCES, ...legacyPrefs };
            console.log('[PreferencesManager] Migrated from legacy, hotkey:', this.preferences.transcriptionHotkey);
            // Save to new per-user path
            await this.save({});
            return this.preferences;
          } catch (migrationError) {
            console.log('[PreferencesManager] Legacy file also not found or invalid');
          }
        }
      }

      console.log('[PreferencesManager] Using DEFAULT preferences, hotkey:', DEFAULT_PREFERENCES.transcriptionHotkey);
      this.preferences = { ...DEFAULT_PREFERENCES };
      return this.preferences;
    }
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
    // Check if path needs updating (user logged in since last load)
    const oldPath = this.prefsPath;
    this.updatePrefsPath();

    // If path changed (user logged in since last load), the file at the NEW path is authoritative.
    // Don't include stale in-memory prefs from the old (legacy) path.
    if (oldPath !== this.prefsPath) {
      console.log('[PreferencesManager] Path changed during save:', { oldPath, newPath: this.prefsPath });
      try {
        const data = await fs.readFile(this.prefsPath, 'utf-8');
        const filePrefs = JSON.parse(data) as Partial<Preferences>;
        // File at new path is authoritative - only overlay the new prefs being saved
        this.preferences = { ...DEFAULT_PREFERENCES, ...filePrefs, ...prefs };
        console.log('[PreferencesManager] Loaded from new path, hotkey:', this.preferences.transcriptionHotkey);
      } catch (error) {
        // File doesn't exist at new path, use current in-memory + new prefs
        console.log('[PreferencesManager] File read failed, using in-memory:', error);
        this.preferences = { ...this.preferences, ...prefs };
      }
    } else {
      // No path change - just merge new prefs into current in-memory state
      this.preferences = { ...this.preferences, ...prefs };
    }

    // Ensure directory exists
    const dir = path.dirname(this.prefsPath);
    await fs.mkdir(dir, { recursive: true }).catch(() => {});

    try {
      await fs.writeFile(this.prefsPath, JSON.stringify(this.preferences, null, 2), 'utf-8');
      console.log('[PreferencesManager] Preferences saved to:', this.prefsPath);
      console.log('[PreferencesManager] Saved hotkey:', this.preferences.transcriptionHotkey);
    } catch (error) {
      console.error('[PreferencesManager] Failed to save preferences:', error);
      throw error;
    }
  }

  /**
   * Reset preferences to defaults. Called on logout.
   */
  reset(): void {
    console.log('[PreferencesManager] Resetting to defaults (user logged out)');
    this.preferences = { ...DEFAULT_PREFERENCES };
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

