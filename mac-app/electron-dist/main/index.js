"use strict";
// =============================================================================
// Main Entry Point - Wires together all Electron main process components.
// Handles app lifecycle, window creation, IPC handlers, and audio management.
// =============================================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = __importDefault(require("path"));
const nativeHelper_1 = require("./nativeHelper");
const audioManager_1 = require("./audioManager");
const trayManager_1 = require("./trayManager");
const audio_1 = require("./types/audio");
// =============================================================================
// Global references - Keep these alive to prevent garbage collection.
// =============================================================================
let mainWindow = null;
let nativeHelper = null;
let audioManager = null;
let trayManager = null;
// =============================================================================
// Window Management
// =============================================================================
/**
 * Create the main application window.
 */
function createWindow() {
    // Determine the preload script path.
    const preloadPath = electron_1.app.isPackaged
        ? path_1.default.join(__dirname, '../preload.js')
        : path_1.default.join(__dirname, '../preload.ts');
    mainWindow = new electron_1.BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        backgroundColor: '#f5f5f5',
        titleBarStyle: 'hiddenInset', // Modern macOS style with traffic lights in content.
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            preload: preloadPath,
        },
    });
    // Load the app - either from Vite dev server or built files.
    const startUrl = process.env.ELECTRON_START_URL;
    if (startUrl) {
        mainWindow.loadURL(startUrl);
    }
    else {
        mainWindow.loadFile(path_1.default.join(__dirname, '../../dist/index.html'));
    }
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}
/**
 * Show the main window, creating it if needed.
 */
function showMainWindow() {
    if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
    }
    else {
        createWindow();
    }
}
// =============================================================================
// IPC Handlers - Bridge between renderer and audio management.
// =============================================================================
/**
 * Set up all IPC handlers for audio-related communication.
 */
function setupIPCHandlers() {
    // Get current audio state.
    electron_1.ipcMain.handle(audio_1.AudioIPCChannels.GET_STATE, () => {
        if (!audioManager) {
            return {
                devices: [],
                defaultInputId: null,
                priorityMode: false,
                userOverrideId: null,
                littleOnePresent: false,
                preferredLittleOneId: null,
            };
        }
        return audioManager.getState();
    });
    // Set priority mode (lock/unlock).
    electron_1.ipcMain.handle(audio_1.AudioIPCChannels.SET_PRIORITY_MODE, async (_event, payload) => {
        if (audioManager) {
            await audioManager.setPriorityMode(payload.enabled);
        }
    });
    // Reset user override.
    electron_1.ipcMain.handle(audio_1.AudioIPCChannels.RESET_OVERRIDE, async () => {
        if (audioManager) {
            await audioManager.clearUserOverride();
        }
    });
}
/**
 * Broadcast audio state changes to all renderer windows.
 */
function broadcastStateChanged() {
    if (!audioManager)
        return;
    const state = audioManager.getState();
    // Send to all windows.
    electron_1.BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
            window.webContents.send(audio_1.AudioIPCChannels.STATE_CHANGED, state);
        }
    });
}
// =============================================================================
// Audio System Initialization
// =============================================================================
/**
 * Initialize the audio management system.
 * This sets up the native helper, audio manager, and tray integration.
 */
async function initAudioSystem() {
    console.log('[Main] Initializing audio system...');
    // Create and start the native helper (macOS only).
    nativeHelper = new nativeHelper_1.NativeHelper();
    nativeHelper.start();
    // Create the audio manager with the native helper.
    audioManager = new audioManager_1.AudioManager(nativeHelper);
    // Set up state change broadcasting to renderer.
    audioManager.on('stateChanged', () => {
        broadcastStateChanged();
    });
    // Initialize the audio manager (fetches devices, starts monitoring).
    await audioManager.init();
    // Create and initialize the tray manager.
    trayManager = new trayManager_1.TrayManager(audioManager);
    trayManager.init(showMainWindow);
    console.log('[Main] Audio system initialized');
}
// =============================================================================
// App Lifecycle
// =============================================================================
// Prevent multiple instances of the app.
const gotTheLock = electron_1.app.requestSingleInstanceLock();
if (!gotTheLock) {
    electron_1.app.quit();
}
else {
    electron_1.app.on('second-instance', () => {
        // Someone tried to run a second instance - focus our window instead.
        showMainWindow();
    });
    // App is ready - initialize everything.
    electron_1.app.whenReady().then(async () => {
        console.log('[Main] App ready');
        // Set up IPC handlers before creating windows.
        setupIPCHandlers();
        // Initialize the audio system (native helper, manager, tray).
        await initAudioSystem();
        // Create the main window.
        createWindow();
        // macOS: Re-create window when clicking dock icon with no windows open.
        electron_1.app.on('activate', () => {
            if (electron_1.BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });
    // Quit when all windows are closed (except on macOS).
    electron_1.app.on('window-all-closed', () => {
        // On macOS, keep the app running in the menu bar.
        if (process.platform !== 'darwin') {
            electron_1.app.quit();
        }
    });
    // Clean up before quitting.
    electron_1.app.on('before-quit', () => {
        console.log('[Main] App quitting, cleaning up...');
        if (trayManager) {
            trayManager.destroy();
        }
        if (nativeHelper) {
            nativeHelper.stop();
        }
    });
}
//# sourceMappingURL=index.js.map