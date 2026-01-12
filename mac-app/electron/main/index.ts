import { app, BrowserWindow, ipcMain, clipboard, screen, Display, Notification, dialog, globalShortcut, shell, Menu } from 'electron';
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
import { SharedClipboardSync, SharedClipboardQueryOptions } from './sharedClipboardSync';
import { SocialSync } from './socialSync';
import { SharedClipboardIPCChannels } from './types/clipboard';
import { SocialIPCChannels } from './types/social';
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
import { ClipboardItem, isTerminalApp, obscureHomePath } from './clipboardManager';
import { VisionModelManager, VisionModelSize } from './visionModelManager';
import { VisionProcessor } from './visionProcessor';
import { 
  engineerStack, 
  setApiKey as setEngineerApiKey,
  setCustomSystemPrompt,
  getActiveSystemPrompt,
  loadDefaultSystemPrompt,
} from './promptEngineer';
import { OnboardingWindow, OnboardingStep } from './onboardingWindow';
import { OnboardingIPCChannels } from './types/onboarding';
import { TodoIPCChannels } from './types/todo';
import { CursorStatusManager, CursorStatusState } from './cursorStatusManager';
import { QuotaManager } from './quotaManager';
import { DiagnosticsCollector } from './diagnosticsCollector';

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

  // Production fallback - anon key is public by design, protected by RLS.
  console.log('[Main] Using production Supabase credentials');
  return {
    supabaseUrl: 'https://FIELD_THEORY_SUPABASE_URL.example',
    supabaseAnonKey: 'FIELD_THEORY_SUPABASE_PUBLISHABLE_KEY',
  };
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

// Configure autoUpdater for manual update flow.
// allowPrerelease ensures users on prerelease builds (e.g., 0.1.29-maxwell) can update to stable releases (0.1.30).
autoUpdater.autoDownload = false;
autoUpdater.allowPrerelease = true;
autoUpdater.setFeedURL({ provider: 'github', owner: 'afar1', repo: 'field-releases' });

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
let sharedClipboardSync: SharedClipboardSync | null = null;
let socialSync: SocialSync | null = null;
let onboardingWindow: OnboardingWindow | null = null;
let cursorStatusManager: CursorStatusManager | null = null;
let quotaManager: QuotaManager | null = null;
let diagnosticsCollector: DiagnosticsCollector | null = null;

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

let displayMetricsDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Handle display metrics changes - recalculate window position if needed.
 * Debounced since display changes fire many events in quick succession.
 */
