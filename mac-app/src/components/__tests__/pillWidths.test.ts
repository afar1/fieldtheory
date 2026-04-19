import { describe, expect, it } from 'vitest';
import {
  computeLeftPillWidth,
  computeRightPillWidth,
  pipeSlotWidthForCount,
} from '../pillWidths';

describe('computeLeftPillWidth', () => {
  it('idle (only hamburger visible) = padding + hamburger', () => {
    const w = computeLeftPillWidth({
      xExpanded: false,
      agentCount: 0,
      hamburgerExpanded: true,
    });
    expect(w).toBe(18 + 22);
  });

  it('0 agents with hamburger hidden collapses to just padding', () => {
    const w = computeLeftPillWidth({
      xExpanded: false,
      agentCount: 0,
      hamburgerExpanded: false,
    });
    expect(w).toBe(18);
  });

  it('adds the X slot (+30) when expanded', () => {
    const base = computeLeftPillWidth({
      xExpanded: false,
      agentCount: 0,
      hamburgerExpanded: true,
    });
    const withX = computeLeftPillWidth({
      xExpanded: true,
      agentCount: 0,
      hamburgerExpanded: true,
    });
    expect(withX - base).toBe(22 + 8);
  });

  it('each agent adds 28 (22 glyph + 6 gap) up to 3', () => {
    const base = computeLeftPillWidth({
      xExpanded: false,
      agentCount: 0,
      hamburgerExpanded: false,
    });
    for (let n = 0; n <= 3; n++) {
      const w = computeLeftPillWidth({
        xExpanded: false,
        agentCount: n,
        hamburgerExpanded: false,
      });
      expect(w - base).toBe(n * 28);
    }
  });

  it('4+ agents caps visible at 3 and adds a +30 overflow slot', () => {
    const three = computeLeftPillWidth({
      xExpanded: false,
      agentCount: 3,
      hamburgerExpanded: false,
    });
    const fourOrMore = computeLeftPillWidth({
      xExpanded: false,
      agentCount: 7,
      hamburgerExpanded: false,
    });
    expect(fourOrMore - three).toBe(24 + 6);
  });

  it('kitchen sink: X + 3 agents + overflow + hamburger fits expected total', () => {
    const w = computeLeftPillWidth({
      xExpanded: true,
      agentCount: 5,
      hamburgerExpanded: true,
    });
    // 18 pad + 30 X + 3*28 agents + 30 overflow + 22 hamburger = 184
    expect(w).toBe(184);
  });
});

describe('computeRightPillWidth', () => {
  it('idle (no waveform, no pipes) = padding only', () => {
    expect(computeRightPillWidth({ waveformActive: false, pipeCount: 0 })).toBe(18);
  });

  it('waveform adds 88 (80 + 8 gap)', () => {
    const base = computeRightPillWidth({ waveformActive: false, pipeCount: 0 });
    const withWave = computeRightPillWidth({ waveformActive: true, pipeCount: 0 });
    expect(withWave - base).toBe(88);
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
