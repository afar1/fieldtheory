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
  private checkForUpdatesCallback: (() => void) | null = null;

  constructor(audioManager: AudioManager) {
    this.audioManager = audioManager;
  }

  /**
   * Initialize the tray icon and set up event listeners.
   */
  init(showWindowCallback?: () => void, checkForUpdatesCallback?: () => void): void {
    if (process.platform !== 'darwin') {
      console.log('[TrayManager] Not on macOS, skipping tray creation');
      return;
    }

    this.showWindowCallback = showWindowCallback || null;
    this.checkForUpdatesCallback = checkForUpdatesCallback || null;

    const iconPath = this.getIconPath('disconnected');
    const icon = nativeImage.createFromPath(iconPath);
    this.tray = new Tray(icon);
    this.tray.setToolTip('Field Theory');

    this.audioManager.on('stateChanged', (state: AudioState) => {
      this.updateTray(state);
    });
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

  /**
   * Get the path to a tray icon based on the current state.
   * Now uses Field Theory icon for all states.
   */
  private getIconPath(state: 'disconnected' | 'connected' | 'active'): string {
    // Use Field Theory icon for all states (single icon, no state variations).
    const filename = 'fieldtheory-iconTemplate.png';

    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'assets', filename);
    } else {
      const appPath = app.getAppPath();
      return path.join(appPath, 'electron', 'assets', filename);
    }
  }

  /**
   * Update the tray icon and context menu based on the current audio state.
   */
  private updateTray(state: AudioState): void {
    if (!this.tray) return;

    const { priorityMode, priorityDeviceId, userOverrideId, defaultInputId, devices } = state;

    let iconState: 'disconnected' | 'connected' | 'active';
    if (!priorityDeviceId) {
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
    const priorityDevice = devices.find((d) => d.id === priorityDeviceId);
    const priorityDeviceName = priorityDevice?.name || 'None';
    
    let tooltip: string;
    if (!priorityDeviceId) {
      tooltip = 'Audio Priority: No device selected';
    } else if (priorityMode && !userOverrideId) {
      tooltip = `Audio Priority: ${priorityDeviceName} locked`;
    } else if (priorityMode && userOverrideId) {
      tooltip = 'Audio Priority: Override active (click to reset)';
    } else {
      tooltip = `Audio Priority: ${priorityDeviceName} (click menu to lock)`;
    }
    this.tray.setToolTip(tooltip);

    const menuItems = this.buildContextMenu(state);
    const contextMenu = Menu.buildFromTemplate(menuItems);
    this.tray.setContextMenu(contextMenu);
  }

  /**
   * Build the context menu items based on current state.
   */
  private buildContextMenu(state: AudioState): MenuItemConstructorOptions[] {
    const { priorityMode, priorityDeviceId, userOverrideId, defaultInputId, devices } = state;

    const currentDefaultDevice = devices.find((d) => d.id === defaultInputId);
    const currentDefaultName = currentDefaultDevice?.name || 'None';
    const inputDevices = devices.filter((d) => d.isInput);
    const priorityDevice = devices.find((d) => d.id === priorityDeviceId);
    const priorityDeviceName = priorityDevice?.name || 'None';

    const items: MenuItemConstructorOptions[] = [
      {
        label: `Current mic: ${currentDefaultName}`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Priority Microphone',
        submenu: [
          {
            label: 'None',
            type: 'radio',
            checked: priorityDeviceId === null,
            click: async () => {
              await this.audioManager.setPriorityDevice(null);
            },
          },
          { type: 'separator' },
          ...inputDevices.map((device) => ({
            label: device.name,
            type: 'radio' as const,
            checked: device.id === priorityDeviceId,
            click: async () => {
              await this.audioManager.setPriorityDevice(device.id);
            },
          })),
        ],
      },
      { type: 'separator' },
      {
        label: 'Enable Priority Microphone',
        type: 'checkbox',
        checked: priorityMode,
        enabled: !!priorityDeviceId,
        click: async (menuItem) => {
          await this.audioManager.setPriorityMode(menuItem.checked);
        },
      },
    ];

    if (userOverrideId && priorityMode && priorityDeviceId) {
      items.push({
        label: `Reset to ${priorityDeviceName}`,
        click: async () => {
          await this.audioManager.clearUserOverride();
        },
      });
    }

    if (priorityDeviceId) {
      items.push({
        label: priorityMode
          ? 'Your microphone will not auto-switch while enabled'
          : `Select "${priorityDeviceName}" to enable`,
        enabled: false,
      });
    } else {
      items.push({
        label: 'Select a microphone above to enable priority',
        enabled: false,
      });
    }

    items.push({ type: 'separator' });

    items.push({
      label: 'Settings…',
      click: () => {
        if (this.showWindowCallback) {
          this.showWindowCallback();
        }
      },
    });

    items.push({
      label: 'Check for Updates…',
      click: () => {
        if (this.checkForUpdatesCallback) {
          this.checkForUpdatesCallback();
        }
      },
    });

    items.push({
      label: 'Quit Field Theory',
      role: 'quit',
    });

    return items;
  }
}
