import {
  GazeCalibrationAccuracy,
  GazeCalibrationPointId,
  GazeCalibrationPointSample,
  GazeCalibrationState,
  GazePersonalOffsets,
  NormalizedEyePosition,
} from '../types/gaze';

type CalibrationFrame = {
  timestampMs: number;
  leftEye: NormalizedEyePosition;
  rightEye: NormalizedEyePosition;
  combinedEye: NormalizedEyePosition;
  faceSize: number;
};

type CalibrationTarget = {
  id: GazeCalibrationPointId;
  target: NormalizedEyePosition;
};

type InternalCalibrationPointSample = GazeCalibrationPointSample & {
  faceSize: number;
  timestampMs: number;
};

const CALIBRATION_POINTS: CalibrationTarget[] = [
  { id: 'center', target: { x: 0.5, y: 0.5 } },
  { id: 'topLeft', target: { x: 0.2, y: 0.2 } },
  { id: 'topRight', target: { x: 0.8, y: 0.2 } },
  { id: 'bottomLeft', target: { x: 0.2, y: 0.8 } },
  { id: 'bottomRight', target: { x: 0.8, y: 0.8 } },
];

const STABILITY_WINDOW_MS = 900;
const STABILITY_REQUIRED_MS = 600;
const STABILITY_VARIANCE_THRESHOLD = 0.0008;
const MIN_STABILITY_SAMPLES = 6;
const MANUAL_CORRECTION_GAIN = 0.35;
const MIN_ABS_AXIS_GAIN = 0.45;
const MAX_ABS_AXIS_GAIN = 3.2;

const DEFAULT_CALIBRATION_STATE: Omit<
  GazeCalibrationState,
  'personalOffsets' | 'lastCalibratedAtMs'
> = {
  active: false,
  currentPointId: null,
  currentPointIndex: 0,
  totalPoints: CALIBRATION_POINTS.length,
  stableForMs: 0,
  currentVariance: 0,
  samplesCollected: 0,
  manualCorrectionCount: 0,
  collectedPoints: [],
  accuracy: null,
  needsRecalibrationPrompt: false,
  recalibrationReason: null,
};

export function sanitizeGazePersonalOffsets(input: unknown): GazePersonalOffsets | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const offsets = input as Partial<GazePersonalOffsets>;
  if (offsets.version !== 1) {
    return null;
  }

  if (
    typeof offsets.horizontalOffset !== 'number' ||
    typeof offsets.verticalOffset !== 'number' ||
    typeof offsets.eyeDominance !== 'number' ||
    typeof offsets.referenceFaceSize !== 'number' ||
    typeof offsets.updatedAtMs !== 'number'
  ) {
    return null;
  }

  const normalizedHorizontalGain = normalizeAxisGain(offsets.horizontalGain);
  const normalizedVerticalGain = normalizeAxisGain(offsets.verticalGain);
  const looksLikeLegacyCollapsedGains =
    Math.abs(normalizedHorizontalGain) === MIN_ABS_AXIS_GAIN &&
    Math.abs(normalizedVerticalGain) === MIN_ABS_AXIS_GAIN;

  return {
    version: 1,
    horizontalOffset: clamp(offsets.horizontalOffset, -0.6, 0.6),
    verticalOffset: clamp(offsets.verticalOffset, -0.6, 0.6),
    horizontalGain: looksLikeLegacyCollapsedGains ? 1 : normalizedHorizontalGain,
    verticalGain: looksLikeLegacyCollapsedGains ? 1 : normalizedVerticalGain,
    eyeDominance: clamp(offsets.eyeDominance, 0, 1),
    referenceFaceSize: clamp(offsets.referenceFaceSize, 0.000001, 10),
    updatedAtMs: offsets.updatedAtMs,
  };
}

export class GazeCalibrationEngine {
  private personalOffsets: GazePersonalOffsets | null;
  private lastCalibratedAtMs: number | null;
  private active = false;
  private currentPointIndex = 0;
  private stableForMs = 0;
  private currentVariance = 0;
  private framesWindow: CalibrationFrame[] = [];
  private collectedSamples: InternalCalibrationPointSample[] = [];
  private manualCorrectionCount = 0;
  private accuracy: GazeCalibrationAccuracy | null = null;
  private needsRecalibrationPrompt = false;
  private recalibrationReason: string | null = null;

