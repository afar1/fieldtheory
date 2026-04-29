import { describe, expect, it } from 'vitest';
import { formatLongBookmarkDate, formatShortBookmarkDate } from '../utils/bookmarkDate';

describe('bookmark date formatting', () => {
  it('formats short dates as MM/DD/YY', () => {
    expect(formatShortBookmarkDate('2026-04-05T12:34:00')).toBe('04/05/26');
  });

  it('formats expanded dates with weekday, date, and time', () => {
    const formatted = formatLongBookmarkDate('2026-04-05T12:34:00');

    expect(formatted).toContain('Sunday, April 5, 2026');
    expect(formatted).toContain('12:34');
  });

  it('returns an empty string for missing or invalid dates', () => {
    expect(formatShortBookmarkDate('')).toBe('');
    expect(formatLongBookmarkDate('not-a-date')).toBe('');
  });
});
