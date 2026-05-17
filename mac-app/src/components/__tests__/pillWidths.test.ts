import { describe, expect, it } from 'vitest';
import {
  computeLeftPillWidth,
  computeRightPillWidth,
  floatingPipeSlotWidthForCount,
  pipeSlotWidthForCount,
} from '../pillWidths';

describe('computeLeftPillWidth', () => {
  it('idle (only hamburger visible) = padding + hamburger', () => {
    const w = computeLeftPillWidth({
      xExpanded: false,
      agentsSlotSum: 0,
      hamburgerExpanded: true,
    });
    expect(w).toBe(18 + 22);
  });

  it('0 agents with hamburger hidden collapses to just padding', () => {
    const w = computeLeftPillWidth({
      xExpanded: false,
      agentsSlotSum: 0,
      hamburgerExpanded: false,
    });
    expect(w).toBe(18);
  });

  it('adds the X slot (+30) when expanded', () => {
    const base = computeLeftPillWidth({
      xExpanded: false,
      agentsSlotSum: 0,
      hamburgerExpanded: true,
    });
    const withX = computeLeftPillWidth({
      xExpanded: true,
      agentsSlotSum: 0,
      hamburgerExpanded: true,
    });
    expect(withX - base).toBe(22 + 8);
  });

  it('does not add a trailing gap when X is the only chip', () => {
    const w = computeLeftPillWidth({
      xExpanded: true,
      agentsSlotSum: 0,
      hamburgerExpanded: false,
    });
    expect(w).toBe(18 + 22);
  });

  it('agent slot sum is added through verbatim', () => {
    const base = computeLeftPillWidth({
      xExpanded: false,
      agentsSlotSum: 0,
      hamburgerExpanded: false,
    });
    for (const sum of [0, 28, 56, 84, 114]) {
      const w = computeLeftPillWidth({
        xExpanded: false,
        agentsSlotSum: sum,
        hamburgerExpanded: false,
      });
      expect(w - base).toBe(sum);
    }
  });

  it('kitchen sink: X + agents + hamburger fits expected total', () => {
    const w = computeLeftPillWidth({
      xExpanded: true,
      agentsSlotSum: 114, // e.g. 3 agents (84) + overflow (30)
      hamburgerExpanded: true,
    });
    // 18 pad + 30 X + 114 agents + 22 hamburger = 184
    expect(w).toBe(184);
  });
});

describe('computeRightPillWidth', () => {
  it('idle (no waveform, no pipes) = padding only', () => {
    expect(computeRightPillWidth({ waveformActive: false, pipeCount: 0 })).toBe(18);
  });

  it('waveform alone adds one chip with no trailing gap', () => {
    const base = computeRightPillWidth({ waveformActive: false, pipeCount: 0 });
    const withWave = computeRightPillWidth({ waveformActive: true, pipeCount: 0 });
    expect(withWave - base).toBe(30);
  });

  it('waveform adds a gap only when a stack chip follows it', () => {
    expect(
      computeRightPillWidth({ waveformActive: true, pipeCount: 1 })
    ).toBe(18 + 30 + 8 + 22);
  });

  it('allows the waveform slot to widen for the escape hint', () => {
    expect(
      computeRightPillWidth({ waveformActive: true, pipeCount: 0, waveformWidth: 56 })
    ).toBe(18 + 56);
    expect(
      computeRightPillWidth({ waveformActive: true, pipeCount: 2, waveformWidth: 56 })
    ).toBe(18 + 56 + 8 + 22);
  });

  it('1–3 pipes add 22', () => {
    for (let n = 1; n <= 3; n++) {
      expect(
        computeRightPillWidth({ waveformActive: false, pipeCount: n })
      ).toBe(18 + 22);
    }
  });

  it('4–9 pipes add 32', () => {
    expect(
      computeRightPillWidth({ waveformActive: false, pipeCount: 4 })
    ).toBe(18 + 32);
    expect(
      computeRightPillWidth({ waveformActive: false, pipeCount: 9 })
    ).toBe(18 + 32);
  });

  it('10+ pipes add 38', () => {
    expect(
      computeRightPillWidth({ waveformActive: false, pipeCount: 10 })
    ).toBe(18 + 38);
    expect(
      computeRightPillWidth({ waveformActive: false, pipeCount: 100 })
    ).toBe(18 + 38);
  });
});

describe('pipeSlotWidthForCount', () => {
  it('maps count buckets to 22/32/38', () => {
    expect(pipeSlotWidthForCount(0)).toBe(22);
    expect(pipeSlotWidthForCount(1)).toBe(22);
    expect(pipeSlotWidthForCount(3)).toBe(22);
    expect(pipeSlotWidthForCount(4)).toBe(32);
    expect(pipeSlotWidthForCount(9)).toBe(32);
    expect(pipeSlotWidthForCount(10)).toBe(38);
    expect(pipeSlotWidthForCount(42)).toBe(38);
  });
});

describe('floatingPipeSlotWidthForCount', () => {
  it('keeps screenshot chips compact in the floating pill', () => {
    expect(floatingPipeSlotWidthForCount(1)).toBe(4);
    expect(floatingPipeSlotWidthForCount(2)).toBe(8);
    expect(floatingPipeSlotWidthForCount(3)).toBe(12);
    expect(floatingPipeSlotWidthForCount(4)).toBe(18);
    expect(floatingPipeSlotWidthForCount(10)).toBe(24);
  });
});