  constructor(initialOffsets: GazePersonalOffsets | null, lastCalibratedAtMs: number | null) {
    const sanitized = sanitizeGazePersonalOffsets(initialOffsets);
    const sanitizedOffsetTimestamp = sanitizePersistedTimestampMs(sanitized?.updatedAtMs);
    const sanitizedLastCalibratedAtMs = sanitizePersistedTimestampMs(lastCalibratedAtMs);
    this.personalOffsets = sanitized
      ? {
        ...sanitized,
        updatedAtMs: sanitizedOffsetTimestamp ?? Date.now(),
      }
      : null;
    this.lastCalibratedAtMs = sanitizedOffsetTimestamp ?? sanitizedLastCalibratedAtMs ?? null;
  }

  replacePersonalOffsets(initialOffsets: GazePersonalOffsets | null, lastCalibratedAtMs: number | null): void {
    const sanitized = sanitizeGazePersonalOffsets(initialOffsets);
    const sanitizedOffsetTimestamp = sanitizePersistedTimestampMs(sanitized?.updatedAtMs);
    const sanitizedLastCalibratedAtMs = sanitizePersistedTimestampMs(lastCalibratedAtMs);
    this.personalOffsets = sanitized
      ? {
        ...sanitized,
        updatedAtMs: sanitizedOffsetTimestamp ?? Date.now(),
      }
      : null;
    this.lastCalibratedAtMs = sanitizedOffsetTimestamp ?? sanitizedLastCalibratedAtMs ?? null;
    this.accuracy = null;
    this.active = false;
    this.currentPointIndex = 0;
    this.stableForMs = 0;
    this.currentVariance = 0;
    this.framesWindow = [];
    this.collectedSamples = [];
    this.manualCorrectionCount = 0;
  }

  getPersonalOffsets(): GazePersonalOffsets | null {
    return this.personalOffsets ? { ...this.personalOffsets } : null;
  }

  resetPersonalOffsets(): void {
    this.personalOffsets = null;
    this.lastCalibratedAtMs = null;
    this.accuracy = null;
    this.active = false;
    this.currentPointIndex = 0;
    this.stableForMs = 0;
    this.currentVariance = 0;
    this.framesWindow = [];
    this.collectedSamples = [];
    this.manualCorrectionCount = 0;
    this.needsRecalibrationPrompt = false;
    this.recalibrationReason = null;
  }

  startCalibration(): void {
    this.active = true;
    this.currentPointIndex = 0;
    this.stableForMs = 0;
    this.currentVariance = 0;
    this.framesWindow = [];
    this.collectedSamples = [];
    this.accuracy = null;
    this.manualCorrectionCount = 0;
    this.needsRecalibrationPrompt = false;
    this.recalibrationReason = null;
  }

  cancelCalibration(): void {
    this.active = false;
    this.currentPointIndex = 0;
    this.stableForMs = 0;
    this.currentVariance = 0;
    this.framesWindow = [];
    this.collectedSamples = [];
  }

  markNeedsRecalibration(reason: string): void {
    this.needsRecalibrationPrompt = true;
    this.recalibrationReason = reason;
  }

  clearRecalibrationPrompt(): void {
    this.needsRecalibrationPrompt = false;
    this.recalibrationReason = null;
  }

  applyOffsets(
    leftEye: NormalizedEyePosition,
    rightEye: NormalizedEyePosition,
    fallbackCombined: NormalizedEyePosition
  ): { calibratedCombinedEye: NormalizedEyePosition; calibrationApplied: boolean } {
    if (!this.personalOffsets) {
      return {
        calibratedCombinedEye: { ...fallbackCombined },
        calibrationApplied: false,
      };
    }

    const leftWeight = this.personalOffsets.eyeDominance;
    const rightWeight = 1 - leftWeight;

    const weightedX = (leftEye.x * leftWeight) + (rightEye.x * rightWeight);
    const weightedY = (leftEye.y * leftWeight) + (rightEye.y * rightWeight);

    return {
      calibratedCombinedEye: {
        x: clamp(
          ((weightedX - 0.5) * this.personalOffsets.horizontalGain) +
            0.5 +
            this.personalOffsets.horizontalOffset,
          0,
          1
        ),
        y: clamp(
          ((weightedY - 0.5) * this.personalOffsets.verticalGain) +
            0.5 +
            this.personalOffsets.verticalOffset,
          0,
          1
        ),
      },
      calibrationApplied: true,
    };
  }

