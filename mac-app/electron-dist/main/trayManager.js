"use strict";
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
        if (process.platform !== 'darwin') {
            console.log('[TrayManager] Not on macOS, skipping tray creation');
            return;
        }
        this.showWindowCallback = showWindowCallback || null;
        const iconPath = this.getIconPath('disconnected');
        const icon = electron_1.nativeImage.createFromPath(iconPath);
        this.tray = new electron_1.Tray(icon);
        this.tray.setToolTip('Little One');
        this.audioManager.on('stateChanged', (state) => {
            this.updateTray(state);
        });
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
    /**
     * Get the path to a tray icon based on the current state.
     */
    getIconPath(state) {
        const filename = `littleone-${state}Template.png`;
        if (electron_1.app.isPackaged) {
            return path_1.default.join(process.resourcesPath, 'assets', filename);
        }
        else {
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
        const menuItems = this.buildContextMenu(state);
        const contextMenu = electron_1.Menu.buildFromTemplate(menuItems);
        this.tray.setContextMenu(contextMenu);
    }
    /**
     * Build the context menu items based on current state.
     */
    buildContextMenu(state) {
        const { priorityMode, priorityDeviceId, userOverrideId, defaultInputId, devices } = state;
        const currentDefaultDevice = devices.find((d) => d.id === defaultInputId);
        const currentDefaultName = currentDefaultDevice?.name || 'None';
        const inputDevices = devices.filter((d) => d.isInput);
        const priorityDevice = devices.find((d) => d.id === priorityDeviceId);
        const priorityDeviceName = priorityDevice?.name || 'None';
        const items = [
            {
                label: `Current mic: ${currentDefaultName}`,
                enabled: false,
            },
            { type: 'separator' },
            {
                label: 'Priority Device',
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
                        type: 'radio',
                        checked: device.id === priorityDeviceId,
                        click: async () => {
                            await this.audioManager.setPriorityDevice(device.id);
                        },
                    })),
                ],
            },
            { type: 'separator' },
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
        items.push({
            label: 'Open Little One App…',
            click: () => {
                if (this.showWindowCallback) {
                    this.showWindowCallback();
                }
            },
        });
        items.push({
            label: 'Quit Little One',
            role: 'quit',
        });
        return items;
    }
}
exports.TrayManager = TrayManager;
//# sourceMappingURL=trayManager.js.map