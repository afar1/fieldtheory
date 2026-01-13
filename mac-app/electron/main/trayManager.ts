import { Tray, Menu, nativeImage, app, MenuItemConstructorOptions, net } from 'electron';
import path from 'path';
import { AudioState } from './types/audio';
import { AudioManager } from './audioManager';
import { QuotaManager } from './quotaManager';
import { TranscriberManager } from './transcriberManager';

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
  private quotaManager: QuotaManager | null = null;
  private transcriberManager: TranscriberManager | null = null;
  private showWindowCallback: (() => void) | null = null;
  private showMainWindowCallback: (() => void) | null = null;
  private checkForUpdatesCallback: (() => void) | null = null;
  private startRecordingCallback: (() => void) | null = null;
  private takeScreenshotCallback: (() => void) | null = null;
  private takeFullScreenCallback: (() => void) | null = null;
  private takeActiveWindowCallback: (() => void) | null = null;
  private historyHotkey: string = 'Option+Space';
  private transcriptionHotkey: string = 'Option+Shift+Space';
  private screenshotHotkey: string = 'Command+4';

  constructor(audioManager: AudioManager, quotaManager?: QuotaManager) {
    this.audioManager = audioManager;
    this.quotaManager = quotaManager || null;
  }

  /**
   * Set the quota manager and listen for quota changes.
   */
  setQuotaManager(quotaManager: QuotaManager): void {
    this.quotaManager = quotaManager;

    // Listen for quota changes to update menu
    this.quotaManager.on('quotaChanged', () => {
      this.updateTray(this.audioManager.getState());
    });
    this.quotaManager.on('tierChanged', () => {
      this.updateTray(this.audioManager.getState());
    });

    // Refresh menu to show quota
    if (this.tray) {
      this.updateTray(this.audioManager.getState());
    }
  }

  /**
   * Set the transcriber manager for accessing auto-improve state.
   */
  setTranscriberManager(transcriberManager: TranscriberManager): void {
    this.transcriberManager = transcriberManager;

    // Refresh menu to show auto-improve toggle
    if (this.tray) {
      this.updateTray(this.audioManager.getState());
    }
  }

  /**
   * Refresh the tray menu with current state.
   * Call this when settings change to update the menu display.
   */
  refreshMenu(): void {
    if (this.tray) {
      this.updateTray(this.audioManager.getState());
    }
  }

  /**
   * Update the hotkeys displayed in the menu.
   */
  setHotkeys(historyHotkey: string, transcriptionHotkey: string, screenshotHotkey: string): void {
    this.historyHotkey = historyHotkey;
    this.transcriptionHotkey = transcriptionHotkey;
    this.screenshotHotkey = screenshotHotkey;
    // Refresh menu if tray is active
    if (this.tray) {
      this.updateTray(this.audioManager.getState());
    }
  }

  /**
   * Initialize the tray icon and set up event listeners.
   */
  init(showWindowCallback?: () => void, checkForUpdatesCallback?: () => void, startRecordingCallback?: () => void, takeScreenshotCallback?: () => void, takeFullScreenCallback?: () => void, takeActiveWindowCallback?: () => void, showMainWindowCallback?: () => void): void {
    if (process.platform !== 'darwin') {
      console.log('[TrayManager] Not on macOS, skipping tray creation');
      return;
    }

    this.showWindowCallback = showWindowCallback || null;
    this.showMainWindowCallback = showMainWindowCallback || null;
    this.checkForUpdatesCallback = checkForUpdatesCallback || null;
    this.startRecordingCallback = startRecordingCallback || null;
    this.takeScreenshotCallback = takeScreenshotCallback || null;
    this.takeFullScreenCallback = takeFullScreenCallback || null;
    this.takeActiveWindowCallback = takeActiveWindowCallback || null;

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
   * 
   * Shows: Priority Mic: [name] at top, then device submenu, then helper text.
   * The "Enable Priority Microphone" toggle is removed - priority mode is auto-enabled
   * when a priority device is selected.
   */
  private buildContextMenu(state: AudioState): MenuItemConstructorOptions[] {
    const { priorityMode, priorityDeviceId, userOverrideId, defaultInputId, devices } = state;

    const currentDefaultDevice = devices.find((d) => d.id === defaultInputId);
    const currentDefaultName = currentDefaultDevice?.name || 'Unknown';
    const inputDevices = devices.filter((d) => d.isInput);
    const priorityDevice = devices.find((d) => d.id === priorityDeviceId);
    const priorityDeviceName = priorityDevice?.name || 'None';

    // Menu structure: Set Priority Mic submenu, then Current mic, then helper text.
    const items: MenuItemConstructorOptions[] = [
      {
        label: 'Set Priority Mic',
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
              // Auto-enable priority mode when selecting a device.
              await this.audioManager.setPriorityDevice(device.id);
              if (!priorityMode) {
                await this.audioManager.setPriorityMode(true);
              }
            },
          })),
        ],
      },
      {
        label: `Current: ${currentDefaultName}`,
        enabled: false,
      },
      {
        label: priorityDeviceId
          ? 'Selected mic will not auto-switch'
          : 'Select a mic to lock it',
        enabled: false,
      },
    ];

    // Show reset option if user has manually overridden the priority device.
    if (userOverrideId && priorityMode && priorityDeviceId) {
      items.push({
        label: `Reset to ${priorityDeviceName}`,
        click: async () => {
          await this.audioManager.clearUserOverride();
        },
      });
    }

    items.push({ type: 'separator' });

    // Primary actions: Open and Start Recording.
    items.push({
      label: 'Open Field Theory',
      accelerator: this.historyHotkey,
      click: () => {
        if (this.showWindowCallback) {
          this.showWindowCallback();
        }
      },
    });

    items.push({
      label: 'Record Transcription',
      accelerator: this.transcriptionHotkey,
      click: () => {
        if (this.startRecordingCallback) {
          this.startRecordingCallback();
        }
      },
    });

    items.push({
      label: 'Take Screenshot',
      accelerator: this.screenshotHotkey,
      click: () => {
        if (this.takeScreenshotCallback) {
          this.takeScreenshotCallback();
        }
      },
    });

    items.push({
      label: 'Take Full Screen Screenshot',
      accelerator: 'Command+Shift+4',
      click: () => {
        if (this.takeFullScreenCallback) {
          this.takeFullScreenCallback();
        }
      },
    });

    items.push({
      label: 'Take Active Window Screenshot',
      accelerator: 'Command+3',
      click: () => {
        if (this.takeActiveWindowCallback) {
          this.takeActiveWindowCallback();
        }
      },
    });

    items.push({ type: 'separator' });

    // Show quota usage for non-pro users
    if (this.quotaManager) {
      const quotas = this.quotaManager.getQuotas();
      const tier = quotas.tier;

      if (tier !== 'pro') {
        const micMinutes = Math.floor(quotas.priorityMic.used / 60);
        const micLimitNum = quotas.priorityMic.limit === Infinity ? Infinity : Math.floor(quotas.priorityMic.limit / 60);
        const micLimit = micLimitNum === Infinity ? '∞' : micLimitNum;
        const stackUsed = quotas.autoStack.used;
        const stackLimitNum = quotas.autoStack.limit === Infinity ? Infinity : quotas.autoStack.limit;
        const stackLimit = stackLimitNum === Infinity ? '∞' : stackLimitNum;

        // Cap displayed usage at limit (don't show over-usage in menu bar)
        const displayMicMinutes = micLimitNum === Infinity ? micMinutes : Math.min(micMinutes, micLimitNum);
        const displayStackUsed = stackLimitNum === Infinity ? stackUsed : Math.min(stackUsed, stackLimitNum);

        items.push({
          label: `Usage: ${displayMicMinutes}/${micLimit} mins · ${displayStackUsed}/${stackLimit} stacks`,
          enabled: false,
        });
      } else {
        items.push({
          label: 'Pro Plan: Unlimited',
          enabled: false,
        });
      }

      items.push({ type: 'separator' });
    }

    // Auto-improve toggle
    if (this.transcriberManager) {
      const autoImproveEnabled = this.transcriberManager.getAutoImprove();
      items.push({
        label: `Auto-Improve Transcripts (${autoImproveEnabled ? 'On' : 'Off'})`,
        accelerator: 'Command+Shift+\\',
        click: async () => {
          if (this.transcriberManager) {
            const currentState = this.transcriberManager.getAutoImprove();
            await this.transcriberManager.setAutoImprove(!currentState);
            // Menu will refresh automatically on next open
          }
        },
      });
      items.push({ type: 'separator' });
    }

    items.push({
      label: 'Settings…',
      click: () => {
        if (this.showWindowCallback) {
          this.showWindowCallback();
        }
      },
    });

    // Check network status at menu build time to show offline state.
    const isOnline = net.isOnline();
    items.push({
      label: isOnline ? 'Check for Updates…' : 'Check for Updates (Offline)',
      enabled: isOnline,
      click: () => {
        if (this.checkForUpdatesCallback) {
          this.checkForUpdatesCallback();
        }
      },
    });

    items.push({
      label: 'Quit Field Theory',
      accelerator: 'Command+Q',
      click: () => {
        app.quit();
      },
    });

    return items;
  }
}
