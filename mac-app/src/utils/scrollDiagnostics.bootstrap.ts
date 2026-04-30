/**
 * Browser bootstrap for scroll diagnostics.
 *
 * Wires the pure core in `scrollDiagnostics.ts` to:
 *   - localStorage (load on import, persist on toggle)
 *   - the `longtask` PerformanceObserver (start when enabled, stop when off)
 *   - `window.ftDebugScroll` console controls
 *
 * Importing this module has side effects, so it should be imported exactly
 * once from a renderer entry point (e.g. `clipboard-history.tsx`,
 * `App.tsx`). The core module stays import-safe for tests and workers.
 */
import {
  getScrollDiagnosticsSnapshot,
  isScrollDiagnosticsEnabled,
  loadEnabledFromStorage,
  onScrollDiagnosticsEnabledChange,
  persistEnabledToStorage,
  pushLongTask,
  setScrollDiagnosticsEnabled,
} from './scrollDiagnostics';

let longTaskObserver: PerformanceObserver | null = null;

function startLongTaskObserver(): void {
  if (longTaskObserver) return;
  if (typeof PerformanceObserver === 'undefined') return;
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        pushLongTask({ duration: entry.duration, startTime: entry.startTime });
      }
    });
    longTaskObserver.observe({ type: 'longtask', buffered: true });
  } catch {
    longTaskObserver = null;
  }
}

function stopLongTaskObserver(): void {
  longTaskObserver?.disconnect();
  longTaskObserver = null;
}

export function bootstrapScrollDiagnostics(): void {
  if (typeof window === 'undefined') return;

  const storage = window.localStorage;
  if (storage && loadEnabledFromStorage(storage)) {
    setScrollDiagnosticsEnabled(true);
  }

  onScrollDiagnosticsEnabledChange((enabled) => {
    if (storage) persistEnabledToStorage(storage, enabled);
    if (enabled) startLongTaskObserver();
    else stopLongTaskObserver();
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).ftDebugScroll = {
    enable: () => setScrollDiagnosticsEnabled(true),
    disable: () => setScrollDiagnosticsEnabled(false),
    isEnabled: isScrollDiagnosticsEnabled,
    snapshot: getScrollDiagnosticsSnapshot,
  };
}

bootstrapScrollDiagnostics();
