/**
 * Command Launcher Window
 * 
 * A small, centered popup window for quickly searching and invoking
 * portable commands. Appears on Cmd+Shift+K, disappears on selection
 * or Escape/blur.
 * 
 * Design:
 * - Frameless, transparent window with dark background
 * - Starts small (just input field), expands when results appear
 * - Dead center of active display
 * - Auto-focuses input for immediate typing
 * - Hides on blur (click away) or Escape
 */

import { app, BrowserWindow, screen, ipcMain } from 'electron';
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
 * Check if an app is the Electron app itself (should be excluded from target apps).
 */
function isElectronApp(bundleId: string, appName: string): boolean {
  const appNameLower = appName.toLowerCase();
  const bundleIdLower = bundleId.toLowerCase();
  const currentAppName = app.getName().toLowerCase();
  
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
 * Manages the command launcher popup window.
 */
export class CommandLauncherWindow {
  private window: BrowserWindow | null = null;
  
  // The app that was active before we showed the launcher.
  private previousApp: RunningApp | null = null;
  
  // Window dimensions - starts small, expands for results.
  private readonly WINDOW_WIDTH = 340;
  private readonly WINDOW_HEIGHT_COLLAPSED = 42;
  private readonly WINDOW_HEIGHT_EXPANDED = 300;
  
  constructor() {
    // Listen for resize requests from renderer.
    ipcMain.on('command-launcher:resize', (_event, height: number) => {
      if (this.window && !this.window.isDestroyed()) {
        const bounds = this.window.getBounds();
        this.window.setBounds({
          x: bounds.x,
          y: bounds.y,
          width: this.WINDOW_WIDTH,
          height: Math.min(height, this.WINDOW_HEIGHT_EXPANDED),
        });
      }
    });
    
    // Listen for close requests from renderer.
    ipcMain.on('command-launcher:close', () => {
      this.hide();
    });
  }
  
  /**
   * Show the command launcher window.
   * Captures the previous app before showing so we know where to paste.
   */
  async show(): Promise<void> {
    // Capture the frontmost app before showing the launcher.
    await this.capturePreviousApp();
    
    // If window exists but is destroyed, reset it.
    if (this.window && this.window.isDestroyed()) {
      this.window = null;
    }
    
    if (!this.window) {
      this.createWindow();
    }
    
    // Position dead center of active display.
    const cursorPoint = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursorPoint);
    const x = Math.round(display.bounds.x + (display.bounds.width - this.WINDOW_WIDTH) / 2);
    const y = Math.round(display.bounds.y + (display.bounds.height - this.WINDOW_HEIGHT_EXPANDED) / 2 - 50);
    
    this.window!.setBounds({
      x,
      y,
      width: this.WINDOW_WIDTH,
      height: this.WINDOW_HEIGHT_COLLAPSED,
    });
    
    this.window!.show();
    this.window!.focus();
    
    // Tell renderer to reset state.
    this.window!.webContents.send('command-launcher:reset');
  }
  
  /**
   * Hide the command launcher window.
   */
  hide(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
    }
  }
  
  /**
   * Check if the command launcher window is visible.
   */
  isVisible(): boolean {
    return this.window !== null && !this.window.isDestroyed() && this.window.isVisible();
  }
  
  /**
   * Get the app that was active before showing the launcher.
   */
  getPreviousApp(): RunningApp | null {
    return this.previousApp;
  }
  
  /**
   * Capture the frontmost app before showing the window.
   */
  private async capturePreviousApp(): Promise<void> {
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
        console.log(`[CommandLauncher] Captured previous app: ${name} (${bundleId})`);
      } else {
        this.previousApp = null;
      }
    } catch (error) {
      console.error('[CommandLauncher] Failed to get frontmost app:', error);
      this.previousApp = null;
    }
  }
  
  /**
   * Create the command launcher window.
   */
  private createWindow(): void {
    this.window = new BrowserWindow({
      width: this.WINDOW_WIDTH,
      height: this.WINDOW_HEIGHT_COLLAPSED,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      hasShadow: true,
      vibrancy: 'under-window',
      visualEffectState: 'active',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload.js'),
      },
    });
    
    // Stay on top of everything.
    this.window.setAlwaysOnTop(true, 'screen-saver', 1);
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    
    // Hide on blur (user clicked away).
    this.window.on('blur', () => {
      console.log('[CommandLauncher] Window lost focus, hiding');
      this.hide();
    });
    
    this.window.on('closed', () => {
      this.window = null;
    });
    
    // Load the command launcher HTML.
    const startUrl = process.env.ELECTRON_START_URL;
    if (startUrl) {
      const url = startUrl.endsWith('/') ? startUrl : `${startUrl}/`;
      this.window.loadURL(`${url}command-launcher.html`);
    } else {
      const htmlPath = path.join(app.getAppPath(), 'dist', 'command-launcher.html');
      console.log('[CommandLauncher] Loading HTML from:', htmlPath);
      this.window.loadFile(htmlPath);
    }
  }
  
  /**
   * Destroy the window and clean up.
   */
  destroy(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
      this.window = null;
    }
  }
}
