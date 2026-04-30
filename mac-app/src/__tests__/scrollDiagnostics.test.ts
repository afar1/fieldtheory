import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SCROLL_DIAGNOSTICS_STORAGE_KEY,
  getScrollDiagnosticsSnapshot,
  loadEnabledFromStorage,
  persistEnabledToStorage,
  recordScrollFrame,
  resetScrollDiagnosticsForTest,
  setScrollDiagnosticsEnabled,
  subscribeScrollDiagnostics,
  onScrollDiagnosticsEnabledChange,
} from '../utils/scrollDiagnostics';

function createMemoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

describe('scrollDiagnostics', () => {
  beforeEach(() => {
    resetScrollDiagnosticsForTest();
  });

  afterEach(() => {
    resetScrollDiagnosticsForTest();
  });

  it('does not record when disabled', () => {
    recordScrollFrame({ source: 'rendered', fps: 30, longestFrameMs: 60, durationMs: 200 });
    const snap = getScrollDiagnosticsSnapshot();
    expect(snap.scrollByLastSource).toEqual({});
  });

  it('records and emits when enabled', () => {
    setScrollDiagnosticsEnabled(true);
    const listener = vi.fn();
    const unsub = subscribeScrollDiagnostics(listener);

    recordScrollFrame({ source: 'codemirror', fps: 58, longestFrameMs: 22, durationMs: 400 });

    const snap = getScrollDiagnosticsSnapshot();
    expect(snap.enabled).toBe(true);
    expect(snap.scrollByLastSource.codemirror?.fps).toBe(58);
    expect(listener).toHaveBeenCalled();
    unsub();
  });

  it('unsubscribe stops emissions', () => {
    setScrollDiagnosticsEnabled(true);
    const listener = vi.fn();
    const unsub = subscribeScrollDiagnostics(listener);
    listener.mockClear();
    unsub();
    recordScrollFrame({ source: 'rendered', fps: 60, longestFrameMs: 16, durationMs: 100 });
    expect(listener).not.toHaveBeenCalled();
  });

  it('toggling enabled fires the enabled-change listener once per change', () => {
    const listener = vi.fn();
    const unsub = onScrollDiagnosticsEnabledChange(listener);
    setScrollDiagnosticsEnabled(true);
    setScrollDiagnosticsEnabled(true); // no-op
    setScrollDiagnosticsEnabled(false);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, true);
    expect(listener).toHaveBeenNthCalledWith(2, false);
    unsub();
  });

  it('persists enabled flag through an injected storage', () => {
    const storage = createMemoryStorage();
    expect(loadEnabledFromStorage(storage)).toBe(false);
    persistEnabledToStorage(storage, true);
    expect(loadEnabledFromStorage(storage)).toBe(true);
    expect(storage.getItem(SCROLL_DIAGNOSTICS_STORAGE_KEY)).toBe('1');
    persistEnabledToStorage(storage, false);
    expect(loadEnabledFromStorage(storage)).toBe(false);
    expect(storage.getItem(SCROLL_DIAGNOSTICS_STORAGE_KEY)).toBeNull();
  });
});
