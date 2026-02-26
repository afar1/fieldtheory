import { describe, expect, it } from 'vitest';
import { GazeCalibrationEngine, sanitizeGazePersonalOffsets } from './gazeCalibrationEngine';
import { GazePersonalOffsets } from '../types/gaze';

const CALIBRATION_TARGETS = [
  { x: 0.5, y: 0.5 },
  { x: 0.2, y: 0.2 },
  { x: 0.8, y: 0.2 },
  { x: 0.2, y: 0.8 },
  { x: 0.8, y: 0.8 },
];

describe('sanitizeGazePersonalOffsets', () => {
  it('returns null for invalid payloads', () => {
    expect(sanitizeGazePersonalOffsets(null)).toBeNull();
    expect(sanitizeGazePersonalOffsets({})).toBeNull();
    expect(
      sanitizeGazePersonalOffsets({
        version: 2,
        horizontalOffset: 0,
        verticalOffset: 0,
        eyeDominance: 0.5,
        referenceFaceSize: 0.2,
        updatedAtMs: Date.now(),
      })
    ).toBeNull();
  });

  it('clamps and returns valid offsets', () => {
    const parsed = sanitizeGazePersonalOffsets({
      version: 1,
      horizontalOffset: 1,
      verticalOffset: -1,
      eyeDominance: 5,
      referenceFaceSize: -5,
      updatedAtMs: 123,
    });

    expect(parsed).toEqual({
      version: 1,
      horizontalOffset: 0.6,
      verticalOffset: -0.6,
      horizontalGain: 1,
      verticalGain: 1,
      eyeDominance: 1,
      referenceFaceSize: 0.000001,
      updatedAtMs: 123,
    });
  });

  it('migrates legacy collapsed gains and preserves signed gains', () => {
    const migrated = sanitizeGazePersonalOffsets({
      version: 1,
      horizontalOffset: 0,
      verticalOffset: 0,
      horizontalGain: 0.45,
      verticalGain: 0.45,
      eyeDominance: 0.5,
      referenceFaceSize: 0.2,
      updatedAtMs: 123,
    });
    expect(migrated?.horizontalGain).toBe(1);
    expect(migrated?.verticalGain).toBe(1);

    const mirrored = sanitizeGazePersonalOffsets({
      version: 1,
      horizontalOffset: 0,
      verticalOffset: 0,
      horizontalGain: -1.8,
      verticalGain: 1.4,
      eyeDominance: 0.5,
      referenceFaceSize: 0.2,
      updatedAtMs: 123,
    });
    expect(mirrored?.horizontalGain).toBeCloseTo(-1.8, 5);
    expect(mirrored?.verticalGain).toBeCloseTo(1.4, 5);
  });
});

