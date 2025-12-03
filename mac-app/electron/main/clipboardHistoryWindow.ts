import { app, BrowserWindow, BrowserWindowConstructorOptions, screen } from 'electron';
import path from 'path';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

/**
 * Check if an app is the Electron app itself (should be excluded from target apps).
 */
function isElectronApp(bundleId: string, appName: string): boolean {
  const appNameLower = appName.toLowerCase();
  const bundleIdLower = bundleId.toLowerCase();
  const currentAppName = app.getName().toLowerCase();
  
  // Check if bundle ID or name matches our app
  return (
    bundleIdLower.includes('oscar') ||
    bundleIdLower.includes('little-one') ||
    bundleIdLower.includes('littleai') ||
    bundleIdLower.includes('electron') ||
    appNameLower.includes('oscar') ||
    appNameLower.includes('little one') ||
    appNameLower === currentAppName ||
    bundleIdLower === process.execPath.toLowerCase()
  );
}

/**
 * Represents a running application with its bundle ID and display name.
 */
export interface RunningApp {
  bundleId: string;
  name: string;
}

/**
 * Manages the clipboard history popup window.
 * Shows an Alfred-style popup that can appear independently of the main window.
 */
export class ClipboardHistoryWindow {
  private window: BrowserWindow | null = null;
  private previouslyFocusedWindow: BrowserWindow | null = null;
  
  // The app that was active before we showed the clipboard history.
  // This is the default target for pasting.
  private previousApp: RunningApp | null = null;
  
  // User-selected target app (if different from previousApp).
  private selectedTargetApp: RunningApp | null = null;
  
  // Cached list of running apps for Tab cycling.
  private runningApps: RunningApp[] = [];
  
  // Cache for running apps with TTL (5 seconds)
  private runningAppsCache: { apps: RunningApp[]; timestamp: number } | null = null;
  private readonly RUNNING_APPS_CACHE_TTL = 5000; // 5 seconds
  
  private readonly DIALOG_WIDTH = 900;
  private readonly DIALOG_HEIGHT = 600;

  /**
   * Generate a display configuration hash to detect display arrangement changes.
   */
  static getDisplayConfigHash(): string {
    const displays = screen.getAllDisplays();
    const minX = Math.min(...displays.map(d => d.bounds.x));
    const minY = Math.min(...displays.map(d => d.bounds.y));
    const maxX = Math.max(...displays.map(d => d.bounds.x + d.bounds.width));
    const maxY = Math.max(...displays.map(d => d.bounds.y + d.bounds.height));
    const totalWidth = maxX - minX;
    const totalHeight = maxY - minY;
    return `${displays.length}-${totalWidth}x${totalHeight}`;
  }

  /**
   * Show or toggle the clipboard history window.
   */
  toggle(): void {
    // If window exists but is destroyed, reset it
    if (this.window && this.window.isDestroyed()) {
      this.window = null;
    }

    if (this.window && this.window.isVisible()) {
      // Hide it
      this.window.hide();
      return;
    }

    // Show it (will create if needed)
    this.show();
  }

  /**
   * Show the clipboard history window.
   * Window takes focus like Alfred - uses standard keyboard input.
   * Shows window immediately, then fetches app data in background for instant UX.
   * @param savedBounds Optional saved bounds to restore position/size
   */
  show(savedBounds?: { x: number; y: number; width: number; height: number }): void {
    // If window exists, show it immediately with cached data, then refresh in background
    if (this.window && !this.window.isDestroyed()) {
      // Show window immediately with cached/stale data
      this.window.show();
      this.window.focus();
      // Recalculate and send dialog bounds
      this.sendDialogBounds(savedBounds);
      // Notify renderer to reset search query and send target app info (with cached data)
      this.window.webContents.send('clipboard:showHistory');
      this.sendTargetAppInfo();
      
      // Fetch fresh app data in background and update when ready
      this.refreshAppDataInBackground();
      return;
    }
    
    // For new window creation, create window immediately, fetch app data in background.
    // This avoids blocking on AppleScript calls.
    this.createWindow(savedBounds);
    
    // Fetch app data in background (don't await)
    this.refreshAppDataInBackground();
  }
  
