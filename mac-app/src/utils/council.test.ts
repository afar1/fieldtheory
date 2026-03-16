import { describe, expect, it } from 'vitest';

import {
  clampCouncilMaxTurns,
  DEFAULT_COUNCIL_MAX_TURNS,
  formatCouncilMatchup,
  getCouncilSpeakerColor,
} from './council';

describe('formatCouncilMatchup', () => {
  it('formats known matchup labels from the shared options table', () => {
    expect(formatCouncilMatchup('opus-vs-codex')).toBe('Opus vs Codex');
    expect(formatCouncilMatchup('codex-vs-sonnet')).toBe('Codex vs Sonnet');
  });

  it('falls back to title-casing unknown matchup strings', () => {
    expect(formatCouncilMatchup('custom-vs-model')).toBe('Custom vs Model');
  });
});

describe('clampCouncilMaxTurns', () => {
  it('clamps to the supported range', () => {
    expect(clampCouncilMaxTurns(-4)).toBe(0);
    expect(clampCouncilMaxTurns(4.6)).toBe(5);
    expect(clampCouncilMaxTurns(200)).toBe(20);
  });

  it('falls back to the shared default for non-finite values', () => {
    expect(clampCouncilMaxTurns(Number.NaN)).toBe(DEFAULT_COUNCIL_MAX_TURNS);
  });
});

describe('getCouncilSpeakerColor', () => {
  it('maps current speaker labels, including A/B variants, to stable palettes', () => {
    expect(getCouncilSpeakerColor('Opus')).toEqual(getCouncilSpeakerColor('Opus A'));
    expect(getCouncilSpeakerColor('Sonnet B')).toEqual({
      bg: '#4a3415',
      text: '#fcd34d',
      border: '#f59e0b',
    });
    expect(getCouncilSpeakerColor('Codex')).toEqual({
      bg: '#1a3d2e',
      text: '#86efac',
      border: '#22c55e',
    });
  });
});
