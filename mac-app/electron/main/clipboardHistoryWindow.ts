import { app, BrowserWindow, BrowserWindowConstructorOptions, screen, Menu } from 'electron';
import path from 'path';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { PreferencesManager } from './preferences';
import { SoundManager } from './soundManager';
import { createLogger } from './logger';
import { isFinder } from './clipboardManager';

const log = createLogger('ClipboardHistory');

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

// Helper to run execFile with timeout to prevent hangs (especially with Finder)
function execFileWithTimeout(
  file: string,
  args: string[],
  timeoutMs: number = 5000
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

/**
 * Check if an app is the Electron app itself (should be excluded from target apps).
 */
function isElectronApp(bundleId: string, appName: string): boolean {
  const appNameLower = appName.toLowerCase();
  const bundleIdLower = bundleId.toLowerCase();
  const currentAppName = app.getName().toLowerCase();

  // Check if bundle ID or name matches our app.
  // Be specific — 'electron' alone is too broad (catches Superhuman, VS Code, etc.)
  return (
    bundleIdLower.includes('fieldtheory') ||
    bundleIdLower === 'com.github.electron' ||
    appNameLower.includes('field theory') ||
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
  private readonly DEBUG_WINDOW_EVENTS = process.env.CLIPBOARD_WINDOW_DEBUG_EVENTS === 'true';

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
  
  // Callback for when window bounds change (for persistence).
  private onBoundsChanged: ((bounds: { x: number; y: number; width: number; height: number }) => void) | null = null;
  private onHidden: ((info: { reason: string; hideApp: boolean; wasVisible: boolean }) => void) | null = null;
  
  // Track if recording is active - used to keep overlay visible when dismissing clipboard history
  private isRecordingActive: boolean = false;

  // Track if sketch/draw mode is active - used to skip auto-paste into Excalidraw
  private sketchModeActive: boolean = false;

  // Track if immersive/fullscreen reading mode is active - window should not auto-hide
  private isImmersiveMode: boolean = false;

  // Callback to check if resume after close is enabled (returns to last artifact vs clipboard)
  private resumeAfterCloseGetter: (() => boolean) | null = null;

  // Track if scenario testing panel is active - window should not auto-hide when adjusting overrides
  private scenarioTestingActive: boolean = false;

  // Internal visibility state for instant toggle without querying window.
  // Updated in show() and hide() to stay in sync with all visibility changes.
  private _isShowing: boolean = false;

  // Saved window bounds before sketch mode expansion (to restore on exit).
  private normalBounds: Electron.Rectangle | null = null;
  
  // Timer for smooth window resize animation.
  private animationTimer: ReturnType<typeof setInterval> | null = null;

  // Sound manager for playing window open/close sounds.
  private soundManager: SoundManager;
  
  // Preferences manager for checking settings like showInDock.
  private preferencesManager: PreferencesManager;

  constructor(preferences?: PreferencesManager) {
    // Create sound manager with preferences (or create new PreferencesManager if none provided).
    const prefs = preferences || new PreferencesManager();
    this.preferencesManager = prefs;
    this.soundManager = new SoundManager(prefs);
  }

  private logLifecycle(event: string, details = ''): void {
    if (!this.DEBUG_WINDOW_EVENTS) return;

    if (!this.window || this.window.isDestroyed()) {
      log.info(
        '[ClipboardHistory] %s | window=none showing=%s %s',
        event,
        this._isShowing,
        details
      );
      return;
    }

    const bounds = this.window.getBounds();
    log.info(
      '[ClipboardHistory] %s | visible=%s focused=%s showing=%s bounds=%d,%d %dx%d %s',
      event,
      this.window.isVisible(),
      this.window.isFocused(),
      this._isShowing,
      bounds.x,
      bounds.y,
      bounds.width,
      bounds.height,
      details
    );
  }

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
   * Generate a display identifier from a display's bounds.
   * Format: "widthxheight@x,y" (e.g., "1920x1080@0,0" or "2560x1440@1920,0")
   */
  static getDisplayId(display: Electron.Display): string {
    const bounds = display.bounds;
    return `${bounds.width}x${bounds.height}@${bounds.x},${bounds.y}`;
  }

  /**
   * Find a display by its identifier.
   * Returns null if no matching display is found.
   */
  static findDisplayById(displayId: string): Electron.Display | null {
    const displays = screen.getAllDisplays();
    for (const display of displays) {
      if (this.getDisplayId(display) === displayId) {
        return display;
      }
    }
    return null;
  }

  /**
   * Find which display contains a given point (in screen coordinates).
   * Returns the primary display if no display contains the point.
   */
  static getDisplayForPoint(x: number, y: number): Electron.Display {
    const displays = screen.getAllDisplays();
    for (const display of displays) {
      const bounds = display.bounds;
      if (
        x >= bounds.x &&
        x < bounds.x + bounds.width &&
        y >= bounds.y &&
        y < bounds.y + bounds.height
      ) {
        return display;
      }
    }
    // Fallback to primary display if point is outside all displays
    return screen.getPrimaryDisplay();
  }

  /**
   * Convert absolute screen coordinates to display-relative coordinates.
   * Returns the relative position and the display ID.
   */
  static convertToDisplayRelative(x: number, y: number): { relativeX: number; relativeY: number; displayId: string } {
    const display = this.getDisplayForPoint(x, y);
    const bounds = display.bounds;
    return {
      relativeX: x - bounds.x,
      relativeY: y - bounds.y,
      displayId: this.getDisplayId(display),
    };
  }

  /**
   * Convert display-relative coordinates to absolute screen coordinates.
   * Returns null if the display ID doesn't match any current display.
   */
  static convertToAbsolute(relativeX: number, relativeY: number, displayId: string): { x: number; y: number } | null {
    const display = this.findDisplayById(displayId);
    if (!display) {
      return null;
    }
    const bounds = display.bounds;
    return {
      x: bounds.x + relativeX,
      y: bounds.y + relativeY,
    };
  }

  /**
   * Show or toggle the clipboard history window.
   */
  toggle(): void {
    // If window exists but is destroyed, reset it and state
    if (this.window && this.window.isDestroyed()) {
      this.window = null;
      this._isShowing = false;
    }

    if (this._isShowing) {
      // Hide it (use this.hide() to update state)
      this.hide();
      return;
    }

    // Show it (will create if needed)
    this.show();
  }

  /**
   * Show the clipboard history window.
   * Window takes focus like Alfred - uses standard keyboard input.
   * Shows window immediately, then fetches app data in background for instant UX.
   * @param savedBounds Optional saved bounds to restore position/size (absolute screen coords)
   * @param showSettingsMode If true, open the window with settings panel visible
   * @param skipSound If true, skip playing open sound (used when sound was already played externally for faster feedback)
   * @param transcriptHistoryMode If true, renderer opens directly in transcript-only history mode
   */
  show(
    savedBounds?: { x: number; y: number; width: number; height: number },
    showSettingsMode: boolean = false,
    skipSound: boolean = false,
    transcriptHistoryMode: boolean = false
  ): void {
    this.logLifecycle(
      'show:begin',
      `showSettingsMode=${showSettingsMode} skipSound=${skipSound} transcriptHistoryMode=${transcriptHistoryMode} savedBounds=${savedBounds ? JSON.stringify(savedBounds) : 'none'}`
    );
    // Update internal state immediately for instant toggle.
    this._isShowing = true;

    // If window exists, reposition and show it.
    // For existing windows, we can use renderer-based sound (instant via Web Audio API).
    if (this.window && !this.window.isDestroyed()) {
      // Reposition window if bounds provided.
      if (savedBounds) {
        this.window.setBounds({
          x: savedBounds.x,
          y: savedBounds.y,
          width: savedBounds.width,
          height: savedBounds.height,
        });
      }

      // Ensure app is visible (un-hide after app.hide() was called).
      // This is needed for Cmd+Tab to properly show windows.
      app.show();

      // Play sound via renderer (instant - Web Audio API) BEFORE showing window.
      // The renderer plays it immediately with ~1ms latency.
      if (!skipSound && this.soundManager.isEnabled()) {
        this.window.webContents.send('clipboard:playSound', 'windowOpen');
      }

      this.window.show();
      // Bring window to front of window stack (important when not alwaysOnTop)
      this.window.moveTop();
      this.window.focus();
      this.logLifecycle('show:existing-window-complete');

      // Notify renderer to reset search query.
      this.window.webContents.send('clipboard:showHistory');
      if (transcriptHistoryMode) {
        this.window.webContents.send('clipboard:showTranscriptHistory');
      }
      if (showSettingsMode) {
        this.window.webContents.send('clipboard:showSettings');
      }
      this.sendTargetAppInfo();

      // Fetch fresh app data in background.
      this.refreshAppDataInBackground();
      return;
    }

    // For new windows, use main process sound (renderer isn't loaded yet).
    // The delay is acceptable since content is loading anyway.
    if (!skipSound) {
      this.soundManager.play('windowOpen');
    }

    // Ensure app is visible (un-hide after app.hide() was called).
    app.show();

    // Create new window.
    this.createWindow(savedBounds, showSettingsMode, false, transcriptHistoryMode);
    this.logLifecycle('show:created-window');

    // Fetch app data in background (don't await).
    this.refreshAppDataInBackground();
  }
  
  /**
   * Reposition the window without triggering show/focus/sound.
   * Used for display metrics changes when the window is already visible.
   */
  reposition(bounds: { x: number; y: number; width: number; height: number }): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.setBounds({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      });
    }
  }
  
  /**
   * Preload the window in the background for instant first open.
   * Creates the window hidden and lets content fully load.
   * Call once at app startup after systems are initialized.
   * @param savedBounds Optional saved bounds for position/size
   */
  preload(savedBounds?: { x: number; y: number; width: number; height: number }): void {
    if (this.window && !this.window.isDestroyed()) {
      return; // Already preloaded
    }
    this.createWindow(savedBounds, false, true);
  }

  /**
   * Create the clipboard history window.
   * Uses native macOS vibrancy for blur effect (like Alfred/Spotlight).
   * Window is sized to dialog dimensions, not full-screen overlay.
   * @param savedBounds Optional saved bounds for position/size (absolute screen coords)
   * @param showSettingsMode If true, send settings mode event after content loads
   * @param preloadOnly If true, don't show window after load (for background preloading)
   */
  private createWindow(
    savedBounds?: { x: number; y: number; width: number; height: number },
    showSettingsMode: boolean = false,
    preloadOnly: boolean = false,
    transcriptHistoryMode: boolean = false
  ): void {
    // Calculate window position/size.
    // savedBounds are now in absolute screen coordinates (simpler than old overlay-relative).
    let windowX: number;
    let windowY: number;
    let windowWidth: number;
    let windowHeight: number;

    if (savedBounds) {
      windowX = savedBounds.x;
      windowY = savedBounds.y;
      windowWidth = savedBounds.width;
      windowHeight = savedBounds.height;
    } else {
      // Default position: 80px from top, centered horizontally on active display.
      const cursorPoint = screen.getCursorScreenPoint();
      const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
      const displayBounds = activeDisplay.bounds;
      
      windowX = displayBounds.x + displayBounds.width / 2 - this.DIALOG_WIDTH / 2;
      windowY = displayBounds.y + 80;
      windowWidth = this.DIALOG_WIDTH;
      windowHeight = this.DIALOG_HEIGHT;
    }

    // Clamp to ensure window stays on screen.
    const cursorPoint = screen.getCursorScreenPoint();
    const activeDisplay = screen.getDisplayNearestPoint(cursorPoint);
    const displayBounds = activeDisplay.bounds;
    windowX = Math.max(displayBounds.x, Math.min(windowX, displayBounds.x + displayBounds.width - windowWidth));
    windowY = Math.max(displayBounds.y, Math.min(windowY, displayBounds.y + displayBounds.height - windowHeight));

    // Check if we're in "normal app" mode (showInDock) or "panel" mode at creation time.
    // These options can't be changed after window creation.
    const showInDock = this.preferencesManager.getPreference('showInDock') ?? false;

    // Native vibrancy window options.
    const options: BrowserWindowConstructorOptions = {
      // Panel mode uses NSPanel; normal mode uses standard window with titlebar.
      ...(showInDock ? {} : { type: 'panel' as const }),
      width: windowWidth,
      height: windowHeight,
      x: windowX,
      y: windowY,
      ...(showInDock 
        ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 12, y: 12 } }
        : { frame: false }),
      transparent: false,
      vibrancy: 'under-window',     // Blur what's behind the window.
      visualEffectState: 'active',
      skipTaskbar: !showInDock,     // Show in Dock when showInDock is true.
      resizable: true,
      minWidth: 600,   // Minimum window width.
      minHeight: 500,  // Ensures settings and controls remain visible.
      movable: true,
      focusable: true,
      acceptFirstMouse: true,       // Accept mouse events immediately (needed for drag with panels).
      fullscreenable: false,
      simpleFullscreen: false,
      show: false,
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

    if (!showInDock) {
      this.window.setAlwaysOnTop(true, 'screen-saver', 1);
      this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }

    this.window.on('closed', () => {
      this.logLifecycle('window:closed');
      this.window = null;
      this._isShowing = false;
    });

    if (this.DEBUG_WINDOW_EVENTS) {
      const emit = (eventName: string) => this.logLifecycle(`window:${eventName}`);
      this.window.on('show', () => emit('show'));
      this.window.on('hide', () => emit('hide'));
      this.window.on('focus', () => emit('focus'));
      this.window.on('blur', () => emit('blur-event'));
      this.window.on('moved', () => emit('moved'));
      this.window.on('resized', () => emit('resized'));
      this.window.on('ready-to-show', () => emit('ready-to-show'));
    }

    // Dismiss when window loses focus (Alfred behavior).
    // When showInDock is enabled, skip this entirely - user expects normal app behavior.
    // When immersive mode is active, also skip - user positioned window intentionally.
    this.window.on('blur', () => {
      const showInDock = this.preferencesManager.getPreference('showInDock') ?? false;
      this.logLifecycle(
        'window:blur-handler',
        `showInDock=${showInDock} immersive=${this.isImmersiveMode} sketch=${this.sketchModeActive} scenario=${this.scenarioTestingActive} recording=${this.isRecordingActive}`
      );

      // When showInDock is enabled, don't auto-hide on blur.
      // User expects normal app behavior where windows stay visible.
      if (showInDock) {
        return;
      }

      // When in immersive/fullscreen reading mode, don't auto-hide.
      // User may have positioned window to read while working.
      if (this.isImmersiveMode) {
        return;
      }

      // Don't hide when sketch/draw mode is active.
      // User may be in the middle of drawing and accidentally clicked away.
      if (this.sketchModeActive) {
        return;
      }

      // Don't hide when scenario testing panel is active.
      // User needs to see changes in real-time while adjusting overrides.
      if (this.scenarioTestingActive) {
        return;
      }

      // Blur means another app already gained focus, so hiding the entire app is
      // unnecessary here and can trigger compositor resets in transparent overlays.
      this.logLifecycle('window:blur-handler-hide', 'hideApp=false');
      this.hide(false, 'window-blur-handler');
    });
    
    // Save bounds when window is moved or resized (for persistence).
    this.window.on('moved', () => {
      this.emitBoundsChanged();
    });
    this.window.on('resized', () => {
      this.emitBoundsChanged();
    });

    this.window.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      log.error('Load failed:', errorCode, errorDescription);
    });

    // Enable native context menu for text selection (Copy, Look Up, etc.)
    this.window.webContents.on('context-menu', (event, params) => {
      const { selectionText, isEditable, editFlags } = params;

      const menuItems: Electron.MenuItemConstructorOptions[] = [];

      if (selectionText) {
        menuItems.push(
          { label: 'Copy', role: 'copy', enabled: editFlags.canCopy },
          { type: 'separator' },
          { label: 'Look Up "%s"'.replace('%s', selectionText.slice(0, 20) + (selectionText.length > 20 ? '...' : '')), click: () => {
            // Use macOS dictionary lookup
            this.window?.webContents.executeJavaScript(`window.getSelection()?.toString()`).then((text) => {
              if (text) {
                require('child_process').exec(`open dict://${encodeURIComponent(text)}`);
              }
            });
          }},
        );
      }

      if (isEditable) {
        menuItems.push(
          { label: 'Cut', role: 'cut', enabled: editFlags.canCut },
          { label: 'Copy', role: 'copy', enabled: editFlags.canCopy },
          { label: 'Paste', role: 'paste', enabled: editFlags.canPaste },
          { type: 'separator' },
          { label: 'Select All', role: 'selectAll', enabled: editFlags.canSelectAll },
        );
      }

      if (menuItems.length > 0) {
        const menu = Menu.buildFromTemplate(menuItems);
        menu.popup({ window: this.window! });
      }
    });

    // Show window only after content loads to avoid blank screen.
    // If preloadOnly, keep window hidden for instant later use.
    this.window.webContents.once('did-finish-load', () => {
      if (preloadOnly) {
        // Preload complete - window stays hidden but ready for instant show()
        return;
      }
      if (this.window && !this.window.isDestroyed()) {
        this.window.show();
        this.window.focus();
        // Notify renderer to reset search query.
        this.window.webContents.send('clipboard:showHistory');
        if (transcriptHistoryMode) {
          this.window.webContents.send('clipboard:showTranscriptHistory');
        }
        // If settings mode requested, send that event too.
        if (showSettingsMode) {
          this.window.webContents.send('clipboard:showSettings');
        }
        // Send target app info.
        this.sendTargetAppInfo();
      }
    });

    // Load clipboard history HTML.
    const startUrl = process.env.ELECTRON_START_URL;
    if (startUrl) {
      const url = startUrl.endsWith('/') ? startUrl : `${startUrl}/`;
      this.window.loadURL(`${url}clipboard-history.html`);
    } else {
      const htmlPath = path.join(app.getAppPath(), 'dist', 'clipboard-history.html');
      this.window.loadFile(htmlPath);

      this.window.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
        log.error('Failed to load:', errorCode, errorDescription, validatedURL);
      });
    }
  }

  /**
   * Hide the clipboard history window.
   * Restores focus to the previous app (including exact input field).
   * @param hideApp - Whether to hide the entire app. Set to false when other windows (like recording overlay) should remain visible.
   */
  hide(hideApp: boolean = true, reason: string = 'unspecified'): void {
    const wasVisible = this.window !== null && !this.window.isDestroyed() && this.window.isVisible();
    this.logLifecycle(
      'hide:begin',
      `reason=${reason} hideApp=${hideApp} recording=${this.isRecordingActive} immersive=${this.isImmersiveMode} sketch=${this.sketchModeActive}`
    );
    // Update internal state immediately for instant toggle.
    this._isShowing = false;

    // Cancel any in-progress animation and reset sketch state.
    if (this.animationTimer) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }

    // Save current bounds before any modifications (defensive - ensures bounds are captured).
    // This is especially important if the resize event didn't fire properly.
    if (!this.sketchModeActive) {
      this.emitBoundsChanged();
    }

    // Restore normal bounds if we were in expanded sketch mode.
    if (this.normalBounds && this.window && !this.window.isDestroyed()) {
      this.window.setBounds(this.normalBounds);
    }
    this.normalBounds = null;
    this.sketchModeActive = false;

    // If we were in immersive mode, tell renderer to reset to clipboard view
    // so re-opening the window doesn't show the artifact again
    // (unless "resume after close" setting is enabled)
    const shouldResume = this.resumeAfterCloseGetter?.() ?? false;
    if (this.isImmersiveMode && this.window && !this.window.isDestroyed() && !shouldResume) {
      this.window.webContents.send('clipboard:resetToClipboardView');
    }
    this.isImmersiveMode = false;

    // Only play sound if window is actually visible and sounds are enabled.
    // This prevents double-play when blur event fires after direct hide() call.
    // Use renderer-based sound (Web Audio API) for instant playback.
    if (this.window && !this.window.isDestroyed() && this.window.isVisible() && this.soundManager.isEnabled()) {
      this.window.webContents.send('clipboard:playSound', 'windowClose');
    }

    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
    }

    // Hide entire app to guarantee focus returns to previous app
    // This ensures the exact input field that was active gets focus back
    // Skip if other windows need to stay visible (e.g., recording overlay)
    if (hideApp) {
      if (process.platform === 'darwin') {
        app.dock.hide();
      }
      app.hide();
      this.logLifecycle('hide:app-hidden');
    }
    this.previouslyFocusedWindow = null;
    if (this.onHidden) {
      this.onHidden({ reason, hideApp, wasVisible });
    }
    this.logLifecycle('hide:complete');
  }

  /**
   * Get the BrowserWindow instance for IPC communication.
   */
  getWindow(): BrowserWindow | null {
    return this.window;
  }

  /**
   * Get the SoundManager instance for setting native helper.
   */
  getSoundManager(): SoundManager {
    return this.soundManager;
  }

  /**
   * Check if the window is visible (queries window state).
   */
  isVisible(): boolean {
    return this.window !== null && !this.window.isDestroyed() && this.window.isVisible();
  }

  /**
   * Check internal visibility state for instant toggle.
   * Use this for hotkey toggle instead of isVisible() to avoid race conditions.
   */
  isShowing(): boolean {
    return this._isShowing;
  }

  /**
   * Play the window open sound immediately.
   * Used for faster feedback when there's async work before show() is called.
   */
  playOpenSound(): void {
    // If window exists, use renderer-based sound for instant playback.
    // Otherwise fall back to main process sound.
    if (this.window && !this.window.isDestroyed() && this.soundManager.isEnabled()) {
      this.window.webContents.send('clipboard:playSound', 'windowOpen');
    } else {
      this.soundManager.play('windowOpen');
    }
  }

  /**
   * Play the artifact discovery sound.
   * Called when a new reading/artifact is created.
   */
  playArtifactDiscoverySound(): void {
    // Use renderer-based sound for instant playback.
    if (this.window && !this.window.isDestroyed() && this.soundManager.isEnabled()) {
      this.window.webContents.send('clipboard:playSound', 'artifactDiscovery');
    } else {
      this.soundManager.play('artifactDiscovery');
    }
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
      previousApp: this.previousApp,
      targetApp,
      runningApps: this.runningApps,
    });
  }

  /**
   * Get current window bounds (absolute screen coordinates).
   * Used for saving position/size to preferences.
   */
  getBounds(): { x: number; y: number; width: number; height: number } | null {
    if (!this.window || this.window.isDestroyed()) {
      return null;
    }
    return this.window.getBounds();
  }

  /**
   * Set callback for bounds changes (called after move/resize).
   */
  setOnBoundsChanged(callback: (bounds: { x: number; y: number; width: number; height: number }) => void): void {
    this.onBoundsChanged = callback;
  }

  setOnHidden(callback: (info: { reason: string; hideApp: boolean; wasVisible: boolean }) => void): void {
    this.onHidden = callback;
  }

  /**
   * Emit bounds changed event (internal).
   */
  private emitBoundsChanged(): void {
    if (this.onBoundsChanged && this.window && !this.window.isDestroyed()) {
      this.onBoundsChanged(this.window.getBounds());
    }
  }

  /**
   * Animate window bounds from current position to target over duration.
   * Uses easeOutQuad for smooth deceleration.
   */
  private animateBounds(targetBounds: Electron.Rectangle, duration: number = 150): void {
    if (!this.window || this.window.isDestroyed()) return;
    
    // Cancel any in-progress animation.
    if (this.animationTimer) {
      clearInterval(this.animationTimer);
      this.animationTimer = null;
    }
    
    const startBounds = this.window.getBounds();
    const steps = 6;
    const stepDuration = duration / steps;
    let currentStep = 0;
    
    this.animationTimer = setInterval(() => {
      currentStep++;
      const t = currentStep / steps;
      const eased = 1 - (1 - t) * (1 - t); // easeOutQuad
      
      const newBounds = {
        x: Math.round(startBounds.x + (targetBounds.x - startBounds.x) * eased),
        y: Math.round(startBounds.y + (targetBounds.y - startBounds.y) * eased),
        width: Math.round(startBounds.width + (targetBounds.width - startBounds.width) * eased),
        height: Math.round(startBounds.height + (targetBounds.height - startBounds.height) * eased),
      };
      
      this.window?.setBounds(newBounds);
      
      if (currentStep >= steps) {
        clearInterval(this.animationTimer!);
        this.animationTimer = null;
      }
    }, stepDuration);
  }

  /**
   * Set recording state - used to decide whether to hide the entire app when dismissing.
   * When recording is active, we want to keep the recording overlay visible.
   */
  setRecordingActive(active: boolean): void {
    this.isRecordingActive = active;
  }

  /**
   * Check if recording is active.
   * Used by Hot Mic to avoid interrupting a recording.
   */
  getRecordingActive(): boolean {
    return this.isRecordingActive;
  }

  /**
   * Set immersive/fullscreen reading mode state.
   * When active, window will not auto-hide on blur and behaves like a normal window.
   */
  setImmersiveMode(immersive: boolean): void {
    this.isImmersiveMode = immersive;

    // Dock stays hidden - panel mode is the only mode now.
    // Don't show dock when entering immersive mode.

    // Only adjust alwaysOnTop in panel mode (not showInDock mode)
    const showInDock = this.preferencesManager.getPreference('showInDock') ?? false;
    if (!showInDock && this.window && !this.window.isDestroyed()) {
      if (immersive) {
        // In immersive mode, disable alwaysOnTop so window behaves normally
        this.window.setAlwaysOnTop(false);
        this.window.setVisibleOnAllWorkspaces(false);
      }
      // Don't restore alwaysOnTop when exiting - let window stay normal until hidden
    }
  }

  /**
   * Check if immersive mode is active.
   */
  getImmersiveMode(): boolean {
    return this.isImmersiveMode;
  }

  /**
   * Set scenario testing panel active state.
   * When active, window will not auto-hide on blur so user can see real-time changes.
   */
  setScenarioTestingActive(active: boolean): void {
    this.scenarioTestingActive = active;
  }

  /**
   * Set the getter function for resume after close setting.
   * This is called from index.ts to wire up the librarian manager setting.
   */
  setResumeAfterCloseGetter(getter: () => boolean): void {
    this.resumeAfterCloseGetter = getter;
  }

  /**
   * Send collapse-immersive event to renderer.
   */
  sendCollapseImmersive(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('collapse-immersive');
    }
  }

  /**
   * Send exit-fullscreen event to renderer (exits immersive fullscreen but stays in current view).
   */
  sendExitFullscreen(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('librarian:setFullscreen', false);
    }
  }

  setSketchModeActive(active: boolean): void {
    this.sketchModeActive = active;
    
    if (!this.window || this.window.isDestroyed()) return;
    
    if (active && !this.normalBounds) {
      // Expand window when entering sketch mode.
      this.normalBounds = this.window.getBounds();
      
      const expandFactor = 1.2;
      const current = this.normalBounds;
      const newWidth = Math.round(current.width * expandFactor);
      const newHeight = Math.round(current.height * expandFactor);
      const newX = Math.round(current.x - (newWidth - current.width) / 2);
      const newY = Math.round(current.y - (newHeight - current.height) / 2);
      
      const display = screen.getDisplayNearestPoint({ x: current.x, y: current.y });
      const workArea = display.workArea;
      
      const clampedBounds = {
        x: Math.max(workArea.x, Math.min(newX, workArea.x + workArea.width - newWidth)),
        y: Math.max(workArea.y, Math.min(newY, workArea.y + workArea.height - newHeight)),
        width: Math.min(newWidth, workArea.width),
        height: Math.min(newHeight, workArea.height),
      };
      
      this.animateBounds(clampedBounds);
    } else if (!active && this.normalBounds) {
      // Contract window when exiting sketch mode.
      this.animateBounds(this.normalBounds);
      this.normalBounds = null;
    }
  }

  isSketchModeActive(): boolean {
    return this.sketchModeActive;
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
      log.error('Failed to get frontmost app:', error);
    }
    return null;
  }

  /**
   * Capture the frontmost app BEFORE showing the window.
   * Must be called before show() because once the window takes focus, Field Theory becomes frontmost.
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
        
        // Send updated target app info to renderer (in case window already shown).
        this.sendTargetAppInfo();
      }
    } catch (error) {
      log.error('Failed to capture previous app:', error);
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
   * Get the previous app (the app that was active before showing clipboard history).
   */
  getPreviousApp(): RunningApp | null {
    return this.previousApp;
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
   * capturePreviousAppBeforeShow() to avoid race condition where Field Theory becomes frontmost.
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
      log.error('Failed to get running apps:', error);
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
        log.error('Invalid bundleId contains quotes:', bundleId);
        return false;
      }
      // Use execFile with array arguments to avoid shell interpretation
      // This prevents command injection even if bundleId contains special characters
      const script = `tell application id "${bundleId}"\n  activate\nend tell`;
      await execFileAsync('osascript', ['-e', script]);
      return true;
    } catch (error) {
      log.error('Failed to activate app:', error);
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
      // Skip pasting to Finder - it doesn't handle Cmd+V well and causes stalls
      if (isFinder(bundleId)) {
        log.info('pasteToApp: skipping paste to Finder');
        return false;
      }

      // Validate bundleId doesn't contain quotes (bundle IDs shouldn't have them anyway)
      if (bundleId.includes('"') || bundleId.includes("'")) {
        log.error('Invalid bundleId for paste:', bundleId);
        return false;
      }
      // Small delay after hiding our window to ensure focus transfer.
      await new Promise(resolve => setTimeout(resolve, 50));

      // Use execFile with array arguments to avoid shell interpretation
      // This prevents command injection even if bundleId contains special characters
      // Use timeout to prevent hang if target app is unresponsive (e.g., Finder).
      const script = `tell application id "${bundleId}"\n  activate\nend tell\ndelay 0.1\ntell application "System Events"\n  keystroke "v" using command down\nend tell`;
      await execFileWithTimeout('osascript', ['-e', script], 3000);
      return true;
    } catch (error) {
      // Log but don't fail loudly - paste may have worked despite timeout
      log.warn('pasteToApp timed out or failed for:', bundleId, error);
      return false;
    }
  }

  /**
   * Open the developer tools inspector for this window.
   */
  openDevTools(): void {
    if (this.window && !this.window.isDestroyed()) {
      // Use 'bottom' mode to dock DevTools inside the panel window.
      // 'detach' mode opens a separate window which causes the panel to dismiss on click.
      this.window.webContents.openDevTools({ mode: 'bottom' });
    }
  }
}
