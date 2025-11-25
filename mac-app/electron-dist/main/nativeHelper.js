"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NativeHelper = void 0;
const events_1 = require("events");
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const electron_1 = require("electron");
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
    isReady = false;
    pendingDevicesResolve = null;
    pendingDefaultInputResolve = null;
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
        if (process.platform !== 'darwin') {
            console.log('[NativeHelper] Not on macOS, skipping helper start');
            return;
        }
        if (this.child) {
            console.warn('[NativeHelper] Helper already running');
            return;
        }
        const helperPath = this.getHelperPath();
        console.log('[NativeHelper] Starting helper at:', helperPath);
        try {
            this.child = (0, child_process_1.spawn)(helperPath, [], {
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            this.isRunning = true;
            this.child.stdout.on('data', (data) => {
                if (!this.isReady) {
                    this.isReady = true;
                }
                this.onStdout(data);
            });
            this.child.stderr.on('data', (data) => {
                console.error('[NativeHelper stderr]', data.toString().trim());
            });
            this.child.on('exit', (code, signal) => {
                console.warn('[NativeHelper] Process exited', { code, signal });
                this.isRunning = false;
                this.isReady = false;
                this.child = null;
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
     * Wait for the helper to be ready (has sent initial message).
     */
    async waitForReady() {
        if (this.isReady)
            return;
        // Wait up to 2 seconds for the helper to send its initial log message
        const maxWait = 2000;
        const startTime = Date.now();
        while (!this.isReady && Date.now() - startTime < maxWait) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (!this.isReady) {
            console.warn('[NativeHelper] Helper did not become ready within timeout');
        }
    }
    /**
     * Request the current list of audio devices from the helper.
     * Returns a promise that resolves with the device list.
     */
    async getDevices() {
        return new Promise(async (resolve, reject) => {
            if (!this.child || !this.child.stdin.writable) {
                resolve([]);
                return;
            }
            await this.waitForReady();
            this.pendingDevicesResolve = resolve;
            this.send({ type: 'getDevices' });
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
        return new Promise(async (resolve, reject) => {
            if (!this.child || !this.child.stdin.writable) {
                resolve(null);
                return;
            }
            await this.waitForReady();
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
     */
    setDefaultInput(deviceId) {
        this.send({ type: 'setDefaultInput', deviceId });
    }
    /**
     * Tell the helper to start monitoring for CoreAudio changes.
     * After this, we'll receive 'devicesChanged' and 'defaultInputChanged' events.
     */
    async startMonitoring() {
        await this.waitForReady();
        this.send({ type: 'startMonitoring' });
    }
    /**
     * Determine the path to the helper binary based on the environment.
     */
    getHelperPath() {
        if (electron_1.app.isPackaged) {
            return path_1.default.join(process.resourcesPath, 'LittleOneHelper');
        }
        else {
            const appPath = electron_1.app.getAppPath();
            return path_1.default.join(appPath, 'electron/native/build/LittleOneHelper');
        }
    }
    /**
     * Handle data received from the helper's stdout.
     * Parses JSON lines and dispatches to appropriate handlers.
     */
    onStdout(data) {
        this.buffer += data.toString();
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
        if (this.pendingDevicesResolve) {
            this.pendingDevicesResolve(devices);
            this.pendingDevicesResolve = null;
            return;
        }
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
        if (this.pendingDefaultInputResolve) {
            this.pendingDefaultInputResolve(deviceId);
            this.pendingDefaultInputResolve = null;
            return;
        }
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
        try {
            const json = JSON.stringify(command);
            const success = this.child.stdin.write(json + '\n');
            if (!success) {
                this.child.stdin.once('drain', () => { });
            }
        }
        catch (error) {
            if (error.code === 'EPIPE') {
                console.warn('[NativeHelper] Broken pipe - helper process may have exited');
                this.isRunning = false;
                this.child = null;
            }
            else {
                console.error('[NativeHelper] Error sending command:', error);
            }
        }
    }
}
exports.NativeHelper = NativeHelper;
//# sourceMappingURL=nativeHelper.js.map