import { app, BrowserWindow, screen } from 'electron';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../logger';
import { PreferencesManager } from '../preferences';
import {
  GazeCalibrationState,
  GazeDebugOverlayBounds,
  GazeDebugOverlayState,
  GazeSample,
  GazeTrackingStatus,
  createUnavailableCalibrationState,
  createUnavailableGazeStatus,
} from '../types/gaze';

const log = createLogger('GazeDebugOverlay');

const OVERLAY_SNAPSHOT_CHANNEL = 'gaze-debug-overlay:snapshot';
const OVERLAY_FPS = 15;
const OVERLAY_FRAME_INTERVAL_MS = Math.round(1000 / OVERLAY_FPS);
const MIN_OVERLAY_WIDTH = 280;
const MIN_OVERLAY_HEIGHT = 220;
const MAX_OVERLAY_WIDTH = 1100;
const MAX_OVERLAY_HEIGHT = 900;
const BOUNDS_SAVE_DEBOUNCE_MS = 250;

type OverlaySnapshotPayload = {
  status: GazeTrackingStatus;
  calibration: GazeCalibrationState;
  sample: GazeSample | null;
  updatedAtMs: number;
};

/**
 * Owns the floating gaze debug overlay window lifecycle and renderer updates.
 */
export class GazeDebugOverlayManager extends EventEmitter {
  private readonly preferences: PreferencesManager;
  private window: BrowserWindow | null = null;
  private rendererReady = false;
  private enabled = false;
  private closingForDisable = false;
  private lastSentAtMs = 0;
  private sendTimer: NodeJS.Timeout | null = null;
  private saveBoundsTimer: NodeJS.Timeout | null = null;
  private bootstrapSnapshotTimers: NodeJS.Timeout[] = [];
  private snapshotSendCount = 0;
  private lastSnapshotDebugLogAtMs = 0;
  private latestStatus: GazeTrackingStatus = createUnavailableGazeStatus();
  private latestCalibration: GazeCalibrationState = createUnavailableCalibrationState();
  private latestSample: GazeSample | null = null;

  constructor(preferences: PreferencesManager) {
    super();
    this.preferences = preferences;
    this.enabled = this.preferences.getPreference('gazeDebugOverlayEnabled') === true;
  }

  async initFromPreferences(): Promise<void> {
    const shouldEnable = this.preferences.getPreference('gazeDebugOverlayEnabled') === true;
    await this.setEnabled(shouldEnable, false);
  }

  async reloadFromPreferences(): Promise<void> {
    const shouldEnable = this.preferences.getPreference('gazeDebugOverlayEnabled') === true;
    const bounds = sanitizeOverlayBounds(this.preferences.getPreference('gazeDebugOverlayBounds'));
    if (this.window && bounds) {
      this.window.setBounds(bounds);
    }
    await this.setEnabled(shouldEnable, false);
  }

  getState(): GazeDebugOverlayState {
    return {
      enabled: this.enabled,
      visible: !!this.window && !this.window.isDestroyed() && this.window.isVisible(),
      bounds: this.getCurrentBounds(),
    };
  }

  async setEnabled(enabled: boolean, persist: boolean = true): Promise<GazeDebugOverlayState> {
    const nextEnabled = enabled === true;
    if (nextEnabled === this.enabled) {
      if (nextEnabled && (!this.window || this.window.isDestroyed())) {
        this.createWindow();
      }
      return this.getState();
    }

    this.enabled = nextEnabled;
    log.info('Debug overlay %s', this.enabled ? 'enabled' : 'disabled');
    if (this.enabled) {
      this.createWindow();
    } else {
      this.closeWindowForDisable();
    }

    if (persist) {
      try {
        await this.preferences.save({
          gazeDebugOverlayEnabled: this.enabled,
        });
      } catch (error) {
        log.warn('Failed to persist gaze debug overlay enabled state:', error);
      }
    }

    const snapshot = this.getState();
    this.emit('stateChanged', snapshot);
    return snapshot;
  }

  updateStatus(status: GazeTrackingStatus): void {
    this.latestStatus = cloneStatus(status);
    this.scheduleSnapshotSend();
  }

  updateCalibration(state: GazeCalibrationState): void {
    this.latestCalibration = cloneCalibrationState(state);
    this.scheduleSnapshotSend();
  }

  updateSample(sample: GazeSample): void {
    this.latestSample = cloneSample(sample);
    if (this.latestStatus.running) {
      this.latestStatus.lastSampleAtMs = Date.now();
    }
    this.scheduleSnapshotSend();
  }

