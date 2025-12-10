import { app, BrowserWindow, screen, ipcMain } from 'electron';
import { EventEmitter } from 'events';
import path from 'path';
import { OverlayStyle } from './preferences';

/**
 * Manages the recording indicator overlay window.
 * Shows a small, always-on-top window with live waveform animation.
 * Supports stacking mode with persistent "stacking" indicator.
 * Supports confirmation dialogs for abandoning recordings.
 */
export class RecordingOverlay extends EventEmitter {
  private window: BrowserWindow | null = null;
  private overlayStyle: OverlayStyle = 'rectangle';
  private isStackingMode: boolean = false;
  private isShowingConfirmation: boolean = false;
  
  // Rectangle style dimensions
  private readonly RECTANGLE_WIDTH = 100;
  private readonly RECTANGLE_HEIGHT = 36;
  
  // Top-emerging style dimensions (wider, taller to look like Dynamic Island)
  private readonly TOP_EMERGING_WIDTH = 120;
  private readonly TOP_EMERGING_HEIGHT = 44;
  
  // Stacking mode dimensions (slightly wider to fit "stacking" label)
  private readonly STACKING_WIDTH = 140;
  private readonly STACKING_HEIGHT = 44;
  
  // Confirmation dimensions (wider to fit message)
  private readonly CONFIRMATION_WIDTH = 280;
  private readonly CONFIRMATION_HEIGHT = 60;
  
  constructor() {
    super();
    
    // Listen for confirmation responses from the overlay renderer.
    ipcMain.on('overlay-abandon-confirmed', () => {
      this.emit('abandon-confirmed');
    });
    
    ipcMain.on('overlay-abandon-cancelled', () => {
      this.emit('abandon-cancelled');
    });
  }

  /**
   * Set the overlay style preference.
   */
  setOverlayStyle(style: OverlayStyle): void {
    this.overlayStyle = style;
    // If window exists, recreate it with new style
    if (this.window && !this.window.isDestroyed()) {
      const wasVisible = this.window.isVisible();
      const currentState = this.window.webContents ? 'recording' : 'recording';
      this.window.close();
      this.window = null;
      if (wasVisible) {
        this.showRecording();
      }
    }
  }

  /**
   * Show the overlay window in recording state.
   */
  showRecording(): void {
    console.log('[RecordingOverlay] showRecording() called');
    
    if (this.window && !this.window.isDestroyed()) {
      this.window.showInactive();
      this.sendState('recording');
      this.sendStyle(this.overlayStyle);
      return;
    }

    const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    const isTopEmerging = this.overlayStyle === 'top-emerging';
    
    // Calculate dimensions based on style
    const width = isTopEmerging ? this.TOP_EMERGING_WIDTH : this.RECTANGLE_WIDTH;
    const height = isTopEmerging ? this.TOP_EMERGING_HEIGHT : this.RECTANGLE_HEIGHT;
    
    // Calculate position based on style
    const x = Math.floor((screenWidth - width) / 2);
    const y = isTopEmerging ? 8 : 50; // Top-emerging: near top (8px), Rectangle: centered vertically (50px)

    this.window = new BrowserWindow({
      width,
      height,
      x,
      y,
      frame: false,
      transparent: isTopEmerging, // Top-emerging uses transparent for rounded top effect
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: false,
      show: false,
      backgroundColor: isTopEmerging ? '#00000000' : '#1a1a1a', // Transparent for top-emerging, dark for rectangle
      hasShadow: true,
      roundedCorners: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../overlay-preload.js'),
      },
    });
    
    // Show immediately without stealing focus
    this.window.showInactive();
    console.log('[RecordingOverlay] Window shown (inactive)');

    // Load overlay HTML
    const startUrl = process.env.ELECTRON_START_URL;
    if (startUrl) {
      this.window.loadURL(`${startUrl}overlay.html`);
    } else {
      const htmlPath = path.join(app.getAppPath(), 'dist', 'overlay.html');
      console.log('[RecordingOverlay] Loading HTML from:', htmlPath);
      this.window.loadFile(htmlPath);
    }

    this.window.on('closed', () => {
      this.window = null;
    });