  /**
   * Create the clipboard history window.
   * Separated from show() to allow non-blocking window creation.
   */
  private createWindow(savedBounds?: { x: number; y: number; width: number; height: number }): void {

    // Calculate union of all displays for full-screen overlay
    const displays = screen.getAllDisplays();
    const minX = Math.min(...displays.map(d => d.bounds.x));
    const minY = Math.min(...displays.map(d => d.bounds.y));
    const maxX = Math.max(...displays.map(d => d.bounds.x + d.bounds.width));
    const maxY = Math.max(...displays.map(d => d.bounds.y + d.bounds.height));
    const allDisplaysWidth = maxX - minX;
    const allDisplaysHeight = maxY - minY;

    // Use saved bounds if provided, otherwise calculate default position
    // Note: savedBounds are already in overlay-relative coordinates (converted in index.ts)
    let dialogLeft: number;
    let dialogTop: number;
    let dialogWidth: number;
    let dialogHeight: number;

    if (savedBounds) {
      dialogLeft = savedBounds.x;
      dialogTop = savedBounds.y;
      dialogWidth = savedBounds.width;
      dialogHeight = savedBounds.height;
      
      // Clamp to ensure dialog stays within overlay bounds
      dialogLeft = Math.max(0, Math.min(dialogLeft, allDisplaysWidth - dialogWidth));
      dialogTop = Math.max(0, Math.min(dialogTop, allDisplaysHeight - dialogHeight));
    } else {
      // Calculate default position: 80px from top, centered horizontally on active display
      const cursorPoint = screen.getCursorScreenPoint();
      const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
      const displayBounds = activeDisplay.bounds;
      
      dialogLeft = (displayBounds.x + displayBounds.width / 2 - this.DIALOG_WIDTH / 2) - minX;
      dialogTop = 80 + (displayBounds.y - minY);
      dialogWidth = this.DIALOG_WIDTH;
      dialogHeight = this.DIALOG_HEIGHT;
      
      // Clamp position to ensure dialog stays within overlay bounds
      dialogLeft = Math.max(0, Math.min(dialogLeft, allDisplaysWidth - dialogWidth));
      dialogTop = Math.max(0, Math.min(dialogTop, allDisplaysHeight - dialogHeight));
    }

    const options: BrowserWindowConstructorOptions = {
      width: allDisplaysWidth,
      height: allDisplaysHeight,
      x: minX,
      y: minY,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: true,
      fullscreenable: false,
      simpleFullscreen: false,
      show: false,
      backgroundColor: '#00000000',
      hasShadow: false,
      roundedCorners: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload.js'),
      },
    };

    // Store currently focused window so we can restore focus later.
    this.previouslyFocusedWindow = BrowserWindow.getFocusedWindow() || null;

    this.window = new BrowserWindow(options);

    this.window.on('closed', () => {
      this.window = null;
    });