  applyManualCorrection(params: {
    target: NormalizedEyePosition;
    observedLeft: NormalizedEyePosition;
    observedRight: NormalizedEyePosition;
    observedCombined: NormalizedEyePosition;
    faceSize: number;
    timestampMs: number;
    gain?: number;
  }): GazePersonalOffsets {
    const gain = clamp(params.gain ?? MANUAL_CORRECTION_GAIN, 0.05, 1.0);
    const clampedTarget: NormalizedEyePosition = {
      x: clamp(params.target.x, 0, 1),
      y: clamp(params.target.y, 0, 1),
    };
    const clampedFaceSize = clamp(params.faceSize, 0.000001, 10);

    if (!this.personalOffsets) {
      this.personalOffsets = {
        version: 1,
        horizontalOffset: 0,
        verticalOffset: 0,
        horizontalGain: 1,
        verticalGain: 1,
        eyeDominance: 0.5,
        referenceFaceSize: clampedFaceSize,
        updatedAtMs: params.timestampMs,
      };
    }

    const predicted = this.applyOffsets(
      params.observedLeft,
      params.observedRight,
      params.observedCombined
    ).calibratedCombinedEye;

    const errorX = clampedTarget.x - predicted.x;
    const errorY = clampedTarget.y - predicted.y;

    const nextHorizontalOffset = clamp(
      this.personalOffsets.horizontalOffset + (errorX * gain),
      -0.6,
      0.6
    );
    const nextVerticalOffset = clamp(
      this.personalOffsets.verticalOffset + (errorY * gain),
      -0.6,
      0.6
    );

    const leftCorrected: NormalizedEyePosition = {
      x: clamp(
        ((params.observedLeft.x - 0.5) * this.personalOffsets.horizontalGain) + 0.5 + nextHorizontalOffset,
        0,
        1
      ),
      y: clamp(
        ((params.observedLeft.y - 0.5) * this.personalOffsets.verticalGain) + 0.5 + nextVerticalOffset,
        0,
        1
      ),
    };
    const rightCorrected: NormalizedEyePosition = {
      x: clamp(
        ((params.observedRight.x - 0.5) * this.personalOffsets.horizontalGain) + 0.5 + nextHorizontalOffset,
        0,
        1
      ),
      y: clamp(
        ((params.observedRight.y - 0.5) * this.personalOffsets.verticalGain) + 0.5 + nextVerticalOffset,
        0,
        1
      ),
    };

    const leftDistance = distance(leftCorrected, clampedTarget);
    const rightDistance = distance(rightCorrected, clampedTarget);
    const desiredLeftWeight = (leftDistance + rightDistance) > 0.000001
      ? clamp(rightDistance / (leftDistance + rightDistance), 0.05, 0.95)
      : this.personalOffsets.eyeDominance;
    const nextEyeDominance = clamp(
      (this.personalOffsets.eyeDominance * 0.85) + (desiredLeftWeight * 0.15),
      0,
      1
    );

    const nextReferenceFaceSize = clamp(
      (this.personalOffsets.referenceFaceSize * 0.92) + (clampedFaceSize * 0.08),
      0.000001,
      10
    );

    this.personalOffsets = {
      version: 1,
      horizontalOffset: nextHorizontalOffset,
      verticalOffset: nextVerticalOffset,
      horizontalGain: this.personalOffsets.horizontalGain,
      verticalGain: this.personalOffsets.verticalGain,
      eyeDominance: nextEyeDominance,
      referenceFaceSize: nextReferenceFaceSize,
      updatedAtMs: params.timestampMs,
    };
    this.lastCalibratedAtMs = params.timestampMs;
    this.manualCorrectionCount += 1;
    this.needsRecalibrationPrompt = false;
    this.recalibrationReason = null;
    this.accuracy = null;

    return { ...this.personalOffsets };
  }

