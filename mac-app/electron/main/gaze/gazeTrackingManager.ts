import { EventEmitter } from 'events';
import { createLogger } from '../logger';
import { NativeHelper } from '../nativeHelper';
import { PreferencesManager } from '../preferences';
import {
  DEFAULT_GAZE_TARGET_FPS,
  GazeCalibrationState,
  GazeLandmarks,
  GazePersonalOffsets,
  GazeSample,
  GazeTrackingStatus,
  NormalizedEyePosition,
  sanitizeGazeWindowFocusConfig,
  type GazeDwellEvent,
  type GazeWindowFocusConfig,
  type GazeWindowSnapshot,
} from '../types/gaze';
import { GazeSampleMessage, GazeTrackingStatusMessage } from '../types/audio';
import { GazeCalibrationEngine, sanitizeGazePersonalOffsets } from './gazeCalibrationEngine';
import { GazeWindowFocusManager } from './gazeWindowFocusManager';

const log = createLogger('GazeTracking');
const CALIBRATION_PROMPT_STALE_MS = 8 * 60 * 60 * 1000;

/**
 * GazeTrackingManager coordinates lifecycle for the native gaze pipeline.
 * It only starts capture/inference when explicitly enabled in preferences.
 */
export class GazeTrackingManager extends EventEmitter {
  private readonly helper: NativeHelper;
  private readonly preferences: PreferencesManager;
  private readonly calibrationEngine: GazeCalibrationEngine;
  private readonly windowFocusManager: GazeWindowFocusManager;
  private latestSample: GazeSample | null = null;
  private status: GazeTrackingStatus;
  private initialized = false;
  private lastSampleReceivedAtMs: number | null = null;

  private readonly onHelperSample = (message: GazeSampleMessage) => {
    const calibration = this.calibrationEngine.applyOffsets(
      message.leftEye,
      message.rightEye,
      message.combinedEye
    );

    const sample: GazeSample = {
      timestampMs: message.timestampMs,
      confidence: message.confidence,
      leftEye: { ...message.leftEye },
      rightEye: { ...message.rightEye },
      combinedEye: { ...message.combinedEye },
      calibratedCombinedEye: { ...calibration.calibratedCombinedEye },
      calibrationApplied: calibration.calibrationApplied,
      headPose: { ...message.headPose },
      gazeVector: { ...message.gazeVector },
      faceBounds: { ...message.faceBounds },
      faceSize: message.faceSize,
      distanceScale: message.distanceScale,
      landmarks: message.landmarks ? cloneLandmarks(message.landmarks) : null,
    };

    const calibrationUpdate = this.calibrationEngine.onFrame({
      timestampMs: sample.timestampMs,
      leftEye: sample.leftEye,
      rightEye: sample.rightEye,
      combinedEye: sample.combinedEye,
      faceSize: sample.faceSize,
    });

    if (calibrationUpdate.completedOffsets) {
      void this.persistOffsets(calibrationUpdate.completedOffsets);
    }

    const mapped = this.windowFocusManager.processSample(sample);
    if (mapped) {
      sample.activeDisplayId = mapped.activeDisplayId;
      sample.mappedScreenPoint = { ...mapped.mappedPoint };
    } else {
      sample.activeDisplayId = null;
      sample.mappedScreenPoint = null;
    }

    this.latestSample = sample;
    this.lastSampleReceivedAtMs = Date.now();
    this.status.lastSampleAtMs = this.lastSampleReceivedAtMs;
    this.emit('sample', GazeTrackingManager.cloneSample(sample));

    if (calibrationUpdate.stateChanged) {
      this.emit('calibrationChanged', this.getCalibrationState());
    }
  };

  private readonly onHelperStatus = (message: GazeTrackingStatusMessage) => {
    this.applyHelperStatus(message);
    this.emit('statusChanged', this.getStatus());
  };

  private readonly onHelperActiveSpaceChanged = () => {
    this.windowFocusManager.noteActiveSpaceChanged();
  };

