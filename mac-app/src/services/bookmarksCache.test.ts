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

  afterEach(async () => {
    const { resetBookmarksCacheForTests } = await import('./bookmarksCache');
    resetBookmarksCacheForTests();
    vi.useRealTimers();
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

  it('retains cached data and bounds bursts to one read plus a followup', async () => {
    vi.useFakeTimers();
    let changed = () => {};
    let resolveRead = (_snapshot: BookmarksSnapshot) => {};
    const getAll = vi.fn().mockResolvedValueOnce(initialSnapshot)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRead = resolve; }))
      .mockResolvedValue(updatedSnapshot);
    window.bookmarksAPI = { getAll, onChanged: (callback: () => void) => { changed = callback; return () => {}; } } as unknown as BookmarksAPI;
    const { getBookmarks, peekBookmarks, onBookmarksChanged } = await import('./bookmarksCache');
    await getBookmarks();
    const listener = vi.fn();
    const unsubscribe = onBookmarksChanged(listener);
    for (let i = 0; i < 100; i++) changed();
    expect(peekBookmarks()).toBe(initialSnapshot);
    await vi.advanceTimersByTimeAsync(100);
    expect(getAll).toHaveBeenCalledTimes(2);
    await expect(getBookmarks()).resolves.toBe(initialSnapshot);
    for (let i = 0; i < 100; i++) changed();
    expect(getAll).toHaveBeenCalledTimes(2);
    unsubscribe();
    resolveRead(initialSnapshot);
    await vi.advanceTimersByTimeAsync(0);
    expect(getAll).toHaveBeenCalledTimes(3);
    expect(peekBookmarks()).toBe(updatedSnapshot);
    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps the previous snapshot after a failed read and recovers on the next event', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let changed = () => {};
    const getAll = vi.fn().mockResolvedValueOnce(initialSnapshot)
      .mockRejectedValueOnce(new Error('IPC unavailable')).mockResolvedValue(updatedSnapshot);
    window.bookmarksAPI = { getAll, onChanged: (callback: () => void) => { changed = callback; return () => {}; } } as unknown as BookmarksAPI;
    const { getBookmarks, peekBookmarks } = await import('./bookmarksCache');
    await getBookmarks();
    changed();
    await vi.advanceTimersByTimeAsync(100);
    expect(peekBookmarks()).toBe(initialSnapshot);
    changed();
    await vi.advanceTimersByTimeAsync(100);
    expect(peekBookmarks()).toBe(updatedSnapshot);
  });

  it('does not let an old generation overwrite a reset cache', async () => {
    let resolveRead = (_snapshot: BookmarksSnapshot) => {};
    const unsubscribe = vi.fn();
    const getAll = vi.fn().mockImplementationOnce(() => new Promise((resolve) => { resolveRead = resolve; }))
      .mockResolvedValue(updatedSnapshot);
    window.bookmarksAPI = { getAll, onChanged: () => unsubscribe } as unknown as BookmarksAPI;
    const { getBookmarks, peekBookmarks, resetBookmarksCacheForTests } = await import('./bookmarksCache');
    const oldRead = getBookmarks();
    resetBookmarksCacheForTests();
    await getBookmarks();
    resolveRead(initialSnapshot);
    await oldRead;
    expect(peekBookmarks()).toBe(updatedSnapshot);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

});
