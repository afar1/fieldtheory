export type GazeTrackingHealthLevel = 'ok' | 'warning' | 'error';

export interface GazeTrackingStatusSnapshot {
  enabled: boolean;
  running: boolean;
  cameraAuthorized: boolean;
  reason: string | null;
  lastSampleAtMs: number | null;
}

export interface GazeCalibrationSnapshot {
  lastCalibratedAtMs: number | null;
}

export interface GazeSampleSnapshot {
  timestampMs: number;
  receivedAtMs?: number;
  confidence: number;
  calibrationApplied: boolean;
  activeDisplayId?: number | null;
  mappedScreenPoint?: { x: number; y: number } | null;
  landmarks?: unknown | null;
}

export interface GazeTrackingHealthSummary {
  level: GazeTrackingHealthLevel;
  headline: string;
  reasons: string[];
  sampleRateHz: number | null;
  sampleAgeMs: number | null;
  averageConfidence: number | null;
  landmarkRate: number | null;
  calibrationAgeMinutes: number | null;
  mappedPointAvailable: boolean;
}

export interface GazeTrackingHealthInput {
  status: GazeTrackingStatusSnapshot | null;
  calibration: GazeCalibrationSnapshot | null;
  latestSample: GazeSampleSnapshot | null;
  recentSamples: GazeSampleSnapshot[];
  nowMs?: number;
}

const RECENT_WINDOW_MS = 5000;
const STALE_WARNING_MS = 1200;
const STALE_ERROR_MS = 3500;
const LOW_FPS_WARNING = 10;
const LOW_FPS_ERROR = 6;
const LOW_CONFIDENCE_WARNING = 0.6;
const LOW_CONFIDENCE_ERROR = 0.4;
const LOW_LANDMARK_WARNING = 0.8;
const LOW_LANDMARK_ERROR = 0.5;

export function summarizeGazeTrackingHealth(input: GazeTrackingHealthInput): GazeTrackingHealthSummary {
  const nowMs = Number.isFinite(input.nowMs) ? Math.round(input.nowMs as number) : Date.now();
  const status = input.status;
  const calibration = input.calibration;
  const latestSample = input.latestSample;
  const recentSamples = selectRecentSamples(input.recentSamples, RECENT_WINDOW_MS);
  const hasRecentSamples = recentSamples.length > 0;

  const sampleRateHz = computeSampleRateHz(recentSamples);
  const averageConfidence = computeAverageConfidence(recentSamples);
  const landmarkRate = computeLandmarkRate(recentSamples);
  let sampleAgeMs = status?.lastSampleAtMs ? Math.max(0, nowMs - status.lastSampleAtMs) : null;
  if (sampleAgeMs === null && hasRecentSamples) {
    const lastObservedAtMs = sampleObservedAtMs(recentSamples[recentSamples.length - 1]);
    sampleAgeMs = isPlausibleEpochMs(lastObservedAtMs, nowMs)
      ? Math.max(0, nowMs - lastObservedAtMs)
      : 0;
  }
  const calibrationAgeMinutes = calibration?.lastCalibratedAtMs
    ? Math.max(0, Math.floor((nowMs - calibration.lastCalibratedAtMs) / 60000))
    : null;
  const mappedPointAvailable = !!latestSample?.mappedScreenPoint;

  const reasons: string[] = [];
  let level: GazeTrackingHealthLevel = 'ok';

  const addIssue = (nextLevel: GazeTrackingHealthLevel, reason: string) => {
    reasons.push(reason);
    if (level === 'error') return;
    if (nextLevel === 'error') {
      level = 'error';
      return;
    }
    if (nextLevel === 'warning' && level === 'ok') {
      level = 'warning';
    }
  };

  if (!status) {
    addIssue('error', 'Tracking status is unavailable.');
  } else {
    if (!status.enabled) {
      addIssue('warning', 'Eye tracking is turned off.');
    }

    if (!status.cameraAuthorized) {
      addIssue('error', 'Camera permission is denied.');
    }

    if (status.enabled && !status.running) {
      addIssue('error', `Tracking is not running${status.reason ? `: ${status.reason}` : '.'}`);
    }

    if (status.enabled && status.running) {
      if (sampleAgeMs === null) {
        if (!hasRecentSamples && !latestSample) {
          addIssue('warning', 'No gaze samples received yet.');
        }
      } else if (sampleAgeMs > STALE_ERROR_MS) {
        addIssue('error', `No gaze sample received for ${Math.round(sampleAgeMs / 1000)}s.`);
      } else if (sampleAgeMs > STALE_WARNING_MS) {
        addIssue('warning', 'Gaze sample stream is stale.');
      }

      if (sampleRateHz !== null) {
        if (sampleRateHz < LOW_FPS_ERROR) {
          addIssue('error', `Sample rate is very low (${sampleRateHz.toFixed(1)}fps).`);
        } else if (sampleRateHz < LOW_FPS_WARNING) {
          addIssue('warning', `Sample rate is below target (${sampleRateHz.toFixed(1)}fps).`);
        }
      }

      if (averageConfidence !== null) {
        if (averageConfidence < LOW_CONFIDENCE_ERROR) {
          addIssue('error', `Eye confidence is too low (${averageConfidence.toFixed(2)}).`);
        } else if (averageConfidence < LOW_CONFIDENCE_WARNING) {
          addIssue('warning', `Eye confidence is unstable (${averageConfidence.toFixed(2)}).`);
        }
      }

      if (landmarkRate !== null) {
        if (landmarkRate < LOW_LANDMARK_ERROR) {
          addIssue('error', `Eye landmarks are often missing (${Math.round(landmarkRate * 100)}%).`);
        } else if (landmarkRate < LOW_LANDMARK_WARNING) {
          addIssue('warning', `Eye landmarks are intermittent (${Math.round(landmarkRate * 100)}%).`);
        }
      }

      if (latestSample && !latestSample.calibrationApplied) {
        addIssue('warning', 'Calibration offsets are not applied.');
      }

      if (latestSample && !latestSample.mappedScreenPoint) {
        addIssue('warning', 'Gaze point is not mapped to screen coordinates.');
      }

      if (latestSample && (latestSample.activeDisplayId === null || latestSample.activeDisplayId === undefined)) {
        addIssue('warning', 'Active display could not be resolved.');
      }
    }
  }

  if (calibrationAgeMinutes === null) {
    addIssue('warning', 'Calibration has not been completed.');
  } else if (calibrationAgeMinutes > 8 * 60) {
    addIssue('warning', 'Calibration is older than 8 hours.');
  }

  const headline = buildHeadline(level, reasons);
  return {
    level,
    headline,
    reasons,
    sampleRateHz,
    sampleAgeMs,
    averageConfidence,
    landmarkRate,
    calibrationAgeMinutes,
    mappedPointAvailable,
  };
}

