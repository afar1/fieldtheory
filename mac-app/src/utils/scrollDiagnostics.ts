/**
 * Scroll diagnostics — pure core. Holds state, accepts recordings, and lets
 * subscribers observe changes. No window/localStorage side effects here so
 * this module is safe to import from tests, workers, or non-browser code.
 *
 * Browser bootstrap (window.ftDebugScroll, localStorage persistence,
 * PerformanceObserver setup) lives in `scrollDiagnostics.bootstrap.ts` and
 * is imported once from a renderer entry point.
 *
 * Persistence happens through the bootstrap layer via `loadEnabledFrom` /
 * `persistEnabledTo` — the core just owns the in-memory enabled flag.
 */

export interface ScrollFrameRecord {
  source: string;
  fps: number;
  longestFrameMs: number;
  durationMs: number;
  timestamp: number;
}

export interface ScrollDiagnosticsSnapshot {
  enabled: boolean;
  scrollByLastSource: Record<string, ScrollFrameRecord>;
  longTasks: { duration: number; startTime: number }[];
}

export const SCROLL_DIAGNOSTICS_STORAGE_KEY = 'ft-debug-scroll';
const LONG_TASK_HISTORY = 16;

const listeners = new Set<(snap: ScrollDiagnosticsSnapshot) => void>();

let state: ScrollDiagnosticsSnapshot = {
  enabled: false,
  scrollByLastSource: {},
  longTasks: [],
};

type EnabledChangeListener = (enabled: boolean) => void;
const enabledChangeListeners = new Set<EnabledChangeListener>();

function emit() {
  for (const listener of listeners) {
    try {
      listener(state);
    } catch {
      // listener errors should not break observability
    }
  }
}

export function isScrollDiagnosticsEnabled(): boolean {
  return state.enabled;
}

export function setScrollDiagnosticsEnabled(enabled: boolean): void {
  if (state.enabled === enabled) return;
  state = { ...state, enabled };
  for (const listener of enabledChangeListeners) {
    try {
      listener(enabled);
    } catch {
      // ignore listener failures
    }
  }
  emit();
}

/**
 * Bootstrap-only: subscribe to enabled-flag changes so the browser layer can
 * react (start/stop observers, write to localStorage). Returns unsubscribe.
 */
export function onScrollDiagnosticsEnabledChange(
  listener: EnabledChangeListener,
): () => void {
  enabledChangeListeners.add(listener);
  return () => {
    enabledChangeListeners.delete(listener);
  };
}

/**
 * Bootstrap-only: append a long-task entry. Used by the PerformanceObserver
 * wired up in the bootstrap module.
 */
export function pushLongTask(entry: { duration: number; startTime: number }): void {
  const merged = [...state.longTasks, entry].slice(-LONG_TASK_HISTORY);
  state = { ...state, longTasks: merged };
  emit();
}

export function subscribeScrollDiagnostics(
  listener: (snap: ScrollDiagnosticsSnapshot) => void,
): () => void {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
}

export function recordScrollFrame(record: Omit<ScrollFrameRecord, 'timestamp'>): void {
  if (!state.enabled) return;
  const next: ScrollFrameRecord = { ...record, timestamp: performance.now() };
  state = {
    ...state,
    scrollByLastSource: { ...state.scrollByLastSource, [record.source]: next },
  };
  emit();
}

export function getScrollDiagnosticsSnapshot(): ScrollDiagnosticsSnapshot {
  return state;
}

/**
 * Test-only: reset all state to its initial empty form. Useful for keeping
 * tests independent without exposing internal mutation hooks.
 */
export function resetScrollDiagnosticsForTest(): void {
  state = {
    enabled: false,
    scrollByLastSource: {},
    longTasks: [],
  };
  listeners.clear();
  enabledChangeListeners.clear();
}

/**
 * Persistence helpers — storage object is injected so callers (browser
 * bootstrap, tests) decide where state lives.
 */
export function loadEnabledFromStorage(storage: Pick<Storage, 'getItem'>): boolean {
  try {
    return storage.getItem(SCROLL_DIAGNOSTICS_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function persistEnabledToStorage(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  enabled: boolean,
): void {
  try {
    if (enabled) storage.setItem(SCROLL_DIAGNOSTICS_STORAGE_KEY, '1');
    else storage.removeItem(SCROLL_DIAGNOSTICS_STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
}
