import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('scrollDiagnostics bootstrap', () => {
  const storage = new Map<string, string>();

  beforeEach(() => {
    vi.resetModules();
    storage.clear();
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
    delete (window as Window & { ftDebugScroll?: unknown }).ftDebugScroll;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
    storage.clear();
    delete (window as Window & { ftDebugScroll?: unknown }).ftDebugScroll;
  });

  it('starts the long-task observer when diagnostics restore as enabled', async () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    storage.set('ft-debug-scroll', '1');
    vi.stubGlobal('PerformanceObserver', class {
      observe = observe;
      disconnect = disconnect;
      constructor() {}
    });

    await import('../utils/scrollDiagnostics.bootstrap');

    expect((window as any).ftDebugScroll.isEnabled()).toBe(true);
    expect(observe).toHaveBeenCalledWith({ type: 'longtask', buffered: true });

    (window as any).ftDebugScroll.disable();

    expect(disconnect).toHaveBeenCalled();
  });
});
