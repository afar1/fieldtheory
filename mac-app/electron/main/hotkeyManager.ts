import { globalShortcut } from 'electron';
import { createLogger } from './logger';

const log = createLogger('Hotkey');

/**
 * All hotkey identifiers in the app.
 * Centralized definition prevents scattered hardcoded strings.
 */
export type HotkeyId =
  | 'screenshot'
  | 'fullScreenshot'
  | 'activeWindowScreenshot'
  | 'clipboardHistory'
  | 'continuousContext'
  | 'transcription'
  | 'transcriptionSecondary'
  | 'abandonRecording'
  | 'superPaste'
  | 'commandLauncher'
  | 'improveText'
  | 'autoImprove'
  | 'hotMic';

/**
 * Hotkey configuration with metadata.
 */
interface HotkeyConfig {
  id: HotkeyId;
  defaultKey: string;
  preferenceKey: string | null; // null for non-customizable hotkeys
  description: string;
  category: 'screenshot' | 'transcription' | 'clipboard' | 'text' | 'navigation';
}

/**
 * All hotkey definitions.
 * Single source of truth for defaults and metadata.
 */
export const HOTKEY_CONFIGS: Record<HotkeyId, HotkeyConfig> = {
  screenshot: {
    id: 'screenshot',
    defaultKey: 'Alt+4',
    preferenceKey: 'clipboardScreenshotHotkey',
    description: 'Take area screenshot',
    category: 'screenshot',
  },
  fullScreenshot: {
    id: 'fullScreenshot',
    defaultKey: 'Alt+3',
    preferenceKey: 'clipboardDesktopScreenshotHotkey',
    description: 'Take full screen screenshot',
    category: 'screenshot',
  },
  activeWindowScreenshot: {
    id: 'activeWindowScreenshot',
    defaultKey: 'Shift+Alt+3',
    preferenceKey: null, // Not yet customizable
    description: 'Take active window screenshot',
    category: 'screenshot',
  },
  clipboardHistory: {
    id: 'clipboardHistory',
    defaultKey: 'Alt+Space',
    preferenceKey: 'clipboardHistoryHotkey',
    description: 'Open clipboard history',
    category: 'clipboard',
  },
  continuousContext: {
    id: 'continuousContext',
    defaultKey: 'Shift+Alt+4',
    preferenceKey: 'continuousContextHotkey',
    description: 'Continuous context capture',
    category: 'screenshot',
  },
  transcription: {
    id: 'transcription',
    defaultKey: 'Command+\\',
    preferenceKey: 'transcriptionHotkey',
    description: 'Start/stop transcription',
    category: 'transcription',
  },
  transcriptionSecondary: {
    id: 'transcriptionSecondary',
    defaultKey: '',
    preferenceKey: 'transcriptionSecondaryHotkey',
    description: 'Secondary transcription hotkey',
    category: 'transcription',
  },
  abandonRecording: {
    id: 'abandonRecording',
    defaultKey: 'Escape',
    preferenceKey: 'abandonRecordingHotkey',
    description: 'Cancel recording',
    category: 'transcription',
  },
  superPaste: {
    id: 'superPaste',
    defaultKey: 'Command+Shift+V',
    preferenceKey: 'superPasteHotkey',
    description: 'Smart paste',
    category: 'text',
  },
  commandLauncher: {
    id: 'commandLauncher',
    defaultKey: 'Command+Shift+K',
    preferenceKey: 'commandLauncherHotkey',
    description: 'Open command launcher',
    category: 'navigation',
  },
  improveText: {
    id: 'improveText',
    defaultKey: 'Command+Shift+I',
    preferenceKey: 'improveTextHotkey',
    description: 'Improve selected text',
    category: 'text',
  },
  autoImprove: {
    id: 'autoImprove',
    defaultKey: 'Command+Shift+\\',
    preferenceKey: 'autoImproveHotkey',
    description: 'Toggle auto-improve',
    category: 'text',
  },
  hotMic: {
    id: 'hotMic',
    defaultKey: '',
    preferenceKey: 'hotMicHotkey',
    description: 'Toggle Hot Mic',
    category: 'transcription',
  },
};

/**
 * Result of a hotkey operation.
 */
export interface HotkeyResult {
  success: boolean;
  error?: string;
  conflictWith?: HotkeyId;
}

/**
 * Known apps that commonly capture keyboard shortcuts.
 * Used for conflict detection hints.
 */
