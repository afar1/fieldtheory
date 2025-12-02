import { app, BrowserWindow, BrowserWindowConstructorOptions, screen } from 'electron';
import path from 'path';

/**
 * Manages the clipboard history popup window.
 * Shows an Alfred-style popup that can appear independently of the main window.
 */
export class ClipboardHistoryWindow {
  private window: BrowserWindow | null = null;
  private previouslyFocusedWindow: BrowserWindow | null = null;
  
  private readonly DIALOG_WIDTH = 900;
  private readonly DIALOG_HEIGHT = 600;

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
   */
  show(): void {
    if (this.window && !this.window.isDestroyed()) {
      // Show and take focus
      this.window.show();
      this.window.focus();
      // Recalculate and send dialog position
      this.sendDialogPosition();
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

    // Find active display (display containing cursor)
    const cursorPoint = screen.getCursorScreenPoint();
    const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
    const displayBounds = activeDisplay.bounds;

    // Calculate dialog position: 80px from top, centered horizontally on active display
    // Position is relative to the overlay window origin (minX, minY)
    const dialogLeft = (displayBounds.x + displayBounds.width / 2 - this.DIALOG_WIDTH / 2) - minX;
    const dialogTop = 80 + (displayBounds.y - minY);

    // Clamp position to ensure dialog stays within overlay bounds
    const clampedLeft = Math.max(0, Math.min(dialogLeft, allDisplaysWidth - this.DIALOG_WIDTH));
    const clampedTop = Math.max(0, Math.min(dialogTop, allDisplaysHeight - this.DIALOG_HEIGHT));

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
        // Send dialog position to renderer
        this.window.webContents.send('clipboard:dialogPosition', {
          left: clampedLeft,
          top: clampedTop,
        });
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
   * Send dialog position to renderer.
   */
  private sendDialogPosition(): void {
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

    const cursorPoint = screen.getCursorScreenPoint();
    const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
    const displayBounds = activeDisplay.bounds;

    const dialogLeft = (displayBounds.x + displayBounds.width / 2 - this.DIALOG_WIDTH / 2) - minX;
    const dialogTop = 80 + (displayBounds.y - minY);

    const clampedLeft = Math.max(0, Math.min(dialogLeft, allDisplaysWidth - this.DIALOG_WIDTH));
    const clampedTop = Math.max(0, Math.min(dialogTop, allDisplaysHeight - this.DIALOG_HEIGHT));

    this.window.webContents.send('clipboard:dialogPosition', {
      left: clampedLeft,
      top: clampedTop,
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
}

