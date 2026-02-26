import {
  GazeDwellEvent,
  GazeWindowFocusConfig,
  GazeWindowSnapshot,
  sanitizeGazeWindowFocusConfig,
} from '../types/gaze';

type DwellInput = {
  timestampMs: number;
  confidence: number;
  gazePoint: { x: number; y: number };
  activeDisplayId: number;
  window: GazeWindowSnapshot | null;
};

type DwellSample = {
  timestampMs: number;
  confidence: number;
  x: number;
  y: number;
};

const MIN_STABILITY_WINDOW_MS = 240;
const MAX_STABILITY_WINDOW_MS = 1000;
const STABILITY_STDDEV_LIMIT_PX = 140;

/**
 * Stateless-from-the-outside dwell detector.
 * It tracks continuity/stability and emits a dwell event when configured criteria are met.
 */
export class GazeDwellEngine {
  private config: GazeWindowFocusConfig;
  private activeWindowId: number | null = null;
  private enteredAtMs: number | null = null;
  private samples: DwellSample[] = [];
  private readonly lastTriggeredByWindow = new Map<number, number>();

  constructor(config: GazeWindowFocusConfig) {
    this.config = sanitizeGazeWindowFocusConfig(config);
  }

  getConfig(): GazeWindowFocusConfig {
    return { ...this.config };
  }

  setConfig(config: Partial<GazeWindowFocusConfig>): GazeWindowFocusConfig {
    const merged = sanitizeGazeWindowFocusConfig({ ...this.config, ...config });
    this.config = merged;
    this.resetCurrentWindow();
    return { ...this.config };
  }

  reset(): void {
    this.resetCurrentWindow();
    this.lastTriggeredByWindow.clear();
  }

  evaluate(input: DwellInput): GazeDwellEvent | null {
    const window = input.window;
    if (!window) {
      this.resetCurrentWindow();
      return null;
    }

    if (this.activeWindowId !== window.windowId) {
      this.activeWindowId = window.windowId;
      this.enteredAtMs = input.timestampMs;
      this.samples = [];
    }

    if (this.enteredAtMs === null) {
      this.enteredAtMs = input.timestampMs;
    }

    this.samples.push({
      timestampMs: input.timestampMs,
      confidence: clamp(input.confidence, 0, 1),
      x: input.gazePoint.x,
      y: input.gazePoint.y,
    });

    const stabilityWindowMs = clampInt(
      Math.round(this.config.dwellDurationMs * 1.25),
      MIN_STABILITY_WINDOW_MS,
      MAX_STABILITY_WINDOW_MS
    );
    const minTimestamp = input.timestampMs - stabilityWindowMs;
    while (this.samples.length > 0 && this.samples[0].timestampMs < minTimestamp) {
      this.samples.shift();
    }

    const dwellElapsedMs = Math.max(0, input.timestampMs - this.enteredAtMs);
    if (dwellElapsedMs < this.config.dwellDurationMs) {
      return null;
    }

    const confidence = mean(this.samples.map((sample) => sample.confidence));
    const stability = estimateStability(this.samples);
    if (confidence < this.config.confidenceThreshold || stability < this.config.confidenceThreshold) {
      return null;
    }

    const lastTriggeredAtMs = this.lastTriggeredByWindow.get(window.windowId);
    if (typeof lastTriggeredAtMs === 'number' && (input.timestampMs - lastTriggeredAtMs) < this.config.cooldownMs) {
      return null;
    }

    this.lastTriggeredByWindow.set(window.windowId, input.timestampMs);
    this.enteredAtMs = input.timestampMs;
    this.samples = this.samples.slice(-1);

    return {
      timestampMs: input.timestampMs,
      confidence,
      stability,
      gazePoint: {
        x: input.gazePoint.x,
        y: input.gazePoint.y,
      },
      activeDisplayId: input.activeDisplayId,
      window: cloneWindow(window),
      action: this.config.dwellAction,
    };
  }

  private resetCurrentWindow(): void {
    this.activeWindowId = null;
    this.enteredAtMs = null;
    this.samples = [];
  }
}

function estimateStability(samples: DwellSample[]): number {
  if (samples.length <= 1) {
    return 0;
  }

  const meanX = mean(samples.map((sample) => sample.x));
  const meanY = mean(samples.map((sample) => sample.y));
  const varianceX = mean(samples.map((sample) => (sample.x - meanX) ** 2));
  const varianceY = mean(samples.map((sample) => (sample.y - meanY) ** 2));
  const stdDevPx = Math.sqrt((varianceX + varianceY) * 0.5);

  return clamp(1 - (stdDevPx / STABILITY_STDDEV_LIMIT_PX), 0, 1);
}

function mean(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

function cloneWindow(window: GazeWindowSnapshot): GazeWindowSnapshot {
  return {
    windowId: window.windowId,
    ownerName: window.ownerName,
    ownerBundleId: window.ownerBundleId,
    ownerPID: window.ownerPID,
    title: window.title,
    bounds: { ...window.bounds },
    layer: window.layer,
  };
}

function clamp(value: number, minValue: number, maxValue: number): number {
  if (!Number.isFinite(value)) {
    return minValue;
  }
  return Math.max(minValue, Math.min(maxValue, value));
}

function clampInt(value: number, minValue: number, maxValue: number): number {
  if (!Number.isFinite(value)) {
    return minValue;
  }
  const rounded = Math.round(value);
  return Math.max(minValue, Math.min(maxValue, rounded));
}