  constructor(helper: NativeHelper, preferences: PreferencesManager) {
    super();
    this.helper = helper;
    this.preferences = preferences;
    const enabledPreference = this.preferences.getPreference('gazeTrackingEnabled');
    const enabled = enabledPreference === true;
    const personalOffsets = sanitizeGazePersonalOffsets(this.preferences.getPreference('gazePersonalOffsets'));
    const lastCalibratedAtMs = getTimestampOrNull(this.preferences.getPreference('gazeLastCalibratedAtMs'));
    const focusConfig = sanitizeGazeWindowFocusConfig(this.preferences.getPreference('gazeWindowFocusConfig'));
    this.calibrationEngine = new GazeCalibrationEngine(personalOffsets, lastCalibratedAtMs);
    this.windowFocusManager = new GazeWindowFocusManager(helper, focusConfig);
    this.windowFocusManager.on('dwellTriggered', (event: GazeDwellEvent) => {
      this.emit('dwellTriggered', event);
    });
    this.windowFocusManager.on('highlightWindow', (window: GazeWindowSnapshot) => {
      this.emit('highlightWindow', window);
    });

    this.status = {
      enabled,
      running: false,
      cameraAuthorized: false,
      targetFps: DEFAULT_GAZE_TARGET_FPS,
      reason: null,
      lastSampleAtMs: null,
    };

    this.refreshCalibrationPromptForAge(Date.now());
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.helper.on('gazeSample', this.onHelperSample);
    this.helper.on('gazeTrackingStatus', this.onHelperStatus);
    this.helper.on('activeSpaceChanged', this.onHelperActiveSpaceChanged);
    this.initialized = true;

    try {
      // Fetch status from helper first to hydrate camera auth/running state.
      const helperStatus = await this.helper.getGazeTrackingStatus();
      this.applyHelperStatus(helperStatus);

      if (this.status.enabled) {
        await this.startTracking(this.status.targetFps);
      }

      this.emit('statusChanged', this.getStatus());
      this.emit('calibrationChanged', this.getCalibrationState());
    } catch (error) {
      this.helper.removeListener('gazeSample', this.onHelperSample);
      this.helper.removeListener('gazeTrackingStatus', this.onHelperStatus);
      this.helper.removeListener('activeSpaceChanged', this.onHelperActiveSpaceChanged);
      this.initialized = false;
      throw error;
    }
  }

  async reloadFromPreferences(): Promise<void> {
    this.reloadCalibrationFromPreferences();
    this.reloadFocusConfigFromPreferences();
    this.emit('calibrationChanged', this.getCalibrationState());

    const enabledFromPrefs = this.preferences.getPreference('gazeTrackingEnabled') === true;
    if (enabledFromPrefs === this.status.enabled) {
      return;
    }
    await this.setEnabled(enabledFromPrefs);
  }

  async setEnabled(enabled: boolean): Promise<GazeTrackingStatus> {
    const normalizedEnabled = enabled === true;
    if (normalizedEnabled === this.status.enabled) {
      if (normalizedEnabled && !this.status.running) {
        await this.startTracking(this.status.targetFps);
        const snapshot = this.getStatus();
        this.emit('statusChanged', snapshot);
        return snapshot;
      }
      if (!normalizedEnabled && this.status.running) {
        await this.stopTracking();
        const snapshot = this.getStatus();
        this.emit('statusChanged', snapshot);
        return snapshot;
      }
      return this.getStatus();
    }

    this.status.enabled = normalizedEnabled;
    await this.preferences.save({ gazeTrackingEnabled: normalizedEnabled });

    if (normalizedEnabled) {
      await this.startTracking(this.status.targetFps);
    } else {
      await this.stopTracking();
    }

    const snapshot = this.getStatus();
    this.emit('statusChanged', snapshot);
    return snapshot;
  }

  getStatus(): GazeTrackingStatus {
    return {
      enabled: this.status.enabled,
      running: this.status.running,
      cameraAuthorized: this.status.cameraAuthorized,
      targetFps: this.status.targetFps,
      reason: this.status.reason,
      lastSampleAtMs: this.lastSampleReceivedAtMs,
    };
  }

  getLatestSample(): GazeSample | null {
    if (!this.latestSample) return null;
    return GazeTrackingManager.cloneSample(this.latestSample);
  }

