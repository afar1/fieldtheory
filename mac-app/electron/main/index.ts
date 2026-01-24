import { app, BrowserWindow, ipcMain, clipboard, screen, Display, Notification, dialog, globalShortcut, shell, Menu, systemPreferences } from 'electron';
import { autoUpdater } from 'electron-updater';
import path from 'path';
import os from 'os';
import fs from 'fs';
import crypto from 'crypto';
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
import { AuthManager } from './authManager';
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
import { ClipboardItem, isTerminalApp, isIDEWithTerminal, obscureHomePath } from './clipboardManager';
import { getHotkeyManager } from './hotkeyManager';
import {
  setApiKey as setEngineerApiKey,
  improveTranscript,
  setLocalLLMManager as setEngineerLocalLLMManager,
  setUseLocalLLM as setEngineerUseLocalLLM,
} from './promptEngineer';
import { OnboardingWindow, OnboardingStep } from './onboardingWindow';
import { OnboardingIPCChannels } from './types/onboarding';
import { TodoIPCChannels } from './types/todo';
import { CursorStatusManager, CursorStatusState } from './cursorStatusManager';
import { QuotaManager } from './quotaManager';
import { DiagnosticsCollector } from './diagnosticsCollector';
import { CommandsManager, PortableCommand } from './commandsManager';
import { CommandsIPCChannels } from './types/commands';
import { CommandLauncherWindow } from './commandLauncherWindow';
import { LocalLLMManager, LLMModelSize } from './localLLMManager';
import { LibrarianManager, Reading, ReadingMeta, WatchedDir } from './librarianManager';
import { MetricsManager, UserMetrics } from './metricsManager';
import { NarrationManager, getNarrationManager, NarrationStatus, NarrationIPCChannels, OutputDevice, NarrationPreferences, FEATURE_NARRATION_ENABLED } from './narration';

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
    '/Users/afar/dev/fieldtheory/.env.local',    // Dev: hardcoded repo root for reliability
    path.join(__dirname, '../../../.env.local'), // Dev: electron-dist/main -> repo root/.env.local
    path.join(__dirname, '../../.env.local'),    // Dev: electron-dist/main -> mac-app/.env.local
    path.join(process.cwd(), '.env.local'),      // Dev: current working directory
    path.join(process.cwd(), '../.env.local'),   // Dev: if cwd is mac-app, go to repo root
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
    'Library/Application Support/Field Theory Experimental'
  );
  app.setPath('userData', experimentalUserData);
  app.setName('Field Theory Experimental');
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
let authManager: AuthManager | null = null;
let mobileSync: MobileSync | null = null;
let localLLMManager: LocalLLMManager | null = null;
let sharedClipboardSync: SharedClipboardSync | null = null;
let socialSync: SocialSync | null = null;
let onboardingWindow: OnboardingWindow | null = null;
let cursorStatusManager: CursorStatusManager | null = null;
let quotaManager: QuotaManager | null = null;
let diagnosticsCollector: DiagnosticsCollector | null = null;
let librarianManager: LibrarianManager | null = null;
let narrationManager: NarrationManager | null = null;
let commandsManager: CommandsManager | null = null;
let commandLauncherWindow: CommandLauncherWindow | null = null;
let metricsManager: MetricsManager | null = null;

// Track pending update state so windows can query it when they open.
let pendingUpdateInfo: { status: 'available' | 'downloading' | 'ready'; version: string } | null = null;

// Track pending reading to show in immersive mode. Renderer polls for this.
let pendingImmersiveReading: string | null = null;


/**
 * Migrate data from legacy app directories to the current Field Theory location.
 * This handles users upgrading from older versions that used different names.
 * Runs once and creates a marker file to prevent re-running.
 */
function migrateFromLegacyPaths(): void {
  const newUserData = app.getPath('userData');
  const migrationMarker = path.join(newUserData, '.migration-v1-complete');

  // Skip if already migrated
  if (fs.existsSync(migrationMarker)) {
    return;
  }

  console.log('[Migration] Checking for legacy data to migrate...');

  const homeDir = app.getPath('home');
  const legacyPaths = [
    path.join(homeDir, 'Library', 'Application Support', 'littleai-mac'),
    path.join(homeDir, 'Library', 'Application Support', 'Oscar'),
  ];

  let migrated = false;

  for (const legacyPath of legacyPaths) {
    if (!fs.existsSync(legacyPath)) {
      continue;
    }

    console.log(`[Migration] Found legacy path: ${legacyPath}`);

    // Migrate figures directory
    const legacyFigures = path.join(legacyPath, 'figures');
    const newFigures = path.join(newUserData, 'figures');
    if (fs.existsSync(legacyFigures) && !fs.existsSync(newFigures)) {
      try {
        fs.renameSync(legacyFigures, newFigures);
        console.log(`[Migration] Moved figures from ${legacyFigures}`);
        migrated = true;
      } catch (err) {
        console.error(`[Migration] Failed to move figures: ${err}`);
      }
    }

    // Migrate clipboard.db
    const legacyDb = path.join(legacyPath, 'clipboard.db');
    const newDb = path.join(newUserData, 'clipboard.db');
    if (fs.existsSync(legacyDb) && !fs.existsSync(newDb)) {
      try {
        fs.copyFileSync(legacyDb, newDb);
        console.log(`[Migration] Copied clipboard.db from ${legacyDb}`);
        migrated = true;
      } catch (err) {
        console.error(`[Migration] Failed to copy clipboard.db: ${err}`);
      }
    }

    // Migrate preferences.json (for very old versions)
    const legacyPrefs = path.join(legacyPath, 'preferences.json');
    const newPrefs = path.join(newUserData, 'preferences.json');
    if (fs.existsSync(legacyPrefs) && !fs.existsSync(newPrefs)) {
      try {
        fs.copyFileSync(legacyPrefs, newPrefs);
        console.log(`[Migration] Copied preferences.json from ${legacyPrefs}`);
        migrated = true;
      } catch (err) {
        console.error(`[Migration] Failed to copy preferences.json: ${err}`);
      }
    }
  }

  // Write migration marker (even if nothing was migrated, to avoid checking every launch)
  try {
    fs.writeFileSync(migrationMarker, `Migration completed at ${new Date().toISOString()}\n`);
    if (migrated) {
      console.log('[Migration] Data migration complete');
    } else {
      console.log('[Migration] No legacy data found to migrate');
    }
  } catch (err) {
    console.error(`[Migration] Failed to write migration marker: ${err}`);
  }
}


/**
 * Register all application hotkeys.
 * Called after onboarding is complete to avoid triggering permission prompts during setup.
 */
function registerHotkeysAfterOnboarding(): void {
  if (!clipboardManager || !preferencesManager) {
    console.warn('[Main] Cannot register hotkeys: managers not initialized');
    return;
  }

  const prefs = preferencesManager.get();

  // Register clipboard hotkeys (screenshot, full screen, active window)
  clipboardManager.registerScreenshotHotkey(async () => {
    const id = await clipboardManager!.captureScreenshot({ region: true });
    if (id > 0) {
      if (transcriberManager) {
        transcriberManager.addToStack(id);
      }
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
        }
      });
      metricsManager?.recordScreenshot();
    }
  });

  clipboardManager.registerFullScreenHotkey(async () => {
    const id = await clipboardManager!.captureScreenshot({ fullScreen: true });
    if (id > 0) {
      if (transcriberManager) {
        transcriberManager.addToStack(id);
      }
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
        }
      });
      metricsManager?.recordScreenshot();
    }
  });

  clipboardManager.registerActiveWindowHotkey(async () => {
    const id = await clipboardManager!.captureScreenshot({ activeWindow: true });
    if (id > 0) {
      if (transcriberManager) {
        transcriberManager.addToStack(id);
      }
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
        }
      });
      metricsManager?.recordScreenshot();
    }
  });

  // Register history hotkey (Option+Space)
  // Uses internal isShowing() state for instant toggle - no debounce needed.
  // State updates synchronously in show()/hide() so rapid toggle works correctly.
  clipboardManager.registerHistoryHotkey(async () => {
    if (!clipboardHistoryWindow) {
      clipboardHistoryWindow = initClipboardHistoryWindow();
    }

    // Use internal state for instant toggle (avoids querying window system).
    const showing = clipboardHistoryWindow.isShowing();
    const showInDock = preferencesManager?.getPreference('showInDock') ?? false;

    if (!showing) {
      clipboardHistoryWindow.playOpenSound();
      const boundsToUse = restoreClipboardHistoryBounds();
      clipboardHistoryWindow.show(boundsToUse, false, true);
      clipboardHistoryWindow.capturePreviousAppBeforeShow();
    } else if (!showInDock) {
      // If in immersive mode, exit fullscreen instead of hiding (like pressing ESC)
      if (clipboardHistoryWindow.getImmersiveMode()) {
        clipboardHistoryWindow.sendExitFullscreen();
      } else {
        const overlayVisible = transcriberManager?.isRecordingOverlayVisible() ?? false;
        clipboardHistoryWindow.hide(!overlayVisible);
      }
    }
  });

  // Register TODO hotkey (Tasks tab toggle) - now customizable via HotkeyManager
  const hotkeyManager = getHotkeyManager();
  const todoHotkey = prefs.todoHotkey || 'Command+Shift+T';
  let lastTodoToggleAt = 0;

  hotkeyManager.register('todo', todoHotkey, async () => {
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
  });

  // Register Super Paste hotkey - now customizable via HotkeyManager
  // If there's an active stack in TranscriberManager (transcript + screenshots), paste the full stack.
  // Otherwise, paste the most recent item from clipboard history.
  const superPasteHotkey = prefs.superPasteHotkey || 'Command+Shift+V';
  let lastSuperPasteTime: number = 0;
  const SUPER_PASTE_DEBOUNCE_MS = 500; // Ignore rapid triggers within 500ms

  hotkeyManager.register('superPaste', superPasteHotkey, async () => {
      // Debounce: ignore if triggered too recently (handles key repeat / multiple triggers)
      const now = Date.now();
      if (now - lastSuperPasteTime < SUPER_PASTE_DEBOUNCE_MS) {
        return;
      }
      lastSuperPasteTime = now;

      if (!clipboardManager) {
        console.error('[Main] Super Paste: clipboardManager not available');
        return;
      }

      // Get most recent item from clipboard history
      const stmt = clipboardManager['db'].prepare('SELECT id FROM clipboard_items ORDER BY created_at DESC LIMIT 1');
      const row = stmt.get() as { id: number } | undefined;

      if (!row) return;

      const mostRecentItem = clipboardManager.getItem(row.id);
      if (!mostRecentItem) return;

      // Check if this item belongs to a stack - if so, paste the whole stack
      let itemsToPaste: typeof mostRecentItem[] = [mostRecentItem];

      if (mostRecentItem.stackId) {
        const stackItems = clipboardManager.queryItemsByStackId(mostRecentItem.stackId);
        if (stackItems.length > 1) {
          itemsToPaste = stackItems;
        }
      }

      // Get frontmost app info
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);

      let bundleId = '';
      let isTerminal = false;
      try {
        const script = `
          tell application "System Events"
            set frontApp to first application process whose frontmost is true
            return (bundle identifier of frontApp)
          end tell
        `;
        const { stdout } = await execAsync(`osascript -e '${script}'`);
        bundleId = stdout.trim();

        // If frontmost app is Field Theory itself, use the previous app instead
        // This handles cases where super paste is triggered while Field Theory UI is visible
        const isFieldTheory = bundleId === 'com.fieldtheory.app' ||
                              bundleId === 'com.fieldtheory.experimental' ||
                              bundleId === 'com.github.Electron'; // Dev mode
        if (isFieldTheory && clipboardHistoryWindow) {
          const previousApp = clipboardHistoryWindow.getPreviousApp();
          if (previousApp?.bundleId) {
            bundleId = previousApp.bundleId;
          }
        }

        const { isTerminalApp } = require('./clipboardManager');
        isTerminal = isTerminalApp(bundleId);
      } catch (e) {
        console.error('[Main] Super Paste: failed to get frontmost app:', e);
      }

      try {
        // If Field Theory is visible, hide it to restore previous focus state
        // Don't use activate - it brings ALL windows of the target app to front
        // Instead, hiding our window lets macOS naturally restore the previously focused window
        if (clipboardHistoryWindow?.isVisible()) {
          clipboardHistoryWindow.hide();
          // Wait for macOS to restore focus to the previous window
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        // For terminals with stacks, combine text with image paths
        if (isTerminal && itemsToPaste.length > 1) {
          // Find text/transcript items and image items
          const textItems = itemsToPaste.filter(i => i.type === 'text' || i.type === 'transcript');
          const imageItems = itemsToPaste.filter(i => i.imageData);

          // Build combined text with figure paths
          let combinedText = '';
          for (const item of textItems) {
            if (item.content) {
              combinedText += item.content + '\n';
            }
          }

          // Add figure paths for images
          if (imageItems.length > 0) {
            combinedText += '\nFigures:\n';
            for (const item of imageItems) {
              const imagePath = await clipboardManager.exportImageToCache(item);
              if (imagePath) {
                const label = item.figureLabel || '';
                combinedText += `[Figure ${label}] ${imagePath}\n`;
              }
            }
          }

          clipboard.writeText(combinedText.trim());
          await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');

        } else {
          // Paste items sequentially
          for (const item of itemsToPaste) {
            if (item.type === 'text' || item.type === 'transcript') {
              clipboard.writeText(item.content || '');
              await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
            } else if (item.type === 'image' || item.type === 'screenshot' || item.imageData) {
              if (!item.imageData) continue;
              if (isTerminal) {
                const imagePath = await clipboardManager.exportImageToCache(item);
                if (imagePath) {
                  clipboard.writeText(imagePath);
                  await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
                }
              } else {
                const { nativeImage } = require('electron');
                const imageBuffer = typeof item.imageData === 'string'
                  ? Buffer.from(item.imageData, 'base64')
                  : item.imageData;
                const image = nativeImage.createFromBuffer(imageBuffer);
                if (image.isEmpty()) continue;
                clipboard.writeImage(image);
                clipboardManager.syncClipboardHash();
                await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');
              }
            }
            // Small delay between items
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }

      } catch (error) {
        console.error('[Main] Super Paste: error during paste:', error);
      }
  });

  // Register Auto-improve toggle hotkey - now customizable via HotkeyManager
  const autoImproveHotkey = prefs.autoImproveHotkey || 'Command+Shift+\\';
  hotkeyManager.register('autoImprove', autoImproveHotkey, async () => {
    if (!transcriberManager) {
      console.error('[Main] Auto-improve toggle: transcriberManager not available');
      return;
    }

    const currentState = transcriberManager.getAutoImprove();
    const newState = !currentState;
    await transcriberManager.setAutoImprove(newState);

    // Refresh tray menu to show updated state
    if (trayManager) {
      trayManager.refreshMenu();
    }

    // Show cursor notification of the new state
    if (cursorStatusManager) {
      cursorStatusManager.showRecordingNote(
        newState ? 'Auto-improve enabled' : 'Auto-improve disabled'
      );
    }
  });

  // Register Command Launcher hotkey - now customizable via HotkeyManager
  // Simple toggle: open or close the command launcher
  const commandLauncherHotkey = prefs.commandLauncherHotkey || 'Command+Shift+K';
  hotkeyManager.register('commandLauncher', commandLauncherHotkey, async () => {
      const launcherVisible = commandLauncherWindow?.isVisible() ?? false;

      if (launcherVisible) {
        // Command launcher is visible → close it
        commandLauncherWindow?.hide();
      } else {
        // Command launcher not visible → open it
        if (commandLauncherWindow) {
          // If immersive view is open, dismiss it first to avoid z-order conflicts
          if (clipboardHistoryWindow?.getImmersiveMode()) {
            console.log('[Main] Dismissing immersive view before showing command launcher');
            clipboardHistoryWindow.hide();
          }
          await commandLauncherWindow.show();
          metricsManager?.recordCommandLauncherUse();
        }
      }
  });

  // Register Improve Text hotkey - now customizable via HotkeyManager
  const improveTextHotkey = prefs.improveTextHotkey || 'Command+Shift+I';
  hotkeyManager.register('improveText', improveTextHotkey, async () => {
    await handleImproveSelectedText();
  });
}

