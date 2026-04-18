import { describe, it, expect } from 'vitest';
import { parseRawBookmark, type RawBookmark } from './bookmarksManager';

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
