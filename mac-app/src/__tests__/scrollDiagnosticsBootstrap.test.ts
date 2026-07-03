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
    delete (window as Window & { diagnosticsAPI?: unknown }).diagnosticsAPI;
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

  it('persists completed scroll and interaction samples only when diagnostics are enabled', async () => {
    const appendScrollDiagnostics = vi.fn(async () => ({ ok: true, path: '/tmp/scroll-diagnostics.jsonl' }));
    Object.defineProperty(window, 'diagnosticsAPI', {
      configurable: true,
      value: { appendScrollDiagnostics },
    });
    await import('../utils/scrollDiagnostics.bootstrap');
    const {
      recordInteractionFrame,
      recordScrollFrame,
      setScrollDiagnosticsEnabled,
    } = await import('../utils/scrollDiagnostics');

    recordScrollFrame({ source: 'rendered', fps: 60, longestFrameMs: 16, durationMs: 200 });
    expect(appendScrollDiagnostics).not.toHaveBeenCalled();

    setScrollDiagnosticsEnabled(true);
    recordScrollFrame({ source: 'rendered', fps: 60, longestFrameMs: 16, durationMs: 200 });
    recordInteractionFrame({
      source: 'rendered-editor-input',
      fps: 58,
      longestFrameMs: 18,
      durationMs: 180,
      frameCount: 12,
    });

    expect(appendScrollDiagnostics).toHaveBeenCalledTimes(2);
    expect(appendScrollDiagnostics).toHaveBeenNthCalledWith(1, expect.objectContaining({
      kind: 'scroll',
      source: 'rendered',
      fps: 60,
    }));
    expect(appendScrollDiagnostics).toHaveBeenNthCalledWith(2, expect.objectContaining({
      kind: 'interaction',
      source: 'rendered-editor-input',
      fps: 58,
      frameCount: 12,
    }));
  });

  it('exposes a debug helper that records labeled synthetic quality samples', async () => {
    const appendScrollDiagnostics = vi.fn(async () => ({ ok: true, path: '/tmp/scroll-diagnostics.jsonl' }));
    Object.defineProperty(window, 'diagnosticsAPI', {
      configurable: true,
      value: { appendScrollDiagnostics },
    });
    await import('../utils/scrollDiagnostics.bootstrap');

    const report = await (window as any).ftDebugScroll.recordSyntheticQualitySamples('synthetic-quality-test', 'benchmark-test');

    expect(report.pass).toBe(true);
    expect(appendScrollDiagnostics).toHaveBeenCalledTimes(5);
    expect(appendScrollDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'scroll',
      source: 'rendered',
      qualityScenario: 'synthetic-quality-test',
      benchmarkId: 'benchmark-test',
    }));
    expect(appendScrollDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'interaction',
      source: 'rendered-editor-input',
      qualityScenario: 'synthetic-quality-test',
    }));
  });

  it('exposes a debug helper that records labeled renderer journey samples', async () => {
    const appendScrollDiagnostics = vi.fn(async () => ({ ok: true, path: '/tmp/scroll-diagnostics.jsonl' }));
    Object.defineProperty(window, 'diagnosticsAPI', {
      configurable: true,
      value: { appendScrollDiagnostics },
    });
    const execCommand = vi.fn((command: string, _showUi?: boolean, value?: string) => {
      if (command !== 'insertText') return false;
      const active = document.activeElement;
      if (!active) return false;
      active.textContent = `${active.textContent ?? ''}${value ?? ''}`;
      active.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value ?? null }));
      return true;
    });
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    });

    const renderedScroll = document.createElement('div');
    renderedScroll.setAttribute('data-ft-quality-scroll', 'rendered');
    Object.defineProperties(renderedScroll, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 200 },
    });
    const renderedInput = document.createElement('div');
    renderedInput.setAttribute('data-ft-rendered-editor-input', 'true');
    renderedInput.tabIndex = 0;
    const markdownRoot = document.createElement('div');
    markdownRoot.setAttribute('data-ft-quality-editor', 'markdown');
    const markdownScroller = document.createElement('div');
    markdownScroller.className = 'cm-scroller';
    Object.defineProperties(markdownScroller, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 200 },
    });
    const markdownInput = document.createElement('div');
    markdownInput.className = 'cm-content';
    markdownInput.tabIndex = 0;
    markdownRoot.append(markdownScroller, markdownInput);
    document.body.append(renderedScroll, renderedInput, markdownRoot);

    await import('../utils/scrollDiagnostics.bootstrap');

    const result = await (window as any).ftDebugScroll.recordRendererJourneyQualitySamples(
      'renderer-driven-test',
      'benchmark-test',
    );

    expect(result.evidence.librarySurfaceReady).toBe(true);
    expect(appendScrollDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'scroll',
      source: 'rendered',
      qualityScenario: 'renderer-driven-test',
      benchmarkId: 'benchmark-test',
      sampleOrigin: 'programmatic-dom-event',
      journeyStep: 'rendered-scroll',
      targetFound: true,
      scrollDelta: expect.any(Number),
    }));
    expect(appendScrollDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'interaction',
      source: 'markdown-editor-input',
      journeyStep: 'markdown-type',
      targetFound: true,
      inputDelta: expect.any(Number),
    }));
  });
});
