import { app } from 'electron';
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
}

const DEFAULT_PREFERENCES: Preferences = {
  transcriptionHotkey: 'Alt+Space',
  selectedModel: 'base',
  overlayStyle: 'rectangle',
  clipboardScreenshotHotkey: 'Alt+1',
  clipboardHistoryHotkey: 'Control+Alt+Space',
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
}

