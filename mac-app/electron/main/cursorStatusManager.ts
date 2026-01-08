import { BrowserWindow, screen, app, ipcMain } from 'electron';
import { EventEmitter } from 'events';
import path from 'path';

/**
 * Status states for the cursor indicator.
 * - idle: No indicator shown
 * - recording: Red pulsing dot with "Say anything" label
 * - transcribing: Purple dot, "Transcribing..." text when cursor is still
 * - done: Green dot with "Pasted", shown briefly after transcribing completes
 * - confirmation: Red pulsing dot with countdown, awaiting abandon/continue decision
 * - paste-failed: Orange dot, shows transcription then "Saved to Field Theory"
 */
export type CursorStatusState = 'idle' | 'recording' | 'transcribing' | 'done' | 'confirmation' | 'paste-failed';

/**
 * Manages the cursor-following status indicator overlay.
 * Shows a colored dot that follows the cursor during active states,
 * with a text label that appears when the cursor is still.
 * 
 * Emits:
 * - 'confirmation-response': { abandon: boolean } when user responds to confirmation
 */
export class CursorStatusManager extends EventEmitter {
  private window: BrowserWindow | null = null;
  private state: CursorStatusState = 'idle';
  private enabled: boolean = true;
  
  // Cursor tracking state
  private pollInterval: NodeJS.Timeout | null = null;
  private lastCursorPos: { x: number; y: number } = { x: 0, y: 0 };
  private cursorIdleTime: number = 0;
  private isIdle: boolean = false;
  
  // Hysteresis for edge flipping - prevents jittery bouncing when cursor is near edge.
  private isFlippedX: boolean = false;
  private isFlippedY: boolean = false;
  private readonly FLIP_HYSTERESIS_PX = 50; // Extra margin before flipping back
  
  // Done state timeout - for showing brief green dot after transcribing
  private doneTimeout: NodeJS.Timeout | null = null;
  private readonly DONE_DURATION_MS = 800;
  
  // Paste-failed state timeout - brief since message is simple now.
  private pasteFailedTimeout: NodeJS.Timeout | null = null;
  private readonly PASTE_FAILED_DURATION_MS = 2500;
  
  // Store last transcription for done state display
  private lastTranscription: string = '';
  
  // Screenshot count for pipe indicator during recording
  private screenshotCount: number = 0;
  
  // Whether to hide text labels (show only colored dots)
  private hideLabels: boolean = false;
  
  // Progressive label hiding - counts how many times each label has been shown.
  private transcribingLabelShownCount: number = 0;
  private sayAnythingLabelShownCount: number = 0;
  private readonly TRANSCRIBING_LABEL_THRESHOLD = 3;
  private readonly SAY_ANYTHING_LABEL_THRESHOLD = 2;
  private labelsExplicitlyEnabled: boolean = false;
  
  // Timing constants
  private readonly POLL_INTERVAL_MS = 33;
  private readonly IDLE_THRESHOLD_MS = 100;
  private readonly MOVEMENT_THRESHOLD_PX = 3;
  
  // Window dimensions and offset from cursor (positioned immediately to the right)
  private readonly WINDOW_WIDTH_NORMAL = 140;
  private readonly WINDOW_WIDTH_WIDE = 345;
  private readonly WINDOW_HEIGHT_NORMAL = 40;
  private readonly WINDOW_HEIGHT_TALL = 160;
  private readonly CURSOR_OFFSET_X = 16;
  private readonly CURSOR_OFFSET_Y = -1;
  
  constructor() {
    super();
    
    // Listen for confirmation responses from renderer
    ipcMain.on('cursor-status-confirmation-response', (_event, abandon: boolean) => {
      if (this.state === 'confirmation') {
        this.emit('confirmation-response', { abandon });
        // Return to recording state (the TranscriberManager will handle actual abandon/continue)
        if (!abandon) {
          this.setState('recording');
        }
      }
    });
    
    // Listen for dismiss requests from renderer (e.g., click to dismiss paste-failed)
    ipcMain.on('cursor-status-dismiss', () => {
      if (this.state === 'paste-failed' || this.state === 'done') {
        if (this.pasteFailedTimeout) {
          clearTimeout(this.pasteFailedTimeout);
          this.pasteFailedTimeout = null;
        }
        if (this.doneTimeout) {
          clearTimeout(this.doneTimeout);
          this.doneTimeout = null;
        }
        this.state = 'idle';
        this.hide();
      }
    });
  }

