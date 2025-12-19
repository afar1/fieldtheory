import { app, BrowserWindow, screen, systemPreferences, shell } from 'electron';
import path from 'path';

/**
 * Onboarding step identifiers.
 * Each step represents a screen in the first-run wizard.
 */
export enum OnboardingStep {
  WELCOME = 0,
  MICROPHONE = 1,
  ACCESSIBILITY = 2,
  MODEL_DOWNLOAD = 3,
  COMPLETE = 4,
}

/**
 * Permission status for each required system permission.
 */
export interface PermissionStatus {
  microphone: 'granted' | 'denied' | 'not-determined';
  accessibility: boolean;
}

/**
 * Manages the onboarding wizard window for first-run experience.
 * 
 * The onboarding flow guides users through:
 * 1. Welcome screen (privacy messaging)
 * 2. Microphone permission
 * 3. Accessibility permission (for paste functionality)
 * 4. Whisper model download
 * 5. Completion with hotkey instruction
 */
export class OnboardingWindow {
  private window: BrowserWindow | null = null;
  
  private readonly WINDOW_WIDTH = 600;
  private readonly WINDOW_HEIGHT = 500;

  /**
   * Check current permission status for all required permissions.
   */
  async getPermissionStatus(): Promise<PermissionStatus> {
    // Check microphone permission status.
    // Map "restricted" and "unknown" to "denied" to match our interface.
    const micStatusRaw = systemPreferences.getMediaAccessStatus('microphone');
    const micStatus: 'granted' | 'denied' | 'not-determined' = 
      micStatusRaw === 'granted' || micStatusRaw === 'denied' || micStatusRaw === 'not-determined'
        ? micStatusRaw
        : 'denied';
    
    // Check accessibility permission (needed for simulating keyboard input).
    const accessibilityStatus = systemPreferences.isTrustedAccessibilityClient(false);
    
    return {
      microphone: micStatus,
      accessibility: accessibilityStatus,
    };
  }

  /**
   * Request microphone permission.
   * Returns true if permission was granted.
   */
  async requestMicrophonePermission(): Promise<boolean> {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    
    if (status === 'granted') {
      return true;
    }
    
    if (status === 'not-determined') {
      // Request permission - this will show the system dialog.
      const granted = await systemPreferences.askForMediaAccess('microphone');
      return granted;
    }
    
    // Permission was denied - user needs to go to System Settings.
    return false;
  }

  /**
   * Open System Settings directly to the Accessibility pane.
   * Users must manually grant accessibility permission.
   */
  openAccessibilitySettings(): void {
    // Open System Settings directly to Privacy & Security > Accessibility.
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
  }

  /**
   * Show the onboarding window.
   * If already visible, brings it to focus.
   */
  show(startStep: OnboardingStep = OnboardingStep.WELCOME): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.focus();
      return;
    }

    // Center on primary display.
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
    const x = Math.round((screenWidth - this.WINDOW_WIDTH) / 2);
    const y = Math.round((screenHeight - this.WINDOW_HEIGHT) / 2);

    const preloadPath = path.join(__dirname, '../preload.js');

    this.window = new BrowserWindow({
      width: this.WINDOW_WIDTH,
      height: this.WINDOW_HEIGHT,
      x,
      y,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      backgroundColor: '#ffffff',
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 16 },
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: preloadPath,
        devTools: process.env.NODE_ENV !== 'production',
      },
    });

    // Load the onboarding page with the start step as a query param.
    const startUrl = process.env.ELECTRON_START_URL;
    if (startUrl) {
      // Dev mode - load from Vite dev server.
      this.window.loadURL(`${startUrl}#/onboarding?step=${startStep}`);
    } else {
      // Production - load from built files.
      const indexPath = path.join(app.getAppPath(), 'dist', 'index.html');
      this.window.loadFile(indexPath, { hash: `/onboarding?step=${startStep}` });
    }

    this.window.on('closed', () => {
      this.window = null;
    });
  }

  /**
   * Close the onboarding window.
   */
  close(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
      this.window = null;
    }
  }

  /**
   * Check if onboarding window is currently visible.
   */
  isVisible(): boolean {
    return this.window !== null && !this.window.isDestroyed();
  }

  /**
   * Send a message to the onboarding renderer.
   */
  send(channel: string, ...args: unknown[]): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, ...args);
    }
  }
}

