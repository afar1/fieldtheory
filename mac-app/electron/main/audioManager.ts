import { EventEmitter } from 'events';
import { AudioDevice, AudioState, TransportType } from './types/audio';
import { NativeHelper } from './nativeHelper';

/**
 * AudioManager handles all audio device state and implements the priority policy.
 * 
 * Priority Policy Rules:
 * 1. When priorityMode is ON and a priority device is selected:
 *    - If no user override, ensure the priority device is the default input.
 * 2. When priorityMode is OFF:
 *    - Don't interfere with macOS default behavior.
 * 3. User overrides are respected until explicitly cleared.
 * 
 * Events emitted:
 * - 'stateChanged': Emitted with AudioState whenever any state changes.
 */
export class AudioManager extends EventEmitter {
  private devices: AudioDevice[] = [];
  private defaultInputId: string | null = null;
  private priorityMode = false;
  private priorityDeviceId: string | null = null;
  private userOverrideId: string | null = null;
  private isSettingDefaultInput = false;
  private helper: NativeHelper;
  private savedPriorityDeviceId: string | null = null;
  // Favorite device name - used to auto-reconnect when device reappears.
  // Names are more stable than IDs across reconnects.
  private favoriteDeviceName: string | null = null;
  // Callback to save favorite to preferences
  private onFavoriteChanged: ((name: string | null) => void) | null = null;
  // Timer for tracking priority mic minutes (time the mic is locked)
  private priorityMicTimer: ReturnType<typeof setInterval> | null = null;

  constructor(helper: NativeHelper) {
    super();
    this.helper = helper;
  }

  /**
   * Set the saved priority device ID (loaded from preferences).
   * This will be applied after devices are loaded.
   */
  setSavedPriorityDeviceId(deviceId: string | null): void {
    this.savedPriorityDeviceId = deviceId;
  }

  /**
   * Set the favorite device name (loaded from preferences).
   * When this device reconnects, it will automatically become the priority.
   */
  setFavoriteDeviceName(name: string | null): void {
    this.favoriteDeviceName = name;
  }

  /**
   * Get the current favorite device name.
   */
  getFavoriteDeviceName(): string | null {
    return this.favoriteDeviceName;
  }

  /**
   * Set callback for when favorite device changes (to save to preferences).
   */
  setOnFavoriteChanged(callback: (name: string | null) => void): void {
    this.onFavoriteChanged = callback;
  }

  /**
   * Initialize the AudioManager.
   * Sets up event listeners, fetches initial state, and starts monitoring.
   */
  async init(): Promise<void> {
    // Set up event listeners for the native helper.
    this.helper.on('devicesChanged', (devices: AudioDevice[]) => {
      this.handleDevicesChanged(devices);
    });

    this.helper.on('defaultInputChanged', (deviceId: string | null) => {
      this.handleDefaultInputChanged(deviceId);
    });

    this.helper.on('error', (error: Error) => {
      console.error('[AudioManager] Helper error:', error);
    });

    // Fetch initial device list and default input.
    try {
      await this.refreshDevices();
      await this.refreshDefaultInput();
      
      if (this.savedPriorityDeviceId) {
        const deviceExists = this.devices.some(d => d.id === this.savedPriorityDeviceId);
        if (deviceExists) {
          console.log('[AudioManager] Restoring saved priority device:', this.savedPriorityDeviceId);
          await this.setPriorityDevice(this.savedPriorityDeviceId);
        } else {
          console.log('[AudioManager] Saved priority device no longer exists, clearing');
          this.savedPriorityDeviceId = null;
        }
      }
    } catch (error) {
      console.error('[AudioManager] Failed to fetch initial state:', error);
    }

    // Start monitoring for CoreAudio changes.
    await this.helper.startMonitoring();

    // Emit initial state to subscribers.
    this.emitStateChanged();

    console.log('[AudioManager] Initialized with state:', this.getState());
  }

  /**
   * Get the current audio state snapshot.
   * This is the primary way for UI to read current state.
   */
  getState(): AudioState {
    return {
      devices: this.devices,
      defaultInputId: this.defaultInputId,
      priorityMode: this.priorityMode,
      priorityDeviceId: this.priorityDeviceId,
      userOverrideId: this.userOverrideId,
    };
  }

