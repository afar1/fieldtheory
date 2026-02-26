import { describe, expect, it } from 'vitest';
import { DEFAULT_GAZE_DWELL_CONFIG, GazeWindowSnapshot } from '../types/gaze';
import { GazeDwellEngine } from './gazeDwellEngine';

const WINDOW_A: GazeWindowSnapshot = {
  windowId: 101,
  ownerName: 'Terminal',
  ownerBundleId: 'com.apple.Terminal',
  ownerPID: 999,
  title: 'Session A',
  bounds: { x: 0, y: 0, width: 1000, height: 800 },
  layer: 0,
};

const WINDOW_B: GazeWindowSnapshot = {
  ...WINDOW_A,
  windowId: 202,
  title: 'Session B',
};

describe('GazeDwellEngine', () => {
  it('triggers dwell after continuous in-window gaze', () => {
    const engine = new GazeDwellEngine({
      ...DEFAULT_GAZE_DWELL_CONFIG,
      dwellDurationMs: 300,
      confidenceThreshold: 0.55,
    });

    let result = null;
    for (const timestampMs of [0, 100, 200, 300]) {
      result = engine.evaluate({
        timestampMs,
        confidence: 0.9,
        gazePoint: { x: 420, y: 300 },
        activeDisplayId: 1,
        window: WINDOW_A,
      });
    }

    expect(result).not.toBeNull();
    expect(result?.window.windowId).toBe(WINDOW_A.windowId);
    expect(result?.confidence).toBeGreaterThanOrEqual(0.55);
    expect(result?.stability).toBeGreaterThanOrEqual(0.55);
  });

  it('resets dwell continuity when gaze moves to a different window', () => {
    const engine = new GazeDwellEngine({
      ...DEFAULT_GAZE_DWELL_CONFIG,
      dwellDurationMs: 350,
      confidenceThreshold: 0.5,
    });

    engine.evaluate({
      timestampMs: 0,
      confidence: 0.9,
      gazePoint: { x: 400, y: 300 },
      activeDisplayId: 1,
      window: WINDOW_A,
    });
    engine.evaluate({
      timestampMs: 200,
      confidence: 0.9,
      gazePoint: { x: 405, y: 302 },
      activeDisplayId: 1,
      window: WINDOW_A,
    });

    // Switch windows - this should reset the timer.
    const switched = engine.evaluate({
      timestampMs: 250,
      confidence: 0.92,
      gazePoint: { x: 700, y: 280 },
      activeDisplayId: 1,
      window: WINDOW_B,
    });
    expect(switched).toBeNull();

    // Not enough dwell time yet on the new window.
    const early = engine.evaluate({
      timestampMs: 500,
      confidence: 0.92,
      gazePoint: { x: 702, y: 281 },
      activeDisplayId: 1,
      window: WINDOW_B,
    });
    expect(early).toBeNull();

    const triggered = engine.evaluate({
      timestampMs: 700,
      confidence: 0.92,
      gazePoint: { x: 704, y: 282 },
      activeDisplayId: 1,
      window: WINDOW_B,
    });
    expect(triggered?.window.windowId).toBe(WINDOW_B.windowId);
  });

  it('enforces per-window cooldown before retrigger', () => {
    const engine = new GazeDwellEngine({
      ...DEFAULT_GAZE_DWELL_CONFIG,
      dwellDurationMs: 250,
      confidenceThreshold: 0.5,
      cooldownMs: 1000,
    });

    for (const timestampMs of [0, 100, 200, 300]) {
      engine.evaluate({
        timestampMs,
        confidence: 0.85,
        gazePoint: { x: 300, y: 220 },
        activeDisplayId: 1,
        window: WINDOW_A,
      });
    }

    // Cooldown should block this trigger.
    const blocked = engine.evaluate({
      timestampMs: 850,
      confidence: 0.9,
      gazePoint: { x: 301, y: 221 },
      activeDisplayId: 1,
      window: WINDOW_A,
    });
    expect(blocked).toBeNull();

    engine.evaluate({
      timestampMs: 1320,
      confidence: 0.9,
      gazePoint: { x: 302, y: 221 },
      activeDisplayId: 1,
      window: WINDOW_A,
    });

    // Past cooldown + dwell window should trigger again.
    const triggered = engine.evaluate({
      timestampMs: 1450,
      confidence: 0.9,
      gazePoint: { x: 303, y: 222 },
      activeDisplayId: 1,
      window: WINDOW_A,
    });
    expect(triggered).not.toBeNull();
  });

  it('requires stable gaze and confidence threshold', () => {
    const engine = new GazeDwellEngine({
      ...DEFAULT_GAZE_DWELL_CONFIG,
      dwellDurationMs: 300,
      confidenceThreshold: 0.7,
    });

    const jitteredPoints = [
      { x: 100, y: 100 },
      { x: 600, y: 500 },
      { x: 200, y: 450 },
      { x: 780, y: 150 },
      { x: 320, y: 600 },
    ];

    let result = null;
    for (let i = 0; i < jitteredPoints.length; i += 1) {
      result = engine.evaluate({
        timestampMs: i * 120,
        confidence: 0.72,
        gazePoint: jitteredPoints[i],
        activeDisplayId: 1,
        window: WINDOW_A,
      });
    }

    expect(result).toBeNull();
  });
});