function handleDisplayMetricsChanged(_event: Electron.Event, _changedDisplay: Electron.Display): void {
  if (!clipboardHistoryWindow || !clipboardHistoryWindow.isVisible()) {
    return;
  }

  if (!preferencesManager) {
    return;
  }

  if (displayMetricsDebounceTimer) {
    clearTimeout(displayMetricsDebounceTimer);
  }
  
  displayMetricsDebounceTimer = setTimeout(() => {
    displayMetricsDebounceTimer = null;
    if (!clipboardHistoryWindow || !clipboardHistoryWindow.isVisible()) return;
    
    console.log('[ClipboardHistoryWindow] Display metrics changed, repositioning window');
    const boundsToUse = restoreClipboardHistoryBounds();
    if (boundsToUse) {
      clipboardHistoryWindow.reposition(boundsToUse);
    }
  }, 200);
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
  const window = new ClipboardHistoryWindow(preferencesManager ?? undefined);
  
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
  
  // Always show the clipboard window when app is activated (e.g., Dock icon click).
  const boundsToUse = restoreClipboardHistoryBounds();
  clipboardHistoryWindow.show(boundsToUse);
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

  ipcMain.handle(TranscribeIPCChannels.TOGGLE_RECORDING, () => {
    if (!transcriberManager) {
      console.error('[Main] toggleRecording: transcriberManager not initialized');
      return;
    }
    transcriberManager.toggleRecording();
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
          modelManager.downloadModelForSize(modelSize as 'small' | 'medium' | 'large', onProgress)
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
    const validSizes: ModelSize[] = ['small', 'medium', 'large'];
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

  ipcMain.handle(TranscribeIPCChannels.GET_DOWNLOADING_MODELS, () => {
    if (!transcriberManager) {
      return [];
    }
    const modelManager = transcriberManager.getModelManager();
    return modelManager.getDownloadingModels();
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
    const validSizes: ModelSize[] = ['small', 'medium', 'large'];
    if (!validSizes.includes(modelSize as ModelSize)) {
      throw new Error(`Invalid model size: ${modelSize}`);
    }
    await transcriberManager.setSelectedModel(modelSize as ModelSize);
  });

  ipcMain.handle(TranscribeIPCChannels.GET_HOTKEY, () => {
    if (!transcriberManager) {
      return 'Command+\\';
    }
    return transcriberManager.getHotkey();
  });

  ipcMain.handle(TranscribeIPCChannels.SET_HOTKEY, async (_event, hotkey: string) => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    const success = await transcriberManager.setHotkey(hotkey);

    // Update tray manager with new transcription hotkey
    if (success && trayManager && clipboardManager) {
      const historyHotkey = clipboardManager.getHotkeys().historyHotkey || 'Option+Space';
      const screenshotHotkey = clipboardManager.getHotkeys().screenshotHotkey || 'Command+4';
      trayManager.setHotkeys(historyHotkey, hotkey, screenshotHotkey);
    }

    return success;
  });

  ipcMain.handle(TranscribeIPCChannels.GET_SECONDARY_HOTKEY, () => {
    if (!transcriberManager) {
      return null;
    }
    return transcriberManager.getSecondaryHotkey();
  });

  ipcMain.handle(TranscribeIPCChannels.SET_SECONDARY_HOTKEY, async (_event, hotkey: string | null) => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    return await transcriberManager.setSecondaryHotkey(hotkey);
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

  // Abandon recording hotkey settings.
  ipcMain.handle(TranscribeIPCChannels.GET_ABANDON_HOTKEY, () => {
    if (!transcriberManager) {
      return 'Escape';
    }
    return transcriberManager.getAbandonHotkey();
  });

  ipcMain.handle(TranscribeIPCChannels.SET_ABANDON_HOTKEY, async (_event, hotkey: string) => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    return await transcriberManager.setAbandonHotkey(hotkey);
  });

  ipcMain.handle(TranscribeIPCChannels.GET_ABANDON_CONFIRMATION, () => {
    if (!transcriberManager) {
      return true;
    }
    return transcriberManager.getAbandonConfirmation();
  });

  ipcMain.handle(TranscribeIPCChannels.SET_ABANDON_CONFIRMATION, async (_event, enabled: boolean) => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    await transcriberManager.setAbandonConfirmation(enabled);
  });

  // Sound settings handlers.
  ipcMain.handle(TranscribeIPCChannels.GET_SOUND_CONFIG, () => {
    if (!transcriberManager) {
      return { enabled: true, recordingStart: undefined, recordingStop: undefined, recordingCancel: undefined };
    }
    return transcriberManager.getSoundManager().getConfig();
  });

  ipcMain.handle(TranscribeIPCChannels.SET_SOUND_CONFIG, async (_event, config: {
    enabled?: boolean;
    recordingStart?: string;
    recordingStop?: string;
    recordingCancel?: string;
  }) => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    await transcriberManager.getSoundManager().setConfig(config);
  });

  ipcMain.handle(TranscribeIPCChannels.GET_AVAILABLE_SOUNDS, () => {
    // Import dynamically to avoid circular dependency issues.
    const { getAllSounds } = require('./soundManager');
    return getAllSounds();
  });

  ipcMain.handle(TranscribeIPCChannels.PREVIEW_SOUND, async (_event, soundId: string) => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    transcriberManager.getSoundManager().preview(soundId);
  });

  ipcMain.handle('transcribe:getStackCount', () => {
    if (!transcriberManager) {
      return 0;
    }
    return transcriberManager.getCurrentStack().length;
  });
  
  ipcMain.handle('transcribe:addToStack', (_event, itemId: number) => {
    if (!transcriberManager) {
      return;
    }
    transcriberManager.addToStack(itemId);
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
    // Convert Buffer to base64 for IPC. For list view, thumbnailData is preferred.
    return items.map(item => ({
      ...item,
      imageData: item.imageData ? item.imageData.toString('base64') : null,
      thumbnailData: item.thumbnailData ? item.thumbnailData.toString('base64') : null,
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
      thumbnailData: item.thumbnailData ? item.thumbnailData.toString('base64') : null,
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
    const id = await clipboardManager.captureScreenshot({ region: region || false });
    if (id > 0) {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
        }
      });
    }
    return id;
  });

  ipcMain.handle(ClipboardIPCChannels.SAVE_SKETCH, async (_event, imageData: string, width: number, height: number) => {
    if (!clipboardManager) {
      return -1;
    }
    
    try {
      // Convert base64 to Buffer
      const imageBuffer = Buffer.from(imageData, 'base64');
      
      // Create NativeImage from buffer
      const { nativeImage } = require('electron');
      const image = nativeImage.createFromBuffer(imageBuffer);
      
      if (image.isEmpty()) {
        console.error('[Main] Failed to create image from sketch data');
        return -1;
      }
      
      // Store in clipboard history as screenshot type
      const id = await clipboardManager.storeImage(
        image,
        imageBuffer,
        'screenshot',
        undefined, // No source app for sketches
        undefined, // No stack ID
        'mac' // Source is Mac
      );
      
      // Notify listeners
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
        }
      });
      
      return id;
    } catch (error) {
      console.error('[Main] Failed to save sketch:', error);
      return -1;
    }
  });

  ipcMain.handle(ClipboardIPCChannels.GET_HOTKEYS, async () => {
    if (!clipboardManager) {
      return {
        screenshot: 'Command+4',
        history: 'Alt+Space',
      };
    }
    return clipboardManager.getHotkeys();
  });

  ipcMain.handle(ClipboardIPCChannels.SET_HOTKEYS, async (_event, hotkeys: { screenshot?: string; fullScreen?: string; activeWindow?: string; history?: string }) => {
    if (!clipboardManager || !preferencesManager) {
      return false;
    }

    let success = true;
    const prefsToSave: { clipboardScreenshotHotkey?: string; clipboardFullScreenHotkey?: string; clipboardActiveWindowHotkey?: string; clipboardHistoryHotkey?: string } = {};

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

    if (hotkeys.fullScreen !== undefined) {
      if (typeof hotkeys.fullScreen !== 'string' || hotkeys.fullScreen.trim() === '') {
        return false;
      }
      const result = clipboardManager.setFullScreenHotkey(hotkeys.fullScreen);
      if (!result) {
        success = false;
      } else {
        prefsToSave.clipboardFullScreenHotkey = hotkeys.fullScreen;
      }
    }

    if (hotkeys.activeWindow !== undefined) {
      if (typeof hotkeys.activeWindow !== 'string' || hotkeys.activeWindow.trim() === '') {
        return false;
      }
      const result = clipboardManager.setActiveWindowHotkey(hotkeys.activeWindow);
      if (!result) {
        success = false;
      } else {
        prefsToSave.clipboardActiveWindowHotkey = hotkeys.activeWindow;
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

    // Update tray manager if any displayed hotkey changed
    if (trayManager && transcriberManager && (hotkeys.history !== undefined || hotkeys.screenshot !== undefined)) {
      const currentHotkeys = clipboardManager.getHotkeys();
      const historyHotkey = hotkeys.history || currentHotkeys.historyHotkey || 'Option+Space';
      const transcriptionHotkey = transcriberManager.getHotkey() || 'Option+Shift+Space';
      const screenshotHotkey = hotkeys.screenshot || currentHotkeys.screenshotHotkey || 'Command+4';
      trayManager.setHotkeys(historyHotkey, transcriptionHotkey, screenshotHotkey);
    }

    return success;
  });

  ipcMain.handle(ClipboardIPCChannels.PASTE_ITEM, async (_event, id: number, targetBundleId?: string) => {
    console.log('[Main] PASTE_ITEM called - id:', id, 'targetBundleId:', targetBundleId);
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
      console.log('[Main] Found item:', item.type, 'figureLabel:', item.figureLabel);

      // Determine the target bundle ID for terminal detection
      let effectiveBundleId: string | null = targetBundleId || null;
      if (!effectiveBundleId && clipboardHistoryWindow) {
        const previousApp = clipboardHistoryWindow.getPreviousApp();
        effectiveBundleId = previousApp?.bundleId || null;
      }

      // Check if target is a terminal
      const { isTerminalApp } = require('./clipboardManager');
      const isTerminal = isTerminalApp(effectiveBundleId);

      // Put content on clipboard first.
      if (item.type === 'text' || item.type === 'transcript') {
        // Use improved content if available and toggle is set.
        let textContent = (item.useImprovedVersion && item.improvedContent)
          ? item.improvedContent
          : (item.content || '');

        // If this item belongs to a stack, append the figure list
        if (item.stackId) {
          const stackItems = clipboardManager.queryItemsByStackId(item.stackId);
          const hasFigures = stackItems.some(i => i.imageData && i.figureLabel);

          if (hasFigures) {
            // Import the helper function
            const { obscureHomePath } = require('./clipboardManager');

            // Build figure list
            const figurePaths: string[] = [];
            for (const stackItem of stackItems) {
              if (stackItem.imageData && stackItem.figureLabel) {
                const imagePath = await clipboardManager.exportImageToCache(stackItem);
                if (imagePath) {
                  const obscuredPath = obscureHomePath(imagePath);
                  figurePaths.push(`Figure ${stackItem.figureLabel}: ${obscuredPath}`);
                }
              }
            }

            if (figurePaths.length > 0) {
              textContent = `${textContent}\n\n${figurePaths.join('\n')}\n\n`;
            }
          }
        }

        clipboard.writeText(textContent);
      } else if (item.imageData) {
        if (isTerminal) {
          // For terminals: export image to file and put path on clipboard
          const imagePath = await clipboardManager.exportImageToCache(item);
          if (imagePath) {
            const { obscureHomePath } = require('./clipboardManager');
            const obscuredPath = obscureHomePath(imagePath);
            const figureRef = item.figureLabel
              ? `Figure ${item.figureLabel}: ${obscuredPath}`
              : obscuredPath;
            clipboard.writeText(figureRef);
          } else {
            console.error('[Main] Failed to export image for terminal paste');
            return;
          }
        } else {
          // For non-terminals: put image buffer on clipboard as before
          const { nativeImage } = require('electron');
          const imageBuffer = typeof item.imageData === 'string'
            ? Buffer.from(item.imageData, 'base64')
            : item.imageData;
          const image = nativeImage.createFromBuffer(imageBuffer);
          clipboard.writeImage(image);
        }
      }

      clipboardManager.syncClipboardHash();

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

  // Copy item to clipboard without pasting.
  ipcMain.handle(ClipboardIPCChannels.COPY_ITEM, async (_event, id: number) => {
    try {
      if (!clipboardManager) {
        console.error('[Main] copyItem: clipboardManager not initialized');
        return;
      }
      const item = clipboardManager.getItem(id);
      if (!item) {
        console.error('[Main] copyItem: item not found', id);
        return;
      }
      
      // Put content on clipboard.
      if (item.type === 'text' || item.type === 'transcript') {
        clipboard.writeText(item.content || '');
      } else if (item.imageData) {
        const { nativeImage } = require('electron');
        const imageBuffer = typeof item.imageData === 'string' 
          ? Buffer.from(item.imageData, 'base64')
          : item.imageData;
        const image = nativeImage.createFromBuffer(imageBuffer);
        clipboard.writeImage(image);
      }
      
      clipboardManager.syncClipboardHash();
      console.log('[Main] copyItem: copied item', id, 'to clipboard');
    } catch (error) {
      console.error('[Main] copyItem error:', error);
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

      // Detect if frontmost app is a terminal (can't render images inline).
      let isTerminal = false;
      try {
        const { stdout } = await execAsync(
          'osascript -e \'tell application "System Events" to get bundle identifier of first process whose frontmost is true\''
        );
        isTerminal = isTerminalApp(stdout.trim());
      } catch {
        // Default to non-terminal if detection fails
      }

      // Check if we have images with figure labels (for building figure paths).
      const imageItems = items.filter(i => i.imageData && i.figureLabel);
      const hasTranscriptWithFigures = 
        items.some(i => i.type === 'text' || i.type === 'transcript') && 
        imageItems.length > 0;
      
      // Count images we'll actually paste (for non-terminals).
      const imagesToPaste = isTerminal 
        ? 0 
        : items.filter(i => i.imageData).length;
      
      // Show warning for more than 10 images being pasted to multimodal apps.
      if (imagesToPaste > 10 && cursorStatusManager) {
        cursorStatusManager.showCriticalMessage('Pasting more than 10 images – some apps may have limits');
      }

      // Build figure paths for text content if we have multiple items.
      const buildFigurePaths = async (): Promise<string> => {
        const paths: string[] = [];
        for (const item of imageItems) {
          const imagePath = await clipboardManager!.exportImageToCache(item);
          if (imagePath) {
            const obscuredPath = obscureHomePath(imagePath);
            paths.push(`Figure ${item.figureLabel}: ${obscuredPath}`);
          }
        }
        return paths.length > 0 ? `\n\n${paths.join('\n')}\n\n` : '';
      };
      
      // Adaptive delay for image pastes: give apps more time when pasting many images.
      // Base delay is 100ms, scales up to 400ms for large batches.
      const getImagePasteDelay = (imageCount: number): number => {
        if (imageCount <= 5) return 100;
        if (imageCount <= 10) return 150;
        if (imageCount <= 20) return 250;
        return 400;
      };
      const imagePasteDelay = getImagePasteDelay(imagesToPaste);

      // Paste each item sequentially with delays.
      for (const item of items) {
        try {
          if (item.type === 'text' || item.type === 'transcript') {
            // Use improved content if available and toggle is set.
            let textContent = (item.useImprovedVersion && item.improvedContent)
              ? item.improvedContent
              : (item.content || '');
            
            // Only add figure paths for terminals (non-terminals get actual images).
            if (items.length > 1 && isTerminal) {
              textContent += await buildFigurePaths();
            }
            
            clipboard.writeText(textContent);
            clipboardManager.syncClipboardHash();
            await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
            await new Promise(resolve => setTimeout(resolve, 100));
          } else if (item.imageData) {
            // For terminals with transcript+figures, skip individual image paste.
            // Terminal users will use the file paths from the Figures section.
            if (isTerminal && hasTranscriptWithFigures) {
              continue;
            }
            
            if (isTerminal) {
              // Terminal without transcript: paste file path instead of image.
              const imagePath = await clipboardManager!.exportImageToCache(item);
              if (imagePath) {
                const obscuredPath = obscureHomePath(imagePath);
                clipboard.writeText(obscuredPath);
                clipboardManager.syncClipboardHash();
                await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
              }
              await new Promise(resolve => setTimeout(resolve, 100));
            } else {
              // Non-terminal: paste actual image (multimodal apps can render it).
              const imageBuffer = typeof item.imageData === 'string' 
                ? Buffer.from(item.imageData, 'base64')
                : item.imageData;
              const image = nativeImage.createFromBuffer(imageBuffer);
              clipboard.writeImage(image);
              clipboardManager.syncClipboardHash();
              await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
              // Use adaptive delay for images to prevent overwhelming target apps.
              await new Promise(resolve => setTimeout(resolve, imagePasteDelay));
            }
          }
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
      
      if (clipboardManager) clipboardManager.syncClipboardHash();
      
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

  // Toggle Developer Tools for debugging (secret shortcut: Cmd+Shift+I)
  ipcMain.on('electron:toggleDevTools', (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window && !window.isDestroyed()) {
      window.webContents.toggleDevTools();
    }
  });

  // Relaunch the app
  ipcMain.on('electron:relaunch', () => {
    app.relaunch();
    app.quit();
  });
  
  // Show "no target" error at cursor position (replaces old toast window).
  ipcMain.on('clipboard:showNoTargetError', async (_event, message?: string) => {
    if (cursorStatusManager) {
      cursorStatusManager.showNoTargetError(message);
    }
  });
  
  ipcMain.on('clipboard:setSketchMode', async (_event, active: boolean) => {
    clipboardHistoryWindow?.setSketchModeActive(active);
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
      thumbnailData: item.thumbnailData ? item.thumbnailData.toString('base64') : null,
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

  // =========================================================================
  // System Prompt Customization - User can modify how transcriptions are improved
  // =========================================================================

  // Get the currently active system prompt (custom if set, otherwise default).
  ipcMain.handle(ClipboardIPCChannels.GET_SYSTEM_PROMPT, async () => {
    // First load any saved custom prompt from preferences.
    const customPrompt = preferencesManager?.getPreference('customSystemPrompt');
    if (customPrompt) {
      setCustomSystemPrompt(customPrompt);
    }
    return {
      prompt: getActiveSystemPrompt(),
      isCustom: !!customPrompt,
    };
  });

  // Set a custom system prompt.
  ipcMain.handle(ClipboardIPCChannels.SET_SYSTEM_PROMPT, async (_event, prompt: string) => {
    try {
      if (!preferencesManager) {
        return { success: false, error: 'Preferences not initialized' };
      }
      
      // Save to preferences for persistence.
      await preferencesManager.save({ customSystemPrompt: prompt });
      
      // Update the in-memory prompt.
      setCustomSystemPrompt(prompt);
      
      return { success: true };
    } catch (error) {
      console.error('[Main] setSystemPrompt error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save system prompt',
      };
    }
  });

  // Reset to the default system prompt.
  ipcMain.handle(ClipboardIPCChannels.RESET_SYSTEM_PROMPT, async () => {
    try {
      if (!preferencesManager) {
        return { success: false, error: 'Preferences not initialized' };
      }
      
      // Clear from preferences.
      await preferencesManager.save({ customSystemPrompt: undefined });
      
      // Clear in-memory custom prompt.
      setCustomSystemPrompt(null);
      
      return { success: true };
    } catch (error) {
      console.error('[Main] resetSystemPrompt error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reset system prompt',
      };
    }
  });

  // Get the default system prompt (for showing in UI before user customizes).
  ipcMain.handle(ClipboardIPCChannels.GET_DEFAULT_SYSTEM_PROMPT, async () => {
    return { prompt: loadDefaultSystemPrompt() };
  });

  // =========================================================================
  // Improved Content Management - Save/clear improved versions of transcriptions
  // =========================================================================

  // Save improved content for a specific item.
  ipcMain.handle(ClipboardIPCChannels.SAVE_IMPROVED_CONTENT, async (_event, itemId: number, improvedContent: string) => {
    try {
      if (!clipboardManager) {
        return { success: false, error: 'Clipboard manager not initialized' };
      }
      clipboardManager.saveImprovedContent(itemId, improvedContent);
      return { success: true };
    } catch (error) {
      console.error('[Main] saveImprovedContent error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to save improved content',
      };
    }
  });

  // Clear improved content for a specific item (revert to original only).
  ipcMain.handle(ClipboardIPCChannels.CLEAR_IMPROVED_CONTENT, async (_event, itemId: number) => {
    try {
      if (!clipboardManager) {
        return { success: false, error: 'Clipboard manager not initialized' };
      }
      clipboardManager.clearImprovedContent(itemId);
      return { success: true };
    } catch (error) {
      console.error('[Main] clearImprovedContent error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clear improved content',
      };
    }
  });

  // Toggle between improved and original text for an item.
  ipcMain.handle(ClipboardIPCChannels.SET_USE_IMPROVED_VERSION, async (_event, itemId: number, useImproved: boolean) => {
    try {
      if (!clipboardManager) {
        return { success: false, error: 'Clipboard manager not initialized' };
      }
      clipboardManager.setUseImprovedVersion(itemId, useImproved);
      return { success: true };
    } catch (error) {
      console.error('[Main] setUseImprovedVersion error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set use improved version',
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

  ipcMain.handle('auth:signUp', async (_event, email: string, password: string) => {
    if (!mobileSync) {
      return { error: 'Mobile sync not initialized' };
    }
    return await mobileSync.signUp(email, password);
  });

  ipcMain.handle('auth:signInWithPassword', async (_event, email: string, password: string) => {
    if (!mobileSync) {
      return { error: 'Mobile sync not initialized', session: null };
    }
    return await mobileSync.signInWithPassword(email, password);
  });

  ipcMain.handle('auth:requestOtp', async (_event, email: string) => {
    if (!mobileSync) {
      return { error: 'Mobile sync not initialized' };
    }
    return await mobileSync.requestOtp(email);
  });

  ipcMain.handle('auth:verifyOtp', async (_event, email: string, token: string) => {
    if (!mobileSync) {
      return { error: 'Mobile sync not initialized', session: null };
    }
    return await mobileSync.verifyOtp(email, token);
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
    const result = await mobileSync.signOut();
    
    // Reset cached tier to 'free' on logout so quotas show free limits.
    if (!result.error && quotaManager) {
      await quotaManager.setCachedTier('free');
    }
    
    return result;
  });

  ipcMain.handle('auth:deleteAccount', async () => {
    if (!mobileSync) {
      return { error: 'Mobile sync not initialized' };
    }
    
    const session = mobileSync.getSession();
    if (!session?.access_token) {
      return { error: 'Not authenticated' };
    }

    const envVars = loadEnvVars();
    if (!envVars.supabaseUrl) {
      return { error: 'Supabase not configured' };
    }

    const edgeFunctionUrl = `${envVars.supabaseUrl}/functions/v1/delete-account`;
    
    try {
      const response = await fetch(edgeFunctionUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
      });

      const result = await response.json() as { error?: string; success?: boolean };
      
      if (!response.ok) {
        console.error('[Main] Delete account failed:', result);
        return { error: result.error || 'Failed to delete account' };
      }

      await mobileSync.signOut();
      if (quotaManager) {
        await quotaManager.setCachedTier('free');
      }
      
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('session-changed', null);
          window.webContents.send('tier-changed', 'free');
        }
      });
      
      return { error: null };
    } catch (err) {
      console.error('[Main] Delete account error:', err);
      return { error: 'Failed to connect to server' };
    }
  });

  ipcMain.handle('auth:getSession', async () => {
    if (!mobileSync) {
      return null;
    }
    return mobileSync.getSession();
  });

  // Open external URL in default browser (for Stripe checkout, etc).
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    await shell.openExternal(url);
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
      return 'Shift+Command+4';
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

  // Permission banner settings - allow user to hide screen recording permission banner.
  ipcMain.handle(ClipboardIPCChannels.GET_HIDE_SCREEN_RECORDING_BANNER, async () => {
    if (!preferencesManager) {
      return false;
    }
    return preferencesManager.getPreference('hideScreenRecordingBanner') ?? false;
  });

  ipcMain.handle(ClipboardIPCChannels.SET_HIDE_SCREEN_RECORDING_BANNER, async (_event, hide: boolean) => {
    if (!preferencesManager) {
      return false;
    }
    await preferencesManager.save({ hideScreenRecordingBanner: hide });
    return true;
  });

  // Cursor status indicator settings - show dot next to cursor during recording/transcribing.
  ipcMain.handle(ClipboardIPCChannels.GET_CURSOR_STATUS_ENABLED, async () => {
    if (!preferencesManager) {
      return true; // Default enabled
    }
    return preferencesManager.getPreference('cursorStatusEnabled') ?? true;
  });

  ipcMain.handle(ClipboardIPCChannels.SET_CURSOR_STATUS_ENABLED, async (_event, enabled: boolean) => {
    if (!preferencesManager) {
      return false;
    }
    await preferencesManager.save({ cursorStatusEnabled: enabled });
    cursorStatusManager?.setEnabled(enabled);
    return true;
  });

  // Hide status labels - show only colored dots (red/purple/green).
  ipcMain.handle('clipboard:getHideStatusLabels', async () => {
    if (!preferencesManager) {
      return false;
    }
    return preferencesManager.getPreference('hideStatusLabels') ?? false;
  });

  ipcMain.handle('clipboard:setHideStatusLabels', async (_event, hide: boolean) => {
    if (!preferencesManager) {
      return false;
    }
    await preferencesManager.save({ hideStatusLabels: hide });
    cursorStatusManager?.setHideLabels(hide);
    
    // User explicitly enabled labels - bypass progressive hiding.
    if (!hide) {
      await preferencesManager.save({ labelsExplicitlyEnabled: true });
      cursorStatusManager?.setLabelsExplicitlyEnabled(true);
    }
    return true;
  });
  
  // Show in Dock - controls whether app appears in Dock and Cmd+Tab.
  ipcMain.handle('clipboard:getShowInDock', async () => {
    if (!preferencesManager) {
      return false;
    }
    return preferencesManager.getPreference('showInDock') ?? false;
  });
  
  ipcMain.handle('clipboard:setShowInDock', async (_event, show: boolean) => {
    if (!preferencesManager) {
      return false;
    }
    await preferencesManager.save({ showInDock: show });
    
    // Apply immediately. Window type can't change dynamically, so recreate the window.
    if (process.platform === 'darwin') {
      if (show) {
        await app.dock.show();
      } else {
        app.dock.hide();
      }
      
      // Recreate window with correct type (panel vs normal window with titlebar).
      if (clipboardHistoryWindow) {
        const wasVisible = clipboardHistoryWindow.isVisible();
        const bounds = clipboardHistoryWindow.getWindow()?.getBounds();
        
        // Destroy the old window.
        clipboardHistoryWindow.destroy();
        clipboardHistoryWindow = null;
        
        // Reinitialize with new window type.
        clipboardHistoryWindow = initClipboardHistoryWindow();
        
        // If it was visible, show it again at the same position.
        if (wasVisible && bounds) {
          clipboardHistoryWindow.show(bounds);
        }
      }
    }
    return true;
  });

  // Sounds enabled - master toggle for all sounds.
  ipcMain.handle('clipboard:getSoundsEnabled', async () => {
    if (!preferencesManager) {
      return true;
    }
    return preferencesManager.getPreference('soundsEnabled') ?? true;
  });

  ipcMain.handle('clipboard:setSoundsEnabled', async (_event, enabled: boolean) => {
    if (!preferencesManager) {
      return false;
    }
    await preferencesManager.save({ soundsEnabled: enabled });
    return true;
  });

  // Tasks tab - experimental feature toggle.
  ipcMain.handle('clipboard:getTasksTabEnabled', async () => {
    if (!preferencesManager) {
      return false;
    }
    return preferencesManager.getPreference('tasksTabEnabled') ?? false;
  });

  ipcMain.handle('clipboard:setTasksTabEnabled', async (_event, enabled: boolean) => {
    if (!preferencesManager) {
      return false;
    }
    await preferencesManager.save({ tasksTabEnabled: enabled });
    return true;
  });

  // =========================================================================
  // Quota IPC Handlers - Local usage tracking
  // QuotaManager handles session checking internally via setSessionChecker().
  // =========================================================================

  ipcMain.handle('quota:getQuotas', async () => {
    if (!quotaManager) {
      return null;
    }
    return quotaManager.getQuotas();
  });

  ipcMain.handle('quota:checkQuota', async (_event, feature: 'priorityMic' | 'autoStack') => {
    if (!quotaManager) {
      return { allowed: true, used: 0, limit: Infinity, remaining: Infinity, percentUsed: 0 };
    }
    return quotaManager.checkQuota(feature);
  });

  ipcMain.handle('quota:getFormattedUsage', async () => {
    if (!quotaManager) {
      return { priorityMic: 'Unlimited', autoStack: 'Unlimited' };
    }
    return {
      priorityMic: quotaManager.formatPriorityMicUsage(),
      autoStack: quotaManager.formatAutoStackUsage(),
    };
  });

  ipcMain.handle('quota:getResetDate', async () => {
    if (!quotaManager) {
      return new Date();
    }
    return quotaManager.getResetDate();
  });

  ipcMain.handle('quota:refreshTier', async () => {
    if (!mobileSync) {
      return { tier: 'free', error: 'Not initialized' };
    }
    
    const session = mobileSync.getSession();
    if (!session) {
      return { tier: 'free', error: 'Not signed in' };
    }
    
    try {
      const supabase = mobileSync.getSupabaseClient();
      if (!supabase) {
        return { tier: 'free', error: 'No Supabase client' };
      }
      
      const { data, error } = await supabase
        .from('profiles')
        .select('tier')
        .eq('id', session.user.id)
        .single();
      
      if (error) {
        console.error('[Main] Failed to fetch tier:', error);
        return { tier: quotaManager?.getCachedTier() || 'free', error: error.message };
      }
      
      const tier = data?.tier || 'free';
      console.log('[Main] Refreshed tier from server:', tier);
      
      if (quotaManager) {
        await quotaManager.setCachedTier(tier);
      }
      
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('tier-changed', tier);
        }
      });
      
      return { tier, error: null };
    } catch (err) {
      console.error('[Main] Error refreshing tier:', err);
      return { tier: quotaManager?.getCachedTier() || 'free', error: String(err) };
    }
  });

  // =========================================================================
  // Diagnostics IPC Handlers - For remote troubleshooting
  // =========================================================================

  ipcMain.handle('diagnostics:get', async () => {
    if (!diagnosticsCollector) {
      return { error: 'Diagnostics not initialized' };
    }
    return diagnosticsCollector.collect();
  });

  ipcMain.handle('diagnostics:getMarkdown', async () => {
    if (!diagnosticsCollector) {
      return 'Diagnostics not initialized';
    }
    const report = await diagnosticsCollector.collect();
    return diagnosticsCollector.formatAsMarkdown(report);
  });

  // =========================================================================
  // Shared Clipboard IPC Handlers - Shared clipboard for collaboration
  // =========================================================================

  ipcMain.handle(SharedClipboardIPCChannels.QUERY_TEAM_ITEMS, async (_event, options?: SharedClipboardQueryOptions) => {
    if (!sharedClipboardSync) {
      return [];
    }
    return await sharedClipboardSync.queryItems(options);
  });

  ipcMain.handle(SharedClipboardIPCChannels.GET_TEAM_ITEM, async (_event, id: string) => {
    if (!sharedClipboardSync) {
      return null;
    }
    return await sharedClipboardSync.getItem(id);
  });

  ipcMain.handle(SharedClipboardIPCChannels.SHARE_TO_TEAM, async (_event, localItemId: number) => {
    if (!sharedClipboardSync) {
      return null;
    }
    const teamItem = await sharedClipboardSync.shareToTeam(localItemId);
    
    // Broadcast to all windows that a team item was added.
    if (teamItem) {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(SharedClipboardIPCChannels.TEAM_ITEM_ADDED, teamItem);
        }
      });
    }
    
    return teamItem;
  });

  ipcMain.handle(SharedClipboardIPCChannels.SHARE_STACK_TO_TEAM, async (_event, localItemIds: number[]) => {
    if (!sharedClipboardSync) {
      return null;
    }
    return await sharedClipboardSync.shareStackToTeam(localItemIds);
  });

  ipcMain.handle(SharedClipboardIPCChannels.DELETE_TEAM_ITEM, async (_event, id: string) => {
    if (!sharedClipboardSync) {
      return false;
    }
    const success = await sharedClipboardSync.deleteItem(id);
    
    if (success) {
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(SharedClipboardIPCChannels.TEAM_ITEM_DELETED, id);
        }
      });
    }
    
    return success;
  });

  ipcMain.handle(SharedClipboardIPCChannels.UPDATE_TEAM_STACK_ID, async (_event, itemIds: string[], stackId: string | null) => {
    if (!sharedClipboardSync) {
      return false;
    }
    return await sharedClipboardSync.updateStackId(itemIds, stackId);
  });

  ipcMain.handle(SharedClipboardIPCChannels.COPY_TO_PERSONAL, async (_event, teamItemId: string) => {
    if (!sharedClipboardSync) {
      return null;
    }
    return await sharedClipboardSync.copyToPersonal(teamItemId);
  });

  ipcMain.handle(SharedClipboardIPCChannels.COPY_STACK_TO_PERSONAL, async (_event, teamStackId: string) => {
    if (!sharedClipboardSync) {
      return [];
    }
    return await sharedClipboardSync.copyStackToPersonal(teamStackId);
  });

  ipcMain.handle(SharedClipboardIPCChannels.GET_TEAM_STACKS, async () => {
    if (!sharedClipboardSync) {
      return [];
    }
    return await sharedClipboardSync.getStacks();
  });

  ipcMain.handle(SharedClipboardIPCChannels.CREATE_TEAM_STACK, async () => {
    // Creating a team stack is implicit - when items are assigned a stack_id,
    // a stack record is created automatically in updateStackId.
    // This handler is here for future extensibility (e.g., creating named stacks).
    return null;
  });

  // =========================================================================
  // Team Membership IPC Handlers
  // =========================================================================

  ipcMain.handle(SharedClipboardIPCChannels.GET_TEAM_MEMBERS, async () => {
    if (!sharedClipboardSync) {
      return [];
    }
    return await sharedClipboardSync.getTeamMembers();
  });

  ipcMain.handle(SharedClipboardIPCChannels.ADD_TEAM_MEMBER, async (_event, email: string) => {
    if (!sharedClipboardSync) {
      return { success: false, error: 'Team sync not initialized' };
    }
    return await sharedClipboardSync.addTeamMember(email);
  });

  ipcMain.handle(SharedClipboardIPCChannels.REMOVE_TEAM_MEMBER, async (_event, membershipId: string) => {
    if (!sharedClipboardSync) {
      return { success: false, error: 'Team sync not initialized' };
    }
    return await sharedClipboardSync.removeTeamMember(membershipId);
  });

  ipcMain.handle(SharedClipboardIPCChannels.HAS_TEAMMATES, async () => {
    if (!sharedClipboardSync) {
      return false;
    }
    return await sharedClipboardSync.hasTeammates();
  });

  // =========================================================================
  // Social IPC Handlers - DMs, Feedback, Contacts, Hot Mic
  // =========================================================================

  // DM: Send a DM with a clipboard item.
  ipcMain.handle(SocialIPCChannels.SEND_DM, async (_event, recipientUserId: string, localItemId: number) => {
    if (!socialSync) {
      return null;
    }
    return await socialSync.sendDM(recipientUserId, localItemId);
  });

  // DM: Send a text-only DM (for replies).
  ipcMain.handle(SocialIPCChannels.SEND_TEXT_DM, async (_event, recipientUserId: string, text: string, parentMessageId?: string) => {
    if (!socialSync) {
      return null;
    }
    return await socialSync.sendTextDM(recipientUserId, text, parentMessageId);
  });

  // DM: Send an image reply (for feedback with pasted images).
  ipcMain.handle(SocialIPCChannels.SEND_IMAGE_REPLY, async (_event, recipientUserId: string, imageBase64: string, text?: string, parentMessageId?: string) => {
    if (!socialSync) {
      return null;
    }
    return await socialSync.sendImageReply(recipientUserId, imageBase64, text, parentMessageId);
  });

  // DM: Get all DM conversations.
  ipcMain.handle(SocialIPCChannels.GET_CONVERSATIONS, async () => {
    if (!socialSync) {
      return [];
    }
    return await socialSync.getDMConversations();
  });

  // DM: Get all DMs with a specific user.
  ipcMain.handle(SocialIPCChannels.GET_DMS_WITH_USER, async (_event, otherUserId: string) => {
    if (!socialSync) {
      return [];
    }
    return await socialSync.getDMsWithUser(otherUserId);
  });

  // DM: Mark a message as read.
  ipcMain.handle(SocialIPCChannels.MARK_AS_READ, async (_event, messageId: string) => {
    if (!socialSync) {
      return false;
    }
    return await socialSync.markAsRead(messageId);
  });

  // DM: Check if there are unread messages.
  ipcMain.handle(SocialIPCChannels.HAS_UNREAD, async () => {
    if (!socialSync) {
      return false;
    }
    return await socialSync.hasUnreadMessages();
  });

  // Feedback: Check if there are unread feedback messages.
  ipcMain.handle(SocialIPCChannels.HAS_UNREAD_FEEDBACK, async () => {
    if (!socialSync) {
      return false;
    }
    return await socialSync.hasUnreadFeedback();
  });

  // Feedback: Submit feedback (send to admin).
  ipcMain.handle(SocialIPCChannels.SUBMIT_FEEDBACK, async (_event, localItemId: number) => {
    if (!socialSync) {
      return null;
    }
    return await socialSync.submitFeedback(localItemId);
  });

  // Feedback: Submit text feedback (for diagnostics, etc.).
  ipcMain.handle(SocialIPCChannels.SUBMIT_TEXT_FEEDBACK, async (_event, text: string) => {
    if (!socialSync) {
      return null;
    }
    return await socialSync.submitTextFeedback(text);
  });

  // Feedback: Submit image feedback with optional caption.
  ipcMain.handle(SocialIPCChannels.SUBMIT_IMAGE_FEEDBACK, async (_event, imageBase64: string, caption?: string) => {
    if (!socialSync) {
      return null;
    }
    return await socialSync.submitImageFeedback(imageBase64, caption);
  });

  // Feedback: Get current user's submitted feedback.
  ipcMain.handle(SocialIPCChannels.GET_MY_FEEDBACK, async () => {
    if (!socialSync) {
      return [];
    }
    return await socialSync.getMyFeedback();
  });

  // Feedback: Get all feedback (admin only).
  ipcMain.handle(SocialIPCChannels.GET_ALL_FEEDBACK, async () => {
    if (!socialSync) {
      return [];
    }
    return await socialSync.getAllFeedback();
  });

  // Feedback: Get replies to a feedback item.
  ipcMain.handle(SocialIPCChannels.GET_FEEDBACK_REPLIES, async (_event, feedbackId: string) => {
    if (!socialSync) {
      return [];
    }
    return await socialSync.getFeedbackReplies(feedbackId);
  });

  // Feedback: Update feedback status.
  ipcMain.handle(SocialIPCChannels.UPDATE_FEEDBACK_STATUS, async (_event, feedbackId: string, status: 'open' | 'resolved' | 'archived') => {
    if (!socialSync) {
      return false;
    }
    return await socialSync.updateFeedbackStatus(feedbackId, status);
  });

  // Feedback: Get activity log for a feedback item.
  ipcMain.handle(SocialIPCChannels.GET_ACTIVITY_LOG, async (_event, feedbackId: string) => {
    if (!socialSync) {
      return [];
    }
    return await socialSync.getActivityLog(feedbackId);
  });

  // Contacts: Get all contacts.
  ipcMain.handle(SocialIPCChannels.GET_CONTACTS, async () => {
    if (!socialSync) {
      return [];
    }
    return await socialSync.getContacts();
  });

  // Contacts: Add a friend by email.
  ipcMain.handle(SocialIPCChannels.ADD_FRIEND, async (_event, email: string) => {
    if (!socialSync) {
      return { success: false, error: 'Social sync not initialized' };
    }
    return await socialSync.addFriend(email);
  });

  // Contacts: Search contacts by name or email.
  ipcMain.handle(SocialIPCChannels.SEARCH_CONTACTS, async (_event, query: string) => {
    if (!socialSync) {
      return [];
    }
    return await socialSync.searchContacts(query);
  });

  // Contacts: Get pending invites (friend requests sent to me).
  ipcMain.handle(SocialIPCChannels.GET_PENDING_INVITES, async () => {
    if (!socialSync) {
      return [];
    }
    return await socialSync.getPendingInvites();
  });

  // Contacts: Respond to a pending invite (accept or reject).
  ipcMain.handle(SocialIPCChannels.RESPOND_TO_INVITE, async (_event, contactId: string, accept: boolean) => {
    if (!socialSync) {
      return false;
    }
    return await socialSync.respondToInvite(contactId, accept);
  });

  // Contacts: Remove a friend (unfriend/leave).
  ipcMain.handle(SocialIPCChannels.REMOVE_FRIEND, async (_event, contactId: string) => {
    if (!socialSync) {
      return false;
    }
    return await socialSync.removeFriend(contactId);
  });

  // Hot Mic: Get hot mic enabled status.
  ipcMain.handle(SocialIPCChannels.GET_HOT_MIC, async () => {
    if (!socialSync) {
      return false;
    }
    return await socialSync.getHotMicEnabled();
  });

  // Hot Mic: Set hot mic enabled status.
  ipcMain.handle(SocialIPCChannels.SET_HOT_MIC, async (_event, enabled: boolean) => {
    if (!socialSync) {
      return false;
    }
    return await socialSync.setHotMicEnabled(enabled);
  });

  // Admin: Check if current user is admin.
  ipcMain.handle(SocialIPCChannels.IS_ADMIN, async () => {
    if (!socialSync) {
      return false;
    }
    return await socialSync.isCurrentUserAdmin();
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

  // Open System Settings to Screen Recording pane.
  ipcMain.handle(OnboardingIPCChannels.OPEN_SCREEN_RECORDING_SETTINGS, async () => {
    if (!onboardingWindow) {
      onboardingWindow = new OnboardingWindow();
    }
    onboardingWindow.openScreenRecordingSettings();
    return true;
  });

  // Trigger screen capture to add app to Screen Recording permissions list.
  // This saves users from manually clicking "+" to add the app.
  ipcMain.handle(OnboardingIPCChannels.TRIGGER_SCREEN_RECORDING_PROMPT, async () => {
    if (!onboardingWindow) {
      onboardingWindow = new OnboardingWindow();
    }
    await onboardingWindow.triggerScreenRecordingPrompt();
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

  // Note: EXPAND_WINDOW handler removed - no longer needed since onboarding
  // is now just 2 phases (permissions + model) with no tutorial phase.
}


/**
 * Check permissions and return status.
 */
async function checkPermissions(): Promise<{ accessibilityGranted: boolean }> {
  if (!nativeHelper) {
    return { accessibilityGranted: false };
  }
  try {
    return await nativeHelper.checkPermissions();
  } catch (error) {
    console.error('[Main] Failed to check permissions:', error);
    return { accessibilityGranted: false };
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
    
    // Update cursor status indicator and increment progressive label counts.
    if (cursorStatusManager) {
      cursorStatusManager.setState(status as CursorStatusState);
      
      // Increment label counts (labels auto-hide after thresholds).
      if (preferencesManager) {
        const hideLabels = preferencesManager.getPreference('hideStatusLabels') ?? false;
        if (!hideLabels) {
          if (status === 'recording') {
            const currentCount = preferencesManager.getPreference('sayAnythingLabelShownCount') ?? 0;
            if (currentCount < 2) {
              const newCount = cursorStatusManager.incrementLabelCount('sayAnything');
              preferencesManager.save({ sayAnythingLabelShownCount: newCount });
            }
          } else if (status === 'transcribing') {
            const currentCount = preferencesManager.getPreference('transcribingLabelShownCount') ?? 0;
            if (currentCount < 3) {
              const newCount = cursorStatusManager.incrementLabelCount('transcribing');
              preferencesManager.save({ transcribingLabelShownCount: newCount });
            }
          }
        }
      }
    }
    
    // Force Dock visibility when showInDock is enabled.
    if (process.platform === 'darwin' && preferencesManager) {
      const showInDock = preferencesManager.getPreference('showInDock') ?? false;
      if (showInDock) {
        app.dock.show();
      }
    }
  });

  transcriberManager.on('result', (text) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(TranscribeIPCChannels.RESULT, text);
      }
    });
    // Store transcription for cursor status done state display
    cursorStatusManager?.setLastTranscription(text);
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
    // Update cursor status with screenshot count (for pipe indicator).
    cursorStatusManager?.setScreenshotCount(count);
  });
  
  // Track if quota just exhausted - skip paste-success to preserve upgrade message.
  let quotaJustExhausted = false;
  
  transcriberManager.on('paste-success', (transcription) => {
    // If quota was just exhausted, skip the normal done state to preserve upgrade message.
    if (quotaJustExhausted) {
      quotaJustExhausted = false;
      return;
    }
    if (cursorStatusManager) {
      cursorStatusManager.setStateWithData('done', { transcription, pasteFailed: false });
    }
  });
  
  transcriberManager.on('paste-failed', (message, transcription) => {
    if (cursorStatusManager) {
      cursorStatusManager.setStateWithData('paste-failed', { transcription: transcription || message });
    }
  });
  
  // Confirmation state events for cursor status widget
  transcriberManager.on('confirmation-show', () => {
    if (cursorStatusManager) {
      cursorStatusManager.setState('confirmation');
    }
  });
  
  transcriberManager.on('confirmation-hide', () => {
    // Return to recording state (recording continues during confirmation)
    if (cursorStatusManager) {
      cursorStatusManager.setState('recording');
    }
  });
  
  // Handle quota exhausted events - show upgrade prompt at cursor and broadcast to windows.
  transcriberManager.on('quotaExhausted', (data: { feature: 'priorityMic' | 'autoStack'; used: number; limit: number }) => {
    const { feature, used, limit } = data;
    const featureName = feature === 'priorityMic' ? 'priority mic minutes' : 'auto-stacks';
    const limitDisplay = feature === 'priorityMic' ? `${Math.floor(limit / 60)} minutes` : `${limit} stacks`;
    
    // Show message at cursor for auto-stack quota exhaustion.
    if (feature === 'autoStack' && cursorStatusManager) {
      quotaJustExhausted = true;
      cursorStatusManager.setScreenshotCount(0);
      cursorStatusManager.setStateWithData('paste-failed', {
        transcription: 'Transcript saved — open Field Theory to add screenshots',
        pasteFailed: true,
      });
    }
    
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('quota:exhausted', { feature, used, limit, featureName, limitDisplay });
      }
    });
    
    console.log(`[Main] Quota exhausted: ${featureName} (${used}/${limit})`);
  });
  
  // Handle stacking disabled during recording - screenshot taken but quota exhausted.
  transcriberManager.on('stackingDisabled', (data: { itemId: number; message: string }) => {
    if (cursorStatusManager) {
      cursorStatusManager.showNoTargetError(data.message);
    }
    console.log(`[Main] Stacking disabled: ${data.message}`);
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
  
  // Hide clipboard history when user clicks on menu bar (Alfred-style).
  // Debounce to avoid hiding immediately after app activation.
  let lastActivateTime = 0;
  
  app.on('activate', () => {
    lastActivateTime = Date.now();
  });
  
  nativeHelper.on('menuBarClicked', () => {
    if (Date.now() - lastActivateTime < 300) return;
    if (clipboardHistoryWindow?.isVisible()) {
      clipboardHistoryWindow.hide();
    }
  });
  
  // Show clipboard history when Field Theory becomes frontmost (e.g., via Cmd+Tab).
  nativeHelper.on('appBecameFrontmost', () => {
    if (clipboardHistoryWindow?.isVisible()) return;
    
    if (!clipboardHistoryWindow) {
      clipboardHistoryWindow = initClipboardHistoryWindow();
    }
    
    clipboardHistoryWindow.playOpenSound();
    const boundsToUse = restoreClipboardHistoryBounds();
    clipboardHistoryWindow.show(boundsToUse, false, true);
    clipboardHistoryWindow.capturePreviousAppBeforeShow();
  });

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

  // Start recording callback - toggles recording via transcriberManager.
  // Wrapped in a function that checks if transcriberManager is ready.
  const startRecordingCallback = () => {
    if (transcriberManager) {
      transcriberManager.toggleRecording();
    } else {
      console.warn('[TrayManager] TranscriberManager not ready yet');
    }
  };

  // Take screenshot callback - triggers region selection screenshot.
  const takeScreenshotCallback = async () => {
    if (clipboardManager) {
      const id = await clipboardManager.captureScreenshot({ region: true });
      if (id > 0 && transcriberManager) {
        transcriberManager.addToStack(id);
      }
      if (id > 0 && visionProcessor) {
        visionProcessor.queueImage(id).catch((error) => {
          console.error('[Main] Failed to queue image for vision processing:', error);
        });
      }
      if (id > 0) {
        BrowserWindow.getAllWindows().forEach((window) => {
          if (!window.isDestroyed()) {
            window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
          }
        });
      }
    } else {
      console.warn('[TrayManager] ClipboardManager not ready yet');
    }
  };

  // Take full screen screenshot callback.
  const takeFullScreenCallback = async () => {
    if (clipboardManager) {
      const id = await clipboardManager.captureScreenshot({ fullScreen: true });
      if (id > 0 && transcriberManager) {
        transcriberManager.addToStack(id);
      }
      if (id > 0 && visionProcessor) {
        visionProcessor.queueImage(id).catch((error) => {
          console.error('[Main] Failed to queue image for vision processing:', error);
        });
      }
      if (id > 0) {
        BrowserWindow.getAllWindows().forEach((window) => {
          if (!window.isDestroyed()) {
            window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
          }
        });
      }
    } else {
      console.warn('[TrayManager] ClipboardManager not ready yet');
    }
  };

  // Take active window screenshot callback.
  const takeActiveWindowCallback = async () => {
    if (clipboardManager) {
      const id = await clipboardManager.captureScreenshot({ activeWindow: true });
      if (id > 0 && transcriberManager) {
        transcriberManager.addToStack(id);
      }
      if (id > 0 && visionProcessor) {
        visionProcessor.queueImage(id).catch((error) => {
          console.error('[Main] Failed to queue image for vision processing:', error);
        });
      }
      if (id > 0) {
        BrowserWindow.getAllWindows().forEach((window) => {
          if (!window.isDestroyed()) {
            window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
          }
        });
      }
    } else {
      console.warn('[TrayManager] ClipboardManager not ready yet');
    }
  };

  trayManager.init(showSettingsInClipboardWindow, checkForUpdatesCallback, startRecordingCallback, takeScreenshotCallback, takeFullScreenCallback, takeActiveWindowCallback);

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
    // Capture screenshot with region selection (drag to select).
    const id = await clipboardManager!.captureScreenshot({ region: true });
    if (id > 0) {
      // Add screenshot to prompt stack tracking (for auto-stacking during recording).
      if (transcriberManager) {
        transcriberManager.addToStack(id);
      }

      // Queue for vision processing if vision processor is available.
      if (visionProcessor) {
        visionProcessor.queueImage(id).catch((error) => {
          console.error('[Main] Failed to queue image for vision processing:', error);
        });
      }

      // Notify all windows (including clipboard history window).
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
        }
      });
    }
  });

  // Register full screen screenshot hotkey (Cmd+3)
  clipboardManager.registerFullScreenHotkey(async () => {
    // Capture full screen immediately without interaction
    const id = await clipboardManager!.captureScreenshot({ fullScreen: true });
    if (id > 0) {
      // Add screenshot to prompt stack tracking
      if (transcriberManager) {
        transcriberManager.addToStack(id);
      }

      // Queue for vision processing if vision processor is available
      if (visionProcessor) {
        visionProcessor.queueImage(id).catch((error) => {
          console.error('[Main] Failed to queue image for vision processing:', error);
        });
      }

      // Notify all windows
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
        }
      });
    }
  });

  // Register active window screenshot hotkey (Cmd+Shift+3)
  clipboardManager.registerActiveWindowHotkey(async () => {
    // Capture just the active window
    const id = await clipboardManager!.captureScreenshot({ activeWindow: true });
    if (id > 0) {
      // Add screenshot to prompt stack tracking
      if (transcriberManager) {
        transcriberManager.addToStack(id);
      }

      // Queue for vision processing if vision processor is available
      if (visionProcessor) {
        visionProcessor.queueImage(id).catch((error) => {
          console.error('[Main] Failed to queue image for vision processing:', error);
        });
      }

      // Notify all windows
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
    const showInDock = preferencesManager?.getPreference('showInDock') ?? false;

    if (!visible) {
      // Play sound immediately for responsive feedback.
      clipboardHistoryWindow.playOpenSound();
      
      // Show window immediately for snappy UX.
      const boundsToUse = restoreClipboardHistoryBounds();
      clipboardHistoryWindow.show(boundsToUse, false, true); // skipSound=true since we already played it
      
      // Capture frontmost app in background (updates target app info after window shows).
      // Not awaited - window appears instantly, target app info updates ~200ms later.
      clipboardHistoryWindow.capturePreviousAppBeforeShow();
    } else if (!showInDock) {
      // Panel mode: toggle behavior - hide window and restore focus.
      const overlayVisible = transcriberManager?.isRecordingOverlayVisible() ?? false;
      clipboardHistoryWindow.hide(!overlayVisible);
    }
    // When showInDock is true and visible: do nothing (normal app behavior).
  });

  // Initialize quota manager for tracking local usage.
  quotaManager = new QuotaManager(preferencesManager);

  // Connect quota manager to tray for menu bar display
  if (trayManager) {
    trayManager.setQuotaManager(quotaManager);
  }

  // Broadcast quota changes to all windows so UI can update in real-time.
  quotaManager.on('quotaChanged', (quotas) => {
    const formatted = {
      priorityMic: quotaManager!.formatPriorityMicUsage(),
      autoStack: quotaManager!.formatAutoStackUsage(),
    };
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('quota:changed', formatted);
      }
    });
  });

  // Initialize cursor status indicator BEFORE transcriberManager so it can be passed in.
  cursorStatusManager = new CursorStatusManager();
  const cursorStatusEnabled = preferencesManager.getPreference('cursorStatusEnabled') ?? true;
  cursorStatusManager.setEnabled(cursorStatusEnabled);
  const hideStatusLabels = preferencesManager.getPreference('hideStatusLabels') ?? false;
  cursorStatusManager.setHideLabels(hideStatusLabels);

  // Load progressive label hiding state.
  const transcribingCount = preferencesManager.getPreference('transcribingLabelShownCount') ?? 0;
  const sayAnythingCount = preferencesManager.getPreference('sayAnythingLabelShownCount') ?? 0;
  const labelsExplicitlyEnabled = preferencesManager.getPreference('labelsExplicitlyEnabled') ?? false;
  cursorStatusManager.setLabelCounts(transcribingCount, sayAnythingCount);
  cursorStatusManager.setLabelsExplicitlyEnabled(labelsExplicitlyEnabled);

  // Now create transcriberManager with cursorStatusManager.
  transcriberManager = new TranscriberManager(nativeHelper, preferencesManager, clipboardManager, quotaManager, audioManager ?? undefined, cursorStatusManager);
  await transcriberManager.init();
  broadcastTranscribeEvents();

  // Wire up confirmation response from cursor status widget to transcriber manager
  cursorStatusManager.on('confirmation-response', ({ abandon }) => {
    transcriberManager?.handleConfirmationResponse(abandon);
  });
  
  // Shift cursor status indicator right during screenshot to avoid overlap.
  clipboardManager.on('screenshotStart', () => {
    cursorStatusManager?.setScreenshotMode(true);
  });
  clipboardManager.on('screenshotEnd', () => {
    cursorStatusManager?.setScreenshotMode(false);
  });
  
  // Initialize diagnostics collector for remote troubleshooting.
  diagnosticsCollector = new DiagnosticsCollector(preferencesManager);
  if (transcriberManager) {
    diagnosticsCollector.setModelManager(transcriberManager.getModelManager());
  }
  if (visionModelManager) {
    diagnosticsCollector.setVisionModelManager(visionModelManager);
  }
  if (audioManager) {
    diagnosticsCollector.setAudioManager(audioManager);
  }

  // Set up escape key priority: dismiss clipboard history before canceling recording
  transcriberManager.setClipboardHistoryVisibilityChecker(() => {
    return clipboardHistoryWindow?.isVisible() ?? false;
  });
  
  // Skip auto-paste only when draw canvas is actively visible
  transcriberManager.setSketchModeChecker(() => {
    return (clipboardHistoryWindow?.isSketchModeActive() && clipboardHistoryWindow?.isVisible()) ?? false;
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
  
  // Wire up session checker so quota manager uses free limits when not logged in.
  // This ensures auto-stack limits are enforced for logged-out users.
  if (quotaManager) {
    quotaManager.setSessionChecker(() => {
      const session = mobileSync?.getSession();
      if (!session?.expires_at) return false;
      return session.expires_at > Math.floor(Date.now() / 1000);
    });
  }

  // Initialize shared clipboard sync - shares Supabase client with mobileSync.
  // This enables collaborative clipboard sharing between team members.
  sharedClipboardSync = new SharedClipboardSync(clipboardManager);
  
  // Initialize social sync for DMs, Feedback, and Contacts.
  socialSync = new SocialSync(clipboardManager);
  
  // Check if mobileSync already has a session from stored credentials.
  // If so, initialize sharedClipboardSync and socialSync with it.
  const existingSession = mobileSync.getSession();
  // @ts-ignore - Access internal supabase client.
  const existingSupabaseClient = mobileSync['supabase'];
  
  // Validate session is not expired. Supabase may return stale sessions from storage
  // before background refresh completes, so we check expires_at explicitly.
  const isSessionValid = existingSession && existingSession.expires_at && 
    existingSession.expires_at > Math.floor(Date.now() / 1000);
  
  if (isSessionValid && existingSupabaseClient) {
    console.log('[Main] Found existing session on startup, initializing syncs');
    sharedClipboardSync.setSupabaseClient(existingSupabaseClient);
    sharedClipboardSync.setSession(existingSession);
    socialSync.setSupabaseClient(existingSupabaseClient);
    socialSync.setSession(existingSession);
    // Note: Tier fetch happens when ClipboardHistory forwards the session via setSyncSession,
    // which triggers mobileSync.setSession -> fetchAndEmitCurrentTier.
  } else {
    // No valid session on startup - ensure cached tier is 'free'.
    // This handles: expired sessions, app crash without logout, stale session files.
    if (quotaManager && quotaManager.getCachedTier() === 'pro') {
      console.log('[Main] No valid session but cached tier is pro, resetting to free');
      await quotaManager.setCachedTier('free');
    }
  }
  
  // Set the Supabase client from mobileSync once a session is established.
  // The client is shared to avoid duplicate connections.
  // When mobileSync sets a session, we forward it to sharedClipboardSync and socialSync.
  const originalSetSession = mobileSync.setSession.bind(mobileSync);
  mobileSync.setSession = async (accessToken: string, refreshToken: string) => {
    // Skip if we already have this exact session to prevent duplicate calls.
    // Multiple UI components call setSyncSession on mount/auth change.
    const currentSession = mobileSync!.getSession();
    if (currentSession?.access_token === accessToken) {
      return;
    }
    
    await originalSetSession(accessToken, refreshToken);
    // Forward session to sharedClipboardSync and socialSync.
    const session = mobileSync!.getSession();
    // The Supabase client is available on mobileSync after init.
    // @ts-ignore - Access internal supabase client.
    const supabaseClient = mobileSync!['supabase'];
    
    if (session && sharedClipboardSync && supabaseClient) {
      sharedClipboardSync.setSupabaseClient(supabaseClient);
      sharedClipboardSync.setSession(session);
    }
    
    if (session && socialSync && supabaseClient) {
      socialSync.setSupabaseClient(supabaseClient);
      socialSync.setSession(session);
    }
  };

  // Forward todosChanged events to all renderer windows.
  mobileSync.on('todosChanged', (todos) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(TodoIPCChannels.TODOS_CHANGED, todos);
      }
    });
  });

  // Forward todo realtime events to renderer.
  mobileSync.on('todoAdded', (todo) => {
    console.log('[Main] Realtime: todo added:', todo.id);
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(TodoIPCChannels.TODO_ADDED, todo);
      }
    });
  });

  mobileSync.on('todoUpdated', (todo) => {
    console.log('[Main] Realtime: todo updated:', todo.id);
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(TodoIPCChannels.TODO_UPDATED, todo);
      }
    });
  });

  mobileSync.on('todoDeleted', (id) => {
    console.log('[Main] Realtime: todo deleted:', id);
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(TodoIPCChannels.TODO_DELETED, id);
      }
    });
  });

  // Forward tier changes to quota manager and all renderer windows.
  // This fires when Stripe webhook updates the user's tier in Supabase.
  mobileSync.on('tierChanged', async (tier: 'free' | 'pro') => {
    console.log('[Main] Realtime: tier changed to:', tier);
    
    // Update the cached tier in quota manager.
    if (quotaManager) {
      await quotaManager.setCachedTier(tier);
    }
    
    // Broadcast to all windows so UI updates immediately.
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('tier:changed', tier);
      }
    });
  });

  // Forward socialSync messageReceived events to all renderer windows.
  // All message types are forwarded for unread indicators. Hot Mic overlay only shows for DMs.
  if (socialSync) {
    socialSync.on('messageReceived', async (message: { id: string; type: string }) => {
      console.log('[Main] Message received:', message.id, 'type:', message.type);
      
      // Forward ALL messages to renderer for unread indicators (feedback dot, DM dot, etc).
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(SocialIPCChannels.MESSAGE_RECEIVED, message);
        }
      });
      
      // Only show Hot Mic overlay for DMs, not feedback replies.
      if (message.type !== 'dm') {
        return;
      }
      
      // Check if Hot Mic is enabled for this user.
      const hotMicEnabled = await socialSync!.getHotMicEnabled();
      if (!hotMicEnabled) {
        console.log('[Main] Hot Mic is disabled, skipping overlay');
        return;
      }
      
      // Check if user is currently recording (don't interrupt).
      if (clipboardHistoryWindow?.getRecordingActive()) {
        console.log('[Main] User is recording, skipping Hot Mic overlay');
        return;
      }
      
      // Show the clipboard history window if it's not visible.
      if (clipboardHistoryWindow && !clipboardHistoryWindow.isVisible()) {
        console.log('[Main] Showing clipboard history window for Hot Mic');
        clipboardHistoryWindow.show();
      }
    });
  }

  // Forward sharedClipboardSync realtime events to renderer windows.
  // This enables instant updates when teammates add, modify, or delete items.
  if (sharedClipboardSync) {
    sharedClipboardSync.on('teamItemAdded', (item) => {
      console.log('[Main] Realtime: team item added:', item.id);
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(SharedClipboardIPCChannels.TEAM_ITEM_ADDED, item);
        }
      });
    });

    sharedClipboardSync.on('teamItemUpdated', (item) => {
      console.log('[Main] Realtime: team item updated:', item.id);
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(SharedClipboardIPCChannels.TEAM_ITEM_UPDATED, item);
        }
      });
    });

    sharedClipboardSync.on('teamItemDeleted', (id) => {
      console.log('[Main] Realtime: team item deleted:', id);
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(SharedClipboardIPCChannels.TEAM_ITEM_DELETED, id);
        }
      });
    });
  }

  // Cmd+Shift+T toggles Tasks tab visibility.
  const todoHotkey = 'Command+Shift+T';
  let lastTodoToggleAt = 0;
  
  try {
    globalShortcut.register(todoHotkey, async () => {
      // Debounce to avoid repeated toggles when the hotkey auto-repeats.
      const now = Date.now();
      if (now - lastTodoToggleAt < 250) return;
      lastTodoToggleAt = now;

      if (!preferencesManager) return;

      const currentValue = preferencesManager.getPreference('tasksTabEnabled') ?? false;
      const newValue = !currentValue;
      await preferencesManager.save({ tasksTabEnabled: newValue });
      
      if (clipboardHistoryWindow) {
        clipboardHistoryWindow.getWindow()?.webContents.send('clipboard:tasksTabToggled', newValue);
      }
      
      console.log(`[Main] Tasks tab toggled: ${newValue ? 'enabled' : 'disabled'}`);
    });
    console.log(`[Main] Registered tasks toggle hotkey: ${todoHotkey}`);
  } catch (err) {
    console.error('[Main] Failed to register tasks toggle hotkey:', err);
  }

  // Cmd+Shift+V = "Super Paste" - pastes last stack or smart clipboard paste
  const superPasteHotkey = 'Command+Shift+V';
  try {
    globalShortcut.register(superPasteHotkey, async () => {
      console.log('[Main] Super Paste triggered');

      if (!transcriberManager) {
        console.error('[Main] Super Paste: transcriberManager not available');
        return;
      }

      // Check if there's a recent stack to paste
      const currentStack = transcriberManager.getCurrentStack();

      if (currentStack && currentStack.length > 0) {
        // Paste the stack (context-aware, clear after so it doesn't paste again)
        console.log(`[Main] Super Paste: pasting stack with ${currentStack.length} items`);
        await transcriberManager.pasteStack(true); // true = clear stack after pasting
      } else {
        // No stack - paste most recent item from Field Theory clipboard history
        console.log('[Main] Super Paste: no stack, pasting most recent item from history');

        if (!clipboardManager) {
          console.error('[Main] Super Paste: clipboardManager not available');
          return;
        }

        // Get the most recent item ID from clipboard history
        // Query the database directly for the most recent item
        const stmt = clipboardManager['db'].prepare('SELECT id FROM clipboard_items ORDER BY created_at DESC LIMIT 1');
        const row = stmt.get() as { id: number } | undefined;

        if (!row) {
          console.log('[Main] Super Paste: no items in clipboard history');
          return;
        }

        const mostRecentItem = clipboardManager.getItem(row.id);
        if (!mostRecentItem) {
          console.log('[Main] Super Paste: failed to get most recent item');
          return;
        }
        console.log('[Main] Super Paste: pasting most recent item:', mostRecentItem.type, 'id:', mostRecentItem.id);

        // Get frontmost app for context detection
        try {
          const script = `
            tell application "System Events"
              set frontApp to first application process whose frontmost is true
              return (bundle identifier of frontApp)
            end tell
          `;
          const { exec } = require('child_process');
          const { promisify } = require('util');
          const execAsync = promisify(exec);
          const { stdout } = await execAsync(`osascript -e '${script}'`);
          const bundleId = stdout.trim();

          const { isTerminalApp, obscureHomePath } = require('./clipboardManager');
          const isTerminal = isTerminalApp(bundleId);
          console.log('[Main] Super Paste: frontmost app is terminal:', isTerminal);

          // Paste the item context-aware
          if (mostRecentItem.type === 'text' || mostRecentItem.type === 'transcript') {
            clipboard.writeText(mostRecentItem.content || '');
            await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
            console.log('[Main] Super Paste: pasted text');
          } else if (mostRecentItem.imageData) {
            if (isTerminal) {
              // For terminals: export to file and paste path
              const imagePath = await clipboardManager.exportImageToCache(mostRecentItem);
              if (imagePath) {
                const obscuredPath = obscureHomePath(imagePath);
                // Just paste the path directly, no prefix
                clipboard.writeText(obscuredPath);
                await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
                console.log('[Main] Super Paste: pasted image path to terminal:', obscuredPath);
              }
            } else {
              // For non-terminals: paste image buffer
              const { nativeImage } = require('electron');
              const imageBuffer = typeof mostRecentItem.imageData === 'string'
                ? Buffer.from(mostRecentItem.imageData, 'base64')
                : mostRecentItem.imageData;
              const image = nativeImage.createFromBuffer(imageBuffer);
              clipboard.writeImage(image);
              await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
              console.log('[Main] Super Paste: pasted image buffer');
            }
          }
        } catch (error) {
          console.error('[Main] Super Paste: error during paste:', error);
        }
      }
    });
    console.log(`[Main] Registered super paste hotkey: ${superPasteHotkey}`);
  } catch (err) {
    console.error('[Main] Failed to register super paste hotkey:', err);
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

  // Update clipboard manager callback to include vision processing and auto-stacking.
  // This ensures ALL clipboard items (text, images, screenshots) are:
  // 1. Added to the recording stack if user is currently recording
  // 2. Processed by vision if available (images only)
  clipboardManager.setOnItemAdded((id) => {
    const item = clipboardManager!.getItem(id);
    
    // Add ALL items to recording stack if user is currently recording.
    // This enables any clipboard copy (text, images, screenshots) to participate in auto-stacking.
    if (item && transcriberManager && transcriberManager.getStatus() === 'recording') {
      transcriberManager.addToStack(id);
      console.log(`[Main] Added clipboard ${item.type} ${id} to recording stack`);
    }
    
    // Queue images for vision processing if vision processor is available.
    if (item && (item.type === 'image' || item.type === 'screenshot')) {
      if (visionProcessor) {
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

    // Set up macOS app menu with standard items (required for Cmd+H, Cmd+Q, etc.)
    if (process.platform === 'darwin') {
      const template: Electron.MenuItemConstructorOptions[] = [
        {
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { 
              label: 'Hide Field Theory',
              accelerator: 'Command+H',
              click: () => {
                app.hide();
              }
            },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        },
        {
          label: 'Edit',
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'selectAll' }
          ]
        },
        {
          label: 'Window',
          submenu: [
            { role: 'minimize' },
            { role: 'close' }
          ]
        }
      ];
      const menu = Menu.buildFromTemplate(template);
      Menu.setApplicationMenu(menu);
    }

    // Register keyboard shortcut to reset onboarding (Cmd+Shift+O).
    // Useful for testing and development.
    globalShortcut.register('Command+Shift+O', async () => {
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

    // Update tray manager with current hotkeys for menu display
    if (trayManager && clipboardManager && transcriberManager) {
      const historyHotkey = clipboardManager.getHotkeys().historyHotkey || 'Option+Space';
      const transcriptionHotkey = transcriberManager.getHotkey() || 'Option+Shift+Space';
      const screenshotHotkey = clipboardManager.getHotkeys().screenshotHotkey || 'Command+4';
      trayManager.setHotkeys(historyHotkey, transcriptionHotkey, screenshotHotkey);
    }

    // Apply Dock visibility setting.
    // Default is panel mode (hidden from Dock). This is a WIP feature.
    if (process.platform === 'darwin') {
      const showInDock = preferencesManager?.getPreference('showInDock') ?? false;
      if (showInDock) {
        await app.dock.show();
      } else {
        app.dock.hide();
      }
    }

    // Check for updates on startup and periodically (production only).
    // DEBUG: Force update check even in dev mode for testing
    {
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
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('updater:checkingForUpdate');
        }
      });
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

    autoUpdater.on('update-not-available', (info) => {
      console.log('[Updater] No update available. Current:', app.getVersion(), 'Latest:', info.version);
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
      if (app.isPackaged) {
        autoUpdater.checkForUpdates();
      } else {
        // In dev mode, simulate "up to date" response
        console.log('[Updater] Dev mode: simulating update check complete (up to date)');
        BrowserWindow.getAllWindows().forEach((window) => {
          if (!window.isDestroyed()) {
            window.webContents.send('updater:updateNotAvailable');
          }
        });
      }
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
    // Skip onboarding for existing users (those with clipboard items) - they're updating, not new.
    const prefs = preferencesManager?.get();
    if (!prefs?.onboardingComplete) {
      // Check if this is an existing user upgrading (they have clipboard history).
      const hasExistingItems = clipboardManager?.hasExistingItems() ?? false;
      
      if (hasExistingItems) {
        // Existing user - mark onboarding as complete and skip it.
        console.log('[Main] Existing user detected (has clipboard items), skipping onboarding');
        preferencesManager?.save({ onboardingComplete: true });
      } else {
        // New user - show onboarding wizard.
        console.log('[Main] New user detected, showing onboarding wizard');
        onboardingWindow = new OnboardingWindow();
        const startStep = prefs?.onboardingStep ?? OnboardingStep.WELCOME;
        onboardingWindow.show(startStep);
      }
    }
    // createWindow(); // Commented out for testing - app runs in background, opens manually

    app.on('activate', () => {
      // Always show clipboard history when app becomes active.
      // We no longer create the old main/settings window - the app is a background app
      // that primarily operates through the clipboard history window and tray.
      showClipboardHistoryOnActivate();

      // Refresh session if tokens are expiring soon to prevent auto-logout
      if (mobileSync) {
        mobileSync.refreshSessionIfNeeded().catch(err => {
          console.error('[Main] Failed to refresh session on activate:', err);
        });
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

    if (mobileSync) {
      mobileSync.destroy();
    }

    if (sharedClipboardSync) {
      sharedClipboardSync.destroy();
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