import { app, BrowserWindow, screen, systemPreferences, shell, desktopCapturer } from 'electron';
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
  SCREEN_RECORDING = 4,
  COMPLETE = 5,
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
  private normalBounds: Electron.Rectangle | null = null;
  private animationTimer: NodeJS.Timeout | null = null;
  
  private readonly WINDOW_WIDTH = 600;
  private readonly WINDOW_HEIGHT = 500;
  private readonly EXPANDED_WIDTH = 720;
  private readonly EXPANDED_HEIGHT = 600;

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
    console.log('[Onboarding] Screen recording permission status:', screenStatusRaw, '→', screenRecordingStatus);
    
    return {
      microphone: micStatus,
      accessibility: accessibilityStatus,
      screenRecording: screenRecordingStatus,
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
    } catch (error) {
      // Expected to fail if permission not granted - that's fine.
      console.log('[Onboarding] Screen capture triggered to add app to permissions list');
    }
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
      const indexPath = path.join(app.getAppPath(), 'electron-dist', 'index.html');
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

  /**
   * Expand the window for the tutorial phase.
   * Uses smooth animation to resize and recenter.
   */
  expandWindow(): void {
    if (!this.window || this.window.isDestroyed()) return;
    if (this.normalBounds) return; // Already expanded.

    this.normalBounds = this.window.getBounds();
    
    const current = this.normalBounds;
    const newWidth = this.EXPANDED_WIDTH;
    const newHeight = this.EXPANDED_HEIGHT;
    const newX = Math.round(current.x - (newWidth - current.width) / 2);
    const newY = Math.round(current.y - (newHeight - current.height) / 2);

    // Clamp to work area bounds.
    const display = screen.getDisplayNearestPoint({ x: current.x, y: current.y });
    const workArea = display.workArea;

    const clampedBounds = {
      x: Math.max(workArea.x, Math.min(newX, workArea.x + workArea.width - newWidth)),
      y: Math.max(workArea.y, Math.min(newY, workArea.y + workArea.height - newHeight)),
      width: Math.min(newWidth, workArea.width),
      height: Math.min(newHeight, workArea.height),
    };

    this.animateBounds(clampedBounds);
  }

  /**
   * Contract the window back to normal size.
   */
  contractWindow(): void {
    if (!this.window || this.window.isDestroyed()) return;
    if (!this.normalBounds) return; // Not expanded.

    this.animateBounds(this.normalBounds);
    this.normalBounds = null;
  }

  /**
   * Animate window bounds change over time.
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
      const progress = currentStep / steps;
      // Ease-out curve for smooth deceleration.
      const easedProgress = 1 - Math.pow(1 - progress, 3);

      const newBounds = {
        x: Math.round(startBounds.x + (targetBounds.x - startBounds.x) * easedProgress),
        y: Math.round(startBounds.y + (targetBounds.y - startBounds.y) * easedProgress),
        width: Math.round(startBounds.width + (targetBounds.width - startBounds.width) * easedProgress),
        height: Math.round(startBounds.height + (targetBounds.height - startBounds.height) * easedProgress),
      };

      if (this.window && !this.window.isDestroyed()) {
        this.window.setBounds(newBounds);
      }

      if (currentStep >= steps) {
        clearInterval(this.animationTimer!);
        this.animationTimer = null;
        // Ensure final bounds are exact.
        if (this.window && !this.window.isDestroyed()) {
          this.window.setBounds(targetBounds);
        }
      }
    }, stepDuration);
  }
}

