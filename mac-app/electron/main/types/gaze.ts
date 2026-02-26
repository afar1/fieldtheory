// =============================================================================
// Gaze Tracking Types
// Shared types for gaze capture, vision inference, and normalization outputs.
// =============================================================================

export interface NormalizedEyePosition {
  x: number;
  y: number;
}

export interface HeadPoseEuler {
  yaw: number;
  pitch: number;
  roll: number;
}

export interface GazeVector3D {
  x: number;
  y: number;
  z: number;
}

export interface GazeLandmarkPoint {
  x: number;
  y: number;
}

export interface GazeEyeGeometry {
  medialCanthus: GazeLandmarkPoint;
  lateralCanthus: GazeLandmarkPoint;
  irisCenter: GazeLandmarkPoint;
}

export interface GazeLandmarks {
  leftEye: GazeEyeGeometry;
  rightEye: GazeEyeGeometry;
}

export interface FaceBoundsNormalized {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GazeSample {
  timestampMs: number;
  confidence: number;
  leftEye: NormalizedEyePosition;
  rightEye: NormalizedEyePosition;
  combinedEye: NormalizedEyePosition;
  calibratedCombinedEye: NormalizedEyePosition;
  calibrationApplied: boolean;
  headPose: HeadPoseEuler;
  gazeVector: GazeVector3D;
  faceBounds: FaceBoundsNormalized;
  faceSize: number;
  distanceScale: number;
  activeDisplayId?: number | null;
  mappedScreenPoint?: { x: number; y: number } | null;
  landmarks?: GazeLandmarks | null;
}

export interface GazeTrackingStatus {
  enabled: boolean;
  running: boolean;
  cameraAuthorized: boolean;
  targetFps: number;
  reason: string | null;
  lastSampleAtMs: number | null;
}

export interface GazeDebugOverlayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GazeDebugOverlayState {
  enabled: boolean;
  visible: boolean;
  bounds: GazeDebugOverlayBounds | null;
}

export interface GazeScreenOverlayState {
  enabled: boolean;
  visible: boolean;
}

export type GazeCalibrationPointId =
  | 'center'
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight';

export interface GazePersonalOffsets {
  version: 1;
  horizontalOffset: number;
  verticalOffset: number;
  horizontalGain: number;
  verticalGain: number;
  eyeDominance: number; // [0,1], left-eye weight
  referenceFaceSize: number;
  updatedAtMs: number;
}

export interface GazeCalibrationPointSample {
  pointId: GazeCalibrationPointId;
  target: NormalizedEyePosition;
  observedCombined: NormalizedEyePosition;
  observedLeft: NormalizedEyePosition;
  observedRight: NormalizedEyePosition;
  variance: number;
}

export interface GazeCalibrationAccuracy {
  label: 'good' | 'fair' | 'poor';
  meanError: number;
  estimatedErrorPx: number;
  message: string;
}

export interface GazeCalibrationState {
  active: boolean;
  currentPointId: GazeCalibrationPointId | null;
  currentPointIndex: number;
  totalPoints: number;
  stableForMs: number;
  currentVariance: number;
  samplesCollected: number;
  manualCorrectionCount: number;
  collectedPoints: GazeCalibrationPointSample[];
  personalOffsets: GazePersonalOffsets | null;
  lastCalibratedAtMs: number | null;
  accuracy: GazeCalibrationAccuracy | null;
  needsRecalibrationPrompt: boolean;
  recalibrationReason: string | null;
}

export type GazeDwellAction = 'highlightBorder' | 'bringToFront' | 'eventOnly';

export interface GazeWindowFocusConfig {
  dwellDurationMs: number; // 200-2000
  confidenceThreshold: number; // 0-1
  deadZonePx: number; // 40-200
  cooldownMs: number;
  dwellAction: GazeDwellAction;
}

export interface GazeWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GazeWindowSnapshot {
  windowId: number;
  ownerName: string;
  ownerBundleId: string;
  ownerPID: number;
  title: string;
  bounds: GazeWindowBounds;
  layer: number;
}

export interface GazeDwellEvent {
  timestampMs: number;
  confidence: number;
  stability: number;
  gazePoint: { x: number; y: number };
  activeDisplayId: number;
  window: GazeWindowSnapshot;
  action: GazeDwellAction;
}

export const DEFAULT_GAZE_TARGET_FPS = 15;
const DEFAULT_CALIBRATION_TOTAL_POINTS = 5;
export const DEFAULT_GAZE_DWELL_CONFIG: GazeWindowFocusConfig = {
  dwellDurationMs: 400,
  confidenceThreshold: 0.6,
  deadZonePx: 80,
  cooldownMs: 1500,
  dwellAction: 'eventOnly',
};

export function createDefaultGazeWindowFocusConfig(): GazeWindowFocusConfig {
  return {
    dwellDurationMs: DEFAULT_GAZE_DWELL_CONFIG.dwellDurationMs,
    confidenceThreshold: DEFAULT_GAZE_DWELL_CONFIG.confidenceThreshold,
    deadZonePx: DEFAULT_GAZE_DWELL_CONFIG.deadZonePx,
    cooldownMs: DEFAULT_GAZE_DWELL_CONFIG.cooldownMs,
    dwellAction: DEFAULT_GAZE_DWELL_CONFIG.dwellAction,
  };
}

/**
 * Shared "not available" status snapshot for IPC fallback paths.
 */
export function createUnavailableGazeStatus(reason: string = 'Manager not initialized'): GazeTrackingStatus {
  return {
    enabled: false,
    running: false,
    cameraAuthorized: false,
    targetFps: DEFAULT_GAZE_TARGET_FPS,
    reason,
    lastSampleAtMs: null,
  };
}

export function createUnavailableCalibrationState(reason: string = 'Manager not initialized'): GazeCalibrationState {
  return {
    active: false,
    currentPointId: null,
    currentPointIndex: 0,
    totalPoints: DEFAULT_CALIBRATION_TOTAL_POINTS,
    stableForMs: 0,
    currentVariance: 0,
    samplesCollected: 0,
    manualCorrectionCount: 0,
    collectedPoints: [],
    personalOffsets: null,
    lastCalibratedAtMs: null,
    accuracy: null,
    needsRecalibrationPrompt: false,
    recalibrationReason: reason,
  };
}

export function createUnavailableDebugOverlayState(): GazeDebugOverlayState {
  return {
    enabled: false,
    visible: false,
    bounds: null,
  };
}

export function createUnavailableScreenOverlayState(): GazeScreenOverlayState {
  return {
    enabled: false,
    visible: false,
  };
}

export function sanitizeGazeWindowFocusConfig(
  input: Partial<GazeWindowFocusConfig> | null | undefined
): GazeWindowFocusConfig {
  const config = input ?? {};
  const dwellAction = config.dwellAction;
  return {
    dwellDurationMs: clampInt(config.dwellDurationMs, 200, 2000, DEFAULT_GAZE_DWELL_CONFIG.dwellDurationMs),
    confidenceThreshold: clampNumber(config.confidenceThreshold, 0, 1, DEFAULT_GAZE_DWELL_CONFIG.confidenceThreshold),
    deadZonePx: clampInt(config.deadZonePx, 40, 200, DEFAULT_GAZE_DWELL_CONFIG.deadZonePx),
    cooldownMs: clampInt(config.cooldownMs, 500, 6000, DEFAULT_GAZE_DWELL_CONFIG.cooldownMs),
    dwellAction: dwellAction === 'highlightBorder' || dwellAction === 'bringToFront' || dwellAction === 'eventOnly'
      ? dwellAction
      : DEFAULT_GAZE_DWELL_CONFIG.dwellAction,
  };
}

export const GazeIPCChannels = {
  GET_STATUS: 'gaze:getStatus',
  SET_ENABLED: 'gaze:setEnabled',
  GET_LATEST_SAMPLE: 'gaze:getLatestSample',
  GET_CALIBRATION_STATE: 'gaze:getCalibrationState',
  START_CALIBRATION: 'gaze:startCalibration',
  CANCEL_CALIBRATION: 'gaze:cancelCalibration',
  RESET_EYE_TRACKING_DATA: 'gaze:resetEyeTrackingData',
  APPLY_MANUAL_CORRECTION: 'gaze:applyManualCorrection',
  GET_FOCUS_CONFIG: 'gaze:getFocusConfig',
  SET_FOCUS_CONFIG: 'gaze:setFocusConfig',
  GET_DEBUG_OVERLAY_STATE: 'gaze:getDebugOverlayState',
  SET_DEBUG_OVERLAY_ENABLED: 'gaze:setDebugOverlayEnabled',
  GET_SCREEN_OVERLAY_STATE: 'gaze:getScreenOverlayState',
  SET_SCREEN_OVERLAY_ENABLED: 'gaze:setScreenOverlayEnabled',
  STATUS_CHANGED: 'gaze:statusChanged',
  SAMPLE: 'gaze:sample',
  CALIBRATION_CHANGED: 'gaze:calibrationChanged',
  DWELL_TRIGGERED: 'gaze:dwellTriggered',
  HIGHLIGHT_WINDOW: 'gaze:highlightWindow',
  DEBUG_OVERLAY_STATE_CHANGED: 'gaze:debugOverlayStateChanged',
  SCREEN_OVERLAY_STATE_CHANGED: 'gaze:screenOverlayStateChanged',
} as const;

function clampInt(value: unknown, minValue: number, maxValue: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minValue, Math.min(maxValue, Math.round(value)));
}

function clampNumber(value: unknown, minValue: number, maxValue: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minValue, Math.min(maxValue, value));
}