describe('GazeCalibrationEngine', () => {
  it('completes 5-point calibration and fits offsets', () => {
    const engine = new GazeCalibrationEngine(null, null);
    engine.startCalibration();

    const horizontalBias = 0.04;
    const verticalBias = -0.02;
    let timestampMs = 1_000;

    // Feed stability windows based on the engine's current point index.
    // This avoids overfeeding one point after it already advanced.
    let safety = 0;
    while (engine.getState().active && safety < 10) {
      const state = engine.getState();
      const target = CALIBRATION_TARGETS[state.currentPointIndex];
      for (let i = 0; i < 10; i += 1) {
        const phase = (i % 2 === 0 ? 0.0008 : -0.0008);
        const observedCombined = {
          x: clamp01(target.x - horizontalBias + phase),
          y: clamp01(target.y - verticalBias - phase),
        };
        const observedLeft = {
          x: clamp01(observedCombined.x + 0.002),
          y: clamp01(observedCombined.y - 0.001),
        };
        const observedRight = {
          x: clamp01(observedCombined.x + 0.03),
          y: clamp01(observedCombined.y + 0.02),
        };

        engine.onFrame({
          timestampMs,
          combinedEye: observedCombined,
          leftEye: observedLeft,
          rightEye: observedRight,
          faceSize: 0.27,
        });
        timestampMs += 80;
      }
      safety += 1;
    }

    const state = engine.getState();
    expect(state.active).toBe(false);
    expect(state.samplesCollected).toBe(5);
    expect(state.personalOffsets).not.toBeNull();
    expect(state.personalOffsets!.horizontalOffset).toBeCloseTo(horizontalBias, 2);
    expect(state.personalOffsets!.verticalOffset).toBeCloseTo(verticalBias, 2);
    expect(state.personalOffsets!.horizontalGain).toBeCloseTo(1, 1);
    expect(state.personalOffsets!.verticalGain).toBeCloseTo(1, 1);
    expect(state.personalOffsets!.eyeDominance).toBeGreaterThan(0.5);
    expect(state.lastCalibratedAtMs).toBeGreaterThan(1_500_000_000_000);
    expect(state.accuracy).not.toBeNull();
  });

  it('fits gain when observed gaze range is compressed around center', () => {
    const engine = new GazeCalibrationEngine(null, null);
    engine.startCalibration();

    let timestampMs = 5_000;
    let safety = 0;
    while (engine.getState().active && safety < 10) {
      const state = engine.getState();
      const target = CALIBRATION_TARGETS[state.currentPointIndex];

      // Observed signal only spans ~45% of target range and is center-biased.
      const observedCombined = {
        x: clamp01(0.5 + ((target.x - 0.5) * 0.45) - 0.02),
        y: clamp01(0.5 + ((target.y - 0.5) * 0.5) + 0.01),
      };

      for (let i = 0; i < 10; i += 1) {
        const phase = (i % 2 === 0 ? 0.0007 : -0.0007);
        engine.onFrame({
          timestampMs,
          combinedEye: {
            x: clamp01(observedCombined.x + phase),
            y: clamp01(observedCombined.y - phase),
          },
          leftEye: {
            x: clamp01(observedCombined.x + 0.01 + phase),
            y: clamp01(observedCombined.y - 0.01 - phase),
          },
          rightEye: {
            x: clamp01(observedCombined.x - 0.01 + phase),
            y: clamp01(observedCombined.y + 0.01 - phase),
          },
          faceSize: 0.26,
        });
        timestampMs += 80;
      }

      safety += 1;
    }

    const state = engine.getState();
    expect(state.active).toBe(false);
    expect(state.personalOffsets).not.toBeNull();
    expect(state.personalOffsets!.horizontalGain).toBeGreaterThan(1.4);
    expect(state.personalOffsets!.verticalGain).toBeGreaterThan(1.2);

    const remapped = engine.applyOffsets(
      { x: 0.615, y: 0.365 },
      { x: 0.595, y: 0.385 },
      { x: 0.605, y: 0.375 }
    ).calibratedCombinedEye;

    // With gain fitted, a compressed-right/up observed sample should map well beyond center.
    expect(remapped.x).toBeGreaterThan(0.68);
    expect(remapped.y).toBeLessThan(0.37);
  });

  it('supports mirrored horizontal axis via signed gain', () => {
    const engine = new GazeCalibrationEngine(null, null);
    engine.startCalibration();

    let timestampMs = 8_000;
    let safety = 0;
    while (engine.getState().active && safety < 10) {
      const state = engine.getState();
      const target = CALIBRATION_TARGETS[state.currentPointIndex];

      // Horizontal axis is mirrored (larger target x -> smaller observed x).
      const observedCombined = {
        x: clamp01(0.5 - ((target.x - 0.5) * 0.65)),
        y: clamp01(0.5 + ((target.y - 0.5) * 0.7)),
      };

      for (let i = 0; i < 10; i += 1) {
        const phase = (i % 2 === 0 ? 0.0006 : -0.0006);
        engine.onFrame({
          timestampMs,
          combinedEye: {
            x: clamp01(observedCombined.x + phase),
            y: clamp01(observedCombined.y - phase),
          },
          leftEye: {
            x: clamp01(observedCombined.x + 0.01 + phase),
            y: clamp01(observedCombined.y - 0.01 - phase),
          },
          rightEye: {
            x: clamp01(observedCombined.x - 0.01 + phase),
            y: clamp01(observedCombined.y + 0.01 - phase),
          },
          faceSize: 0.27,
        });
        timestampMs += 80;
      }
      safety += 1;
    }

    const state = engine.getState();
    expect(state.active).toBe(false);
    expect(state.personalOffsets).not.toBeNull();
    expect(state.personalOffsets!.horizontalGain).toBeLessThan(0);
  });

  it('applies calibrated offsets to weighted eye position', () => {
    const offsets: GazePersonalOffsets = {
      version: 1,
      horizontalOffset: 0.05,
      verticalOffset: -0.02,
      horizontalGain: 1,
      verticalGain: 1,
      eyeDominance: 0.8,
      referenceFaceSize: 0.3,
      updatedAtMs: 1234,
    };
    const engine = new GazeCalibrationEngine(offsets, offsets.updatedAtMs);

    const applied = engine.applyOffsets(
      { x: 0.3, y: 0.4 },
      { x: 0.9, y: 0.9 },
      { x: 0.5, y: 0.5 }
    );

    // Weighted X = 0.3*0.8 + 0.9*0.2 = 0.42 -> +0.05 = 0.47
    expect(applied.calibrationApplied).toBe(true);
    expect(applied.calibratedCombinedEye.x).toBeCloseTo(0.47, 5);
  });

  it('marks and clears recalibration prompt', () => {
    const engine = new GazeCalibrationEngine(null, null);
    engine.markNeedsRecalibration('Display layout changed');
    expect(engine.getState().needsRecalibrationPrompt).toBe(true);
    expect(engine.getState().recalibrationReason).toBe('Display layout changed');

    engine.clearRecalibrationPrompt();
    expect(engine.getState().needsRecalibrationPrompt).toBe(false);
    expect(engine.getState().recalibrationReason).toBeNull();
  });

  it('applies manual correction and increments correction count', () => {
    const engine = new GazeCalibrationEngine(null, null);
    const observedCombined = { x: 0.35, y: 0.55 };
    const target = { x: 0.75, y: 0.25 };

    const beforeDistance = Math.hypot(
      observedCombined.x - target.x,
      observedCombined.y - target.y
    );

    const offsets = engine.applyManualCorrection({
      target,
      observedLeft: { x: 0.34, y: 0.54 },
      observedRight: { x: 0.37, y: 0.57 },
      observedCombined,
      faceSize: 0.24,
      timestampMs: 9999,
    });

    const corrected = engine.applyOffsets(
      { x: 0.34, y: 0.54 },
      { x: 0.37, y: 0.57 },
      observedCombined
    ).calibratedCombinedEye;
    const afterDistance = Math.hypot(
      corrected.x - target.x,
      corrected.y - target.y
    );

    expect(offsets.horizontalOffset).toBeGreaterThan(0);
    expect(offsets.verticalOffset).toBeLessThan(0);
    expect(engine.getState().manualCorrectionCount).toBe(1);
    expect(engine.getState().personalOffsets).not.toBeNull();
    expect(afterDistance).toBeLessThan(beforeDistance);
  });
});

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
