import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import { GazeTrackingManager } from './gazeTrackingManager';
import { GazeSampleMessage, GazeTrackingStatusMessage } from '../types/audio';

vi.mock('../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

class FakeNativeHelper extends EventEmitter {
  private status: GazeTrackingStatusMessage = {
    type: 'gazeTrackingStatus',
    running: false,
    cameraAuthorized: true,
    targetFps: 15,
    reason: 'Disabled',
  };

  async startGazeTracking(targetFps: number): Promise<GazeTrackingStatusMessage> {
    this.status = {
      type: 'gazeTrackingStatus',
      running: true,
      cameraAuthorized: true,
      targetFps,
      reason: null,
    };
    return this.status;
  }

  async stopGazeTracking(): Promise<GazeTrackingStatusMessage> {
    this.status = {
      type: 'gazeTrackingStatus',
      running: false,
      cameraAuthorized: true,
      targetFps: this.status.targetFps,
      reason: 'Disabled',
    };
    return this.status;
  }

  async getGazeTrackingStatus(): Promise<GazeTrackingStatusMessage> {
    return this.status;
  }

  async getWindowList(): Promise<any[]> {
    return [];
  }

  async focusWindowByTitle(): Promise<{ success: boolean; error?: string }> {
    return { success: true };
  }
}

class FakePreferencesManager {
  private prefs: Record<string, unknown>;

  constructor(initial: Record<string, unknown>) {
    this.prefs = { ...initial };
  }

  getPreference(key: string): unknown {
    return this.prefs[key];
  }

  async save(prefs: Record<string, unknown>): Promise<void> {
    this.prefs = { ...this.prefs, ...prefs };
  }
}

describe('GazeTrackingManager', () => {
  it('does not auto-start when preference is disabled', async () => {
    const helper = new FakeNativeHelper();
    const prefs = new FakePreferencesManager({ gazeTrackingEnabled: false });
    const manager = new GazeTrackingManager(helper as any, prefs as any);

    const startSpy = vi.spyOn(helper, 'startGazeTracking');
    await manager.init();

    expect(startSpy).not.toHaveBeenCalled();
    expect(manager.getStatus().enabled).toBe(false);
    expect(manager.getStatus().running).toBe(false);
  });

  it('starts when enabled and persists preference', async () => {
    const helper = new FakeNativeHelper();
    const prefs = new FakePreferencesManager({ gazeTrackingEnabled: false });
    const saveSpy = vi.spyOn(prefs, 'save');
    const manager = new GazeTrackingManager(helper as any, prefs as any);
    await manager.init();

    const status = await manager.setEnabled(true);

    expect(status.enabled).toBe(true);
    expect(status.running).toBe(true);
    expect(saveSpy).toHaveBeenCalledWith({ gazeTrackingEnabled: true });
  });

  it('updates latest sample and emits sample events from helper stream', async () => {
    const helper = new FakeNativeHelper();
    const prefs = new FakePreferencesManager({ gazeTrackingEnabled: false });
    const manager = new GazeTrackingManager(helper as any, prefs as any);
    await manager.init();

    const before = Date.now();
    const sample: GazeSampleMessage = {
      type: 'gazeSample',
      timestampMs: 1234,
      confidence: 0.92,
      leftEye: { x: 0.41, y: 0.53 },
      rightEye: { x: 0.48, y: 0.55 },
      combinedEye: { x: 0.445, y: 0.54 },
      headPose: { yaw: 0.1, pitch: 0.0, roll: -0.02 },
      gazeVector: { x: 0.1, y: -0.1, z: 0.98 },
      faceBounds: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
      faceSize: 0.3,
      distanceScale: 1.0,
    };

    const listener = vi.fn();
    manager.on('sample', listener);

    helper.emit('gazeSample', sample);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(manager.getLatestSample()?.timestampMs).toBe(1234);
    const lastSampleAtMs = manager.getStatus().lastSampleAtMs;
    expect(lastSampleAtMs).not.toBeNull();
    expect(lastSampleAtMs!).toBeGreaterThanOrEqual(before);
  });

  it('deep-clones latest sample to avoid external mutation', async () => {
    const helper = new FakeNativeHelper();
    const prefs = new FakePreferencesManager({ gazeTrackingEnabled: false });
    const manager = new GazeTrackingManager(helper as any, prefs as any);
    await manager.init();

    helper.emit('gazeSample', {
      type: 'gazeSample',
      timestampMs: 55,
      confidence: 0.8,
      leftEye: { x: 0.1, y: 0.2 },
      rightEye: { x: 0.3, y: 0.4 },
      combinedEye: { x: 0.2, y: 0.3 },
      headPose: { yaw: 0.1, pitch: 0.2, roll: 0.3 },
      gazeVector: { x: 0.0, y: 0.0, z: 1.0 },
      faceBounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.2 },
      faceSize: 0.2,
      distanceScale: 1.0,
    } as GazeSampleMessage);

    const copy = manager.getLatestSample();
    expect(copy).not.toBeNull();
    copy!.leftEye.x = 999;

    const secondRead = manager.getLatestSample();
    expect(secondRead?.leftEye.x).toBe(0.1);
  });

  it('does not let sample listener mutation corrupt stored latest sample', async () => {
    const helper = new FakeNativeHelper();
    const prefs = new FakePreferencesManager({ gazeTrackingEnabled: false });
    const manager = new GazeTrackingManager(helper as any, prefs as any);
    await manager.init();

    manager.on('sample', (sample) => {
      sample.leftEye.x = 999;
      sample.headPose.yaw = 42;
    });

    helper.emit('gazeSample', {
      type: 'gazeSample',
      timestampMs: 88,
      confidence: 0.8,
      leftEye: { x: 0.25, y: 0.2 },
      rightEye: { x: 0.35, y: 0.4 },
      combinedEye: { x: 0.3, y: 0.3 },
      headPose: { yaw: 0.1, pitch: 0.2, roll: 0.3 },
      gazeVector: { x: 0.0, y: 0.0, z: 1.0 },
      faceBounds: { x: 0.2, y: 0.2, width: 0.2, height: 0.2 },
      faceSize: 0.2,
      distanceScale: 1.0,
    } as GazeSampleMessage);

    const persisted = manager.getLatestSample();
    expect(persisted?.leftEye.x).toBe(0.25);
    expect(persisted?.headPose.yaw).toBe(0.1);
  });

  it('is idempotent when setEnabled is called with the current value', async () => {
    const helper = new FakeNativeHelper();
    const prefs = new FakePreferencesManager({ gazeTrackingEnabled: false });
    const manager = new GazeTrackingManager(helper as any, prefs as any);
    await manager.init();

    const saveSpy = vi.spyOn(prefs, 'save');
    const startSpy = vi.spyOn(helper, 'startGazeTracking');
    const stopSpy = vi.spyOn(helper, 'stopGazeTracking');

    // Already disabled -> no-op.
    await manager.setEnabled(false);
    expect(saveSpy).not.toHaveBeenCalled();
    expect(startSpy).not.toHaveBeenCalled();
    expect(stopSpy).not.toHaveBeenCalled();

    // Transition to enabled once.
    await manager.setEnabled(true);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledTimes(1);

    // Already enabled and running -> no-op.
    await manager.setEnabled(true);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('allows init retry if initial helper status fetch fails', async () => {
    const helper = new FakeNativeHelper();
    const prefs = new FakePreferencesManager({ gazeTrackingEnabled: false });
    const manager = new GazeTrackingManager(helper as any, prefs as any);

    const statusSpy = vi
      .spyOn(helper, 'getGazeTrackingStatus')
      .mockRejectedValueOnce(new Error('status failed'))
      .mockResolvedValue({
        type: 'gazeTrackingStatus',
        running: false,
        cameraAuthorized: true,
        targetFps: 15,
        reason: 'Disabled',
      } as GazeTrackingStatusMessage);

    await expect(manager.init()).rejects.toThrow('status failed');
    await expect(manager.init()).resolves.toBeUndefined();
    expect(statusSpy).toHaveBeenCalledTimes(2);
  });

  it('reloadFromPreferences starts and stops based on preference changes', async () => {
    const helper = new FakeNativeHelper();
    const prefs = new FakePreferencesManager({ gazeTrackingEnabled: false });
    const manager = new GazeTrackingManager(helper as any, prefs as any);
    await manager.init();

    // Flip pref on and reload.
    await prefs.save({ gazeTrackingEnabled: true });
    await manager.reloadFromPreferences();
    expect(manager.getStatus().enabled).toBe(true);
    expect(manager.getStatus().running).toBe(true);

    // Flip pref off and reload.
    await prefs.save({ gazeTrackingEnabled: false });
    await manager.reloadFromPreferences();
    expect(manager.getStatus().enabled).toBe(false);
    expect(manager.getStatus().running).toBe(false);
  });

  it('runs calibration session and persists personal offsets', async () => {
    const helper = new FakeNativeHelper();
    const prefs = new FakePreferencesManager({ gazeTrackingEnabled: true });
    const manager = new GazeTrackingManager(helper as any, prefs as any);
    const saveSpy = vi.spyOn(prefs, 'save');
    await manager.init();

    const calibrationState = await manager.startCalibration();
    expect(calibrationState.active).toBe(true);
    expect(calibrationState.currentPointId).toBe('center');

    const targets = [
      { x: 0.5, y: 0.5 },
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.2, y: 0.8 },
      { x: 0.8, y: 0.8 },
    ];
    let timestamp = 1_000;
    let safety = 0;
    while (manager.getCalibrationState().active && safety < 10) {
      const target = targets[manager.getCalibrationState().currentPointIndex];
      for (let i = 0; i < 10; i += 1) {
        const wobble = i % 2 === 0 ? 0.0005 : -0.0005;
        helper.emit('gazeSample', makeSample({
          timestampMs: timestamp,
          combinedX: target.x - 0.03 + wobble,
          combinedY: target.y + 0.02 - wobble,
          leftX: target.x - 0.028,
          leftY: target.y + 0.019,
          rightX: target.x - 0.01,
          rightY: target.y + 0.03,
        }));
        timestamp += 80;
      }
      safety += 1;
    }

    await Promise.resolve();
    const finalState = manager.getCalibrationState();
    expect(finalState.active).toBe(false);
    expect(finalState.samplesCollected).toBe(5);
    expect(finalState.personalOffsets).not.toBeNull();
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        gazePersonalOffsets: expect.any(Object),
        gazeLastCalibratedAtMs: expect.any(Number),
      })
    );
  });

  it('marks recalibration prompt when screen parameters change', async () => {
    const helper = new FakeNativeHelper();
    const prefs = new FakePreferencesManager({ gazeTrackingEnabled: false });
    const manager = new GazeTrackingManager(helper as any, prefs as any);
    await manager.init();

    manager.noteScreenParametersChanged();
    const state = manager.getCalibrationState();
    expect(state.needsRecalibrationPrompt).toBe(true);
    expect(state.recalibrationReason).toBe('Display layout changed');
  });

  it('applies manual correction from preview drag and persists offsets', async () => {
    const helper = new FakeNativeHelper();
    const prefs = new FakePreferencesManager({ gazeTrackingEnabled: false });
    const saveSpy = vi.spyOn(prefs, 'save');
    const manager = new GazeTrackingManager(helper as any, prefs as any);
    await manager.init();

    helper.emit('gazeSample', makeSample({
      timestampMs: 1000,
      combinedX: 0.3,
      combinedY: 0.7,
      leftX: 0.29,
      leftY: 0.69,
      rightX: 0.32,
      rightY: 0.71,
    }));

    const sampleListener = vi.fn();
    manager.on('sample', sampleListener);
    const nextState = await manager.applyManualCorrection({ x: 0.8, y: 0.2 });

    expect(nextState.manualCorrectionCount).toBe(1);
    expect(nextState.personalOffsets).not.toBeNull();
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        gazePersonalOffsets: expect.any(Object),
        gazeLastCalibratedAtMs: expect.any(Number),
      })
    );
    expect(sampleListener).toHaveBeenCalled();
  });

  it('persists and returns dwell focus config', async () => {
    const helper = new FakeNativeHelper();
    const prefs = new FakePreferencesManager({ gazeTrackingEnabled: false });
    const saveSpy = vi.spyOn(prefs, 'save');
    const manager = new GazeTrackingManager(helper as any, prefs as any);
    await manager.init();

    const updated = await manager.setFocusConfig({
      dwellDurationMs: 650,
      confidenceThreshold: 0.72,
      deadZonePx: 96,
      dwellAction: 'highlightBorder',
    });

    expect(updated.dwellDurationMs).toBe(650);
    expect(updated.confidenceThreshold).toBeCloseTo(0.72, 5);
    expect(updated.deadZonePx).toBe(96);
    expect(updated.dwellAction).toBe('highlightBorder');
    expect(manager.getFocusConfig().dwellDurationMs).toBe(650);
    expect(saveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        gazeWindowFocusConfig: expect.objectContaining({
          dwellDurationMs: 650,
          dwellAction: 'highlightBorder',
        }),
      })
    );
  });

  it('refreshes focus window cache when active space changes', async () => {
    const helper = new FakeNativeHelper();
    const prefs = new FakePreferencesManager({ gazeTrackingEnabled: true });
    const manager = new GazeTrackingManager(helper as any, prefs as any);
    const windowListSpy = vi.spyOn(helper, 'getWindowList');
    await manager.init();

    const before = windowListSpy.mock.calls.length;
    helper.emit('activeSpaceChanged');
    await Promise.resolve();

    expect(windowListSpy.mock.calls.length).toBeGreaterThan(before);
  });
});

function makeSample({
  timestampMs,
  combinedX,
  combinedY,
  leftX,
  leftY,
  rightX,
  rightY,
}: {
  timestampMs: number;
  combinedX: number;
  combinedY: number;
  leftX: number;
  leftY: number;
  rightX: number;
  rightY: number;
}): GazeSampleMessage {
  return {
    type: 'gazeSample',
    timestampMs,
    confidence: 0.9,
    leftEye: { x: leftX, y: leftY },
    rightEye: { x: rightX, y: rightY },
    combinedEye: { x: combinedX, y: combinedY },
    headPose: { yaw: 0, pitch: 0, roll: 0 },
    gazeVector: { x: 0, y: 0, z: 1 },
    faceBounds: { x: 0.2, y: 0.2, width: 0.3, height: 0.3 },
    faceSize: 0.27,
    distanceScale: 1,
  };
}
