import { describe, expect, it } from 'vitest';
import { summarizeTranscriptForIsland } from '../utils/textUtils';

describe('summarizeTranscriptForIsland', () => {
  it('returns empty string for blank input', () => {
    expect(summarizeTranscriptForIsland('')).toBe('');
    expect(summarizeTranscriptForIsland('   ')).toBe('');
  });

  it('keeps full text when at or below threshold', () => {
    const tenWords = 'one two three four five six seven eight nine ten';
    expect(summarizeTranscriptForIsland(tenWords)).toBe(tenWords);
  });

  it('shows first five and last five words when above threshold', () => {
    const text = 'one two three four five six seven eight nine ten eleven';
    expect(summarizeTranscriptForIsland(text)).toBe(
      'one two three four five ... seven eight nine ten eleven'
    );
  });

  it('normalizes repeated whitespace', () => {
    const text = '  one   two   three    four five six seven eight nine ten eleven  ';
    expect(summarizeTranscriptForIsland(text)).toBe(
      'one two three four five ... seven eight nine ten eleven'
    );
  });

  it('supports custom edge word counts', () => {
    const text = 'alpha beta gamma delta epsilon zeta eta theta';
    expect(summarizeTranscriptForIsland(text, 3)).toBe(
      'alpha beta gamma ... zeta eta theta'
    );
  });

  it('supports asymmetric leading and trailing word counts', () => {
    const text = 'one two three four five six seven eight nine ten eleven';
    expect(summarizeTranscriptForIsland(text, 3, 7)).toBe(
      'one two three ... five six seven eight nine ten eleven'
    );
  });
});
