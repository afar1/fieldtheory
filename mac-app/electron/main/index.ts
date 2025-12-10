import { app, BrowserWindow, ipcMain, clipboard, screen, Display, Notification, dialog, globalShortcut } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { NativeHelper } from './nativeHelper';
import { AudioManager } from './audioManager';
import { TrayManager } from './trayManager';
import { TranscriberManager } from './transcriberManager';
import { PreferencesManager } from './preferences';
import { ClipboardManager } from './clipboardManager';
import { ModelSize } from './modelManager';
import { ClipboardHistoryWindow } from './clipboardHistoryWindow';
import { MobileSync } from './mobileSync';
import {
  AudioIPCChannels,
  SetPriorityModePayload,
  SetPriorityDevicePayload,
} from './types/audio';
import {
  TranscribeIPCChannels,
} from './types/transcribe';
import {
  ClipboardIPCChannels,
  ClipboardQueryOptions,
  ContinuousContextState,
} from './types/clipboard';
import {
  VisionIPCChannels,
} from './types/vision';
import { ClipboardItem } from './clipboardManager';
import { VisionModelManager, VisionModelSize } from './visionModelManager';
import { VisionProcessor } from './visionProcessor';
import { engineerStack, setApiKey as setEngineerApiKey } from './promptEngineer';
import { OnboardingWindow, OnboardingStep } from './onboardingWindow';
import { OnboardingIPCChannels } from './types/onboarding';
import { TodoIPCChannels } from './types/todo';

// Load environment variables from .env.local for Supabase credentials.
// In development, the file is in the mac-app directory.
// In production, we use the bundled values or fall back to hardcoded ones.
function loadEnvVars(): { supabaseUrl?: string; supabaseAnonKey?: string } {
  // First check if already set (e.g., via Vite define or process.env)
  if (process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY) {
    return {
      supabaseUrl: process.env.VITE_SUPABASE_URL,
      supabaseAnonKey: process.env.VITE_SUPABASE_ANON_KEY,
    };
  }

  // Try to load from .env.local file
  // In development: __dirname is electron-dist/main, so ../../ goes to mac-app/
  // In production: app.getAppPath() points to the app bundle
  const envPaths = [
    path.join(__dirname, '../../.env.local'),    // Dev: electron-dist/main -> mac-app/.env.local
    path.join(process.cwd(), '.env.local'),      // Dev: current working directory
    path.join(process.cwd(), 'mac-app/.env.local'), // Dev: if running from repo root
    path.join(app.getAppPath(), '.env.local'),   // Production: inside app bundle
    path.join(app.getAppPath(), '../.env.local'), // Production: next to app bundle
  ];
  
  console.log('[Main] Looking for .env.local in:', envPaths);

  for (const envPath of envPaths) {
    try {
      if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8');
        const lines = content.split('\n');
        const env: Record<string, string> = {};
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const [key, ...valueParts] = trimmed.split('=');
            if (key && valueParts.length > 0) {
              env[key.trim()] = valueParts.join('=').trim();
            }
          }
        }
        
        if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) {
          console.log('[Main] Loaded Supabase credentials from:', envPath);
          return {
            supabaseUrl: env.VITE_SUPABASE_URL,
            supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY,
          };
        }
      }
    } catch (err) {
      // Ignore errors, try next path
    }
  }

  console.warn('[Main] Could not load Supabase credentials from .env.local');
  return {};
}

// Override userData path for experimental builds to isolate data from production.
// This must happen before app.whenReady() and before any code calls app.getPath('userData').
if (process.env.EXPERIMENTAL === 'true') {
  const experimentalUserData = path.join(
    os.homedir(),
    'Library/Application Support/Oscar Experimental'
  );
  app.setPath('userData', experimentalUserData);
  app.setName('Oscar Experimental');
}

// Configure autoUpdater for manual update flow (only in production builds).
if (!process.env.ELECTRON_START_URL) {
  autoUpdater.autoDownload = false;
  autoUpdater.setFeedURL({ provider: 'github', owner: 'afar1', repo: 'field-releases' });
}

let mainWindow: BrowserWindow | null = null;
let nativeHelper: NativeHelper | null = null;
let audioManager: AudioManager | null = null;
let trayManager: TrayManager | null = null;
let transcriberManager: TranscriberManager | null = null;
let preferencesManager: PreferencesManager | null = null;
let clipboardManager: ClipboardManager | null = null;
let clipboardHistoryWindow: ClipboardHistoryWindow | null = null;
let visionModelManager: VisionModelManager | null = null;
let visionProcessor: VisionProcessor | null = null;
let mobileSync: MobileSync | null = null;
let onboardingWindow: OnboardingWindow | null = null;

// Track pending update state so windows can query it when they open.
let pendingUpdateInfo: { status: 'available' | 'downloading' | 'ready'; version: string } | null = null;

/**
 * Create the main application window.
 */
function createWindow(): void {
  // Determine the preload script path.
  // In both dev and production, use the compiled .js file
  const preloadPath = path.join(__dirname, '../preload.js');

  // Load saved window state from preferences
  const savedState = preferencesManager?.get().windowState;
  const defaultWidth = 800;
  const defaultHeight = 600;

  mainWindow = new BrowserWindow({
    width: savedState?.width || defaultWidth,
    height: savedState?.height || defaultHeight,
    x: savedState?.x,
    y: savedState?.y,
    minWidth: 500,  // Settings panel doesn't need to be too wide
    minHeight: 400, // More compact for settings
    backgroundColor: '#f5f5f5',
    titleBarStyle: 'hiddenInset', // Modern macOS style with traffic lights in content.
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath,
      // Enable DevTools in development to debug renderer issues
      devTools: process.env.NODE_ENV !== 'production',
      // Allow loading local files (needed for file:// protocol with ES modules)
      webSecurity: true, // Keep security enabled, but ensure file:// works
    },
  });

  // Save window state on resize/move (debounced)
  let saveTimeout: NodeJS.Timeout | null = null;
  const saveWindowState = () => {
    if (saveTimeout) clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed() && preferencesManager) {
        const bounds = mainWindow.getBounds();
        preferencesManager.save({
          windowState: {
            width: bounds.width,
            height: bounds.height,
            x: bounds.x,
            y: bounds.y,
          },
        }).catch((error) => {
          console.error('[Main] Failed to save window state:', error);
        });
      }
    }, 500); // Debounce saves to avoid excessive disk writes
  };

  mainWindow.on('resized', saveWindowState);
  mainWindow.on('moved', saveWindowState);

  // Load the app - either from Vite dev server or built files.
  const startUrl = process.env.ELECTRON_START_URL;
  if (startUrl) {
    mainWindow.loadURL(startUrl);
  } else {
    // Use absolute path via app.getAppPath() to ensure correct resolution
    // regardless of working directory (important for npm start vs packaged app)
    // Use loadURL with file:// protocol to properly support ES modules
    const htmlPath = path.join(app.getAppPath(), 'dist', 'index.html');
    const fileUrl = `file://${htmlPath}`;
    console.log('[Main] Loading HTML from:', fileUrl);
    mainWindow.loadURL(fileUrl);
    
    // Add error handlers to debug loading issues
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
      console.error('[Main] Failed to load:', errorCode, errorDescription, validatedURL);
    });
    
    mainWindow.webContents.once('did-finish-load', () => {
      console.log('[Main] Window content loaded successfully');
      // Log any console messages from renderer for debugging
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
          console.log(`[Renderer ${level}]:`, message);
        });
      }
    });
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

/**
 * Handle display changes - move clipboard history window if its display is removed.
 */
function handleDisplayRemoved(_event: Electron.Event, removedDisplay: Electron.Display): void {
  if (!clipboardHistoryWindow || !clipboardHistoryWindow.isVisible()) {
    return;
  }

  if (!preferencesManager) {
    return;
  }

  const prefs = preferencesManager.get();
  const savedBounds = prefs?.clipboardHistoryBounds;
  if (!savedBounds || !savedBounds.displayId) {
    return;
  }

  // Check if the removed display matches the saved display ID.
  const removedDisplayId = ClipboardHistoryWindow.getDisplayId(removedDisplay);
  if (removedDisplayId === savedBounds.displayId) {
    console.log('[ClipboardHistoryWindow] Display removed, moving window to primary display');
    
    // Move window to primary display (absolute coordinates).
    const primaryDisplay = screen.getPrimaryDisplay();
    const primaryBounds = primaryDisplay.bounds;
    
    const newBounds = {
      x: primaryBounds.x + primaryBounds.width / 2 - savedBounds.width / 2,
      y: primaryBounds.y + 80,
      width: savedBounds.width,
      height: savedBounds.height,
    };
    
    // Update saved bounds to primary display.
    const displayConfig = ClipboardHistoryWindow.getDisplayConfigHash();
    const primaryDisplayId = ClipboardHistoryWindow.getDisplayId(primaryDisplay);
    const primaryRelative = ClipboardHistoryWindow.convertToDisplayRelative(newBounds.x, newBounds.y);
    
    preferencesManager.save({
      clipboardHistoryBounds: {
        relativeX: primaryRelative.relativeX,
        relativeY: primaryRelative.relativeY,
        width: savedBounds.width,
        height: savedBounds.height,
        displayId: primaryDisplayId,
        displayConfig,
      },
    }).catch((err) => {
      console.error('[ClipboardHistoryWindow] Failed to update bounds:', err);
    });
    
    // Reposition window immediately.
    clipboardHistoryWindow.show(newBounds);
  }
}