/**
 * Handle Cmd+Shift+I to improve selected text.
 * 
 * Flow:
 * 1. Simulate Cmd+C to copy selected text (selection stays highlighted)
 * 2. If nothing selected, abort silently
 * 3. Show blue dot (improving state)
 * 4. Call improveTranscript API
 * 5. Paste improved text (replaces selection)
 * 6. Show green dot (done state)
 */
async function handleImproveSelectedText(): Promise<void> {
  const { exec } = require('child_process');
  const { promisify } = require('util');
  const execAsync = promisify(exec);

  try {
    // Simulate Cmd+C to copy selected text. The selection stays highlighted
    // so when we paste, it will replace the selected text.
    await execAsync('osascript -e \'tell application "System Events" to keystroke "c" using command down\'');
    await new Promise(resolve => setTimeout(resolve, 100));

    // Read clipboard to get the selected text.
    const selectedText = clipboard.readText();

    // If nothing selected, abort silently.
    if (!selectedText || selectedText.trim().length === 0) {
      console.log('[ImproveText] No text selected, aborting');
      return;
    }

    // Show blue dot (improving state).
    cursorStatusManager?.setState('improving');

    // Get API key.
    const apiKey = preferencesManager?.getApiKey();
    if (!apiKey) {
      console.error('[ImproveText] No API key configured');
      cursorStatusManager?.setState('idle');
      return;
    }

    // Call improve API.
    setEngineerApiKey(apiKey);
    const result = await improveTranscript(selectedText);

    if (!result.success || !result.refinedPrompt) {
      console.error('[ImproveText] Improvement failed:', result.error);
      cursorStatusManager?.setState('idle');
      return;
    }

    // Paste improved text. Since the original text is still selected,
    // this will replace it with the improved version.
    clipboard.writeText(result.refinedPrompt);
    clipboardManager?.syncClipboardHash();
    await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');

    // Show done state briefly.
    cursorStatusManager?.setState('done');

    // Track quota usage (count input words).
    const inputWordCount = selectedText.trim().split(/\s+/).filter(w => w.length > 0).length;
    await quotaManager?.incrementTextImprove(inputWordCount);

    // Track auto-improve usage stats (only for API calls with usage data)
    if (result.usage && preferencesManager) {
      const currentPrefs = preferencesManager.get();
      const currentStats = currentPrefs.autoImproveStats || {
        wordsImproved: 0,
        apiCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      await preferencesManager.save({
        autoImproveStats: {
          wordsImproved: currentStats.wordsImproved + (result.wordCount || inputWordCount),
          apiCalls: currentStats.apiCalls + 1,
          inputTokens: currentStats.inputTokens + result.usage.inputTokens,
          outputTokens: currentStats.outputTokens + result.usage.outputTokens,
        },
      });
    }

    console.log('[ImproveText] Text improved and pasted successfully');
  } catch (error) {
    console.error('[ImproveText] Error:', error);
    cursorStatusManager?.setState('idle');
  }
}

/**
 * Create and initialize an OnboardingWindow instance.
 * Ensures the window has access to preferencesManager for proper close handling.
 */
function createOnboardingWindow(): OnboardingWindow {
  const window = new OnboardingWindow();
  if (preferencesManager) {
    window.setPreferencesManager(preferencesManager);
  }
  return window;
}

/**
 * Create the main application window.
 */
function createWindow(): void {
  // Determine the preload script path.
  // In both dev and production, use the compiled .js file
  const preloadPath = path.join(__dirname, '../preload.js');

  // Load saved window state from preferences
  const savedState = preferencesManager?.get().windowState;
  const showInDock = preferencesManager?.getPreference('showInDock') ?? false;
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
    skipTaskbar: !showInDock, // Don't show in Dock when in panel mode
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

  // Wire up native helper for fast sound playback if available.
  if (nativeHelper) {
    window.getSoundManager().setNativeHelper(nativeHelper);
  }

  // Wire up resume-after-close setting getter for immersive mode
  window.setResumeAfterCloseGetter(() => {
    return librarianManager?.isResumeAfterCloseEnabled() ?? false;
  });

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
  // Don't show settings if onboarding is not complete.
  const prefs = preferencesManager?.get();
  if (!prefs?.onboardingComplete) {
    return;
  }

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
  console.log('[Main] showClipboardHistoryOnActivate called');

  // Don't show clipboard history if onboarding is not complete.
  const prefs = preferencesManager?.get();
  if (!prefs?.onboardingComplete) {
    console.log('[Main] showClipboardHistoryOnActivate: blocked (onboarding incomplete)');
    return;
  }

  // Don't show clipboard history if the command launcher is visible OR showing.
  // Using isShowingOrVisible() closes the TOCTTOU race window during async show().
  if (commandLauncherWindow?.isShowingOrVisible()) {
    console.log('[Main] showClipboardHistoryOnActivate: blocked (command launcher showing/visible)');
    return;
  }

  if (!clipboardHistoryWindow) {
    clipboardHistoryWindow = initClipboardHistoryWindow();
  }

  // If clipboard history is already visible (e.g., immersive mode), don't call show().
  // Calling show() triggers moveTop() which would steal focus from other windows.
  if (clipboardHistoryWindow.isVisible()) {
    console.log('[Main] showClipboardHistoryOnActivate: blocked (clipboard already visible)');
    return;
  }

  console.log('[Main] showClipboardHistoryOnActivate: showing clipboard window');
  // Show the clipboard window when app is activated (e.g., Dock icon click).
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
 * Set up IPC handlers for theme synchronization across windows.
 */
function setupThemeIPCHandlers(): void {
  // Get current theme preference
  ipcMain.handle('theme:get', () => {
    return preferencesManager?.getPreference('darkMode') ?? false;
  });

  // Set theme preference and broadcast to all windows
  ipcMain.handle('theme:set', async (_event, isDark: boolean) => {
    if (preferencesManager) {
      await preferencesManager.save({ darkMode: isDark });
    }

    // Broadcast to all windows
    const allWindows = BrowserWindow.getAllWindows();
    for (const win of allWindows) {
      win.webContents.send('theme:changed', isDark);
    }
  });
}

/**
 * Set up IPC handlers for Librarian (reading collection) functionality.
 */
function setupLibrarianIPCHandlers(): void {
  // Get all readings (metadata only, for sidebar)
  ipcMain.handle('librarian:getReadings', (): ReadingMeta[] => {
    if (!librarianManager) {
      return [];
    }
    return librarianManager.getReadings();
  });

  // Get a single reading with full content (by path)
  ipcMain.handle('librarian:getReading', (_event, filePath: string): Reading | null => {
    if (!librarianManager) {
      return null;
    }
    return librarianManager.getReading(filePath);
  });

  // Save reading content to disk
  ipcMain.handle('librarian:saveReading', (_event, filePath: string, content: string): boolean => {
    if (!librarianManager) {
      return false;
    }
    return librarianManager.saveReading(filePath, content);
  });

  // Delete a reading file
  ipcMain.handle('librarian:deleteReading', (_event, filePath: string): boolean => {
    if (!librarianManager) {
      return false;
    }
    return librarianManager.deleteReading(filePath);
  });

  // Get all watched directories
  ipcMain.handle('librarian:getWatchedDirs', (): WatchedDir[] => {
    if (!librarianManager) {
      return [];
    }
    return librarianManager.getWatchedDirs();
  });

  // Add a watched directory
  ipcMain.handle('librarian:addWatchedDir', (_event, dirPath: string): WatchedDir | null => {
    if (!librarianManager) {
      return null;
    }
    return librarianManager.addWatchedDir(dirPath);
  });

  // Remove a watched directory (by path)
  ipcMain.handle('librarian:removeWatchedDir', (_event, dirPath: string): boolean => {
    if (!librarianManager) {
      return false;
    }
    return librarianManager.removeWatchedDir(dirPath);
  });

  // Browse for a directory (open folder picker)
  ipcMain.handle('librarian:browseDirectory', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select a directory to watch for readings',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  // ===========================================================================
  // New Settings API (v2)
  // ===========================================================================

  // Check if Librarian is enabled
  ipcMain.handle('librarian:isEnabled', (): boolean => {
    return librarianManager?.isEnabled() ?? false;
  });

  // Enable or disable Librarian
  ipcMain.handle('librarian:setEnabled', (_event, enabled: boolean): boolean => {
    return librarianManager?.setEnabled(enabled) ?? false;
  });

  // Check if setup wizard is complete
  ipcMain.handle('librarian:isSetupComplete', (): boolean => {
    return librarianManager?.isSetupComplete() ?? false;
  });

  // Mark setup wizard as complete
  ipcMain.handle('librarian:setSetupComplete', (_event, complete: boolean): void => {
    librarianManager?.setSetupComplete(complete);
  });

  // Create welcome artifact for setup wizard
  ipcMain.handle('librarian:createWelcomeArtifact', (_event, dirPath: string): boolean => {
    return librarianManager?.createWelcomeArtifact(dirPath) ?? false;
  });

  // ===========================================================================
  // State-Enforced Mode API
  // ===========================================================================

  // Get state-enforced mode threshold
  ipcMain.handle('librarian:getStateEnforcedThreshold', (): number => {
    return librarianManager?.getStateEnforcedThreshold() ?? 3;
  });

  // Set state-enforced mode threshold
  ipcMain.handle('librarian:setStateEnforcedThreshold', (_event, threshold: number): boolean => {
    return librarianManager?.setStateEnforcedThreshold(threshold) ?? false;
  });

  // Get default rule content
  ipcMain.handle('librarian:getDefaultRuleContent', (): string => {
    return librarianManager?.getDefaultRuleContent() ?? '';
  });

  // Get custom rule content
  ipcMain.handle('librarian:getCustomRuleContent', (): string | undefined => {
    return librarianManager?.getCustomRuleContent();
  });

  // Set custom rule content
  ipcMain.handle('librarian:setCustomRuleContent', (_event, content: string | undefined): boolean => {
    return librarianManager?.setCustomRuleContent(content) ?? false;
  });

  // Install global state-enforced hook
  ipcMain.handle('librarian:installStateEnforcedHook', (): boolean => {
    return librarianManager?.installStateEnforcedHook() ?? false;
  });

  // Uninstall global state-enforced hook
  ipcMain.handle('librarian:uninstallStateEnforcedHook', (): boolean => {
    return librarianManager?.uninstallStateEnforcedHook() ?? false;
  });

  // Check if global state-enforced hook is installed
  ipcMain.handle('librarian:isStateEnforcedHookInstalled', (): boolean => {
    return librarianManager?.isStateEnforcedHookInstalled() ?? false;
  });

  // Get count of pending jobs (from central directory)
  ipcMain.handle('librarian:getPendingJobCount', (): number => {
    return librarianManager?.getPendingJobCount() ?? 0;
  });

  // ===========================================================================
  // Discovery Frequency API
  // ===========================================================================

  // Get discovery frequency
  ipcMain.handle('librarian:getDiscoveryFrequency', (): string => {
    return librarianManager?.getDiscoveryFrequency() ?? 'sometimes';
  });

  // Set discovery frequency
  ipcMain.handle('librarian:setDiscoveryFrequency', (_event, frequency: string): boolean => {
    if (librarianManager && (frequency === 'often' || frequency === 'sometimes' || frequency === 'rarely')) {
      return librarianManager.setDiscoveryFrequency(frequency);
    }
    return false;
  });

  // ===========================================================================
  // User Expertise API
  // ===========================================================================

  // Get user expertise context
  ipcMain.handle('librarian:getUserExpertiseContext', (): string | undefined => {
    return librarianManager?.getUserExpertiseContext();
  });

  // Set user expertise context
  ipcMain.handle('librarian:setUserExpertiseContext', (_event, context: string | undefined): boolean => {
    return librarianManager?.setUserExpertiseContext(context) ?? false;
  });

  // Get expertise insert mode (admin-only setting)
  ipcMain.handle('librarian:getExpertiseInsertMode', (): string => {
    return librarianManager?.getExpertiseInsertMode() ?? 'append';
  });

  // Set expertise insert mode (admin-only)
  ipcMain.handle('librarian:setExpertiseInsertMode', (_event, mode: string): boolean => {
    if (librarianManager && (mode === 'insert' || mode === 'append')) {
      return librarianManager.setExpertiseInsertMode(mode);
    }
    return false;
  });

  // ===========================================================================
  // Legacy Settings API (kept for backward compatibility)
  // ===========================================================================

  // Get auto-run frequency setting (deprecated)
  ipcMain.handle('librarian:getAutoRunFrequency', (): string => {
    return librarianManager?.getAutoRunFrequency() || 'off';
  });

  // Set auto-run frequency setting (deprecated)
  ipcMain.handle('librarian:setAutoRunFrequency', (_event, frequency: string): boolean => {
    if (librarianManager && (frequency === 'off' || frequency === 'occasionally' || frequency === 'regularly' || frequency === 'frequently' || frequency === 'always')) {
      return librarianManager.setAutoRunFrequency(frequency);
    }
    return false;
  });

  // Force re-sync CLAUDE.md with current settings
  ipcMain.handle('librarian:resyncClaudeMd', (): boolean => {
    return librarianManager?.resyncClaudeMd() ?? false;
  });

  // Get Claude Code installation status
  ipcMain.handle('librarian:getClaudeCodeStatus', (): string => {
    return librarianManager?.getClaudeCodeStatus() ?? 'not-installed';
  });

  // Install Claude Code hook for automatic Librarian reminders
  ipcMain.handle('librarian:installClaudeCodeHook', (): boolean => {
    return librarianManager?.installClaudeCodeHook() ?? false;
  });

  // Uninstall Claude Code hook
  ipcMain.handle('librarian:uninstallClaudeCodeHook', (): boolean => {
    return librarianManager?.uninstallClaudeCodeHook() ?? false;
  });

  // Check if Claude Code hook is installed
  ipcMain.handle('librarian:isClaudeCodeHookInstalled', (): boolean => {
    return librarianManager?.isClaudeCodeHookInstalled() ?? false;
  });

  // Initialize project status for hook system
  ipcMain.handle('librarian:initializeProjectStatus', (_event, projectPath: string): void => {
    librarianManager?.initializeProjectStatus(projectPath);
  });

  // Get Cursor instructions text
  ipcMain.handle('librarian:getCursorInstructions', (): string => {
    return librarianManager?.getCursorInstructions() || '';
  });

  // Get configuration file paths
  ipcMain.handle('librarian:getConfigPaths', (): { claudeMd: string; librarianCommand: string } => {
    return {
      claudeMd: path.join(os.homedir(), '.claude', 'CLAUDE.md'),
      librarianCommand: path.join(os.homedir(), '.fieldtheory', 'commands', 'librarian.md'),
    };
  });

  // Open a file in the default editor
  ipcMain.handle('librarian:openInEditor', async (_event, filePath: string): Promise<boolean> => {
    try {
      await shell.openPath(filePath);
      return true;
    } catch (error) {
      console.error('[Librarian] Failed to open file:', error);
      return false;
    }
  });

  // Read a config file's contents
  ipcMain.handle('librarian:readConfigFile', (_event, filePath: string): string | null => {
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf-8');
      }
      return null;
    } catch (error) {
      console.error('[Librarian] Failed to read file:', error);
      return null;
    }
  });

  // Write a config file's contents
  ipcMain.handle('librarian:writeConfigFile', (_event, filePath: string, content: string): boolean => {
    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, content);
      console.log(`[Librarian] Wrote config file: ${filePath}`);
      return true;
    } catch (error) {
      console.error('[Librarian] Failed to write file:', error);
      return false;
    }
  });

  // Get auto-show setting
  ipcMain.handle('librarian:getAutoShowEnabled', (): boolean => {
    return librarianManager?.isAutoShowEnabled() ?? true;
  });

  // Set auto-show setting
  ipcMain.handle('librarian:setAutoShowEnabled', (_event, enabled: boolean): void => {
    librarianManager?.setAutoShowEnabled(enabled);
  });

  // Get resume after close setting
  ipcMain.handle('librarian:getResumeAfterClose', (): boolean => {
    return librarianManager?.isResumeAfterCloseEnabled() ?? false;
  });

  // Set resume after close setting
  ipcMain.handle('librarian:setResumeAfterClose', (_event, enabled: boolean): void => {
    librarianManager?.setResumeAfterClose(enabled);
  });

  // Get Claude config file path
  ipcMain.handle('librarian:getClaudeConfigPath', (): string => {
    const os = require('os');
    const path = require('path');
    return path.join(os.homedir(), '.claude', 'CLAUDE.md');
  });

  // Get default content guidance
  ipcMain.handle('librarian:getDefaultContentGuidance', (): string => {
    return librarianManager?.getDefaultContentGuidance() || '';
  });

  // Get current content guidance (custom or default)
  ipcMain.handle('librarian:getContentGuidance', (): string => {
    return librarianManager?.getContentGuidance() || '';
  });

  // Get custom content guidance (undefined if using default)
  ipcMain.handle('librarian:getCustomContentGuidance', (): string | undefined => {
    return librarianManager?.getCustomContentGuidance();
  });

  // Set custom content guidance (pass empty string or undefined to reset to default)
  ipcMain.handle('librarian:setCustomContentGuidance', (_event, guidance: string | undefined): boolean => {
    return librarianManager?.setCustomContentGuidance(guidance) ?? false;
  });

  // Reset content guidance to default
  ipcMain.handle('librarian:resetContentGuidance', (): boolean => {
    return librarianManager?.resetContentGuidance() ?? false;
  });

  // Discover existing .librarian directories that are not yet watched
  ipcMain.handle('librarian:discoverLibrarianDirs', async (): Promise<string[]> => {
    return librarianManager?.discoverLibrarianDirs() ?? [];
  });

  // Reset edit counters for all projects (for debugging/testing)
  ipcMain.handle('librarian:resetAllCounters', (): boolean => {
    return librarianManager?.resetAllCounters() ?? false;
  });

  // Get edit status for debugging
  ipcMain.handle('librarian:getEditStatus', (): { edits: number; threshold: number } | null => {
    return librarianManager?.getEditStatus() ?? null;
  });

  // Get custom threshold (undefined if using frequency-based)
  ipcMain.handle('librarian:getCustomThreshold', (): number | undefined => {
    return librarianManager?.getCustomThreshold();
  });

  // Set custom threshold (pass undefined to return to frequency-based)
  ipcMain.handle('librarian:setCustomThreshold', (_event, threshold: number | undefined): boolean => {
    return librarianManager?.setCustomThreshold(threshold) ?? false;
  });

  // Poll for pending artifact and counter state.
  // Renderer calls this on mount/interval for UI display.
  // Counter resets are handled by reading-added event, not here.
  ipcMain.handle('librarian:pollStatus', (): {
    pendingPath: string | null;
    edits: number;
    threshold: number;
    didReset: boolean;
  } => {
    // Get current counter state (no reset logic here)
    const status = librarianManager?.checkAndResetIfNeeded() ?? { edits: 0, threshold: 5, didReset: false };

    // Get and clear pending immersive reading
    const p = pendingImmersiveReading;
    if (p) {
      console.log(`[Librarian] pollStatus returning pending: ${p}`);
    }
    pendingImmersiveReading = null;

    return {
      pendingPath: p,
      edits: status.edits,
      threshold: status.threshold,
      didReset: status.didReset,
    };
  });

  // ===========================================================================
  // Public Sharing
  // ===========================================================================

  // Share a reading publicly
  ipcMain.handle('librarian:shareReading', async (_event, filePath: string): Promise<{ slug: string; url: string } | null> => {
    if (!authManager?.isAuthenticated()) {
      console.log('[Librarian] Share failed: not authenticated');
      return null;
    }

    const reading = librarianManager?.getReading(filePath);
    if (!reading) {
      console.log('[Librarian] Share failed: reading not found');
      return null;
    }

    const supabase = authManager.getSupabaseClient();
    const session = authManager.getSession();
    if (!supabase || !session?.user?.id) {
      console.log('[Librarian] Share failed: no supabase client or session');
      return null;
    }

    // Get author name from profile (first + last for "First L." format)
    let authorName: string | null = null;
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', session.user.id)
        .single();
      if (profile?.first_name && profile?.last_name) {
        authorName = `${profile.first_name} ${profile.last_name}`;
      } else if (profile?.first_name) {
        authorName = profile.first_name;
      }
    } catch {
      // Ignore profile fetch errors
    }

    // Check if this reading was previously shared (re-sharing)
    const { data: existing } = await supabase
      .from('shared_readings')
      .select('slug, is_public')
      .eq('source_path', filePath)
      .eq('user_id', session.user.id)
      .single();

    if (existing) {
      // Re-enable existing share
      if (!existing.is_public) {
        await supabase
          .from('shared_readings')
          .update({ is_public: true, content: reading.content, title: reading.title, author_name: authorName })
          .eq('source_path', filePath)
          .eq('user_id', session.user.id);
      }
      console.log('[Librarian] Reading re-shared:', existing.slug);
      return {
        slug: existing.slug,
        url: `https://librarian.fieldtheory.dev/${existing.slug}`,
      };
    }

    // Generate slug: title-abc123
    const slugify = (text: string): string =>
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 50);

    const baseSlug = slugify(reading.title);

    // Try up to 3 times with different random suffixes
    for (let attempt = 0; attempt < 3; attempt++) {
      const randomSuffix = crypto.randomBytes(3).toString('hex');
      const slug = `${baseSlug}-${randomSuffix}`;

      const { data, error } = await supabase
        .from('shared_readings')
        .insert({
          user_id: session.user.id,
          slug,
          title: reading.title,
          content: reading.content,
          author_name: authorName,
          source_path: filePath,
          is_public: true,
        })
        .select('slug')
        .single();

      if (!error && data) {
        console.log('[Librarian] Reading shared:', slug);
        metricsManager?.recordLibrarianArtifactShared();
        return {
          slug: data.slug,
          url: `https://librarian.fieldtheory.dev/${data.slug}`,
        };
      }

      // If unique constraint violation, try again with new suffix
      if (error?.code === '23505') {
        console.log('[Librarian] Slug collision, retrying...');
        continue;
      }

      console.error('[Librarian] Share failed:', error);
      return null;
    }

    console.error('[Librarian] Share failed: max retries exceeded');
    return null;
  });

  // Unshare a reading (soft delete)
  ipcMain.handle('librarian:unshareReading', async (_event, filePath: string): Promise<boolean> => {
    if (!authManager?.isAuthenticated()) return false;

    const supabase = authManager.getSupabaseClient();
    const session = authManager.getSession();
    if (!supabase || !session?.user?.id) return false;

    const { error } = await supabase
      .from('shared_readings')
      .update({ is_public: false })
      .eq('source_path', filePath)
      .eq('user_id', session.user.id);

    if (error) {
      console.error('[Librarian] Unshare failed:', error);
      return false;
    }

    console.log('[Librarian] Reading unshared:', filePath);
    return true;
  });

  // Check if a reading is shared
  ipcMain.handle('librarian:getShareStatus', async (_event, filePath: string): Promise<{ shared: boolean; slug?: string; url?: string } | null> => {
    if (!authManager?.isAuthenticated()) return null;

    const supabase = authManager.getSupabaseClient();
    const session = authManager.getSession();
    if (!supabase || !session?.user?.id) return null;

    const { data, error } = await supabase
      .from('shared_readings')
      .select('slug, is_public')
      .eq('source_path', filePath)
      .eq('user_id', session.user.id)
      .single();

    if (error || !data) {
      return { shared: false };
    }

    if (!data.is_public) {
      return { shared: false };
    }

    return {
      shared: true,
      slug: data.slug,
      url: `https://librarian.fieldtheory.dev/${data.slug}`,
    };
  });

  // Update a shared reading's content
  ipcMain.handle('librarian:updateSharedReading', async (_event, filePath: string, content: string, title: string): Promise<boolean> => {
    if (!authManager?.isAuthenticated()) return false;

    const supabase = authManager.getSupabaseClient();
    const session = authManager.getSession();
    if (!supabase || !session?.user?.id) return false;

    // Get author name from profile
    let authorName: string | null = null;
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('first_name, last_name')
        .eq('id', session.user.id)
        .single();
      if (profile?.first_name && profile?.last_name) {
        authorName = `${profile.first_name} ${profile.last_name}`;
      } else if (profile?.first_name) {
        authorName = profile.first_name;
      }
    } catch {
      // Ignore profile fetch errors
    }

    const { error } = await supabase
      .from('shared_readings')
      .update({ content, title, author_name: authorName, updated_at: new Date().toISOString() })
      .eq('source_path', filePath)
      .eq('user_id', session.user.id)
      .eq('is_public', true);

    if (error) {
      console.error('[Librarian] Update shared reading failed:', error);
      return false;
    }

    console.log('[Librarian] Shared reading updated:', filePath);
    return true;
  });

  // ===========================================================================
  // Claude IPC handlers - Claude Code integration settings
  // ===========================================================================

  // Check if screenshot permission is enabled
  ipcMain.handle('claude:isScreenshotPermissionEnabled', (): boolean => {
    return librarianManager?.isScreenshotPermissionEnabled() ?? false;
  });

  // Enable screenshot permission
  ipcMain.handle('claude:enableScreenshotPermission', (): boolean => {
    return librarianManager?.enableScreenshotPermission() ?? false;
  });

  // Get figures directory path for permissions
  ipcMain.handle('claude:getFiguresPath', (): string => {
    return path.join(app.getPath('userData'), 'figures');
  });

  // Get available permission profiles
  ipcMain.handle('claude:getAvailableProfiles', (): Array<{ id: string; name: string; description: string; permissionCount: number; permissions: string[] }> => {
    return librarianManager?.getAvailableProfiles() ?? [];
  });

  // Get current permission status
  ipcMain.handle('claude:getPermissionStatus', (): { currentProfile: string | null; managedPermissions: string[]; allClaudePermissions: string[] } => {
    return librarianManager?.getPermissionStatus() ?? { currentProfile: null, managedPermissions: [], allClaudePermissions: [] };
  });

  // Apply a permission profile
  ipcMain.handle('claude:applyPermissionProfile', (_event, profileId: string): boolean => {
    return librarianManager?.applyPermissionProfile(profileId) ?? false;
  });

  // Add individual permissions
  ipcMain.handle('claude:addPermissions', (_event, permissions: string[]): boolean => {
    return librarianManager?.addPermissions(permissions) ?? false;
  });

  // Remove individual permissions
  ipcMain.handle('claude:removePermissions', (_event, permissions: string[]): boolean => {
    return librarianManager?.removePermissions(permissions) ?? false;
  });

  // Clear all managed permissions
  ipcMain.handle('claude:clearManagedPermissions', (): boolean => {
    return librarianManager?.clearManagedPermissions() ?? false;
  });

  // ===========================================================================
  // Narration IPC handlers - Local, offline TTS for the Librarian
  // ===========================================================================

  // Get narration status (installation, playback, cache)
  ipcMain.handle(NarrationIPCChannels.GET_STATUS, (): NarrationStatus | null => {
    return narrationManager?.getStatus() ?? null;
  });

  // Install narration capability (verifies macOS say is available)
  ipcMain.handle(NarrationIPCChannels.INSTALL, async (): Promise<boolean> => {
    return narrationManager?.install() ?? false;
  });

  // Play a reading aloud
  ipcMain.handle(NarrationIPCChannels.PLAY_READING, async (_event, readingPath: string): Promise<boolean> => {
    if (!narrationManager || !librarianManager) return false;

    try {
      const reading = librarianManager.getReading(readingPath);
      if (!reading) {
        console.warn(`[Narration] Reading not found: ${readingPath}`);
        return false;
      }

      await narrationManager.playReading(readingPath, reading.content);
      return true;
    } catch (error) {
      console.error('[Narration] Play reading failed:', error);
      return false;
    }
  });

  // Stop playback
  ipcMain.handle(NarrationIPCChannels.STOP, (): void => {
    narrationManager?.stop();
  });

  // Pause playback
  ipcMain.handle(NarrationIPCChannels.PAUSE, (): boolean => {
    return narrationManager?.pause() ?? false;
  });

  // Resume playback
  ipcMain.handle(NarrationIPCChannels.RESUME, (): boolean => {
    return narrationManager?.resume() ?? false;
  });

  // Toggle pause/play
  ipcMain.handle(NarrationIPCChannels.TOGGLE_PAUSE, (): boolean => {
    return narrationManager?.togglePause() ?? false;
  });

  // Get playback progress
  ipcMain.handle(NarrationIPCChannels.GET_PLAYBACK_PROGRESS, (): { position: number; duration: number; percentage: number } | null => {
    return narrationManager?.getPlaybackProgress() ?? null;
  });

  // Get current output device
  ipcMain.handle(NarrationIPCChannels.GET_OUTPUT_DEVICE, async (): Promise<OutputDevice | null> => {
    return narrationManager?.getCurrentOutputDevice() ?? null;
  });

  // Refresh device detection
  ipcMain.handle(NarrationIPCChannels.REFRESH_DEVICES, async (): Promise<OutputDevice | null> => {
    return narrationManager?.refreshDevices() ?? null;
  });

  // Get narration preferences
  ipcMain.handle(NarrationIPCChannels.GET_PREFS, (): NarrationPreferences | null => {
    return narrationManager?.getPrefs() ?? null;
  });

  // Set speak-on-open preference
  ipcMain.handle(NarrationIPCChannels.SET_SPEAK_ON_OPEN, async (_event, enabled: boolean): Promise<void> => {
    await narrationManager?.setSpeakOnOpen(enabled);
  });

  // Add blocked device pattern
  ipcMain.handle(NarrationIPCChannels.ADD_BLOCKED_DEVICE, async (_event, pattern: string): Promise<void> => {
    await narrationManager?.addBlockedDevice(pattern);
  });

  // Remove blocked device pattern
  ipcMain.handle(NarrationIPCChannels.REMOVE_BLOCKED_DEVICE, async (_event, pattern: string): Promise<void> => {
    await narrationManager?.removeBlockedDevice(pattern);
  });

  // Clear narration cache
  ipcMain.handle(NarrationIPCChannels.CLEAR_CACHE, async (): Promise<void> => {
    await narrationManager?.clearCache();
  });

  // Install Chatterbox TTS engine
  ipcMain.handle(NarrationIPCChannels.INSTALL_CHATTERBOX, async (): Promise<boolean> => {
    return narrationManager?.installChatterbox() ?? false;
  });

  // Get Chatterbox installation status
  ipcMain.handle(NarrationIPCChannels.GET_CHATTERBOX_STATUS, () => {
    return narrationManager?.getChatterboxStatus() ?? null;
  });

  // Test Chatterbox voice
  ipcMain.handle(NarrationIPCChannels.TEST_CHATTERBOX_VOICE, async (): Promise<boolean> => {
    try {
      await narrationManager?.testChatterboxVoice();
      return true;
    } catch (error) {
      console.error('[Narration] Test voice failed:', error);
      return false;
    }
  });

  // Test macOS Say voice
  ipcMain.handle(NarrationIPCChannels.TEST_MACOS_VOICE, async (): Promise<boolean> => {
    try {
      await narrationManager?.testMacOSVoice();
      return true;
    } catch (error) {
      console.error('[Narration] Test macOS voice failed:', error);
      return false;
    }
  });

  // Set preferred narration engine
  ipcMain.handle(NarrationIPCChannels.SET_PREFERRED_ENGINE, async (_event, engine: 'chatterbox' | 'macos_say' | 'elevenlabs'): Promise<boolean> => {
    try {
      await narrationManager?.setPreferredEngine(engine);
      return true;
    } catch (error) {
      console.error('[Narration] Set preferred engine failed:', error);
      return false;
    }
  });

  // Set ElevenLabs API key
  ipcMain.handle(NarrationIPCChannels.SET_ELEVENLABS_API_KEY, async (_event, apiKey: string): Promise<boolean> => {
    try {
      await narrationManager?.setElevenlabsApiKey(apiKey);
      return true;
    } catch (error) {
      console.error('[Narration] Set ElevenLabs API key failed:', error);
      return false;
    }
  });

  // Set ElevenLabs voice
  ipcMain.handle(NarrationIPCChannels.SET_ELEVENLABS_VOICE, async (_event, voiceId: string): Promise<boolean> => {
    try {
      await narrationManager?.setElevenlabsVoice(voiceId);
      return true;
    } catch (error) {
      console.error('[Narration] Set ElevenLabs voice failed:', error);
      return false;
    }
  });

  // Test ElevenLabs voice
  ipcMain.handle(NarrationIPCChannels.TEST_ELEVENLABS_VOICE, async (): Promise<boolean> => {
    try {
      await narrationManager?.testElevenlabsVoice();
      return true;
    } catch (error) {
      console.error('[Narration] Test ElevenLabs voice failed:', error);
      return false;
    }
  });

  // Get available ElevenLabs voices
  ipcMain.handle(NarrationIPCChannels.GET_ELEVENLABS_VOICES, async () => {
    try {
      return await narrationManager?.getElevenlabsVoices() ?? [];
    } catch (error) {
      console.error('[Narration] Get ElevenLabs voices failed:', error);
      return [];
    }
  });

  // Check ElevenLabs connection
  ipcMain.handle(NarrationIPCChannels.CHECK_ELEVENLABS_CONNECTION, async () => {
    try {
      return await narrationManager?.checkElevenlabsConnection() ?? { connected: false, error: 'Manager not initialized' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { connected: false, error: message };
    }
  });

  // Get predefined Librarian voices
  ipcMain.handle(NarrationIPCChannels.GET_LIBRARIAN_VOICES, () => {
    return narrationManager?.getLibrarianVoices() ?? [];
  });

  // Get current voice ID
  ipcMain.handle(NarrationIPCChannels.GET_CURRENT_VOICE_ID, () => {
    return narrationManager?.getCurrentVoiceId() ?? null;
  });

  // ===========================================================================
  // Metrics IPC handlers - User-visible usage stats
  // "The metrics you see are the metrics we see."
  // ===========================================================================

  // Get current metrics for display in Settings
  ipcMain.handle('metrics:getMetrics', (): UserMetrics => {
    return metricsManager?.getMetrics() ?? {
      transcriptions: 0,
      words_transcribed: 0,
      priority_mic_minutes: 0,
      verbal_commands: 0,
      command_launcher_uses: 0,
      clipboard_items: 0,
      pastes_used: 0,
      stacks_created: 0,
      autostacks_created: 0,
      stacks_pasted: 0,
      items_added_to_context: 0,
      sketches_created: 0,
      screenshots_taken: 0,
      librarian_artifacts_created: 0,
      librarian_artifacts_shared: 0,
      commands_executed: 0,
      commands_contributed: 0,
      feedback_given: 0,
    };
  });

  // Get metrics with sync status
  ipcMain.handle('metrics:getMetricsWithStatus', (): { metrics: UserMetrics; lastSyncedAt: string | null; pendingSync: boolean } => {
    return metricsManager?.getMetricsWithStatus() ?? {
      metrics: {
        transcriptions: 0,
        words_transcribed: 0,
        priority_mic_minutes: 0,
        verbal_commands: 0,
        command_launcher_uses: 0,
        clipboard_items: 0,
        pastes_used: 0,
        stacks_created: 0,
        autostacks_created: 0,
        stacks_pasted: 0,
        items_added_to_context: 0,
        sketches_created: 0,
        screenshots_taken: 0,
        librarian_artifacts_created: 0,
        librarian_artifacts_shared: 0,
        commands_executed: 0,
        commands_contributed: 0,
        feedback_given: 0,
      },
      lastSyncedAt: null,
      pendingSync: false,
    };
  });

  // Force sync to Supabase
  ipcMain.handle('metrics:syncToSupabase', async (): Promise<boolean> => {
    return metricsManager?.syncToSupabase() ?? false;
  });

  // Fetch from Supabase (merge with local)
  ipcMain.handle('metrics:fetchFromSupabase', async (): Promise<boolean> => {
    return metricsManager?.fetchFromSupabase() ?? false;
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
      return 'small';
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
      const historyHotkey = clipboardManager.getHotkeys().history || 'Option+Space';
      const screenshotHotkey = clipboardManager.getHotkeys().screenshot || 'Command+4';
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

  ipcMain.handle(TranscribeIPCChannels.GET_AUTO_IMPROVE, () => {
    if (!transcriberManager) {
      return false;
    }
    return transcriberManager.getAutoImprove();
  });

  ipcMain.handle(TranscribeIPCChannels.SET_AUTO_IMPROVE, async (_event, enabled: boolean) => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    await transcriberManager.setAutoImprove(enabled);

    // Refresh tray menu to show updated state
    if (trayManager) {
      trayManager.refreshMenu();
    }
  });

  ipcMain.handle(TranscribeIPCChannels.GET_AUTO_IMPROVE_MIN_WORDS, () => {
    if (!transcriberManager) {
      return 100; // Default value
    }
    return transcriberManager.getAutoImproveMinWords();
  });

  ipcMain.handle(TranscribeIPCChannels.SET_AUTO_IMPROVE_MIN_WORDS, async (_event, minWords: number) => {
    if (!transcriberManager) {
      throw new Error('TranscriberManager not initialized');
    }
    await transcriberManager.setAutoImproveMinWords(minWords);
  });

  ipcMain.handle(TranscribeIPCChannels.GET_AUTO_IMPROVE_STATS, () => {
    if (!preferencesManager) {
      return { wordsImproved: 0, apiCalls: 0, inputTokens: 0, outputTokens: 0 };
    }
    const prefs = preferencesManager.get();
    return prefs.autoImproveStats || { wordsImproved: 0, apiCalls: 0, inputTokens: 0, outputTokens: 0 };
  });

  ipcMain.handle(TranscribeIPCChannels.RESET_AUTO_IMPROVE_STATS, async () => {
    if (!preferencesManager) {
      throw new Error('PreferencesManager not initialized');
    }
    await preferencesManager.save({
      autoImproveStats: { wordsImproved: 0, apiCalls: 0, inputTokens: 0, outputTokens: 0 },
    });
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
      if (typeof hotkeys.screenshot !== 'string') {
        return false;
      }
      // Empty string clears the hotkey
      const result = clipboardManager.setScreenshotHotkey(hotkeys.screenshot);
      if (!result) {
        success = false;
      } else {
        prefsToSave.clipboardScreenshotHotkey = hotkeys.screenshot;
      }
    }

    if (hotkeys.fullScreen !== undefined) {
      if (typeof hotkeys.fullScreen !== 'string') {
        return false;
      }
      // Empty string clears the hotkey
      const result = clipboardManager.setFullScreenHotkey(hotkeys.fullScreen);
      if (!result) {
        success = false;
      } else {
        prefsToSave.clipboardFullScreenHotkey = hotkeys.fullScreen;
      }
    }

    if (hotkeys.activeWindow !== undefined) {
      if (typeof hotkeys.activeWindow !== 'string') {
        return false;
      }
      // Empty string clears the hotkey
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
      const historyHotkey = hotkeys.history || currentHotkeys.history || 'Option+Space';
      const transcriptionHotkey = transcriberManager.getHotkey() || 'Option+Shift+Space';
      const screenshotHotkey = hotkeys.screenshot || currentHotkeys.screenshot || 'Command+4';
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
            // Build figure list with real paths (for terminal compatibility)
            const figurePaths: string[] = [];
            for (const stackItem of stackItems) {
              if (stackItem.imageData && stackItem.figureLabel) {
                const imagePath = await clipboardManager.exportImageToCache(stackItem);
                if (imagePath) {
                  // Use real path for terminal compatibility
                  figurePaths.push(`Figure ${stackItem.figureLabel}: ${imagePath}`);
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
            // Use real path for terminal compatibility
            const figureRef = item.figureLabel
              ? `Figure ${item.figureLabel}: ${imagePath}`
              : imagePath;
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

      // Record paste metric
      metricsManager?.recordPaste();
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
            // Use real path for terminal compatibility
            paths.push(`Figure ${item.figureLabel}: ${imagePath}`);
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
                // Use real path for terminal compatibility
                clipboard.writeText(imagePath);
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

      // Record stack paste metrics
      metricsManager?.recordStackPasted(items.length);
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

  ipcMain.on('clipboard:closeWindow', async () => {
    // Use clipboardHistoryWindow.hide() to properly restore focus to previous app
    if (clipboardHistoryWindow) {
      clipboardHistoryWindow.hide();
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
    console.log('[Main] Relaunch requested');
    // Close all windows first
    BrowserWindow.getAllWindows().forEach(window => {
      if (!window.isDestroyed()) {
        window.destroy();
      }
    });
    app.relaunch();
    app.exit(0);
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

  // Immersive mode for Librarian - when active, window should not auto-hide on blur
  ipcMain.on('clipboard-history:setImmersiveMode', async (_event, immersive: boolean) => {
    clipboardHistoryWindow?.setImmersiveMode(immersive);
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

  // Get API key info (masked key + detected provider) for display.
  ipcMain.handle(ClipboardIPCChannels.GET_API_KEY_INFO, async () => {
    if (!preferencesManager) {
      return { hasKey: false, maskedKey: null, provider: 'unknown' };
    }
    const hasKey = preferencesManager.hasApiKey();
    const maskedKey = preferencesManager.getMaskedApiKey();
    const provider = preferencesManager.detectProvider();
    return { hasKey, maskedKey, provider };
  });

  // Test the API key by making a lightweight API call.
  ipcMain.handle(ClipboardIPCChannels.TEST_API_KEY, async () => {
    if (!preferencesManager) {
      return { success: false, error: 'Preferences not initialized' };
    }

    const apiKey = preferencesManager.getApiKey();
    if (!apiKey) {
      return { success: false, error: 'No API key configured' };
    }

    const provider = preferencesManager.detectProvider();

    try {
      // Test based on detected provider
      if (provider === 'anthropic') {
        // Use the messages endpoint with a minimal request
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'Hi' }],
          }),
        });

        if (response.ok) {
          return { success: true, provider: 'anthropic' };
        }

        const errorData = await response.json().catch(() => ({})) as { error?: { message?: string } };
        const errorMessage = errorData?.error?.message || `API returned status ${response.status}`;
        return { success: false, error: errorMessage, provider: 'anthropic' };
      } else if (provider === 'openai') {
        // Test OpenAI with models endpoint (doesn't consume tokens)
        const response = await fetch('https://api.openai.com/v1/models', {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
        });

        if (response.ok) {
          return { success: true, provider: 'openai' };
        }

        const errorData = await response.json().catch(() => ({})) as { error?: { message?: string } };
        const errorMessage = errorData?.error?.message || `API returned status ${response.status}`;
        return { success: false, error: errorMessage, provider: 'openai' };
      } else {
        // For other providers, just validate the key format is recognized
        return {
          success: true,
          provider,
          warning: 'Key format recognized but connection not verified'
        };
      }
    } catch (error) {
      console.error('[Main] testApiKey error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Connection failed',
        provider,
      };
    }
  });

  // =========================================================================
  // Local LLM Management - Download and use local models for transcript improvement
  // =========================================================================

  // Get available local LLM models and their info.
  ipcMain.handle(ClipboardIPCChannels.GET_LOCAL_LLM_MODELS, async () => {
    return localLLMManager?.getAvailableModels() ?? {};
  });

  // Get download status for all local LLM models.
  ipcMain.handle(ClipboardIPCChannels.GET_LOCAL_LLM_STATUS, async () => {
    return localLLMManager?.getDownloadStatus() ?? {};
  });

  // Get the currently selected local LLM model.
  ipcMain.handle(ClipboardIPCChannels.GET_LOCAL_LLM_SELECTED, async () => {
    return localLLMManager?.getSelectedModel() ?? 'llama-3.2-1b';
  });

  // Set the selected local LLM model.
  ipcMain.handle(ClipboardIPCChannels.SET_LOCAL_LLM_SELECTED, async (_event, model: LLMModelSize) => {
    try {
      await localLLMManager?.setSelectedModel(model);
      await preferencesManager?.save({ selectedLocalLLM: model });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to set model' };
    }
  });

  // Download a local LLM model with progress events.
  ipcMain.handle(ClipboardIPCChannels.DOWNLOAD_LOCAL_LLM, async (event, model: LLMModelSize) => {
    if (!localLLMManager) {
      return { success: false, error: 'Local LLM manager not initialized' };
    }

    try {
      await localLLMManager.downloadModelForSize(model, (downloaded, total) => {
        // Send progress to renderer
        event.sender.send('local-llm:download-progress', { model, downloaded, total });
      });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Download failed' };
    }
  });

  // Delete a local LLM model.
  ipcMain.handle(ClipboardIPCChannels.DELETE_LOCAL_LLM, async (_event, model: LLMModelSize) => {
    try {
      await localLLMManager?.deleteModelForSize(model);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Delete failed' };
    }
  });

  // Get whether to use local LLM for transcript improvement.
  ipcMain.handle(ClipboardIPCChannels.GET_USE_LOCAL_LLM, async () => {
    return preferencesManager?.getPreference('useLocalLLM') ?? false;
  });

  // Set whether to use local LLM for transcript improvement.
  ipcMain.handle(ClipboardIPCChannels.SET_USE_LOCAL_LLM, async (_event, useLocal: boolean) => {
    try {
      await preferencesManager?.save({ useLocalLLM: useLocal });
      // Update promptEngineer with the new setting
      setEngineerUseLocalLLM(useLocal);
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Failed to save setting' };
    }
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

  // Clean up temp files and hotkeys on app quit
  app.on('will-quit', () => {
    // Unregister all hotkeys via HotkeyManager
    const hotkeyManager = getHotkeyManager();
    hotkeyManager.unregisterAll();

    // Clean up LibrarianManager (stop file watchers, close database)
    librarianManager?.destroy();

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
    if (!authManager) {
      console.warn('[Main] setSyncSession: authManager not initialized');
      return false;
    }
    await authManager.setSession(accessToken, refreshToken);
    return true;
  });

  ipcMain.handle(ClipboardIPCChannels.CLEAR_SYNC_SESSION, async () => {
    if (authManager) {
      authManager.clearSession();
    }
    return true;
  });

  // Get session from main process for recovery when renderer localStorage is cleared.
  // This allows the renderer to recover auth state without re-login.
  ipcMain.handle(ClipboardIPCChannels.GET_SYNC_SESSION, async () => {
    if (!authManager) {
      return null;
    }
    const session = authManager.getSession();
    if (!session) {
      return null;
    }
    // Only return tokens if session is not expired.
    const now = Math.floor(Date.now() / 1000);
    if (session.expires_at && session.expires_at <= now) {
      console.log('[Main] getSyncSession: Session expired, not returning tokens');
      return null;
    }
    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: session.expires_at,
      user: session.user ? {
        id: session.user.id,
        email: session.user.email,
      } : null,
    };
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
    if (!authManager) {
      return { error: 'Auth manager not initialized' };
    }
    return await authManager.signUp(email, password);
  });

  ipcMain.handle('auth:signInWithPassword', async (_event, email: string, password: string) => {
    if (!authManager) {
      return { error: 'Auth manager not initialized', session: null };
    }
    return await authManager.signInWithPassword(email, password);
  });

  ipcMain.handle('auth:requestOtp', async (_event, email: string) => {
    if (!authManager) {
      return { error: 'Auth manager not initialized' };
    }
    return await authManager.requestOtp(email);
  });

  ipcMain.handle('auth:verifyOtp', async (_event, email: string, token: string) => {
    if (!authManager) {
      return { error: 'Auth manager not initialized', session: null };
    }
    return await authManager.verifyOtp(email, token);
  });

  ipcMain.handle('auth:resetPasswordForEmail', async (_event, email: string) => {
    if (!authManager) {
      return { error: 'Auth manager not initialized' };
    }
    return await authManager.resetPasswordForEmail(email);
  });

  ipcMain.handle('auth:updatePassword', async (_event, newPassword: string) => {
    if (!authManager) {
      return { error: 'Auth manager not initialized' };
    }
    return await authManager.updatePassword(newPassword);
  });

  ipcMain.handle('auth:setSessionFromUrl', async (_event, accessToken: string, refreshToken: string) => {
    if (!authManager) {
      return { error: 'Auth manager not initialized', session: null };
    }
    return await authManager.setSessionFromUrl(accessToken, refreshToken);
  });

  ipcMain.handle('auth:signOut', async () => {
    if (!authManager) {
      return { error: 'Auth manager not initialized' };
    }
    const result = await authManager.signOut();

    if (!result.error) {
      // Reset cached tier to 'free' on logout so quotas show free limits.
      if (quotaManager) {
        await quotaManager.setCachedTier('free');
      }

      // Reset onboarding state so user sees login screen on next open.
      if (preferencesManager) {
        await preferencesManager.save({
          onboardingComplete: false,
          onboardingStep: undefined,
        });
      }

      // Unregister all hotkeys - they shouldn't work while signed out.
      globalShortcut.unregisterAll();

      // Refresh tray menu to show onboarding-only options.
      if (trayManager) {
        trayManager.refreshMenu();
      }

      // Notify all windows that session has ended.
      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('session-changed', null);
          window.webContents.send('tier:changed', 'free');
        }
      });

      // Hide clipboard history and show onboarding window.
      clipboardHistoryWindow?.hide(true);
      if (onboardingWindow) {
        onboardingWindow.show(); // show() handles focus internally
      }
    }

    return result;
  });

  ipcMain.handle('auth:deleteAccount', async () => {
    if (!authManager) {
      return { error: 'Auth manager not initialized' };
    }

    const session = authManager.getSession();
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

      await authManager.signOut();
      if (quotaManager) {
        await quotaManager.setCachedTier('free');
      }

      // Reset onboarding state so user sees login screen on next open.
      if (preferencesManager) {
        await preferencesManager.save({
          onboardingComplete: false,
          onboardingStep: undefined,
        });
      }

      // Unregister all hotkeys - they shouldn't work while signed out.
      globalShortcut.unregisterAll();

      // Refresh tray menu to show onboarding-only options.
      if (trayManager) {
        trayManager.refreshMenu();
      }

      BrowserWindow.getAllWindows().forEach((window) => {
        if (!window.isDestroyed()) {
          window.webContents.send('session-changed', null);
          window.webContents.send('tier:changed', 'free');
        }
      });

      // Hide clipboard history and show onboarding window.
      clipboardHistoryWindow?.hide(true);
      if (onboardingWindow) {
        onboardingWindow.show(); // show() handles focus internally
      }

      return { error: null };
    } catch (err) {
      console.error('[Main] Delete account error:', err);
      return { error: 'Failed to connect to server' };
    }
  });

  ipcMain.handle('auth:getSession', async () => {
    if (!authManager) {
      return null;
    }
    return authManager.getSession();
  });

  ipcMain.handle('auth:isSuperAdmin', (): boolean => {
    return authManager?.isSuperAdmin() ?? false;
  });

  // Open external URL in default browser (for Stripe checkout, etc).
  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    await shell.openExternal(url);
  });

  // Reveal file in Finder (macOS).
  ipcMain.handle('shell:showItemInFolder', async (_event, fullPath: string) => {
    shell.showItemInFolder(fullPath);
  });

  // =========================================================================
  // Todo IPC Handlers - Bidirectional sync with Supabase
  // =========================================================================

  ipcMain.handle('todo:isAuthenticated', async () => {
    if (!authManager) {
      return false;
    }
    return authManager.isAuthenticated();
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
    if (!preferencesManager) {
      return false;
    }

    // Use HotkeyManager.change() to atomically change the hotkey
    const hotkeyManager = getHotkeyManager();
    const result = hotkeyManager.change('todo', hotkey);

    if (result.success) {
      await preferencesManager.save({ todoHotkey: hotkey });
      return true;
    }

    console.error('[Main] Failed to change todo hotkey:', result.error);
    return false;
  });

  // =========================================================================
  // Generic Hotkey IPC Handlers (for UI-configurable hotkeys)
  // =========================================================================

  // Preference key mapping for each hotkey ID
  const hotkeyPreferenceKeys: Record<string, string> = {
    superPaste: 'superPasteHotkey',
    commandLauncher: 'commandLauncherHotkey',
    improveText: 'improveTextHotkey',
    autoImprove: 'autoImproveHotkey',
  };

  // Default values for each hotkey
  const hotkeyDefaults: Record<string, string> = {
    superPaste: 'Command+Shift+V',
    commandLauncher: 'Command+Shift+K',
    improveText: 'Command+Shift+I',
    autoImprove: 'Command+Shift+\\',
  };

  ipcMain.handle('hotkey:get', async (_event, id: string) => {
    if (!preferencesManager || !hotkeyPreferenceKeys[id]) {
      return hotkeyDefaults[id] || null;
    }
    const prefs = await preferencesManager.load();
    const prefKey = hotkeyPreferenceKeys[id];
    return ((prefs as any)[prefKey] as string) || hotkeyDefaults[id] || null;
  });

  ipcMain.handle('hotkey:set', async (_event, id: string, key: string) => {
    if (!preferencesManager || !hotkeyPreferenceKeys[id]) {
      return { success: false, error: 'Invalid hotkey ID' };
    }

    const hotkeyManager = getHotkeyManager();
    const result = hotkeyManager.change(id as any, key);

    if (result.success) {
      const prefKey = hotkeyPreferenceKeys[id];
      await preferencesManager.save({ [prefKey]: key });
      return { success: true };
    }

    return { success: false, error: result.error };
  });

  ipcMain.handle('hotkey:getAll', async () => {
    if (!preferencesManager) {
      return hotkeyDefaults;
    }
    const prefs = await preferencesManager.load();
    const result: Record<string, string | null> = {};
    for (const [id, prefKey] of Object.entries(hotkeyPreferenceKeys)) {
      result[id] = ((prefs as any)[prefKey] as string) || hotkeyDefaults[id] || null;
    }
    return result;
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

  // Launch at login - start app automatically when macOS starts.
  // Returns the actual system state, not just the preference.
  ipcMain.handle('clipboard:getLaunchAtLogin', async () => {
    if (process.platform === 'darwin') {
      const settings = app.getLoginItemSettings();
      return settings.openAtLogin;
    }
    // Fallback to preference for non-macOS
    if (!preferencesManager) {
      return false;
    }
    return preferencesManager.getPreference('launchAtLogin') ?? true;
  });

  ipcMain.handle('clipboard:setLaunchAtLogin', async (_event, enabled: boolean) => {
    if (!preferencesManager) {
      return { success: false, enabled: false };
    }
    await preferencesManager.save({ launchAtLogin: enabled });

    // Apply immediately using Electron's login item settings.
    if (process.platform === 'darwin') {
      app.setLoginItemSettings({
        openAtLogin: enabled,
        openAsHidden: true, // Start in background (menu bar app)
      });

      // Verify the setting was applied
      const settings = app.getLoginItemSettings();
      return { success: settings.openAtLogin === enabled, enabled: settings.openAtLogin };
    }
    return { success: true, enabled };
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
  // Word Substitutions - correction pairs for transcription
  // =========================================================================

  ipcMain.handle('clipboard:getWordSubstitutions', async () => {
    if (!preferencesManager) {
      return [];
    }
    return preferencesManager.getPreference('wordSubstitutions') ?? [];
  });

  ipcMain.handle('clipboard:setWordSubstitutions', async (_event, substitutions: Array<{ from: string; to: string }>) => {
    if (!preferencesManager) {
      return false;
    }
    await preferencesManager.save({ wordSubstitutions: substitutions });
    console.log(`[Main] Word substitutions updated: ${substitutions.length} pairs`);
    return true;
  });

  // =========================================================================
  // Data Retention - how long to keep clipboard history
  // =========================================================================

  ipcMain.handle('clipboard:getDataRetentionDays', async () => {
    if (!preferencesManager) {
      return -1; // Default: never delete
    }
    return preferencesManager.getPreference('dataRetentionDays') ?? -1;
  });

  ipcMain.handle('clipboard:setDataRetentionDays', async (_event, days: number) => {
    if (!preferencesManager) {
      return false;
    }
    await preferencesManager.save({ dataRetentionDays: days });
    console.log(`[Main] Data retention set to: ${days === -1 ? 'never' : days + ' days'}`);
    
    // Trigger immediate cleanup with new retention setting.
    if (clipboardManager && days !== -1) {
      clipboardManager.applyDataRetention(days);
    }
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
      return { priorityMic: 'Unlimited', autoStack: 'Unlimited', textImprove: 'Unlimited' };
    }
    return {
      priorityMic: quotaManager.formatPriorityMicUsage(),
      autoStack: quotaManager.formatAutoStackUsage(),
      textImprove: quotaManager.formatTextImproveUsage(),
    };
  });

  ipcMain.handle('quota:getResetDate', async () => {
    if (!quotaManager) {
      return new Date();
    }
    return quotaManager.getResetDate();
  });

  ipcMain.handle('quota:getDaysUntilReset', async () => {
    if (!quotaManager) {
      return 0;
    }
    return quotaManager.getDaysUntilReset();
  });

  ipcMain.handle('quota:getLimits', async () => {
    if (!quotaManager) {
      return { priorityMicMinutes: Infinity, autoStackSessions: Infinity, textImprovementWords: Infinity };
    }
    return quotaManager.getLimits();
  });

  ipcMain.handle('quota:refreshTier', async () => {
    if (!authManager) {
      return { tier: 'free', error: 'Not initialized' };
    }

    const session = authManager.getSession();
    if (!session) {
      return { tier: 'free', error: 'Not signed in' };
    }

    try {
      const supabase = authManager.getSupabaseClient();
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
          window.webContents.send('tier:changed', tier);
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
  // Commands IPC Handlers - Portable commands management
  // =========================================================================

  ipcMain.handle(CommandsIPCChannels.GET_DIRECTORY, async () => {
    if (!commandsManager) {
      return null;
    }
    return commandsManager.getDirectory();
  });

  ipcMain.handle(CommandsIPCChannels.SET_DIRECTORY, async (_event, directoryPath: string | null) => {
    if (!commandsManager || !preferencesManager) {
      return { success: false, error: 'Not initialized' };
    }
    try {
      await commandsManager.setDirectory(directoryPath);
      await preferencesManager.save({ commandsDirectory: directoryPath || undefined });
      return { success: true };
    } catch (error) {
      console.error('[Main] Failed to set commands directory:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  });

  ipcMain.handle(CommandsIPCChannels.BROWSE_DIRECTORY, async () => {
    // NSPanel windows (like clipboard history) don't support modal dialogs properly.
    // Use mainWindow as parent, or show dialog without parent if mainWindow doesn't exist.
    // This ensures the dialog appears and works correctly.
    const parentWindow = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;

    const result = await dialog.showOpenDialog(parentWindow as BrowserWindow, {
      title: 'Select Commands Directory',
      message: 'Choose a folder containing your command markdown files',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: 'Select',
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });

  ipcMain.handle(CommandsIPCChannels.GET_COMMANDS, async () => {
    if (!commandsManager) {
      return [];
    }
    return commandsManager.getCommands().map(cmd => ({
      name: cmd.name,
      displayName: cmd.displayName,
      filePath: cmd.filePath,
    }));
  });

  ipcMain.handle(CommandsIPCChannels.REFRESH_COMMANDS, async () => {
    if (!commandsManager) {
      return [];
    }
    await commandsManager.refresh();
    return commandsManager.getCommands().map(cmd => ({
      name: cmd.name,
      displayName: cmd.displayName,
      filePath: cmd.filePath,
    }));
  });

  ipcMain.handle(CommandsIPCChannels.GET_COMMAND_CONTENT, async (_event, commandName: string) => {
    if (!commandsManager) {
      return null;
    }
    const command = commandsManager.getCommand(commandName);
    if (!command) {
      return null;
    }
    const loaded = await commandsManager.loadCommandContent(command);
    if (!loaded) {
      return null;
    }
    return { content: loaded.content, filePath: loaded.filePath };
  });

  // =========================================================================
  // Multi-Directory Management
  // =========================================================================

  ipcMain.handle(CommandsIPCChannels.INITIALIZE, async () => {
    if (!commandsManager) {
      return;
    }
    await commandsManager.initialize();
  });

  ipcMain.handle(CommandsIPCChannels.GET_WATCHED_DIRS, async () => {
    if (!commandsManager) {
      return [];
    }
    return commandsManager.getWatchedDirs();
  });

  ipcMain.handle(CommandsIPCChannels.ADD_WATCHED_DIR, async (_event, dirPath: string) => {
    if (!commandsManager) {
      return null;
    }
    return await commandsManager.addWatchedDir(dirPath);
  });

  ipcMain.handle(CommandsIPCChannels.REMOVE_WATCHED_DIR, async (_event, dirPath: string) => {
    if (!commandsManager) {
      return false;
    }
    return commandsManager.removeWatchedDir(dirPath);
  });

  ipcMain.handle(CommandsIPCChannels.GET_DEFAULT_DIRECTORY, async () => {
    if (!commandsManager) {
      return '';
    }
    return commandsManager.getDefaultDirectory();
  });

  ipcMain.handle(CommandsIPCChannels.CREATE_DEFAULT_DIRECTORY, async () => {
    if (!commandsManager) {
      return null;
    }
    return await commandsManager.createDefaultDirectory();
  });

  // =========================================================================
  // CRUD Operations
  // =========================================================================

  ipcMain.handle(CommandsIPCChannels.GET_COMMAND_BY_PATH, async (_event, filePath: string) => {
    if (!commandsManager) {
      return null;
    }
    return await commandsManager.getCommandByPath(filePath);
  });

  ipcMain.handle(CommandsIPCChannels.SAVE_COMMAND, async (_event, filePath: string, content: string) => {
    if (!commandsManager) {
      return false;
    }
    return commandsManager.saveCommand(filePath, content);
  });

  ipcMain.handle(CommandsIPCChannels.CREATE_COMMAND, async (_event, directoryPath: string, name: string, content: string) => {
    if (!commandsManager) {
      return null;
    }
    return commandsManager.createCommand(directoryPath, name, content);
  });

  ipcMain.handle(CommandsIPCChannels.DELETE_COMMAND, async (_event, filePath: string) => {
    if (!commandsManager) {
      return false;
    }
    return commandsManager.deleteCommand(filePath);
  });

  // Handle direct command invocation from command launcher (Cmd+Shift+K).
  // Gets the command, determines if target is terminal, and pastes appropriately.
  ipcMain.handle('commands:invoke', async (_event, commandName: string) => {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const plist = require('plist');

    if (!commandsManager) {
      return { success: false, error: 'Not initialized' };
    }

    const command = commandsManager.getCommand(commandName);
    if (!command) {
      return { success: false, error: 'Command not found' };
    }

    try {
      // Get the app that was active before the launcher opened.
      const targetApp = commandLauncherWindow?.getPreviousApp();
      const isTerminal = targetApp ? isTerminalApp(targetApp.bundleId) : false;
      const isIDE = targetApp ? isIDEWithTerminal(targetApp.bundleId) : false;

      // Use text-based file path for terminals and IDEs with integrated terminals.
      // IDEs like Cursor/VS Code work better with file paths that can be used in their terminals.
      if (isTerminal || isIDE) {
        // For terminals and IDEs: paste a text reference with the file path below.
        const referenceText = `[run this command: ${command.name}.md]\n${command.filePath}`;
        clipboard.writeText(referenceText);
        clipboardManager?.syncClipboardHash();
      } else {
        // For other apps: paste the .md file as an attachment.
        const filePaths = [command.filePath];
        const plistData = plist.build(filePaths);
        clipboard.writeBuffer('NSFilenamesPboardType', Buffer.from(plistData));
        clipboardManager?.syncClipboardHash();
      }

      // Refocus the previous app and paste.
      if (targetApp) {
        await execAsync(`osascript -e 'tell application "${targetApp.name}" to activate'`);
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      await execAsync('osascript -e \'tell application "System Events" to keystroke "v" using command down\'');

      console.log(`[CommandLauncher] Invoked command: ${command.name} (terminal: ${isTerminal}, ide: ${isIDE})`);
      metricsManager?.recordCommandExecuted();
      return { success: true };
    } catch (error) {
      console.error('[CommandLauncher] Error invoking command:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
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

  // DM: Mark multiple messages as read in batch.
  ipcMain.handle(SocialIPCChannels.MARK_AS_READ_BATCH, async (_event, messageIds: string[]) => {
    if (!socialSync) {
      return false;
    }
    return await socialSync.markAsReadBatch(messageIds);
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

  // Feedback: Mark all feedback messages as read.
  ipcMain.handle(SocialIPCChannels.MARK_ALL_FEEDBACK_AS_READ, async () => {
    if (!socialSync) {
      return false;
    }
    return await socialSync.markAllFeedbackAsRead();
  });

  // Feedback: Submit feedback (send to admin).
  ipcMain.handle(SocialIPCChannels.SUBMIT_FEEDBACK, async (_event, localItemId: number) => {
    if (!socialSync) {
      return null;
    }
    const result = await socialSync.submitFeedback(localItemId);
    if (result) metricsManager?.recordFeedbackGiven();
    return result;
  });

  // Feedback: Submit text feedback (for diagnostics, etc.).
  ipcMain.handle(SocialIPCChannels.SUBMIT_TEXT_FEEDBACK, async (_event, text: string) => {
    if (!socialSync) {
      return null;
    }
    const result = await socialSync.submitTextFeedback(text);
    if (result) metricsManager?.recordFeedbackGiven();
    return result;
  });

  // Feedback: Submit image feedback with optional caption and source app name.
  ipcMain.handle(SocialIPCChannels.SUBMIT_IMAGE_FEEDBACK, async (_event, imageBase64: string, caption?: string, sourceAppName?: string) => {
    if (!socialSync) {
      return null;
    }
    const result = await socialSync.submitImageFeedback(imageBase64, caption, sourceAppName);
    if (result) metricsManager?.recordFeedbackGiven();
    return result;
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
      onboardingWindow = createOnboardingWindow();
    }
    return await onboardingWindow.getPermissionStatus();
  });

  // Request microphone permission - shows system dialog if not determined.
  ipcMain.handle(OnboardingIPCChannels.REQUEST_MICROPHONE, async () => {
    if (!onboardingWindow) {
      onboardingWindow = createOnboardingWindow();
    }
    return await onboardingWindow.requestMicrophonePermission();
  });

  // Open System Settings to Accessibility pane.
  ipcMain.handle(OnboardingIPCChannels.OPEN_ACCESSIBILITY_SETTINGS, async () => {
    if (!onboardingWindow) {
      onboardingWindow = createOnboardingWindow();
    }
    onboardingWindow.openAccessibilitySettings();
    return true;
  });

  // Open System Settings to Screen Recording pane.
  ipcMain.handle(OnboardingIPCChannels.OPEN_SCREEN_RECORDING_SETTINGS, async () => {
    if (!onboardingWindow) {
      onboardingWindow = createOnboardingWindow();
    }
    onboardingWindow.openScreenRecordingSettings();
    return true;
  });

  // Trigger screen capture to add app to Screen Recording permissions list.
  // This saves users from manually clicking "+" to add the app.
  ipcMain.handle(OnboardingIPCChannels.TRIGGER_SCREEN_RECORDING_PROMPT, async () => {
    if (!onboardingWindow) {
      onboardingWindow = createOnboardingWindow();
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

    // Register hotkeys now that onboarding is complete
    console.log('[Main] Onboarding complete, registering hotkeys');
    registerHotkeysAfterOnboarding();

    // Refresh tray menu to show full options
    if (trayManager) {
      trayManager.refreshMenu();
    }

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

    // Register hotkeys now that onboarding is complete
    registerHotkeysAfterOnboarding();

    // Refresh tray menu to show full options
    if (trayManager) {
      trayManager.refreshMenu();
    }

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

    // Unregister hotkeys - they shouldn't work during onboarding.
    globalShortcut.unregisterAll();
    console.log('[Main] Unregistered all hotkeys for onboarding reset');

    // Hide clipboard history window if visible.
    if (clipboardHistoryWindow?.isVisible()) {
      clipboardHistoryWindow.hide();
    }

    // Refresh tray menu to show onboarding options.
    if (trayManager) {
      trayManager.refreshMenu();
    }

    // Close any existing onboarding window.
    if (onboardingWindow) {
      onboardingWindow.close();
      onboardingWindow = null;
    }

    // Show onboarding window from the beginning.
    onboardingWindow = createOnboardingWindow();
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

    // Record transcription metrics
    const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
    metricsManager?.recordTranscription(wordCount);
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
  
  transcriberManager.on('paste-failed', (_message, _transcription) => {
    if (cursorStatusManager) {
      // Don't show the actual transcription - just indicate it was saved
      cursorStatusManager.setStateWithData('paste-failed', { transcription: 'Saved to Field Theory' });
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

  // Initialize local LLM manager
  if (!localLLMManager) {
    const savedLLMModel = preferencesManager.getPreference('selectedLocalLLM') as LLMModelSize | undefined;
    localLLMManager = new LocalLLMManager(savedLLMModel || 'llama-3.2-1b');

    // Wire up local LLM with promptEngineer
    setEngineerLocalLLMManager(localLLMManager);
    const useLocal = preferencesManager.getPreference('useLocalLLM') as boolean | undefined;
    setEngineerUseLocalLLM(useLocal ?? false);
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

  // Hide clipboard history when another app (like Alfred/Spotlight) becomes active.
  // NSPanel windows don't always trigger blur events on other panels, so we use
  // app-level blur detection with a small delay to check if any Field Theory window
  // still has focus.
  app.on('browser-window-blur', () => {
    // Don't auto-hide if showInDock mode (user expects normal app behavior)
    const showInDock = preferencesManager?.getPreference('showInDock') ?? false;
    if (showInDock) return;

    // Don't auto-hide if in immersive reading mode
    if (clipboardHistoryWindow?.getImmersiveMode()) return;

    // Don't auto-hide during recording
    if (clipboardHistoryWindow?.getRecordingActive()) return;

    // Small delay to allow focus to settle - another Field Theory window
    // might be gaining focus (e.g., switching between our windows)
    setTimeout(() => {
      const focusedWindow = BrowserWindow.getFocusedWindow();

      // If no Field Theory window has focus, another app is active - hide
      if (!focusedWindow && clipboardHistoryWindow?.isVisible()) {
        clipboardHistoryWindow.hide();
      }
    }, 50);
  });
  
  audioManager = new AudioManager(nativeHelper);

  // Load saved priority device from preferences
  const prefs = preferencesManager.get();
  if (prefs.priorityDeviceId) {
    audioManager.setSavedPriorityDeviceId(prefs.priorityDeviceId);
  }
  // Load favorite device name for auto-reconnect
  if (prefs.favoriteDeviceName) {
    audioManager.setFavoriteDeviceName(prefs.favoriteDeviceName);
  }
  // Save favorite device name when it changes
  audioManager.setOnFavoriteChanged(async (name) => {
    if (preferencesManager) {
      await preferencesManager.save({ favoriteDeviceName: name });
    }
  });

  audioManager.on('stateChanged', () => {
    broadcastStateChanged();
  });

  // Track priority mic minutes (time the mic is locked)
  audioManager.on('priorityMicMinute', () => {
    metricsManager?.recordPriorityMicMinute();
  });

  await audioManager.init();

  trayManager = new TrayManager(audioManager, undefined, preferencesManager);

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
      if (id > 0) {
        if (transcriberManager) {
          transcriberManager.addToStack(id);
        }
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
      if (id > 0) {
        if (transcriberManager) {
          transcriberManager.addToStack(id);
        }
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
      if (id > 0) {
        if (transcriberManager) {
          transcriberManager.addToStack(id);
        }
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

  trayManager.init(showSettingsInClipboardWindow, checkForUpdatesCallback, startRecordingCallback, takeScreenshotCallback, takeFullScreenCallback, takeActiveWindowCallback, showMainWindow);

  // Set up callback to show onboarding window from tray menu
  trayManager.setShowOnboardingCallback(() => {
    if (!onboardingWindow) {
      onboardingWindow = createOnboardingWindow();
    }
    const prefs = preferencesManager?.get();
    const startStep = prefs?.onboardingStep ?? OnboardingStep.WELCOME;
    onboardingWindow.show(startStep);
  });

  // Set up callback to check if user is logged in
  trayManager.setIsLoggedInCallback(() => {
    const session = authManager?.getSession();
    return !!session?.user?.email;
  });

  // Set up callback to open developer tools
  trayManager.setOpenDevToolsCallback(() => {
    if (clipboardHistoryWindow) {
      clipboardHistoryWindow.openDevTools();
    }
  });

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

  // Bring onboarding window to front on any clipboard copy
  // This helps users who copied the OTP code and need to get back to Field Theory
  clipboardManager.setOnClipboardChange(() => {
    if (onboardingWindow?.isVisible()) {
      onboardingWindow.show();
    }
  });

  const prefs = preferencesManager.get();
  clipboardManager.loadHotkeysFromPreferences(
    prefs.clipboardScreenshotHotkey,
    prefs.clipboardHistoryHotkey
  );

  // Apply user-configured data retention on startup.
  // This cleans up items older than the user's retention setting.
  const retentionDays = prefs.dataRetentionDays ?? -1;
  if (retentionDays !== -1) {
    clipboardManager.applyDataRetention(retentionDays);
  }
  
  // Load continuous context preferences
  // Continuous Context feature disabled for now
  // clipboardManager.loadContinuousContextFromPreferences(
  //   prefs.continuousContextEnabled,
  //   prefs.continuousContextHotkey
  // );

  // Listen for continuous context state changes and broadcast to renderer
  // Disabled for now
  // clipboardManager.on('continuousContextChanged', (state: ContinuousContextState) => {
  //   BrowserWindow.getAllWindows().forEach((window) => {
  //     if (!window.isDestroyed()) {
  //       window.webContents.send(ClipboardIPCChannels.CONTINUOUS_CONTEXT_CHANGED, state);
  //     }
  //   });
  // });
  
  // When continuous context captures a screenshot, notify all windows
  // Disabled for now
  // clipboardManager.on('continuousContextScreenshot', (itemId: number) => {
  //   BrowserWindow.getAllWindows().forEach((window) => {
  //     if (!window.isDestroyed()) {
  //       window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, itemId);
  //     }
  //   });
  // });
  
  // Hotkeys will be registered after checking onboarding status (see below in app.whenReady).

  // Initialize quota manager for tracking local usage.
  quotaManager = new QuotaManager(preferencesManager);

  // Initialize librarian manager for watching markdown reading files.
  librarianManager = new LibrarianManager();

  // Initialize narration manager for TTS capability.
  // Local, offline text-to-speech for the Librarian voice.
  narrationManager = getNarrationManager(preferencesManager);
  narrationManager.init().then(() => {
    console.log('[Main] Narration manager initialized');
  }).catch((error) => {
    console.error('[Main] Narration manager init failed:', error);
  });

  // Forward narration events to renderer
  narrationManager.on('generationStarted', (readingPath: string) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(NarrationIPCChannels.GENERATION_STARTED, readingPath);
      }
    });
  });

  narrationManager.on('playbackStarted', (readingPath: string, duration: number) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(NarrationIPCChannels.PLAYBACK_STARTED, readingPath, duration);
      }
    });
  });

  narrationManager.on('playbackPaused', (readingPath: string | null) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(NarrationIPCChannels.PLAYBACK_PAUSED, readingPath);
      }
    });
  });

  narrationManager.on('playbackResumed', (readingPath: string | null) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(NarrationIPCChannels.PLAYBACK_RESUMED, readingPath);
      }
    });
  });

  narrationManager.on('playbackStopped', (readingPath: string | null) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(NarrationIPCChannels.PLAYBACK_STOPPED, readingPath);
      }
    });
  });

  narrationManager.on('playbackError', (error: string, readingPath: string | null) => {
    // Only log, don't show modal - silent failure rule
    console.warn(`[Narration] Playback error: ${error}`);
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(NarrationIPCChannels.PLAYBACK_ERROR, error, readingPath);
      }
    });
  });

  narrationManager.on('installProgress', (progress: number, message: string) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(NarrationIPCChannels.INSTALL_PROGRESS, progress, message);
      }
    });
  });

  // Broadcast artifact-added events to all windows and auto-show if enabled
  librarianManager.on('reading-added', async (reading: Reading) => {
    console.log(`[Librarian] artifact-added event: ${reading.title}`);

    // Record librarian artifact created metric
    metricsManager?.recordLibrarianArtifactCreated();

    // Reset prompt counter - new artifact means fresh start
    librarianManager!.resetCounter();

    // Broadcast to all windows (updates reading lists)
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('librarian:readingAdded', reading);
      }
    });

    // Check if we should auto-speak and have narration enabled (feature flagged)
    const shouldAutoSpeak = FEATURE_NARRATION_ENABLED && narrationManager ?
      await narrationManager.shouldSpeakNow().catch(() => ({ shouldSpeak: false })) :
      { shouldSpeak: false };

    if (shouldAutoSpeak.shouldSpeak && librarianManager!.isAutoShowEnabled()) {
      // Pre-generate audio BEFORE showing window
      // User experience: window opens and playback starts immediately
      console.log(`[Narration] Pre-generating audio for: ${reading.title}`);

      try {
        const result = await narrationManager!.preGenerateAudio(reading.path, reading.content);

        if (result) {
          console.log(`[Narration] Audio ready (fromCache: ${result.fromCache}), showing window`);

          // NOW show the window
          pendingImmersiveReading = reading.path;
          if (!clipboardHistoryWindow) {
            clipboardHistoryWindow = initClipboardHistoryWindow();
          }
          const boundsToUse = restoreClipboardHistoryBounds();
          clipboardHistoryWindow.show(boundsToUse, false, true);

          if (app.dock) {
            app.dock.bounce('informational');
          }

          // Play artifact discovery sound
          clipboardHistoryWindow.playArtifactDiscoverySound();

          // Start playback immediately
          await narrationManager!.playAudioFile(reading.path, result.audioPath);
        }
      } catch (error) {
        console.warn(`[Narration] Pre-generation failed, showing window without audio:`, error);
        // Fall back to showing window without audio
        showWindowWithoutAudio();
      }
    } else if (librarianManager!.isAutoShowEnabled()) {
      // Auto-show enabled but no auto-speak - show window immediately
      showWindowWithoutAudio();
    } else {
      // Just play the discovery sound if window exists
      clipboardHistoryWindow?.playArtifactDiscoverySound();
    }

    function showWindowWithoutAudio() {
      pendingImmersiveReading = reading.path;
      if (!clipboardHistoryWindow) {
        clipboardHistoryWindow = initClipboardHistoryWindow();
      }
      const boundsToUse = restoreClipboardHistoryBounds();
      clipboardHistoryWindow.show(boundsToUse, false, true);

      if (app.dock) {
        app.dock.bounce('informational');
      }
      clipboardHistoryWindow?.playArtifactDiscoverySound();
    }
  });

  // Broadcast reading-updated events to all windows
  librarianManager.on('reading-updated', (reading: ReadingMeta) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('librarian:readingUpdated', reading);
      }
    });
  });

  // Broadcast reading-removed events to all windows
  librarianManager.on('reading-removed', (filePath: string) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send('librarian:readingRemoved', filePath);
      }
    });
  });

  // Connect quota manager to tray for menu bar display
  if (trayManager) {
    trayManager.setQuotaManager(quotaManager);
  }

  // Broadcast quota changes to all windows so UI can update in real-time.
  quotaManager.on('quotaChanged', (quotas) => {
    const formatted = {
      priorityMic: quotaManager!.formatPriorityMicUsage(),
      autoStack: quotaManager!.formatAutoStackUsage(),
      textImprove: quotaManager!.formatTextImproveUsage(),
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

  // Wire up native helper for fast sound playback and preload all sounds.
  // This gives ~1-5ms latency instead of ~50-100ms with afplay.
  if (nativeHelper) {
    const transcriberSoundManager = transcriberManager.getSoundManager();
    transcriberSoundManager.setNativeHelper(nativeHelper);

    // Preload all sounds once (shared cache in native helper).
    transcriberSoundManager.preloadAllSounds().catch((err) => {
      console.warn('[Main] Failed to preload sounds:', err);
    });
  }

  // Pass transcriberManager to trayManager for auto-improve toggle
  if (trayManager) {
    trayManager.setTranscriberManager(transcriberManager);
  }

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
  if (audioManager) {
    diagnosticsCollector.setAudioManager(audioManager);
  }

  // Initialize commands manager for portable commands feature.
  commandsManager = new CommandsManager();

  // Wire up commands manager to transcriber manager for command detection.
  if (transcriberManager) {
    transcriberManager.setCommandsManager(commandsManager);
  }

  // Initialize multi-directory watching from settings file.
  await commandsManager.initialize();

  // Migrate legacy single-directory setting to multi-directory system.
  // If user has a commandsDirectory set but watchedDirs is empty, add it to watchedDirs.
  const savedCommandsDir = preferencesManager.getPreference('commandsDirectory');
  if (savedCommandsDir) {
    const watchedDirs = commandsManager.getWatchedDirs();
    if (watchedDirs.length === 0) {
      // Migrate: add legacy directory as first watched directory
      console.log(`[Main] Migrating legacy commands directory to multi-directory system: ${savedCommandsDir}`);
      await commandsManager.addWatchedDir(savedCommandsDir);
      // Only set legacy directoryPath during migration (when no watchedDirs exist yet)
      // DO NOT call setDirectory when watchedDirs already has entries - it clears all commands!
      await commandsManager.setDirectory(savedCommandsDir);
    }
  }
  
  // Broadcast commands changes to all windows.
  commandsManager.on('commandsChanged', (commands: PortableCommand[]) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(CommandsIPCChannels.COMMANDS_CHANGED, commands.map((cmd: PortableCommand) => ({
          name: cmd.name,
          displayName: cmd.displayName,
          filePath: cmd.filePath,
        })));
      }
    });
  });
  
  commandsManager.on('directoryChanged', (directoryPath) => {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(CommandsIPCChannels.DIRECTORY_CHANGED, directoryPath);
      }
    });
  });

  // Initialize command launcher window for Cmd+Shift+K.
  // Pass nativeHelper for instant access to cached frontmost app info.
  commandLauncherWindow = new CommandLauncherWindow(nativeHelper ?? undefined);

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

  // Initialize auth manager first - single source of truth for authentication.
  // Load Supabase credentials from .env.local file.
  const envVars = loadEnvVars();
  authManager = new AuthManager();
  await authManager.init(envVars.supabaseUrl, envVars.supabaseAnonKey);

  // Initialize mobile sync to pull iOS transcriptions into clipboard history.
  // AuthManager is passed as dependency for session state.
  mobileSync = new MobileSync(authManager, clipboardManager, preferencesManager);
  await mobileSync.init();

  // Wire up session checker so quota manager uses free limits when not logged in.
  // This ensures auto-stack limits are enforced for logged-out users.
  if (quotaManager) {
    quotaManager.setSessionChecker(() => {
      return authManager?.isAuthenticated() ?? false;
    });
  }

  // Initialize shared clipboard sync - subscribes to AuthManager for session.
  // This enables collaborative clipboard sharing between team members.
  sharedClipboardSync = new SharedClipboardSync(authManager, clipboardManager);

  // Initialize social sync for DMs, Feedback, and Contacts.
  // Also subscribes to AuthManager for session.
  socialSync = new SocialSync(authManager, clipboardManager);

  // Initialize metrics manager for user-visible usage stats.
  // "The metrics you see are the metrics we see."
  metricsManager = new MetricsManager(authManager);
  await metricsManager.init();

  // Trust cached tier until we get positive confirmation from server.
  // Don't reset pro→free just because session isn't immediately valid.
  // If user is offline, they can't use cost-incurring features anyway (API calls fail).
  // Tier only changes when: (1) server confirms different tier, or (2) explicit sign-out.
  const existingSession = authManager.getSession();
  const cachedTier = quotaManager?.getCachedTier();
  console.log('[Main] Startup: session=', existingSession?.user?.email ?? 'none', 'cachedTier=', cachedTier);

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
      
      // Don't show Hot Mic during onboarding.
      const prefs = preferencesManager?.get();
      if (!prefs?.onboardingComplete) {
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
        const boundsToUse = restoreClipboardHistoryBounds();
        clipboardHistoryWindow.show(boundsToUse);
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

  // NOTE: Tasks toggle (Cmd+Shift+T) and Super Paste (Cmd+Shift+V) hotkeys
  // are now registered in registerHotkeysAfterOnboarding() to avoid permission
  // prompts during onboarding.

  console.log('[Main] Transcription system initialized');
}

