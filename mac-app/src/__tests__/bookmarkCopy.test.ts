import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyBookmarkContent, sendBookmarkToCodex } from '../utils/bookmarkCopy';

afterEach(() => {
  delete window.bookmarksAPI;
});

describe('bookmark copy helpers', () => {
  it('copies bookmark content through the native bookmark API', async () => {
    window.bookmarksAPI = {
      copyForAgent: vi.fn(async () => ({ success: true })),
    } as any;

    await expect(copyBookmarkContent('bookmark-1')).resolves.toBe(true);
    expect(window.bookmarksAPI.copyForAgent).toHaveBeenCalledWith('bookmark-1');
  });

  it('sends bookmark content to Codex through the native Codex path', async () => {
    window.bookmarksAPI = {
      sendToCodex: vi.fn(async () => ({ success: true, delivery: 'native-helper' })),
      invokeBookmark: vi.fn(async () => ({ success: true })),
    } as any;

    await expect(sendBookmarkToCodex('bookmark-1')).resolves.toBe(true);
    expect(window.bookmarksAPI.sendToCodex).toHaveBeenCalledWith('bookmark-1');
    expect(window.bookmarksAPI.invokeBookmark).not.toHaveBeenCalled();
  });

  it('falls back to the native invoke path for older hosts', async () => {
    window.bookmarksAPI = {
      invokeBookmark: vi.fn(async () => ({ success: true })),
    } as any;

    await expect(sendBookmarkToCodex('bookmark-1')).resolves.toBe(true);
    expect(window.bookmarksAPI.invokeBookmark).toHaveBeenCalledWith('bookmark-1');
  });
});
