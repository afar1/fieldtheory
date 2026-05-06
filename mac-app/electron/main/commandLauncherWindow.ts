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
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { NativeHelper } from './nativeHelper';
import { createLogger } from './logger';
import { appendCommandLauncherTrace } from './commandLauncherTrace';
import { appendVisibilityTrace, captureVisibilityCaller } from './visibilityTrace';

const log = createLogger('CommandLauncher');

const execFileAsync = promisify(execFile);

/**
 * Represents a running application with its bundle ID and display name.
 */
export interface RunningApp {
  bundleId: string;
  name: string;
}

type AnchorBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CommandLauncherWindowOptions = {
  getInitialDarkMode?: () => boolean;
};

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
  private getInitialDarkMode: () => boolean;

  // The app that was active before we showed the launcher.
  private previousApp: RunningApp | null = null;
  private fieldTheoryActiveOnShow = false;

  // Track when show() is in progress (before window.show() is called).
  // This closes the race window where isVisible() returns false during async setup.
  private _isShowing: boolean = false;
  private suppressActivationUntilHidden = false;
  private suppressActivationUntilMs = 0;
  private readonly SUPPRESS_ACTIVATION_AFTER_EXTERNAL_INVOCATION_MS = 3000;

  // Window dimensions - starts small, expands for results.
  private readonly WINDOW_WIDTH = 366;
  private readonly WINDOW_HEIGHT_COLLAPSED = 43;
  private readonly WINDOW_HEIGHT_RESULTS = 354;
  private readonly PREVIEW_WINDOW_WIDTH = 520;
  private readonly PREVIEW_WINDOW_MAX_HEIGHT = 560;
  private readonly PREVIEW_WINDOW_MIN_HEIGHT = 120;

  private resizeBurstCount = 0;
  private resizeBurstStartedAt = 0;
  private resizeBurstLastAt = 0;
  private resizeBurstHeights = new Set<number>();
  private resizeBurstTimer: NodeJS.Timeout | null = null;
  private previewWindow: BrowserWindow | null = null;
  private previewPayload: Record<string, unknown> | null = null;
  private previewAnchorBounds: AnchorBounds | null = null;

  constructor(nativeHelper?: NativeHelper, options: CommandLauncherWindowOptions = {}) {
    this.nativeHelper = nativeHelper || null;
    this.getInitialDarkMode = options.getInitialDarkMode ?? (() => false);
    appendCommandLauncherTrace('launcher-constructed', {
      hasNativeHelper: Boolean(this.nativeHelper),
    });

    // Listen for resize requests from renderer.
    ipcMain.on('command-launcher:resize', (_event, height: number) => {
      this.recordResizeRequest(height);

      if (this.window && !this.window.isDestroyed()) {
        const bounds = this.window.getBounds();
        const nextHeight = Math.min(height, this.WINDOW_HEIGHT_RESULTS);
        if (nextHeight !== height) {
          appendCommandLauncherTrace('renderer-resize-clamped', {
            requestedHeight: height,
            appliedHeight: nextHeight,
            maxHeight: this.WINDOW_HEIGHT_RESULTS,
          });
        }
        this.window.setBounds({
          x: bounds.x,
          y: bounds.y,
          width: this.WINDOW_WIDTH,
          height: nextHeight,
        });
      } else {
        appendCommandLauncherTrace('renderer-resize-ignored', {
          requestedHeight: height,
          reason: 'window-missing',
        });
      }
    });
    
    // Listen for close requests from renderer.
    ipcMain.on('command-launcher:close', (_event, options?: { skipActivation?: boolean }) => {
      const skipActivation = options?.skipActivation === true;
      appendCommandLauncherTrace('renderer-close-request', {
        visible: this.isVisible(),
        isShowing: this._isShowing,
        skipActivation,
      });
      this.hide(skipActivation);
    });

    ipcMain.on('command-launcher:preview-show', (_event, preview: Record<string, unknown>) => {
      this.showPreview(preview);
    });

    ipcMain.on('command-launcher:preview-hide', () => {
      this.hidePreview();
    });

    ipcMain.on('command-launcher:preview-resize', (_event, height: number) => {
      this.resizePreview(height);
    });

    ipcMain.on('command-launcher:trace', (_event, event: string, details: Record<string, unknown> = {}) => {
      if (!event || typeof event !== 'string') return;
      const safeDetails = details && typeof details === 'object' ? details : { value: details };
      appendCommandLauncherTrace(`renderer-${event.slice(0, 80)}`, safeDetails);
    });
  }
  
  /**
   * Create and load the hidden launcher ahead of the first hotkey press.
   * This keeps the input ready so fast typing after Cmd+Shift+K is not lost.
   */
  preload(): void {
    if (this.window && !this.window.isDestroyed()) {
      return;
    }

    if (this.window?.isDestroyed()) {
      this.window = null;
    }

    this.createWindow();
    appendCommandLauncherTrace('preload-complete');
  }

  /**
   * Show the command launcher window.
   * Uses fresh frontmost window bounds when possible so the launcher follows
   * same-app window moves across displays.
   */
  async show(options: { anchorBounds?: AnchorBounds | null } = {}): Promise<void> {
    // Mark as showing BEFORE any async work to close the race window.
    // This allows other code to check isShowingOrVisible() during the await.
    this._isShowing = true;
    this.suppressActivationUntilHidden = false;
    this.suppressActivationUntilMs = 0;
    appendCommandLauncherTrace('show-start', {
      hasWindow: Boolean(this.window),
      windowVisible: this.isVisible(),
    });

    try {
      // If window exists but is destroyed, reset it.
      if (this.window && this.window.isDestroyed()) {
        appendCommandLauncherTrace('show-reset-destroyed-window');
        this.window = null;
      }

      if (!this.window) {
        this.createWindow();
      }

      // Get cached frontmost app info for previous app (bundleId/name).
      const frontmostApp = this.nativeHelper?.getFrontmostApp();
      this.fieldTheoryActiveOnShow = Boolean(
        frontmostApp?.bundleId &&
        frontmostApp?.name &&
        isElectronApp(frontmostApp.bundleId, frontmostApp.name)
      );

      // Store previous app for paste-back feature.
      if (frontmostApp?.bundleId && frontmostApp?.name) {
        if (!isElectronApp(frontmostApp.bundleId, frontmostApp.name)) {
          this.previousApp = {
            bundleId: frontmostApp.bundleId,
            name: frontmostApp.name,
          };
          appendCommandLauncherTrace('show-frontmost-app', {
            bundleId: frontmostApp.bundleId,
            name: frontmostApp.name,
            hasWindowBounds: Boolean(frontmostApp.windowBounds),
          });
        } else {
          appendCommandLauncherTrace('show-frontmost-app-skipped-field-theory', {
            bundleId: frontmostApp.bundleId,
            name: frontmostApp.name,
            previousAppBundleId: this.previousApp?.bundleId ?? null,
            hasWindowBounds: Boolean(frontmostApp.windowBounds),
          });
        }
      }

      let x: number;
      let y: number;

      let freshWindowBounds: AnchorBounds | null = null;
      if (!options.anchorBounds && this.nativeHelper) {
        try {
          freshWindowBounds = await this.nativeHelper.getFrontmostWindowBounds();
        } catch (error) {
          appendCommandLauncherTrace('show-frontmost-window-bounds-error', { error });
        }
      }

      const windowBounds = options.anchorBounds ?? freshWindowBounds ?? frontmostApp?.windowBounds ?? null;
      appendCommandLauncherTrace('show-position-source', {
        usedWindowBounds: Boolean(windowBounds),
        usedAnchorBounds: Boolean(options.anchorBounds),
        usedFreshWindowBounds: Boolean(!options.anchorBounds && freshWindowBounds),
        usedCachedWindowBounds: Boolean(!options.anchorBounds && !freshWindowBounds && frontmostApp?.windowBounds),
      });

      if (windowBounds) {
        this.previewAnchorBounds = windowBounds;
        // Center on the current frontmost window.
        x = Math.round(windowBounds.x + (windowBounds.width - this.WINDOW_WIDTH) / 2);
        y = Math.round(windowBounds.y + (windowBounds.height - this.WINDOW_HEIGHT_RESULTS) / 2 - 50);
      } else {
        // Fallback: center on active display.
        const cursorPoint = screen.getCursorScreenPoint();
        const display = screen.getDisplayNearestPoint(cursorPoint);
        this.previewAnchorBounds = display.bounds;
        x = Math.round(display.bounds.x + (display.bounds.width - this.WINDOW_WIDTH) / 2);
        y = Math.round(display.bounds.y + (display.bounds.height - this.WINDOW_HEIGHT_RESULTS) / 2 - 50);
      }

      this.window!.setBounds({
        x,
        y,
        width: this.WINDOW_WIDTH,
        height: this.WINDOW_HEIGHT_COLLAPSED,
      });
      appendCommandLauncherTrace('show-set-bounds', {
        x,
        y,
        width: this.WINDOW_WIDTH,
        height: this.WINDOW_HEIGHT_COLLAPSED,
      });

      // Reset before focus so early typed characters are not cleared after show.
      this.window!.webContents.send('command-launcher:reset', {
        isDarkMode: this.getInitialDarkMode(),
      });
      appendCommandLauncherTrace('show-sent-reset');

      this.window!.show();
      this.window!.moveTop(); // Ensure we're at top of window stack (above immersive clipboard)
      this.window!.focus();
      this._isShowing = false; // Window is now visible, clear the showing flag

      appendCommandLauncherTrace('show-complete', {
        windowVisible: this.isVisible(),
        previousAppBundleId: this.previousApp?.bundleId ?? null,
      });

      this.scheduleProcessMetricsSnapshot('after-show-250ms', 250);
      this.scheduleProcessMetricsSnapshot('after-show-1500ms', 1500);
    } catch (error) {
      this._isShowing = false;
      appendCommandLauncherTrace('show-error', { error });
      throw error;
    }
  }
  
  /**
   * Hide the command launcher window.
   * @param skipActivation Skip previous-app activation (caller handles it).
   */
  hide(skipActivation = false): void {
    this._isShowing = false;
    const now = Date.now();
    const suppressActivationForThisHide = this.suppressActivationUntilHidden || now < this.suppressActivationUntilMs;
    const shouldSkipActivation = skipActivation || suppressActivationForThisHide;

    // Already hidden — prevents blur re-entry after hide(true).
    const isVisible = this.window && !this.window.isDestroyed() && this.window.isVisible();
    if (!isVisible) {
      if (this.suppressActivationUntilHidden) {
        this.suppressActivationUntilHidden = false;
      }
      appendCommandLauncherTrace('hide-noop', {
        skipActivation,
        suppressActivationForThisHide,
        suppressActivationRemainingMs: Math.max(0, this.suppressActivationUntilMs - now),
        hasWindow: Boolean(this.window),
      });
      return;
    }

    appendCommandLauncherTrace('hide', {
      skipActivation,
      suppressActivationForThisHide,
      suppressActivationRemainingMs: Math.max(0, this.suppressActivationUntilMs - now),
      previousAppBundleId: this.previousApp?.bundleId ?? null,
    });
    this.window!.hide();
    this.hidePreview();
    this.suppressActivationUntilHidden = false;

    if (shouldSkipActivation || this.fieldTheoryActiveOnShow) {
      appendCommandLauncherTrace('hide-skip-activation');
      return;
    }

    // Explicitly activate the previous app instead of hiding entire Electron app.
    // This works even when clipboard history is visible in immersive mode.
    if (this.previousApp?.bundleId) {
      appendCommandLauncherTrace('hide-activate-previous-app', {
        bundleId: this.previousApp.bundleId,
      });
      this.activatePreviousApp(this.previousApp.bundleId);
    } else {
      // Fallback to app.hide() if we don't know the previous app
      appendCommandLauncherTrace('hide-app-hide-fallback');
      appendVisibilityTrace('command-launcher.app-hide', {
        reason: 'hide-no-previous-app',
        caller: captureVisibilityCaller(),
      });
      app.hide();
    }
  }

  /**
   * Activate a specific app by bundle ID using AppleScript.
   */
  private async activatePreviousApp(bundleId: string): Promise<void> {
    try {
      if (bundleId.includes('"') || bundleId.includes("'")) {
        log.error('Invalid bundleId contains quotes:', bundleId);
        appendCommandLauncherTrace('activate-previous-app-invalid-bundle', { bundleId });
        appendVisibilityTrace('command-launcher.app-hide', {
          reason: 'invalid-previous-app-bundle',
          caller: captureVisibilityCaller(),
        });
        app.hide();
        return;
      }
      appendCommandLauncherTrace('activate-previous-app-start', { bundleId });
      const script = `tell application id "${bundleId}"\n  activate\nend tell`;
      await execFileAsync('osascript', ['-e', script]);
      appendCommandLauncherTrace('activate-previous-app-success', { bundleId });
    } catch (error) {
      log.error('Failed to activate previous app:', error);
      appendCommandLauncherTrace('activate-previous-app-error', { bundleId, error });
      appendVisibilityTrace('command-launcher.app-hide', {
        reason: 'activate-previous-app-error',
        bundleId,
        error,
        caller: captureVisibilityCaller(),
      });
      app.hide(); // Fallback
    }
  }
  
  /**
   * Check if the command launcher window is visible.
   */
  isVisible(): boolean {
    return this.window !== null && !this.window.isDestroyed() && this.window.isVisible();
  }

  /**
   * Check if the command launcher is visible OR in the process of showing.
   * This closes the TOCTTOU race window where isVisible() returns false
   * during the async setup phase of show().
   */
  isShowingOrVisible(): boolean {
    return this._isShowing || this.isVisible();
  }

  suppressActivationForExternalInvocation(): void {
    this.suppressActivationUntilHidden = true;
    this.suppressActivationUntilMs = Date.now() + this.SUPPRESS_ACTIVATION_AFTER_EXTERNAL_INVOCATION_MS;
    appendCommandLauncherTrace('suppress-activation-for-external-invocation', {
      visible: this.isVisible(),
      isShowing: this._isShowing,
      durationMs: this.SUPPRESS_ACTIVATION_AFTER_EXTERNAL_INVOCATION_MS,
    });
  }

  /**
   * Get the app that was active before showing the launcher.
   */
  getPreviousApp(): RunningApp | null {
    return this.previousApp;
  }

  wasFieldTheoryActiveOnShow(): boolean {
    return this.fieldTheoryActiveOnShow;
  }

  private getInitialThemeOptions(): { argument: string } {
    const isDarkMode = this.getInitialDarkMode();
    return {
      argument: `--field-theory-dark-mode=${isDarkMode ? 'true' : 'false'}`,
    };
  }

  /**
   * Create the command launcher window.
   */
  private createWindow(): void {
    appendCommandLauncherTrace('create-window-start');
    const initialTheme = this.getInitialThemeOptions();
    this.window = new BrowserWindow({
      width: this.WINDOW_WIDTH,
      height: this.WINDOW_HEIGHT_COLLAPSED,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      hasShadow: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload.js'),
        additionalArguments: [initialTheme.argument],
      },
    });
    appendCommandLauncherTrace('create-window-complete');
    
    // Stay on top of everything.
    this.window.setAlwaysOnTop(true, 'screen-saver', 1);
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    this.window.on('show', () => {
      appendCommandLauncherTrace('window-show-event');
    });

    this.window.on('focus', () => {
      appendCommandLauncherTrace('window-focus-event');
    });

    this.window.on('hide', () => {
      appendCommandLauncherTrace('window-hide-event');
    });

    this.window.on('unresponsive', () => {
      appendCommandLauncherTrace('window-unresponsive');
      this.scheduleProcessMetricsSnapshot('window-unresponsive', 50);
    });

    this.window.on('responsive', () => {
      appendCommandLauncherTrace('window-responsive');
    });

    // Hide on blur (clicking away).
    this.window.on('blur', () => {
      appendCommandLauncherTrace('window-blur-event', {
        windowVisible: this.isVisible(),
        fieldTheoryActiveOnShow: this.fieldTheoryActiveOnShow,
      });
      this.hide();
    });

    this.window.on('closed', () => {
      appendCommandLauncherTrace('window-closed');
      this.flushResizeBurst('window-closed');
      this.hidePreview();
      this.window = null;
    });

    this.window.webContents.on('did-finish-load', () => {
      appendCommandLauncherTrace('renderer-did-finish-load');
    });

    this.window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      appendCommandLauncherTrace('renderer-did-fail-load', {
        errorCode,
        errorDescription,
        validatedURL,
      });
    });

    this.window.webContents.on('render-process-gone', (_event, details) => {
      appendCommandLauncherTrace('renderer-process-gone', {
        reason: details.reason,
        exitCode: details.exitCode,
      });
    });
    
    // Load the command launcher HTML.
    const startUrl = process.env.ELECTRON_START_URL;
    if (startUrl) {
      const url = startUrl.endsWith('/') ? startUrl : `${startUrl}/`;
      this.window.loadURL(`${url}command-launcher.html`);
    } else {
      const htmlPath = path.join(app.getAppPath(), 'dist', 'command-launcher.html');
      this.window.loadFile(htmlPath);
    }
  }

  private createPreviewWindow(): void {
    appendCommandLauncherTrace('preview-create-window-start');
    const initialTheme = this.getInitialThemeOptions();
    this.previewWindow = new BrowserWindow({
      width: this.PREVIEW_WINDOW_WIDTH,
      height: this.PREVIEW_WINDOW_MAX_HEIGHT,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      hasShadow: false,
      focusable: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../preload.js'),
        additionalArguments: [initialTheme.argument],
      },
    });
    appendCommandLauncherTrace('preview-create-window-complete');

    this.previewWindow.setAlwaysOnTop(true, 'screen-saver', 1);
    this.previewWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    this.previewWindow.on('show', () => {
      appendCommandLauncherTrace('preview-window-show-event');
    });

    this.previewWindow.on('hide', () => {
      appendCommandLauncherTrace('preview-window-hide-event');
    });

    this.previewWindow.on('closed', () => {
      appendCommandLauncherTrace('preview-window-closed');
      this.previewWindow = null;
    });

    this.previewWindow.webContents.on('did-finish-load', () => {
      appendCommandLauncherTrace('preview-renderer-did-finish-load');
      if (this.previewPayload) {
        this.previewWindow?.webContents.send('command-launcher-preview:payload', this.previewPayload);
      }
    });

    this.previewWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      appendCommandLauncherTrace('preview-renderer-did-fail-load', {
        errorCode,
        errorDescription,
        validatedURL,
      });
    });

    const startUrl = process.env.ELECTRON_START_URL;
    if (startUrl) {
      const url = startUrl.endsWith('/') ? startUrl : `${startUrl}/`;
      this.previewWindow.loadURL(`${url}command-launcher-preview.html`);
    } else {
      const htmlPath = path.join(app.getAppPath(), 'dist', 'command-launcher-preview.html');
      this.previewWindow.loadFile(htmlPath);
    }
  }

  private showPreview(preview: Record<string, unknown> | null | undefined): void {
    if (!preview || typeof preview !== 'object') {
      appendCommandLauncherTrace('preview-show-ignored', { reason: 'invalid-preview' });
      return;
    }

    this.previewPayload = preview;
    if (!this.previewWindow || this.previewWindow.isDestroyed()) {
      this.createPreviewWindow();
    }

    const bounds = this.getPreviewBounds(this.PREVIEW_WINDOW_MAX_HEIGHT);

    this.previewWindow!.setBounds(bounds);
    appendCommandLauncherTrace('preview-show', {
      previewKind: preview.kind ?? null,
      bookmarkId: typeof preview.bookmark === 'object' && preview.bookmark ? (preview.bookmark as Record<string, unknown>).id ?? null : null,
      filePath: preview.filePath ?? null,
      ...bounds,
    });

    this.previewWindow!.showInactive();
    this.previewWindow!.moveTop();
    this.previewWindow!.webContents.send('command-launcher-preview:payload', preview);
  }

  private getPreviewBounds(requestedHeight: number): Electron.Rectangle {
    const anchor = this.previewAnchorBounds ?? (() => {
      const cursorPoint = screen.getCursorScreenPoint();
      return screen.getDisplayNearestPoint(cursorPoint).bounds;
    })();
    const height = Math.max(
      this.PREVIEW_WINDOW_MIN_HEIGHT,
      Math.min(Math.ceil(requestedHeight), this.PREVIEW_WINDOW_MAX_HEIGHT)
    );
    return {
      x: Math.round(anchor.x + (anchor.width - this.PREVIEW_WINDOW_WIDTH) / 2),
      y: Math.round(anchor.y + (anchor.height - height) / 2),
      width: this.PREVIEW_WINDOW_WIDTH,
      height,
    };
  }

  private resizePreview(height: number): void {
    if (!Number.isFinite(height)) return;
    if (!this.previewWindow || this.previewWindow.isDestroyed() || !this.previewWindow.isVisible()) return;
    const bounds = this.getPreviewBounds(height);
    appendCommandLauncherTrace('preview-resize', { ...bounds });
    this.previewWindow.setBounds(bounds);
  }

  private hidePreview(): void {
    this.previewPayload = null;
    if (!this.previewWindow || this.previewWindow.isDestroyed() || !this.previewWindow.isVisible()) return;
    appendCommandLauncherTrace('preview-hide');
    this.previewWindow.hide();
  }
  
  /**
   * Destroy the window and clean up.
   */
  destroy(): void {
    appendCommandLauncherTrace('destroy');
    this.flushResizeBurst('destroy');
    this.previewPayload = null;
    if (this.previewWindow && !this.previewWindow.isDestroyed()) {
      this.previewWindow.destroy();
      this.previewWindow = null;
    }
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
      this.window = null;
    }
  }

  private recordResizeRequest(requestedHeight: number): void {
    const now = Date.now();
    const idleThresholdMs = 300;

    if (this.resizeBurstCount > 0 && now - this.resizeBurstLastAt > idleThresholdMs) {
      this.flushResizeBurst('gap');
    }

    if (this.resizeBurstCount === 0) {
      this.resizeBurstStartedAt = now;
      this.resizeBurstHeights.clear();
    }

    this.resizeBurstCount += 1;
    this.resizeBurstLastAt = now;

    if (this.resizeBurstHeights.size < 8) {
      this.resizeBurstHeights.add(requestedHeight);
    }

    if (
      this.resizeBurstCount <= 3 ||
      this.resizeBurstCount === 10 ||
      this.resizeBurstCount === 25 ||
      this.resizeBurstCount % 100 === 0
    ) {
      appendCommandLauncherTrace('renderer-resize-request', {
        count: this.resizeBurstCount,
        requestedHeight,
        windowVisible: this.isVisible(),
        isShowing: this._isShowing,
      });
    }

    if (this.resizeBurstCount === 25) {
      this.scheduleProcessMetricsSnapshot('resize-burst', 100);
    }

    if (this.resizeBurstTimer) {
      clearTimeout(this.resizeBurstTimer);
    }

    this.resizeBurstTimer = setTimeout(() => {
      this.flushResizeBurst('idle');
    }, idleThresholdMs);
    this.resizeBurstTimer.unref?.();
  }

  private flushResizeBurst(reason: string): void {
    if (this.resizeBurstCount === 0) return;

    if (this.resizeBurstTimer) {
      clearTimeout(this.resizeBurstTimer);
      this.resizeBurstTimer = null;
    }

    appendCommandLauncherTrace('renderer-resize-burst', {
      reason,
      count: this.resizeBurstCount,
      durationMs: Math.max(0, this.resizeBurstLastAt - this.resizeBurstStartedAt),
      heights: Array.from(this.resizeBurstHeights).sort((a, b) => a - b),
      windowVisible: this.isVisible(),
      isShowing: this._isShowing,
    });

    this.resizeBurstCount = 0;
    this.resizeBurstStartedAt = 0;
    this.resizeBurstLastAt = 0;
    this.resizeBurstHeights.clear();
  }

  private scheduleProcessMetricsSnapshot(reason: string, delayMs: number): void {
    const timer = setTimeout(() => {
      try {
        const metrics = app.getAppMetrics()
          .filter((metric) => metric.type === 'Browser' || metric.type === 'Tab' || metric.type === 'Utility')
          .map((metric) => ({
            pid: metric.pid,
            type: metric.type,
            cpuPercent: Number((metric.cpu?.percentCPUUsage ?? 0).toFixed(1)),
            workingSetSize: metric.memory?.workingSetSize ?? null,
          }))
          .sort((left, right) => right.cpuPercent - left.cpuPercent)
          .slice(0, 6);

        appendCommandLauncherTrace('process-metrics', {
          reason,
          metrics,
        });
      } catch (error) {
        appendCommandLauncherTrace('process-metrics-error', {
          reason,
          error,
        });
      }
    }, delayMs);
    timer.unref?.();
  }
}
