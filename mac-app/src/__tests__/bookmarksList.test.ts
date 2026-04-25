import { describe, expect, it } from 'vitest';
import {
  estimateDefaultRowHeight,
  estimateRowHeight,
  getHeightCacheKey,
} from '../components/BookmarksList';

function makeBookmark(text: string, id = 'bm-1'): Bookmark {
  return {
    id,
    sourceType: 'x',
    text,
    url: 'https://x.com/test/status/1',
    authorHandle: 'test',
    authorName: 'Test Author',
    authorAvatar: '',
    postedAt: 'Sun Apr 19 22:38:01 +0000 2026',
    images: [],
    mediaCount: 0,
    likeCount: 0,
    repostCount: 0,
    bookmarkCount: 0,
    folders: [],
  };
}

describe('estimateRowHeight', () => {
  it('adds height for explicit blank lines in bookmark text', () => {
    const singleParagraph = makeBookmark('a b');
    const multiParagraph = makeBookmark('a\n\nb');

    expect(estimateRowHeight(multiParagraph)).toBeGreaterThan(estimateRowHeight(singleParagraph));
  });
});

describe('estimateDefaultRowHeight', () => {
  it('falls back to a sane default for an empty list', () => {
    expect(estimateDefaultRowHeight([])).toBe(160);
  });
});

describe('getHeightCacheKey', () => {
  it('changes when bookmark order changes so measured heights do not stick to the wrong rows', () => {
    const a = makeBookmark('first', 'a');
    const b = makeBookmark('second', 'b');

    expect(getHeightCacheKey([a, b])).not.toBe(getHeightCacheKey([b, a]));
  });
});
