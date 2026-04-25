import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import BookmarkCard from '../BookmarkCard';

function makeBookmark(overrides: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'bookmark-1',
    sourceType: 'x',
    text: 'A saved tweet with media',
    url: 'https://x.com/example/status/1',
    authorHandle: 'example',
    authorName: 'Example',
    authorAvatar: '',
    postedAt: '2025-01-17T00:00:00.000Z',
    images: [],
    mediaCount: 0,
    likeCount: 0,
    repostCount: 0,
    bookmarkCount: 0,
    folders: [],
    ...overrides,
  };
}

describe('BookmarkCard media preview', () => {
  it('shows single-image media without cropping it to a fixed tile height', () => {
    const bookmark = makeBookmark({
      images: [{
        url: 'https://example.com/book.jpg',
        width: 800,
        height: 1200,
        type: 'photo',
        localFilename: 'book.jpg',
      }],
    });

    const { container } = render(<BookmarkCard bookmark={bookmark} isDark />);
    const image = container.querySelector('img[src="ftmedia://media/book.jpg"]') as HTMLImageElement | null;
    const mediaFrame = image?.parentElement as HTMLDivElement | null;

    expect(image).not.toBeNull();
    expect(image?.style.objectFit).toBe('contain');
    expect(mediaFrame?.style.height).toBe('');
    expect(mediaFrame?.style.aspectRatio).toBe('800 / 1200');
  });
});
