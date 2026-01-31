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
  | 'todo'
  | 'superPaste'
  | 'commandLauncher'
  | 'improveText'
  | 'autoImprove';

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
  todo: {
    id: 'todo',
    defaultKey: 'Command+Shift+T',
    preferenceKey: 'todoHotkey',
    description: 'Open TODO list',
    category: 'navigation',
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

  /**
   * Register a hotkey with a callback.
   * Returns success/failure with error details.
   */
  register(id: HotkeyId, key: string, callback: HotkeyCallback): HotkeyResult {
    if (!key || key.trim() === '') {
      return { success: true }; // Empty key = intentionally disabled
    }

    const normalizedKey = this.normalizeKey(key);

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

    if (!existingCallback) {
      return {
        success: false,
        error: 'No callback registered for this hotkey',
      };
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
}

// Singleton instance
let instance: HotkeyManager | null = null;

export function getHotkeyManager(): HotkeyManager {
  if (!instance) {
    instance = new HotkeyManager();
  }
  return instance;
}
