import { afterEach, describe, it, expect } from 'vitest';
import { localAvatarUrl, localMediaUrl, localMediaUrls, localVideoUrl } from '../utils/bookmarkMedia';

afterEach(() => {
  delete window.fieldTheoryBookmarkMediaAPI;
});

describe('localMediaUrl', () => {
  it('returns null when image is undefined', () => {
    expect(localMediaUrl(undefined)).toBeNull();
  });

  it('returns null when localFilename is missing', () => {
    expect(localMediaUrl({ url: 'https://x', width: 1, height: 1, type: 'photo' })).toBeNull();
  });

  it('returns a ftmedia:// URL when localFilename is present', () => {
    expect(
      localMediaUrl({
        url: 'https://x',
        width: 1,
        height: 1,
        type: 'photo',
        localFilename: '12345-abcdef.jpg',
      })
    ).toBe('ftmedia://media/12345-abcdef.jpg');
  });

  it('encodes fallback ftmedia:// filenames', () => {
    expect(
      localMediaUrl({
        url: 'https://x',
        width: 1,
        height: 1,
        type: 'photo',
        localFilename: 'saved image 1.jpg',
      })
    ).toBe('ftmedia://media/saved%20image%201.jpg');
  });

  it('uses the browser helper media resolver when present', () => {
    window.fieldTheoryBookmarkMediaAPI = {
      mediaUrl: (filename) => `http://127.0.0.1:59971/native/bookmarks/media/${filename}?token=test-token`,
    };

    expect(
      localMediaUrl({
        url: 'https://x',
        width: 1,
        height: 1,
        type: 'photo',
        localFilename: '12345-abcdef.jpg',
      })
    ).toBe('http://127.0.0.1:59971/native/bookmarks/media/12345-abcdef.jpg?token=test-token');
  });
});

describe('localMediaUrls', () => {
  it('returns local URLs in order and skips images without local files', () => {
    expect(localMediaUrls([
      { url: 'https://x/1', width: 1, height: 1, type: 'photo', localFilename: 'first.jpg' },
      { url: 'https://x/2', width: 1, height: 1, type: 'photo' },
      { url: 'https://x/3', width: 1, height: 1, type: 'photo', localFilename: 'third.jpg' },
    ])).toEqual([
      'ftmedia://media/first.jpg',
      'ftmedia://media/third.jpg',
    ]);
  });
});

describe('localVideoUrl', () => {
  it('returns null when localVideoFilename is missing', () => {
    expect(localVideoUrl({ url: 'https://x', width: 1, height: 1, type: 'video' })).toBeNull();
  });

  it('returns a ftmedia:// URL when localVideoFilename is present', () => {
    expect(localVideoUrl({
      url: 'https://x',
      width: 1,
      height: 1,
      type: 'video',
      localVideoFilename: '12345-video.mp4',
    })).toBe('ftmedia://media/12345-video.mp4');
  });
});

describe('localAvatarUrl', () => {
  it('returns null when source is undefined or has no avatar file', () => {
    expect(localAvatarUrl(undefined)).toBeNull();
    expect(localAvatarUrl({})).toBeNull();
  });

  it('returns a ftmedia:// URL when localAvatarFilename is present', () => {
    expect(localAvatarUrl({ localAvatarFilename: 'avatar-hash.jpg' }))
      .toBe('ftmedia://media/avatar-hash.jpg');
  });
});
