import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { BookmarksManager, parseRawBookmark, type RawBookmark } from './bookmarksManager';

vi.mock('./logger', () => ({
  createLogger: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
}));

describe('parseRawBookmark', () => {
  it('extracts photos with dimensions and picks highest-bitrate mp4 for videos', () => {
    const raw: RawBookmark = {
      tweetId: '123',
      text: 'hello',
      authorHandle: 'jsngr',
      authorName: 'Jordan',
      authorProfileImageUrl: 'https://example/avatar.jpg',
      postedAt: 'Wed Apr 15 15:00:16 +0000 2026',
      url: 'https://x.com/jsngr/status/123',
      media: ['a', 'b'],
      mediaObjects: [
        { type: 'photo', url: 'https://pbs/photo.jpg', width: 1822, height: 1952 },
        {
          type: 'video',
          url: 'https://pbs/thumb.jpg',
          width: 1280,
          height: 720,
          videoVariants: [
            { url: 'https://v/low.mp4', bitrate: 320000 },
            { url: 'https://v/high.mp4', bitrate: 2176000 },
            { url: 'https://v/stream.m3u8', bitrate: 0 },
          ],
        },
      ],
      engagement: { likeCount: 10, repostCount: 2, bookmarkCount: 1 },
    };

    const bm = parseRawBookmark(raw);
    expect(bm).not.toBeNull();
    expect(bm!.id).toBe('123');
    expect(bm!.images).toHaveLength(2);
    expect(bm!.images[0]).toMatchObject({ type: 'photo', width: 1822, height: 1952 });
    expect(bm!.images[1].type).toBe('video');
    expect(bm!.images[1].videoUrl).toBe('https://v/high.mp4');
    expect(bm!.mediaCount).toBe(2);
    expect(bm!.likeCount).toBe(10);
    expect(bm!.folders).toEqual([]);
  });

  it('returns null when both id and tweetId are missing', () => {
    expect(parseRawBookmark({ text: 'orphan' })).toBeNull();
  });

  it('synthesizes a URL when one is missing', () => {
    const bm = parseRawBookmark({ tweetId: '456', authorHandle: 'alice' });
    expect(bm!.url).toBe('https://x.com/alice/status/456');
  });

  it('parses quotedTweet when present', () => {
    const bm = parseRawBookmark({
      tweetId: 'outer1',
      text: 'check this out',
      quotedTweet: {
        id: 'inner9',
        text: 'quoted content',
        authorHandle: 'alice',
        authorName: 'Alice',
        authorProfileImageUrl: 'https://pbs/a.jpg',
        postedAt: 'Mon Jan 1 12:00:00 +0000 2026',
        mediaObjects: [{ type: 'photo', url: 'https://pbs/q.jpg', width: 800, height: 600 }],
      },
    });
    expect(bm!.quotedTweet).toBeDefined();
    expect(bm!.quotedTweet!.id).toBe('inner9');
    expect(bm!.quotedTweet!.authorHandle).toBe('alice');
    expect(bm!.quotedTweet!.images).toHaveLength(1);
    expect(bm!.quotedTweet!.url).toBe('https://x.com/alice/status/inner9');
  });

  it('leaves quotedTweet undefined when raw lacks one or its id', () => {
    expect(parseRawBookmark({ tweetId: 'a', text: 'no quote' })!.quotedTweet).toBeUndefined();
    expect(parseRawBookmark({
      tweetId: 'a',
      text: 'missing id quote',
      quotedTweet: { text: 'orphan' },
    })!.quotedTweet).toBeUndefined();
  });

  it('ignores non-media mediaObjects', () => {
    const bm = parseRawBookmark({
      tweetId: '789',
      mediaObjects: [
        { type: 'photo', url: 'https://pbs/p.jpg', width: 100, height: 100 },
        { type: 'unknown', url: 'https://pbs/x.jpg' } as unknown as RawBookmark['mediaObjects'] extends (infer U)[] ? U : never,
        { type: 'photo' }, // missing url
      ],
    });
    expect(bm!.images).toHaveLength(1);
  });
});

