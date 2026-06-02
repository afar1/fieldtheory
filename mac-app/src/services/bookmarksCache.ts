// Module-scope cache for bookmarks snapshots.
// The JSONL is ~14MB; each IPC call serializes all ~7k records via structured
// clone, which is visibly slow on remount. Caching here makes repeat visits
// instant, and lets us prefetch on Library mount so the first click is fast too.

let cached: BookmarksSnapshot | null = null;
let inflight: Promise<BookmarksSnapshot> | null = null;
const listeners = new Set<(s: BookmarksSnapshot) => void>();
let changeSubscribed = false;

function subscribeToChanges(): void {
  if (changeSubscribed) return;
  if (!window.bookmarksAPI) return;
  window.bookmarksAPI.onChanged(() => {
    cached = null;
    inflight = null;
    void getBookmarks().then((s) => {
      for (const cb of listeners) cb(s);
    });
  });
  changeSubscribed = true;
}

/** Returns the cached snapshot synchronously, or null if not yet loaded. */
export function peekBookmarks(): BookmarksSnapshot | null {
  return cached;
}

/** Loads (or returns cached) snapshot. Coalesces concurrent callers. */
export function getBookmarks(): Promise<BookmarksSnapshot> {
  subscribeToChanges();
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  const api = window.bookmarksAPI;
  if (!api) return Promise.resolve({ bookmarks: [], folders: [], xLastSyncedAt: null });
  inflight = api.getAll().then((snap) => {
    cached = snap ?? { bookmarks: [], folders: [], xLastSyncedAt: null };
    inflight = null;
    return cached;
  });
  return inflight;
}

/** Fire-and-forget prefetch; safe to call repeatedly. */
export function prefetchBookmarks(): void {
  if (cached || inflight) return;
  void getBookmarks();
}

/** Subscribe to change events (from file watcher via IPC). */
export function onBookmarksChanged(cb: (s: BookmarksSnapshot) => void): () => void {
  subscribeToChanges();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function resetBookmarksCacheForTests(): void {
  cached = null;
  inflight = null;
  listeners.clear();
  changeSubscribed = false;
}
