import { app, BrowserWindow, BrowserWindowConstructorOptions, screen } from 'electron';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
   * @param savedBounds Optional saved bounds to restore position/size
   */
  async show(savedBounds?: { x: number; y: number; width: number; height: number }): Promise<void> {
    // Capture the previous app BEFORE we show our window and take focus.
    await this.capturePreviousApp();
    
    // Refresh the list of running apps for Tab cycling.
    await this.getRunningApps();
    
    if (this.window && !this.window.isDestroyed()) {
      // Show and take focus
      this.window.show();
      this.window.focus();
      // Recalculate and send dialog bounds
      this.sendDialogBounds(savedBounds);
      // Notify renderer to reset search query and send target app info.
      this.window.webContents.send('clipboard:showHistory');
      this.sendTargetAppInfo();
      return;
    }

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
        this.previousApp = { bundleId, name };
        // Reset selected target to previous app when window is shown.
        this.selectedTargetApp = null;
        return this.previousApp;
      }
    } catch (error) {
      console.error('[ClipboardHistoryWindow] Failed to get frontmost app:', error);
    }
    return null;
  }

  /**
   * Get the current target app (user-selected or previous app).
   */
  getTargetApp(): RunningApp | null {
    return this.selectedTargetApp || this.previousApp;
  }

  /**
   * Set the target app for pasting.
   */
  setTargetApp(app: RunningApp | null): void {
    this.selectedTargetApp = app;
  }

  /**
   * Get list of running applications (for Tab cycling).
   * Filters to visible apps with windows (not background processes).
   */
  async getRunningApps(): Promise<RunningApp[]> {
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
          // Skip our own app.
          if (!bundleId.includes('little-one') && !bundleId.includes('Little One')) {
            apps.push({ bundleId: bundleId.trim(), name: name.trim() });
          }
        }
      }
      
      this.runningApps = apps;
      return apps;
    } catch (error) {
      console.error('[ClipboardHistoryWindow] Failed to get running apps:', error);
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
   */
  async activateApp(bundleId: string): Promise<boolean> {
    try {
      const script = `
        tell application id "${bundleId}"
          activate
        end tell
      `;
      await execAsync(`osascript -e '${script}'`);
      return true;
    } catch (error) {
      console.error('[ClipboardHistoryWindow] Failed to activate app:', error);
      return false;
    }
  }

  /**
   * Paste content to a specific app.
   * Activates the app first, then sends Cmd+V.
   */
  async pasteToApp(bundleId: string): Promise<boolean> {
    try {
      // Small delay after hiding our window to ensure focus transfer.
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Activate the target app and paste.
      const script = `
        tell application id "${bundleId}"
          activate
        end tell
        delay 0.1
        tell application "System Events"
          keystroke "v" using command down
        end tell
      `;
      await execAsync(`osascript -e '${script}'`);
      return true;
    } catch (error) {
      console.error('[ClipboardHistoryWindow] Failed to paste to app:', error);
      return false;
    }
  }
}