interface KnownConflictApp {
  name: string;
  processNames: string[];
  defaultConflicts: string[]; // Hotkeys this app commonly captures
}

export const KNOWN_CONFLICT_APPS: KnownConflictApp[] = [
  { name: 'Rectangle', processNames: ['Rectangle'], defaultConflicts: ['Alt+3', 'Alt+4', 'Alt+Left', 'Alt+Right'] },
  { name: 'Magnet', processNames: ['Magnet'], defaultConflicts: ['Control+Alt+Left', 'Control+Alt+Right'] },
  { name: 'Alfred', processNames: ['Alfred'], defaultConflicts: ['Alt+Space', 'Command+Space'] },
  { name: 'Raycast', processNames: ['Raycast'], defaultConflicts: ['Alt+Space', 'Command+Space'] },
  { name: 'CleanShot X', processNames: ['CleanShot X'], defaultConflicts: ['Command+Shift+4', 'Command+Shift+5'] },
  { name: 'BetterTouchTool', processNames: ['BetterTouchTool'], defaultConflicts: [] },
];

/**
 * Callback function type for hotkey triggers.
 */
export type HotkeyCallback = () => void;

/**
 * Registered hotkey state.
 */
interface RegisteredHotkey {
  id: HotkeyId;
  key: string;
  callback: HotkeyCallback;
}

/**
 * Centralized hotkey manager.
 * Single source of truth for all hotkey registrations.
 *
 * Key features:
 * - Atomic operations: register succeeds before state is updated
 * - Conflict detection: checks before registering
 * - Clean API: register, unregister, change, getAll
 * - Proper cleanup on quit
 */
export class HotkeyManager {
  private registeredHotkeys: Map<HotkeyId, RegisteredHotkey> = new Map();
  private callbacks: Map<HotkeyId, HotkeyCallback> = new Map();

  constructor() {
  }

  /**
   * Normalize hotkey string for consistent comparison.
   * Handles variations like "Cmd" vs "Command", "Option" vs "Alt".
   */
  private normalizeKey(key: string): string {
    if (!key) return '';

    return key
      .replace(/Cmd/gi, 'Command')
      .replace(/Option/gi, 'Alt')
      .replace(/\s+/g, '') // Remove spaces
      .split('+')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join('+');
  }

  /**
   * Check if a hotkey combination is already registered by another feature.
   * Returns the conflicting HotkeyId if found, null otherwise.
   */
  checkConflict(key: string, excludeId?: HotkeyId): HotkeyId | null {
    if (!key) return null;

    const normalizedKey = this.normalizeKey(key);

    for (const [id, registered] of this.registeredHotkeys) {
      if (excludeId && id === excludeId) continue;
      if (this.normalizeKey(registered.key) === normalizedKey) {
        return id;
      }
    }

    return null;
  }

  /**
   * Check if a hotkey is registered with the OS (not just our app).
   */
  isRegisteredWithOS(key: string): boolean {
    if (!key) return false;
    return globalShortcut.isRegistered(key);
  }

  // Valid non-modifier keys for Electron's globalShortcut (Chromium accelerators).
  // See: https://www.electronjs.org/docs/latest/api/accelerator
  private static readonly VALID_KEYS = new Set([
    // Letters
    'a','b','c','d','e','f','g','h','i','j','k','l','m',
    'n','o','p','q','r','s','t','u','v','w','x','y','z',
    // Digits
    '0','1','2','3','4','5','6','7','8','9',
    // Function keys
    'f1','f2','f3','f4','f5','f6','f7','f8','f9','f10','f11','f12',
    'f13','f14','f15','f16','f17','f18','f19','f20','f21','f22','f23','f24',
    // Special keys
    'space','tab','backspace','delete','insert','return','enter','escape','esc',
    'up','down','left','right','home','end','pageup','pagedown',
    'volumeup','volumedown','volumemute',
    'medianexttrack','mediaprevioustrack','mediastop','mediaplaypause',
    'printscreen','numpadadd','numpadsubtract','numlockenter',
    'plus','minus','=','[',']',';','\'',',','.','/','`',
  ]);

