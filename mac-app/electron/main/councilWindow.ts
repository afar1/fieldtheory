/**
 * Council Window — Dedicated window for viewing council debates.
 *
 * A framed, resizable window with vibrancy that loads the council
 * React app. Temporarily shows in the Dock while visible so the
 * user can switch back to it like a normal app window.
 */

import { app, BrowserWindow, screen } from 'electron';
import path from 'path';
import { createLogger } from './logger';

const log = createLogger('CouncilWindow');

export interface CouncilWindowOptions {
  getShowInDock?: () => boolean;
}

export class CouncilWindow {
  private window: BrowserWindow | null = null;
  private getShowInDock: () => boolean;

  constructor(options: CouncilWindowOptions = {}) {
    this.getShowInDock = options.getShowInDock || (() => false);
  }

  /**
   * Show the council window, creating it if needed.
   * Temporarily shows in Dock if not already showing.
   */
  show(): void {
    if (this.window && this.window.isDestroyed()) {
      this.window = null;
    }

    const isNew = !this.window;
    if (isNew) {
      this.createWindow();
    }

    // Temporarily show in dock so user can switch back to this window
    const willToggleDock = process.platform === 'darwin' && !this.getShowInDock();
    if (willToggleDock) {
      log.info('[DI-Trace] council:show dock.show() BEFORE (newWindow=%s)', isNew);
      app.dock.show();
    }

    this.window!.show();
    this.window!.focus();
    log.info('[DI-Trace] council:show complete (newWindow=%s dockToggled=%s)', isNew, willToggleDock);
  }

  /**
   * Hide the council window. Restores dock visibility to preference.
   */
  hide(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
    }
    this.restoreDockState();
  }

  /**
   * Get the underlying BrowserWindow (for sending IPC events).
   */
  getWindow(): BrowserWindow | null {
    if (this.window && !this.window.isDestroyed()) {
      return this.window;
    }
    return null;
  }

  /**
   * Check if the window is visible.
   */
  isVisible(): boolean {
    return this.window !== null && !this.window.isDestroyed() && this.window.isVisible();
  }

  private createWindow(): void {
    // Center on active display
    const cursorPoint = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursorPoint);
    const width = 700;
    const height = 600;
    const x = Math.round(display.bounds.x + (display.bounds.width - width) / 2);
    const y = Math.round(display.bounds.y + (display.bounds.height - height) / 2);

    this.window = new BrowserWindow({
      width,
      height,
      x,
      y,
      frame: true,
      titleBarStyle: 'hiddenInset',
      vibrancy: 'sidebar',
      visualEffectState: 'active',
      resizable: true,
      minimizable: true,
      show: false,
      title: 'Council',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload.js'),
      },
    });

    this.window.on('closed', () => {
      this.window = null;
      this.restoreDockState();
    });

    // Load the council HTML
    const startUrl = process.env.ELECTRON_START_URL;
    if (startUrl) {
      const url = startUrl.endsWith('/') ? startUrl : `${startUrl}/`;
      this.window.loadURL(`${url}council.html`);
    } else {
      const htmlPath = path.join(app.getAppPath(), 'dist', 'council.html');
      this.window.loadFile(htmlPath);
    }
  }

  /**
   * Restore dock to the user's preference when council window is no longer visible.
   */
  private restoreDockState(): void {
    if (process.platform === 'darwin' && !this.getShowInDock()) {
      log.info('[DI-Trace] council:restoreDockState dock.hide()');
      app.dock.hide();
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
    this.restoreDockState();
  }
}