/**
 * Handle display metrics changes - recalculate window position if needed.
 * When a display's resolution or position changes, we need to update the window position.
 */
function handleDisplayMetricsChanged(_event: Electron.Event, _changedDisplay: Electron.Display): void {
  if (!clipboardHistoryWindow || !clipboardHistoryWindow.isVisible()) {
    return;
  }

  if (!preferencesManager) {
    return;
  }

  console.log('[ClipboardHistoryWindow] Display metrics changed, repositioning window');
  
  // Recalculate position - restoreClipboardHistoryBounds will handle finding the correct display
  // or falling back to primary if the saved display ID no longer matches
  const boundsToUse = restoreClipboardHistoryBounds();
  if (boundsToUse) {
    clipboardHistoryWindow.show(boundsToUse);
  } else {
    // If no saved bounds, window will use default position (cursor display)
    // which is already handled by show() when called without bounds
    clipboardHistoryWindow.show();
  }
}

/**
 * Set up display change event listeners.
 */
function setupDisplayListeners(): void {
  screen.on('display-removed', handleDisplayRemoved);
  screen.on('display-metrics-changed', handleDisplayMetricsChanged);
  console.log('[Main] Display change listeners registered');
}

/**
 * Restore clipboard history window bounds from saved preferences.
 * Handles both old format (absolute x, y) and new format (display-relative).
 * Returns absolute screen coordinates for use with the native vibrancy window.
 */
function restoreClipboardHistoryBounds(): { x: number; y: number; width: number; height: number } | undefined {
  if (!preferencesManager) {
    return undefined;
  }

  const prefs = preferencesManager.get();
  const savedBounds = prefs?.clipboardHistoryBounds;
  if (!savedBounds) {
    return undefined;
  }

  // Try new format first: display-relative coordinates.
  if (savedBounds.relativeX !== undefined && savedBounds.relativeY !== undefined && savedBounds.displayId) {
    const absolutePos = ClipboardHistoryWindow.convertToAbsolute(
      savedBounds.relativeX,
      savedBounds.relativeY,
      savedBounds.displayId
    );

    if (absolutePos) {
      // Return absolute screen coordinates directly.
      return {
        x: absolutePos.x,
        y: absolutePos.y,
        width: savedBounds.width,
        height: savedBounds.height,
      };
    } else {
      // Display not found - fall back to primary display centered.
      console.log('[ClipboardHistoryWindow] Saved display not found, using primary display');
      const primaryDisplay = screen.getPrimaryDisplay();
      const primaryBounds = primaryDisplay.bounds;
      return {
        x: primaryBounds.x + primaryBounds.width / 2 - savedBounds.width / 2,
        y: primaryBounds.y + 80,
        width: savedBounds.width,
        height: savedBounds.height,
      };
    }
  }

  // Fall back to old format: absolute coordinates.
  if (savedBounds.x !== undefined && savedBounds.y !== undefined) {
    const currentDisplayConfig = ClipboardHistoryWindow.getDisplayConfigHash();
    if (savedBounds.displayConfig === currentDisplayConfig) {
      return {
        x: savedBounds.x,
        y: savedBounds.y,
        width: savedBounds.width,
        height: savedBounds.height,
      };
    }
  }

  return undefined;
}

/**
 * Initialize clipboard history window with bounds change callback.
 */
function initClipboardHistoryWindow(): ClipboardHistoryWindow {
  const window = new ClipboardHistoryWindow();
  
  // Set up callback to save bounds when window is moved/resized.
  window.setOnBoundsChanged(async (bounds) => {
    if (!preferencesManager) return;
    
    const displayConfig = ClipboardHistoryWindow.getDisplayConfigHash();
    const displayRelative = ClipboardHistoryWindow.convertToDisplayRelative(bounds.x, bounds.y);
    
    await preferencesManager.save({
      clipboardHistoryBounds: {
        relativeX: displayRelative.relativeX,
        relativeY: displayRelative.relativeY,
        width: bounds.width,
        height: bounds.height,
        displayId: displayRelative.displayId,
        displayConfig,
      },
    });
  });
  
  return window;
}

/**
 * Show settings in the clipboard history window.
 * Opens the clipboard history window with the settings panel visible.
 * This is called from the tray menu "Settings..." item.
 */
function showSettingsInClipboardWindow(): void {
  if (!clipboardHistoryWindow) {
    clipboardHistoryWindow = initClipboardHistoryWindow();
  }
  
  const boundsToUse = restoreClipboardHistoryBounds();
  clipboardHistoryWindow.show(boundsToUse, true);
}

/**
 * Show clipboard history window when app becomes active.
 * Called from app 'activate' event handler.
 */
function showClipboardHistoryOnActivate(): void {
  if (!clipboardHistoryWindow) {
    clipboardHistoryWindow = initClipboardHistoryWindow();
  }
  
  if (!clipboardHistoryWindow.isVisible()) {
    const boundsToUse = restoreClipboardHistoryBounds();
    clipboardHistoryWindow.show(boundsToUse);
  }
}

/**
 * Set up all IPC handlers for audio-related communication.
 */
function setupIPCHandlers(): void {
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

  ipcMain.handle(
    AudioIPCChannels.SET_PRIORITY_MODE,
    async (_event, payload: SetPriorityModePayload) => {
      if (audioManager) {
        await audioManager.setPriorityMode(payload.enabled);
      }
    }
  );

  ipcMain.handle(
    AudioIPCChannels.SET_PRIORITY_DEVICE,
    async (_event, payload: SetPriorityDevicePayload) => {
      if (audioManager) {
        await audioManager.setPriorityDevice(payload.deviceId);
        // Save priority device to preferences
        if (preferencesManager) {
          await preferencesManager.save({ priorityDeviceId: payload.deviceId });
        }
      }
    }
  );

  ipcMain.handle(AudioIPCChannels.RESET_OVERRIDE, async () => {
    if (audioManager) {
      await audioManager.clearUserOverride();
    }
  });

  // Permission check handler
  ipcMain.handle('permissions:check', async () => {
    return await checkPermissions();
  });
}

/**
 * Set up all IPC handlers for transcription-related communication.
 */
