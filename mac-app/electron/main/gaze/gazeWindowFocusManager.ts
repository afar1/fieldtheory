import { EventEmitter } from 'events';
import { createLogger } from '../logger';
import { NativeHelper } from '../nativeHelper';
import {
  GazeDwellEvent,
  GazeSample,
  GazeWindowBounds,
  GazeWindowFocusConfig,
  GazeWindowSnapshot,
  sanitizeGazeWindowFocusConfig,
} from '../types/gaze';
import { GazeDwellEngine } from './gazeDwellEngine';
import { GazeWindowListCache } from './gazeWindowListCache';

const log = createLogger('GazeWindowFocus');
const YAW_DISPLAY_SWITCH_THRESHOLD = 0.18;
const YAW_X_OFFSET_GAIN = 0.25;
const MAX_YAW_X_OFFSET = 0.18;

type DisplaySnapshot = {
  id: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type DisplayProvider = {
  getAllDisplays: () => DisplaySnapshot[];
  getPrimaryDisplay: () => DisplaySnapshot | null;
};

export type WindowListCacheLike = {
  start: () => void;
  stop: () => void;
  getSnapshot: () => GazeWindowSnapshot[];
  refreshNow: (reason?: string) => Promise<GazeWindowSnapshot[]>;
};

type FocusManagerOptions = {
  displayProvider?: DisplayProvider;
  windowListCache?: WindowListCacheLike;
};

export type GazeMappedSample = {
  activeDisplayId: number;
  mappedPoint: { x: number; y: number };
};

/**
 * Maps gaze samples to windows and emits action-agnostic dwell events.
 * Side effects (focus/highlight) are handled here, not in the dwell state machine.
 */
export class GazeWindowFocusManager extends EventEmitter {
  private readonly helper: NativeHelper;
  private readonly displayProvider: DisplayProvider;
  private readonly windowListCache: WindowListCacheLike;
  private readonly dwellEngine: GazeDwellEngine;
  private running = false;
  private referenceDisplayId: number | null = null;

  constructor(
    helper: NativeHelper,
    initialConfig: GazeWindowFocusConfig,
    options?: FocusManagerOptions
  ) {
    super();
    this.helper = helper;
    this.displayProvider = options?.displayProvider ?? createElectronDisplayProvider();
    this.windowListCache = options?.windowListCache ?? new GazeWindowListCache(helper);
    this.dwellEngine = new GazeDwellEngine(sanitizeGazeWindowFocusConfig(initialConfig));
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    this.windowListCache.start();
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.windowListCache.stop();
    this.dwellEngine.reset();
  }

  destroy(): void {
    this.stop();
    this.removeAllListeners();
  }

  getConfig(): GazeWindowFocusConfig {
    return this.dwellEngine.getConfig();
  }

  setConfig(config: Partial<GazeWindowFocusConfig>): GazeWindowFocusConfig {
    return this.dwellEngine.setConfig(config);
  }

  noteScreenParametersChanged(): void {
    this.referenceDisplayId = null;
    this.dwellEngine.reset();
    void this.windowListCache.refreshNow('screen-parameters-changed');
  }

  noteActiveSpaceChanged(): void {
    this.dwellEngine.reset();
    void this.windowListCache.refreshNow('active-space-changed');
  }

  processSample(sample: GazeSample): GazeMappedSample | null {
    if (!this.running) {
      return null;
    }

    const mapped = this.mapSampleToPoint(sample);
    if (!mapped) {
      this.dwellEngine.evaluate({
        timestampMs: sample.timestampMs,
        confidence: sample.confidence,
        gazePoint: { x: 0, y: 0 },
        activeDisplayId: -1,
        window: null,
      });
      return null;
    }

    const windows = this.windowListCache.getSnapshot();
    const candidateWindow = this.resolveTargetWindow(windows, mapped.point, this.getConfig().deadZonePx);

    const event = this.dwellEngine.evaluate({
      timestampMs: sample.timestampMs,
      confidence: sample.confidence,
      gazePoint: mapped.point,
      activeDisplayId: mapped.displayId,
      window: candidateWindow,
    });

    if (!event) {
      return {
        activeDisplayId: mapped.displayId,
        mappedPoint: { ...mapped.point },
      };
    }

    this.emit('dwellTriggered', cloneDwellEvent(event));
    this.handleAction(event);
    return {
      activeDisplayId: mapped.displayId,
      mappedPoint: { ...mapped.point },
    };
  }

  private mapSampleToPoint(sample: GazeSample): { point: { x: number; y: number }; displayId: number } | null {
    const displays = this.getSortedDisplays();
    if (displays.length === 0) {
      return null;
    }

    const referenceDisplay = this.resolveReferenceDisplay(displays);
    const referenceIndex = displays.findIndex((display) => display.id === referenceDisplay.id);
    const yawDirection = sample.headPose.yaw > YAW_DISPLAY_SWITCH_THRESHOLD
      ? 1
      : sample.headPose.yaw < -YAW_DISPLAY_SWITCH_THRESHOLD
        ? -1
        : 0;
    const targetIndex = clampInt(referenceIndex + yawDirection, 0, displays.length - 1);
    const targetDisplay = displays[targetIndex];

    const source = sample.calibrationApplied ? sample.calibratedCombinedEye : sample.combinedEye;
    const yawCorrection = targetDisplay.id === referenceDisplay.id
      ? 0
      : clamp(sample.headPose.yaw * YAW_X_OFFSET_GAIN, -MAX_YAW_X_OFFSET, MAX_YAW_X_OFFSET);
    const normalizedX = clamp(source.x + yawCorrection, 0, 1);
    const normalizedY = clamp(source.y, 0, 1);

    return {
      displayId: targetDisplay.id,
      point: {
        x: targetDisplay.bounds.x + (normalizedX * targetDisplay.bounds.width),
        y: targetDisplay.bounds.y + (normalizedY * targetDisplay.bounds.height),
      },
    };
  }

  private resolveTargetWindow(
    windows: GazeWindowSnapshot[],
    point: { x: number; y: number },
    deadZonePx: number
  ): GazeWindowSnapshot | null {
    for (const window of windows) {
      if (!containsPoint(window.bounds, point)) {
        continue;
      }
      if (isWithinEdgeDeadZone(window.bounds, point, deadZonePx)) {
        return null;
      }
      return cloneWindow(window);
    }
    return null;
  }

  private handleAction(event: GazeDwellEvent): void {
    switch (event.action) {
      case 'eventOnly':
        return;
      case 'highlightBorder':
        this.emit('highlightWindow', cloneWindow(event.window));
        return;
      case 'bringToFront':
        void this.bringWindowToFront(event.window);
        return;
      default:
        return;
    }
  }

  private async bringWindowToFront(window: GazeWindowSnapshot): Promise<void> {
    if (!window.ownerBundleId || !window.title) {
      return;
    }
    if (window.ownerPID === process.pid) {
      return;
    }

    try {
      const result = await this.helper.focusWindowByTitle(window.ownerBundleId, window.title);
      if (!result.success && result.error) {
        log.debug('Window focus request failed: %s', result.error);
      }
    } catch (error) {
      log.warn('Failed to bring window to front:', error);
    }
  }

  private getSortedDisplays(): DisplaySnapshot[] {
    const displays = this.displayProvider
      .getAllDisplays()
      .filter((display) => display.bounds.width > 0 && display.bounds.height > 0);

    return displays.sort((a, b) => {
      if (a.bounds.x !== b.bounds.x) return a.bounds.x - b.bounds.x;
      return a.bounds.y - b.bounds.y;
    });
  }

  private resolveReferenceDisplay(displays: DisplaySnapshot[]): DisplaySnapshot {
    if (this.referenceDisplayId !== null) {
      const existing = displays.find((display) => display.id === this.referenceDisplayId);
      if (existing) {
        return existing;
      }
    }

    const primary = this.displayProvider.getPrimaryDisplay();
    if (primary) {
      const inList = displays.find((display) => display.id === primary.id);
      if (inList) {
        this.referenceDisplayId = inList.id;
        return inList;
      }
    }

    this.referenceDisplayId = displays[0].id;
    return displays[0];
  }
}

function createElectronDisplayProvider(): DisplayProvider {
  // Keep this dynamic so tests can run without an initialized Electron app object.
  const electron = require('electron') as Partial<typeof import('electron')>;
  const screenApi = electron.screen;
  return {
    getAllDisplays: () => {
      if (!screenApi?.getAllDisplays) {
        return [];
      }
      return screenApi.getAllDisplays().map((display) => ({
        id: display.id,
        bounds: {
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height,
        },
      }));
    },
    getPrimaryDisplay: () => {
      if (!screenApi?.getPrimaryDisplay) {
        return null;
      }
      const display = screenApi.getPrimaryDisplay();
      if (!display) {
        return null;
      }
      return {
        id: display.id,
        bounds: {
          x: display.bounds.x,
          y: display.bounds.y,
          width: display.bounds.width,
          height: display.bounds.height,
        },
      };
    },
  };
}

function containsPoint(bounds: GazeWindowBounds, point: { x: number; y: number }): boolean {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

function isWithinEdgeDeadZone(
  bounds: GazeWindowBounds,
  point: { x: number; y: number },
  deadZonePx: number
): boolean {
  const left = point.x - bounds.x;
  const right = (bounds.x + bounds.width) - point.x;
  const top = point.y - bounds.y;
  const bottom = (bounds.y + bounds.height) - point.y;
  const nearestEdge = Math.min(left, right, top, bottom);
  return nearestEdge < deadZonePx;
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

function cloneDwellEvent(event: GazeDwellEvent): GazeDwellEvent {
  return {
    timestampMs: event.timestampMs,
    confidence: event.confidence,
    stability: event.stability,
    gazePoint: { ...event.gazePoint },
    activeDisplayId: event.activeDisplayId,
    window: cloneWindow(event.window),
    action: event.action,
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
