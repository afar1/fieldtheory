import { app, BrowserWindow, screen, systemPreferences, shell, desktopCapturer, dialog } from 'electron';
import path from 'path';
import type { PreferencesManager } from './preferences';
import { createLogger } from './logger';

const log = createLogger('Onboarding');

/**
 * Onboarding step identifiers.
 * Maps to the 4-phase flow in the Onboarding component:
 * - PERMISSIONS (0): Microphone, Accessibility, Screen Recording
 * - MODEL (1): Voice model download
 * - ACCOUNT (2): Email sign-in with OTP
 * - SHORTCUTS (3): Keyboard shortcuts configuration
 */
export enum OnboardingStep {
  PERMISSIONS = 0,
  MODEL = 1,
  ACCOUNT = 2,
  SHORTCUTS = 3,
}

/**
 * Permission status for each required system permission.
 */
export interface PermissionStatus {
  microphone: 'granted' | 'denied' | 'not-determined';
  accessibility: boolean;
  screenRecording: boolean;
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
  private preferencesManager: PreferencesManager | null = null;
  private isAppQuitting = false;

  // Compact window size for streamlined 2-phase onboarding (permissions + model).
  private readonly WINDOW_WIDTH = 500;
  private readonly WINDOW_HEIGHT = 450;

  constructor() {
    // Track when app is quitting to allow window close without confirmation.
    app.on('before-quit', () => {
      this.isAppQuitting = true;
    });
  }

  /**
   * Set the preferences manager for checking onboarding completion status.
   * This is used to prevent closing the window before onboarding is complete.
   */
  setPreferencesManager(manager: PreferencesManager): void {
    this.preferencesManager = manager;
  }

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
    
    // Check screen recording permission (needed for screenshots).
    const screenStatusRaw = systemPreferences.getMediaAccessStatus('screen');
    const screenRecordingStatus = screenStatusRaw === 'granted';
    
    return {
      microphone: micStatus,
      accessibility: accessibilityStatus,
      screenRecording: screenRecordingStatus,
    };
  }

  /**
   * Request microphone permission.
   * Returns true if permission was granted.
   * If permission was previously denied, opens System Settings instead.
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

    // Permission was denied/revoked - open System Settings since we can't request again.
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
    return false;
  }

  /**
   * Open System Settings to the Accessibility pane.
   * Users must manually grant accessibility permission.
   */
  openAccessibilitySettings(): void {
    // This triggers the system prompt and opens System Settings if needed.
    systemPreferences.isTrustedAccessibilityClient(true);
  }

  /**
   * Open System Settings to the Screen Recording pane.
   * Users must manually grant screen recording permission for screenshots.
   * Note: The x-apple.systempreferences URL scheme works on macOS 13+ as well,
   * automatically opening System Settings instead of the legacy System Preferences.
   */
  openScreenRecordingSettings(): void {
    shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture');
  }

  /**
   * Trigger a screen capture attempt to add the app to the Screen Recording list.
   * macOS will automatically add the app to the permissions list (but disabled).
   * This saves users from having to manually click "+" to add the app.
   */
  async triggerScreenRecordingPrompt(): Promise<void> {
    try {
      // Attempting to get screen sources triggers macOS to add the app to the list.
      await desktopCapturer.getSources({ types: ['screen'] });

      // Small delay to give macOS time to update the permissions list.
      // Without this, opening System Settings immediately may not show the app.
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      // Expected to fail if permission not granted - that's fine.
    }
  }

  /**
   * Show the onboarding window.
   * If already visible, brings it to focus.
   * Also shows the app in the Dock so user can Cmd+Tab back to it.
   */
  show(startStep: OnboardingStep = OnboardingStep.PERMISSIONS): void {
    // Show app in Dock during onboarding so user can Cmd+Tab back
    if (app.dock) {
      app.dock.show();
    }

    if (this.window && !this.window.isDestroyed()) {
      // Bring to front on macOS
      this.window.show();
      this.window.focus();
      app.focus({ steal: true });
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
      show: false, // Don't show until ready-to-show fires
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

    // Show and focus the window when ready.
    this.window.once('ready-to-show', () => {
      if (this.window && !this.window.isDestroyed()) {
        this.window.show();
        this.window.focus();
        app.focus({ steal: true });
      }
    });

    // Load the onboarding page with the start step as a query param.
    const startUrl = process.env.ELECTRON_START_URL;
    if (startUrl) {
      // Dev mode - load from Vite dev server.
      this.window.loadURL(`${startUrl}#/onboarding?step=${startStep}`);
    } else {
      // Production - load from built files (frontend is in dist/, not electron-dist/).
      const indexPath = path.join(app.getAppPath(), 'dist', 'index.html');
      this.window.loadFile(indexPath, { hash: `/onboarding?step=${startStep}` });
    }

    // Handle close during onboarding - show quit confirmation.
    this.window.on('close', async (event) => {
      // If app is quitting (Cmd+Q or menu quit), allow immediate close.
      if (this.isAppQuitting) {
        return;
      }

      if (!this.preferencesManager) {
        return;
      }

      const prefs = this.preferencesManager.get();
      const isComplete = prefs?.onboardingComplete ?? false;

      if (!isComplete && this.window && !this.window.isDestroyed()) {
        // Prevent the default close and show confirmation dialog.
        event.preventDefault();

        const { response } = await dialog.showMessageBox(this.window, {
          type: 'question',
          buttons: ['Continue Onboarding', 'Quit Field Theory'],
          defaultId: 0,
          cancelId: 0,
          title: 'Quit Field Theory?',
          message: 'Quit Field Theory?',
          detail: 'You haven\'t finished setting up. Are you sure you want to quit?',
        });

        if (response === 1) {
          // User chose to quit - set flag and quit app
          this.isAppQuitting = true;
          app.quit();
        }
        // Otherwise, do nothing - keep onboarding open
      }
    });

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