function setupTranscribeIPCHandlers(): void {
  ipcMain.handle(TranscribeIPCChannels.GET_STATUS, () => {
    if (!transcriberManager) {
      return 'idle';
    }
    return transcriberManager.getStatus();
  });

  ipcMain.handle(TranscribeIPCChannels.GET_MODEL_STATUS, async () => {
    if (!transcriberManager) {
      return 'missing';
    }
    const modelManager = transcriberManager.getModelManager();
    const selectedModel = modelManager.getSelectedModel();
    const isAvailable = await modelManager.isModelAvailableForSize(selectedModel);
    return isAvailable ? 'downloaded' : 'missing';
  });

  ipcMain.handle(TranscribeIPCChannels.DOWNLOAD_MODEL, async (_event, modelSize?: string) => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    const modelManager = transcriberManager.getModelManager();
    
    const downloadFn = modelSize 
      ? (onProgress?: (downloaded: number, total: number) => void) => 
          modelManager.downloadModelForSize(modelSize as 'base' | 'small' | 'medium' | 'large', onProgress)
      : (onProgress?: (downloaded: number, total: number) => void) => 
          modelManager.downloadModel(onProgress);
    
    await downloadFn((downloaded, total) => {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(
            TranscribeIPCChannels.MODEL_DOWNLOAD_PROGRESS,
            downloaded,
            total
          );
        }
      });
    });
  });

  ipcMain.handle(TranscribeIPCChannels.DELETE_MODEL, async (_event, modelSize: string) => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    const modelManager = transcriberManager.getModelManager();
    const validSizes: ModelSize[] = ['base', 'small', 'medium', 'large'];
    if (!validSizes.includes(modelSize as ModelSize)) {
      throw new Error(`Invalid model size: ${modelSize}`);
    }
    return await modelManager.deleteModelForSize(modelSize as ModelSize);
  });

  ipcMain.handle(TranscribeIPCChannels.GET_AVAILABLE_MODELS, () => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    const modelManager = transcriberManager.getModelManager();
    return modelManager.getAvailableModels();
  });

  ipcMain.handle(TranscribeIPCChannels.GET_MODEL_DOWNLOAD_STATUS, async () => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    const modelManager = transcriberManager.getModelManager();
    return modelManager.getDownloadStatus();
  });

  ipcMain.handle(TranscribeIPCChannels.GET_SELECTED_MODEL, () => {
    if (!transcriberManager) {
      return 'base';
    }
    return transcriberManager.getSelectedModel();
  });

  ipcMain.handle(TranscribeIPCChannels.SET_SELECTED_MODEL, async (_event, modelSize: string) => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    const validSizes: ModelSize[] = ['base', 'small', 'medium', 'large'];
    if (!validSizes.includes(modelSize as ModelSize)) {
      throw new Error(`Invalid model size: ${modelSize}`);
    }
    await transcriberManager.setSelectedModel(modelSize as ModelSize);
  });

  ipcMain.handle(TranscribeIPCChannels.GET_HOTKEY, () => {
    if (!transcriberManager) {
      return 'Alt+Space';
    }
    return transcriberManager.getHotkey();
  });

  ipcMain.handle(TranscribeIPCChannels.SET_HOTKEY, async (_event, hotkey: string) => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    const success = await transcriberManager.setHotkey(hotkey);
    return success;
  });

  ipcMain.handle(TranscribeIPCChannels.GET_OVERLAY_STYLE, () => {
    if (!transcriberManager) {
      return 'rectangle';
    }
    return transcriberManager.getOverlayStyle();
  });

  ipcMain.handle(TranscribeIPCChannels.SET_OVERLAY_STYLE, async (_event, style: string) => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    await transcriberManager.setOverlayStyle(style as 'rectangle' | 'top-emerging');
  });

  ipcMain.handle('transcribe:getStackCount', () => {
    if (!transcriberManager) {
      return 0;
    }
    return transcriberManager.getCurrentStack().length;
  });

  ipcMain.handle('transcribe:getStackingMode', () => {
    if (!transcriberManager) {
      return { active: false, stackId: null, targetApp: null };
    }
    return transcriberManager.getStackingMode();
  });
}

/**
 * Set up all IPC handlers for vision model-related communication.
 */
function setupVisionIPCHandlers(): void {
  ipcMain.handle(VisionIPCChannels.GET_MODEL_STATUS, async () => {
    if (!visionModelManager) {
      return 'missing';
    }
    const selectedModel = visionModelManager.getSelectedModel();
    const isAvailable = await visionModelManager.isModelAvailableForSize(selectedModel);
    return isAvailable ? 'downloaded' : 'missing';
  });

  ipcMain.handle(VisionIPCChannels.DOWNLOAD_MODEL, async (_event, modelSize?: string) => {
    if (!visionModelManager) {
      throw new Error('VisionModelManager not initialized');
    }
    
    const downloadFn = modelSize 
      ? (onProgress?: (downloaded: number, total: number) => void) => 
          visionModelManager!.downloadModelForSize(modelSize as VisionModelSize, onProgress)
      : (onProgress?: (downloaded: number, total: number) => void) => 
          visionModelManager!.downloadModel(onProgress);
    
    await downloadFn((downloaded, total) => {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(
            VisionIPCChannels.MODEL_DOWNLOAD_PROGRESS,
            downloaded,
            total
          );
        }
      });
    });
  });

  ipcMain.handle(VisionIPCChannels.DELETE_MODEL, async (_event, modelSize: string) => {
    if (!visionModelManager) {
      throw new Error('VisionModelManager not initialized');
    }
    const validSizes: VisionModelSize[] = ['nano'];
    if (!validSizes.includes(modelSize as VisionModelSize)) {
      throw new Error(`Invalid model size: ${modelSize}`);
    }
    return await visionModelManager.deleteModelForSize(modelSize as VisionModelSize);
  });

  ipcMain.handle(VisionIPCChannels.GET_AVAILABLE_MODELS, () => {
    if (!visionModelManager) {
      throw new Error('VisionModelManager not initialized');
    }
    return visionModelManager.getAvailableModels();
  });

  ipcMain.handle(VisionIPCChannels.GET_MODEL_DOWNLOAD_STATUS, async () => {
    if (!visionModelManager) {
      throw new Error('VisionModelManager not initialized');
    }
    return visionModelManager.getDownloadStatus();
  });

  ipcMain.handle(VisionIPCChannels.GET_SELECTED_MODEL, () => {
    if (!visionModelManager) {
      return 'nano';
    }
    return visionModelManager.getSelectedModel();
  });

  ipcMain.handle(VisionIPCChannels.SET_SELECTED_MODEL, async (_event, modelSize: string) => {
    if (!visionModelManager) {
      throw new Error('VisionModelManager not initialized');
    }
    const validSizes: VisionModelSize[] = ['nano'];
    if (!validSizes.includes(modelSize as VisionModelSize)) {
      throw new Error(`Invalid model size: ${modelSize}`);
    }
    visionModelManager.setSelectedModel(modelSize as VisionModelSize);
  });
}

/**
 * Set up all IPC handlers for clipboard-related communication.
 */