  getCalibrationState(): GazeCalibrationState {
    return this.calibrationEngine.getState();
  }

  getFocusConfig(): GazeWindowFocusConfig {
    return this.windowFocusManager.getConfig();
  }

  async setFocusConfig(config: Partial<GazeWindowFocusConfig>): Promise<GazeWindowFocusConfig> {
    const nextConfig = this.windowFocusManager.setConfig(config);
    try {
      await this.preferences.save({ gazeWindowFocusConfig: nextConfig });
    } catch (error) {
      log.error('Failed to persist gaze focus config:', error);
    }
    return nextConfig;
  }

  async startCalibration(): Promise<GazeCalibrationState> {
    if (!this.status.enabled) {
      await this.setEnabled(true);
    } else if (!this.status.running) {
      await this.startTracking(this.status.targetFps);
      this.emit('statusChanged', this.getStatus());
    }

    this.calibrationEngine.startCalibration();
    const snapshot = this.getCalibrationState();
    this.emit('calibrationChanged', snapshot);
    return snapshot;
  }

  cancelCalibration(): GazeCalibrationState {
    this.calibrationEngine.cancelCalibration();
    const snapshot = this.getCalibrationState();
    this.emit('calibrationChanged', snapshot);
    return snapshot;
  }

  async applyManualCorrection(target: NormalizedEyePosition): Promise<GazeCalibrationState> {
    if (!this.latestSample) {
      return this.getCalibrationState();
    }

    const offsets = this.calibrationEngine.applyManualCorrection({
      target,
      observedLeft: this.latestSample.leftEye,
      observedRight: this.latestSample.rightEye,
      observedCombined: this.latestSample.combinedEye,
      faceSize: this.latestSample.faceSize,
      timestampMs: Date.now(),
    });

    const recalibrated = this.calibrationEngine.applyOffsets(
      this.latestSample.leftEye,
      this.latestSample.rightEye,
      this.latestSample.combinedEye
    );
    this.latestSample.calibratedCombinedEye = { ...recalibrated.calibratedCombinedEye };
    this.latestSample.calibrationApplied = recalibrated.calibrationApplied;
    this.emit('sample', GazeTrackingManager.cloneSample(this.latestSample));

    await this.persistOffsets(offsets);
    return this.getCalibrationState();
  }

  async resetEyeTrackingData(): Promise<GazeCalibrationState> {
    this.calibrationEngine.resetPersonalOffsets();
    this.latestSample = null;
    this.lastSampleReceivedAtMs = null;
    this.status.lastSampleAtMs = null;

    await this.preferences.save({
      gazePersonalOffsets: null,
      gazeLastCalibratedAtMs: null,
    });

    const snapshot = this.getCalibrationState();
    this.emit('calibrationChanged', snapshot);
    return snapshot;
  }

  noteScreenParametersChanged(): void {
    this.calibrationEngine.markNeedsRecalibration('Display layout changed');
    this.windowFocusManager.noteScreenParametersChanged();
    this.emit('calibrationChanged', this.getCalibrationState());
  }

  noteActiveSpaceChanged(): void {
    this.windowFocusManager.noteActiveSpaceChanged();
  }

  async destroy(): Promise<void> {
    this.helper.removeListener('gazeSample', this.onHelperSample);
    this.helper.removeListener('gazeTrackingStatus', this.onHelperStatus);
    this.helper.removeListener('activeSpaceChanged', this.onHelperActiveSpaceChanged);
    this.windowFocusManager.destroy();

    if (this.status.running) {
      await this.stopTracking();
    }

    this.initialized = false;
  }

  private async startTracking(targetFps: number): Promise<void> {
    const normalizedFps = Number.isFinite(targetFps)
      ? Math.max(1, Math.min(30, Math.round(targetFps)))
      : DEFAULT_GAZE_TARGET_FPS;

    try {
      this.lastSampleReceivedAtMs = null;
      this.status.lastSampleAtMs = null;
      const helperStatus = await this.helper.startGazeTracking(normalizedFps);
      this.applyHelperStatus(helperStatus);
      if (!helperStatus.running) {
        log.warn('Gaze tracking did not start: %s', helperStatus.reason ?? 'unknown');
      }
    } catch (error) {
      this.status.running = false;
      this.status.reason = error instanceof Error ? error.message : 'Failed to start gaze tracking';
      this.syncWindowFocusRuntime();
      log.error('Failed to start gaze tracking:', error);
    }
  }

