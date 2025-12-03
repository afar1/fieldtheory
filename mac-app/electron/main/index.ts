import { app, BrowserWindow, ipcMain, clipboard, screen, Display, Notification } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import os from 'os';
import { NativeHelper } from './nativeHelper';
import { AudioManager } from './audioManager';
import { TrayManager } from './trayManager';
import { TranscriberManager } from './transcriberManager';
import { PreferencesManager } from './preferences';
import { ClipboardManager } from './clipboardManager';
import { ModelSize } from './modelManager';
import { ClipboardHistoryWindow } from './clipboardHistoryWindow';
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
} from './types/clipboard';
import { ClipboardItem } from './clipboardManager';

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

let mainWindow: BrowserWindow | null = null;
let nativeHelper: NativeHelper | null = null;
let audioManager: AudioManager | null = null;
let trayManager: TrayManager | null = null;
let transcriberManager: TranscriberManager | null = null;
let preferencesManager: PreferencesManager | null = null;
let clipboardManager: ClipboardManager | null = null;
let clipboardHistoryWindow: ClipboardHistoryWindow | null = null;

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
 * Show clipboard history window when app becomes active.
 * Called from app 'activate' event handler.
 */
function showClipboardHistoryOnActivate(): void {
  // Ensure clipboard history window is initialized
  if (!clipboardHistoryWindow) {
    clipboardHistoryWindow = new ClipboardHistoryWindow();
  }
  
  // Only show if not already visible
  if (!clipboardHistoryWindow.isVisible()) {
    // Load saved bounds from preferences
    const prefs = preferencesManager?.get();
    const savedBounds = prefs?.clipboardHistoryBounds;
    const currentDisplayConfig = ClipboardHistoryWindow.getDisplayConfigHash();
    
    // Only use saved bounds if display config matches
    let boundsToUse: { x: number; y: number; width: number; height: number } | undefined;
    if (savedBounds && savedBounds.displayConfig === currentDisplayConfig) {
      const displays = screen.getAllDisplays();
      const minX = Math.min(...displays.map((d: Display) => d.bounds.x));
      const minY = Math.min(...displays.map((d: Display) => d.bounds.y));
      
      boundsToUse = {
        x: savedBounds.x - minX,
        y: savedBounds.y - minY,
        width: savedBounds.width,
        height: savedBounds.height,
      };
    }
    
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

  ipcMain.handle(ClipboardIPCChannels.SEPARATE_INTO_TASKS, async (_event, id: number) => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    await transcriberManager.separateIntoTasks(id);
  });

  ipcMain.handle(ClipboardIPCChannels.SAVE_BOUNDS, async (_event, bounds: { x: number; y: number; width: number; height: number }) => {
    if (!preferencesManager) {
      return;
    }
    
    // Generate current display config hash
    const displayConfig = ClipboardHistoryWindow.getDisplayConfigHash();
    
    const displays = screen.getAllDisplays();
    const minX = Math.min(...displays.map((d: Display) => d.bounds.x));
    const minY = Math.min(...displays.map((d: Display) => d.bounds.y));
    
    // Save bounds with display config (in screen coordinates)
    await preferencesManager.save({
      clipboardHistoryBounds: {
        x: bounds.x + minX,
        y: bounds.y + minY,
        width: bounds.width,
        height: bounds.height,
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
  trayManager.init(showMainWindow, checkForUpdatesCallback);

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
      clipboardHistoryWindow = new ClipboardHistoryWindow();
    }

    const visible = clipboardHistoryWindow.isVisible();

    if (!visible) {
      // Load saved bounds from preferences
      const prefs = preferencesManager?.get();
      const savedBounds = prefs?.clipboardHistoryBounds;
      const currentDisplayConfig = ClipboardHistoryWindow.getDisplayConfigHash();
      
      // Only use saved bounds if display config matches
      let boundsToUse: { x: number; y: number; width: number; height: number } | undefined;
      if (savedBounds && savedBounds.displayConfig === currentDisplayConfig) {
        const displays = screen.getAllDisplays();
        const minX = Math.min(...displays.map((d: Display) => d.bounds.x));
        const minY = Math.min(...displays.map((d: Display) => d.bounds.y));
        
        boundsToUse = {
          x: savedBounds.x - minX,
          y: savedBounds.y - minY,
          width: savedBounds.width,
          height: savedBounds.height,
        };
      }
      
      // Show window and take focus (like Alfred)
      // show() is now synchronous - window appears immediately, app data loads in background.
      clipboardHistoryWindow.show(boundsToUse);
    } else {
      // Hide window and restore focus to previous app
      clipboardHistoryWindow.hide();
    }
  });

  transcriberManager = new TranscriberManager(nativeHelper, preferencesManager, clipboardManager);
  await transcriberManager.init();
  broadcastTranscribeEvents();

  console.log('[Main] Transcription system initialized');
}

// Prevent multiple instances of the app.
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });

  app.whenReady().then(async () => {
    console.log('[Main] App ready');

    setupIPCHandlers();
    setupTranscribeIPCHandlers();
    setupClipboardIPCHandlers();

    // Manual update check function for tray menu.
    function checkForUpdatesManual(): void {
      console.log('[Updater] Manual update check triggered');
      autoUpdater.checkForUpdates();
    }

    await initAudioSystem(checkForUpdatesManual);
    await initTranscriberSystem();

    // Auto-updater event handlers for logging and user notifications.
    autoUpdater.on('checking-for-update', () => {
      console.log('[Updater] Checking for updates...');
    });

    autoUpdater.on('update-available', (info) => {
      console.log('[Updater] Update available:', info.version);
      new Notification({
        title: 'Update Available',
        body: `Version ${info.version} is downloading...`,
      }).show();
    });

    autoUpdater.on('update-not-available', (info) => {
      console.log('[Updater] No update available. Current version is up to date.');
    });

    autoUpdater.on('error', (err) => {
      console.error('[Updater] Error checking for updates:', err.message);
    });

    autoUpdater.on('download-progress', (progress) => {
      console.log(`[Updater] Download progress: ${Math.round(progress.percent)}%`);
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('[Updater] Update downloaded:', info.version);
      new Notification({
        title: 'Update Ready',
        body: 'Restart Oscar to install the update.',
      }).show();
    });

    // Check for updates and notify user if available
    autoUpdater.checkForUpdatesAndNotify();

    // Check permissions on startup and notify main window
    const permissions = await checkPermissions();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.once('did-finish-load', () => {
        mainWindow?.webContents.send('permissions-status', permissions);
      });
    }
    // createWindow(); // Commented out for testing - app runs in background, opens manually

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      } else {
        // When app becomes active, show clipboard history window
        showClipboardHistoryOnActivate();
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    console.log('[Main] App quitting, cleaning up...');

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