  /**
   * Enable or disable the cursor status indicator.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.hide();
    }
  }
  
  /**
   * Set the last transcription text (for showing in done state).
   */
  setLastTranscription(text: string): void {
    this.lastTranscription = text;
  }
  
  /**
   * Set the screenshot count for the pipe indicator during recording.
   * Only sends updates when recording is active.
   */
  setScreenshotCount(count: number): void {
    this.screenshotCount = count;
    if (this.state === 'recording' && this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('cursor-status-stack', count);
    }
  }
  
  /**
   * Set whether to hide text labels (show only colored dots).
   */
  setHideLabels(hide: boolean): void {
    this.hideLabels = hide;
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('cursor-status-hide-labels', hide);
    }
  }
  
  setLabelCounts(transcribingCount: number, sayAnythingCount: number): void {
    this.transcribingLabelShownCount = transcribingCount;
    this.sayAnythingLabelShownCount = sayAnythingCount;
    this.sendLabelVisibilityToRenderer();
  }
  
  getLabelCounts(): { transcribing: number; sayAnything: number } {
    return {
      transcribing: this.transcribingLabelShownCount,
      sayAnything: this.sayAnythingLabelShownCount,
    };
  }
  
  incrementLabelCount(labelType: 'transcribing' | 'sayAnything'): number {
    if (labelType === 'transcribing') {
      this.transcribingLabelShownCount++;
    } else {
      this.sayAnythingLabelShownCount++;
    }
    this.sendLabelVisibilityToRenderer();
    return labelType === 'transcribing' 
      ? this.transcribingLabelShownCount 
      : this.sayAnythingLabelShownCount;
  }
  
  setLabelsExplicitlyEnabled(enabled: boolean): void {
    this.labelsExplicitlyEnabled = enabled;
    this.sendLabelVisibilityToRenderer();
  }
  
  private sendLabelVisibilityToRenderer(): void {
    if (!this.window || this.window.isDestroyed()) return;
    
    const showTranscribingLabel = this.labelsExplicitlyEnabled || 
      this.transcribingLabelShownCount < this.TRANSCRIBING_LABEL_THRESHOLD;
    const showSayAnythingLabel = this.labelsExplicitlyEnabled || 
      this.sayAnythingLabelShownCount < this.SAY_ANYTHING_LABEL_THRESHOLD;
    
    this.window.webContents.send('cursor-status-label-visibility', {
      showTranscribingLabel,
      showSayAnythingLabel,
    });
  }
  
  /**
   * Set screenshot mode - shifts the indicator right to avoid overlap with screenshot UI.
   */
  setScreenshotMode(active: boolean): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('cursor-status-screenshot-mode', active);
    }
  }

  /**
   * Update the current state. Shows indicator if state is active, hides if idle.
   * When transitioning from transcribing to idle, briefly shows 'done' state first.
   */
  setState(state: CursorStatusState): void {
    // Clear any pending timeouts
    if (this.doneTimeout) {
      clearTimeout(this.doneTimeout);
      this.doneTimeout = null;
    }
    if (this.pasteFailedTimeout) {
      clearTimeout(this.pasteFailedTimeout);
      this.pasteFailedTimeout = null;
    }
    
    const wasTranscribing = this.state === 'transcribing';
    const isActive = state !== 'idle';
    
    // When transcribing finishes, show 'done' briefly before hiding
    if (wasTranscribing && state === 'idle' && this.enabled) {
      this.state = 'done';
      this.updateWindowSize('done');
      this.sendStateToRenderer('done');
      // Send transcription text for display (pasteFailed: false means paste succeeded)
      if (this.lastTranscription && this.window && !this.window.isDestroyed()) {
        this.window.webContents.send('cursor-status-data', { 
          transcription: this.lastTranscription,
          pasteFailed: false 
        });
      }
      
      this.doneTimeout = setTimeout(() => {
        this.doneTimeout = null;
        this.state = 'idle';
        this.hide();
      }, this.DONE_DURATION_MS);
      return;
    }
    
    this.state = state;
    this.updateWindowSize(state);
    
    // Reset screenshot count when recording starts.
    if (state === 'recording') {
      this.screenshotCount = 0;
      if (this.window && !this.window.isDestroyed()) {
        this.window.webContents.send('cursor-status-stack', 0);
      }
    }
    
    if (isActive && this.enabled) {
      this.show();
    } else if (!isActive) {
      this.hide();
    }
    
    this.sendStateToRenderer(state);
  }
  
  /**
   * Set state with additional data (e.g., transcription text for paste-failed).
   */
  setStateWithData(state: CursorStatusState, data: { transcription?: string; pasteFailed?: boolean }): void {
    this.setState(state);
    
    if (state === 'paste-failed') {
      // Send data to renderer with pasteFailed flag
      if (this.window && !this.window.isDestroyed()) {
        this.window.webContents.send('cursor-status-data', { ...data, pasteFailed: true });
      }
      
      // Also store for any subsequent done state
      if (data.transcription) {
        this.lastTranscription = data.transcription;
      }
      
      // Auto-hide after duration.
      this.pasteFailedTimeout = setTimeout(() => {
        this.pasteFailedTimeout = null;
        this.state = 'idle';
        this.hide();
      }, this.PASTE_FAILED_DURATION_MS);
    }
  }

  /**
   * Set a tutorial hint to display next to the cursor dot during recording.
   * Used by onboarding to guide users through the tutorial.
   * Pass null to clear the hint and return to default behavior.
   */
  setTutorialHint(hint: string | null): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('cursor-status-tutorial-hint', hint);
    }
  }
  
  /**
   * Show a "no target input field" error at the cursor position.
   * Used when pasting from clipboard history but no text input is focused.
   * This can be called on-demand, not just during transcription flow.
   */
  showNoTargetError(message?: string): void {
    // Clear any pending timeouts from previous states.
    if (this.doneTimeout) {
      clearTimeout(this.doneTimeout);
      this.doneTimeout = null;
    }
    if (this.pasteFailedTimeout) {
      clearTimeout(this.pasteFailedTimeout);
      this.pasteFailedTimeout = null;
    }
    
    this.state = 'paste-failed';
    this.updateWindowSize('paste-failed');
    
    // Show the window if not already visible.
    this.show();
    
    // Send state and data to renderer.
    this.sendStateToRenderer('paste-failed');
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('cursor-status-data', { 
        transcription: message || 'No target input field',
        pasteFailed: true 
      });
    }
    
    // Auto-hide after duration.
    this.pasteFailedTimeout = setTimeout(() => {
      this.pasteFailedTimeout = null;
      this.state = 'idle';
      this.hide();
    }, this.PASTE_FAILED_DURATION_MS);
  }
  
  /**
   * Update window size based on state (wider for text-heavy states).
   * Also toggles mouse event handling - allow clicks in paste-failed/done states for dismiss.
   */
  private updateWindowSize(state: CursorStatusState): void {
    if (!this.window || this.window.isDestroyed()) return;
    
    // Done state just shows "Pasted" - no wide window needed
    const needsWide = state === 'confirmation' || state === 'paste-failed';
    const needsTall = state === 'paste-failed'; // For wrapped transcript text
    const width = needsWide ? this.WINDOW_WIDTH_WIDE : this.WINDOW_WIDTH_NORMAL;
    const height = needsTall ? this.WINDOW_HEIGHT_TALL : this.WINDOW_HEIGHT_NORMAL;
    
    const [currentWidth, currentHeight] = this.window.getSize();
    if (currentWidth !== width || currentHeight !== height) {
      this.window.setSize(width, height);
    }
    
    // Allow mouse events for paste-failed/done states (click to dismiss)
    // Ignore mouse events for other states so they pass through
    const allowMouse = state === 'paste-failed' || state === 'done';
    this.window.setIgnoreMouseEvents(!allowMouse);
  }
  
  /**
   * Send state update to the renderer process.
   */
  private sendStateToRenderer(state: CursorStatusState): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('cursor-status-state', state);
    }
  }

  /**
   * Show the cursor status overlay and start tracking.
   */
  private show(): void {
    if (!this.enabled) return;
    
    if (!this.window || this.window.isDestroyed()) {
      this.createWindow();
    }
    
    if (this.window) {
      this.window.showInactive();
      this.startTracking();
    }
  }

  /**
   * Hide the overlay and stop tracking.
   */
  private hide(): void {
    this.stopTracking();
    
    if (this.window && !this.window.isDestroyed()) {
      this.window.hide();
    }
  }

  /**
   * Create the overlay window.
   */
  private createWindow(): void {
    const cursorPos = screen.getCursorScreenPoint();
    
    this.window = new BrowserWindow({
      type: 'panel',  // NSPanel for floating above all windows including Field Theory
      width: this.WINDOW_WIDTH_NORMAL,
      height: this.WINDOW_HEIGHT_NORMAL,
      x: cursorPos.x + this.CURSOR_OFFSET_X,
      y: cursorPos.y + this.CURSOR_OFFSET_Y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: false,
      hasShadow: false,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../cursor-status-preload.js'),
      },
    });

    // Show on all workspaces including full-screen apps
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    
    // Ensure highest z-level to appear above Field Theory and other windows
    // Use level 2 to be above clipboard history (level 1)
    this.window.setAlwaysOnTop(true, 'screen-saver', 2);
    
    // Ignore mouse events so clicks pass through
    this.window.setIgnoreMouseEvents(true);

    // Load the overlay HTML
    const startUrl = process.env.ELECTRON_START_URL;
    if (startUrl) {
      // Ensure trailing slash before appending filename
      const baseUrl = startUrl.endsWith('/') ? startUrl : `${startUrl}/`;
      this.window.loadURL(`${baseUrl}cursor-status.html`);
    } else {
      const htmlPath = path.join(app.getAppPath(), 'dist', 'cursor-status.html');
      this.window.loadFile(htmlPath);
    }

    this.window.on('closed', () => {
      this.window = null;
      this.stopTracking();
    });

    // Send initial state once loaded.
    this.window.webContents.once('did-finish-load', () => {
      if (this.window && !this.window.isDestroyed()) {
        this.window.webContents.send('cursor-status-state', this.state);
        this.window.webContents.send('cursor-status-idle', this.isIdle);
        this.window.webContents.send('cursor-status-hide-labels', this.hideLabels);
        this.sendLabelVisibilityToRenderer();
      }
    });
  }

  /**
   * Start polling cursor position.
   */
  private startTracking(): void {
    if (this.pollInterval) return;
    
    this.lastCursorPos = screen.getCursorScreenPoint();
    this.cursorIdleTime = 0;
    this.isIdle = false;
    
    // Reset flip state so indicator starts in default position.
    this.isFlippedX = false;
    this.isFlippedY = false;
    
    this.pollInterval = setInterval(() => {
      this.updateCursorPosition();
    }, this.POLL_INTERVAL_MS);
  }

  /**
   * Stop polling cursor position.
   */
  private stopTracking(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.cursorIdleTime = 0;
    this.isIdle = false;
  }

  /**
   * Update window position and idle state based on cursor movement.
   */
  private updateCursorPosition(): void {
    if (!this.window || this.window.isDestroyed()) return;
    
    const cursorPos = screen.getCursorScreenPoint();
    
    // Calculate movement since last poll
    const dx = Math.abs(cursorPos.x - this.lastCursorPos.x);
    const dy = Math.abs(cursorPos.y - this.lastCursorPos.y);
    const moved = dx > this.MOVEMENT_THRESHOLD_PX || dy > this.MOVEMENT_THRESHOLD_PX;
    
    if (moved) {
      // Cursor moved - reset idle tracking
      this.cursorIdleTime = 0;
      if (this.isIdle) {
        this.isIdle = false;
        this.window.webContents.send('cursor-status-idle', false);
      }
    } else {
      // Cursor still - accumulate idle time
      this.cursorIdleTime += this.POLL_INTERVAL_MS;
      if (!this.isIdle && this.cursorIdleTime >= this.IDLE_THRESHOLD_MS) {
        this.isIdle = true;
        this.window.webContents.send('cursor-status-idle', true);
      }
    }
    
    this.lastCursorPos = cursorPos;
    
    // Calculate new window position with screen edge clamping and hysteresis.
    const display = screen.getDisplayNearestPoint(cursorPos);
    const bounds = display.bounds;
    
    // Get current window dimensions.
    const [windowWidth, windowHeight] = this.window.getSize();
    
    // Calculate default position (to the right and slightly above cursor).
    const rightX = cursorPos.x + this.CURSOR_OFFSET_X;
    const leftX = cursorPos.x - this.CURSOR_OFFSET_X - windowWidth;
    const belowY = cursorPos.y + this.CURSOR_OFFSET_Y;
    const aboveY = cursorPos.y - this.CURSOR_OFFSET_Y - windowHeight;
    
    // Hysteresis for X: Only flip when necessary, and only flip back when cursor
    // moves far enough from edge to avoid jittery bouncing.
    const wouldOverflowRight = rightX + windowWidth > bounds.x + bounds.width;
    const safeFromRightEdge = rightX + windowWidth + this.FLIP_HYSTERESIS_PX < bounds.x + bounds.width;
    
    if (this.isFlippedX) {
      // Currently on left side of cursor - flip back only if safe
      if (safeFromRightEdge) {
        this.isFlippedX = false;
      }
    } else {
      // Currently on right side of cursor - flip if would overflow
      if (wouldOverflowRight) {
        this.isFlippedX = true;
      }
    }
    
    // Hysteresis for Y: Same logic for vertical flipping.
    const wouldOverflowBottom = belowY + windowHeight > bounds.y + bounds.height;
    const safeFromBottomEdge = belowY + windowHeight + this.FLIP_HYSTERESIS_PX < bounds.y + bounds.height;
    
    if (this.isFlippedY) {
      // Currently above cursor - flip back only if safe
      if (safeFromBottomEdge) {
        this.isFlippedY = false;
      }
    } else {
      // Currently below cursor - flip if would overflow
      if (wouldOverflowBottom) {
        this.isFlippedY = true;
      }
    }
    
    // Apply the flip state.
    let newX = this.isFlippedX ? leftX : rightX;
    let newY = this.isFlippedY ? aboveY : belowY;
    
    // Ensure we don't go off the left or top edges.
    newX = Math.max(bounds.x, newX);
    newY = Math.max(bounds.y, newY);
    
    this.window.setPosition(Math.round(newX), Math.round(newY), false);
  }

  /**
   * Check if the indicator is currently visible.
   */
  isVisible(): boolean {
    return this.window !== null && !this.window.isDestroyed() && this.window.isVisible();
  }

  /**
   * Clean up resources.
   */
  destroy(): void {
    this.stopTracking();
    if (this.doneTimeout) {
      clearTimeout(this.doneTimeout);
      this.doneTimeout = null;
    }
    if (this.pasteFailedTimeout) {
      clearTimeout(this.pasteFailedTimeout);
      this.pasteFailedTimeout = null;
    }
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
    }
    this.window = null;
    ipcMain.removeAllListeners('cursor-status-confirmation-response');
    ipcMain.removeAllListeners('cursor-status-dismiss');
  }
}
