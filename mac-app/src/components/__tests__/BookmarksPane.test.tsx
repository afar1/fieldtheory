import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BookmarksPane from '../BookmarksPane';

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
    vi.restoreAllMocks();
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
});