function buildHeadline(level: GazeTrackingHealthLevel, reasons: string[]): string {
  if (level === 'ok') {
    return 'Tracking healthy';
  }
  if (reasons.length > 0) {
    return reasons[0];
  }
  return level === 'error' ? 'Tracking needs attention' : 'Tracking may be degraded';
}

function selectRecentSamples(
  samples: GazeSampleSnapshot[],
  windowMs: number
): GazeSampleSnapshot[] {
  const sorted = samples
    .filter((sample) => Number.isFinite(sampleObservedAtMs(sample)))
    .sort((a, b) => sampleObservedAtMs(a) - sampleObservedAtMs(b));
  if (sorted.length === 0) {
    return [];
  }
  const anchorTs = sampleObservedAtMs(sorted[sorted.length - 1]);
  const minTs = anchorTs - windowMs;
  return sorted.filter((sample) => {
    const observedAt = sampleObservedAtMs(sample);
    return observedAt >= minTs && observedAt <= anchorTs;
  });
}

function computeSampleRateHz(samples: GazeSampleSnapshot[]): number | null {
  if (samples.length < 2) {
    return null;
  }
  const first = sampleObservedAtMs(samples[0]);
  const last = sampleObservedAtMs(samples[samples.length - 1]);
  const elapsedSec = (last - first) / 1000;
  if (!Number.isFinite(elapsedSec) || elapsedSec <= 0) {
    return null;
  }
  return (samples.length - 1) / elapsedSec;
}

function computeAverageConfidence(samples: GazeSampleSnapshot[]): number | null {
  if (samples.length === 0) {
    return null;
  }
  const confidences = samples
    .map((sample) => sample.confidence)
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.max(0, Math.min(1, value)));
  if (confidences.length === 0) {
    return null;
  }
  const total = confidences.reduce((sum, value) => sum + value, 0);
  return total / confidences.length;
}

function computeLandmarkRate(samples: GazeSampleSnapshot[]): number | null {
  if (samples.length === 0) {
    return null;
  }
  const anyLandmarkTelemetry = samples.some((sample) => sample.landmarks !== undefined && sample.landmarks !== null);
  if (!anyLandmarkTelemetry) {
    return null;
  }
  const withLandmarks = samples.filter((sample) => !!sample.landmarks).length;
  return withLandmarks / samples.length;
}

function sampleObservedAtMs(sample: GazeSampleSnapshot): number {
  if (typeof sample.receivedAtMs === 'number' && Number.isFinite(sample.receivedAtMs)) {
    return sample.receivedAtMs;
  }
  return sample.timestampMs;
}

function isPlausibleEpochMs(value: number, nowMs: number): boolean {
  if (!Number.isFinite(value)) {
    return false;
  }
  const minMs = Date.UTC(2000, 0, 1);
  const maxMs = nowMs + (24 * 60 * 60 * 1000);
  return value >= minMs && value <= maxMs;
}
