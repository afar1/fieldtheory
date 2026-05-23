import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SCROLL_DIAGNOSTICS_ALLOWED_DROP_FPS,
  SCROLL_DIAGNOSTICS_STORAGE_KEY,
  SCROLL_DIAGNOSTICS_TARGET_FPS,
  clearScrollDiagnosticsSamples,
  getScrollDiagnosticsSnapshot,
  getScrollDiagnosticsBudgetViolations,
  getScrollDiagnosticsFpsLevel,
  getScrollDiagnosticsValidationReport,
  loadEnabledFromStorage,
  persistEnabledToStorage,
  pushLongTask,
  recordInteractionFrame,
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
    recordInteractionFrame({
      source: 'rendered-editor-input',
      fps: 45,
      longestFrameMs: 24,
      durationMs: 180,
      frameCount: 8,
    });
    const snap = getScrollDiagnosticsSnapshot();
    expect(snap.scrollByLastSource).toEqual({});
    expect(snap.interactionByLastSource).toEqual({});
  });

  it('records and emits when enabled', () => {
    setScrollDiagnosticsEnabled(true);
    const listener = vi.fn();
    const unsub = subscribeScrollDiagnostics(listener);

    recordScrollFrame({ source: 'codemirror', fps: 58, longestFrameMs: 22, durationMs: 400 });
    recordInteractionFrame({
      source: 'rendered-editor-input',
      fps: 119,
      longestFrameMs: 9,
      durationMs: 170,
      frameCount: 20,
    });

    const snap = getScrollDiagnosticsSnapshot();
    expect(snap.enabled).toBe(true);
    expect(snap.scrollByLastSource.codemirror?.fps).toBe(58);
    expect(snap.interactionByLastSource['rendered-editor-input']?.fps).toBe(119);
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

  it('treats the 120fps target as green only within the allowed drop', () => {
    expect(getScrollDiagnosticsFpsLevel(0)).toBe('muted');
    expect(getScrollDiagnosticsFpsLevel(SCROLL_DIAGNOSTICS_TARGET_FPS)).toBe('ok');
    expect(getScrollDiagnosticsFpsLevel(SCROLL_DIAGNOSTICS_TARGET_FPS - SCROLL_DIAGNOSTICS_ALLOWED_DROP_FPS)).toBe('ok');
    expect(getScrollDiagnosticsFpsLevel(SCROLL_DIAGNOSTICS_TARGET_FPS - SCROLL_DIAGNOSTICS_ALLOWED_DROP_FPS - 1)).toBe('warning');
    expect(getScrollDiagnosticsFpsLevel(109)).toBe('bad');
  });

  it('reports scroll and interaction budget misses below 119fps', () => {
    setScrollDiagnosticsEnabled(true);
    recordScrollFrame({ source: 'rendered', fps: 118, longestFrameMs: 13, durationMs: 200 });
    recordScrollFrame({ source: 'markdown', fps: 119, longestFrameMs: 9, durationMs: 200 });
    recordInteractionFrame({
      source: 'launcher-input',
      fps: 111,
      longestFrameMs: 19,
      durationMs: 170,
      frameCount: 19,
    });

    const violations = getScrollDiagnosticsBudgetViolations();
    expect(violations.map((violation) => `${violation.kind}:${violation.source}`)).toEqual([
      'interaction:launcher-input',
      'scroll:rendered',
    ]);
    expect(violations[0]?.targetFps).toBe(SCROLL_DIAGNOSTICS_TARGET_FPS);
    expect(violations[0]?.allowedDropFps).toBe(SCROLL_DIAGNOSTICS_ALLOWED_DROP_FPS);
  });

  it('clears recorded samples without disabling diagnostics', () => {
    setScrollDiagnosticsEnabled(true);
    recordScrollFrame({ source: 'rendered', fps: 118, longestFrameMs: 13, durationMs: 200 });
    recordInteractionFrame({
      source: 'launcher-input',
      fps: 111,
      longestFrameMs: 19,
      durationMs: 170,
      frameCount: 19,
    });

    clearScrollDiagnosticsSamples();

    const snap = getScrollDiagnosticsSnapshot();
    expect(snap.enabled).toBe(true);
    expect(snap.scrollByLastSource).toEqual({});
    expect(snap.interactionByLastSource).toEqual({});
    expect(getScrollDiagnosticsBudgetViolations()).toEqual([]);
  });

  it('reports missing required interaction surfaces separately from fps violations', () => {
    setScrollDiagnosticsEnabled(true);
    recordScrollFrame({ source: 'markdown', fps: 119, longestFrameMs: 8, durationMs: 200 });
    recordScrollFrame({ source: 'rendered', fps: 119, longestFrameMs: 8, durationMs: 200 });
    recordInteractionFrame({
      source: 'launcher-input',
      fps: 119,
      longestFrameMs: 8,
      durationMs: 170,
      frameCount: 20,
    });
    recordInteractionFrame({
      source: 'markdown-editor-input',
      fps: 118,
      longestFrameMs: 12,
      durationMs: 170,
      frameCount: 19,
    });

    const report = getScrollDiagnosticsValidationReport();

    expect(report.pass).toBe(false);
    expect(report.missingScrollSources).toEqual([]);
    expect(report.missingInteractionSources).toEqual(['rendered-editor-input']);
    expect(report.sampledInteractionSources).toEqual(['launcher-input', 'markdown-editor-input']);
    expect(report.violations.map(violation => violation.source)).toEqual(['markdown-editor-input']);
  });

  it('requires markdown and rendered scroll samples for validation to pass', () => {
    setScrollDiagnosticsEnabled(true);
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    recordScrollFrame({ source: 'markdown', fps: 119, longestFrameMs: 8, durationMs: 200 });
    now = 1100;
    recordInteractionFrame({
      source: 'launcher-input',
      fps: 119,
      longestFrameMs: 8,
      durationMs: 170,
      frameCount: 20,
    });
    now = 1200;
    recordInteractionFrame({
      source: 'markdown-editor-input',
      fps: 119,
      longestFrameMs: 8,
      durationMs: 170,
      frameCount: 20,
    });
    now = 1300;
    recordInteractionFrame({
      source: 'rendered-editor-input',
      fps: 119,
      longestFrameMs: 8,
      durationMs: 170,
      frameCount: 20,
    });

    const missingRenderedScroll = getScrollDiagnosticsValidationReport();

    expect(missingRenderedScroll.pass).toBe(false);
    expect(missingRenderedScroll.sampledScrollSources).toEqual(['markdown']);
    expect(missingRenderedScroll.missingScrollSources).toEqual(['rendered']);
    expect(missingRenderedScroll.firstSampleTimestamp).toBe(1000);
    expect(missingRenderedScroll.lastSampleTimestamp).toBe(1300);
    expect(missingRenderedScroll.sampleSpanMs).toBe(300);

    now = 1500;
    recordScrollFrame({ source: 'rendered', fps: 119, longestFrameMs: 8, durationMs: 200 });

    const completeReport = getScrollDiagnosticsValidationReport();

    expect(completeReport.pass).toBe(true);
    expect(completeReport.missingScrollSources).toEqual([]);
    expect(completeReport.missingInteractionSources).toEqual([]);
    expect(completeReport.violations).toEqual([]);
    expect(completeReport.firstSampleTimestamp).toBe(1000);
    expect(completeReport.lastSampleTimestamp).toBe(1500);
    expect(completeReport.sampleSpanMs).toBe(500);
  });

  it('fails validation when long tasks were observed', () => {
    setScrollDiagnosticsEnabled(true);
    recordScrollFrame({ source: 'markdown', fps: 119, longestFrameMs: 8, durationMs: 200 });
    recordScrollFrame({ source: 'rendered', fps: 119, longestFrameMs: 8, durationMs: 200 });
    recordInteractionFrame({
      source: 'launcher-input',
      fps: 119,
      longestFrameMs: 8,
      durationMs: 170,
      frameCount: 20,
    });
    recordInteractionFrame({
      source: 'markdown-editor-input',
      fps: 119,
      longestFrameMs: 8,
      durationMs: 170,
      frameCount: 20,
    });
    recordInteractionFrame({
      source: 'rendered-editor-input',
      fps: 119,
      longestFrameMs: 8,
      durationMs: 170,
      frameCount: 20,
    });
    pushLongTask({ duration: 62, startTime: 100 });

    const report = getScrollDiagnosticsValidationReport();

    expect(report.pass).toBe(false);
    expect(report.longTaskCount).toBe(1);
    expect(report.longTaskTotalMs).toBe(62);
    expect(report.longestLongTaskMs).toBe(62);
  });
});
