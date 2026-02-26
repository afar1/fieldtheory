import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_GAZE_DWELL_CONFIG, GazeSample, GazeWindowSnapshot } from '../types/gaze';
import { DisplayProvider, GazeWindowFocusManager, WindowListCacheLike } from './gazeWindowFocusManager';

const DISPLAY_SINGLE = {
  id: 1,
  bounds: { x: 0, y: 0, width: 1000, height: 800 },
};

const DISPLAY_RIGHT = {
  id: 2,
  bounds: { x: 1000, y: 0, width: 1000, height: 800 },
};

const WINDOW_CENTER: GazeWindowSnapshot = {
  windowId: 111,
  ownerName: 'Terminal',
  ownerBundleId: 'com.apple.Terminal',
  ownerPID: 4321,
  title: 'project-shell',
  bounds: { x: 80, y: 70, width: 840, height: 620 },
  layer: 0,
};

const WINDOW_RIGHT: GazeWindowSnapshot = {
  ...WINDOW_CENTER,
  windowId: 222,
  title: 'right-display-shell',
  bounds: { x: 1100, y: 80, width: 820, height: 620 },
};

class FakeWindowListCache implements WindowListCacheLike {
  windows: GazeWindowSnapshot[] = [];
  start = vi.fn();
  stop = vi.fn();

  getSnapshot(): GazeWindowSnapshot[] {
    return this.windows.map((window) => ({ ...window, bounds: { ...window.bounds } }));
  }

  async refreshNow(): Promise<GazeWindowSnapshot[]> {
    return this.getSnapshot();
  }
}

class FakeHelper {
  focusWindowByTitle = vi.fn(async () => ({ success: true }));
}

function createSample(input: {
  timestampMs: number;
  x: number;
  y: number;
  yaw?: number;
  confidence?: number;
}): GazeSample {
  return {
    timestampMs: input.timestampMs,
    confidence: input.confidence ?? 0.9,
    leftEye: { x: input.x, y: input.y },
    rightEye: { x: input.x, y: input.y },
    combinedEye: { x: input.x, y: input.y },
    calibratedCombinedEye: { x: input.x, y: input.y },
    calibrationApplied: true,
    headPose: { yaw: input.yaw ?? 0, pitch: 0, roll: 0 },
    gazeVector: { x: 0, y: 0, z: 1 },
    faceBounds: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
    faceSize: 0.27,
    distanceScale: 1,
  };
}

describe('GazeWindowFocusManager', () => {
  it('emits dwell events when gaze dwells inside a mapped window', () => {
    const helper = new FakeHelper();
    const cache = new FakeWindowListCache();
    cache.windows = [WINDOW_CENTER];
    const displayProvider: DisplayProvider = {
      getAllDisplays: () => [DISPLAY_SINGLE],
      getPrimaryDisplay: () => DISPLAY_SINGLE,
    };

    const manager = new GazeWindowFocusManager(
      helper as any,
      {
        ...DEFAULT_GAZE_DWELL_CONFIG,
        dwellAction: 'eventOnly',
        dwellDurationMs: 220,
        confidenceThreshold: 0.5,
      },
      { displayProvider, windowListCache: cache }
    );

    const dwellListener = vi.fn();
    manager.on('dwellTriggered', dwellListener);
    manager.start();

    for (const timestampMs of [0, 80, 160, 260]) {
      manager.processSample(createSample({
        timestampMs,
        x: 0.5,
        y: 0.5,
      }));
    }

    expect(cache.start).toHaveBeenCalledTimes(1);
    expect(dwellListener).toHaveBeenCalledTimes(1);
    expect(helper.focusWindowByTitle).not.toHaveBeenCalled();
  });

  it('invokes native focus action for bringToFront dwell action', async () => {
    const helper = new FakeHelper();
    const cache = new FakeWindowListCache();
    cache.windows = [WINDOW_CENTER];
    const displayProvider: DisplayProvider = {
      getAllDisplays: () => [DISPLAY_SINGLE],
      getPrimaryDisplay: () => DISPLAY_SINGLE,
    };

    const manager = new GazeWindowFocusManager(
      helper as any,
      {
        ...DEFAULT_GAZE_DWELL_CONFIG,
        dwellAction: 'bringToFront',
        dwellDurationMs: 220,
        confidenceThreshold: 0.5,
      },
      { displayProvider, windowListCache: cache }
    );

    manager.start();
    for (const timestampMs of [0, 100, 200, 280]) {
      manager.processSample(createSample({ timestampMs, x: 0.5, y: 0.5 }));
    }

    await Promise.resolve();
    expect(helper.focusWindowByTitle).toHaveBeenCalledWith(
      WINDOW_CENTER.ownerBundleId,
      WINDOW_CENTER.title
    );
  });

  it('treats dead-zone edge samples as ambiguous and does not trigger', () => {
    const helper = new FakeHelper();
    const cache = new FakeWindowListCache();
    cache.windows = [WINDOW_CENTER];
    const displayProvider: DisplayProvider = {
      getAllDisplays: () => [DISPLAY_SINGLE],
      getPrimaryDisplay: () => DISPLAY_SINGLE,
    };

    const manager = new GazeWindowFocusManager(
      helper as any,
      {
        ...DEFAULT_GAZE_DWELL_CONFIG,
        dwellAction: 'eventOnly',
        dwellDurationMs: 220,
        confidenceThreshold: 0.5,
        deadZonePx: 120,
      },
      { displayProvider, windowListCache: cache }
    );

    const dwellListener = vi.fn();
    manager.on('dwellTriggered', dwellListener);
    manager.start();

    // Mapped gaze lands close to the left edge of WINDOW_CENTER.
    for (const timestampMs of [0, 100, 200, 300, 400]) {
      manager.processSample(createSample({
        timestampMs,
        x: 0.09,
        y: 0.5,
      }));
    }

    expect(dwellListener).not.toHaveBeenCalled();
  });

  it('uses yaw to switch coarse display mapping in multi-monitor layout', () => {
    const helper = new FakeHelper();
    const cache = new FakeWindowListCache();
    cache.windows = [WINDOW_CENTER, WINDOW_RIGHT];
    const displayProvider: DisplayProvider = {
      getAllDisplays: () => [DISPLAY_SINGLE, DISPLAY_RIGHT],
      getPrimaryDisplay: () => DISPLAY_SINGLE,
    };

    const manager = new GazeWindowFocusManager(
      helper as any,
      {
        ...DEFAULT_GAZE_DWELL_CONFIG,
        dwellAction: 'eventOnly',
        dwellDurationMs: 220,
        confidenceThreshold: 0.5,
      },
      { displayProvider, windowListCache: cache }
    );

    const dwellListener = vi.fn();
    manager.on('dwellTriggered', dwellListener);
    manager.start();

    for (const timestampMs of [0, 90, 180, 280]) {
      manager.processSample(createSample({
        timestampMs,
        x: 0.1,
        y: 0.5,
        yaw: 0.45,
      }));
    }

    expect(dwellListener).toHaveBeenCalledTimes(1);
    const dwellEvent = dwellListener.mock.calls[0][0];
    expect(dwellEvent.activeDisplayId).toBe(DISPLAY_RIGHT.id);
    expect(dwellEvent.window.windowId).toBe(WINDOW_RIGHT.windowId);
  });
});
