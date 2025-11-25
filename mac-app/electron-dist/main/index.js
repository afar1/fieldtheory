"use strict";
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
let mainWindow = null;
let nativeHelper = null;
let audioManager = null;
let trayManager = null;
/**
 * Create the main application window.
 */
function createWindow() {
    // Determine the preload script path.
    // In both dev and production, use the compiled .js file
    const preloadPath = path_1.default.join(__dirname, '../preload.js');
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
/**
 * Set up all IPC handlers for audio-related communication.
 */
function setupIPCHandlers() {
    electron_1.ipcMain.handle(audio_1.AudioIPCChannels.GET_STATE, () => {
        if (!audioManager) {
            return {
                devices: [],
                defaultInputId: null,
                priorityMode: false,
                priorityDeviceId: null,
                userOverrideId: null,
            };
        }
        return audioManager.getState();
    });
    electron_1.ipcMain.handle(audio_1.AudioIPCChannels.SET_PRIORITY_MODE, async (_event, payload) => {
        if (audioManager) {
            await audioManager.setPriorityMode(payload.enabled);
        }
    });
    electron_1.ipcMain.handle(audio_1.AudioIPCChannels.SET_PRIORITY_DEVICE, async (_event, payload) => {
        if (audioManager) {
            await audioManager.setPriorityDevice(payload.deviceId);
        }
    });
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
    electron_1.BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
            window.webContents.send(audio_1.AudioIPCChannels.STATE_CHANGED, state);
        }
    });
}
/**
 * Initialize the audio management system.
 * This sets up the native helper, audio manager, and tray integration.
 */
async function initAudioSystem() {
    console.log('[Main] Initializing audio system...');
    nativeHelper = new nativeHelper_1.NativeHelper();
    nativeHelper.start();
    audioManager = new audioManager_1.AudioManager(nativeHelper);
    audioManager.on('stateChanged', () => {
        broadcastStateChanged();
    });
    await audioManager.init();
    trayManager = new trayManager_1.TrayManager(audioManager);
    trayManager.init(showMainWindow);
    console.log('[Main] Audio system initialized');
}
// Prevent multiple instances of the app.
const gotTheLock = electron_1.app.requestSingleInstanceLock();
if (!gotTheLock) {
    electron_1.app.quit();
}
else {
    electron_1.app.on('second-instance', () => {
        showMainWindow();
    });
    electron_1.app.whenReady().then(async () => {
        console.log('[Main] App ready');
        setupIPCHandlers();
        await initAudioSystem();
        createWindow();
        electron_1.app.on('activate', () => {
            if (electron_1.BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });
    electron_1.app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            electron_1.app.quit();
        }
    });
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