describe('BookmarksManager.getSnapshot', () => {
  let tmpDir: string;
  let origDataDir: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bm-test-'));
    origDataDir = process.env.FT_DATA_DIR;
    process.env.FT_DATA_DIR = tmpDir;
  });

  afterEach(() => {
    if (origDataDir === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = origDataDir;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns an empty snapshot when no jsonl exists', () => {
    const mgr = new BookmarksManager();
    expect(mgr.getSnapshot()).toEqual({ bookmarks: [], folders: [] });
  });

  it('parses JSONL, skips malformed lines, and merges folder assignments', () => {
    const jsonlLines = [
      JSON.stringify({
        tweetId: 'a1',
        text: 'first',
        authorHandle: 'alice',
        postedAt: 'Wed Apr 10 00:00:00 +0000 2026',
        mediaObjects: [{ type: 'photo', url: 'https://pbs/a.jpg', width: 10, height: 10 }],
      }),
      '{not valid json',
      JSON.stringify({
        tweetId: 'b2',
        text: 'second',
        authorHandle: 'bob',
        postedAt: 'Wed Apr 15 00:00:00 +0000 2026',
      }),
      '',
    ];
    fs.writeFileSync(path.join(tmpDir, 'bookmarks.jsonl'), jsonlLines.join('\n'));
    fs.writeFileSync(
      path.join(tmpDir, 'folders-data.json'),
      JSON.stringify({
        folders: [{ name: 'ai' }, { name: 'design' }],
        folderMap: { a1: ['ai', 'design'], b2: ['design'] },
      })
    );

    const mgr = new BookmarksManager();
    const snap = mgr.getSnapshot();

    expect(snap.bookmarks).toHaveLength(2);
    // Sorted newest-first by postedAt
    expect(snap.bookmarks[0].id).toBe('b2');
    expect(snap.bookmarks[1].id).toBe('a1');
    expect(snap.bookmarks[0].folders).toEqual(['design']);
    expect(snap.bookmarks[1].folders).toEqual(['ai', 'design']);
    expect(snap.folders.map((f) => f.name)).toEqual(['ai', 'design']);
  });

  it('caches snapshots across calls', () => {
    fs.writeFileSync(path.join(tmpDir, 'bookmarks.jsonl'), JSON.stringify({ tweetId: 'x' }) + '\n');
    const mgr = new BookmarksManager();
    const first = mgr.getSnapshot();
    const second = mgr.getSnapshot();
    // Reference-equal proves we hit the cache, not re-read the file.
    expect(second).toBe(first);
  });

  it('attaches exact local files for multi-image and quoted-tweet media from the manifest', () => {
    fs.mkdirSync(path.join(tmpDir, 'media'));
    fs.writeFileSync(
      path.join(tmpDir, 'media-manifest.json'),
      JSON.stringify({
        entries: [
          {
            tweetId: 'outer1',
            sourceUrl: 'https://pbs/a.jpg',
            localPath: path.join(tmpDir, 'media', 'outer1-a.jpg'),
            status: 'downloaded',
          },
          {
            tweetId: 'outer1',
            sourceUrl: 'https://pbs/b.jpg',
            localPath: path.join(tmpDir, 'media', 'outer1-b.jpg'),
            status: 'downloaded',
          },
          {
            tweetId: 'quoted9',
            sourceUrl: 'https://pbs/q.jpg',
            localPath: path.join(tmpDir, 'media', 'quoted9-q.jpg'),
            status: 'downloaded',
          },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(tmpDir, 'bookmarks.jsonl'),
      JSON.stringify({
        tweetId: 'outer1',
        text: 'with multiple images',
        authorHandle: 'alice',
        mediaObjects: [
          { type: 'photo', url: 'https://pbs/a.jpg', width: 800, height: 600 },
          { type: 'photo', url: 'https://pbs/b.jpg', width: 1200, height: 900 },
        ],
        quotedTweet: {
          id: 'quoted9',
          text: 'quoted image',
          authorHandle: 'bob',
          mediaObjects: [
            { type: 'photo', url: 'https://pbs/q.jpg', width: 640, height: 640 },
          ],
        },
      }) + '\n',
    );

    const mgr = new BookmarksManager();
    const snap = mgr.getSnapshot();

    expect(snap.bookmarks).toHaveLength(1);
    expect(snap.bookmarks[0].images.map((img) => img.localFilename)).toEqual(['outer1-a.jpg', 'outer1-b.jpg']);
    expect(snap.bookmarks[0].quotedTweet?.images.map((img) => img.localFilename)).toEqual(['quoted9-q.jpg']);
  });

  it('routes profile_images to localAvatarFilename and never leaks them into tweet media', () => {
    fs.mkdirSync(path.join(tmpDir, 'media'));
    fs.writeFileSync(
      path.join(tmpDir, 'media-manifest.json'),
      JSON.stringify({
        entries: [
          // Profile image listed BEFORE the tweet's own media — this is the order
          // that used to "win" the fallback slot and show up as a bogus grid tile.
          {
            tweetId: 'p1',
            sourceUrl: 'https://pbs.twimg.com/profile_images/123/avatar.jpg',
            localPath: path.join(tmpDir, 'media', 'avatar-hash.jpg'),
            status: 'downloaded',
            authorHandle: 'alice',
          },
          {
            tweetId: 'p1',
            sourceUrl: 'https://pbs/photo-variant-that-differs.jpg',
            localPath: path.join(tmpDir, 'media', 'p1-photo.jpg'),
            status: 'downloaded',
          },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(tmpDir, 'bookmarks.jsonl'),
      JSON.stringify({
        tweetId: 'p1',
        text: 'single image tweet',
        authorHandle: 'alice',
        authorProfileImageUrl: 'https://pbs.twimg.com/profile_images/123/avatar.jpg',
        mediaObjects: [
          // URL deliberately differs from the manifest entry so the fallback path kicks in.
          { type: 'photo', url: 'https://pbs/photo-original.jpg', width: 800, height: 600 },
        ],
      }) + '\n',
    );

    const mgr = new BookmarksManager();
    const snap = mgr.getSnapshot();

    expect(snap.bookmarks).toHaveLength(1);
    expect(snap.bookmarks[0].localAvatarFilename).toBe('avatar-hash.jpg');
    // Fallback now picks the real tweet media, not the profile image.
    expect(snap.bookmarks[0].images[0].localFilename).toBe('p1-photo.jpg');
  });

  it('does not attach mp4 files as image previews', () => {
    fs.mkdirSync(path.join(tmpDir, 'media'));
    fs.writeFileSync(
      path.join(tmpDir, 'media-manifest.json'),
      JSON.stringify({
        entries: [
          {
            tweetId: 'vid1',
            sourceUrl: 'https://video.example/vid1.mp4',
            localPath: path.join(tmpDir, 'media', 'vid1-video.mp4'),
            status: 'downloaded',
          },
        ],
      }),
    );
    fs.writeFileSync(
      path.join(tmpDir, 'bookmarks.jsonl'),
      JSON.stringify({
        tweetId: 'vid1',
        text: 'video only',
        authorHandle: 'alice',
        mediaObjects: [
          {
            type: 'video',
            url: 'https://pbs/thumb.jpg',
            width: 1280,
            height: 720,
            videoVariants: [{ url: 'https://video.example/vid1.mp4', bitrate: 1000 }],
          },
        ],
      }) + '\n',
    );

    const mgr = new BookmarksManager();
    const snap = mgr.getSnapshot();

    expect(snap.bookmarks).toHaveLength(1);
    expect(snap.bookmarks[0].images[0].localFilename).toBeUndefined();
    expect(snap.bookmarks[0].images[0].localVideoFilename).toBe('vid1-video.mp4');
  });
});
