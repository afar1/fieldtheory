/**
 * Audio waveform utilities for the Dynamic Island visualization.
 *
 * Maintains a ring buffer of recent audio levels and applies perceptual
 * scaling so that typical speech RMS values (0.01–0.2) produce visible
 * bar heights. Used by both hot-mic and standard recording modes.
 */

/** Default number of bars in the waveform display. */
export const WAVEFORM_BAR_COUNT = 5;

/**
 * Scale a raw RMS audio level (0–1) to a perceptual 0–1 range.
 *
 * Raw RMS from the mic is typically 0.01–0.15 for speech. A linear
 * mapping would make the bars barely visible. We apply sqrt with a gain
 * multiplier so normal speech fills ~60–90% of the bar height.
 *
 * Mapping examples:
 *   0.00 → 0.00  (silence)
 *   0.01 → 0.28  (quiet speech)
 *   0.05 → 0.63  (normal speech)
 *   0.10 → 0.89  (loud speech)
 *   0.20 → 1.00  (capped)
 */
export function scaleAudioLevel(rawLevel: number): number {
  if (rawLevel <= 0) return 0;
  return Math.min(1, Math.sqrt(rawLevel * 8));
}

/**
 * Ring buffer that maintains the last N audio level samples in arrival order.
 */
export class AudioLevelRingBuffer {
  private readonly buffer: number[];
  private writeIndex = 0;

  constructor(public readonly size: number) {
    this.buffer = new Array(size).fill(0);
  }

  /** Push a new raw audio level into the buffer. */
  push(rawLevel: number): void {
    this.buffer[this.writeIndex % this.size] = rawLevel;
    this.writeIndex += 1;
  }

  /**
   * Return the buffered levels in chronological order (oldest first,
   * newest last — rightmost bar is most recent).
   */
  getOrdered(): number[] {
    const result: number[] = [];
    const start = this.writeIndex;
    for (let i = 0; i < this.size; i++) {
      result.push(this.buffer[(start + i) % this.size]);
    }
    return result;
  }

  /** Reset all levels to zero. */
  reset(): void {
    this.buffer.fill(0);
    this.writeIndex = 0;
  }
}
