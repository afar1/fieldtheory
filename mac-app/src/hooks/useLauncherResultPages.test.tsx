import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useLauncherResultPages } from './useLauncherResultPages';

afterEach(cleanup);
describe('launcher result pages', () => {
  it('reveals more rows at an arrow boundary and through Show more or scrolling', () => {
    const { result } = renderHook(() => useLauncherResultPages('review', 53));
    expect(result.current.visibleCount).toBe(20);
    act(() => result.current.revealThrough(20));
    expect(result.current.visibleCount).toBe(40);
    act(() => result.current.showMore());
    expect(result.current.visibleCount).toBe(53);
    expect(result.current.hasMore).toBe(false);
  });

  it('resets when switching queries and retains pages when refreshed results arrive', () => {
    const { result, rerender } = renderHook(({ query, count }) => useLauncherResultPages(query, count), {
      initialProps: { query: 'review', count: 50 },
    });
    act(() => result.current.showMore());
    rerender({ query: 'review', count: 70 });
    expect(result.current.visibleCount).toBe(40);
    rerender({ query: 'ship', count: 70 });
    expect(result.current.visibleCount).toBe(20);
    rerender({ query: 'review', count: 70 });
    expect(result.current.visibleCount).toBe(20);
  });
});