    this.window.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error('[ClipboardHistoryWindow] Load failed:', errorCode, errorDescription);
    });

    // Show window only after content loads to avoid blank screen
    // Show and take focus (like Alfred)
    this.window.webContents.once('did-finish-load', () => {
      console.log('[ClipboardHistoryWindow] Content loaded');
      if (this.window && !this.window.isDestroyed()) {
        this.window.show();
        this.window.focus();
        // Send dialog bounds to renderer
        this.sendDialogBounds(savedBounds);
        // Notify renderer to reset search query
        this.window.webContents.send('clipboard:showHistory');
        // Send target app info
        this.sendTargetAppInfo();
      }
    });

    // Load clipboard history HTML
    const startUrl = process.env.ELECTRON_START_URL;
    if (startUrl) {
      // Ensure URL has trailing slash
      const url = startUrl.endsWith('/') ? startUrl : `${startUrl}/`;
      this.window.loadURL(`${url}clipboard-history.html`);
    } else {
      // Use absolute path via app.getAppPath() to ensure correct resolution
      // regardless of working directory (important for npm start vs packaged app)
      const htmlPath = path.join(app.getAppPath(), 'dist', 'clipboard-history.html');
      console.log('[ClipboardHistoryWindow] Loading HTML from:', htmlPath);
      this.window.loadFile(htmlPath);
      
      // Add error handler to debug loading issues
      this.window.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        console.error('[ClipboardHistoryWindow] Failed to load:', errorCode, errorDescription, validatedURL);
      });
    }
  }

  /**
   * Hide the clipboard history window.
   * Restores focus to the previous app (including exact input field).
   */
  hide(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
    }

    // Hide entire app to guarantee focus returns to previous app
    // This ensures the exact input field that was active gets focus back
    app.hide();
    this.previouslyFocusedWindow = null;
  }

  /**
   * Get the BrowserWindow instance for IPC communication.
   */
  getWindow(): BrowserWindow | null {
    return this.window;
  }

  /**
   * Check if the window is visible.
   */
  isVisible(): boolean {
    return this.window !== null && !this.window.isDestroyed() && this.window.isVisible();
  }

  /**
   * Send target app info to renderer.
   * Includes current target, list of running apps, and index for Tab cycling.
   */
  private sendTargetAppInfo(): void {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    const targetApp = this.getTargetApp();
    this.window.webContents.send('clipboard:targetAppInfo', {
      targetApp,
      runningApps: this.runningApps,
    });
  }

  /**
   * Send dialog bounds to renderer.
   */
  private sendDialogBounds(savedBounds?: { x: number; y: number; width: number; height: number }): void {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }

    const displays = screen.getAllDisplays();
    const minX = Math.min(...displays.map(d => d.bounds.x));
    const minY = Math.min(...displays.map(d => d.bounds.y));
    const maxX = Math.max(...displays.map(d => d.bounds.x + d.bounds.width));
    const maxY = Math.max(...displays.map(d => d.bounds.y + d.bounds.height));
    const allDisplaysWidth = maxX - minX;
    const allDisplaysHeight = maxY - minY;

    let dialogLeft: number;
    let dialogTop: number;
    let dialogWidth: number;
    let dialogHeight: number;

    if (savedBounds) {
      // savedBounds are already in overlay-relative coordinates (converted in index.ts)
      dialogLeft = savedBounds.x;
      dialogTop = savedBounds.y;
      dialogWidth = savedBounds.width;
      dialogHeight = savedBounds.height;
      
      // Clamp to ensure dialog stays within overlay bounds
      dialogLeft = Math.max(0, Math.min(dialogLeft, allDisplaysWidth - dialogWidth));
      dialogTop = Math.max(0, Math.min(dialogTop, allDisplaysHeight - dialogHeight));
    } else {
      // Calculate default position: 80px from top, centered horizontally on active display
      const cursorPoint = screen.getCursorScreenPoint();
      const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
      const displayBounds = activeDisplay.bounds;
      
      dialogLeft = (displayBounds.x + displayBounds.width / 2 - this.DIALOG_WIDTH / 2) - minX;
      dialogTop = 80 + (displayBounds.y - minY);
      dialogWidth = this.DIALOG_WIDTH;
      dialogHeight = this.DIALOG_HEIGHT;
      
      // Clamp position to ensure dialog stays within overlay bounds
      dialogLeft = Math.max(0, Math.min(dialogLeft, allDisplaysWidth - dialogWidth));
      dialogTop = Math.max(0, Math.min(dialogTop, allDisplaysHeight - dialogHeight));
    }

    // Send both old format (for backward compatibility) and new format
    this.window.webContents.send('clipboard:dialogPosition', {
      left: dialogLeft,
      top: dialogTop,
    });
    this.window.webContents.send('clipboard:dialogBounds', {
      x: dialogLeft,
      y: dialogTop,
      width: dialogWidth,
      height: dialogHeight,
    });
  }

  /**
   * Destroy the window.
   */
  destroy(): void {
    if (this.window) {
      this.window.close();
      this.window = null;
    }
  }

  /**
   * Get the frontmost app's bundle ID and name using AppleScript.
   * Called before showing the clipboard history to track what app to paste into.
   * Excludes the Electron app itself - if Electron app is frontmost, returns null.
   * Only resets selectedTargetApp on first capture to preserve user's manual selections.
   */
  async capturePreviousApp(): Promise<RunningApp | null> {
    try {
      // Get both bundle ID and name in a single AppleScript call.
      const script = `
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          return (bundle identifier of frontApp) & "|" & (name of frontApp)
        end tell
      `;
      const { stdout } = await execAsync(`osascript -e '${script}'`);
      const [bundleId, name] = stdout.trim().split('|');
      
      if (bundleId && name) {
        // Skip if this is the Electron app itself
        if (isElectronApp(bundleId, name)) {
          console.log('[ClipboardHistoryWindow] Frontmost app is Electron app, skipping');
          return null;
        }
        
        // Only reset selectedTargetApp if this is the first time capturing previousApp.
        // This preserves user's manual target app selections when window is reopened.
        const isFirstCapture = this.previousApp === null;
        this.previousApp = { bundleId, name };
        
        if (isFirstCapture) {
          // Reset selected target to previous app only on first capture.
          this.selectedTargetApp = null;
        }
        // Otherwise, preserve user's manual selection (if any).
        
        return this.previousApp;
      }
    } catch (error) {
      console.error('[ClipboardHistoryWindow] Failed to get frontmost app:', error);
    }
    return null;
  }

  /**
   * Capture the frontmost app BEFORE showing the window.
   * Must be called before show() because once the window takes focus, Oscar becomes frontmost.
   * Always resets selectedTargetApp since this is a fresh window open.
   */
  async capturePreviousAppBeforeShow(): Promise<void> {
    try {
      const script = `
        tell application "System Events"
          set frontApp to first application process whose frontmost is true
          return (bundle identifier of frontApp) & "|" & (name of frontApp)
        end tell
      `;
      const { stdout } = await execAsync(`osascript -e '${script}'`);
      const [bundleId, name] = stdout.trim().split('|');
      
      if (bundleId && name && !isElectronApp(bundleId, name)) {
        this.previousApp = { bundleId, name };
        // Reset selected target when opening window fresh.
        this.selectedTargetApp = null;
        console.log(`[ClipboardHistoryWindow] Captured previous app: ${name} (${bundleId})`);
      }
    } catch (error) {
      console.error('[ClipboardHistoryWindow] Failed to capture previous app:', error);
    }
  }

  /**
   * Get the current target app (user-selected or previous app).
   * If no previous app (e.g., Electron app was frontmost), use first running app as fallback.
   */
  getTargetApp(): RunningApp | null {
    if (this.selectedTargetApp) {
      return this.selectedTargetApp;
    }
    if (this.previousApp) {
      return this.previousApp;
    }
    // Fallback: use first running app if available
    if (this.runningApps.length > 0) {
      return this.runningApps[0];
    }
    return null;
  }

  /**
   * Set the target app for pasting.
   */
  setTargetApp(app: RunningApp | null): void {
    this.selectedTargetApp = app;
  }

  /**
   * Refresh app data in background after window is shown.
   * Only refreshes running apps list - previousApp is captured before show() via
   * capturePreviousAppBeforeShow() to avoid race condition where Oscar becomes frontmost.
   */
  private async refreshAppDataInBackground(): Promise<void> {
    // Only refresh running apps - previousApp was captured before show().
    await this.getRunningApps();
    
    // Send updated info to renderer
    this.sendTargetAppInfo();
  }

  /**
   * Get list of running applications (for Tab cycling).
   * Filters to visible apps with windows (not background processes).
   * Uses a 5-second cache to avoid repeated expensive AppleScript calls.
   */
  async getRunningApps(): Promise<RunningApp[]> {
    // Check cache first
    if (this.runningAppsCache) {
      const age = Date.now() - this.runningAppsCache.timestamp;
      if (age < this.RUNNING_APPS_CACHE_TTL) {
        // Cache is still valid, return cached data
        this.runningApps = this.runningAppsCache.apps;
        return this.runningAppsCache.apps;
      }
    }
    
    try {
      // Get visible application processes (those that appear in Dock).
      const script = `
        set appList to ""
        tell application "System Events"
          set visibleApps to every application process whose visible is true
          repeat with appProc in visibleApps
            set appBundleId to bundle identifier of appProc
            set appName to name of appProc
            if appBundleId is not missing value then
              set appList to appList & appBundleId & "|" & appName & "\\n"
            end if
          end repeat
        end tell
        return appList
      `;
      const { stdout } = await execAsync(`osascript -e '${script}'`);
      
      const apps: RunningApp[] = [];
      const lines = stdout.trim().split('\n').filter(line => line.includes('|'));
      
      for (const line of lines) {
        const [bundleId, name] = line.split('|');
        if (bundleId && name) {
          // Skip our own Electron app.
          if (!isElectronApp(bundleId.trim(), name.trim())) {
            apps.push({ bundleId: bundleId.trim(), name: name.trim() });
          }
        }
      }
      
      // Sort apps: put previousApp first so Tab cycling starts with the most recent app.
      if (this.previousApp) {
        const previousBundleId = this.previousApp.bundleId;
        apps.sort((a, b) => {
          if (a.bundleId === previousBundleId) return -1;
          if (b.bundleId === previousBundleId) return 1;
          return 0; // Preserve original order for other apps.
        });
      }
      
      // Update cache
      this.runningApps = apps;
      this.runningAppsCache = {
        apps,
        timestamp: Date.now(),
      };
      
      return apps;
    } catch (error) {
      console.error('[ClipboardHistoryWindow] Failed to get running apps:', error);
      // Return cached data if available, even if stale
      if (this.runningAppsCache) {
        return this.runningAppsCache.apps;
      }
      return [];
    }
  }

  /**
   * Get cached running apps list.
   */
  getCachedRunningApps(): RunningApp[] {
    return this.runningApps;
  }

  /**
   * Activate (focus) a specific app by bundle ID.
   * This brings the app to the foreground.
   * Uses execFile to prevent command injection via bundleId.
   */
  async activateApp(bundleId: string): Promise<boolean> {
    try {
      // Validate bundleId doesn't contain quotes (bundle IDs shouldn't have them anyway)
      if (bundleId.includes('"') || bundleId.includes("'")) {
        console.error('[ClipboardHistoryWindow] Invalid bundleId contains quotes:', bundleId);
        return false;
      }
      // Use execFile with array arguments to avoid shell interpretation
      // This prevents command injection even if bundleId contains special characters
      const script = `tell application id "${bundleId}"\n  activate\nend tell`;
      await execFileAsync('osascript', ['-e', script]);
      return true;
    } catch (error) {
      console.error('[ClipboardHistoryWindow] Failed to activate app:', error);
      return false;
    }
  }

  /**
   * Paste content to a specific app.
   * Activates the app first, then sends Cmd+V.
   * Uses execFile to prevent command injection via bundleId.
   */
  async pasteToApp(bundleId: string): Promise<boolean> {
    try {
      // Validate bundleId doesn't contain quotes (bundle IDs shouldn't have them anyway)
      if (bundleId.includes('"') || bundleId.includes("'")) {
        console.error('[ClipboardHistoryWindow] Invalid bundleId contains quotes:', bundleId);
        return false;
      }
      // Small delay after hiding our window to ensure focus transfer.
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Use execFile with array arguments to avoid shell interpretation
      // This prevents command injection even if bundleId contains special characters
      const script = `tell application id "${bundleId}"\n  activate\nend tell\ndelay 0.1\ntell application "System Events"\n  keystroke "v" using command down\nend tell`;
      await execFileAsync('osascript', ['-e', script]);
      return true;
    } catch (error) {
      console.error('[ClipboardHistoryWindow] Failed to paste to app:', error);
      return false;
    }
  }
}

