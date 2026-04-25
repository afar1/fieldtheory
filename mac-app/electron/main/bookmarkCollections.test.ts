import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Bookmark } from './bookmarksManager';
import { bookmarksForTaxonomyFiles, extractBookmarkSourceKeys, searchBookmarks } from './bookmarkCollections';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-bookmark-collections-'));
  tempDirs.push(dir);
  return dir;
}

function bookmark(overrides: Partial<Bookmark>): Bookmark {
  return {
    id: overrides.id ?? '1',
    sourceType: 'x',
    text: overrides.text ?? '',
    url: overrides.url ?? `https://x.com/a/status/${overrides.id ?? '1'}`,
    authorHandle: overrides.authorHandle ?? 'a',
    authorName: overrides.authorName ?? 'A',
    authorAvatar: '',
    postedAt: overrides.postedAt ?? '2026-01-01T00:00:00Z',
    images: [],
    mediaCount: 0,
    likeCount: 0,
    repostCount: 0,
    bookmarkCount: 0,
    folders: overrides.folders ?? [],
    quotedTweet: overrides.quotedTweet,
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('extractBookmarkSourceKeys', () => {
  it('extracts unique x.com status keys from taxonomy markdown', () => {
    const keys = extractBookmarkSourceKeys([
      '[source](https://x.com/alice/status/123)',
      '[source](https://twitter.com/alice/status/123)',
      '[source](https://x.com/bob/status/456).',
    ].join('\n'));

    expect(keys).toEqual(['tweet:123', 'tweet:456']);
  });
});

describe('bookmarksForTaxonomyFiles', () => {
  it('matches bookmark posts from generated taxonomy source links', () => {
    const dir = makeTempDir();
    const libraryDir = path.join(dir, '.fieldtheory', 'library', 'categories');
    fs.mkdirSync(libraryDir, { recursive: true });
    const filePath = path.join(libraryDir, 'commerce.md');
    fs.writeFileSync(filePath, [
      '[source](https://x.com/alice/status/123)',
      '[source](https://x.com/bob/status/456)',
    ].join('\n'));

    const matches = bookmarksForTaxonomyFiles([filePath], [
      bookmark({ id: '456', text: 'second' }),
      bookmark({ id: '123', text: 'first' }),
      bookmark({ id: '789', text: 'other' }),
    ]);

    expect(matches.map((item) => item.id)).toEqual(['123', '456']);
  });
});

describe('searchBookmarks', () => {
  it('searches bookmark text, authors, urls, and folders newest first', () => {
    const matches = searchBookmarks('commerce', [
      bookmark({ id: '1', text: 'commerce note', postedAt: '2026-01-01T00:00:00Z' }),
      bookmark({ id: '2', authorName: 'Commerce Writer', postedAt: '2026-02-01T00:00:00Z' }),
      bookmark({ id: '3', text: 'unrelated', postedAt: '2026-03-01T00:00:00Z' }),
    ]);

    expect(matches.map((item) => item.id)).toEqual(['2', '1']);
  });
});