  register(id: HotkeyId, key: string, callback: HotkeyCallback): HotkeyResult {
    if (!key || key.trim() === '') {
      return { success: true }; // Empty key = intentionally disabled
    }

    const normalizedKey = this.normalizeKey(key);

    // Validate that the non-modifier key is supported by Electron
    const parts = normalizedKey.toLowerCase().split('+');
    const modifiers = new Set(['command', 'control', 'ctrl', 'alt', 'shift', 'super', 'meta', 'commandorcontrol', 'cmdorctrl']);
    const nonModifiers = parts.filter(p => !modifiers.has(p));
    if (nonModifiers.length === 0 || nonModifiers.some(k => !HotkeyManager.VALID_KEYS.has(k))) {
      const invalid = nonModifiers.filter(k => !HotkeyManager.VALID_KEYS.has(k));
      log.error(`Invalid key in shortcut for ${id}: "${invalid.join(', ')}" — not supported by Electron`);
      return {
        success: false,
        error: `Key "${invalid.join(', ')}" is not supported. Try a letter, number, or function key.`,
      };
    }

    // Check for internal conflicts
    const conflict = this.checkConflict(normalizedKey, id);
    if (conflict) {
      return {
        success: false,
        error: `Hotkey already used by ${HOTKEY_CONFIGS[conflict].description}`,
        conflictWith: conflict,
      };
    }

    // Unregister existing if changing
    if (this.registeredHotkeys.has(id)) {
      this.unregister(id);
    }

    // Attempt OS registration
    try {
      const registered = globalShortcut.register(normalizedKey, callback);

      if (!registered) {
        log.error(`Failed to register ${id}: "${normalizedKey}" - may be in use by another app`);
        return {
          success: false,
          error: 'Hotkey may be in use by another application',
        };
      }

      // Success - update state
      this.registeredHotkeys.set(id, { id, key: normalizedKey, callback });
      this.callbacks.set(id, callback);

      return { success: true };
    } catch (error) {
      log.error(`Exception registering ${id}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Unregister a hotkey.
   */
  unregister(id: HotkeyId): boolean {
    const registered = this.registeredHotkeys.get(id);
    if (!registered) {
      return false;
    }

    try {
      globalShortcut.unregister(registered.key);
      this.registeredHotkeys.delete(id);
      // Keep callback for potential re-registration
      return true;
    } catch (error) {
      log.error(`Exception unregistering ${id}:`, error);
      return false;
    }
  }

  /**
   * Change a hotkey to a new combination.
   * Atomic: only updates state if registration succeeds.
   */
  change(id: HotkeyId, newKey: string): HotkeyResult {
    const existingCallback = this.callbacks.get(id);

    // If no callback registered yet (e.g., during onboarding), just return success.
    // The actual registration will happen later when the callback is set.
    if (!existingCallback) {
      return { success: true };
    }

    // If clearing the hotkey
    if (!newKey || newKey.trim() === '') {
      this.unregister(id);
      return { success: true };
    }

    const normalizedKey = this.normalizeKey(newKey);
    const oldRegistered = this.registeredHotkeys.get(id);

    // Check for conflicts (excluding self)
    const conflict = this.checkConflict(normalizedKey, id);
    if (conflict) {
      return {
        success: false,
        error: `Hotkey already used by ${HOTKEY_CONFIGS[conflict].description}`,
        conflictWith: conflict,
      };
    }

    // Unregister old key first
    if (oldRegistered) {
      globalShortcut.unregister(oldRegistered.key);
    }

    // Register new key
    try {
      const registered = globalShortcut.register(normalizedKey, existingCallback);

      if (!registered) {
        // Failed - try to restore old key
        if (oldRegistered) {
          globalShortcut.register(oldRegistered.key, existingCallback);
        }
        return {
          success: false,
          error: 'Hotkey may be in use by another application',
        };
      }

      // Success - update state
      this.registeredHotkeys.set(id, { id, key: normalizedKey, callback: existingCallback });
      return { success: true };
    } catch (error) {
      // Failed - try to restore old key
      if (oldRegistered) {
        try {
          globalShortcut.register(oldRegistered.key, existingCallback);
        } catch {
          // Ignore restoration failure
        }
      }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Set callback for a hotkey without registering it yet.
   * Useful for setting up callbacks before hotkeys are loaded from preferences.
   */
  setCallback(id: HotkeyId, callback: HotkeyCallback): void {
    this.callbacks.set(id, callback);
  }

  /**
   * Get the currently registered key for a hotkey.
   */
  getRegisteredKey(id: HotkeyId): string | null {
    return this.registeredHotkeys.get(id)?.key || null;
  }

  /**
   * Get all registered hotkeys.
   */
  getAll(): Map<HotkeyId, string> {
    const result = new Map<HotkeyId, string>();
    for (const [id, registered] of this.registeredHotkeys) {
      result.set(id, registered.key);
    }
    return result;
  }

  /**
   * Get the default key for a hotkey.
   */
  getDefault(id: HotkeyId): string {
    return HOTKEY_CONFIGS[id].defaultKey;
  }

  /**
   * Check if a hotkey is currently registered.
   */
  isRegistered(id: HotkeyId): boolean {
    return this.registeredHotkeys.has(id);
  }

  /**
   * Unregister all hotkeys.
   * Call this on app quit.
   */
  unregisterAll(): void {
    for (const id of this.registeredHotkeys.keys()) {
      this.unregister(id);
    }
    globalShortcut.unregisterAll();
  }

  /**
   * Get hotkey info for display in UI.
   */
  getHotkeyInfo(id: HotkeyId): { key: string | null; default: string; description: string } {
    const config = HOTKEY_CONFIGS[id];
    return {
      key: this.getRegisteredKey(id),
      default: config.defaultKey,
      description: config.description,
    };
  }

  /**
   * Get all hotkeys in a category.
   */
  getByCategory(category: HotkeyConfig['category']): HotkeyId[] {
    return Object.values(HOTKEY_CONFIGS)
      .filter(config => config.category === category)
      .map(config => config.id);
  }

  /**
   * Normalize a hotkey string (public access for conflict detection).
   */
  public normalizeKeyPublic(key: string): string {
    return this.normalizeKey(key);
  }

  /**
   * Test if a hotkey can be registered and receives callbacks.
   * Temporarily registers the hotkey and waits to see if it receives events.
   * This helps detect when another app has captured the shortcut.
   *
   * Note: This is a passive test - it registers and waits, but cannot
   * simulate key presses. The user must press the key during the timeout.
   */
  async testHotkey(key: string, timeoutMs: number = 3000): Promise<{
    success: boolean;
    callbackFired: boolean;
    error?: string;
  }> {
    if (!key || key.trim() === '') {
      return { success: false, callbackFired: false, error: 'Empty key' };
    }

    const normalizedKey = this.normalizeKey(key);

    // Check if this hotkey is already registered by our app
    let existingId: HotkeyId | null = null;
    let existingCallback: HotkeyCallback | null = null;
    for (const [id, registered] of this.registeredHotkeys) {
      if (this.normalizeKey(registered.key) === normalizedKey) {
        existingId = id;
        existingCallback = registered.callback;
        break;
      }
    }

    // Temporarily unregister our own hotkey if needed
    if (existingId) {
      try {
        globalShortcut.unregister(normalizedKey);
      } catch {
        // Ignore
      }
    }

    return new Promise((resolve) => {
      let callbackFired = false;
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          try {
            globalShortcut.unregister(normalizedKey);
          } catch {
            // Ignore cleanup errors
          }
          // Re-register our original hotkey if we had one
          if (existingId && existingCallback) {
            try {
              globalShortcut.register(normalizedKey, existingCallback);
            } catch (err) {
              log.error(`Failed to re-register original hotkey "${normalizedKey}":`, err);
            }
          }
        }
      };

      try {
        const registered = globalShortcut.register(normalizedKey, () => {
          callbackFired = true;
          cleanup();
          resolve({ success: true, callbackFired: true });
        });

        if (!registered) {
          // Re-register original before returning
          if (existingId && existingCallback) {
            try {
              globalShortcut.register(normalizedKey, existingCallback);
            } catch {
              // Ignore
            }
          }
          resolve({ success: false, callbackFired: false, error: 'Registration failed - hotkey may be captured by another app' });
          return;
        }

        // Timeout - callback didn't fire
        setTimeout(() => {
          cleanup();
          resolve({ success: true, callbackFired: false });
        }, timeoutMs);
      } catch (err) {
        log.error(`Test hotkey exception for "${normalizedKey}":`, err);
        cleanup();
        resolve({ success: false, callbackFired: false, error: String(err) });
      }
    });
  }
}

// Singleton instance
let instance: HotkeyManager | null = null;

export function getHotkeyManager(): HotkeyManager {
  if (!instance) {
    instance = new HotkeyManager();
  }
  return instance;
}
