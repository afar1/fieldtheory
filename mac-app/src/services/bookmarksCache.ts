// Keep the last usable snapshot while native changes settle. IPC transfers the
// entire library, so bursts share one read and changes during it get one followup.
let cached: BookmarksSnapshot | null = null;
let inflight: Promise<BookmarksSnapshot> | null = null;
let pending = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let generation = 0;
let unsubscribe: (() => void) | null = null;
const listeners = new Set<(s: BookmarksSnapshot) => void>();
const emptySnapshot = (): BookmarksSnapshot => ({ bookmarks: [], folders: [], xLastSyncedAt: null });

function scheduleRefresh(): void {
  pending = true;
  if (inflight || timer) return;
  timer = setTimeout(() => {
    timer = null;
    void readSnapshot().catch((error) => console.warn('[Bookmarks] Refresh failed', error));
  }, 100);
}

function subscribeToChanges(): void {
  if (unsubscribe || !window.bookmarksAPI) return;
  unsubscribe = window.bookmarksAPI.onChanged(scheduleRefresh);
}

function readSnapshot(): Promise<BookmarksSnapshot> {
  if (inflight) return inflight;
  if (timer) clearTimeout(timer);
  timer = null;
  const api = window.bookmarksAPI;
  if (!api) return Promise.resolve(cached ?? emptySnapshot());
  const startedGeneration = generation;
  const read = async () => {
    do {
      pending = false;
      const snapshot = await api.getAll() ?? emptySnapshot();
      if (startedGeneration !== generation) return snapshot;
      cached = snapshot;
      for (const cb of listeners) cb(snapshot);
    } while (pending);
    return cached!;
  };
  inflight = read().finally(() => {
    if (startedGeneration === generation) {
      inflight = null;
      if (pending) scheduleRefresh();
    }
  });
  return inflight;
}

export function peekBookmarks(): BookmarksSnapshot | null { return cached; }

/** Opening a pane can render stale data immediately while a refresh is running. */
export function getBookmarks(): Promise<BookmarksSnapshot> {
  subscribeToChanges();
  return cached ? Promise.resolve(cached) : readSnapshot();
}

/** Explicit refreshes share a running request instead of starting a second one. */
export function refreshBookmarks(): Promise<BookmarksSnapshot> {
  subscribeToChanges();
  pending = true;
  return readSnapshot();
}

export function prefetchBookmarks(): void {
  void getBookmarks().catch((error) => console.warn('[Bookmarks] Prefetch failed', error));
}

export function onBookmarksChanged(cb: (s: BookmarksSnapshot) => void): () => void {
  subscribeToChanges();
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function resetBookmarksCacheForTests(): void {
  generation++;
  unsubscribe?.();
  unsubscribe = null;
  if (timer) clearTimeout(timer);
  timer = null;
  pending = false;
  cached = null;
  inflight = null;
  listeners.clear();
}
