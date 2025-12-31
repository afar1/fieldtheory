import { BrowserWindow, screen, app, ipcMain } from 'electron';
import { EventEmitter } from 'events';
import path from 'path';

/**
 * Status states for the cursor indicator.
 * - idle: No indicator shown
 * - recording: Red pulsing dot with "Think outloud..." that fades away
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
  
  // Done state timeout - for showing brief green dot after transcribing
  private doneTimeout: NodeJS.Timeout | null = null;
  private readonly DONE_DURATION_MS = 500;
  
  // Paste-failed state timeout
  private pasteFailedTimeout: NodeJS.Timeout | null = null;
  private readonly PASTE_FAILED_DURATION_MS = 3000; // Show for 3s total
  
  // Timing constants
  private readonly POLL_INTERVAL_MS = 33; // ~30fps for smooth following
  private readonly IDLE_THRESHOLD_MS = 100; // Show text after 100ms of stillness
  private readonly MOVEMENT_THRESHOLD_PX = 3; // Pixels of movement to reset idle
  
  // Window dimensions and offset from cursor (positioned immediately to the right)
  private readonly WINDOW_WIDTH_NORMAL = 140;
  private readonly WINDOW_WIDTH_WIDE = 280; // For confirmation/paste-failed with longer text
  private readonly WINDOW_HEIGHT = 22;
  private readonly CURSOR_OFFSET_X = 16;  // To the right of cursor
  private readonly CURSOR_OFFSET_Y = 1;   // Just below cursor tip
  
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
      
      this.doneTimeout = setTimeout(() => {
        this.doneTimeout = null;
        this.state = 'idle';
        this.hide();
      }, this.DONE_DURATION_MS);
      return;
    }
    
    this.state = state;
    this.updateWindowSize(state);
    
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
  setStateWithData(state: CursorStatusState, data: { transcription?: string }): void {
    this.setState(state);
    
    if (state === 'paste-failed') {
      // Send data to renderer
      if (this.window && !this.window.isDestroyed()) {
        this.window.webContents.send('cursor-status-data', data);
      }
      
      // Auto-hide after duration
      this.pasteFailedTimeout = setTimeout(() => {
        this.pasteFailedTimeout = null;
        this.state = 'idle';
        this.hide();
      }, this.PASTE_FAILED_DURATION_MS);
    }
  }
  
  /**
   * Update window size based on state (wider for text-heavy states).
   */
  private updateWindowSize(state: CursorStatusState): void {
    if (!this.window || this.window.isDestroyed()) return;
    
    const needsWide = state === 'confirmation' || state === 'paste-failed';
    const width = needsWide ? this.WINDOW_WIDTH_WIDE : this.WINDOW_WIDTH_NORMAL;
    
    const [currentWidth] = this.window.getSize();
    if (currentWidth !== width) {
      this.window.setSize(width, this.WINDOW_HEIGHT);
    }
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
      width: this.WINDOW_WIDTH_NORMAL,
      height: this.WINDOW_HEIGHT,
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

    // Send initial state once loaded
    this.window.webContents.once('did-finish-load', () => {
      if (this.window && !this.window.isDestroyed()) {
        this.window.webContents.send('cursor-status-state', this.state);
        this.window.webContents.send('cursor-status-idle', this.isIdle);
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
    
    // Calculate new window position with screen edge clamping
    const display = screen.getDisplayNearestPoint(cursorPos);
    const bounds = display.bounds;
    
    // Get current window width (may be wide for confirmation/paste-failed)
    const [windowWidth] = this.window.getSize();
    
    let newX = cursorPos.x + this.CURSOR_OFFSET_X;
    let newY = cursorPos.y + this.CURSOR_OFFSET_Y;
    
    // Clamp to screen bounds
    if (newX + windowWidth > bounds.x + bounds.width) {
      // Flip to left side of cursor if too close to right edge
      newX = cursorPos.x - this.CURSOR_OFFSET_X - windowWidth;
    }
    if (newY + this.WINDOW_HEIGHT > bounds.y + bounds.height) {
      // Flip to above cursor if too close to bottom edge
      newY = cursorPos.y - this.CURSOR_OFFSET_Y - this.WINDOW_HEIGHT;
    }
    
    // Ensure we don't go off the left or top edges
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
  }
}
