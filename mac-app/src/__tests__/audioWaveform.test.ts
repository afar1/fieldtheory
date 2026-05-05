import { describe, it, expect } from 'vitest';
import {
  scaleAudioLevel,
  AudioLevelRingBuffer,
  WAVEFORM_BAR_COUNT,
} from '../utils/audioWaveform';

describe('scaleAudioLevel', () => {
  it('returns 0 for silence', () => {
    expect(scaleAudioLevel(0)).toBe(0);
    expect(scaleAudioLevel(-0.01)).toBe(0);
  });

  it('caps at 1 for loud signals', () => {
    expect(scaleAudioLevel(0.2)).toBe(1);
    expect(scaleAudioLevel(0.5)).toBe(1);
    expect(scaleAudioLevel(1.0)).toBe(1);
  });

  it('produces visible values for typical speech RMS (0.01–0.1)', () => {
    const quiet = scaleAudioLevel(0.01);
    const normal = scaleAudioLevel(0.05);
    const loud = scaleAudioLevel(0.1);

    // Quiet speech should produce at least 25% bar height.
    expect(quiet).toBeGreaterThan(0.25);
    // Normal speech should produce at least 55% bar height.
    expect(normal).toBeGreaterThan(0.55);
    // Loud speech should produce at least 85% bar height.
    expect(loud).toBeGreaterThan(0.85);
  });

  it('is monotonically increasing', () => {
    let prev = 0;
    for (const level of [0, 0.005, 0.01, 0.02, 0.05, 0.1, 0.15, 0.2]) {
      const scaled = scaleAudioLevel(level);
      expect(scaled).toBeGreaterThanOrEqual(prev);
      prev = scaled;
    }
  });
});

describe('AudioLevelRingBuffer', () => {
  it('initializes with zeros', () => {
    const buf = new AudioLevelRingBuffer(4);
    expect(buf.getOrdered()).toEqual([0, 0, 0, 0]);
  });

  it('pushes and reads in chronological order (newest last)', () => {
    const buf = new AudioLevelRingBuffer(3);
    buf.push(0.1);
    buf.push(0.2);
    buf.push(0.3);
    expect(buf.getOrdered()).toEqual([0.1, 0.2, 0.3]);
  });

  it('wraps around correctly when buffer is full', () => {
    const buf = new AudioLevelRingBuffer(3);
    buf.push(0.1);
    buf.push(0.2);
    buf.push(0.3);
    buf.push(0.4); // overwrites 0.1
    expect(buf.getOrdered()).toEqual([0.2, 0.3, 0.4]);
  });

  it('handles partial fill (fewer pushes than size)', () => {
    const buf = new AudioLevelRingBuffer(5);
    buf.push(0.5);
    buf.push(0.7);
    // Remaining slots are still zero, in chronological order.
    expect(buf.getOrdered()).toEqual([0, 0, 0, 0.5, 0.7]);
  });

  it('handles many wraps around', () => {
    const buf = new AudioLevelRingBuffer(3);
    for (let i = 1; i <= 10; i++) {
      buf.push(i * 0.1);
    }
    // Last 3 values pushed: 0.8, 0.9, 1.0
    const ordered = buf.getOrdered();
    expect(ordered[0]).toBeCloseTo(0.8);
    expect(ordered[1]).toBeCloseTo(0.9);
    expect(ordered[2]).toBeCloseTo(1.0);
  });

  it('resets to zeros', () => {
    const buf = new AudioLevelRingBuffer(3);
    buf.push(0.5);
    buf.push(0.6);
    buf.reset();
    expect(buf.getOrdered()).toEqual([0, 0, 0]);
  });

  it('works correctly after reset and new pushes', () => {
    const buf = new AudioLevelRingBuffer(3);
    buf.push(0.1);
    buf.push(0.2);
    buf.push(0.3);
    buf.reset();
    buf.push(0.9);
    expect(buf.getOrdered()).toEqual([0, 0, 0.9]);
  });

  it('has the expected default bar count', () => {
    expect(WAVEFORM_BAR_COUNT).toBe(7);
  });
});