function setupClipboardIPCHandlers(): void {
  ipcMain.handle(ClipboardIPCChannels.QUERY_ITEMS, async (_event, options?: ClipboardQueryOptions) => {
    if (!clipboardManager) {
      return [];
    }
    const items = clipboardManager.queryItems(options);
    // Convert Buffer to base64 for IPC
    return items.map(item => ({
      ...item,
      imageData: item.imageData ? item.imageData.toString('base64') : null,
    }));
  });

  ipcMain.handle(ClipboardIPCChannels.GET_ITEM, async (_event, id: number) => {
    if (!clipboardManager) {
      return null;
    }
    const item = clipboardManager.getItem(id);
    if (!item) {
      return null;
    }
    return {
      ...item,
      imageData: item.imageData ? item.imageData.toString('base64') : null,
    };
  });

  ipcMain.handle(ClipboardIPCChannels.DELETE_ITEM, async (_event, id: number) => {
    if (clipboardManager) {
      clipboardManager.deleteItem(id);
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(ClipboardIPCChannels.ITEM_DELETED, id);
        }
      });
    }
  });

  ipcMain.handle(ClipboardIPCChannels.RESTORE_ITEM, async (_event, item: any) => {
    if (clipboardManager) {
      const id = await clipboardManager.restoreItem(item);
      // Notify listeners of restored item
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
        }
      });
      return id;
    }
    return -1;
  });

  ipcMain.handle(ClipboardIPCChannels.CLEAR_ALL, async () => {
    if (clipboardManager) {
      clipboardManager.clearAll();
    }
  });

  ipcMain.handle(ClipboardIPCChannels.CAPTURE_SCREENSHOT, async (_event, region?: boolean) => {
    if (!clipboardManager) {
      return -1;
    }
    const id = await clipboardManager.captureScreenshot(region || false);
    if (id > 0) {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
        }
      });
    }
    return id;
  });

  ipcMain.handle(ClipboardIPCChannels.GET_HOTKEYS, async () => {
    if (!clipboardManager) {
      return {
        screenshot: 'Alt+1',
        history: 'Control+Alt+Space',
      };
    }
    return clipboardManager.getHotkeys();
  });

  ipcMain.handle(ClipboardIPCChannels.SET_HOTKEYS, async (_event, hotkeys: { screenshot?: string; history?: string }) => {
    if (!clipboardManager || !preferencesManager) {
      return false;
    }
    
    let success = true;
    const prefsToSave: { clipboardScreenshotHotkey?: string; clipboardHistoryHotkey?: string } = {};
    
    if (hotkeys.screenshot !== undefined) {
      if (typeof hotkeys.screenshot !== 'string' || hotkeys.screenshot.trim() === '') {
        return false;
      }
      const result = clipboardManager.setScreenshotHotkey(hotkeys.screenshot);
      if (!result) {
        success = false;
      } else {
        prefsToSave.clipboardScreenshotHotkey = hotkeys.screenshot;
      }
    }
    
    if (hotkeys.history !== undefined) {
      if (typeof hotkeys.history !== 'string' || hotkeys.history.trim() === '') {
        return false;
      }
      const result = clipboardManager.setHistoryHotkey(hotkeys.history);
      if (!result) {
        success = false;
      } else {
        prefsToSave.clipboardHistoryHotkey = hotkeys.history;
      }
    }
    
    // Save hotkeys to preferences
    if (Object.keys(prefsToSave).length > 0) {
      await preferencesManager.save(prefsToSave);
    }
    
    return success;
  });

  ipcMain.handle(ClipboardIPCChannels.PASTE_ITEM, async (_event, id: number, targetBundleId?: string) => {
    try {
      if (!clipboardManager) {
        console.error('[Main] pasteItem: clipboardManager not initialized');
        return;
      }
      const item = clipboardManager.getItem(id);
      if (!item) {
        console.error('[Main] pasteItem: item not found', id);
        return;
      }
      
      // Put content on clipboard first.
      if (item.type === 'text' || item.type === 'transcript') {
        clipboard.writeText(item.content || '');
      } else if (item.imageData) {
        const { nativeImage } = require('electron');
        // item.imageData is already a base64 string from IPC serialization
        const imageBuffer = typeof item.imageData === 'string' 
          ? Buffer.from(item.imageData, 'base64')
          : item.imageData;
        const image = nativeImage.createFromBuffer(imageBuffer);
        clipboard.writeImage(image);
      }
      
      // Hide window first.
      if (clipboardHistoryWindow) {
        clipboardHistoryWindow.hide(); // This includes app.hide() to restore focus
      }
      
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      // If a specific target app was provided, activate it and paste there.
      // Otherwise, use the default behavior (paste to previous app).
      if (targetBundleId && clipboardHistoryWindow) {
        await clipboardHistoryWindow.pasteToApp(targetBundleId);
      } else {
        // Default behavior: paste to previous app (focus restored by hide()).
        await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
      }
    } catch (error) {
      console.error('[Main] pasteItem error:', error);
    }
  });

  ipcMain.handle(ClipboardIPCChannels.PASTE_STACK, async (_event, ids: number[]) => {
    try {
      if (!clipboardManager) {
        console.error('[Main] pasteStack: clipboardManager not initialized');
        return;
      }
      if (!ids || ids.length === 0) {
        console.error('[Main] pasteStack: no item IDs provided');
        return;
      }
      
      // Get all items from IDs
      const items = ids
        .map(id => clipboardManager!.getItem(id))
        .filter((item): item is ClipboardItem => item !== null);
      
      if (items.length === 0) {
        console.error('[Main] pasteStack: no valid items found');
        return;
      }
      
      // Hide window and restore focus BEFORE pasting
      if (clipboardHistoryWindow) {
        clipboardHistoryWindow.hide();
      }
      
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      const { nativeImage } = require('electron');
      
      // Paste each item sequentially with small delays
      for (const item of items) {
        try {
          if (item.type === 'text' || item.type === 'transcript') {
            clipboard.writeText(item.content || '');
            await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
          } else if (item.imageData) {
            const imageBuffer = typeof item.imageData === 'string' 
              ? Buffer.from(item.imageData, 'base64')
              : item.imageData;
            const image = nativeImage.createFromBuffer(imageBuffer);
            clipboard.writeImage(image);
            await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
          }
          // Small delay between pastes to let the target app process
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (itemError) {
          console.error('[Main] pasteStack: failed to paste item', item.id, itemError);
          // Continue with next item even if this one fails
        }
      }
    } catch (error) {
      console.error('[Main] pasteStack error:', error);
    }
  });

  // Paste arbitrary text (used for pasting improved prompts)
  ipcMain.handle(ClipboardIPCChannels.PASTE_TEXT, async (_event, text: string, targetBundleId?: string) => {
    try {
      if (!text) {
        console.error('[Main] pasteText: no text provided');
        return;
      }
      
      // Put text on clipboard first
      clipboard.writeText(text);
      
      // Hide window first
      if (clipboardHistoryWindow) {
        clipboardHistoryWindow.hide();
      }
      
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      // If a specific target app was provided, activate it and paste there
      if (targetBundleId && clipboardHistoryWindow) {
        await clipboardHistoryWindow.pasteToApp(targetBundleId);
      } else {
        // Default behavior: paste to previous app
        await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
      }
    } catch (error) {
      console.error('[Main] pasteText error:', error);
    }
  });

  ipcMain.handle(ClipboardIPCChannels.SEPARATE_INTO_TASKS, async (_event, id: number) => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    await transcriberManager.separateIntoTasks(id);
  });

  // Save bounds handler - now receives absolute screen coordinates directly.
  // Called when window is hidden or on explicit save request.
  ipcMain.handle(ClipboardIPCChannels.SAVE_BOUNDS, async (_event, bounds: { x: number; y: number; width: number; height: number }) => {
    if (!preferencesManager) {
      return;
    }
    
    const displayConfig = ClipboardHistoryWindow.getDisplayConfigHash();
    
    // Convert absolute coords to display-relative for persistence.
    const displayRelative = ClipboardHistoryWindow.convertToDisplayRelative(bounds.x, bounds.y);
    
    await preferencesManager.save({
      clipboardHistoryBounds: {
        relativeX: displayRelative.relativeX,
        relativeY: displayRelative.relativeY,
        width: bounds.width,
        height: bounds.height,
        displayId: displayRelative.displayId,
        displayConfig,
      },
    });
  });

  // Target app management handlers.
  ipcMain.handle(ClipboardIPCChannels.GET_TARGET_APP, async () => {
    if (!clipboardHistoryWindow) {
      return null;
    }
    return clipboardHistoryWindow.getTargetApp();
  });

  ipcMain.handle(ClipboardIPCChannels.SET_TARGET_APP, async (_event, app: { bundleId: string; name: string } | null) => {
    if (!clipboardHistoryWindow) {
      return;
    }
    clipboardHistoryWindow.setTargetApp(app);
  });

  ipcMain.handle(ClipboardIPCChannels.GET_RUNNING_APPS, async () => {
    if (!clipboardHistoryWindow) {
      return [];
    }
    // Return cached apps (already fetched when window was shown).
    return clipboardHistoryWindow.getCachedRunningApps();
  });

  ipcMain.handle(ClipboardIPCChannels.PASTE_TO_APP, async (_event, bundleId: string) => {
    if (!clipboardHistoryWindow) {
      return false;
    }
    
    // Hide our window first.
    clipboardHistoryWindow.hide();
    
    // Paste to the target app.
    return clipboardHistoryWindow.pasteToApp(bundleId);
  });

  ipcMain.on('clipboard:closeWindow', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && !window.isDestroyed()) {
      window.hide();
    }
  });

  // Stack operations for prompt stacking feature
  ipcMain.handle(ClipboardIPCChannels.QUERY_ITEMS_BY_STACK, async (_event, stackId: string) => {
    if (!clipboardManager) {
      return [];
    }
    const items = clipboardManager.queryItemsByStackId(stackId);
    return items.map(item => ({
      ...item,
      imageData: item.imageData ? item.imageData.toString('base64') : null,
    }));
  });

  ipcMain.handle(ClipboardIPCChannels.GET_UNIQUE_STACKS, async () => {
    if (!clipboardManager) {
      return [];
    }
    return clipboardManager.getUniqueStacks();
  });

  // All-time stats for footer display
  ipcMain.handle(ClipboardIPCChannels.GET_ALL_TIME_STATS, async () => {
    if (!clipboardManager || !preferencesManager) {
      return { stacks: 0, transcriptions: 0, screenshots: 0, improved: 0, words: 0 };
    }
    const dbStats = clipboardManager.getAllTimeStats();
    const improved = preferencesManager.getPreference('improvedPromptsCount') ?? 0;
    return { ...dbStats, improved };
  });

  ipcMain.handle(ClipboardIPCChannels.INCREMENT_IMPROVED_COUNT, async () => {
    if (!preferencesManager) {
      return 0;
    }
    const current = preferencesManager.getPreference('improvedPromptsCount') ?? 0;
    const newCount = current + 1;
    await preferencesManager.save({ improvedPromptsCount: newCount });
    return newCount;
  });

  ipcMain.handle(ClipboardIPCChannels.UPDATE_STACK_ID, async (_event, itemIds: number[], stackId: string | null) => {
    try {
      if (!clipboardManager) {
        console.error('[Main] updateStackId: clipboardManager not initialized');
        return;
      }
      clipboardManager.updateStackId(itemIds, stackId);
    } catch (error) {
      console.error('[Main] updateStackId error:', error);
    }
  });

  // Track temp files for cleanup
  const dragTempFiles: string[] = [];

  ipcMain.handle(ClipboardIPCChannels.START_DRAG, async (event, stackId: string) => {
    try {
      if (!clipboardManager) {
        console.error('[Main] startDrag: clipboardManager not initialized');
        return;
      }

      const items = clipboardManager.queryItemsByStackId(stackId);
      if (items.length === 0) {
        console.error('[Main] startDrag: no items found for stack', stackId);
        return;
      }

      const fs = await import('fs');
      const tempFiles: string[] = [];

      // Collect text content and write images to temp files
      let combinedText = '';
      for (const item of items) {
        if (item.imageData) {
          try {
            const tempPath = path.join(app.getPath('temp'), `drag-${item.id}-${Date.now()}.png`);
            fs.writeFileSync(tempPath, item.imageData);
            tempFiles.push(tempPath);
            dragTempFiles.push(tempPath); // Track for cleanup
          } catch (writeError) {
            console.error('[Main] startDrag: failed to write temp image', item.id, writeError);
          }
        }
        if (item.content) {
          combinedText += (combinedText ? '\n\n' : '') + item.content;
        }
      }

      // If no images but we have text, create a temp text file
      if (tempFiles.length === 0 && combinedText) {
        try {
          const textTempPath = path.join(app.getPath('temp'), `drag-text-${Date.now()}.txt`);
          fs.writeFileSync(textTempPath, combinedText);
          tempFiles.push(textTempPath);
          dragTempFiles.push(textTempPath);
        } catch (writeError) {
          console.error('[Main] startDrag: failed to write temp text file', writeError);
        }
      }

      // If we have files to drag, initiate native drag
      if (tempFiles.length > 0) {
        event.sender.startDrag({
          file: tempFiles[0], // Primary file (required by Electron API)
          files: tempFiles,   // All files for multi-file drag
          icon: tempFiles[0], // Use first image as icon
        });
      } else {
        console.warn('[Main] startDrag: no files to drag for stack', stackId);
      }
    } catch (error) {
      console.error('[Main] startDrag error:', error);
    }
  });

  // Engineer feature - refine prompts using AI.
  // Takes a stack of content and returns a well-structured prompt.
  ipcMain.handle(ClipboardIPCChannels.ENGINEER_STACK, async (_event, stackId: string) => {
    try {
      if (!clipboardManager) {
        return { success: false, error: 'Clipboard manager not initialized' };
      }

      // Set API key from preferences if available (securely stored via safeStorage).
      const apiKey = preferencesManager?.getApiKey();
      if (apiKey) {
        setEngineerApiKey(apiKey);
      }

      // Get all items in the stack
      const items = clipboardManager.queryItemsByStackId(stackId);
      if (items.length === 0) {
        return { success: false, error: 'No items found in stack' };
      }

      // Transform to the format expected by engineerStack
      const stackItems = items.map(item => ({
        content: item.content,
        type: item.type,
        imageWidth: item.imageWidth ?? undefined,
        imageHeight: item.imageHeight ?? undefined,
      }));

      const result = await engineerStack(stackItems);
      return result;
    } catch (error) {
      console.error('[Main] engineerStack error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  });

  // =========================================================================
  // API Key Management - Securely stored via OS keychain (safeStorage)
  // =========================================================================

  // Check if API key is set (without exposing the key itself).
  ipcMain.handle(ClipboardIPCChannels.GET_API_KEY_STATUS, async () => {
    return {
      hasKey: preferencesManager?.hasApiKey() ?? false,
    };
  });

  // Set API key securely.
  ipcMain.handle(ClipboardIPCChannels.SET_API_KEY, async (_event, apiKey: string) => {
    try {
      if (!preferencesManager) {
        return { success: false, error: 'Preferences not initialized' };
      }
      await preferencesManager.setApiKey(apiKey);
      
      // Update the engineer service with the new key
      setEngineerApiKey(apiKey);
      
      return { success: true };
    } catch (error) {
      console.error('[Main] setApiKey error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save API key',
      };
    }
  });

  // Clear the stored API key.
  ipcMain.handle(ClipboardIPCChannels.CLEAR_API_KEY, async () => {
    try {
      if (!preferencesManager) {
        return { success: false, error: 'Preferences not initialized' };
      }
      await preferencesManager.clearApiKey();
      return { success: true };
    } catch (error) {
      console.error('[Main] clearApiKey error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clear API key',
      };
    }
  });

  // Clean up temp files on app quit
  app.on('will-quit', () => {
    const fs = require('fs');
    for (const tempFile of dragTempFiles) {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      } catch (cleanupError) {
        // Ignore cleanup errors - files will be cleaned by OS eventually
      }
    }
  });

  // =========================================================================
  // Mobile Sync IPC Handlers - Sync iOS transcriptions to clipboard history
  // =========================================================================

  ipcMain.handle(ClipboardIPCChannels.SET_SYNC_SESSION, async (_event, accessToken: string, refreshToken: string) => {
    if (!mobileSync) {
      console.warn('[Main] setSyncSession: mobileSync not initialized');
      return false;
    }
    await mobileSync.setSession(accessToken, refreshToken);
    return true;
  });

  ipcMain.handle(ClipboardIPCChannels.CLEAR_SYNC_SESSION, async () => {
    if (mobileSync) {
      mobileSync.clearSession();
    }
    return true;
  });

  ipcMain.handle(ClipboardIPCChannels.SYNC_MOBILE_TRANSCRIPTS, async () => {
    if (!mobileSync) {
      return 0;
    }
    return await mobileSync.syncTranscripts();
  });

  // Force full re-sync - clears cache and re-syncs all transcripts.
  // This fixes source attribution for items that were synced before the fix.
  ipcMain.handle(ClipboardIPCChannels.FORCE_SYNC_ALL, async () => {
    if (!mobileSync) {
      return 0;
    }
    return await mobileSync.forceSyncAll();
  });

  ipcMain.handle(ClipboardIPCChannels.GET_SYNC_ENABLED, async () => {
    if (!mobileSync) {
      return false;
    }
    return mobileSync.isSyncEnabled();
  });

  ipcMain.handle(ClipboardIPCChannels.SET_SYNC_ENABLED, async (_event, enabled: boolean) => {
    if (!mobileSync) {
      return false;
    }
    mobileSync.setSyncEnabled(enabled);
    return true;
  });

  // =========================================================================
  // Password Authentication IPC Handlers
  // =========================================================================

  ipcMain.handle('auth:signInWithPassword', async (_event, email: string, password: string) => {
    if (!mobileSync) {
      return { error: 'Mobile sync not initialized', session: null };
    }
    return await mobileSync.signInWithPassword(email, password);
  });

  ipcMain.handle('auth:resetPasswordForEmail', async (_event, email: string) => {
    if (!mobileSync) {
      return { error: 'Mobile sync not initialized' };
    }
    return await mobileSync.resetPasswordForEmail(email);
  });

  ipcMain.handle('auth:updatePassword', async (_event, newPassword: string) => {
    if (!mobileSync) {
      return { error: 'Mobile sync not initialized' };
    }
    return await mobileSync.updatePassword(newPassword);
  });

  ipcMain.handle('auth:setSessionFromUrl', async (_event, accessToken: string, refreshToken: string) => {
    if (!mobileSync) {
      return { error: 'Mobile sync not initialized', session: null };
    }
    return await mobileSync.setSessionFromUrl(accessToken, refreshToken);
  });

  ipcMain.handle('auth:signOut', async () => {
    if (!mobileSync) {
      return { error: 'Mobile sync not initialized' };
    }
    return await mobileSync.signOut();
  });

  ipcMain.handle('auth:getSession', async () => {
    if (!mobileSync) {
      return null;
    }
    return mobileSync.getSession();
  });

  // =========================================================================
  // Todo IPC Handlers - Bidirectional sync with Supabase
  // =========================================================================

  ipcMain.handle('todo:isAuthenticated', async () => {
    if (!mobileSync) {
      return false;
    }
    return mobileSync.isAuthenticated();
  });

  ipcMain.handle(TodoIPCChannels.GET_TODOS, async () => {
    if (!mobileSync) {
      return [];
    }
    return mobileSync.getTodos();
  });

  ipcMain.handle(TodoIPCChannels.SYNC_TODOS, async () => {
    if (!mobileSync) {
      return [];
    }
    return await mobileSync.syncTodos();
  });

  ipcMain.handle(TodoIPCChannels.CREATE_TODO, async (_event, text: string) => {
    if (!mobileSync) {
      return null;
    }
    return await mobileSync.createTodo(text);
  });

  ipcMain.handle(TodoIPCChannels.UPDATE_TODO, async (_event, id: string, text: string) => {
    if (!mobileSync) {
      return null;
    }
    return await mobileSync.updateTodo(id, text);
  });

  ipcMain.handle(TodoIPCChannels.TOGGLE_TODO, async (_event, id: string) => {
    if (!mobileSync) {
      return null;
    }
    return await mobileSync.toggleTodo(id);
  });

  ipcMain.handle(TodoIPCChannels.DELETE_TODO, async (_event, id: string) => {
    if (!mobileSync) {
      return false;
    }
    return await mobileSync.deleteTodo(id);
  });

  ipcMain.handle(TodoIPCChannels.DELETE_TODOS, async (_event, ids: string[]) => {
    if (!mobileSync) {
      return false;
    }
    return await mobileSync.deleteTodos(ids);
  });

  ipcMain.handle(TodoIPCChannels.COMPLETE_TODOS, async (_event, ids: string[]) => {
    if (!mobileSync) {
      return false;
    }
    return await mobileSync.completeTodos(ids);
  });

  // Todo hotkey management - stored in preferences.
  ipcMain.handle(TodoIPCChannels.GET_TODO_HOTKEY, async () => {
    if (!preferencesManager) {
      return 'Command+Shift+T';
    }
    const prefs = await preferencesManager.load();
    return prefs.todoHotkey || 'Command+Shift+T';
  });

  ipcMain.handle(TodoIPCChannels.SET_TODO_HOTKEY, async (_event, hotkey: string) => {
    if (!preferencesManager || !clipboardManager) {
      return false;
    }
    
    // Unregister old hotkey and register new one.
    const prefs = await preferencesManager.load();
    const oldHotkey = prefs.todoHotkey || 'Command+Shift+T';
    
    try {
      globalShortcut.unregister(oldHotkey);
    } catch {
      // Ignore if old hotkey wasn't registered.
    }
    
    try {
      const success = globalShortcut.register(hotkey, () => {
        // Show clipboard history window in todo view mode.
        if (clipboardHistoryWindow) {
          clipboardHistoryWindow.show();
          // Send event to switch to todo view.
          clipboardHistoryWindow.getWindow()?.webContents.send(TodoIPCChannels.SHOW_TODOS);
        }
      });
      
      if (success) {
        await preferencesManager.save({ todoHotkey: hotkey });
        return true;
      }
      return false;
    } catch (err) {
      console.error('[Main] Failed to register todo hotkey:', err);
      return false;
    }
  });

  // =========================================================================
  // Continuous Context Mode IPC Handlers
  // =========================================================================

  ipcMain.handle(ClipboardIPCChannels.GET_CONTINUOUS_CONTEXT_STATE, async () => {
    if (!clipboardManager) {
      return { active: false, stackId: null, screenshotCount: 0 };
    }
    return clipboardManager.getContinuousContextState();
  });

  ipcMain.handle(ClipboardIPCChannels.GET_CONTINUOUS_CONTEXT_ENABLED, async () => {
    if (!clipboardManager) {
      return false;
    }
    return clipboardManager.isContinuousContextEnabled();
  });

  ipcMain.handle(ClipboardIPCChannels.SET_CONTINUOUS_CONTEXT_ENABLED, async (_event, enabled: boolean) => {
    if (!clipboardManager || !preferencesManager) {
      return false;
    }
    clipboardManager.setContinuousContextEnabled(enabled);
    await preferencesManager.save({ continuousContextEnabled: enabled });
    
    // Register/unregister the hotkey callback when enabling/disabling
    if (enabled) {
      clipboardManager.registerContinuousContextHotkey(async () => {
        if (!clipboardManager) return;
        
        const state = clipboardManager.getContinuousContextState();
        if (state.active) {
          // If already active, stop it
          clipboardManager.stopContinuousContext();
        } else {
          // Start continuous context mode
          await clipboardManager.startContinuousContext();
        }
      });
    }
    
    return true;
  });

  ipcMain.handle(ClipboardIPCChannels.GET_CONTINUOUS_CONTEXT_HOTKEY, async () => {
    if (!clipboardManager) {
      return 'Shift+Alt+1';
    }
    return clipboardManager.getContinuousContextHotkey();
  });

  ipcMain.handle(ClipboardIPCChannels.SET_CONTINUOUS_CONTEXT_HOTKEY, async (_event, hotkey: string) => {
    if (!clipboardManager || !preferencesManager) {
      return false;
    }
    const success = clipboardManager.setContinuousContextHotkey(hotkey);
    if (success) {
      await preferencesManager.save({ continuousContextHotkey: hotkey });
      
      // Re-register the hotkey with the callback if continuous context is enabled
      if (clipboardManager.isContinuousContextEnabled()) {
        clipboardManager.registerContinuousContextHotkey(async () => {
          if (!clipboardManager) return;
          
          const state = clipboardManager.getContinuousContextState();
          if (state.active) {
            // If already active, stop it
            clipboardManager.stopContinuousContext();
          } else {
            // Start continuous context mode
            await clipboardManager.startContinuousContext();
          }
        });
      }
    }
    return success;
  });

  ipcMain.handle(ClipboardIPCChannels.START_CONTINUOUS_CONTEXT, async () => {
    if (!clipboardManager) {
      return;
    }
    await clipboardManager.startContinuousContext();
  });

  ipcMain.handle(ClipboardIPCChannels.STOP_CONTINUOUS_CONTEXT, async () => {
    if (!clipboardManager) {
      return;
    }
    clipboardManager.stopContinuousContext();
  });
}


/**
 * Set up IPC handlers for onboarding wizard.
 */
function setupOnboardingIPCHandlers(): void {
  // Get current permission status for all required permissions.
  ipcMain.handle(OnboardingIPCChannels.GET_PERMISSION_STATUS, async () => {
    if (!onboardingWindow) {
      onboardingWindow = new OnboardingWindow();
    }
    return await onboardingWindow.getPermissionStatus();
  });

  // Request microphone permission - shows system dialog if not determined.
  ipcMain.handle(OnboardingIPCChannels.REQUEST_MICROPHONE, async () => {
    if (!onboardingWindow) {
      onboardingWindow = new OnboardingWindow();
    }
    return await onboardingWindow.requestMicrophonePermission();
  });

  // Open System Settings to Accessibility pane.
  ipcMain.handle(OnboardingIPCChannels.OPEN_ACCESSIBILITY_SETTINGS, async () => {
    if (!onboardingWindow) {
      onboardingWindow = new OnboardingWindow();
    }
    onboardingWindow.openAccessibilitySettings();
    return true;
  });

  // Get current onboarding state (complete, step, permissions, model).
  ipcMain.handle(OnboardingIPCChannels.GET_ONBOARDING_STATE, async () => {
    const prefs = preferencesManager?.get();
    const permissions = onboardingWindow 
      ? await onboardingWindow.getPermissionStatus()
      : { microphone: 'not-determined' as const, accessibility: false };
    
    // Check if default model is downloaded.
    const modelDownloaded = transcriberManager?.getModelManager()
      ? await transcriberManager.getModelManager().isModelAvailable()
      : false;
    
    return {
      isComplete: prefs?.onboardingComplete ?? false,
      currentStep: prefs?.onboardingStep ?? 0,
      permissions,
      modelDownloaded,
    };
  });

  // Update current onboarding step (for resume capability).
  ipcMain.handle(OnboardingIPCChannels.SET_ONBOARDING_STEP, async (_event, step: number) => {
    if (!preferencesManager) return false;
    await preferencesManager.save({ onboardingStep: step });
    return true;
  });

  // Mark onboarding as complete.
  ipcMain.handle(OnboardingIPCChannels.COMPLETE_ONBOARDING, async () => {
    if (!preferencesManager) return false;
    await preferencesManager.save({ onboardingComplete: true });
    
    // Close onboarding window and show clipboard history.
    if (onboardingWindow) {
      onboardingWindow.close();
    }
    showClipboardHistoryOnActivate();
    return true;
  });

  // Skip onboarding (set up later).
  ipcMain.handle(OnboardingIPCChannels.SKIP_ONBOARDING, async () => {
    if (!preferencesManager) return false;
    await preferencesManager.save({ onboardingComplete: true });
    
    // Close onboarding window.
    if (onboardingWindow) {
      onboardingWindow.close();
    }
    return true;
  });

  // Check if model is downloaded (for model download step).
  ipcMain.handle(OnboardingIPCChannels.CHECK_MODEL_STATUS, async () => {
    if (!transcriberManager?.getModelManager()) {
      return { downloaded: false, size: 0 };
    }
    const isAvailable = await transcriberManager.getModelManager().isModelAvailable();
    return { downloaded: isAvailable };
  });

  // Reset onboarding state - clears completion flag and shows onboarding window again.
  // Useful for testing and development.
  ipcMain.handle(OnboardingIPCChannels.RESET_ONBOARDING, async () => {
    if (!preferencesManager) return false;
    
    // Clear onboarding state.
    await preferencesManager.save({ 
      onboardingComplete: false,
      onboardingStep: undefined,
    });
    
    // Close any existing onboarding window.
    if (onboardingWindow) {
      onboardingWindow.close();
      onboardingWindow = null;
    }
    
    // Show onboarding window from the beginning.
    onboardingWindow = new OnboardingWindow();
    onboardingWindow.show(OnboardingStep.WELCOME);
    
    console.log('[Main] Onboarding reset - showing wizard from start');
    return true;
  });
}


/**
 * Check permissions and return status.
 */
async function checkPermissions(): Promise<{ accessibilityGranted: boolean; inputMonitoringGranted: boolean }> {
  if (!nativeHelper) {
    return { accessibilityGranted: false, inputMonitoringGranted: false };
  }
  try {
    return await nativeHelper.checkPermissions();
  } catch (error) {
    console.error('[Main] Failed to check permissions:', error);
    return { accessibilityGranted: false, inputMonitoringGranted: false };
  }
}

/**
 * Broadcast transcription events to all renderer windows.
 */
function broadcastTranscribeEvents(): void {
  if (!transcriberManager) return;

  transcriberManager.on('statusChanged', (status) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(TranscribeIPCChannels.STATUS_CHANGED, status);
      }
    });
    
    // Update clipboard history window's recording state
    // This ensures blur event doesn't hide the app when recording is active
    clipboardHistoryWindow?.setRecordingActive(status === 'recording');
  });

  transcriberManager.on('result', (text) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(TranscribeIPCChannels.RESULT, text);
      }
    });
  });

  transcriberManager.on('error', (error) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(TranscribeIPCChannels.ERROR, error.message);
      }
    });
  });

  transcriberManager.on('hotkeyChanged', (hotkey) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(TranscribeIPCChannels.HOTKEY_CHANGED, hotkey);
      }
    });
  });

  transcriberManager.on('stackChanged', (count) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('transcribe:stackChanged', count);
      }
    });
  });

  transcriberManager.on('stackingModeChanged', (active: boolean, stackId: string | null) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('transcribe:stackingModeChanged', active, stackId);
      }
    });
  });
}

