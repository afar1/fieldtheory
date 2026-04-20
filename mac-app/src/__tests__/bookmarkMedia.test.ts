import { describe, it, expect } from 'vitest';
import { localMediaUrl } from '../utils/bookmarkMedia';

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
});
