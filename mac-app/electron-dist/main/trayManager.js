"use strict";
// =============================================================================
// TrayManager - macOS menu bar (Tray) integration for Little One.
// Displays connection status and provides controls for priority locking.
// =============================================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TrayManager = void 0;
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
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
class TrayManager {
    tray = null;
    audioManager;
    showWindowCallback = null;
    constructor(audioManager) {
        this.audioManager = audioManager;
    }
    /**
     * Initialize the tray icon and set up event listeners.
     */
    init(showWindowCallback) {
        // Only create tray on macOS.
        if (process.platform !== 'darwin') {
            console.log('[TrayManager] Not on macOS, skipping tray creation');
            return;
        }
        this.showWindowCallback = showWindowCallback || null;
        // Create the tray with the initial disconnected icon.
        const iconPath = this.getIconPath('disconnected');
        const icon = electron_1.nativeImage.createFromPath(iconPath);
        // For macOS, use template images for proper dark/light mode support.
        this.tray = new electron_1.Tray(icon);
        this.tray.setToolTip('Little One');
        // Listen for state changes to update the tray.
        this.audioManager.on('stateChanged', (state) => {
            this.updateTray(state);
        });
        // Initial update with current state.
        this.updateTray(this.audioManager.getState());
        console.log('[TrayManager] Initialized');
    }
    /**
     * Clean up tray resources.
     */
    destroy() {
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
    getIconPath(state) {
        // Use Template.png suffix for macOS to get automatic dark/light mode support.
        const filename = `littleone-${state}Template.png`;
        if (electron_1.app.isPackaged) {
            return path_1.default.join(process.resourcesPath, 'assets', filename);
        }
        else {
            // Dev: compiled code runs from electron-dist/main, assets are in electron/assets
            const appPath = electron_1.app.getAppPath();
            return path_1.default.join(appPath, 'electron', 'assets', filename);
        }
    }
    /**
     * Update the tray icon and context menu based on the current audio state.
     */
    updateTray(state) {
        if (!this.tray)
            return;
        const { priorityMode, priorityDeviceId, userOverrideId, defaultInputId, devices } = state;
        // --- Update icon based on state ---
        let iconState;
        if (!priorityDeviceId) {
            iconState = 'disconnected';
        }
        else if (priorityMode && !userOverrideId) {
            iconState = 'active';
        }
        else {
            iconState = 'connected';
        }
        const iconPath = this.getIconPath(iconState);
        try {
            const icon = electron_1.nativeImage.createFromPath(iconPath);
            if (!icon.isEmpty()) {
                this.tray.setImage(icon);
            }
        }
        catch (error) {
            console.warn('[TrayManager] Failed to load icon:', iconPath);
        }
        // --- Update tooltip ---
        const priorityDevice = devices.find((d) => d.id === priorityDeviceId);
        const priorityDeviceName = priorityDevice?.name || 'None';
        let tooltip;
        if (!priorityDeviceId) {
            tooltip = 'Audio Priority: No device selected';
        }
        else if (priorityMode && !userOverrideId) {
            tooltip = `Audio Priority: ${priorityDeviceName} locked`;
        }
        else if (priorityMode && userOverrideId) {
            tooltip = 'Audio Priority: Override active (click to reset)';
        }
        else {
            tooltip = `Audio Priority: ${priorityDeviceName} (click menu to lock)`;
        }
        this.tray.setToolTip(tooltip);
        // --- Build context menu ---
        const menuItems = this.buildContextMenu(state);
        const contextMenu = electron_1.Menu.buildFromTemplate(menuItems);
        this.tray.setContextMenu(contextMenu);
    }
    /**
     * Build the context menu items based on current state.
     */
    buildContextMenu(state) {
        const { priorityMode, priorityDeviceId, userOverrideId, defaultInputId, devices } = state;
        // Find the current default input device name.
        const currentDefaultDevice = devices.find((d) => d.id === defaultInputId);
        const currentDefaultName = currentDefaultDevice?.name || 'None';
        // Get all input devices for the picker menu.
        const inputDevices = devices.filter((d) => d.isInput);
        // Find the priority device name.
        const priorityDevice = devices.find((d) => d.id === priorityDeviceId);
        const priorityDeviceName = priorityDevice?.name || 'None';
        const items = [
            // Current mic status.
            {
                label: `Current mic: ${currentDefaultName}`,
                enabled: false,
            },
            { type: 'separator' },
            // Priority device selection submenu.
            {
                label: 'Priority Device',
                submenu: [
                    // "None" option to clear selection.
                    {
                        label: 'None',
                        type: 'radio',
                        checked: priorityDeviceId === null,
                        click: async () => {
                            await this.audioManager.setPriorityDevice(null);
                        },
                    },
                    { type: 'separator' },
                    // List of all input devices.
                    ...inputDevices.map((device) => ({
                        label: device.name,
                        type: 'radio',
                        checked: device.id === priorityDeviceId,
                        click: async () => {
                            await this.audioManager.setPriorityDevice(device.id);
                        },
                    })),
                ],
            },
            { type: 'separator' },
            // Priority lock toggle.
            {
                label: 'Lock to Priority Device',
                type: 'checkbox',
                checked: priorityMode,
                enabled: !!priorityDeviceId,
                click: async (menuItem) => {
                    await this.audioManager.setPriorityMode(menuItem.checked);
                },
            },
        ];
        // If there's a user override, show an option to reset it.
        if (userOverrideId && priorityMode && priorityDeviceId) {
            items.push({
                label: `Reset to ${priorityDeviceName}`,
                click: async () => {
                    await this.audioManager.clearUserOverride();
                },
            });
        }
        // Status/explanation text.
        if (priorityDeviceId) {
            items.push({
                label: priorityMode
                    ? `When locked, ${priorityDeviceName} stays your mic`
                    : `Select "${priorityDeviceName}" to enable locking`,
                enabled: false,
            });
        }
        else {
            items.push({
                label: 'Select a device above to enable priority locking',
                enabled: false,
            });
        }
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
exports.TrayManager = TrayManager;
//# sourceMappingURL=trayManager.js.map