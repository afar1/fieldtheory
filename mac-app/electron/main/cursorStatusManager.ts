import { BrowserWindow, screen, app, ipcMain } from 'electron';
import { EventEmitter } from 'events';
import path from 'path';

/**
 * Status states for the cursor indicator.
 * - idle: No indicator shown
 * - recording: Red pulsing dot with "Say anything" label
 * - transcribing: Purple dot, "Transcribing..." text when cursor is still
 * - improving: Blue dot, "improving..." text during AI improvement
 * - done: Green dot with "Pasted", shown briefly after transcribing completes
 * - confirmation: Red pulsing dot with countdown, awaiting abandon/continue decision
 * - paste-failed: Orange dot, shows transcription then "Saved to Field Theory"
 */
export type CursorStatusState = 'idle' | 'recording' | 'transcribing' | 'improving' | 'done' | 'confirmation' | 'paste-failed';

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
  private readonly DONE_DURATION_MS = 800;
  
  // Paste-failed state timeout - brief since message is simple now.
  private pasteFailedTimeout: NodeJS.Timeout | null = null;
  private readonly PASTE_FAILED_DURATION_MS = 3000;
  
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
  private readonly WINDOW_WIDTH_EXTRA_WIDE = 500; // For recording notes with long text
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
    const wasImproving = this.state === 'improving';
    const isActive = state !== 'idle';
    
    // When transcribing or improving finishes, show 'done' briefly before hiding
    if ((wasTranscribing || wasImproving) && state === 'idle' && this.enabled) {
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

  private recordingNoteActive: boolean = false;
  private recordingNoteTimeout: NodeJS.Timeout | null = null;

  /**
   * Show a recording note to the right of the stack indicator.
   * Used for informational warnings during recording that don't interrupt the flow.
   * Example: "Note: Stacking 10+ images, some input fields may have limits"
   * Auto-dismisses after 3 seconds.
   * @param note - The note to display, or null to clear
   */
  showRecordingNote(note: string | null): void {
    // Clear any existing timeout
    if (this.recordingNoteTimeout) {
      clearTimeout(this.recordingNoteTimeout);
      this.recordingNoteTimeout = null;
    }

    this.recordingNoteActive = note !== null;

    // Resize window to accommodate the note
    if (this.state === 'recording') {
      this.updateWindowSize('recording');
    }

    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('cursor-status-recording-note', note);
    }

    // Auto-dismiss after 3 seconds
    if (note !== null) {
      this.recordingNoteTimeout = setTimeout(() => {
        this.recordingNoteActive = false;
        this.recordingNoteTimeout = null;
        // Resize window back to normal
        if (this.state === 'recording') {
          this.updateWindowSize('recording');
        }
      }, 3000);
    }
  }

  /**
   * Show a critical message that always displays regardless of user preferences.
   * Use this for important warnings, errors, or notifications that users must see.
   * Message auto-dismisses after 2.5 seconds.
   *
   * Examples:
   * - "Pasting 10+ images – some apps may have limits"
   * - "No target input field"
   * - "Recording stopped - maximum duration reached"
   *
   * @param message - The message to display to the user
   */
  showCriticalMessage(message: string): void {
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

    // Force show the window even if cursor status is disabled (critical messages always show).
    this.show(true);

    // Send state and data to renderer.
    this.sendStateToRenderer('paste-failed');
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('cursor-status-data', {
        transcription: message,
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
   * Show a "no target input field" error at the cursor position.
   * Used when pasting from clipboard history but no text input is focused.
   * This can be called on-demand, not just during transcription flow.
   *
   * @deprecated Use showCriticalMessage() instead for consistency
   */
  showNoTargetError(message?: string): void {
    this.showCriticalMessage(message || 'No target input field');
  }
  
  /**
   * Update window size based on state (wider for text-heavy states).
   * Also toggles mouse event handling - allow clicks in paste-failed/done states for dismiss.
   */
  private updateWindowSize(state: CursorStatusState): void {
    if (!this.window || this.window.isDestroyed()) return;

    // Determine width based on content needs
    const needsWide = state === 'confirmation' || state === 'paste-failed';
    const needsExtraWide = state === 'recording' && this.recordingNoteActive;
    const needsTall = state === 'paste-failed'; // For wrapped transcript text

    let width = this.WINDOW_WIDTH_NORMAL;
    if (needsExtraWide) {
      width = this.WINDOW_WIDTH_EXTRA_WIDE;
    } else if (needsWide) {
      width = this.WINDOW_WIDTH_WIDE;
    }

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
   * @param forceShow - If true, shows the window even when cursor status is disabled.
   *                    Used by showCriticalMessage() to ensure important notifications always display.
   */
  private show(forceShow: boolean = false): void {
    if (!this.enabled && !forceShow) return;

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
    
    // Position dot at fixed offset from cursor. No edge clamping - it's fine if the
    // dot is partially hidden at screen edges since it's small and user will move cursor.
    const newX = cursorPos.x + this.CURSOR_OFFSET_X;
    const newY = cursorPos.y + this.CURSOR_OFFSET_Y;
    
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