/**
 * Broadcast audio state changes to all renderer windows.
 */
function broadcastStateChanged(): void {
  if (!audioManager) return;

  const state = audioManager.getState();

  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed()) {
      window.webContents.send(AudioIPCChannels.STATE_CHANGED, state);
    }
  });
}

/**
 * Initialize the audio management system.
 * This sets up the native helper, audio manager, and tray integration.
 */
async function initAudioSystem(checkForUpdatesCallback?: () => void): Promise<void> {
  console.log('[Main] Initializing audio system...');

  // Initialize preferences manager first to load saved priority device
  if (!preferencesManager) {
    preferencesManager = new PreferencesManager();
    await preferencesManager.load();
  }

  nativeHelper = new NativeHelper();
  nativeHelper.start();

  audioManager = new AudioManager(nativeHelper);
  
  // Load saved priority device from preferences
  const prefs = preferencesManager.get();
  if (prefs.priorityDeviceId) {
    audioManager.setSavedPriorityDeviceId(prefs.priorityDeviceId);
  }
  
  audioManager.on('stateChanged', () => {
    broadcastStateChanged();
  });
  await audioManager.init();

  trayManager = new TrayManager(audioManager);
  trayManager.init(showSettingsInClipboardWindow, checkForUpdatesCallback);

  console.log('[Main] Audio system initialized');
}

