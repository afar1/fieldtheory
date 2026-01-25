/**
 * Scenario Testing Window
 *
 * A floating draggable panel for superadmin users to simulate different
 * app states (tier, quotas, auth) for testing purposes.
 *
 * Design:
 * - Small floating panel (~280x400px)
 * - Frameless with drag region in header
 * - Always on top but doesn't hide on blur
 * - Persists position in preferences
 * - Only accessible to superadmins
 */

import { app, BrowserWindow, screen, ipcMain } from 'electron';
import path from 'path';
import type { PreferencesManager } from './preferences';

/**
 * Manages the scenario testing panel window.
 */
export class ScenarioTestingWindow {
  private window: BrowserWindow | null = null;
  private preferencesManager: PreferencesManager | null = null;
  private onHideCallback: (() => void) | null = null;

  private readonly WINDOW_WIDTH = 280;
  private readonly WINDOW_HEIGHT = 420;

  constructor(preferencesManager?: PreferencesManager) {
    this.preferencesManager = preferencesManager || null;

    // Listen for close requests from renderer.
    ipcMain.on('scenario-testing:close', () => {
      this.hide();
    });

    // Listen for position updates from renderer (drag).
    ipcMain.on('scenario-testing:moved', (_event, x: number, y: number) => {
      this.savePosition(x, y);
    });
  }

  /**
   * Show the scenario testing panel.
   */
  async show(): Promise<void> {
    // If window exists but is destroyed, reset it.
    if (this.window && this.window.isDestroyed()) {
      this.window = null;
    }

    if (!this.window) {
      this.createWindow();
    }

    // Position the window.
    const savedBounds = this.preferencesManager?.getPreference('scenarioTestingBounds');
    let x: number;
    let y: number;

    if (savedBounds?.x !== undefined && savedBounds?.y !== undefined) {
      // Use saved position.
      x = savedBounds.x;
      y = savedBounds.y;

      // Validate position is still on a valid display.
      const displays = screen.getAllDisplays();
      const isOnValidDisplay = displays.some(display => {
        const { x: dx, y: dy, width: dw, height: dh } = display.bounds;
        return x >= dx && x < dx + dw && y >= dy && y < dy + dh;
      });

      if (!isOnValidDisplay) {
        // Saved position is offscreen, reset to default.
        const primaryDisplay = screen.getPrimaryDisplay();
        x = primaryDisplay.bounds.x + primaryDisplay.bounds.width - this.WINDOW_WIDTH - 20;
        y = primaryDisplay.bounds.y + 60;
      }
    } else {
      // Default: top-right corner of primary display.
      const primaryDisplay = screen.getPrimaryDisplay();
      x = primaryDisplay.bounds.x + primaryDisplay.bounds.width - this.WINDOW_WIDTH - 20;
      y = primaryDisplay.bounds.y + 60;
    }

    this.window!.setBounds({
      x,
      y,
      width: this.WINDOW_WIDTH,
      height: this.WINDOW_HEIGHT,
    });

    console.log('[ScenarioTesting] Showing window at:', x, y);
    this.window!.show();
    this.window!.moveTop();
    this.window!.focus();

    // Tell renderer to refresh state.
    this.window!.webContents.send('scenario-testing:refresh');
  }

  /**
   * Hide the scenario testing panel.
   */
  hide(): void {
    if (this.window && !this.window.isDestroyed()) {
      // Save position before hiding.
      const bounds = this.window.getBounds();
      this.savePosition(bounds.x, bounds.y);
      this.window.hide();
    }
    // Notify listener that panel was hidden.
    this.onHideCallback?.();
  }

  /**
   * Set callback to be called when the panel is hidden or closed.
   * Used to re-enable clipboard history auto-hide behavior.
   */
  setOnHide(callback: () => void): void {
    this.onHideCallback = callback;
  }

  /**
   * Check if the panel is visible.
   */
  isVisible(): boolean {
    return this.window !== null && !this.window.isDestroyed() && this.window.isVisible();
  }

  /**
   * Toggle panel visibility.
   */
  toggle(): void {
    if (this.isVisible()) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Save panel position to preferences.
   */
  private async savePosition(x: number, y: number): Promise<void> {
    if (this.preferencesManager) {
      await this.preferencesManager.save({
        scenarioTestingBounds: { x, y },
      });
    }
  }

  /**
   * Create the scenario testing window.
   */
  private createWindow(): void {
    this.window = new BrowserWindow({
      width: this.WINDOW_WIDTH,
      height: this.WINDOW_HEIGHT,
      frame: false,
      transparent: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      hasShadow: true,
      backgroundColor: '#1a1a1a',
      roundedCorners: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload.js'),
      },
    });

    // Stay on top of everything.
    this.window.setAlwaysOnTop(true, 'floating', 1);
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // Track position changes from native window dragging.
    this.window.on('moved', () => {
      if (this.window && !this.window.isDestroyed()) {
        const bounds = this.window.getBounds();
        this.savePosition(bounds.x, bounds.y);
      }
    });

    this.window.on('closed', () => {
      this.window = null;
      // Notify listener that panel was closed.
      this.onHideCallback?.();
    });

    // Load the scenario testing HTML.
    const startUrl = process.env.ELECTRON_START_URL;
    if (startUrl) {
      const url = startUrl.endsWith('/') ? startUrl : `${startUrl}/`;
      this.window.loadURL(`${url}scenario-testing.html`);
    } else {
      const htmlPath = path.join(app.getAppPath(), 'dist', 'scenario-testing.html');
      console.log('[ScenarioTesting] Loading HTML from:', htmlPath);
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