  destroy(): void {
    this.clearBootstrapSnapshotTimers();
    if (this.sendTimer) {
      clearTimeout(this.sendTimer);
      this.sendTimer = null;
    }
    if (this.saveBoundsTimer) {
      clearTimeout(this.saveBoundsTimer);
      this.saveBoundsTimer = null;
    }
    this.closeWindowForDisable();
    this.removeAllListeners();
  }

  private createWindow(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.showInactive();
      return;
    }

    this.rendererReady = false;
    this.closingForDisable = false;
    this.snapshotSendCount = 0;
    this.lastSnapshotDebugLogAtMs = 0;
    const initialBounds = this.resolveInitialBounds();
    const preloadPath = resolveOverlayPreloadPath();
    const preloadExists = fs.existsSync(preloadPath);
    if (!preloadExists) {
      log.error('Overlay preload script missing: %s', preloadPath);
    } else {
      log.info('Overlay preload script: %s', preloadPath);
    }

    this.window = new BrowserWindow({
      x: initialBounds.x,
      y: initialBounds.y,
      width: initialBounds.width,
      height: initialBounds.height,
      minWidth: MIN_OVERLAY_WIDTH,
      minHeight: MIN_OVERLAY_HEIGHT,
      maxWidth: MAX_OVERLAY_WIDTH,
      maxHeight: MAX_OVERLAY_HEIGHT,
      title: 'Vision Debug Overlay',
      frame: true,
      titleBarStyle: 'hiddenInset',
      transparent: false,
      backgroundColor: '#0d1117',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: true,
      movable: true,
      fullscreenable: false,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: preloadPath,
      },
    });

    this.window.setAlwaysOnTop(true, 'screen-saver');
    this.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    this.window.on('move', () => this.persistBoundsDebounced());
    this.window.on('resize', () => this.persistBoundsDebounced());
    this.window.webContents.on('ipc-message', (_event, channel, ...args) => {
      if (channel === 'gaze-debug-overlay:preloadReady') {
        log.info('Debug overlay preload ready: %s', JSON.stringify(args[0] ?? {}));
      }
    });
    this.window.on('close', () => {
      if (this.closingForDisable) return;
      this.persistCurrentBoundsSoon();
    });
    this.window.on('closed', () => {
      this.window = null;
      this.rendererReady = false;
      this.clearBootstrapSnapshotTimers();

      if (this.closingForDisable) {
        this.closingForDisable = false;
        return;
      }

      if (this.enabled) {
        this.enabled = false;
        this.preferences.save({
          gazeDebugOverlayEnabled: false,
        }).catch((error) => {
          log.warn('Failed to persist debug overlay closed state:', error);
        });
      }

      this.emit('stateChanged', this.getState());
    });

    this.window.webContents.once('did-finish-load', () => {
      this.rendererReady = true;
      log.info('Debug overlay renderer loaded');
      this.sendSnapshotNow();
      this.scheduleBootstrapSnapshotPushes();
      this.window?.showInactive();
      this.emit('stateChanged', this.getState());
    });

    this.window.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
      log.error('Failed to load gaze debug overlay window: %s %s', errorCode, errorDescription);
    });

    const startUrl = process.env.ELECTRON_START_URL;
    if (startUrl) {
      this.window.loadURL(`${appendPathToBaseUrl(startUrl, 'gaze-debug-overlay.html')}`);
    } else {
      const htmlPath = path.join(app.getAppPath(), 'dist', 'gaze-debug-overlay.html');
      this.window.loadFile(htmlPath);
    }
  }

  private closeWindowForDisable(): void {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }
    this.clearBootstrapSnapshotTimers();
    this.persistCurrentBoundsSoon();
    this.closingForDisable = true;
    this.window.close();
    this.window = null;
    this.rendererReady = false;
  }

  private resolveInitialBounds(): GazeDebugOverlayBounds {
    const saved = sanitizeOverlayBounds(this.preferences.getPreference('gazeDebugOverlayBounds'));
    if (saved) {
      return saved;
    }

    const workArea = screen.getPrimaryDisplay().workArea;
    const width = 440;
    const height = 320;
    return {
      width,
      height,
      x: Math.round(workArea.x + workArea.width - width - 32),
      y: Math.round(workArea.y + 48),
    };
  }

  private persistBoundsDebounced(): void {
    if (this.saveBoundsTimer) {
      clearTimeout(this.saveBoundsTimer);
      this.saveBoundsTimer = null;
    }
    this.saveBoundsTimer = setTimeout(() => {
      this.saveBoundsTimer = null;
      this.persistCurrentBoundsSoon();
    }, BOUNDS_SAVE_DEBOUNCE_MS);
  }

  private persistCurrentBoundsSoon(): void {
    const bounds = this.getCurrentBounds();
    if (!bounds) return;
    this.preferences.save({
      gazeDebugOverlayBounds: bounds,
    }).catch((error) => {
      log.warn('Failed to persist gaze debug overlay bounds:', error);
    });
    this.emit('stateChanged', this.getState());
  }

  private getCurrentBounds(): GazeDebugOverlayBounds | null {
    if (!this.window || this.window.isDestroyed()) {
      const saved = sanitizeOverlayBounds(this.preferences.getPreference('gazeDebugOverlayBounds'));
      return saved;
    }
    const bounds = this.window.getBounds();
    return sanitizeOverlayBounds(bounds);
  }

  private scheduleSnapshotSend(): void {
    if (!this.enabled || !this.window || this.window.isDestroyed() || !this.rendererReady) {
      return;
    }

    const now = Date.now();
    const elapsed = now - this.lastSentAtMs;
    if (elapsed >= OVERLAY_FRAME_INTERVAL_MS) {
      this.sendSnapshotNow();
      return;
    }

    if (this.sendTimer) {
      return;
    }

    this.sendTimer = setTimeout(() => {
      this.sendTimer = null;
      this.sendSnapshotNow();
    }, OVERLAY_FRAME_INTERVAL_MS - elapsed);
  }

  private sendSnapshotNow(): void {
    if (!this.window || this.window.isDestroyed() || !this.rendererReady) {
      return;
    }
    this.lastSentAtMs = Date.now();
    const payload: OverlaySnapshotPayload = {
      status: cloneStatus(this.latestStatus),
      calibration: cloneCalibrationState(this.latestCalibration),
      sample: this.latestSample ? cloneSample(this.latestSample) : null,
      updatedAtMs: Date.now(),
    };
    this.snapshotSendCount += 1;
    this.logSnapshotDebug(payload);
    this.window.webContents.send(OVERLAY_SNAPSHOT_CHANNEL, payload);
  }

  private scheduleBootstrapSnapshotPushes(): void {
    this.clearBootstrapSnapshotTimers();
    for (const delayMs of [140, 360, 800]) {
      const timer = setTimeout(() => {
        this.sendSnapshotNow();
      }, delayMs);
      timer.unref?.();
      this.bootstrapSnapshotTimers.push(timer);
    }
  }

  private clearBootstrapSnapshotTimers(): void {
    if (this.bootstrapSnapshotTimers.length === 0) {
      return;
    }
    for (const timer of this.bootstrapSnapshotTimers) {
      clearTimeout(timer);
    }
    this.bootstrapSnapshotTimers = [];
  }

  private logSnapshotDebug(payload: OverlaySnapshotPayload): void {
    const now = Date.now();
    if ((now - this.lastSnapshotDebugLogAtMs) < 5000) {
      return;
    }
    this.lastSnapshotDebugLogAtMs = now;
    const sampleAgeMs = payload.status.lastSampleAtMs
      ? Math.max(0, now - payload.status.lastSampleAtMs)
      : null;
    const sample = payload.sample;
    const gains = payload.calibration.personalOffsets
      ? {
        horizontal: payload.calibration.personalOffsets.horizontalGain ?? 1,
        vertical: payload.calibration.personalOffsets.verticalGain ?? 1,
      }
      : null;

    log.debug(
      'Snapshot bridge alive: count=%s running=%s camera=%s sample=%s sampleAgeMs=%s raw=(%s,%s) cal=(%s,%s) gain=(%s,%s) mapped=(%s,%s)',
      this.snapshotSendCount,
      payload.status.running,
      payload.status.cameraAuthorized,
      sample ? 'yes' : 'no',
      sampleAgeMs ?? 'n/a',
      sample ? sample.combinedEye.x.toFixed(3) : 'n/a',
      sample ? sample.combinedEye.y.toFixed(3) : 'n/a',
      sample ? sample.calibratedCombinedEye.x.toFixed(3) : 'n/a',
      sample ? sample.calibratedCombinedEye.y.toFixed(3) : 'n/a',
      gains ? gains.horizontal.toFixed(2) : 'n/a',
      gains ? gains.vertical.toFixed(2) : 'n/a',
      sample?.mappedScreenPoint ? Math.round(sample.mappedScreenPoint.x) : 'n/a',
      sample?.mappedScreenPoint ? Math.round(sample.mappedScreenPoint.y) : 'n/a'
    );
  }
}

