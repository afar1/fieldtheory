import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';

import { ModelSize } from './modelManager';

/**
 * Simple obfuscation for API keys stored locally.
 * Not cryptographically secure, but prevents casual copying from the prefs file.
 * Uses XOR with a static key + base64 encoding.
 */
const OBFUSCATION_KEY = 'fth3ory2026';

function obfuscate(plainText: string): string {
  const bytes = Buffer.from(plainText, 'utf-8');
  const keyBytes = Buffer.from(OBFUSCATION_KEY, 'utf-8');
  const result = Buffer.alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    result[i] = bytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return result.toString('base64');
}

function deobfuscate(obfuscated: string): string {
  const bytes = Buffer.from(obfuscated, 'base64');
  const keyBytes = Buffer.from(OBFUSCATION_KEY, 'utf-8');
  const result = Buffer.alloc(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    result[i] = bytes[i] ^ keyBytes[i % keyBytes.length];
  }
  return result.toString('utf-8');
}

/**
 * Check if a string looks like a valid API key (printable ASCII only).
 * Returns false if the string contains garbage/corrupted characters.
 */
function isValidApiKeyFormat(key: string): boolean {
  // API keys should only contain printable ASCII (32-126) and common separators
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7E]+$/.test(key) && key.length >= 10;
}

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
 * Resets on calendar month boundary (YYYY-MM format).
 */
export interface LocalQuotas {
  period: string;                     // "YYYY-MM" format (e.g., "2026-01")
  priorityMicSecondsUsed: number;     // Seconds of priority mic used this month
  autoStackSessionsUsed: number;      // Multi-image stack sessions (2+ images)
  textImprovementWordsUsed: number;   // Input words improved this month
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
  
  // API key stored as encrypted base64 string via safeStorage (OS keychain).
  // Never store plain text API keys - use getApiKey/setApiKey methods.
  anthropicApiKeyEncrypted?: string;
  
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

  // Narration capability settings.
  // Local, offline text-to-speech for the Librarian.
  narrationPrefs?: {
    installed: boolean;
    installedVersion?: string;
    speakOnOpen: boolean;
    blockedDevices: string[];
    cacheSizeLimitBytes: number;
  };
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
 */
export class PreferencesManager {
  private prefsPath: string;
  private preferences: Preferences;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.prefsPath = path.join(userDataPath, 'preferences.json');
    this.preferences = { ...DEFAULT_PREFERENCES };
  }

  /**
   * Load preferences from disk.
   */
  async load(): Promise<Preferences> {
    try {
      const data = await fs.readFile(this.prefsPath, 'utf-8');
      const loaded = JSON.parse(data) as Partial<Preferences>;
      this.preferences = { ...DEFAULT_PREFERENCES, ...loaded };
      return this.preferences;
    } catch (error) {
      // File doesn't exist or is invalid, use defaults
      console.log('[PreferencesManager] Using default preferences');
      return this.preferences;
    }
  }

  /**
   * Save preferences to disk.
   */
  async save(prefs: Partial<Preferences>): Promise<void> {
    this.preferences = { ...this.preferences, ...prefs };
    try {
      await fs.writeFile(this.prefsPath, JSON.stringify(this.preferences, null, 2), 'utf-8');
      console.log('[PreferencesManager] Preferences saved');
    } catch (error) {
      console.error('[PreferencesManager] Failed to save preferences:', error);
      throw error;
    }
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

  /**
   * Store an API key with local obfuscation.
   * Not cryptographically secure, but prevents casual copying from prefs file.
   */
  async setApiKey(plainTextKey: string): Promise<void> {
    const obfuscated = obfuscate(plainTextKey);
    await this.save({ anthropicApiKeyEncrypted: obfuscated });
    console.log('[PreferencesManager] API key stored');
  }

  /**
   * Retrieve the API key, deobfuscating from storage.
   * Returns null if no key is stored, deobfuscation fails, or key is corrupted.
   */
  getApiKey(): string | null {
    const obfuscated = this.preferences.anthropicApiKeyEncrypted;
    if (!obfuscated) {
      return null;
    }

    try {
      const key = deobfuscate(obfuscated);
      // Validate the deobfuscated key looks like a real API key
      if (!isValidApiKeyFormat(key)) {
        console.warn('[PreferencesManager] Stored API key appears corrupted, treating as empty');
        return null;
      }
      return key;
    } catch (error) {
      console.error('[PreferencesManager] Failed to deobfuscate API key:', error);
      return null;
    }
  }

  /**
   * Check if an API key is stored.
   */
  hasApiKey(): boolean {
    return !!this.preferences.anthropicApiKeyEncrypted;
  }

  /**
   * Remove the stored API key.
   */
  async clearApiKey(): Promise<void> {
    await this.save({ anthropicApiKeyEncrypted: undefined });
    console.log('[PreferencesManager] API key cleared');
  }

  /**
   * Get masked version of the API key for display purposes.
   * Shows the identifiable prefix followed by fixed dots.
   * Example: "sk-ant-api03-••••••••"
   */
  getMaskedApiKey(): string | null {
    const key = this.getApiKey();
    if (!key || key.length < 12) {
      return null;
    }

    // Find the identifiable prefix (first segment with alphanumerics)
    // For Anthropic: "sk-ant-api03-" prefix
    // For OpenAI: "sk-proj-" or "sk-" prefix
    // For others: first 8-12 chars
    let prefixLength = 7;

    if (key.startsWith('sk-ant-api')) {
      // Anthropic format: sk-ant-api03-...
      const match = key.match(/^sk-ant-api\d+-/);
      prefixLength = match ? match[0].length : 13;
    } else if (key.startsWith('sk-proj-')) {
      prefixLength = 8;
    } else if (key.startsWith('sk-')) {
      prefixLength = 3;
    } else if (key.startsWith('gsk_')) {
      prefixLength = 4;
    } else if (key.startsWith('AIza')) {
      prefixLength = 4;
    }

    const prefix = key.slice(0, prefixLength);
    // Use fixed 8 dots for clean display
    return `${prefix}••••••••`;
  }

  /**
   * Detect the API provider from the key format.
   * Returns the provider name or 'unknown' if not recognized.
   */
  detectProvider(apiKey?: string): 'anthropic' | 'openai' | 'google' | 'groq' | 'mistral' | 'unknown' {
    const key = apiKey || this.getApiKey();
    if (!key) return 'unknown';

    // Anthropic keys start with "sk-ant-"
    if (key.startsWith('sk-ant-')) {
      return 'anthropic';
    }

    // OpenAI keys start with "sk-" (but not "sk-ant-")
    // Also includes "sk-proj-" format for project-specific keys
    if (key.startsWith('sk-') && !key.startsWith('sk-ant-')) {
      return 'openai';
    }

    // Groq keys start with "gsk_"
    if (key.startsWith('gsk_')) {
      return 'groq';
    }

    // Google/Gemini keys are typically "AIza" prefix
    if (key.startsWith('AIza')) {
      return 'google';
    }

    // Mistral keys are typically alphanumeric without specific prefix
    // They're usually 32 chars and all lowercase alphanumeric
    if (/^[a-zA-Z0-9]{32}$/.test(key)) {
      return 'mistral';
    }

    return 'unknown';
  }
}

