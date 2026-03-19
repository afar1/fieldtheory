import { EventEmitter } from 'events';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import { app } from 'electron';
import {
  AudioDevice,
  HelperOutgoingMessage,
  HelperIncomingCommand,
  NativeWindowInfo,
  GazeTrackingStatusMessage,
  GazeSampleMessage,
} from './types/audio';
import { createLogger } from './logger';
import { DEFAULT_GAZE_TARGET_FPS } from './types/gaze';

const log = createLogger('Native');

const DEBOUNCE_DELAY_MS = 200;
const GAZE_STATUS_TIMEOUT_MS = 30000;
const RECORDING_TRANSITION_GRACE_MS = 175;
const START_RECORDING_RETRY_DELAYS_MS = [120, 260];

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
/**
 * Cached frontmost app info for instant access at hotkey time.
 */
export interface FrontmostAppInfo {
  bundleId: string | null;
  name: string | null;
  windowBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}

export class NativeHelper extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = '';
  private isRunning = false;
  private isReady = false;
  private recordingActive = false;
  private recordingCommandChain: Promise<void> = Promise.resolve();
  private lastRecordingReleaseAt = 0;
  private pendingDevicesResolve: ((devices: AudioDevice[]) => void) | null = null;
  private pendingDefaultInputResolve: ((deviceId: string | null) => void) | null = null;
  private devicesDebounceTimer: NodeJS.Timeout | null = null;
  private defaultInputDebounceTimer: NodeJS.Timeout | null = null;
  private pendingDevices: AudioDevice[] | null = null;
  private pendingDefaultInput: string | null = null;

  // Cached frontmost app info - updated on app switch, read instantly at hotkey time.
  private cachedFrontmostApp: FrontmostAppInfo | null = null;

  constructor() {
    super();
  }

  /**
   * Get the cached frontmost app info.
   * Updated automatically when the user switches apps.
   * Returns null if no app switch has occurred since helper started.
   */
  getFrontmostApp(): FrontmostAppInfo | null {
    return this.cachedFrontmostApp;
  }

  /**
   * Get the current frontmost window bounds on-demand.
   * This is a fast call (~1-5ms) that fetches fresh bounds,
   * useful when switching between windows of the same app.
   */
  async getFrontmostWindowBounds(): Promise<{ x: number; y: number; width: number; height: number } | null> {
    return new Promise(async (resolve) => {
      if (!this.child || !this.child.stdin.writable) {
        resolve(null);
        return;
      }

      await this.waitForReady();

      const timeout = setTimeout(() => {
        cleanup();
        resolve(null);
      }, 1000);

      const onMessage = (msg: HelperOutgoingMessage) => {
        if (msg.type === 'frontmostWindowBounds') {
          cleanup();
          resolve(msg.windowBounds || null);
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.removeListener('message', onMessage);
      };

      this.on('message', onMessage);
      this.send({ type: 'getFrontmostWindowBounds' });
    });
  }

  /**
   * Start the native helper process.
   * On macOS, this spawns the FieldTheoryHelper binary.
   * On other platforms, this is a no-op.
   */
  start(): void {
    if (process.platform !== 'darwin') {
      return;
    }

    if (this.child) {
      return;
    }

    const helperPath = this.getHelperPath();

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
        log.error('Helper stderr:', data.toString().trim());
      });

      this.child.on('exit', (code, signal) => {
        this.isRunning = false;
        this.isReady = false;
        this.recordingActive = false;
        this.child = null;

        if (code !== 0 && code !== null) {
          log.error('Helper exited with code', code, 'signal', signal);
          setTimeout(() => this.start(), 5000);
        }
      });

      this.child.on('error', (error) => {
        log.error('Failed to spawn helper:', error);
        this.isRunning = false;
        this.recordingActive = false;
        this.child = null;
      });
    } catch (error) {
      log.error('Exception spawning helper:', error);
      this.isRunning = false;
      this.recordingActive = false;
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
      this.recordingActive = false;
    }
  }

  /**
   * Check if the helper is currently running.
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Best-effort recording state tracked from helper events.
   * Useful for avoiding duplicate startRecording attempts across managers.
   */
  isRecordingActive(): boolean {
    return this.recordingActive;
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
      log.error('Helper did not become ready within timeout');
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
   * Pre-warm the CoreAudio hardware so the first recording starts instantly.
   * Fire-and-forget — no response expected.
   */
  async warmupAudio(): Promise<void> {
    await this.waitForReady();
    this.send({ type: 'warmupAudio' });
  }

  /**
   * Start recording audio from the default input device.
   * Returns a promise that resolves when recording starts.
   */
  async startRecording(): Promise<void> {
    return this.enqueueRecordingCommand('startRecording', async () => {
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= START_RECORDING_RETRY_DELAYS_MS.length; attempt += 1) {
        try {
          await this.waitForRecordingTransitionGraceWindow();
          await this.startRecordingOnce();
          return;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          const retryDelay = START_RECORDING_RETRY_DELAYS_MS[attempt];
          if (!this.isTransientStartRecordingError(lastError) || retryDelay == null) {
            throw lastError;
          }
          log.warn(
            'Retrying helper startRecording after transient failure (attempt %d/%d): %s',
            attempt + 1,
            START_RECORDING_RETRY_DELAYS_MS.length + 1,
            lastError.message,
          );
          await this.delay(retryDelay);
        }
      }

      throw lastError ?? new Error('Failed to start recording');
    });
  }

  /**
   * Stop recording and get the path to the recorded WAV file.
   */
  async stopRecording(): Promise<string> {
    return this.enqueueRecordingCommand('stopRecording', async () => {
      await this.waitForReady();
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          log.error('stopRecording timeout - no response received');
          reject(new Error('stopRecording timed out'));
        }, 10000); // Increased timeout to 10 seconds

        const handler = (msg: HelperOutgoingMessage) => {
          if (msg.type === 'recordingStopped') {
            this.recordingActive = false;
            cleanup();
            resolve(msg.filePath);
          } else if (msg.type === 'error' && /stop recording|no recording in progress/i.test(msg.message)) {
            if (/no recording in progress/i.test(msg.message)) {
              this.recordingActive = false;
              this.markRecordingReleased();
            }
            cleanup();
            reject(new Error(msg.message));
          }
        };

        const cleanup = () => {
          clearTimeout(timeout);
          this.removeListener('message', handler);
        };

        this.on('message', handler);
        this.send({ type: 'stopRecording' });
      });
    });
  }

  /**
   * Snapshot the current recording: rotate the output file without stopping the audio engine.
   * Returns the path to the completed WAV file. The engine keeps recording into a new file.
   */
  async snapshotRecording(): Promise<string> {
    return this.enqueueRecordingCommand('snapshotRecording', async () => {
      await this.waitForReady();
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('snapshotRecording timed out'));
        }, 2000);

        const onMessage = (msg: HelperOutgoingMessage) => {
          if (msg.type === 'recordingSnapshot') {
            cleanup();
            resolve(msg.filePath);
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
        this.send({ type: 'snapshotRecording' });
      });
    });
  }

  /**
   * Cancel the current recording without saving.
   */
  async cancelRecording(): Promise<void> {
    return this.enqueueRecordingCommand('cancelRecording', async () => {
      await this.waitForReady();
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error('cancelRecording timed out'));
        }, 5000);

        const onMessage = (msg: HelperOutgoingMessage) => {
          if (msg.type === 'recordingCancelled') {
            this.recordingActive = false;
            cleanup();
            resolve();
          } else if (msg.type === 'error' && /cancel recording/i.test(msg.message)) {
            if (/no recording in progress/i.test(msg.message)) {
              this.recordingActive = false;
              this.markRecordingReleased();
            }
            cleanup();
            reject(new Error(msg.message));
          }
        };

        const cleanup = () => {
          clearTimeout(timeout);
          this.removeListener('message', onMessage);
        };

        this.on('message', onMessage);
        this.send({ type: 'cancelRecording' });
      });
    });
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
   * Preload sound files for instant playback.
   * Call once at startup with all sound file paths.
   * Returns the number of sounds successfully preloaded.
   */
  async preloadSounds(soundPaths: string[]): Promise<number> {
    if (!this.child || !this.child.stdin.writable) {
      return 0;
    }

    await this.waitForReady();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve(0);
      }, 5000);

      const onMessage = (msg: HelperOutgoingMessage) => {
        if (msg.type === 'soundsPreloaded') {
          cleanup();
          resolve(msg.count);
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.removeListener('message', onMessage);
      };

      this.on('message', onMessage);
      this.send({ type: 'preloadSounds', soundPaths });
    });
  }

  /**
   * Play a sound file. Fire-and-forget - returns immediately.
   * Sound should be preloaded for instant (~1-5ms) playback.
   */
  playSound(soundPath: string): void {
    if (!this.child || !this.child.stdin.writable) {
      return;
    }

    // Fire-and-forget for minimal latency - don't await ready
    this.send({ type: 'playSound', soundPath });
  }

  /**
   * Type text into a specific app via pasteboard + CGEvent simulation.
   * Used by Hot Mic to inject transcribed text into terminal apps.
   */
  async typeIntoApp(bundleId: string, text: string, pressEnter: boolean): Promise<{ success: boolean; error?: string }> {
    if (!this.child || !this.child.stdin.writable) {
      return { success: false, error: 'Helper not running' };
    }

    await this.waitForReady();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve({ success: false, error: 'typeIntoApp timed out' });
      }, 5000);

      const onMessage = (msg: HelperOutgoingMessage) => {
        if (msg.type === 'typeIntoAppResult') {
          cleanup();
          resolve({ success: msg.success, error: msg.error });
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.removeListener('message', onMessage);
      };

      this.on('message', onMessage);
      this.send({ type: 'typeIntoApp', bundleId, text, pressEnter });
    });
  }

  /**
   * Focus a specific window of an app by matching a substring in its title.
   * Used by Hot Mic to focus the correct terminal window when multiple exist.
   */
  async focusWindowByTitle(bundleId: string, titleSubstring: string): Promise<{ success: boolean; error?: string }> {
    if (!this.child || !this.child.stdin.writable) {
      return { success: false, error: 'Helper not running' };
    }

    await this.waitForReady();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve({ success: false, error: 'focusWindowByTitle timed out' });
      }, 2000);

      const onMessage = (msg: HelperOutgoingMessage) => {
        if (msg.type === 'focusWindowByTitleResult') {
          cleanup();
          resolve({ success: msg.success, error: msg.error });
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.removeListener('message', onMessage);
      };

      this.on('message', onMessage);
      this.send({ type: 'focusWindowByTitle', bundleId, titleSubstring });
    });
  }

  /**
   * Set the harvest mode for Swift silence detection.
   * Fire-and-forget — no response expected.
   */
  setHarvestMode(mode: 'command' | 'dictation' | 'off', silenceMs?: number): void {
    if (!this.child || !this.child.stdin.writable) {
      return;
    }
    this.send({ type: 'setHarvestMode', mode, ...(silenceMs != null && { silenceMs }) });
  }

  /**
   * Set a window's frame instantly (no animation).
   * Returns true if successful.
   */
  async setWindowFrame(
    pid: number,
    title: string,
    x: number,
    y: number,
    width: number,
    height: number,
    sourceFrame?: { x: number; y: number; width: number; height: number }
  ): Promise<boolean> {
    if (!this.child || !this.child.stdin.writable) {
      return false;
    }

    await this.waitForReady();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve(false);
      }, 2000);

      const onMessage = (msg: HelperOutgoingMessage) => {
        if (msg.type === 'windowFrameSet') {
          cleanup();
          resolve(msg.success);
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.removeListener('message', onMessage);
      };

      this.on('message', onMessage);
      this.send({
        type: 'setWindowFrame',
        pid,
        title,
        x,
        y,
        width,
        height,
        sourceX: sourceFrame?.x,
        sourceY: sourceFrame?.y,
        sourceWidth: sourceFrame?.width,
        sourceHeight: sourceFrame?.height,
      });
    });
  }

  /**
   * Get all on-screen windows via CGWindowListCopyWindowInfo (native, no JXA).
   * Returns window info including PID, bundle ID, title, and bounds.
   */
  async getWindowList(): Promise<NativeWindowInfo[]> {
    if (!this.child || !this.child.stdin.writable) {
      return [];
    }

    await this.waitForReady();

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        cleanup();
        resolve([]);
      }, 2000);

      const onMessage = (msg: HelperOutgoingMessage) => {
        if (msg.type === 'windowList') {
          cleanup();
          resolve(msg.windows);
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.removeListener('message', onMessage);
      };

      this.on('message', onMessage);
      this.send({ type: 'getWindowList' });
    });
  }

  /**
   * Start gaze tracking in the native helper.
   */
  async startGazeTracking(targetFps: number = DEFAULT_GAZE_TARGET_FPS): Promise<GazeTrackingStatusMessage> {
    if (!this.child || !this.child.stdin.writable) {
      return this.createUnavailableGazeStatus('Helper not running', targetFps);
    }

    await this.waitForReady();
    return this.waitForGazeStatusMessage({ type: 'startGazeTracking', targetFps });
  }

  /**
   * Stop gaze tracking in the native helper.
   */
  async stopGazeTracking(): Promise<GazeTrackingStatusMessage> {
    if (!this.child || !this.child.stdin.writable) {
      return this.createUnavailableGazeStatus('Helper not running');
    }

    await this.waitForReady();
    return this.waitForGazeStatusMessage({ type: 'stopGazeTracking' });
  }

  /**
   * Get current gaze tracking status from the native helper.
   */
  async getGazeTrackingStatus(): Promise<GazeTrackingStatusMessage> {
    if (!this.child || !this.child.stdin.writable) {
      return this.createUnavailableGazeStatus('Helper not running');
    }

    await this.waitForReady();
    return this.waitForGazeStatusMessage({ type: 'getGazeTrackingStatus' });
  }

  private async waitForGazeStatusMessage(
    command: { type: 'startGazeTracking'; targetFps: number } | { type: 'stopGazeTracking' } | { type: 'getGazeTrackingStatus' }
  ): Promise<GazeTrackingStatusMessage> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`${command.type} timed out`));
      }, GAZE_STATUS_TIMEOUT_MS);

      const onMessage = (msg: HelperOutgoingMessage) => {
        if (msg.type === 'gazeTrackingStatus') {
          cleanup();
          resolve(msg);
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.removeListener('message', onMessage);
      };

      this.on('message', onMessage);
      this.send(command);
    });
  }

  private createUnavailableGazeStatus(reason: string, targetFps: number = DEFAULT_GAZE_TARGET_FPS): GazeTrackingStatusMessage {
    return {
      type: 'gazeTrackingStatus',
      running: false,
      cameraAuthorized: false,
      targetFps,
      reason,
    };
  }

  /**
   * Stop all currently playing sounds.
   */
  stopSounds(): void {
    if (!this.child || !this.child.stdin.writable) {
      return;
    }
    this.send({ type: 'stopSounds' });
  }

  /**
   * Determine the path to the helper binary based on the environment.
   */
  private getHelperPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'FieldTheoryHelper');
    } else {
      const appPath = app.getAppPath();
      return path.join(appPath, 'electron/native/build/FieldTheoryHelper');
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
        this.handleMessage(msg);
      } catch (err) {
        log.error('Failed to parse JSON from helper. Line:', line.substring(0, 200), 'Error:', err);
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
        if (msg.level === 'error') {
          log.error('Helper:', msg.message);
        } else if (msg.level === 'warn') {
          log.warn('Helper:', msg.message);
        } else {
          log.info('Helper:', msg.message);
        }
        break;

      case 'error':
        log.error('Helper error:', msg.message);
        if (this.listenerCount('error') > 0) {
          this.emit('error', new Error(msg.message));
        }
        this.emit('message', msg);
        break;

      case 'recordingStarted':
        this.recordingActive = true;
        this.emit('message', msg);
        break;

      case 'recordingStopped':
        this.recordingActive = false;
        this.markRecordingReleased();
        this.emit('message', msg);
        break;

      case 'recordingSnapshot':
        this.recordingActive = true;
        this.emit('message', msg);
        break;

      case 'recordingCancelled':
        this.recordingActive = false;
        this.markRecordingReleased();
        this.emit('message', msg);
        break;

      case 'recordingChunkReady':
        this.emit('recordingChunkReady', msg.filePath);
        break;

      case 'audioLevel':
        this.emit('audioLevel', msg.level, msg.isSpeech ?? (msg.level > 0.02));
        break;

      case 'permissionsStatus':
      case 'focusedTextInputStatus':
        this.emit('message', msg);
        break;

      case 'appBecameFrontmost':
        // Field Theory became the frontmost app (e.g., via Cmd+Tab).
        // Emit event so we can show the clipboard window.
        this.emit('appBecameFrontmost');
        break;

      case 'frontmostAppChanged':
        // Cache frontmost app info for instant access at hotkey time.
        this.cachedFrontmostApp = {
          bundleId: msg.bundleId || null,
          name: msg.name || null,
          windowBounds: msg.windowBounds || null,
        };
        this.emit('frontmostAppChanged', this.cachedFrontmostApp);
        break;

      case 'activeSpaceChanged':
        this.emit('activeSpaceChanged');
        break;

      case 'frontmostWindowBounds':
        // Response to getFrontmostWindowBounds - handled by promise listener.
        this.emit('message', msg);
        break;

      case 'soundsPreloaded':
        // Response to preloadSounds - handled by promise listener.
        this.emit('message', msg);
        break;

      case 'typeIntoAppResult':
        // Response to typeIntoApp - handled by promise listener.
        this.emit('message', msg);
        break;

      case 'focusWindowByTitleResult':
        // Response to focusWindowByTitle - handled by promise listener.
        this.emit('message', msg);
        break;

      case 'windowFrameSet':
      case 'windowList':
        // Responses to window management commands - handled by promise listeners.
        this.emit('message', msg);
        break;

      case 'gazeTrackingStatus':
        this.emit('gazeTrackingStatus', msg as GazeTrackingStatusMessage);
        this.emit('message', msg);
        break;

      case 'gazeSample':
        this.emit('gazeSample', msg as GazeSampleMessage);
        break;

      default:
        break;
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
      return;
    }

    try {
      const json = JSON.stringify(command);
      const success = this.child.stdin.write(json + '\n');

      if (!success) {
        this.child.stdin.once('drain', () => {});
      }
    } catch (error: unknown) {
      const isEPIPE = error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EPIPE';
      if (isEPIPE) {
        log.error('Broken pipe - helper process may have exited');
        this.isRunning = false;
        this.child = null;
      } else {
        log.error('Error sending command:', error, 'Command was:', command);
      }
    }
  }

  private async startRecordingOnce(): Promise<void> {
    await this.waitForReady();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('startRecording timed out'));
      }, 5000);

      const handler = (msg: HelperOutgoingMessage) => {
        if (msg.type === 'recordingStarted') {
          this.recordingActive = true;
          cleanup();
          resolve();
        } else if (msg.type === 'error' && /start recording|already in progress/i.test(msg.message)) {
          if (/already in progress/i.test(msg.message)) {
            this.recordingActive = true;
          }
          cleanup();
          reject(new Error(msg.message));
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.removeListener('message', handler);
      };

      this.on('message', handler);
      this.send({ type: 'startRecording' });
    });
  }

  private enqueueRecordingCommand<T>(label: string, operation: () => Promise<T>): Promise<T> {
    const run = this.recordingCommandChain
      .catch(() => undefined)
      .then(async () => {
        log.info('Recording command start: %s', label);
        try {
          return await operation();
        } finally {
          log.info('Recording command end: %s', label);
        }
      });

    this.recordingCommandChain = run.then(() => undefined, () => undefined);
    return run;
  }

  private async waitForRecordingTransitionGraceWindow(): Promise<void> {
    if (this.lastRecordingReleaseAt === 0) {
      return;
    }
    const elapsedMs = Date.now() - this.lastRecordingReleaseAt;
    if (elapsedMs >= RECORDING_TRANSITION_GRACE_MS) {
      return;
    }
    const waitMs = RECORDING_TRANSITION_GRACE_MS - elapsedMs;
    log.info('Waiting %dms for audio engine teardown before restarting recording', waitMs);
    await this.delay(waitMs);
  }

  private markRecordingReleased(): void {
    this.lastRecordingReleaseAt = Date.now();
  }

  private isTransientStartRecordingError(error: Error): boolean {
    return /Failed to start recording|startRecording timed out/i.test(error.message);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
