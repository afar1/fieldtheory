import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BookmarksPane from '../BookmarksPane';
import { resetBookmarksCacheForTests } from '../../services/bookmarksCache';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({
    theme: {
      bg: '#ffffff',
      border: '#d1d5db',
      hoverBg: '#f3f4f6',
      isDark: false,
      surface1: '#ffffff',
      text: '#111827',
      textSecondary: '#6b7280',
    },
  }),
}));

vi.mock('../BookmarksList', () => ({
  default: () => <div data-testid="bookmarks-list">List</div>,
}));

vi.mock('../BookmarksCanvas', () => ({
  default: () => <div data-testid="bookmarks-canvas">Canvas</div>,
}));

const bookmark: Bookmark = {
  id: 'bookmark-1',
  sourceType: 'x',
  text: 'A saved note',
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
};

describe('BookmarksPane native preference sync', () => {
  beforeEach(() => {
    resetBookmarksCacheForTests();
    const storage = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: vi.fn((key: string) => storage.get(key) ?? null),
        setItem: vi.fn((key: string, value: string) => {
          storage.set(key, value);
        }),
        removeItem: vi.fn((key: string) => {
          storage.delete(key);
        }),
      },
    });
    window.bookmarksAPI = {
      getAll: vi.fn(async () => ({
        bookmarks: [bookmark],
        folders: [],
        xLastSyncedAt: null,
      })),
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
      onChanged: vi.fn(() => vi.fn()),
    };
  });

  afterEach(() => {
    delete window.bookmarksAPI;
    resetBookmarksCacheForTests();
    vi.restoreAllMocks();
  });

  it('shows checking and an actual successful check time while opening bookmarks runs a background sync', async () => {
    let resolveSync: (value: { status: string; lastCheckedAt?: string }) => void = () => {};
    window.bookmarksAPI!.syncIfStale = vi.fn(() => new Promise<{ status: string; lastCheckedAt?: string }>((resolve) => {
      resolveSync = resolve;
    }));

    render(<BookmarksPane active />);

    const syncLabel = await screen.findByText('Checking for new bookmarks…');
    expect(syncLabel.previousElementSibling?.classList.contains('bookmarks-sync-dot--syncing')).toBe(true);
    expect(syncLabel.compareDocumentPosition(screen.getByText('Text')) & window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await act(async () => {
      resolveSync({ status: 'too-recent', lastCheckedAt: '2026-07-01T12:00:00.000Z' });
    });

    await waitFor(() => expect(screen.getByText(/Last checked/)).toBeTruthy());
  });

  it('shows network offline when bookmark sync fails from a network error', async () => {
    window.bookmarksAPI!.syncIfStale = vi.fn(async () => ({
      status: 'failed',
      error: 'ENOTFOUND api.x.com',
    }));

    render(<BookmarksPane active />);

    expect(await screen.findByText('Network offline')).toBeTruthy();
  });

  it('shows a retry icon after bookmark sync fails', async () => {
    window.bookmarksAPI!.syncIfStale = vi.fn()
      .mockResolvedValueOnce({ status: 'failed', error: 'HTTP 500' })
      .mockResolvedValueOnce({ status: 'synced', lastCheckedAt: '2026-07-01T12:00:00.000Z' });

    render(<BookmarksPane active />);

    expect(await screen.findByText('Sync failed')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Retry bookmark sync'));

    await waitFor(() => expect(window.bookmarksAPI!.syncIfStale).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText(/Last checked/)).toBeTruthy());
  });

  it('holds new arrivals while browsing, without rereading after sync', async () => {
    const syncedBookmark: Bookmark = {
      ...bookmark,
      id: 'bookmark-2',
      text: 'A newer saved note',
    };
    const initialSnapshot: BookmarksSnapshot = {
      bookmarks: [bookmark],
      folders: [],
      xLastSyncedAt: null,
    };
    const syncedSnapshot: BookmarksSnapshot = {
      bookmarks: [syncedBookmark, bookmark],
      folders: [],
      xLastSyncedAt: '2026-07-01T12:00:00.000Z',
    };
    let nativeChanged: (() => void) | null = null;
    let resolveSync: (value: { status: string; lastCheckedAt?: string }) => void = () => {};

    window.bookmarksAPI!.getAll = vi.fn()
      .mockResolvedValueOnce(initialSnapshot)
      .mockResolvedValue(syncedSnapshot);
    window.bookmarksAPI!.syncIfStale = vi.fn(() => new Promise<{ status: string; lastCheckedAt?: string }>((resolve) => {
      resolveSync = resolve;
    }));
    window.bookmarksAPI!.onChanged = vi.fn((callback: () => void) => {
      nativeChanged = callback;
      return vi.fn();
    });

    render(<BookmarksPane active />);

    expect(await screen.findByText('1 bookmarks')).toBeTruthy();

    fireEvent.pointerDown(screen.getByTestId('bookmarks-canvas'));
    act(() => {
      if (!nativeChanged) throw new Error('Expected native bookmark change callback');
      nativeChanged();
    });

    const revealButton = await screen.findByText('Show 1 new bookmark');
    expect(screen.getByText('1 bookmarks')).toBeTruthy();
    expect(screen.queryByText('Checking for new bookmarks…')).toBeNull();
    expect(revealButton.compareDocumentPosition(screen.getByText('Text')) & window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await act(async () => {
      resolveSync({ status: 'synced', lastCheckedAt: '2026-07-01T12:00:00.000Z' });
    });

    expect(await screen.findByText('Show 1 new bookmark')).toBeTruthy();

    fireEvent.click(screen.getByText('Show 1 new bookmark'));

    await waitFor(() => expect(screen.getByText('2 bookmarks')).toBeTruthy());
    expect(screen.queryByText('Show 1 new bookmark')).toBeNull();
    expect(screen.getByText(/Last checked/)).toBeTruthy();
    expect(window.bookmarksAPI!.getAll).toHaveBeenCalledTimes(2);
  });


  it('does not label a skipped check without a successful timestamp as fresh', async () => {
    window.bookmarksAPI!.syncIfStale = vi.fn(async () => ({ status: 'too-recent' }));
    render(<BookmarksPane active />);
    await screen.findByText('1 bookmarks');
    await waitFor(() => expect(screen.queryByText('Checking for new bookmarks…')).toBeNull());
    expect(screen.queryByText(/Last checked/)).toBeNull();
    expect(screen.queryByText('Up to date')).toBeNull();
  });

  it('shows arrivals automatically on entry and receives background check status', async () => {
    let changed = () => {};
    let statusChanged = (_state: BookmarkSyncState) => {};
    window.bookmarksAPI!.onChanged = vi.fn((callback) => { changed = callback; return vi.fn(); });
    window.bookmarksAPI!.onSyncStateChanged = vi.fn((callback) => { statusChanged = callback; return vi.fn(); });
    render(<BookmarksPane active />);
    await screen.findByText('1 bookmarks');
    window.bookmarksAPI!.getAll = vi.fn(async () => ({ bookmarks: [{ ...bookmark, id: 'new' }, bookmark], folders: [], xLastSyncedAt: null }));
    act(() => changed());
    await screen.findByText('2 bookmarks');
    expect(screen.queryByText('Show 1 new bookmark')).toBeNull();
    act(() => statusChanged({ phase: 'idle', lastCheckedAt: '2026-07-01T12:00:00.000Z', nextCheckAt: null, error: null }));
    expect(screen.getByText(/Last checked/)).toBeTruthy();
  });

  it('ignores late check results after leaving and unsubscribes status updates', async () => {
    let resolveSync = (_value: { status: string; lastCheckedAt: string }) => {};
    const unsubscribe = vi.fn();
    window.bookmarksAPI!.onSyncStateChanged = vi.fn(() => unsubscribe);
    window.bookmarksAPI!.syncIfStale = vi.fn(() => new Promise<{ status: string; lastCheckedAt: string }>((resolve) => { resolveSync = resolve; }));
    const { rerender } = render(<BookmarksPane active />);
    await screen.findByText('1 bookmarks');
    rerender(<BookmarksPane active={false} />);
    await act(async () => resolveSync({ status: 'synced', lastCheckedAt: '2026-07-01T12:00:00.000Z' }));
    expect(screen.queryByText(/Last checked/)).toBeNull();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('updates a mounted bookmarks pane when native bookmark display preferences change', async () => {
    window.localStorage.setItem('bookmarks-view-mode', 'canvas');

    render(<BookmarksPane active />);

    expect(await screen.findByTestId('bookmarks-canvas')).toBeTruthy();
    expect(screen.queryByTestId('bookmarks-list')).toBeNull();

    act(() => {
      window.localStorage.setItem('bookmarks-view-mode', 'list');
      window.dispatchEvent(new CustomEvent('fieldtheory:renderer-storage-changed', {
        detail: { key: 'bookmarks-view-mode', value: 'list' },
      }));
    });

    await waitFor(() => expect(screen.getByTestId('bookmarks-list')).toBeTruthy());
  });

  it('updates a mounted bookmarks pane when native text-only bookmark preferences change', async () => {
    window.localStorage.setItem('bookmarks-show-text', '1');

    render(<BookmarksPane active />);

    expect(await screen.findByText('1 bookmarks')).toBeTruthy();

    act(() => {
      window.localStorage.setItem('bookmarks-show-text', '0');
      window.dispatchEvent(new CustomEvent('fieldtheory:renderer-storage-changed', {
        detail: { key: 'bookmarks-show-text', value: '0' },
      }));
    });

    await waitFor(() => expect(screen.getByText('0 bookmarks')).toBeTruthy());
    expect(screen.getByText('No bookmarks in this folder.')).toBeTruthy();
  });

  it('shows bookmarks location controls wired to librarian history', async () => {
    const onNavigateBack = vi.fn();
    const onNavigateForward = vi.fn();

    render(
      <BookmarksPane
        active
        canNavigateBack
        canNavigateForward={false}
        onNavigateBack={onNavigateBack}
        onNavigateForward={onNavigateForward}
      />
    );

    const location = await screen.findByLabelText('Bookmarks location');
    expect(location).toBeTruthy();
    const toolbar = location.closest('[data-fieldtheory-bookmarks-toolbar="true"]') as HTMLElement | null;
    expect(toolbar?.style.paddingLeft).toBe('44px');
    expect(toolbar?.style.paddingRight).toBe('30px');
    expect(screen.queryByText('Library')).toBeNull();
    expect(screen.getByText('Bookmarks')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Back'));
    fireEvent.click(screen.getByLabelText('Forward'));

    expect(onNavigateBack).toHaveBeenCalledTimes(1);
    expect(onNavigateForward).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Forward')).toHaveProperty('disabled', true);
  });
});