  onFrame(frame: CalibrationFrame): { stateChanged: boolean; completedOffsets: GazePersonalOffsets | null } {
    if (!this.active) {
      return { stateChanged: false, completedOffsets: null };
    }

    this.framesWindow.push(frame);
    const minTimestamp = frame.timestampMs - STABILITY_WINDOW_MS;
    while (this.framesWindow.length > 0 && this.framesWindow[0].timestampMs < minTimestamp) {
      this.framesWindow.shift();
    }

    if (this.framesWindow.length > 1) {
      const xVariance = variance(this.framesWindow.map((item) => item.combinedEye.x));
      const yVariance = variance(this.framesWindow.map((item) => item.combinedEye.y));
      this.currentVariance = xVariance + yVariance;
      if (this.currentVariance <= STABILITY_VARIANCE_THRESHOLD) {
        const firstTimestamp = this.framesWindow[0].timestampMs;
        const lastTimestamp = this.framesWindow[this.framesWindow.length - 1].timestampMs;
        this.stableForMs = Math.max(0, lastTimestamp - firstTimestamp);
      } else {
        this.stableForMs = 0;
      }
    } else {
      this.currentVariance = 0;
      this.stableForMs = 0;
    }

    if (
      this.stableForMs < STABILITY_REQUIRED_MS ||
      this.framesWindow.length < MIN_STABILITY_SAMPLES
    ) {
      return { stateChanged: true, completedOffsets: null };
    }

    const calibrationPoint = CALIBRATION_POINTS[this.currentPointIndex];
    const averaged = averageFrame(this.framesWindow);
    this.collectedSamples.push({
      pointId: calibrationPoint.id,
      target: { ...calibrationPoint.target },
      observedCombined: { ...averaged.combinedEye },
      observedLeft: { ...averaged.leftEye },
      observedRight: { ...averaged.rightEye },
      variance: this.currentVariance,
      faceSize: averaged.faceSize,
      timestampMs: frame.timestampMs,
    });

    this.currentPointIndex += 1;
    this.stableForMs = 0;
    this.currentVariance = 0;
    this.framesWindow = [];

    if (this.currentPointIndex < CALIBRATION_POINTS.length) {
      return { stateChanged: true, completedOffsets: null };
    }

    const completedOffsets = fitOffsets(this.collectedSamples, Date.now());
    this.personalOffsets = completedOffsets;
    this.lastCalibratedAtMs = completedOffsets.updatedAtMs;
    this.accuracy = estimateAccuracy(this.collectedSamples, completedOffsets);
    this.active = false;
    this.currentPointIndex = 0;
    this.manualCorrectionCount = 0;
    this.needsRecalibrationPrompt = false;
    this.recalibrationReason = null;

    return { stateChanged: true, completedOffsets };
  }

  getState(): GazeCalibrationState {
    return {
      ...DEFAULT_CALIBRATION_STATE,
      active: this.active,
      currentPointId: this.active ? CALIBRATION_POINTS[this.currentPointIndex]?.id ?? null : null,
      currentPointIndex: this.active ? this.currentPointIndex : 0,
      stableForMs: this.stableForMs,
      currentVariance: this.currentVariance,
      samplesCollected: this.collectedSamples.length,
      manualCorrectionCount: this.manualCorrectionCount,
      collectedPoints: this.collectedSamples.map((sample) => ({
        pointId: sample.pointId,
        target: { ...sample.target },
        observedCombined: { ...sample.observedCombined },
        observedLeft: { ...sample.observedLeft },
        observedRight: { ...sample.observedRight },
        variance: sample.variance,
      })),
      personalOffsets: this.personalOffsets ? { ...this.personalOffsets } : null,
      lastCalibratedAtMs: this.lastCalibratedAtMs,
      accuracy: this.accuracy ? { ...this.accuracy } : null,
      needsRecalibrationPrompt: this.needsRecalibrationPrompt,
      recalibrationReason: this.recalibrationReason,
    };
  }
}

function fitOffsets(samples: InternalCalibrationPointSample[], updatedAtMs: number): GazePersonalOffsets {
  const xFit = fitLinearAxis(samples, 'x');
  const yFit = fitLinearAxis(samples, 'y');

  const horizontalGain = xFit.gain;
  const verticalGain = yFit.gain;
  const horizontalOffset = xFit.offset;
  const verticalOffset = yFit.offset;

  const leftError = mean(samples.map((sample) => {
    const corrected: NormalizedEyePosition = {
      x: clamp(((sample.observedLeft.x - 0.5) * horizontalGain) + 0.5 + horizontalOffset, 0, 1),
      y: clamp(((sample.observedLeft.y - 0.5) * verticalGain) + 0.5 + verticalOffset, 0, 1),
    };
    return distance(corrected, sample.target);
  }));

  const rightError = mean(samples.map((sample) => {
    const corrected: NormalizedEyePosition = {
      x: clamp(((sample.observedRight.x - 0.5) * horizontalGain) + 0.5 + horizontalOffset, 0, 1),
      y: clamp(((sample.observedRight.y - 0.5) * verticalGain) + 0.5 + verticalOffset, 0, 1),
    };
    return distance(corrected, sample.target);
  }));

  const leftReliability = 1 / Math.max(0.000001, leftError);
  const rightReliability = 1 / Math.max(0.000001, rightError);
  const eyeDominance = clamp(
    leftReliability / (leftReliability + rightReliability),
    0,
    1
  );

  const referenceFaceSize = clamp(
    mean(samples.map((sample) => sample.faceSize)),
    0.000001,
    10
  );

  return {
    version: 1,
    horizontalOffset,
    verticalOffset,
    horizontalGain,
    verticalGain,
    eyeDominance,
    referenceFaceSize,
    updatedAtMs,
  };
}

