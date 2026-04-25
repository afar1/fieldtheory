import { describe, expect, it } from 'vitest';
import {
  bookmarksForAuthor,
  buildBookmarkAuthorSummaries,
  bookmarkById,
  formatBookmarkAuthorTimeline,
  formatBookmarkPost,
  normalizeBookmarkAuthorHandle,
} from './bookmarkAuthorTimeline';
import type { Bookmark } from './bookmarksManager';

function bookmark(overrides: Partial<Bookmark>): Bookmark {
  return {
    id: overrides.id ?? 'id',
    sourceType: 'x',
    text: overrides.text ?? '',
    url: overrides.url ?? '',
    authorHandle: overrides.authorHandle ?? '',
    authorName: overrides.authorName ?? '',
    authorAvatar: '',
    postedAt: overrides.postedAt ?? '',
    images: [],
    mediaCount: 0,
    likeCount: 0,
    repostCount: 0,
    bookmarkCount: 0,
    folders: [],
    quotedTweet: overrides.quotedTweet,
  };
}

describe('bookmark author timeline helpers', () => {
  it('normalizes handles for case-insensitive author lookup', () => {
    expect(normalizeBookmarkAuthorHandle('@CJHandmer')).toBe('cjhandmer');
    expect(normalizeBookmarkAuthorHandle(' cjhandmer ')).toBe('cjhandmer');
  });

  it('builds one summary per author handle', () => {
    const summaries = buildBookmarkAuthorSummaries([
      bookmark({ id: '1', authorHandle: 'CJHandmer', authorName: 'CJ', postedAt: '2026-01-03T00:00:00Z' }),
      bookmark({ id: '2', authorHandle: '@cjhandmer', authorName: 'CJ Handmer', postedAt: '2026-01-01T00:00:00Z' }),
      bookmark({ id: '3', authorHandle: 'jh3yy', authorName: 'Jhey', postedAt: '2026-01-02T00:00:00Z' }),
    ]);

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({
      handle: 'CJHandmer',
      name: 'CJ',
      count: 2,
      firstPostedAt: '2026-01-01T00:00:00Z',
      lastPostedAt: '2026-01-03T00:00:00Z',
    });
  });

  it('returns an authors bookmarks oldest-first', () => {
    const bookmarks = [
      bookmark({ id: 'new', authorHandle: 'alice', postedAt: '2026-01-03T00:00:00Z' }),
      bookmark({ id: 'old', authorHandle: 'Alice', postedAt: '2026-01-01T00:00:00Z' }),
    ];

    expect(bookmarksForAuthor('@alice', bookmarks).map((item) => item.id)).toEqual(['old', 'new']);
  });

  it('finds a bookmark by id', () => {
    const bookmarks = [
      bookmark({ id: 'first' }),
      bookmark({ id: 'second' }),
    ];

    expect(bookmarkById('second', bookmarks)?.id).toBe('second');
    expect(bookmarkById('missing', bookmarks)).toBeNull();
  });

  it('formats a single bookmark for paste', () => {
    const text = formatBookmarkPost(bookmark({
      id: '1',
      authorHandle: 'alice',
      authorName: 'Alice',
      text: 'First post',
      postedAt: '2026-01-01T00:00:00Z',
      url: 'https://x.com/alice/status/1',
    }));

    expect(text).toContain('# 2026-01-01 - Alice (@alice)');
    expect(text).toContain('First post');
    expect(text).toContain('https://x.com/alice/status/1');
  });

  it('formats a pasteable chronological markdown timeline', () => {
    const timeline = formatBookmarkAuthorTimeline('@alice', [
      bookmark({
        id: '2',
        authorHandle: 'alice',
        authorName: 'Alice',
        text: 'Second post',
        postedAt: '2026-01-02T00:00:00Z',
        url: 'https://x.com/alice/status/2',
      }),
      bookmark({
        id: '1',
        authorHandle: 'alice',
        authorName: 'Alice',
        text: 'First post',
        postedAt: '2026-01-01T00:00:00Z',
        url: 'https://x.com/alice/status/1',
      }),
    ]);

    expect(timeline).toContain('# Bookmarked posts from Alice (@alice)');
    expect(timeline).toMatch(/1\. 2026-01-01 - @alice[\s\S]*First post[\s\S]*2\. 2026-01-02 - @alice[\s\S]*Second post/);
  });
});
