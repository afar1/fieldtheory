import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';

import { createLogger } from './logger';
import { ModelSize } from './modelManager';

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

// Note: LocalQuotas interface removed - server is now single source of truth for usage tracking.

/**
 * Application preferences stored in userData directory.
 */
interface Preferences {
  transcriptionHotkey: string;
  transcriptionSecondaryHotkey?: string;
  selectedModel: ModelSize;
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
  // Tasks tab visibility - hidden by default, toggled via Shift+Cmd+T
  tasksTabEnabled?: boolean;

  // Previously hardcoded hotkeys - now customizable
  superPasteHotkey?: string;
  commandLauncherHotkey?: string;
  improveTextHotkey?: string;
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

  // Show fieldtheory.dev link in footer - toggleable per user preference.
  showFieldTheoryLink?: boolean;

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

  // Cached tier - persisted locally so Pro users don't get downgraded on startup.
  // Server is authoritative; this is only for offline/startup display.
  cachedTier?: 'free' | 'pro';
}

const DEFAULT_PREFERENCES: Preferences = {
  transcriptionHotkey: 'Command+\\',
  selectedModel: 'small',
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

  // Sound settings - librarian sound ON by default, other sounds OFF by default
  soundsEnabled: false,  // Other sounds (recording, window, paste) - off by default
  librarianSoundEnabled: true,  // Librarian artifact discovery sound - on by default
  
  // Cursor status indicator - enabled by default
  cursorStatusEnabled: true,
  
  // Hide status text labels - show only colored dots (red/purple/green). Disabled by default.
  hideStatusLabels: false,

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
    } else {
      // Fallback to legacy path (should not normally be used)
      const userDataPath = app.getPath('userData');
      this.prefsPath = path.join(userDataPath, 'preferences.json');
    }
  }

  /**
   * Load preferences from disk.
   * If logged in with per-user path but file doesn't exist, migrates from legacy path.
   */
  async load(): Promise<Preferences> {
    // Update path in case user changed
    this.updatePrefsPath();

    try {
      const data = await fs.readFile(this.prefsPath, 'utf-8');
      const loaded = JSON.parse(data) as Partial<Preferences>;
      this.preferences = { ...DEFAULT_PREFERENCES, ...loaded };
      return this.preferences;
    } catch (error) {
      // File doesn't exist at current path - try migrating from legacy path if logged in
      if (this.userDataManager?.isLoggedIn()) {
        const legacyPath = path.join(app.getPath('userData'), 'preferences.json');
        if (legacyPath !== this.prefsPath) {
          try {
            const legacyData = await fs.readFile(legacyPath, 'utf-8');
            const legacyPrefs = JSON.parse(legacyData) as Partial<Preferences>;
            this.preferences = { ...DEFAULT_PREFERENCES, ...legacyPrefs };
            // Save to new per-user path
            await this.save({});
            return this.preferences;
          } catch (migrationError) {
            // Legacy file also not found or invalid - use defaults
          }
        }
      }

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
      try {
        const data = await fs.readFile(this.prefsPath, 'utf-8');
        const filePrefs = JSON.parse(data) as Partial<Preferences>;
        // File at new path is authoritative - only overlay the new prefs being saved
        this.preferences = { ...DEFAULT_PREFERENCES, ...filePrefs, ...prefs };
      } catch (error) {
        // File doesn't exist at new path, use current in-memory + new prefs
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

