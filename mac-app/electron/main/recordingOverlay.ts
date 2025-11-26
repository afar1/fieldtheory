import { BrowserWindow, screen } from 'electron';
import path from 'path';

/**
 * Manages the recording indicator overlay window.
 * Shows a small, always-on-top window with live waveform animation.
 */
export class RecordingOverlay {
  private window: BrowserWindow | null = null;
  private readonly WINDOW_WIDTH = 100;
  private readonly WINDOW_HEIGHT = 36;

  /**
   * Show the overlay window in recording state.
   */
  showRecording(): void {
    console.log('[RecordingOverlay] showRecording() called');
    
    if (this.window && !this.window.isDestroyed()) {
      this.window.showInactive();
      this.sendState('recording');
      return;
    }

    const { width: screenWidth } = screen.getPrimaryDisplay().workAreaSize;
    const x = Math.floor((screenWidth - this.WINDOW_WIDTH) / 2);
    const y = 50;

    this.window = new BrowserWindow({
      width: this.WINDOW_WIDTH,
      height: this.WINDOW_HEIGHT,
      x,
      y,
      frame: false,
      transparent: false, // Use solid background - more reliable
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: false,
      show: false,
      backgroundColor: '#1a1a1a', // Dark background - visible
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
      this.window.loadFile(path.join(__dirname, '../../dist/overlay.html'));
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
