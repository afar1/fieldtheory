import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updatedSnapshot: BookmarksSnapshot = {
  bookmarks: [{
    id: 'bookmark-1',
    sourceType: 'x',
    text: 'Saved thought',
    url: 'https://x.com/example/status/1',
    authorHandle: 'example',
    authorName: 'Example',
    authorAvatar: '',
    postedAt: '2026-01-17T00:00:00.000Z',
    images: [],
    mediaCount: 0,
    likeCount: 0,
    repostCount: 0,
    bookmarkCount: 0,
    folders: [],
  }],
  folders: [],
  xLastSyncedAt: null,
};

const initialSnapshot: BookmarksSnapshot = {
  bookmarks: [{
    ...updatedSnapshot.bookmarks[0],
    id: 'bookmark-0',
    text: 'Earlier saved thought',
  }],
  folders: [],
  xLastSyncedAt: null,
};

function invokeNativeChanged(callback: (() => void) | null): void {
  if (!callback) throw new Error('Expected native bookmark change callback');
  callback();
}

describe('bookmarksCache', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete window.bookmarksAPI;
    vi.restoreAllMocks();
  });

  it('attaches the native bookmark listener when a consumer subscribes to changes', async () => {
    let nativeChanged: (() => void) | null = null;
    const getAll = vi.fn().mockResolvedValue(updatedSnapshot);
    window.bookmarksAPI = {
      getAll,
      syncIfStale: vi.fn(async () => ({ status: 'ok' })),
      getAuthors: vi.fn(async () => []),
      getAuthorBookmarks: vi.fn(async () => []),
      getTaxonomyBookmarks: vi.fn(async () => []),
      search: vi.fn(async () => []),
      saveWebUrl: vi.fn(async () => ({ success: true })),
      getActiveWebPage: vi.fn(async () => ({ success: false })),
      saveActiveWebPage: vi.fn(async () => ({ success: false })),
      invokeBookmark: vi.fn(async () => ({ success: true })),
      copyForAgent: vi.fn(async () => ({ success: true })),
      invokeAuthorTimeline: vi.fn(async () => ({ success: true })),
      onChanged: vi.fn((callback: () => void) => {
        nativeChanged = callback;
        return vi.fn();
      }),
    };

    const { onBookmarksChanged } = await import('./bookmarksCache');
    const listener = vi.fn();

    onBookmarksChanged(listener);

    expect(window.bookmarksAPI.onChanged).toHaveBeenCalledTimes(1);
    invokeNativeChanged(nativeChanged);

    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledWith(updatedSnapshot);
    });
    expect(getAll).toHaveBeenCalledTimes(1);
  });

  it('refreshes a prefetched snapshot when native bookmarks change before the pane reopens', async () => {
    let nativeChanged: (() => void) | null = null;
    const getAll = vi.fn()
      .mockResolvedValueOnce(initialSnapshot)
      .mockResolvedValueOnce(updatedSnapshot);
    window.bookmarksAPI = {
      getAll,
      syncIfStale: vi.fn(async () => ({ status: 'ok' })),
      getAuthors: vi.fn(async () => []),
      getAuthorBookmarks: vi.fn(async () => []),
      getTaxonomyBookmarks: vi.fn(async () => []),
      search: vi.fn(async () => []),
      saveWebUrl: vi.fn(async () => ({ success: true })),
      getActiveWebPage: vi.fn(async () => ({ success: false })),
      saveActiveWebPage: vi.fn(async () => ({ success: false })),
      invokeBookmark: vi.fn(async () => ({ success: true })),
      copyForAgent: vi.fn(async () => ({ success: true })),
      invokeAuthorTimeline: vi.fn(async () => ({ success: true })),
      onChanged: vi.fn((callback: () => void) => {
        nativeChanged = callback;
        return vi.fn();
      }),
    };

    const { getBookmarks, peekBookmarks } = await import('./bookmarksCache');

    await expect(getBookmarks()).resolves.toBe(initialSnapshot);
    expect(peekBookmarks()).toBe(initialSnapshot);

    invokeNativeChanged(nativeChanged);

    await vi.waitFor(() => {
      expect(peekBookmarks()).toBe(updatedSnapshot);
    });
    await expect(getBookmarks()).resolves.toBe(updatedSnapshot);
    expect(getAll).toHaveBeenCalledTimes(2);
  });
});