  /**
   * Set which device should be prioritized (user selection).
   */
  async setPriorityDevice(deviceId: string | null): Promise<void> {
    console.log('[AudioManager] setPriorityDevice:', deviceId);
    const wasLocked = this.priorityDeviceId !== null;
    this.priorityDeviceId = deviceId;

    if (deviceId) {
      // Save device name as favorite for auto-reconnect
      const device = this.devices.find(d => d.id === deviceId);
      if (device) {
        this.favoriteDeviceName = device.name;
        console.log('[AudioManager] Saved favorite device name:', device.name);
        if (this.onFavoriteChanged) {
          this.onFavoriteChanged(device.name);
        }
      }

      if (!this.priorityMode) {
        this.priorityMode = true;
        console.log('[AudioManager] Auto-enabled priority mode for device:', deviceId);
      }
      this.userOverrideId = null;
      await this.enforcePriority();

      // Start tracking priority mic minutes if not already tracking
      if (!wasLocked) {
        this.startPriorityMicTimer();
      }
    } else {
      // Stop tracking priority mic minutes
      this.stopPriorityMicTimer();

      // Clear favorite when explicitly selecting "None"
      this.favoriteDeviceName = null;
      if (this.onFavoriteChanged) {
        this.onFavoriteChanged(null);
      }

      if (this.priorityMode) {
        this.priorityMode = false;
        this.userOverrideId = null;
        console.log('[AudioManager] Auto-disabled priority mode (no device selected)');
      }
    }

    this.emitStateChanged();
  }

  /**
   * Start the priority mic minute timer.
   * Emits 'priorityMicMinute' event every 60 seconds while mic is locked.
   */
  private startPriorityMicTimer(): void {
    if (this.priorityMicTimer) return; // Already running

    console.log('[AudioManager] Starting priority mic minute timer');
    this.priorityMicTimer = setInterval(() => {
      if (this.priorityDeviceId) {
        this.emit('priorityMicMinute');
      }
    }, 60 * 1000); // Every 60 seconds
  }

  /**
   * Stop the priority mic minute timer.
   */
  private stopPriorityMicTimer(): void {
    if (this.priorityMicTimer) {
      console.log('[AudioManager] Stopping priority mic minute timer');
      clearInterval(this.priorityMicTimer);
      this.priorityMicTimer = null;
    }
  }

  /**
   * Enable or disable priority mode ("Lock to Priority Device").
   * When enabled, we'll actively maintain the priority device as the default input.
   */
  async setPriorityMode(enabled: boolean): Promise<void> {
    console.log('[AudioManager] setPriorityMode:', enabled);

    this.priorityMode = enabled;

    if (!enabled) {
      // When turning off priority mode, clear any user override.
      // This gives the user a clean slate when they re-enable.
      this.userOverrideId = null;
      this.emitStateChanged();
      return;
    }

    // When turning on, clear override and enforce priority immediately.
    this.userOverrideId = null;
    await this.enforcePriority();
    this.emitStateChanged();
  }

  /**
   * Clear the user override, allowing priority enforcement to resume.
   * Call this when the user explicitly wants to "reset" to the priority device.
   */
  async clearUserOverride(): Promise<void> {
    console.log('[AudioManager] clearUserOverride');
    this.userOverrideId = null;

    if (this.priorityMode && this.priorityDeviceId) {
      await this.enforcePriority();
    }

    this.emitStateChanged();
  }

  /**
   * Manually refresh the device list from CoreAudio.
   * Useful for debugging or if state gets out of sync.
   */
  async refreshDevices(): Promise<void> {
    try {
      const devices = await this.helper.getDevices();
      this.devices = devices;
      
      // If the priority device was removed, clear it.
      if (this.priorityDeviceId) {
        const stillExists = devices.some((d) => d.id === this.priorityDeviceId);
        if (!stillExists) {
          console.log('[AudioManager] Priority device removed, clearing selection');
          this.priorityDeviceId = null;
        }
      }
    } catch (error) {
      console.error('[AudioManager] Failed to refresh devices:', error);
    }
  }

