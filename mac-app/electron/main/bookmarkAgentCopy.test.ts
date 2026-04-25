import { describe, expect, it } from 'vitest';
import { buildBookmarkAgentCopyText } from './bookmarkAgentCopy';
import type { Bookmark } from './bookmarksManager';

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'tweet-1',
    sourceType: 'x',
    text: 'Look at this',
    url: 'https://x.com/author/status/tweet-1',
    authorHandle: 'author',
    authorName: 'Author Name',
    authorAvatar: '',
    postedAt: '2026-04-25T12:00:00.000Z',
    images: [],
    mediaCount: 0,
    likeCount: 0,
    repostCount: 0,
    bookmarkCount: 0,
    folders: [],
    ...overrides,
  };
}

describe('buildBookmarkAgentCopyText', () => {
  it('includes bookmark text, url, and local media file paths', () => {
    const text = buildBookmarkAgentCopyText(makeBookmark({
      images: [
        { url: 'https://x/media/1', width: 100, height: 100, type: 'photo', localFilename: 'photo.jpg' },
        { url: 'https://x/media/2', width: 100, height: 100, type: 'video', localFilename: 'poster.jpg', localVideoFilename: 'clip.mp4' },
      ],
    }), '/tmp/bookmark-media');

    expect(text).toContain('Bookmark from Author Name @author');
    expect(text).toContain('Look at this');
    expect(text).toContain('https://x.com/author/status/tweet-1');
    expect(text).toContain('Media files:\n- /tmp/bookmark-media/photo.jpg\n- /tmp/bookmark-media/clip.mp4\n- /tmp/bookmark-media/poster.jpg');
  });

  it('includes quoted tweet media file paths separately', () => {
    const text = buildBookmarkAgentCopyText(makeBookmark({
      quotedTweet: {
        id: 'tweet-2',
        text: 'Quoted text',
        authorHandle: 'quoted',
        authorName: 'Quoted Name',
        authorAvatar: '',
        postedAt: '2026-04-25T12:00:00.000Z',
        url: 'https://x.com/quoted/status/tweet-2',
        images: [
          { url: 'https://x/media/q', width: 100, height: 100, type: 'photo', localFilename: 'quoted.png' },
        ],
      },
    }), '/tmp/bookmark-media');

    expect(text).toContain('Quoted @quoted:\nQuoted text\nhttps://x.com/quoted/status/tweet-2');
    expect(text).toContain('Quoted media files:\n- /tmp/bookmark-media/quoted.png');
  });
});
