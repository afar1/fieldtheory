import { describe, it, expect, beforeEach } from 'vitest';
import {
  wrapLines,
  estimateTextCardHeight,
  _resetHeightCacheForTests,
  CARD_PAD,
  CARD_GAP,
  HANDLE_BAND,
  BODY_LINE_HEIGHT,
  QUOTED_LINE_HEIGHT,
  QUOTED_HANDLE_BAND,
  QUOTED_PAD_V,
  QUOTED_MARGIN_TOP,
  QUOTED_GAP,
} from '../utils/bookmarkCardHeight';

beforeEach(() => {
  _resetHeightCacheForTests();
});

describe('wrapLines', () => {
  it('returns 0 for empty text', () => {
    expect(wrapLines('', 10, 100)).toBe(0);
  });

  it('returns 1 for a single short line', () => {
    // 2 chars × 10 = 20px, easily fits in 1000
    expect(wrapLines('hi', 10, 1000)).toBe(1);
  });

  it('wraps to ceil(length * avgCharWidth / maxWidth) lines', () => {
    // 10 chars × 10 = 100px; maxWidth 40 → ceil(100/40) = 3
    expect(wrapLines('abcdefghij', 10, 40)).toBe(3);
  });

  it('treats explicit \\n as separate lines and wraps each one independently', () => {
    // First line 10 chars × 10 = 100px → ceil(100/50)=2; second 2 chars × 10 = 20 → 1. Total 3.
    expect(wrapLines('abcdefghij\nhi', 10, 50)).toBe(3);
  });

  it('counts empty lines from blank newlines', () => {
    expect(wrapLines('a\n\nb', 10, 1000)).toBe(3);
  });

  it('returns a single line when maxWidth <= 0 and text is non-empty', () => {
    expect(wrapLines('hello', 10, 0)).toBe(1);
  });
});

describe('estimateTextCardHeight', () => {
  it('sums padding + handle band + body lines for a plain bookmark', () => {
    // With default AVG_CHAR_WIDTH_BODY=7.5 and bucketWidth(200)=208, bodyMax=164.
    // 3 chars × 7.5 = 22.5px, fits in 1 line.
    const bm = { id: 'a', text: 'abc' };
    const expected = Math.round(CARD_PAD * 2 + HANDLE_BAND + CARD_GAP + 1 * BODY_LINE_HEIGHT);
    expect(estimateTextCardHeight(bm, 200)).toBe(expected);
  });

  it('omits the body block when text is empty', () => {
    const bm = { id: 'empty', text: '' };
    const expected = Math.round(CARD_PAD * 2 + HANDLE_BAND);
    expect(estimateTextCardHeight(bm, 200)).toBe(expected);
  });

  it('adds the quoted block when a quoted tweet is present', () => {
    const bm = {
      id: 'q',
      text: 'top',
      quotedTweet: { text: 'nested' },
    };
    // Body: 3 chars × 7.5 = 22.5px → 1 line; quoted: 6 × 7 = 42px → 1 line.
    const expected = Math.round(
      CARD_PAD * 2 + HANDLE_BAND
      + CARD_GAP + 1 * BODY_LINE_HEIGHT
      + QUOTED_MARGIN_TOP + QUOTED_PAD_V * 2 + QUOTED_HANDLE_BAND + QUOTED_GAP + 1 * QUOTED_LINE_HEIGHT
    );
    expect(estimateTextCardHeight(bm, 200)).toBe(expected);
  });

  it('buckets widths so nearby pixel values share a cached height', () => {
    // Math.round(width / 16) * 16: widths 712..719 all map to bucket 720.
    const bm = { id: 'bucket', text: 'hello world' };
    const baseline = estimateTextCardHeight(bm, 720);
    expect(estimateTextCardHeight(bm, 712)).toBe(baseline);
    expect(estimateTextCardHeight(bm, 715)).toBe(baseline);
    expect(estimateTextCardHeight(bm, 719)).toBe(baseline);
  });

  it('produces different heights across bucket boundaries when wrap counts differ', () => {
    // Long enough text that cutting maxWidth in half changes wrap count.
    const bm = { id: 'boundary', text: 'x'.repeat(60) };
    const wide = estimateTextCardHeight(bm, 400);  // bucket 400
    const narrow = estimateTextCardHeight(bm, 100); // bucket 96
    expect(wide).toBeLessThan(narrow);
  });

  it('returns cached value on repeat calls without recomputation drift', () => {
    const bm = { id: 'cache', text: 'some longer text here' };
    const first = estimateTextCardHeight(bm, 200);
    const second = estimateTextCardHeight(bm, 200);
    expect(first).toBe(second);
  });
});
