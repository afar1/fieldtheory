// =============================================================================
// Main Entry Point - Wires together all Electron main process components.
// Handles app lifecycle, window creation, IPC handlers, and audio management.
// =============================================================================

import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { NativeHelper } from './nativeHelper';
import { AudioManager } from './audioManager';
import { TrayManager } from './trayManager';
import {
  AudioIPCChannels,
  SetPriorityModePayload,
  SetPriorityDevicePayload,
} from './types/audio';

// =============================================================================
// Global references - Keep these alive to prevent garbage collection.
// =============================================================================

let mainWindow: BrowserWindow | null = null;
let nativeHelper: NativeHelper | null = null;
let audioManager: AudioManager | null = null;
let trayManager: TrayManager | null = null;

// =============================================================================
// Window Management
// =============================================================================

/**
 * Create the main application window.
 */
function createWindow(): void {
  // Determine the preload script path.
  // In both dev and production, use the compiled .js file
  const preloadPath = path.join(__dirname, '../preload.js');

  mainWindow = new BrowserWindow({
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
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Show the main window, creating it if needed.
 */
function showMainWindow(): void {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  } else {
    createWindow();
  }
}

// =============================================================================
// IPC Handlers - Bridge between renderer and audio management.
// =============================================================================

/**
 * Set up all IPC handlers for audio-related communication.
 */
function setupIPCHandlers(): void {
  // Get current audio state.
  ipcMain.handle(AudioIPCChannels.GET_STATE, () => {
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

  // Set priority mode (lock/unlock).
  ipcMain.handle(
    AudioIPCChannels.SET_PRIORITY_MODE,
    async (_event, payload: SetPriorityModePayload) => {
      if (audioManager) {
        await audioManager.setPriorityMode(payload.enabled);
      }
    }
  );

  // Set priority device (which device to prioritize).
  ipcMain.handle(
    AudioIPCChannels.SET_PRIORITY_DEVICE,
    async (_event, payload: SetPriorityDevicePayload) => {
      if (audioManager) {
        await audioManager.setPriorityDevice(payload.deviceId);
      }
    }
  );

  // Reset user override.
  ipcMain.handle(AudioIPCChannels.RESET_OVERRIDE, async () => {
    if (audioManager) {
      await audioManager.clearUserOverride();
    }
  });
}

/**
 * Broadcast audio state changes to all renderer windows.
 */
function broadcastStateChanged(): void {
  if (!audioManager) return;

  const state = audioManager.getState();

  // Send to all windows.
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send(AudioIPCChannels.STATE_CHANGED, state);
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
async function initAudioSystem(): Promise<void> {
  console.log('[Main] Initializing audio system...');

  // Create and start the native helper (macOS only).
  nativeHelper = new NativeHelper();
  nativeHelper.start();

  // Create the audio manager with the native helper.
  audioManager = new AudioManager(nativeHelper);

  // Set up state change broadcasting to renderer.
  audioManager.on('stateChanged', () => {
    broadcastStateChanged();
  });

  // Initialize the audio manager (fetches devices, starts monitoring).
  await audioManager.init();

  // Create and initialize the tray manager.
  trayManager = new TrayManager(audioManager);
  trayManager.init(showMainWindow);

  console.log('[Main] Audio system initialized');
}

// =============================================================================
// App Lifecycle
// =============================================================================

// Prevent multiple instances of the app.
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Someone tried to run a second instance - focus our window instead.
    showMainWindow();
  });

  // App is ready - initialize everything.
  app.whenReady().then(async () => {
    console.log('[Main] App ready');

    // Set up IPC handlers before creating windows.
    setupIPCHandlers();

    // Initialize the audio system (native helper, manager, tray).
    await initAudioSystem();

    // Create the main window.
    createWindow();

    // macOS: Re-create window when clicking dock icon with no windows open.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  });

  // Quit when all windows are closed (except on macOS).
  app.on('window-all-closed', () => {
    // On macOS, keep the app running in the menu bar.
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // Clean up before quitting.
  app.on('before-quit', () => {
    console.log('[Main] App quitting, cleaning up...');

    if (trayManager) {
      trayManager.destroy();
    }

    if (nativeHelper) {
      nativeHelper.stop();
    }
  });
}
