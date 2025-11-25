"use strict";
// =============================================================================
// NativeHelper - Wrapper for the Swift CoreAudio helper process.
// Manages spawning the helper, sending commands, and receiving events via JSON.
// =============================================================================
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NativeHelper = void 0;
const events_1 = require("events");
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
// Debounce delay in milliseconds to prevent rapid-fire events from CoreAudio.
const DEBOUNCE_DELAY_MS = 200;
/**
 * NativeHelper manages the Swift CLI helper process that interfaces with CoreAudio.
 *
 * It emits the following events:
 * - 'devicesChanged': When the list of audio devices changes.
 * - 'defaultInputChanged': When the system default input device changes.
 * - 'error': When the helper reports an error.
 *
 * All communication happens via JSON-over-stdin/stdout.
 */
class NativeHelper extends events_1.EventEmitter {
    child = null;
    buffer = '';
    isRunning = false;
    // Pending promise resolvers for request/response pattern.
    pendingDevicesResolve = null;
    pendingDefaultInputResolve = null;
    // Debounce timers to prevent event flapping.
    devicesDebounceTimer = null;
    defaultInputDebounceTimer = null;
    pendingDevices = null;
    pendingDefaultInput = null;
    constructor() {
        super();
    }
    /**
     * Start the native helper process.
     * On macOS, this spawns the LittleOneHelper binary.
     * On other platforms, this is a no-op.
     */
    start() {
        // Only run on macOS - other platforms just no-op.
        if (process.platform !== 'darwin') {
            console.log('[NativeHelper] Not on macOS, skipping helper start');
            return;
        }
        if (this.child) {
            console.warn('[NativeHelper] Helper already running');
            return;
        }
        // Determine the path to the helper binary.
        // In development: look in electron/native/build/
        // In production: look in app.asar.unpacked or resources/
        const helperPath = this.getHelperPath();
        console.log('[NativeHelper] Starting helper at:', helperPath);
        try {
            this.child = (0, child_process_1.spawn)(helperPath, [], {
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            this.isRunning = true;
            // Handle stdout - JSON messages from the helper.
            this.child.stdout.on('data', (data) => {
                this.onStdout(data);
            });
            // Handle stderr - log messages and errors.
            this.child.stderr.on('data', (data) => {
                console.error('[NativeHelper stderr]', data.toString().trim());
            });
            // Handle process exit.
            this.child.on('exit', (code, signal) => {
                console.warn('[NativeHelper] Process exited', { code, signal });
                this.isRunning = false;
                this.child = null;
                // Attempt to restart after a delay if it crashed unexpectedly.
                if (code !== 0 && code !== null) {
                    console.log('[NativeHelper] Will attempt restart in 5 seconds...');
                    setTimeout(() => this.start(), 5000);
                }
            });
            this.child.on('error', (error) => {
                console.error('[NativeHelper] Failed to spawn helper:', error);
                this.isRunning = false;
                this.child = null;
            });
        }
        catch (error) {
            console.error('[NativeHelper] Exception spawning helper:', error);
            this.isRunning = false;
        }
    }
    /**
     * Stop the native helper process gracefully.
     */
    stop() {
        if (this.child) {
            this.child.kill('SIGTERM');
            this.child = null;
            this.isRunning = false;
        }
    }
    /**
     * Check if the helper is currently running.
     */
    get running() {
        return this.isRunning;
    }
    /**
     * Request the current list of audio devices from the helper.
     * Returns a promise that resolves with the device list.
     */
    async getDevices() {
        return new Promise((resolve, reject) => {
            if (!this.child || !this.child.stdin.writable) {
                // Return empty list if helper isn't running (non-macOS or not started).
                resolve([]);
                return;
            }
            // Set up resolver for when we receive the response.
            this.pendingDevicesResolve = resolve;
            // Send the command with a timeout.
            this.send({ type: 'getDevices' });
            // Timeout after 5 seconds.
            setTimeout(() => {
                if (this.pendingDevicesResolve) {
                    this.pendingDevicesResolve = null;
                    reject(new Error('getDevices timed out'));
                }
            }, 5000);
        });
    }
    /**
     * Request the current default input device from the helper.
     * Returns a promise that resolves with the device ID or null.
     */
    async getDefaultInput() {
        return new Promise((resolve, reject) => {
            if (!this.child || !this.child.stdin.writable) {
                resolve(null);
                return;
            }
            this.pendingDefaultInputResolve = resolve;
            this.send({ type: 'getDefaultInput' });
            setTimeout(() => {
                if (this.pendingDefaultInputResolve) {
                    this.pendingDefaultInputResolve = null;
                    reject(new Error('getDefaultInput timed out'));
                }
            }, 5000);
        });
    }
    /**
     * Set the system default input device.
     * This is a fire-and-forget command - we don't wait for confirmation.
     */
    setDefaultInput(deviceId) {
        this.send({ type: 'setDefaultInput', deviceId });
    }
    /**
     * Tell the helper to start monitoring for CoreAudio changes.
     * After this, we'll receive 'devicesChanged' and 'defaultInputChanged' events.
     */
    startMonitoring() {
        this.send({ type: 'startMonitoring' });
    }
    // ---------------------------------------------------------------------------
    // Private methods
    // ---------------------------------------------------------------------------
    /**
     * Determine the path to the helper binary based on the environment.
     */
    getHelperPath() {
        if (electron_1.app.isPackaged) {
            // Production: helper is in the app bundle's Resources folder.
            return path_1.default.join(process.resourcesPath, 'LittleOneHelper');
        }
        else {
            // Development: helper is built locally.
            return path_1.default.join(__dirname, '../../native/build/LittleOneHelper');
        }
    }
    /**
     * Handle data received from the helper's stdout.
     * Parses JSON lines and dispatches to appropriate handlers.
     */
    onStdout(data) {
        this.buffer += data.toString();
        // Process complete lines (JSON messages are newline-delimited).
        let newlineIndex;
        while ((newlineIndex = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, newlineIndex).trim();
            this.buffer = this.buffer.slice(newlineIndex + 1);
            if (!line)
                continue;
            try {
                const msg = JSON.parse(line);
                this.handleMessage(msg);
            }
            catch (err) {
                console.error('[NativeHelper] Failed to parse JSON:', line, err);
            }
        }
    }
    /**
     * Handle a parsed message from the helper.
     */
    handleMessage(msg) {
        switch (msg.type) {
            case 'devicesChanged':
                this.handleDevicesChanged(msg.devices);
                break;
            case 'defaultInputChanged':
                this.handleDefaultInputChanged(msg.deviceId);
                break;
            case 'log':
                const level = msg.level || 'info';
                console.log(`[NativeHelper ${level}]`, msg.message);
                break;
            case 'error':
                console.error('[NativeHelper error]', msg.message);
                this.emit('error', new Error(msg.message));
                break;
            default:
                console.warn('[NativeHelper] Unknown message type:', msg.type);
        }
    }
    /**
     * Handle devices changed - resolve pending promise or emit event.
     * Uses debouncing to prevent rapid-fire events.
     */
    handleDevicesChanged(devices) {
        // If there's a pending request, resolve it immediately.
        if (this.pendingDevicesResolve) {
            this.pendingDevicesResolve(devices);
            this.pendingDevicesResolve = null;
            return;
        }
        // Otherwise, debounce the event to prevent flapping.
        this.pendingDevices = devices;
        if (this.devicesDebounceTimer) {
            clearTimeout(this.devicesDebounceTimer);
        }
        this.devicesDebounceTimer = setTimeout(() => {
            if (this.pendingDevices) {
                this.emit('devicesChanged', this.pendingDevices);
                this.pendingDevices = null;
            }
            this.devicesDebounceTimer = null;
        }, DEBOUNCE_DELAY_MS);
    }
    /**
     * Handle default input changed - resolve pending promise or emit event.
     * Uses debouncing to prevent rapid-fire events.
     */
    handleDefaultInputChanged(deviceId) {
        // If there's a pending request, resolve it immediately.
        if (this.pendingDefaultInputResolve) {
            this.pendingDefaultInputResolve(deviceId);
            this.pendingDefaultInputResolve = null;
            return;
        }
        // Otherwise, debounce the event.
        this.pendingDefaultInput = deviceId;
        if (this.defaultInputDebounceTimer) {
            clearTimeout(this.defaultInputDebounceTimer);
        }
        this.defaultInputDebounceTimer = setTimeout(() => {
            this.emit('defaultInputChanged', this.pendingDefaultInput);
            this.pendingDefaultInput = null;
            this.defaultInputDebounceTimer = null;
        }, DEBOUNCE_DELAY_MS);
    }
    /**
     * Send a command to the helper process.
     */
    send(command) {
        if (!this.child || !this.child.stdin.writable) {
            console.warn('[NativeHelper] Cannot send command - helper not running');
            return;
        }
        const json = JSON.stringify(command);
        this.child.stdin.write(json + '\n');
    }
}
exports.NativeHelper = NativeHelper;
//# sourceMappingURL=nativeHelper.js.map