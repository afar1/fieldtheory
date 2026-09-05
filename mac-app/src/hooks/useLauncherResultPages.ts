import { useCallback, useEffect, useState } from 'react';

export const LAUNCHER_RESULT_PAGE_SIZE = 20;

export function useLauncherResultPages(queryKey: string, resultCount: number) {
  const [page, setPage] = useState({ key: queryKey, limit: LAUNCHER_RESULT_PAGE_SIZE });
  const limit = page.key === queryKey ? page.limit : LAUNCHER_RESULT_PAGE_SIZE;
  const visibleCount = Math.min(resultCount, limit);
  const revealThrough = useCallback((index: number) => {
    setPage((previous) => {
      const nextLimit = Math.max(
        previous.key === queryKey ? previous.limit : LAUNCHER_RESULT_PAGE_SIZE,
        Math.ceil((index + 1) / LAUNCHER_RESULT_PAGE_SIZE) * LAUNCHER_RESULT_PAGE_SIZE,
      );
      return previous.key === queryKey && previous.limit === nextLimit
        ? previous
        : { key: queryKey, limit: nextLimit };
    });
  }, [queryKey]);
  const showMore = useCallback(() => revealThrough(visibleCount), [revealThrough, visibleCount]);
  // Clear expanded state when moving to another query, including returning to an earlier query.
  useEffect(() => { setPage({ key: queryKey, limit: LAUNCHER_RESULT_PAGE_SIZE }); }, [queryKey]);
  return { visibleCount, hasMore: visibleCount < resultCount, showMore, revealThrough };
}