function sanitizeOverlayBounds(input: unknown): GazeDebugOverlayBounds | null {
  if (!input || typeof input !== 'object') {
    return null;
  }
  const bounds = input as Partial<GazeDebugOverlayBounds>;
  if (
    typeof bounds.x !== 'number' ||
    typeof bounds.y !== 'number' ||
    typeof bounds.width !== 'number' ||
    typeof bounds.height !== 'number'
  ) {
    return null;
  }
  if (
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y) ||
    !Number.isFinite(bounds.width) ||
    !Number.isFinite(bounds.height)
  ) {
    return null;
  }
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: clampInt(bounds.width, MIN_OVERLAY_WIDTH, MAX_OVERLAY_WIDTH),
    height: clampInt(bounds.height, MIN_OVERLAY_HEIGHT, MAX_OVERLAY_HEIGHT),
  };
}

function clampInt(value: number, minValue: number, maxValue: number): number {
  const rounded = Math.round(value);
  return Math.max(minValue, Math.min(maxValue, rounded));
}

function cloneStatus(status: GazeTrackingStatus): GazeTrackingStatus {
  return {
    enabled: status.enabled,
    running: status.running,
    cameraAuthorized: status.cameraAuthorized,
    targetFps: status.targetFps,
    reason: status.reason,
    lastSampleAtMs: status.lastSampleAtMs,
  };
}