/**
 * Initialize the transcription system.
 */
async function initTranscriberSystem(): Promise<void> {
  console.log('[Main] Initializing transcription system...');

  if (!nativeHelper) {
    console.error('[Main] Cannot initialize transcriber - nativeHelper not available');
    return;
  }

  // Initialize preferences manager if needed (already loaded in initAudioSystem)
  if (!preferencesManager) {
    preferencesManager = new PreferencesManager();
    await preferencesManager.load();
  }

  // Initialize clipboard manager with hotkeys from preferences
  clipboardManager = new ClipboardManager();
  
  // Broadcast ITEM_ADDED when clipboard polling detects new items
  clipboardManager.setOnItemAdded((id) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
      }
    });
  });
  
  const prefs = preferencesManager.get();
  clipboardManager.loadHotkeysFromPreferences(
    prefs.clipboardScreenshotHotkey,
    prefs.clipboardHistoryHotkey
  );
  
  // Load continuous context preferences
  clipboardManager.loadContinuousContextFromPreferences(
    prefs.continuousContextEnabled,
    prefs.continuousContextHotkey
  );
  
  // Listen for continuous context state changes and broadcast to renderer
  clipboardManager.on('continuousContextChanged', (state: ContinuousContextState) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(ClipboardIPCChannels.CONTINUOUS_CONTEXT_CHANGED, state);
      }
    });
  });
  
  // When continuous context captures a screenshot, notify all windows
  clipboardManager.on('continuousContextScreenshot', (itemId: number) => {
    // Queue for vision processing if available
    if (visionProcessor) {
      visionProcessor.queueImage(itemId).catch((error) => {
        console.error('[Main] Failed to queue continuous context image for vision:', error);
      });
    }
    
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, itemId);
      }
    });
  });
  
  // Register continuous context hotkey if enabled
  if (prefs.continuousContextEnabled) {
    clipboardManager.registerContinuousContextHotkey(async () => {
      if (!clipboardManager) return;
      
      const state = clipboardManager.getContinuousContextState();
      if (state.active) {
        // If already active, stop it
        clipboardManager.stopContinuousContext();
      } else {
        // Start continuous context mode
        await clipboardManager.startContinuousContext();
      }
    });
  }
  
  // Register clipboard hotkeys
  clipboardManager.registerScreenshotHotkey(async () => {
    // Get current stackId if in stacking mode
    const stackId = transcriberManager?.getCurrentStackId() || undefined;
    
    // Capture screenshot with region selection (drag to select)
    // If in stacking mode, the screenshot is tagged with the current stackId
    const id = await clipboardManager!.captureScreenshot(true, stackId);
    if (id > 0) {
      // Add screenshot to prompt stack tracking
      if (transcriberManager) {
        transcriberManager.addToStack(id);
        
        // In stacking mode, auto-paste the screenshot to the target app
        const stackingMode = transcriberManager.getStackingMode();
        if (stackingMode.active && stackingMode.targetApp) {
          const { exec } = await import('child_process');
          const { promisify } = await import('util');
          const execAsync = promisify(exec);
          
          // Activate target app
          try {
            await execAsync(`osascript -e 'tell application id "${stackingMode.targetApp}" to activate'`);
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // Read the screenshot and paste it
            const item = clipboardManager!.getItem(id);
            if (item?.imageData) {
              const { nativeImage } = await import('electron');
              const image = nativeImage.createFromBuffer(item.imageData);
              clipboard.writeImage(image);
              await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
            }
          } catch (err) {
            console.error('[Main] Failed to auto-paste screenshot in stacking mode:', err);
          }
        }
      }
      
      // Queue for vision processing if vision processor is available
      if (visionProcessor) {
        visionProcessor.queueImage(id).catch((error) => {
          console.error('[Main] Failed to queue image for vision processing:', error);
        });
      }
      
      // Notify all windows (including clipboard history window)
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
        }
      });
    }
  });
  
  // Debounce to avoid repeated toggles when the hotkey auto-repeats
  let lastHistoryToggleAt = 0;
  
  clipboardManager.registerHistoryHotkey(async () => {
    const now = Date.now();
    if (now - lastHistoryToggleAt < 250) return;
    lastHistoryToggleAt = now;

    if (!clipboardHistoryWindow) {
      clipboardHistoryWindow = initClipboardHistoryWindow();
    }

    const visible = clipboardHistoryWindow.isVisible();

    if (!visible) {
      // Capture frontmost app before showing window.
      // Must await to ensure target app is correct when sendTargetAppInfo() is called.
      await clipboardHistoryWindow.capturePreviousAppBeforeShow();
      
      const boundsToUse = restoreClipboardHistoryBounds();
      clipboardHistoryWindow.show(boundsToUse);
    } else {
      // Hide window and restore focus to previous app.
      // Don't hide the entire app if recording overlay is visible.
      const overlayVisible = transcriberManager?.isRecordingOverlayVisible() ?? false;
      clipboardHistoryWindow.hide(!overlayVisible);
    }
  });

  transcriberManager = new TranscriberManager(nativeHelper, preferencesManager, clipboardManager);
  await transcriberManager.init();
  broadcastTranscribeEvents();

  // Set up escape key priority: dismiss clipboard history before canceling recording
  transcriberManager.setClipboardHistoryVisibilityChecker(() => {
    return clipboardHistoryWindow?.isVisible() ?? false;
  });
  
  // Listen for dismiss event from escape key handler
  transcriberManager.on('dismiss-clipboard-history', () => {
    clipboardHistoryWindow?.hide(false); // false = don't hide the app (recording continues)
  });

  // Initialize mobile sync to pull iOS transcriptions into clipboard history.
  // Load Supabase credentials from .env.local file.
  const envVars = loadEnvVars();
  mobileSync = new MobileSync(clipboardManager, preferencesManager);
  await mobileSync.init(envVars.supabaseUrl, envVars.supabaseAnonKey);

  // Forward todosChanged events to all renderer windows.
  mobileSync.on('todosChanged', (todos) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(TodoIPCChannels.TODOS_CHANGED, todos);
      }
    });
  });

  // Register todo hotkey (Cmd+Shift+T by default).
  // This hotkey toggles between todo view and clipboard view.
  const todoHotkey = prefs.todoHotkey || 'Command+Shift+T';
  let lastTodoToggleAt = 0;
  
  try {
    globalShortcut.register(todoHotkey, () => {
      // Debounce to avoid repeated toggles when the hotkey auto-repeats.
      const now = Date.now();
      if (now - lastTodoToggleAt < 250) return;
      lastTodoToggleAt = now;

      if (!clipboardHistoryWindow) {
        clipboardHistoryWindow = initClipboardHistoryWindow();
      }

      const visible = clipboardHistoryWindow.isVisible();

      if (!visible) {
        // Show window in todo view mode.
        clipboardHistoryWindow.capturePreviousAppBeforeShow().then(() => {
          const boundsToUse = restoreClipboardHistoryBounds();
          clipboardHistoryWindow!.show(boundsToUse);
          // Switch to todo view after window is shown.
          setTimeout(() => {
            clipboardHistoryWindow?.getWindow()?.webContents.send(TodoIPCChannels.SHOW_TODOS);
          }, 50);
        });
      } else {
        // If already visible, toggle between todo and clipboard view.
        // Send SHOW_TODOS event - the renderer will toggle if already in todo view.
        clipboardHistoryWindow.getWindow()?.webContents.send(TodoIPCChannels.SHOW_TODOS);
      }
    });
    console.log(`[Main] Registered todo hotkey: ${todoHotkey}`);
  } catch (err) {
    console.error('[Main] Failed to register todo hotkey:', err);
  }

  console.log('[Main] Transcription system initialized');
}