  private async stopTracking(): Promise<void> {
    try {
      this.lastSampleReceivedAtMs = null;
      this.status.lastSampleAtMs = null;
      const helperStatus = await this.helper.stopGazeTracking();
      this.applyHelperStatus(helperStatus);
    } catch (error) {
      this.status.running = false;
      this.status.reason = error instanceof Error ? error.message : 'Failed to stop gaze tracking';
      this.syncWindowFocusRuntime();
      log.error('Failed to stop gaze tracking:', error);
    }
  }

  private applyHelperStatus(message: GazeTrackingStatusMessage): void {
    const normalizedFps = Number.isFinite(message.targetFps)
      ? Math.max(1, Math.min(30, Math.round(message.targetFps)))
      : DEFAULT_GAZE_TARGET_FPS;
    this.status.running = message.running;
    this.status.cameraAuthorized = message.cameraAuthorized;
    this.status.targetFps = normalizedFps;
    this.status.reason = message.reason ?? null;
    this.syncWindowFocusRuntime();
  }

  private reloadCalibrationFromPreferences(): void {
    const personalOffsets = sanitizeGazePersonalOffsets(this.preferences.getPreference('gazePersonalOffsets'));
    const lastCalibratedAtMs = getTimestampOrNull(this.preferences.getPreference('gazeLastCalibratedAtMs'));
    this.calibrationEngine.replacePersonalOffsets(personalOffsets, lastCalibratedAtMs);
    this.refreshCalibrationPromptForAge(Date.now());
  }

  private reloadFocusConfigFromPreferences(): void {
    const focusConfig = sanitizeGazeWindowFocusConfig(this.preferences.getPreference('gazeWindowFocusConfig'));
    this.windowFocusManager.setConfig(focusConfig);
  }

  private refreshCalibrationPromptForAge(nowMs: number): void {
    const state = this.calibrationEngine.getState();
    const lastCalibratedAtMs = state.lastCalibratedAtMs;
    if (!lastCalibratedAtMs) {
      return;
    }
    if ((nowMs - lastCalibratedAtMs) > CALIBRATION_PROMPT_STALE_MS) {
      this.calibrationEngine.markNeedsRecalibration('Calibration is older than 8 hours');
    }
  }

  private async persistOffsets(offsets: GazePersonalOffsets): Promise<void> {
    try {
      await this.preferences.save({
        gazePersonalOffsets: offsets,
        gazeLastCalibratedAtMs: offsets.updatedAtMs,
      });
    } catch (error) {
      log.error('Failed to persist gaze calibration offsets:', error);
    }

    this.emit('calibrationChanged', this.getCalibrationState());
  }

  private syncWindowFocusRuntime(): void {
    const shouldRunFocus = this.status.enabled && this.status.running;
    if (shouldRunFocus) {
      this.windowFocusManager.start();
    } else {
      this.windowFocusManager.stop();
    }
  }

  private static cloneSample(sample: GazeSample): GazeSample {
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
      landmarks: sample.landmarks ? cloneLandmarks(sample.landmarks) : null,
    };
  }
}

function getTimestampOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(value);
}

function cloneLandmarks(landmarks: GazeLandmarks): GazeLandmarks {
  return {
    leftEye: {
      medialCanthus: { ...landmarks.leftEye.medialCanthus },
      lateralCanthus: { ...landmarks.leftEye.lateralCanthus },
      irisCenter: { ...landmarks.leftEye.irisCenter },
    },
    rightEye: {
      medialCanthus: { ...landmarks.rightEye.medialCanthus },
      lateralCanthus: { ...landmarks.rightEye.lateralCanthus },
      irisCenter: { ...landmarks.rightEye.irisCenter },
    },
  };
}
