import { describe, expect, it } from 'vitest';
import {
  countAppendedWords,
  getCarouselWordVisual,
  splitDrawerTranscriptForRender,
  summarizeDrawerTranscript,
  summarizeTranscriptForHistory,
  summarizeTranscriptForIsland
} from '../utils/textUtils';

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

describe('summarizeDrawerTranscript', () => {
  it('shows first three and last ten words while leading context is visible', () => {
    const text = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen';
    expect(
      summarizeDrawerTranscript(text, {
        leadingWords: 3,
        trailingWords: 10,
        showLeadingContext: true,
      })
    ).toBe('one two three ... five six seven eight nine ten eleven twelve thirteen fourteen');
  });

  it('shows only trailing ten words with ellipsis when leading context is hidden', () => {
    const text = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen';
    expect(
      summarizeDrawerTranscript(text, {
        trailingWords: 10,
        showLeadingContext: false,
      })
    ).toBe('... five six seven eight nine ten eleven twelve thirteen fourteen');
  });

  it('keeps full text when hidden-leading mode has <= trailing words', () => {
    const text = 'alpha beta gamma';
    expect(
      summarizeDrawerTranscript(text, {
        trailingWords: 10,
        showLeadingContext: false,
      })
    ).toBe('alpha beta gamma');
  });
});

describe('splitDrawerTranscriptForRender', () => {
  it('splits leading/trailing text when ellipsis is present and leading is visible', () => {
    const result = splitDrawerTranscriptForRender(
      'one two three ... five six seven',
      true
    );
    expect(result.leadingText).toBe('one two three');
    expect(result.trailingWords).toEqual(['five', 'six', 'seven']);
    expect(result.hasHiddenPrefix).toBe(false);
  });

  it('hides leading text and shows hidden-prefix marker when collapsed', () => {
    const result = splitDrawerTranscriptForRender(
      'one two three ... five six seven',
      false
    );
    expect(result.leadingText).toBe('');
    expect(result.trailingWords).toEqual(['five', 'six', 'seven']);
    expect(result.hasHiddenPrefix).toBe(true);
  });

  it('treats non-ellipsis text as trailing-only', () => {
    const result = splitDrawerTranscriptForRender('alpha beta gamma', true);
    expect(result.leadingText).toBe('');
    expect(result.trailingWords).toEqual(['alpha', 'beta', 'gamma']);
    expect(result.hasHiddenPrefix).toBe(false);
  });
});

describe('countAppendedWords', () => {
  it('counts appended tail words when transcript extends with same prefix', () => {
    expect(countAppendedWords('one two', 'one two three four')).toBe(2);
  });

  it('caps appended animation count to maxAnimatedWords', () => {
    expect(countAppendedWords('one', 'one two three four five', 3)).toBe(3);
  });

  it('returns zero when transcript does not grow', () => {
    expect(countAppendedWords('one two three', 'one two')).toBe(0);
    expect(countAppendedWords('one two', 'one two')).toBe(0);
  });

  it('treats prefix mismatch as a fresh tail update', () => {
    expect(countAppendedWords('hello world', 'new world now', 3)).toBe(3);
  });
});

describe('getCarouselWordVisual', () => {
  it('gives center-right words higher emphasis than far-left edges', () => {
    const edge = getCarouselWordVisual(0, 9);
    const centerRight = getCarouselWordVisual(6, 9);
    expect(centerRight.opacity).toBeGreaterThan(edge.opacity);
    expect(centerRight.scale).toBeGreaterThan(edge.scale);
    expect(centerRight.blurPx).toBeLessThan(edge.blurPx);
  });

  it('biases mirrored slots toward the right side', () => {
    const left = getCarouselWordVisual(1, 9);
    const right = getCarouselWordVisual(7, 9);
    expect(right.opacity).toBeGreaterThan(left.opacity);
    expect(right.scale).toBeGreaterThan(left.scale);
    expect(right.blurPx).toBeLessThan(left.blurPx);
  });

  it('clamps single-word case to max emphasis', () => {
    const single = getCarouselWordVisual(0, 1);
    expect(single.opacity).toBe(0.92);
    expect(single.scale).toBe(1);
    expect(single.blurPx).toBe(0);
  });
});
