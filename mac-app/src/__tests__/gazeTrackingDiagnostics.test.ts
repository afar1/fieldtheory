import { describe, expect, it } from 'vitest';
import { summarizeGazeTrackingHealth } from '../lib/gazeTrackingDiagnostics';

describe('summarizeGazeTrackingHealth', () => {
  it('reports warning when tracking is disabled', () => {
    const summary = summarizeGazeTrackingHealth({
      status: {
        enabled: false,
        running: false,
        cameraAuthorized: true,
        reason: null,
        lastSampleAtMs: null,
      },
      calibration: { lastCalibratedAtMs: Date.now() - 60_000 },
      latestSample: null,
      recentSamples: [],
      nowMs: Date.now(),
    });

    expect(summary.level).toBe('warning');
    expect(summary.reasons.join(' ')).toContain('turned off');
  });

  it('reports error when camera permission is denied', () => {
    const summary = summarizeGazeTrackingHealth({
      status: {
        enabled: true,
        running: false,
        cameraAuthorized: false,
        reason: 'Camera permission denied',
        lastSampleAtMs: null,
      },
      calibration: { lastCalibratedAtMs: Date.now() - 60_000 },
      latestSample: null,
      recentSamples: [],
      nowMs: Date.now(),
    });

    expect(summary.level).toBe('error');
    expect(summary.reasons.join(' ')).toContain('Camera permission is denied');
  });

  it('reports stale stream when no recent sample arrives', () => {
    const now = 1_000_000;
    const summary = summarizeGazeTrackingHealth({
      status: {
        enabled: true,
        running: true,
        cameraAuthorized: true,
        reason: null,
        lastSampleAtMs: now - 4_100,
      },
      calibration: { lastCalibratedAtMs: now - 90_000 },
      latestSample: null,
      recentSamples: [],
      nowMs: now,
    });

    expect(summary.level).toBe('error');
    expect(summary.sampleAgeMs).toBe(4100);
    expect(summary.reasons.join(' ')).toContain('No gaze sample received');
  });

  it('returns healthy status for stable high-quality samples', () => {
    const now = 2_000_000;
    const recentSamples = Array.from({ length: 30 }, (_v, index) => ({
      timestampMs: now - 2000 + (index * 67), // ~15fps
      confidence: 0.88,
      calibrationApplied: true,
      activeDisplayId: 1,
      mappedScreenPoint: { x: 640, y: 360 },
      landmarks: { ok: true },
    }));

    const summary = summarizeGazeTrackingHealth({
      status: {
        enabled: true,
        running: true,
        cameraAuthorized: true,
        reason: null,
        lastSampleAtMs: now - 20,
      },
      calibration: { lastCalibratedAtMs: now - 120_000 },
      latestSample: recentSamples[recentSamples.length - 1],
      recentSamples,
      nowMs: now,
    });

    expect(summary.level).toBe('ok');
    expect(summary.sampleRateHz).not.toBeNull();
    expect(summary.sampleRateHz!).toBeGreaterThan(12);
    expect(summary.averageConfidence).toBeGreaterThan(0.8);
    expect(summary.landmarkRate).toBe(1);
  });

  it('flags low confidence and missing landmarks', () => {
    const now = 3_000_000;
    const recentSamples = Array.from({ length: 12 }, (_v, index) => ({
      timestampMs: now - 1200 + (index * 100),
      confidence: 0.33,
      calibrationApplied: false,
      activeDisplayId: null,
      mappedScreenPoint: null,
      landmarks: index % 3 === 0 ? { ok: true } : null,
    }));

    const summary = summarizeGazeTrackingHealth({
      status: {
        enabled: true,
        running: true,
        cameraAuthorized: true,
        reason: null,
        lastSampleAtMs: now - 30,
      },
      calibration: { lastCalibratedAtMs: null },
      latestSample: recentSamples[recentSamples.length - 1],
      recentSamples,
      nowMs: now,
    });

    expect(summary.level).toBe('error');
    expect(summary.reasons.join(' ')).toContain('confidence');
    expect(summary.reasons.join(' ')).toContain('landmarks');
    expect(summary.reasons.join(' ')).toContain('Calibration has not been completed');
  });

  it('does not claim no samples when recent flow exists but status sample timestamp is missing', () => {
    const now = 4_000_000;
    const recentSamples = Array.from({ length: 12 }, (_v, index) => ({
      timestampMs: 1000 + (index * 20),
      receivedAtMs: now - 1000 + (index * 80),
      confidence: 0.9,
      calibrationApplied: true,
      activeDisplayId: 1,
      mappedScreenPoint: { x: 400, y: 320 },
      landmarks: null,
    }));

    const summary = summarizeGazeTrackingHealth({
      status: {
        enabled: true,
        running: true,
        cameraAuthorized: true,
        reason: null,
        lastSampleAtMs: null,
      },
      calibration: { lastCalibratedAtMs: now - 60_000 },
      latestSample: recentSamples[recentSamples.length - 1],
      recentSamples,
      nowMs: now,
    });

    expect(summary.reasons.join(' ')).not.toContain('No gaze samples received yet');
    expect(summary.sampleRateHz).not.toBeNull();
    expect(summary.averageConfidence).toBeGreaterThan(0.8);
  });
});