/**
 * Initialize clipboard callbacks for auto-stacking.
 */
async function initClipboardCallbacks(): Promise<void> {
  if (!clipboardManager) {
    console.error('[Main] Cannot initialize clipboard callbacks - clipboardManager not available');
    return;
  }

  // Set up callback for auto-stacking clipboard items during recording.
  // This ensures ALL clipboard items (text, images, screenshots) are added to the recording stack.
  clipboardManager.setOnItemAdded((id) => {
    const item = clipboardManager!.getItem(id);

    // Add ALL items to recording stack if user is currently recording.
    // This enables any clipboard copy (text, images, screenshots) to participate in auto-stacking.
    if (item && transcriberManager && transcriberManager.getStatus() === 'recording') {
      transcriberManager.addToStack(id);
      console.log(`[Main] Added clipboard ${item.type} ${id} to recording stack`);
    }

    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) {
        window.webContents.send(ClipboardIPCChannels.ITEM_ADDED, id);
      }
    });
  });

  console.log('[Main] Clipboard callbacks initialized');
}

// Prevent multiple instances of the app.
const gotTheLock = app.requestSingleInstanceLock();

// Register fieldtheory:// URL protocol for deep linking
// Usage: open "fieldtheory://librarian/import?file=/path/to/reading.md"
if (process.defaultApp) {
  // Development: need to register with path to Electron
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('fieldtheory', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  // Production
  app.setAsDefaultProtocolClient('fieldtheory');
}

/**
 * Handle fieldtheory:// URLs
 * Supported paths:
 * - fieldtheory://librarian/import?file=/path/to/reading.md&fullscreen=true - Import a reading and show it
 */
async function handleProtocolUrl(url: string): Promise<void> {
  console.log('[Main] Handling protocol URL:', url);

  try {
    const parsed = new URL(url);

    if (parsed.host === 'librarian' && parsed.pathname === '/import') {
      const filePath = parsed.searchParams.get('file');
      const fullscreen = parsed.searchParams.get('fullscreen') === 'true';

      if (!filePath) {
        console.warn('[Main] No file path in librarian import URL');
        return;
      }

      // Decode the file path (it may be URL-encoded)
      const decodedPath = decodeURIComponent(filePath);
      console.log('[Main] Opening reading from:', decodedPath, fullscreen ? '(fullscreen)' : '');

      // Read the file directly - in file-only architecture, readings are on disk
      if (librarianManager) {
        const reading = librarianManager.getReading(decodedPath);
        if (reading) {
          console.log('[Main] Found reading:', reading.title);
          // Send the reading path to the renderer to display it
          clipboardHistoryWindow?.getWindow()?.webContents.send('librarian:showReading', reading.path);
        } else {
          console.warn('[Main] Reading not found:', decodedPath);
        }
      }

      // Show and focus the clipboard history window (show() handles focusing)
      if (clipboardHistoryWindow) {
        const boundsToUse = restoreClipboardHistoryBounds();
        clipboardHistoryWindow.show(boundsToUse);
        // If fullscreen requested, notify renderer to enter fullscreen mode
        if (fullscreen) {
          clipboardHistoryWindow.getWindow()?.webContents.send('librarian:setFullscreen', true);
        }
      }
    }
  } catch (error) {
    console.error('[Main] Error handling protocol URL:', error);
  }
}

if (!gotTheLock) {
  app.quit();
} else {
  // Handle URL on macOS when app is already running
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleProtocolUrl(url);
  });

  app.on('second-instance', (_event, argv) => {
    // Handle URL from second instance (Windows/Linux)
    const url = argv.find(arg => arg.startsWith('fieldtheory://'));
    if (url) {
      handleProtocolUrl(url);
      return;
    }

    // If onboarding is not complete, focus the onboarding window instead.
    const prefs = preferencesManager?.get();
    if (!prefs?.onboardingComplete && onboardingWindow?.isVisible()) {
      // Focus is handled by the onboarding window itself.
      return;
    }
    // Show clipboard history when user tries to launch app again
    showClipboardHistoryOnActivate();
  });

  app.whenReady().then(async () => {
    console.log('[Main] App ready');

    // Migrate data from legacy app directories (littleai-mac, Oscar) if needed.
    migrateFromLegacyPaths();

    setupIPCHandlers();
    setupThemeIPCHandlers();
    setupLibrarianIPCHandlers();
    setupTranscribeIPCHandlers();
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
          label: 'View',
          submenu: [
            {
              label: 'Portable Commands',
              accelerator: 'Command+Shift+K',
              click: () => {
                if (commandLauncherWindow) {
                  commandLauncherWindow.show();
                }
              }
            },
            { type: 'separator' },
            {
              label: 'Toggle Developer Tools',
              accelerator: 'Command+Option+I',
              click: () => {
                const focusedWindow = BrowserWindow.getFocusedWindow();
                if (focusedWindow) {
                  focusedWindow.webContents.toggleDevTools();
                }
              }
            }
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
    // Only in unpackaged (development) builds.
    if (!app.isPackaged) {
      globalShortcut.register('Command+Shift+O', async () => {
        console.log('[Main] Reset onboarding shortcut triggered (dev mode)');
        if (!preferencesManager) return;

        await preferencesManager.save({
          onboardingComplete: false,
          onboardingStep: undefined,
        });

        // Refresh tray menu to show onboarding-only options
        if (trayManager) {
          trayManager.refreshMenu();
        }

        if (onboardingWindow) {
          onboardingWindow.close();
          onboardingWindow = null;
        }

        onboardingWindow = createOnboardingWindow();
        onboardingWindow.show(OnboardingStep.WELCOME);
      });
      console.log('[Main] Registered reset onboarding hotkey (dev mode only)');
    }

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
    await initClipboardCallbacks();

    // Preload clipboard history window for instant first open.
    // Only if onboarding is complete (user has set up the app).
    const currentPrefs = preferencesManager?.get();
    if (currentPrefs?.onboardingComplete) {
      clipboardHistoryWindow = initClipboardHistoryWindow();
      const boundsToUse = restoreClipboardHistoryBounds();
      clipboardHistoryWindow.preload(boundsToUse);
    }

    // Update tray manager with current hotkeys for menu display
    if (trayManager && clipboardManager && transcriberManager) {
      const historyHotkey = clipboardManager.getHotkeys().history || 'Option+Space';
      const transcriptionHotkey = transcriberManager.getHotkey() || 'Option+Shift+Space';
      const screenshotHotkey = clipboardManager.getHotkeys().screenshot || 'Command+4';
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

    // Apply launch at login setting.
    if (process.platform === 'darwin') {
      const launchAtLogin = preferencesManager?.getPreference('launchAtLogin') ?? true;
      app.setLoginItemSettings({
        openAtLogin: launchAtLogin,
        openAsHidden: true,
      });
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
    
    // Permission and model check at startup - always verify all requirements are met.
    // If any permission is missing or model not downloaded, show onboarding regardless of previous completion state.
    const prefs = preferencesManager?.get();
    const micStatus = systemPreferences.getMediaAccessStatus('microphone');
    const accessibilityStatus = systemPreferences.isTrustedAccessibilityClient(false);
    const screenStatus = systemPreferences.getMediaAccessStatus('screen');

    // Check if voice model is downloaded
    const modelDownloaded = transcriberManager?.getModelManager()
      ? await transcriberManager.getModelManager().isModelAvailable()
      : false;

    // Check if user is authenticated
    const isAuthenticated = authManager?.isAuthenticated() ?? false;

    // All three permissions, model download, AND authentication are required for full app functionality
    const isFullyReady =
      micStatus === 'granted' &&
      accessibilityStatus &&
      screenStatus === 'granted' &&
      modelDownloaded &&
      isAuthenticated;

    // Log startup state for debugging
    console.log('[Main] Startup requirements check:');
    console.log(`  - Microphone: ${micStatus}`);
    console.log(`  - Accessibility: ${accessibilityStatus}`);
    console.log(`  - Screen Recording: ${screenStatus}`);
    console.log(`  - Model Downloaded: ${modelDownloaded}`);
    console.log(`  - Authenticated: ${isAuthenticated}`);
    console.log(`  - onboardingComplete: ${prefs?.onboardingComplete ?? 'undefined'}`);
    console.log(`  - isFullyReady: ${isFullyReady}`);

    if (isFullyReady) {
      // All requirements met - mark onboarding complete and allow app access
      if (!prefs?.onboardingComplete) {
        console.log('[Main] All requirements met, marking onboarding complete');
        await preferencesManager?.save({ onboardingComplete: true });
      }
      console.log('[Main] All requirements met, registering hotkeys');
      registerHotkeysAfterOnboarding();

      // Log Librarian status at end of startup (user wants this visible without scrolling)
      if (librarianManager) {
        const readings = librarianManager.getReadings();
        const watchedDirs = librarianManager.getWatchedDirs();
        console.log(`[Librarian] Ready: ${readings.length} readings from ${watchedDirs.length} watched directories`);
      }
    } else {
      // Missing requirements - force onboarding flow
      console.log('[Main] Missing requirements, showing onboarding wizard');

      // Reset onboarding state if it was previously complete
      if (prefs?.onboardingComplete) {
        console.log('[Main] Resetting onboarding state due to missing requirements');
        await preferencesManager?.save({ onboardingComplete: false });

        // Refresh tray menu to show onboarding-only options
        if (trayManager) {
          trayManager.refreshMenu();
        }
      }

      onboardingWindow = createOnboardingWindow();

      // Determine the correct starting step based on what's missing
      // If only auth is missing (all permissions + model OK), start at account phase (step 2)
      const hasAllPermissions =
        micStatus === 'granted' &&
        accessibilityStatus &&
        screenStatus === 'granted';

      const hasAllPermissionsAndModel = hasAllPermissions && modelDownloaded;

      let startStep: number;
      if (hasAllPermissionsAndModel && !isAuthenticated) {
        // Only auth is missing - go straight to account phase
        startStep = 2; // account phase
        console.log('[Main] Only auth missing, starting at account phase');
      } else if (hasAllPermissions && !modelDownloaded) {
        // Only model is missing - go straight to model download phase
        startStep = OnboardingStep.MODEL_DOWNLOAD;
        console.log('[Main] Only model missing, starting at model download phase');
      } else {
        // Other requirements missing - use saved step or start from beginning
        startStep = prefs?.onboardingStep ?? OnboardingStep.WELCOME;
      }

      onboardingWindow.show(startStep);
      // Hotkeys will be registered when onboarding completes (see onboarding:complete handler)
    }

    // Monitor permissions and auth periodically - if any are revoked/lost, show onboarding again
    const REQUIREMENT_CHECK_INTERVAL = 5000; // Check every 5 seconds
    setInterval(async () => {
      const currentPrefs = preferencesManager?.get();
      if (!currentPrefs?.onboardingComplete) {
        // Already in onboarding mode, no need to check
        return;
      }

      const mic = systemPreferences.getMediaAccessStatus('microphone');
      const accessibility = systemPreferences.isTrustedAccessibilityClient(false);
      const screen = systemPreferences.getMediaAccessStatus('screen');
      const authenticated = authManager?.isAuthenticated() ?? false;
      const hasEverAuthenticated = authManager?.hasEverBeenAuthenticated() ?? false;

      const hasAllPermissions = mic === 'granted' && accessibility && screen === 'granted';

      // Check if permissions are revoked
      if (!hasAllPermissions) {
        console.log('[Main] Permission revoked, forcing onboarding flow');
        console.log(`  - Microphone: ${mic}`);
        console.log(`  - Accessibility: ${accessibility}`);
        console.log(`  - Screen Recording: ${screen}`);

        // Unregister all hotkeys - they shouldn't work without permissions
        globalShortcut.unregisterAll();
        console.log('[Main] Unregistered all hotkeys due to permission revocation');

        // Reset onboarding state
        await preferencesManager?.save({ onboardingComplete: false });

        // Refresh tray menu to show onboarding option
        if (trayManager) {
          trayManager.refreshMenu();
        }

        // Hide clipboard window if visible
        if (clipboardHistoryWindow?.isVisible()) {
          clipboardHistoryWindow.hide();
        }

        // Show onboarding window at beginning
        if (!onboardingWindow) {
          onboardingWindow = createOnboardingWindow();
        }
        onboardingWindow.show(OnboardingStep.WELCOME);
        return;
      }

      // Check if user logged out (permissions OK but auth lost)
      // IMPORTANT: Only force onboarding for truly new users who have never authenticated.
      // Existing users who temporarily lose auth (network issues, token expired) should
      // continue using local features. AuthManager will retry token refresh automatically.
      if (!authenticated && !hasEverAuthenticated) {
        console.log('[Main] New user needs to log in, showing onboarding account phase');

        // Unregister all hotkeys - app requires login for new users
        globalShortcut.unregisterAll();
        console.log('[Main] Unregistered all hotkeys for new user');

        // Reset onboarding state
        await preferencesManager?.save({ onboardingComplete: false });

        // Refresh tray menu to show onboarding option
        if (trayManager) {
          trayManager.refreshMenu();
        }

        // Hide clipboard window if visible
        if (clipboardHistoryWindow?.isVisible()) {
          clipboardHistoryWindow.hide();
        }

        // Show onboarding window at account phase (step 2)
        if (!onboardingWindow) {
          onboardingWindow = createOnboardingWindow();
        }
        onboardingWindow.show(2); // account phase
      }
    }, REQUIREMENT_CHECK_INTERVAL);

    app.on('activate', () => {
      // Always show clipboard history when app becomes active.
      // We no longer create the old main/settings window - the app is a background app
      // that primarily operates through the clipboard history window and tray.
      showClipboardHistoryOnActivate();

      // Refresh session if tokens are expiring soon to prevent auto-logout
      if (authManager) {
        authManager.refreshSessionIfNeeded().catch((err: Error) => {
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

    // Stop Chatterbox sidecar if running
    if (narrationManager) {
      narrationManager.stopChatterbox().catch((error) => {
        console.error('[Main] Failed to stop Chatterbox sidecar:', error);
      });
    }

    if (clipboardHistoryWindow) {
      clipboardHistoryWindow.destroy();
    }

    // Sync metrics before quitting (fire-and-forget, don't block quit)
    if (metricsManager) {
      metricsManager.shutdown().catch(() => {});
    }
  });
}