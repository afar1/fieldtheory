import { describe, expect, it } from 'vitest';
import { summarizeTranscriptForHistory, summarizeTranscriptForIsland } from '../utils/textUtils';

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

describe('summarizeTranscriptForHistory', () => {
  it('documents that history previews keep leading context and append inline ellipsis + last five words', () => {
    const text = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty';
    expect(summarizeTranscriptForHistory(text, 4, 5, 3)).toBe(
      'One two three four five six ... sixteen seventeen eighteen nineteen twenty'
    );
  });

  it('returns full text when there is not enough content to truncate', () => {
    const text = 'alpha beta gamma delta epsilon zeta eta theta';
    expect(summarizeTranscriptForHistory(text, 4, 5, 3)).toBe('Alpha beta gamma delta epsilon zeta eta theta');
  });

  it('normalizes whitespace in history previews', () => {
    const text = '  one   two   three four   five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen  ';
    expect(summarizeTranscriptForHistory(text, 4, 5, 3)).toBe(
      'One two three four five six ... twelve thirteen fourteen fifteen sixteen'
    );
  });

  it('capitalizes the first letter while leaving the rest unchanged', () => {
    const text = 'hello WORLD this IS mixed';
    expect(summarizeTranscriptForHistory(text, 20, 5, 3)).toBe('Hello WORLD this IS mixed');
  });
});
