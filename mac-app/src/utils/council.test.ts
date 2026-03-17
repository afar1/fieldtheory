import { describe, expect, it } from 'vitest';

import {
  clampCouncilMaxTurns,
  COUNCIL_STALL_ERROR_MS,
  COUNCIL_STALL_WARNING_MS,
  DEFAULT_COUNCIL_MAX_TURNS,
  formatCouncilMatchup,
  formatCouncilElapsed,
  getCouncilSpeakerColor,
  getCouncilTurnActivityState,
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

describe('formatCouncilElapsed', () => {
  it('formats seconds and minutes compactly', () => {
    expect(formatCouncilElapsed(9_800)).toBe('9s');
    expect(formatCouncilElapsed(64_000)).toBe('1m 4s');
    expect(formatCouncilElapsed(12 * 60_000)).toBe('12m');
  });
});

describe('getCouncilTurnActivityState', () => {
  it('shows a working warmup state before the first output', () => {
    const state = getCouncilTurnActivityState({
      speaker: 'Opus',
      startedAtMs: 1_000,
      lastOutputAtMs: null,
      hasOutput: false,
      nowMs: 6_000,
    });

    expect(state.tone).toBe('working');
    expect(state.detail).toContain('Waiting for first output');
  });

  it('warns when a turn has been silent for longer than the warning threshold', () => {
    const state = getCouncilTurnActivityState({
      speaker: 'Codex',
      startedAtMs: 0,
      lastOutputAtMs: null,
      hasOutput: false,
      nowMs: COUNCIL_STALL_WARNING_MS + 5_000,
    });

    expect(state.tone).toBe('warning');
    expect(state.headline).toContain('taking longer than usual');
  });

  it('shows an error state for a likely stall after output has stopped for too long', () => {
    const state = getCouncilTurnActivityState({
      speaker: 'Sonnet',
      startedAtMs: 0,
      lastOutputAtMs: 5_000,
      hasOutput: true,
      nowMs: 5_000 + COUNCIL_STALL_ERROR_MS + 1_000,
    });

    expect(state.tone).toBe('error');
    expect(state.headline).toContain('Possible stall');
  });

  it('surfaces the latest explicit error immediately', () => {
    const state = getCouncilTurnActivityState({
      speaker: 'Opus',
      startedAtMs: 0,
      lastOutputAtMs: 2_000,
      hasOutput: true,
      latestError: 'Timed out after 300s',
      nowMs: 10_000,
    });

    expect(state.tone).toBe('error');
    expect(state.detail).toBe('Timed out after 300s');
  });
});
