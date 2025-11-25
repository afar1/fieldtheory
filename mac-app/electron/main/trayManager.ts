// =============================================================================
// TrayManager - macOS menu bar (Tray) integration for Little One.
// Displays connection status and provides controls for priority locking.
// =============================================================================

import { Tray, Menu, nativeImage, app, MenuItemConstructorOptions } from 'electron';
import path from 'path';
import { AudioState } from './types/audio';
import { AudioManager } from './audioManager';

/**
 * TrayManager creates and manages the menu bar icon and context menu.
 * 
 * The icon changes based on Little One's connection and lock status:
 * - Disconnected: Gray/dim icon
 * - Connected (not locked): Normal icon
 * - Connected + Locked: Active/highlighted icon
 * 
 * The context menu provides:
 * - Status display
 * - Lock toggle checkbox
 * - Link to open the main app window
 * - Quit action
 */
export class TrayManager {
  private tray: Tray | null = null;
  private audioManager: AudioManager;
  private showWindowCallback: (() => void) | null = null;

  constructor(audioManager: AudioManager) {
    this.audioManager = audioManager;
  }

  /**
   * Initialize the tray icon and set up event listeners.
   */
  init(showWindowCallback?: () => void): void {
    // Only create tray on macOS.
    if (process.platform !== 'darwin') {
      console.log('[TrayManager] Not on macOS, skipping tray creation');
      return;
    }

    this.showWindowCallback = showWindowCallback || null;

    // Create the tray with the initial disconnected icon.
    const iconPath = this.getIconPath('disconnected');
    const icon = nativeImage.createFromPath(iconPath);

    // For macOS, use template images for proper dark/light mode support.
    this.tray = new Tray(icon);
    this.tray.setToolTip('Little One');

    // Listen for state changes to update the tray.
    this.audioManager.on('stateChanged', (state: AudioState) => {
      this.updateTray(state);
    });

    // Initial update with current state.
    this.updateTray(this.audioManager.getState());

    console.log('[TrayManager] Initialized');
  }

  /**
   * Clean up tray resources.
   */
  destroy(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private methods
  // ---------------------------------------------------------------------------

  /**
   * Get the path to a tray icon based on the current state.
   */
  private getIconPath(state: 'disconnected' | 'connected' | 'active'): string {
    // Use Template.png suffix for macOS to get automatic dark/light mode support.
    const filename = `littleone-${state}Template.png`;

    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'assets', filename);
    } else {
      return path.join(__dirname, '../assets', filename);
    }
  }

  /**
   * Update the tray icon and context menu based on the current audio state.
   */
  private updateTray(state: AudioState): void {
    if (!this.tray) return;

    const { littleOnePresent, priorityMode, userOverrideId, defaultInputId, devices } = state;

    // --- Update icon based on state ---
    let iconState: 'disconnected' | 'connected' | 'active';
    if (!littleOnePresent) {
      iconState = 'disconnected';
    } else if (priorityMode && !userOverrideId) {
      iconState = 'active';
    } else {
      iconState = 'connected';
    }

    const iconPath = this.getIconPath(iconState);
    try {
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) {
        this.tray.setImage(icon);
      }
    } catch (error) {
      console.warn('[TrayManager] Failed to load icon:', iconPath);
    }

    // --- Update tooltip ---
    let tooltip: string;
    if (!littleOnePresent) {
      tooltip = 'Little One: Not connected';
    } else if (priorityMode && !userOverrideId) {
      tooltip = 'Little One: Locked as microphone';
    } else if (priorityMode && userOverrideId) {
      tooltip = 'Little One: Override active (click to reset)';
    } else {
      tooltip = 'Little One: Connected (click menu to lock)';
    }
    this.tray.setToolTip(tooltip);

    // --- Build context menu ---
    const menuItems = this.buildContextMenu(state);
    const contextMenu = Menu.buildFromTemplate(menuItems);
    this.tray.setContextMenu(contextMenu);
  }

  /**
   * Build the context menu items based on current state.
   */
  private buildContextMenu(state: AudioState): MenuItemConstructorOptions[] {
    const { littleOnePresent, priorityMode, userOverrideId, defaultInputId, devices } = state;

    // Determine the status label to display.
    let statusLabel: string;
    if (!littleOnePresent) {
      statusLabel = 'Little One: Not connected';
    } else if (priorityMode && !userOverrideId) {
      statusLabel = 'Little One: Locked as input';
    } else if (priorityMode && userOverrideId) {
      statusLabel = 'Little One: Override active';
    } else {
      statusLabel = 'Little One: Available (not locked)';
    }

    // Find the current default input device name.
    const currentDefaultDevice = devices.find((d) => d.id === defaultInputId);
    const currentDefaultName = currentDefaultDevice?.name || 'None';

    const items: MenuItemConstructorOptions[] = [
      // Status line (disabled, just for display).
      {
        label: statusLabel,
        enabled: false,
      },
      {
        label: `Current mic: ${currentDefaultName}`,
        enabled: false,
      },
      { type: 'separator' },

      // Priority lock toggle.
      {
        label: 'Lock input to Little One',
        type: 'checkbox',
        checked: priorityMode,
        enabled: littleOnePresent,
        click: async (menuItem) => {
          await this.audioManager.setPriorityMode(menuItem.checked);
        },
      },
    ];

    // If there's a user override, show an option to reset it.
    if (userOverrideId && priorityMode) {
      items.push({
        label: 'Reset to Little One',
        click: async () => {
          await this.audioManager.clearUserOverride();
        },
      });
    }

    // Explanation text (disabled, just for information).
    items.push({
      label: littleOnePresent
        ? 'When locked, Little One stays your mic'
        : 'Connect Little One to enable locking',
      enabled: false,
    });

    items.push({ type: 'separator' });

    // Open main app window.
    items.push({
      label: 'Open Little One App…',
      click: () => {
        if (this.showWindowCallback) {
          this.showWindowCallback();
        }
      },
    });

    // Quit action.
    items.push({
      label: 'Quit Little One',
      role: 'quit',
    });

    return items;
  }
}