/**
 * Initialize the vision system.
 */
async function initVisionSystem(): Promise<void> {
  console.log('[Main] Initializing vision system...');

  if (!clipboardManager) {
    console.error('[Main] Cannot initialize vision - clipboardManager not available');
    return;
  }

  visionModelManager = new VisionModelManager();
  visionProcessor = new VisionProcessor(visionModelManager, clipboardManager);

  // Update clipboard manager callback to include vision processing
  // This ensures images added via clipboard polling are also processed
  clipboardManager.setOnItemAdded((id) => {
    // Queue for vision processing if it's an image and vision processor is available
    if (visionProcessor) {
      const item = clipboardManager!.getItem(id);
      if (item && (item.type === 'image' || item.type === 'screenshot')) {
        visionProcessor.queueImage(id).catch((error) => {
          console.error('[Main] Failed to queue image for vision processing:', error);
        });
      }
    }
    
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
      }
    });
  });

  // Listen for description ready events
  visionProcessor.on('descriptionReady', (itemId: number, description: string) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(VisionIPCChannels.DESCRIPTION_READY, itemId, description);
        // Also send item update to refresh UI
        window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, itemId);
      }
    });
  });

  // Listen for errors
  visionProcessor.on('error', (itemId: number, error: Error) => {
    console.error(`[Main] Vision processing error for item ${itemId}:`, error);
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(VisionIPCChannels.ERROR, itemId, error.message);
      }
    });
  });

  console.log('[Main] Vision system initialized');
}