function cloneCalibrationState(state: GazeCalibrationState): GazeCalibrationState {
  return {
    active: state.active,
    currentPointId: state.currentPointId,
    currentPointIndex: state.currentPointIndex,
    totalPoints: state.totalPoints,
    stableForMs: state.stableForMs,
    currentVariance: state.currentVariance,
    samplesCollected: state.samplesCollected,
    manualCorrectionCount: state.manualCorrectionCount,
    collectedPoints: state.collectedPoints.map((point) => ({
      pointId: point.pointId,
      target: { ...point.target },
      observedCombined: { ...point.observedCombined },
      observedLeft: { ...point.observedLeft },
      observedRight: { ...point.observedRight },
      variance: point.variance,
    })),
    personalOffsets: state.personalOffsets ? { ...state.personalOffsets } : null,
    lastCalibratedAtMs: state.lastCalibratedAtMs,
    accuracy: state.accuracy ? { ...state.accuracy } : null,
    needsRecalibrationPrompt: state.needsRecalibrationPrompt,
    recalibrationReason: state.recalibrationReason,
  };
}

function cloneSample(sample: GazeSample): GazeSample {
  return {
    timestampMs: sample.timestampMs,
    confidence: sample.confidence,
    leftEye: { ...sample.leftEye },
    rightEye: { ...sample.rightEye },
    combinedEye: { ...sample.combinedEye },
    calibratedCombinedEye: { ...sample.calibratedCombinedEye },
    calibrationApplied: sample.calibrationApplied,
    headPose: { ...sample.headPose },
    gazeVector: { ...sample.gazeVector },
    faceBounds: { ...sample.faceBounds },
    faceSize: sample.faceSize,
    distanceScale: sample.distanceScale,
    activeDisplayId: sample.activeDisplayId ?? null,
    mappedScreenPoint: sample.mappedScreenPoint ? { ...sample.mappedScreenPoint } : null,
    landmarks: sample.landmarks
      ? {
        leftEye: {
          medialCanthus: { ...sample.landmarks.leftEye.medialCanthus },
          lateralCanthus: { ...sample.landmarks.leftEye.lateralCanthus },
          irisCenter: { ...sample.landmarks.leftEye.irisCenter },
        },
        rightEye: {
          medialCanthus: { ...sample.landmarks.rightEye.medialCanthus },
          lateralCanthus: { ...sample.landmarks.rightEye.lateralCanthus },
          irisCenter: { ...sample.landmarks.rightEye.irisCenter },
        },
      }
      : null,
  };
}

function appendPathToBaseUrl(baseUrl: string, page: string): string {
  if (baseUrl.endsWith('/')) {
    return `${baseUrl}${page}`;
  }
  return `${baseUrl}/${page}`;
}

function resolveOverlayPreloadPath(): string {
  // Runtime __dirname is electron-dist/main/gaze, so ../../ targets electron-dist/.
  return path.resolve(__dirname, '../../gaze-debug-overlay-preload.js');
}
