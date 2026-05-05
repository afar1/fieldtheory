import { Tray, Menu, nativeImage, app, MenuItemConstructorOptions, net } from 'electron';
import path from 'path';
import { AudioState } from './types/audio';
import { AudioManager } from './audioManager';
import { QuotaManager } from './quotaManager';
import type { PreferencesManager } from './preferences';
import { createLogger } from './logger';

const log = createLogger('Tray');
// Keep this aligned with src/utils/audioWaveform.ts; electron main is built from electron/.
const TRAY_WAVEFORM_BAR_COUNT = 7;
const TRAY_WAVEFORM_CHARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇'];

function scaleTrayAudioLevel(rawLevel: number): number {
  if (rawLevel <= 0) return 0;
  return Math.min(1, Math.sqrt(rawLevel * 8));
}

function renderTrayWaveformTitle(levels: number[]): string {
  return levels.map((level) => {
    const scaled = scaleTrayAudioLevel(level);
    const index = Math.round(scaled * (TRAY_WAVEFORM_CHARS.length - 1));
    return TRAY_WAVEFORM_CHARS[index];
  }).join('');
}

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
  private preferencesManager: PreferencesManager | null = null;
  private showWindowCallback: (() => void) | null = null;
  private showMainWindowCallback: (() => void) | null = null;
  private showOnboardingCallback: (() => void) | null = null;
  private checkForUpdatesCallback: (() => void) | null = null;
  private startRecordingCallback: (() => void) | null = null;
  private takeScreenshotCallback: (() => void) | null = null;
  private takeFullScreenCallback: (() => void) | null = null;
  private takeActiveWindowCallback: (() => void) | null = null;
  private openDevToolsCallback: (() => void) | null = null;
  private isLoggedInCallback: (() => boolean) | null = null;
  private historyHotkey: string = 'Option+Space';
  private transcriptionHotkey: string = 'Option+Shift+Space';
  private screenshotHotkey: string = 'Command+4';
  private taggedDocsUnreadCount: number = 0;
  private recordingActive: boolean = false;
  private recordingWaveformLevels: number[] = new Array(TRAY_WAVEFORM_BAR_COUNT).fill(0);
  private recordingWaveformWriteIndex: number = 0;

  constructor(audioManager: AudioManager, quotaManager?: QuotaManager, preferencesManager?: PreferencesManager) {
    this.audioManager = audioManager;
    this.quotaManager = quotaManager || null;
    this.preferencesManager = preferencesManager || null;
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
   * Set the callback to show the onboarding window.
   */
  setShowOnboardingCallback(callback: () => void): void {
    this.showOnboardingCallback = callback;
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
   * Set the callback to open developer tools.
   */
  setOpenDevToolsCallback(callback: () => void): void {
    this.openDevToolsCallback = callback;
  }

  /**
   * Set the callback to check if user is logged in.
   */
  setIsLoggedInCallback(callback: () => boolean): void {
    this.isLoggedInCallback = callback;
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

  setTaggedDocsUnreadCount(count: number): void {
    this.taggedDocsUnreadCount = Math.max(0, Math.floor(count));
    if (this.tray) {
      this.updateTray(this.audioManager.getState());
    }
  }

  setRecordingActive(active: boolean): void {
    const nextActive = Boolean(active);
    if (this.recordingActive === nextActive) return;
    this.recordingActive = nextActive;
    this.resetRecordingWaveform();
    if (this.tray) {
      this.updateTrayTitle(this.audioManager.getState());
    }
  }

  updateRecordingAudioLevel(level: number): void {
    if (!this.recordingActive || !this.tray) return;
    const normalizedLevel = Number.isFinite(level)
      ? Math.max(0, Math.min(1, level))
      : 0;
    this.recordingWaveformLevels[this.recordingWaveformWriteIndex % TRAY_WAVEFORM_BAR_COUNT] = normalizedLevel;
    this.recordingWaveformWriteIndex += 1;
    this.updateTrayTitle(this.audioManager.getState());
  }

  /**
   * Initialize the tray icon and set up event listeners.
   */
  init(showWindowCallback?: () => void, checkForUpdatesCallback?: () => void, startRecordingCallback?: () => void, takeScreenshotCallback?: () => void, takeFullScreenCallback?: () => void, takeActiveWindowCallback?: () => void, showMainWindowCallback?: () => void): void {
    if (process.platform !== 'darwin') {
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
      log.error('Failed to load icon:', iconPath);
    }

    // --- Update tooltip and title ---
    const priorityDevice = devices.find((d) => d.id === priorityDeviceId);
    const priorityDeviceName = priorityDevice?.name || 'None';

    this.updateTrayTitle(state);

    let tooltip: string;
    if (!priorityDeviceId) {
      tooltip = 'Field Theory';
    } else if (priorityMode && !userOverrideId) {
      tooltip = `Priority Mic: ${priorityDeviceName}`;
    } else if (priorityMode && userOverrideId) {
      tooltip = `Priority Mic: ${priorityDeviceName} (override active)`;
    } else {
      tooltip = `Priority Mic: ${priorityDeviceName}`;
    }
    this.tray.setToolTip(tooltip);

    const menuItems = this.buildContextMenu(state);
    try {
      const contextMenu = Menu.buildFromTemplate(menuItems);
      this.tray.setContextMenu(contextMenu);
    } catch (error) {
      log.error('Failed to build tray menu with accelerators:', error);
      const fallbackMenuItems = this.stripAccelerators(menuItems);
      const contextMenu = Menu.buildFromTemplate(fallbackMenuItems);
      this.tray.setContextMenu(contextMenu);
    }
  }

  private updateTrayTitle(state: AudioState): void {
    if (!this.tray) return;

    const { priorityDeviceId, devices } = state;
    const priorityDevice = devices.find((d) => d.id === priorityDeviceId);
    const unreadTitle = this.taggedDocsUnreadCount > 0 ? ` •${this.taggedDocsUnreadCount}` : '';

    if (this.recordingActive) {
      const waveformTitle = renderTrayWaveformTitle(this.getOrderedRecordingWaveformLevels());
      this.tray.setTitle(`${waveformTitle}${unreadTitle}`);
      return;
    }

    if (priorityDeviceId && priorityDevice) {
      const abbrev = priorityDevice.name.slice(0, 3);
      this.tray.setTitle(`:${abbrev}${unreadTitle}`);
    } else {
      this.tray.setTitle(unreadTitle.trimStart());
    }
  }

  private resetRecordingWaveform(): void {
    this.recordingWaveformLevels.fill(0);
    this.recordingWaveformWriteIndex = 0;
  }

  private getOrderedRecordingWaveformLevels(): number[] {
    const result: number[] = [];
    const start = this.recordingWaveformWriteIndex;
    for (let i = 0; i < TRAY_WAVEFORM_BAR_COUNT; i++) {
      result.push(this.recordingWaveformLevels[(start + i) % TRAY_WAVEFORM_BAR_COUNT]);
    }
    return result;
  }

  private stripAccelerators(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
    return items.map((item) => {
      const stripped = { ...(item as Record<string, unknown>) };
      delete stripped.accelerator;
      if (Array.isArray(stripped.submenu)) {
        stripped.submenu = this.stripAccelerators(stripped.submenu as MenuItemConstructorOptions[]);
      }
      return stripped as MenuItemConstructorOptions;
    });
  }

  /**
   * Build the context menu items based on current state.
   *
   * Shows: Priority Mic: [name] at top, then device submenu, then helper text.
   * The "Enable Priority Microphone" toggle is removed - priority mode is auto-enabled
   * when a priority device is selected.
   *
   * During onboarding, only shows "Quit Field Theory" - all other options are disabled
   * until onboarding is complete.
   */
  private buildContextMenu(state: AudioState): MenuItemConstructorOptions[] {
    // During onboarding, show minimal menu with only Quit option
    const prefs = this.preferencesManager?.get();
    if (!prefs?.onboardingComplete) {
      return [
        {
          label: 'Complete Onboarding…',
          click: () => {
            if (this.showOnboardingCallback) {
              this.showOnboardingCallback();
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Quit Field Theory',
          accelerator: 'Command+Q',
          click: () => {
            app.quit();
          },
        },
      ];
    }

    const { priorityMode, priorityDeviceId, userOverrideId, defaultInputId, devices } = state;

    const currentDefaultDevice = devices.find((d) => d.id === defaultInputId);
    const currentDefaultName = currentDefaultDevice?.name || 'Unknown';
    const inputDevices = devices.filter((d) => d.isInput);
    const priorityDevice = devices.find((d) => d.id === priorityDeviceId);
    const priorityDeviceName = priorityDevice?.name || 'None';

    // Check priority mic quota status.
    const quotas = this.quotaManager?.getQuotas();
    const priorityMicQuotaExhausted = quotas && !quotas.priorityMic.allowed;

    // Build submenu items for priority mic selection.
    const priorityMicSubmenu: MenuItemConstructorOptions[] = [
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
        // Disable device options when quota is exhausted.
        enabled: !priorityMicQuotaExhausted,
        click: async () => {
          // Auto-enable priority mode when selecting a device.
          await this.audioManager.setPriorityDevice(device.id);
          if (!priorityMode) {
            await this.audioManager.setPriorityMode(true);
          }
        },
      })),
    ];

    // Menu structure: Set Priority Mic submenu, then Current mic, then helper text.
    const items: MenuItemConstructorOptions[] = [
      {
        label: 'Set Priority Mic',
        submenu: priorityMicSubmenu,
      },
      {
        label: priorityDeviceId
          ? `Priority Mic: ${priorityDeviceName}`
          : 'Priority Mic: None',
        enabled: false,
      },
      {
        label: priorityMicQuotaExhausted
          ? 'Priority mic temporarily unavailable'
          : priorityDeviceId
            ? 'Will auto-connect when plugged in'
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

    if (this.taggedDocsUnreadCount > 0) {
      items.push({
        label: `${this.taggedDocsUnreadCount} unread shared document${this.taggedDocsUnreadCount === 1 ? '' : 's'}`,
        enabled: false,
      });
      items.push({ type: 'separator' });
    }

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

    items.push({
      label: 'Settings…',
      click: () => {
        if (this.showWindowCallback) {
          this.showWindowCallback();
        }
      },
    });

    // View Inspector - only show when logged in
    const isLoggedIn = this.isLoggedInCallback?.() ?? false;
    if (isLoggedIn && this.openDevToolsCallback) {
      items.push({
        label: 'View Inspector',
        accelerator: 'Command+Option+I',
        click: () => {
          this.openDevToolsCallback?.();
        },
      });
    }

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
