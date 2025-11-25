"use strict";
// =============================================================================
// AudioManager - Core audio device management and priority policy logic.
// This is the single source of truth for audio state in the Electron app.
// =============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.AudioManager = void 0;
const events_1 = require("events");
// Device name patterns used to identify Little One devices.
// These should match the actual device names as reported by CoreAudio.
const LITTLE_ONE_NAME_PATTERNS = [
    'Little One',
    'LittleOne',
    'Little One Mic',
    'Little One Microphone',
];
/**
 * AudioManager handles all audio device state and implements the priority policy.
 *
 * Priority Policy Rules:
 * 1. When priorityMode is ON and Little One is connected:
 *    - If no user override, ensure Little One is the default input.
 *    - Prefer USB dongle over Bluetooth for stability.
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
        this.helper.startMonitoring();
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
        const littleOne = this.pickPreferredLittleOne();
        const littleOnePresent = littleOne !== null;
        return {
            devices: this.devices,
            defaultInputId: this.defaultInputId,
            priorityMode: this.priorityMode,
            userOverrideId: this.userOverrideId,
            littleOnePresent,
            preferredLittleOneId: littleOne ? littleOne.id : null,
        };
    }
    /**
     * Enable or disable priority mode ("Lock input to Little One").
     * When enabled, we'll actively maintain Little One as the default input.
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
     * Call this when the user explicitly wants to "reset" to Little One.
     */
    async clearUserOverride() {
        console.log('[AudioManager] clearUserOverride');
        this.userOverrideId = null;
        if (this.priorityMode) {
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
            this.devices = this.markLittleOneDevices(devices);
        }
        catch (error) {
            console.error('[AudioManager] Failed to refresh devices:', error);
        }
    }
    // ---------------------------------------------------------------------------
    // Private methods - Device identification
    // ---------------------------------------------------------------------------
    /**
     * Mark devices that are Little One devices based on name matching.
     * Returns a new array with isLittleOne flags set.
     */
    markLittleOneDevices(devices) {
        return devices.map((device) => ({
            ...device,
            isLittleOne: this.isLittleOneDevice(device),
        }));
    }
    /**
     * Check if a device is a Little One device.
     * Currently uses name matching; could be extended to use VID/PID.
     */
    isLittleOneDevice(device) {
        // Only consider input devices.
        if (!device.isInput)
            return false;
        // Check if the device name matches any of our patterns.
        const nameLower = device.name.toLowerCase();
        return LITTLE_ONE_NAME_PATTERNS.some((pattern) => nameLower.includes(pattern.toLowerCase()));
    }
    /**
     * Get all connected Little One devices.
     */
    getLittleOneDevices() {
        return this.devices.filter((d) => d.isLittleOne);
    }
    /**
     * Pick the preferred Little One device if multiple are connected.
     * Prefers USB dongle over Bluetooth for lower latency and stability.
     */
    pickPreferredLittleOne() {
        const littleOnes = this.getLittleOneDevices();
        if (littleOnes.length === 0) {
            return null;
        }
        // Prefer USB (dongle) over Bluetooth for stability and latency.
        const usbDevices = littleOnes.filter((d) => d.transportType === 'usb');
        if (usbDevices.length > 0) {
            return usbDevices[0];
        }
        // Fall back to any available Little One device.
        return littleOnes[0];
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
        this.devices = this.markLittleOneDevices(devices);
        // If priority mode is on, check if we need to enforce it.
        // This handles the case where Little One was just connected.
        if (this.priorityMode) {
            await this.enforcePriority();
        }
        this.emitStateChanged();
    }
    /**
     * Handle default input changes from CoreAudio.
     * Detects user overrides and updates state accordingly.
     */
    async handleDefaultInputChanged(deviceId) {
        console.log('[AudioManager] Default input changed to:', deviceId);
        const prevDefaultId = this.defaultInputId;
        this.defaultInputId = deviceId;
        // If priority mode is off, just update state and emit.
        if (!this.priorityMode) {
            this.emitStateChanged();
            return;
        }
        // If we just set this ourselves, don't treat it as a user override.
        if (this.isSettingDefaultInput) {
            this.emitStateChanged();
            return;
        }
        // Check if the new default is a Little One device.
        const littleOnes = this.getLittleOneDevices();
        const isLittleOne = littleOnes.some((d) => d.id === deviceId);
        if (isLittleOne) {
            // User (or us) switched to Little One - clear any override.
            this.userOverrideId = null;
            this.emitStateChanged();
            return;
        }
        // Non-Little-One became default while priority mode is ON.
        // If this wasn't us setting it, treat it as a user override.
        if (prevDefaultId !== deviceId && deviceId !== null) {
            console.log('[AudioManager] Detected user override to:', deviceId);
            this.userOverrideId = deviceId;
        }
        this.emitStateChanged();
    }
    // ---------------------------------------------------------------------------
    // Private methods - Priority enforcement
    // ---------------------------------------------------------------------------
    /**
     * Enforce the priority policy - make Little One the default input if conditions are met.
     *
     * Conditions:
     * - Priority mode is ON
     * - Little One is connected
     * - No user override is active
     * - Little One is not already the default
     */
    async enforcePriority() {
        // Don't enforce if priority mode is off.
        if (!this.priorityMode) {
            return;
        }
        // Get the preferred Little One device.
        const littleOne = this.pickPreferredLittleOne();
        // If no Little One is connected, nothing to enforce.
        if (!littleOne) {
            console.log('[AudioManager] No Little One device connected');
            return;
        }
        // If user has explicitly overridden, respect that.
        if (this.userOverrideId) {
            console.log('[AudioManager] User override active, not enforcing');
            return;
        }
        // If Little One is already the default, nothing to do.
        if (this.defaultInputId === littleOne.id) {
            console.log('[AudioManager] Little One already default');
            return;
        }
        // Set Little One as the default input.
        console.log('[AudioManager] Enforcing Little One as default input:', littleOne.name);
        // Mark that we're setting the default to avoid treating it as user override.
        this.isSettingDefaultInput = true;
        try {
            this.helper.setDefaultInput(littleOne.id);
            this.defaultInputId = littleOne.id;
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