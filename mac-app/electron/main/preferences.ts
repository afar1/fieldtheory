import { app, safeStorage } from 'electron';
import fs from 'fs/promises';
import path from 'path';

import { ModelSize } from './modelManager';

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
 * Application preferences stored in userData directory.
 */
interface Preferences {
  transcriptionHotkey: string;
  selectedModel: ModelSize;
  overlayStyle: OverlayStyle;
  windowState?: WindowState;
  clipboardScreenshotHotkey?: string;
  clipboardHistoryHotkey?: string;
  priorityDeviceId?: string | null;
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
  
  // All-time statistics tracking
  improvedPromptsCount?: number;
}

const DEFAULT_PREFERENCES: Preferences = {
  transcriptionHotkey: 'Alt+Space',
  selectedModel: 'base',
  overlayStyle: 'rectangle',
  clipboardScreenshotHotkey: 'Alt+1',
  clipboardHistoryHotkey: 'Control+Alt+Space',
  continuousContextEnabled: false,
  continuousContextHotkey: 'Shift+Alt+1', // Default: Shift + screenshot hotkey
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
   * Securely store an API key using OS keychain via Electron safeStorage.
   * The key is encrypted and stored as base64 in preferences.
   */
  async setApiKey(plainTextKey: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn('[PreferencesManager] safeStorage not available, falling back to plain storage');
      // Fallback for systems without keychain - still better than nothing
      await this.save({ anthropicApiKeyEncrypted: Buffer.from(plainTextKey).toString('base64') });
      return;
    }

    const encrypted = safeStorage.encryptString(plainTextKey);
    const encryptedBase64 = encrypted.toString('base64');
    await this.save({ anthropicApiKeyEncrypted: encryptedBase64 });
    console.log('[PreferencesManager] API key securely stored');
  }

  /**
   * Retrieve the API key, decrypting from OS keychain.
   * Returns null if no key is stored or decryption fails.
   */
  getApiKey(): string | null {
    const encryptedBase64 = this.preferences.anthropicApiKeyEncrypted;
    if (!encryptedBase64) {
      return null;
    }

    try {
      if (!safeStorage.isEncryptionAvailable()) {
        // Fallback: decode base64 if safeStorage wasn't available when storing
        return Buffer.from(encryptedBase64, 'base64').toString('utf-8');
      }

      const encryptedBuffer = Buffer.from(encryptedBase64, 'base64');
      return safeStorage.decryptString(encryptedBuffer);
    } catch (error) {
      console.error('[PreferencesManager] Failed to decrypt API key:', error);
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
}

