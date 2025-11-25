"use strict";
// =============================================================================
// AudioManager - Core audio device management and priority policy logic.
// This is the single source of truth for audio state in the Electron app.
// =============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.AudioManager = void 0;
const events_1 = require("events");
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
class AudioManager extends events_1.EventEmitter {
    // Current list of audio devices (both input and output).
    devices = [];
    // Current system default input device ID.
    defaultInputId = null;
    // Whether priority lock is enabled.
    priorityMode = false;
    // The device ID selected by the user to prioritize, or null if none selected.
    priorityDeviceId = null;
    // User override device ID (if user manually changed input while priority was ON).
    userOverrideId = null;
    // Flag to track when we're in the middle of setting default input.
    // Used to distinguish our own changes from user-initiated changes.
    isSettingDefaultInput = false;
    // Reference to the native helper for CoreAudio operations.
    helper;
    constructor(helper) {
        super();
        this.helper = helper;
    }
    /**
     * Initialize the AudioManager.
     * Sets up event listeners, fetches initial state, and starts monitoring.
     */
    async init() {
        // Set up event listeners for the native helper.
        this.helper.on('devicesChanged', (devices) => {
            this.handleDevicesChanged(devices);
        });
        this.helper.on('defaultInputChanged', (deviceId) => {
            this.handleDefaultInputChanged(deviceId);
        });
        this.helper.on('error', (error) => {
            console.error('[AudioManager] Helper error:', error);
        });
        // Fetch initial device list and default input.
        try {
            await this.refreshDevices();
            await this.refreshDefaultInput();
        }
        catch (error) {
            console.error('[AudioManager] Failed to fetch initial state:', error);
        }
        // Start monitoring for CoreAudio changes.
        await this.helper.startMonitoring();
        // Emit initial state to subscribers.
        this.emitStateChanged();
        console.log('[AudioManager] Initialized with state:', this.getState());
    }
    // ---------------------------------------------------------------------------
    // Public API
    // ---------------------------------------------------------------------------
    /**
     * Get the current audio state snapshot.
     * This is the primary way for UI to read current state.
     */
    getState() {
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
    async setPriorityDevice(deviceId) {
        console.log('[AudioManager] setPriorityDevice:', deviceId);
        this.priorityDeviceId = deviceId;
        // If priority mode is enabled and we have a device, enforce it immediately.
        if (this.priorityMode && deviceId) {
            this.userOverrideId = null;
            await this.enforcePriority();
        }
        this.emitStateChanged();
    }
    /**
     * Enable or disable priority mode ("Lock to Priority Device").
     * When enabled, we'll actively maintain the priority device as the default input.
     */
    async setPriorityMode(enabled) {
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
    async clearUserOverride() {
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
    async refreshDevices() {
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
        }
        catch (error) {
            console.error('[AudioManager] Failed to refresh devices:', error);
        }
    }
    // ---------------------------------------------------------------------------
    // Private methods - Event handlers
    // ---------------------------------------------------------------------------
    /**
     * Handle device list changes from CoreAudio.
     * Re-evaluates priority policy if needed.
     */
    async handleDevicesChanged(devices) {
        console.log('[AudioManager] Devices changed, count:', devices.length);
        this.devices = devices;
        // If the priority device was removed, clear it.
        if (this.priorityDeviceId) {
            const stillExists = devices.some((d) => d.id === this.priorityDeviceId);
            if (!stillExists) {
                console.log('[AudioManager] Priority device removed, clearing selection');
                this.priorityDeviceId = null;
            }
        }
        // If priority mode is on, check if we need to enforce it.
        // This handles the case where the priority device was just connected.
        if (this.priorityMode && this.priorityDeviceId) {
            await this.enforcePriority();
        }
        this.emitStateChanged();
    }
    /**
     * Handle default input changes from CoreAudio.
     * When priority mode is locked, always restore the priority device.
     */
    async handleDefaultInputChanged(deviceId) {
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
    // ---------------------------------------------------------------------------
    // Private methods - Priority enforcement
    // ---------------------------------------------------------------------------
    /**
     * Enforce the priority policy - make the priority device the default input.
     * When priority mode is locked, this always enforces regardless of auto-switches.
     *
     * Conditions:
     * - Priority mode is ON
     * - A priority device is selected
     * - Priority device is not already the default
     */
    async enforcePriority() {
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
        }
        finally {
            // Reset flag after a short delay to account for async CoreAudio callback.
            setTimeout(() => {
                this.isSettingDefaultInput = false;
            }, 500);
        }
    }
    /**
     * Fetch the current default input from CoreAudio.
     */
    async refreshDefaultInput() {
        try {
            this.defaultInputId = await this.helper.getDefaultInput();
        }
        catch (error) {
            console.error('[AudioManager] Failed to refresh default input:', error);
        }
    }
    /**
     * Emit a state change event to all listeners.
     */
    emitStateChanged() {
        this.emit('stateChanged', this.getState());
    }
}
exports.AudioManager = AudioManager;
//# sourceMappingURL=audioManager.js.map