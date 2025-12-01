import { app, BrowserWindow, BrowserWindowConstructorOptions, screen } from 'electron';
import path from 'path';

/**
 * Manages the clipboard history popup window.
 * Shows an Alfred-style popup that can appear independently of the main window.
 */
export class ClipboardHistoryWindow {
  private window: BrowserWindow | null = null;
  private previouslyFocusedWindow: BrowserWindow | null = null;
  
  private readonly WIDTH = 600;
  private readonly HEIGHT = 500;

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
      return;
    }

    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    
    // Center the window on screen
    const x = Math.floor((screenWidth - this.WIDTH) / 2);
    const y = Math.floor((screenHeight - this.HEIGHT) / 2);

    const options: BrowserWindowConstructorOptions = {
      width: this.WIDTH,
      height: this.HEIGHT,
      x,
      y,
      frame: false,
      transparent: true, // Transparent so overlay can cover everything
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: true,
      focusable: true, // Focusable - uses standard keyboard input like Alfred
      fullscreenable: false,
      simpleFullscreen: false,
      show: false, // Don't show until content loads
      backgroundColor: '#00000000', // Fully transparent
      hasShadow: true,
      roundedCorners: true,
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
   * Destroy the window.
   */
  destroy(): void {
    if (this.window) {
      this.window.close();
      this.window = null;
    }
  }
}