    this.window.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
      console.error('[RecordingOverlay] Load failed:', errorCode, errorDescription);
    });

    this.window.webContents.once('did-finish-load', () => {
      console.log('[RecordingOverlay] Content loaded');
      this.sendState('recording');
      this.sendStyle(this.overlayStyle);
    });
  }

  updateAudioLevel(level: number): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('audio-level', level);
    }
  }

  showTranscribing(): void {
    this.sendState('transcribing');
  }

  /**
   * Show the overlay in stacking idle state.
   * Displays a minimal "stacking" label without recording/transcribing indicators.
   * Used between recordings when stacking mode is active.
   */
  showStackingIdle(): void {
    console.log('[RecordingOverlay] showStackingIdle() called');
    
    if (!this.isStackingMode) {
      console.warn('[RecordingOverlay] showStackingIdle called but stacking mode is off');
      return;
    }

    // If window doesn't exist, create it
    if (!this.window || this.window.isDestroyed()) {
      this.createStackingWindow();
    } else {
      this.window.showInactive();
    }
    
    this.sendState('stacking-idle');
    this.sendStyle(this.overlayStyle);
    this.sendStackingMode(true);
  }

  /**
   * Create the overlay window configured for stacking mode.
   */
  private createStackingWindow(): void {
    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
    
    const width = this.STACKING_WIDTH;
    const height = this.STACKING_HEIGHT;
    const x = Math.floor((screenWidth - width) / 2);
    const y = 8; // Near top like top-emerging style

    this.window = new BrowserWindow({
      width,
      height,
      x,
      y,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: false,
      show: false,
      backgroundColor: '#00000000',
      hasShadow: true,
      roundedCorners: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '../overlay-preload.js'),
      },
    });
    
    this.window.showInactive();

    const startUrl = process.env.ELECTRON_START_URL;
    if (startUrl) {
      this.window.loadURL(`${startUrl}overlay.html`);
    } else {
      const htmlPath = path.join(app.getAppPath(), 'dist', 'overlay.html');
      this.window.loadFile(htmlPath);
    }

    this.window.on('closed', () => {
      this.window = null;
    });

    this.window.webContents.once('did-finish-load', () => {
      this.sendState('stacking-idle');
      this.sendStyle(this.overlayStyle);
      this.sendStackingMode(true);
    });
  }

  /**
   * Set stacking mode on/off.
   * When on, the overlay persists between recordings.
   */
  setStackingMode(active: boolean): void {
    console.log(`[RecordingOverlay] setStackingMode(${active})`);
    this.isStackingMode = active;
    this.sendStackingMode(active);
  }

  /**
   * Dismiss the overlay. In stacking mode, only hides temporarily during certain states.
   * When stacking mode is off, fully closes the window.
   */
  dismiss(): void {
    if (!this.window) {
      return;
    }

    // In stacking mode, don't close the window - just send dismiss state briefly
    // The window should remain visible for the next recording
    if (this.isStackingMode) {
      // Keep window visible but show idle stacking state
      this.sendState('stacking-idle');
      return;
    }

    // Normal dismiss - close the window
    this.sendState('dismiss');
    setTimeout(() => {
      if (this.window && !this.window.isDestroyed()) {
        this.window.close();
        this.window = null;
      }
    }, 300);
  }

  private sendState(state: 'recording' | 'transcribing' | 'dismiss' | 'stacking-idle' | 'confirmation'): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('overlay-state', state);
    }
  }
  
  private sendStackingMode(active: boolean): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('overlay-stacking-mode', active);
    }
  }

  private sendStyle(style: OverlayStyle): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('overlay-style', style);
    }
  }

  /**
   * Show confirmation dialog for abandoning recording.
   * Expands the overlay to show a confirmation message.
   */
  showConfirmation(): void {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }
    
    this.isShowingConfirmation = true;
    
    // Resize window to fit confirmation message.
    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
    const newX = Math.floor((screenWidth - this.CONFIRMATION_WIDTH) / 2);
    
    this.window.setBounds({
      x: newX,
      y: 8,
      width: this.CONFIRMATION_WIDTH,
      height: this.CONFIRMATION_HEIGHT,
    });
    
    this.sendState('confirmation');
    console.log('[RecordingOverlay] Showing abandon confirmation');
  }
  
  /**
   * Hide confirmation dialog and return to recording state.
   */
  hideConfirmation(): void {
    if (!this.window || this.window.isDestroyed() || !this.isShowingConfirmation) {
      return;
    }
    
    this.isShowingConfirmation = false;
    
    // Resize window back to normal recording size.
    const isTopEmerging = this.overlayStyle === 'top-emerging';
    const width = isTopEmerging ? this.TOP_EMERGING_WIDTH : this.RECTANGLE_WIDTH;
    const height = isTopEmerging ? this.TOP_EMERGING_HEIGHT : this.RECTANGLE_HEIGHT;
    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
    const newX = Math.floor((screenWidth - width) / 2);
    const y = isTopEmerging ? 8 : 50;
    
    this.window.setBounds({
      x: newX,
      y,
      width,
      height,
    });
    
    this.sendState('recording');
    console.log('[RecordingOverlay] Hiding abandon confirmation');
  }
  
  /**
   * Check if confirmation dialog is currently showing.
   */
  isConfirmationShowing(): boolean {
    return this.isShowingConfirmation;
  }

  isVisible(): boolean {
    return this.window !== null && !this.window.isDestroyed() && this.window.isVisible();
  }

  destroy(): void {
    if (this.window) {
      this.window.close();
      this.window = null;
    }
    
    // Remove IPC listeners.
    ipcMain.removeAllListeners('overlay-abandon-confirmed');
    ipcMain.removeAllListeners('overlay-abandon-cancelled');
  }
}
