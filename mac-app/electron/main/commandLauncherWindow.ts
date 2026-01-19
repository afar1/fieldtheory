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
import type { NativeHelper, FrontmostAppInfo } from './nativeHelper';

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
    bundleIdLower.includes('fieldtheory') ||
    bundleIdLower.includes('electron') ||
    appNameLower.includes('field theory') ||
    appNameLower === currentAppName ||
    bundleIdLower === process.execPath.toLowerCase()
  );
}

/**
 * Manages the command launcher popup window.
 */
export class CommandLauncherWindow {
  private window: BrowserWindow | null = null;
  private nativeHelper: NativeHelper | null = null;

  // The app that was active before we showed the launcher.
  private previousApp: RunningApp | null = null;

  // Window dimensions - starts small, expands for results.
  private readonly WINDOW_WIDTH = 320;
  private readonly WINDOW_HEIGHT_COLLAPSED = 36;
  private readonly WINDOW_HEIGHT_EXPANDED = 300;

  constructor(nativeHelper?: NativeHelper) {
    this.nativeHelper = nativeHelper || null;
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
   * Fetches fresh window bounds at hotkey time (~1-5ms) for accurate positioning,
   * even when switching between windows of the same app.
   */
  async show(): Promise<void> {
    // If window exists but is destroyed, reset it.
    if (this.window && this.window.isDestroyed()) {
      this.window = null;
    }

    if (!this.window) {
      this.createWindow();
    }

    // Get cached frontmost app info for previous app (bundleId/name).
    const frontmostApp = this.nativeHelper?.getFrontmostApp();

    // Store previous app for paste-back feature.
    if (frontmostApp?.bundleId && frontmostApp?.name) {
      this.previousApp = {
        bundleId: frontmostApp.bundleId,
        name: frontmostApp.name,
      };
    }

    let x: number;
    let y: number;

    // Fetch fresh window bounds on-demand (~1-5ms).
    // This handles switching between windows of the same app.
    const windowBounds = await this.nativeHelper?.getFrontmostWindowBounds();

    if (windowBounds) {
      // Center on the current frontmost window.
      x = Math.round(windowBounds.x + (windowBounds.width - this.WINDOW_WIDTH) / 2);
      y = Math.round(windowBounds.y + (windowBounds.height - this.WINDOW_HEIGHT_EXPANDED) / 2 - 50);
    } else {
      // Fallback: center on active display.
      const cursorPoint = screen.getCursorScreenPoint();
      const display = screen.getDisplayNearestPoint(cursorPoint);
      x = Math.round(display.bounds.x + (display.bounds.width - this.WINDOW_WIDTH) / 2);
      y = Math.round(display.bounds.y + (display.bounds.height - this.WINDOW_HEIGHT_EXPANDED) / 2 - 50);
    }

    console.log(`[CommandLauncher] Setting bounds: x=${x}, y=${y}, w=${this.WINDOW_WIDTH}, h=${this.WINDOW_HEIGHT_COLLAPSED}`);

    this.window!.setBounds({
      x,
      y,
      width: this.WINDOW_WIDTH,
      height: this.WINDOW_HEIGHT_COLLAPSED,
    });

    console.log('[CommandLauncher] Showing window...');
    this.window!.show();
    this.window!.focus();
    console.log('[CommandLauncher] Window shown, isVisible:', this.window!.isVisible());

    // Tell renderer to reset state.
    this.window!.webContents.send('command-launcher:reset');
  }
  
  /**
   * Hide the command launcher window.
   * Calls app.hide() to restore focus to the previous app (Alfred behavior).
   */
  hide(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
    }
    // Hide entire app to restore focus to previous app
    app.hide();
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
      vibrancy: 'hud',
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
