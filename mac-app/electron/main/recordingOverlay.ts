import { app, BrowserWindow, screen } from 'electron';
import path from 'path';
import { OverlayStyle } from './preferences';

/**
 * Manages the recording indicator overlay window.
 * Shows a small, always-on-top window with live waveform animation.
 */
export class RecordingOverlay {
  private window: BrowserWindow | null = null;
  private overlayStyle: OverlayStyle = 'rectangle';
  
  // Rectangle style dimensions
  private readonly RECTANGLE_WIDTH = 100;
  private readonly RECTANGLE_HEIGHT = 36;
  
  // Top-emerging style dimensions (wider, taller to look like Dynamic Island)
  private readonly TOP_EMERGING_WIDTH = 120;
  private readonly TOP_EMERGING_HEIGHT = 44;

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
      // Use absolute path via app.getAppPath() to ensure correct resolution
      // regardless of working directory (important for npm start vs packaged app)
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

  dismiss(): void {
    if (this.window) {
      this.sendState('dismiss');
      setTimeout(() => {
        if (this.window && !this.window.isDestroyed()) {
          this.window.close();
          this.window = null;
        }
      }, 300);
    }
  }

  private sendState(state: 'recording' | 'transcribing' | 'dismiss'): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('overlay-state', state);
    }
  }

  private sendStyle(style: OverlayStyle): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('overlay-style', style);
    }
  }

  isVisible(): boolean {
    return this.window !== null && !this.window.isDestroyed() && this.window.isVisible();
  }

  destroy(): void {
    if (this.window) {
      this.window.close();
      this.window = null;
    }
  }
}