  /**
   * Handle device list changes from CoreAudio.
   * Re-evaluates priority policy if needed.
   * Also handles wake-from-sleep recovery and favorite device auto-reconnect.
   */
  private async handleDevicesChanged(devices: AudioDevice[]): Promise<void> {
    console.log('[AudioManager] Devices changed, count:', devices.length);

    this.devices = devices;

    // If the priority device was removed, clear it (but keep favorite name for reconnect).
    if (this.priorityDeviceId) {
      const stillExists = devices.some((d) => d.id === this.priorityDeviceId);
      if (!stillExists) {
        console.log('[AudioManager] Priority device removed, will auto-reconnect if it reappears');
        this.priorityDeviceId = null;
        // Don't clear favoriteDeviceName - we want to reconnect when it comes back
      }
    }

    // Auto-reconnect: If we have a favorite device name but no current priority device,
    // check if the favorite device just connected and auto-select it.
    if (!this.priorityDeviceId && this.favoriteDeviceName) {
      const favoriteDevice = devices.find(d => d.name === this.favoriteDeviceName && d.isInput);
      if (favoriteDevice) {
        console.log('[AudioManager] Favorite device reconnected, auto-selecting:', this.favoriteDeviceName);
        this.priorityDeviceId = favoriteDevice.id;
        this.priorityMode = true;
        await this.enforcePriority();
      }
    }

    // If priority mode is on, check if we need to enforce it.
    // This handles the case where the priority device was just connected or reconnected after sleep.
    if (this.priorityMode && this.priorityDeviceId) {
      // Refresh default input to ensure we have current state after wake.
      await this.refreshDefaultInput();
      await this.enforcePriority();
    }

    this.emitStateChanged();
  }

  /**
   * Handle default input changes from CoreAudio.
   * When priority mode is locked, always restore the priority device.
   */
  private async handleDefaultInputChanged(deviceId: string | null): Promise<void> {
    console.log('[AudioManager] Default input changed to:', deviceId);

    this.defaultInputId = deviceId;

    // If priority mode is off, just update state and emit.
    if (!this.priorityMode) {
      this.emitStateChanged();
      return;
    }

    // If we just set this ourselves, ignore the callback.
    if (this.isSettingDefaultInput) {
      this.emitStateChanged();
      return;
    }

    // While locked, always restore the priority device if it changed away.
    if (this.priorityDeviceId && deviceId !== this.priorityDeviceId) {
      console.log('[AudioManager] Non-priority device became default while locked, restoring priority');
      // Clear any user override since we're enforcing
      this.userOverrideId = null;
      await this.enforcePriority();
      this.emitStateChanged();
      return;
    }

    // Priority device is the default - clear any override.
    if (deviceId === this.priorityDeviceId) {
      this.userOverrideId = null;
    }

    this.emitStateChanged();
  }

  /**
   * Enforce the priority policy - make the priority device the default input.
   * When priority mode is locked, this always enforces regardless of auto-switches.
   * 
   * Conditions:
   * - Priority mode is ON
   * - A priority device is selected
   * - Priority device is not already the default
   */
  private async enforcePriority(): Promise<void> {
    // Don't enforce if priority mode is off.
    if (!this.priorityMode) {
      return;
    }

    // If no priority device is selected, nothing to enforce.
    if (!this.priorityDeviceId) {
      console.log('[AudioManager] No priority device selected');
      return;
    }

    // Find the priority device.
    const priorityDevice = this.devices.find((d) => d.id === this.priorityDeviceId);
    if (!priorityDevice) {
      console.log('[AudioManager] Priority device not found');
      return;
    }

    // If priority device is already the default, nothing to do.
    if (this.defaultInputId === this.priorityDeviceId) {
      console.log('[AudioManager] Priority device already default');
      return;
    }

    // Set priority device as the default input.
    // When locked, we always enforce - ignore auto-switches from macOS.
    console.log('[AudioManager] Enforcing priority device as default input:', priorityDevice.name);

    // Mark that we're setting the default to avoid treating it as user override.
    this.isSettingDefaultInput = true;

    try {
      this.helper.setDefaultInput(this.priorityDeviceId);
      this.defaultInputId = this.priorityDeviceId;
    } finally {
      // Reset flag after a short delay to account for async CoreAudio callback.
      setTimeout(() => {
        this.isSettingDefaultInput = false;
      }, 500);
    }
  }

  /**
   * Fetch the current default input from CoreAudio.
   */
  private async refreshDefaultInput(): Promise<void> {
    try {
      this.defaultInputId = await this.helper.getDefaultInput();
    } catch (error) {
      console.error('[AudioManager] Failed to refresh default input:', error);
    }
  }

  /**
   * Emit a state change event to all listeners.
   */
  private emitStateChanged(): void {
    this.emit('stateChanged', this.getState());
  }
}