// Prevent multiple instances of the app.
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // Show clipboard history when user tries to launch app again
    showClipboardHistoryOnActivate();
  });

  app.whenReady().then(async () => {
    console.log('[Main] App ready');

    setupIPCHandlers();
    setupTranscribeIPCHandlers();
    setupVisionIPCHandlers();
    setupClipboardIPCHandlers();
    setupOnboardingIPCHandlers();
    setupDisplayListeners();

    // Register keyboard shortcut to reset onboarding (Cmd+Shift+R).
    // Useful for testing and development.
    globalShortcut.register('Command+Shift+R', async () => {
      console.log('[Main] Reset onboarding shortcut triggered');
      if (!preferencesManager) return;
      
      await preferencesManager.save({ 
        onboardingComplete: false,
        onboardingStep: undefined,
      });
      
      if (onboardingWindow) {
        onboardingWindow.close();
        onboardingWindow = null;
      }
      
      onboardingWindow = new OnboardingWindow();
      onboardingWindow.show(OnboardingStep.WELCOME);
    });

    // Manual update check function for tray menu.
    function checkForUpdatesManual(): void {
      console.log('[Updater] Manual update check triggered');
      console.log('[Updater] Feed URL config:', { provider: 'github', owner: 'afar1', repo: 'field-releases' });
      console.log('[Updater] Current app version:', app.getVersion());
      autoUpdater.checkForUpdates().catch((err) => {
        console.error('[Updater] Check failed:', err);
      });
    }

    await initAudioSystem(checkForUpdatesManual);
    await initTranscriberSystem();
    await initVisionSystem();

    // Check for updates on startup and periodically (production only).
    if (!process.env.ELECTRON_START_URL) {
      // Initial check after 5s delay to not block UI.
      setTimeout(() => {
        console.log('[Updater] Checking for updates on startup...');
        autoUpdater.checkForUpdates();
      }, 5000);

      // Periodic check every 30 minutes.
      setInterval(() => {
        console.log('[Updater] Periodic update check...');
        autoUpdater.checkForUpdates();
      }, 30 * 60 * 1000);
    }

    // Auto-updater event handlers - send to renderer for in-app notification UI.
    autoUpdater.on('checking-for-update', () => {
      console.log('[Updater] Checking for updates...');
    });

    autoUpdater.on('update-available', (info) => {
      console.log('[Updater] Update available:', info.version);
      pendingUpdateInfo = { status: 'available', version: info.version };
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('updater:updateAvailable', { version: info.version });
        }
      });
    });

    autoUpdater.on('update-not-available', () => {
      console.log('[Updater] No update available.');
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('updater:updateNotAvailable');
        }
      });
    });

    autoUpdater.on('error', (err) => {
      console.error('[Updater] Error:', err.message);
      console.error('[Updater] Full error:', err);
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('updater:error', err.message);
        }
      });
    });

    autoUpdater.on('download-progress', (progress) => {
      const percent = Math.round(progress.percent);
      console.log(`[Updater] Download progress: ${percent}%`);
      if (pendingUpdateInfo) {
        pendingUpdateInfo.status = 'downloading';
      }
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('updater:downloadProgress', percent);
        }
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('[Updater] Update downloaded:', info.version);
      pendingUpdateInfo = { status: 'ready', version: info.version };
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('updater:updateDownloaded', { version: info.version });
        }
      });
    });

    // App version (sync for immediate access).
    ipcMain.on('app:getVersion', (event) => {
      event.returnValue = app.getVersion();
    });

    // Updater IPC handlers.
    ipcMain.handle('updater:checkForUpdates', () => {
      autoUpdater.checkForUpdates();
    });

    ipcMain.handle('updater:downloadUpdate', () => {
      autoUpdater.downloadUpdate();
    });

    ipcMain.handle('updater:installUpdate', () => {
      autoUpdater.quitAndInstall();
    });

    ipcMain.handle('updater:dismissUpdate', () => {
      // Clear pending update state so notification doesn't reappear.
      pendingUpdateInfo = null;
    });

    ipcMain.handle('updater:getStatus', () => {
      // Return current update state so windows can query it on open.
      return pendingUpdateInfo;
    });

    // Check permissions on startup and notify main window
    const permissions = await checkPermissions();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow?.webContents.send('permissions-status', permissions);
      });
    }
    
    // First-run check: Show onboarding wizard if not completed.
    const prefs = preferencesManager?.get();
    if (!prefs?.onboardingComplete) {
      console.log('[Main] First run detected, showing onboarding wizard');
      onboardingWindow = new OnboardingWindow();
      const startStep = prefs?.onboardingStep ?? OnboardingStep.WELCOME;
      onboardingWindow.show(startStep);
    }
    // createWindow(); // Commented out for testing - app runs in background, opens manually

    app.on('activate', () => {
      // Always show clipboard history when app becomes active.
      // We no longer create the old main/settings window - the app is a background app
      // that primarily operates through the clipboard history window and tray.
      showClipboardHistoryOnActivate();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    console.log('[Main] App quitting, cleaning up...');

    if (mobileSync) {
      mobileSync.destroy();
    }

    if (transcriberManager) {
      transcriberManager.destroy();
    }

    if (trayManager) {
      trayManager.destroy();
    }

    if (nativeHelper) {
      nativeHelper.stop();
    }

    if (clipboardManager) {
      clipboardManager.destroy();
    }

    if (clipboardHistoryWindow) {
      clipboardHistoryWindow.destroy();
    }
  });
}