function estimateAccuracy(
  samples: InternalCalibrationPointSample[],
  offsets: GazePersonalOffsets
): GazeCalibrationAccuracy {
  const meanError = mean(samples.map((sample) => {
    const predicted: NormalizedEyePosition = {
      x: clamp(
        ((sample.observedCombined.x - 0.5) * offsets.horizontalGain) + 0.5 + offsets.horizontalOffset,
        0,
        1
      ),
      y: clamp(
        ((sample.observedCombined.y - 0.5) * offsets.verticalGain) + 0.5 + offsets.verticalOffset,
        0,
        1
      ),
    };
    return distance(predicted, sample.target);
  }));

  const estimatedErrorPx = Math.round(meanError * 1100);
  const label: GazeCalibrationAccuracy['label'] =
    meanError <= 0.045 ? 'good' : (meanError <= 0.085 ? 'fair' : 'poor');

  const message =
    label === 'good'
      ? `Accuracy: good - estimated within ${estimatedErrorPx}px at this distance`
      : (label === 'fair'
        ? `Accuracy: fair - estimated within ${estimatedErrorPx}px at this distance`
        : `Accuracy: needs improvement - estimated within ${estimatedErrorPx}px at this distance`);

  return {
    label,
    meanError,
    estimatedErrorPx,
    message,
  };
}

function averageFrame(frames: CalibrationFrame[]): CalibrationFrame {
  return {
    timestampMs: frames[frames.length - 1]?.timestampMs ?? Date.now(),
    leftEye: {
      x: mean(frames.map((frame) => frame.leftEye.x)),
      y: mean(frames.map((frame) => frame.leftEye.y)),
    },
    rightEye: {
      x: mean(frames.map((frame) => frame.rightEye.x)),
      y: mean(frames.map((frame) => frame.rightEye.y)),
    },
    combinedEye: {
      x: mean(frames.map((frame) => frame.combinedEye.x)),
      y: mean(frames.map((frame) => frame.combinedEye.y)),
    },
    faceSize: mean(frames.map((frame) => frame.faceSize)),
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

function variance(values: number[]): number {
  if (values.length <= 1) return 0;
  const avg = mean(values);
  return mean(values.map((value) => (value - avg) ** 2));
}

function distance(a: NormalizedEyePosition, b: NormalizedEyePosition): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.max(minValue, Math.min(maxValue, value));
}

function fitLinearAxis(
  samples: InternalCalibrationPointSample[],
  axis: 'x' | 'y'
): { gain: number; offset: number } {
  const observed = samples.map((sample) => sample.observedCombined[axis]);
  const target = samples.map((sample) => sample.target[axis]);
  const observedMean = mean(observed);
  const targetMean = mean(target);

  const variance = mean(observed.map((value) => {
    const delta = value - observedMean;
    return delta * delta;
  }));

  const covariance = mean(samples.map((sample) => {
    const observedDelta = sample.observedCombined[axis] - observedMean;
    const targetDelta = sample.target[axis] - targetMean;
    return observedDelta * targetDelta;
  }));

  const rawGain = variance > 0.000001 ? (covariance / variance) : 1;
  const observedSpan = (Math.max(...observed) - Math.min(...observed));
  const gain = observedSpan < 0.035
    ? normalizeAxisGain(2.2 * Math.sign(covariance || 1))
    : normalizeAxisGain(rawGain);
  const offset = clamp(
    targetMean - (((observedMean - 0.5) * gain) + 0.5),
    -0.6,
    0.6
  );

  return { gain, offset };
}

function sanitizePersistedTimestampMs(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  let candidate = value;
  // Some older persisted values were in seconds.
  if (candidate > 1_000_000_000 && candidate < 100_000_000_000) {
    candidate *= 1000;
  }

  const nowMs = Date.now();
  const minMs = Date.UTC(2000, 0, 1);
  const maxMs = nowMs + (24 * 60 * 60 * 1000);
  if (candidate < minMs || candidate > maxMs) {
    return null;
  }

  return Math.round(candidate);
}

function normalizeAxisGain(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    return 1;
  }

  const sign = input < 0 ? -1 : 1;
  const magnitude = Math.abs(input);
  if (magnitude < 0.2) {
    return 1;
  }
  if (magnitude < MIN_ABS_AXIS_GAIN) {
    return sign * MIN_ABS_AXIS_GAIN;
  }
  return sign * clamp(magnitude, MIN_ABS_AXIS_GAIN, MAX_ABS_AXIS_GAIN);
}
