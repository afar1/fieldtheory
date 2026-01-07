import { EventEmitter } from 'events';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import { app } from 'electron';
import {
  AudioDevice,
  HelperOutgoingMessage,
  HelperIncomingCommand,
} from './types/audio';

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
export class NativeHelper extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private isRunning = false;
  private isReady = false;
  private pendingDevicesResolve: ((devices: AudioDevice[]) => void) | null = null;
  private pendingDefaultInputResolve: ((deviceId: string | null) => void) | null = null;
  private devicesDebounceTimer: NodeJS.Timeout | null = null;
  private defaultInputDebounceTimer: NodeJS.Timeout | null = null;
  private pendingDevices: AudioDevice[] | null = null;
  private pendingDefaultInput: string | null = null;

  constructor() {
    super();
  }

  /**
   * Start the native helper process.
   * On macOS, this spawns the LittleOneHelper binary.
   * On other platforms, this is a no-op.
   */
  start(): void {
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
      this.child = spawn(helperPath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.isRunning = true;

      this.child.stdout.on('data', (data: Buffer) => {
        if (!this.isReady) {
          this.isReady = true;
        }
        this.onStdout(data);
      });

      this.child.stderr.on('data', (data: Buffer) => {
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
    } catch (error) {
      console.error('[NativeHelper] Exception spawning helper:', error);
      this.isRunning = false;
    }
  }

  /**
   * Stop the native helper process gracefully.
   */
  stop(): void {
    if (this.child) {
      this.child.kill('SIGTERM');
      this.child = null;
      this.isRunning = false;
    }
  }

  /**
   * Check if the helper is currently running.
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Wait for the helper to be ready (has sent initial message).
   */
  private async waitForReady(): Promise<void> {
    if (this.isReady) {
      // Even if ready, give a small delay to ensure stdin loop is fully initialized
      await new Promise(resolve => setTimeout(resolve, 50));
      return;
    }
    
    // Wait up to 2 seconds for the helper to send its initial log message
    const maxWait = 2000;
    const startTime = Date.now();
    
    while (!this.isReady && Date.now() - startTime < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    if (!this.isReady) {
      console.warn('[NativeHelper] Helper did not become ready within timeout');
    } else {
      // Give Swift a moment to fully initialize its stdin reading loop after first message
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Request the current list of audio devices from the helper.
   * Returns a promise that resolves with the device list.
   */
  async getDevices(): Promise<AudioDevice[]> {
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
  async getDefaultInput(): Promise<string | null> {
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
  setDefaultInput(deviceId: string): void {
    this.send({ type: 'setDefaultInput', deviceId });
  }

  /**
   * Tell the helper to start monitoring for CoreAudio changes.
   * After this, we'll receive 'devicesChanged' and 'defaultInputChanged' events.
   */
  async startMonitoring(): Promise<void> {
    await this.waitForReady();
    this.send({ type: 'startMonitoring' });
  }

  /**
   * Start recording audio from the default input device.
   * Returns a promise that resolves when recording starts.
   */
  async startRecording(): Promise<void> {
    await this.waitForReady();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('startRecording timed out'));
      }, 5000);

      const handler = (msg: HelperOutgoingMessage) => {
        if (msg.type === 'recordingStarted') {
          clearTimeout(timeout);
          this.removeListener('message', handler);
          resolve();
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          this.removeListener('message', handler);
          reject(new Error(msg.message));
        }
      };

      this.once('message', handler);
      this.send({ type: 'startRecording' });
    });
  }

  /**
   * Stop recording and get the path to the recorded WAV file.
   */
  async stopRecording(): Promise<string> {
    await this.waitForReady();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        console.error('[NativeHelper] stopRecording timeout - no response received');
        reject(new Error('stopRecording timed out'));
      }, 10000); // Increased timeout to 10 seconds

      const handler = (msg: HelperOutgoingMessage) => {
        console.log('[NativeHelper] Received message in stopRecording handler:', msg.type);
        if (msg.type === 'recordingStopped') {
          clearTimeout(timeout);
          this.removeListener('message', handler);
          console.log('[NativeHelper] Recording stopped, file path:', msg.filePath);
          resolve(msg.filePath);
        } else if (msg.type === 'error') {
          clearTimeout(timeout);
          this.removeListener('message', handler);
          reject(new Error(msg.message));
        }
      };

      this.once('message', handler);
      console.log('[NativeHelper] Sending stopRecording command');
      this.send({ type: 'stopRecording' });
    });
  }

  /**
   * Cancel the current recording without saving.
   */
  async cancelRecording(): Promise<void> {
    await this.waitForReady();
    this.send({ type: 'cancelRecording' });
  }

  /**
   * Check if Accessibility permission is granted.
   * Note: Input Monitoring check was removed as it caused the app to appear
   * in Input Monitoring settings even though that permission is not needed.
   */
  async checkPermissions(): Promise<{ accessibilityGranted: boolean }> {
    await this.waitForReady();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('checkPermissions timed out'));
      }, 5000);

      const onMessage = (msg: HelperOutgoingMessage) => {
        if (msg.type === 'permissionsStatus') {
          cleanup();
          resolve({
            accessibilityGranted: msg.accessibilityGranted,
          });
        } else if (msg.type === 'error') {
          cleanup();
          reject(new Error(msg.message));
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.removeListener('message', onMessage);
      };

      this.on('message', onMessage);
      this.send({ type: 'checkPermissions' });
    });
  }

  /**
   * Check if a text input field is currently focused.
   * Uses Accessibility API to detect if paste will work.
   */
  async checkFocusedTextInput(): Promise<boolean> {
    await this.waitForReady();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve(false);
      }, 1000);

      const onMessage = (msg: HelperOutgoingMessage) => {
        if (msg.type === 'focusedTextInputStatus') {
          cleanup();
          resolve(msg.hasTextInput);
        } else if (msg.type === 'error') {
          cleanup();
          resolve(false);
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.removeListener('message', onMessage);
      };

      this.on('message', onMessage);
      this.send({ type: 'checkFocusedTextInput' });
    });
  }

  /**
   * Determine the path to the helper binary based on the environment.
   */
  private getHelperPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'LittleOneHelper');
    } else {
      const appPath = app.getAppPath();
      return path.join(appPath, 'electron/native/build/LittleOneHelper');
    }
  }

  /**
   * Handle data received from the helper's stdout.
   * Parses JSON lines and dispatches to appropriate handlers.
   */
  private onStdout(data: Buffer): void {
    this.buffer += data.toString();

    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (!line) continue;

      try {
        const msg = JSON.parse(line) as HelperOutgoingMessage;
        if (msg.type !== 'log' || msg.level !== 'debug') {
          console.log('[NativeHelper] Parsed message:', msg.type, msg);
        }
        this.handleMessage(msg);
      } catch (err) {
        console.error('[NativeHelper] Failed to parse JSON from helper. Line:', line.substring(0, 200), 'Error:', err);
      }
    }
  }

  /**
   * Handle a parsed message from the helper.
   */
  private handleMessage(msg: HelperOutgoingMessage): void {
    switch (msg.type) {
      case 'devicesChanged':
        this.handleDevicesChanged(msg.devices as AudioDevice[]);
        break;

      case 'defaultInputChanged':
        this.handleDefaultInputChanged(msg.deviceId);
        break;

      case 'log':
        const level = msg.level || 'info';
        if (level === 'debug' && !process.env.DEBUG_NATIVE_HELPER) {
          break;
        }
        console.log(`[NativeHelper ${level}]`, msg.message);
        break;

      case 'error':
        console.error('[NativeHelper error]', msg.message);
        if (this.listenerCount('error') > 0) {
          this.emit('error', new Error(msg.message));
        }
        this.emit('message', msg);
        break;

      case 'recordingStarted':
      case 'recordingStopped':
      case 'recordingCancelled':
        console.log(`[NativeHelper] Emitting message event: ${msg.type}`, msg);
        this.emit('message', msg);
        break;

      case 'audioLevel':
        this.emit('audioLevel', msg.level);
        break;

      case 'permissionsStatus':
      case 'focusedTextInputStatus':
        this.emit('message', msg);
        break;

      case 'menuBarClicked':
        // User clicked on the menu bar - emit event so Field Theory can hide.
        this.emit('menuBarClicked');
        break;

      case 'appBecameFrontmost':
        // Field Theory became the frontmost app (e.g., via Cmd+Tab).
        // Emit event so we can show the clipboard window.
        this.emit('appBecameFrontmost');
        break;

      default:
        console.warn('[NativeHelper] Unknown message type:', msg.type);
    }
  }

  /**
   * Handle devices changed - resolve pending promise or emit event.
   * Uses debouncing to prevent rapid-fire events.
   */
  private handleDevicesChanged(devices: AudioDevice[]): void {
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
  private handleDefaultInputChanged(deviceId: string | null): void {
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
  private send(command: HelperIncomingCommand): void {
    if (!this.child || !this.child.stdin.writable) {
      console.warn('[NativeHelper] Cannot send command - helper not running');
      return;
    }

    try {
      const json = JSON.stringify(command);
      if (process.env.DEBUG_NATIVE_HELPER) {
        console.log('[NativeHelper] Sending command:', json);
      }
      const success = this.child.stdin.write(json + '\n');
      
      if (!success) {
        this.child.stdin.once('drain', () => {});
      }
    } catch (error: unknown) {
      const isEPIPE = error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EPIPE';
      if (isEPIPE) {
        console.warn('[NativeHelper] Broken pipe - helper process may have exited');
        this.isRunning = false;
        this.child = null;
      } else {
        console.error('[NativeHelper] Error sending command:', error, 'Command was:', command);
      }
    }
  }
}
