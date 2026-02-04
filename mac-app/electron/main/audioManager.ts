import { EventEmitter } from 'events';
import { AudioDevice, AudioState, TransportType } from './types/audio';
import { NativeHelper } from './nativeHelper';
import { createLogger } from './logger';

const log = createLogger('Audio');

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
  // Callback to save priority device to preferences
  private onPriorityChanged: ((deviceId: string | null) => void) | null = null;
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
    log.info('setFavoriteDeviceName called with:', name);
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
   * Set callback for when priority device changes (to save to preferences).
   */
  setOnPriorityChanged(callback: (deviceId: string | null) => void): void {
    this.onPriorityChanged = callback;
  }

  /**
   * Clear the favorite device name.
   * This stops auto-reconnect behavior when the device reconnects.
   */
  clearFavoriteDevice(): void {
    this.favoriteDeviceName = null;
    if (this.onFavoriteChanged) {
      this.onFavoriteChanged(null);
    }
  }

  /**
   * Set the favorite device by ID.
   * The favorite device is auto-selected on app startup and when it reconnects.
   */
  setFavoriteDeviceById(deviceId: string): boolean {
    const device = this.devices.find(d => d.id === deviceId && d.isInput);
    if (!device) {
      log.warn('setFavoriteDeviceById: device not found:', deviceId);
      return false;
    }
    log.info('setFavoriteDeviceById: setting favorite to:', device.name);
    this.favoriteDeviceName = device.name;
    if (this.onFavoriteChanged) {
      this.onFavoriteChanged(device.name);
    }
    return true;
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
      log.error('Helper error:', error);
    });

    // Fetch initial device list and default input.
    try {
      await this.refreshDevices();
      await this.refreshDefaultInput();

      log.info('Audio init - favoriteDeviceName from prefs:', this.favoriteDeviceName);
      log.info('Audio init - available inputs:', this.devices.filter(d => d.isInput).map(d => d.name));

      // Try to restore priority device - first by ID, then by favorite name
      let deviceRestored = false;

      if (this.savedPriorityDeviceId) {
        const deviceExists = this.devices.some(d => d.id === this.savedPriorityDeviceId);
        if (deviceExists) {
          await this.setPriorityDevice(this.savedPriorityDeviceId);
          deviceRestored = true;
        } else {
          this.savedPriorityDeviceId = null;
        }
      }

      // If ID didn't match but we have a favorite name, try to find by name
      // (device IDs can change between restarts, but names are more stable)
      if (!deviceRestored && this.favoriteDeviceName) {
        const favoriteDevice = this.devices.find(d => d.name === this.favoriteDeviceName && d.isInput);
        if (favoriteDevice) {
          log.info('Restoring priority from favorite:', this.favoriteDeviceName);
          await this.setPriorityDevice(favoriteDevice.id);
        } else {
          log.info('Favorite device not currently connected:', this.favoriteDeviceName);
        }
      }
    } catch (error) {
      log.error('Failed to fetch initial state:', error);
    }

    // Start monitoring for CoreAudio changes.
    await this.helper.startMonitoring();

    // Emit initial state to subscribers.
    this.emitStateChanged();
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
   * Note: This does NOT change the favorite device - use setFavoriteDevice for that.
   */
  async setPriorityDevice(deviceId: string | null): Promise<void> {
    const wasLocked = this.priorityDeviceId !== null;
    const changed = this.priorityDeviceId !== deviceId;
    this.priorityDeviceId = deviceId;

    // Save to preferences via callback (ensures all paths save correctly)
    if (changed && this.onPriorityChanged) {
      this.onPriorityChanged(deviceId);
    }

    if (deviceId) {

      if (!this.priorityMode) {
        this.priorityMode = true;
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

      // Note: Selecting "None" for priority does NOT clear the favorite.
      // The favorite is independent and only cleared explicitly.

      if (this.priorityMode) {
        this.priorityMode = false;
        this.userOverrideId = null;
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
      clearInterval(this.priorityMicTimer);
      this.priorityMicTimer = null;
    }
  }

  /**
   * Enable or disable priority mode ("Lock to Priority Device").
   * When enabled, we'll actively maintain the priority device as the default input.
   */
  async setPriorityMode(enabled: boolean): Promise<void> {
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
          this.priorityDeviceId = null;
        }
      }
    } catch (error) {
      log.error('Failed to refresh devices:', error);
    }
  }

  /**
   * Handle device list changes from CoreAudio.
   * Re-evaluates priority policy if needed.
   * Also handles wake-from-sleep recovery and favorite device auto-reconnect.
   */
  private async handleDevicesChanged(devices: AudioDevice[]): Promise<void> {
    this.devices = devices;

    // If the priority device was removed, clear it (but keep favorite name for reconnect).
    if (this.priorityDeviceId) {
      const stillExists = devices.some((d) => d.id === this.priorityDeviceId);
      if (!stillExists) {
        // Use setPriorityDevice to ensure preference is saved
        // Note: This preserves favoriteDeviceName for auto-reconnect
        await this.setPriorityDevice(null);
      }
    }

    // Auto-reconnect: If we have a favorite device name but no current priority device,
    // check if the favorite device just connected and auto-select it.
    if (!this.priorityDeviceId && this.favoriteDeviceName) {
      const favoriteDevice = devices.find(d => d.name === this.favoriteDeviceName && d.isInput);
      if (favoriteDevice) {
        log.info('Auto-reconnecting favorite device:', this.favoriteDeviceName);
        // Use setPriorityDevice to ensure preference is saved with new device ID
        await this.setPriorityDevice(favoriteDevice.id);
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
      return;
    }

    // Find the priority device.
    const priorityDevice = this.devices.find((d) => d.id === this.priorityDeviceId);
    if (!priorityDevice) {
      return;
    }

    // If priority device is already the default, nothing to do.
    if (this.defaultInputId === this.priorityDeviceId) {
      return;
    }

    // Set priority device as the default input.
    // When locked, we always enforce - ignore auto-switches from macOS.

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
      log.error('Failed to refresh default input:', error);
    }
  }

  /**
   * Emit a state change event to all listeners.
   */
  private emitStateChanged(): void {
    this.emit('stateChanged', this.getState());
  }
}
