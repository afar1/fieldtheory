import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BookmarksCanvas from '../BookmarksCanvas';

vi.mock('../../contexts/ThemeContext', () => ({
  useTheme: () => ({ theme: { bg: '#fff', text: '#111', textSecondary: '#666', isDark: false } }),
}));
const bookmarks: Bookmark[] = Array.from({ length: 100 }, (_, i) => ({
  id: `saved-${i}`, sourceType: 'x', text: `Saved note ${i}`, url: `https://x.com/test/status/${i}`,
  authorHandle: 'test', authorName: 'Test', authorAvatar: '', postedAt: '2026-07-01T00:00:00Z',
  images: [], mediaCount: 0, likeCount: 0, repostCount: 0, bookmarkCount: 0, folders: [],
}));
let frames: Map<number, FrameRequestCallback>;
let nextFrame = 0;
function settle() {
  act(() => {
    for (let step = 0; frames.size && step < 200; step++) {
      const pending = [...frames.entries()];
      frames.clear();
      for (const [, callback] of pending) callback(performance.now() + 1000);
    }
  });
}
function cards(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLDivElement>('.bm-grid-item')].filter((card) => card.style.display !== 'none');
}
function cardX(card: HTMLElement) { return Number(card.style.transform.match(/translate3d\(([\d.-]+)px/)?.[1]); }
function cardY(card: HTMLElement) { return Number(card.style.transform.match(/translate3d\([^,]+, ([\d.-]+)px/)?.[1]); }

describe('BookmarksCanvas background updates', () => {
  beforeEach(() => {
    frames = new Map();
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(900);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('sleeps at rest, resumes on gestures, and cancels work while inactive or hidden', () => {
    const { container, rerender } = render(<BookmarksCanvas bookmarks={bookmarks} />);
    settle();
    expect(frames.size).toBe(0);
    const viewport = container.firstElementChild!;
    fireEvent.wheel(viewport, { deltaY: 350 });
    expect(frames.size).toBe(1);
    settle();
    expect(frames.size).toBe(0);
    fireEvent.wheel(viewport, { deltaY: 350 });
    rerender(<BookmarksCanvas bookmarks={bookmarks} active={false} />);
    expect(frames.size).toBe(0);
    rerender(<BookmarksCanvas bookmarks={bookmarks} active />);
    expect(frames.size).toBe(1);
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    expect(frames.size).toBe(0);
  });

  it('retains unchanged card nodes and the visible anchor when records arrive', () => {
    const { container, rerender } = render(<BookmarksCanvas bookmarks={bookmarks} />);
    settle();
    fireEvent.wheel(container.firstElementChild!, { deltaY: 450 });
    settle();
    const anchor = cards(container).filter((card) => cardY(card) + parseFloat(card.style.height) > 0)
      .sort((a, b) => Math.abs(cardY(a)) - Math.abs(cardY(b)) || cardX(a) - cardX(b))[0];
    const beforeY = cardY(anchor);
    const beforeText = anchor.querySelector('.bm-text-body')!.textContent;
    rerender(<BookmarksCanvas bookmarks={[{ ...bookmarks[0], id: 'new', text: 'Just saved' }, ...bookmarks.map((bookmark) => ({ ...bookmark }))]} />);
    expect(anchor.isConnected).toBe(true);
    expect(anchor.querySelector('.bm-text-body')!.textContent).toBe(beforeText);
    expect(cardY(anchor)).toBeCloseTo(beforeY, 4);
    expect(frames.size).toBe(0);
  });

  it('keeps an open lightbox and selection when metadata updates', () => {
    const { container, rerender } = render(<BookmarksCanvas bookmarks={bookmarks} />);
    settle();
    const card = cards(container)[0];
    fireEvent.mouseDown(card);
    fireEvent.mouseUp(card);
    settle();
    const clone = document.body.querySelector<HTMLDivElement>('.bm-grid-item[style*="position: fixed"]');
    expect(clone).toBeTruthy();
    const text = clone!.querySelector('.bm-text-body')!.textContent;
    rerender(<BookmarksCanvas bookmarks={bookmarks.map((bookmark) => ({ ...bookmark, likeCount: 1 }))} />);
    expect(clone!.isConnected).toBe(true);
    expect(clone!.querySelector('.bm-text-body')!.textContent).toBe(text);
    expect(card.style.visibility).toBe('hidden');
  });

  it('finishes a lightbox transition and hides its body-level clone while the pane is inactive', () => {
    const { container, rerender } = render(<BookmarksCanvas bookmarks={bookmarks} />);
    settle();
    const card = cards(container)[0];
    fireEvent.mouseDown(card);
    fireEvent.mouseUp(card);
    expect(frames.size).toBeGreaterThan(0);
    const clone = document.body.querySelector<HTMLDivElement>('.bm-grid-item[style*="position: fixed"]')!;
    rerender(<BookmarksCanvas bookmarks={bookmarks} active={false} />);
    expect(frames.size).toBe(0);
    expect(clone.style.display).toBe('none');
    rerender(<BookmarksCanvas bookmarks={bookmarks} active />);
    expect(clone.style.display).not.toBe('none');
    settle();
    expect(frames.size).toBe(0);
  });

});
