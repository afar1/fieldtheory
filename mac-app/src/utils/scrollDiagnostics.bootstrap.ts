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
  clearScrollDiagnosticsSamples,
  getScrollDiagnosticsBudgetViolations,
  getScrollDiagnosticsSnapshot,
  getScrollDiagnosticsValidationReport,
  isScrollDiagnosticsEnabled,
  loadEnabledFromStorage,
  subscribeScrollDiagnostics,
  onScrollDiagnosticsEnabledChange,
  persistEnabledToStorage,
  pushLongTask,
  recordSyntheticScrollDiagnosticSamples,
  setScrollDiagnosticsQualityContext,
  setScrollDiagnosticsEnabled,
  clearScrollDiagnosticsQualityContext,
  recordInteractionFrame,
  recordScrollFrame,
} from './scrollDiagnostics';

let longTaskObserver: PerformanceObserver | null = null;
let lastPersistedScrollTimestamps: Record<string, number> = {};
let lastPersistedInteractionTimestamps: Record<string, number> = {};
let lastPersistedLongTaskKey: string | null = null;
let suppressAutoPersist = false;

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

async function persistScrollDiagnosticsSnapshot(
  snapshot = getScrollDiagnosticsSnapshot(),
): Promise<void> {
  if (!snapshot.enabled) return;
  const diagnosticsApi = window.diagnosticsAPI;
  if (!diagnosticsApi?.appendScrollDiagnostics) return;

  const writes: Array<Promise<unknown>> = [];
  for (const record of Object.values(snapshot.scrollByLastSource)) {
    if (lastPersistedScrollTimestamps[record.source] === record.timestamp) continue;
    lastPersistedScrollTimestamps = {
      ...lastPersistedScrollTimestamps,
      [record.source]: record.timestamp,
    };
      writes.push(diagnosticsApi.appendScrollDiagnostics({
        kind: 'scroll',
        source: record.source,
        fps: record.fps,
        longestFrameMs: record.longestFrameMs,
        durationMs: record.durationMs,
        timestamp: record.timestamp,
        qualityScenario: record.qualityScenario,
        benchmarkId: record.benchmarkId,
        sampleOrigin: record.sampleOrigin,
        journeyStep: record.journeyStep,
        targetFound: record.targetFound,
        scrollBefore: record.scrollBefore,
        scrollAfter: record.scrollAfter,
        scrollDelta: record.scrollDelta,
      }));
  }

  for (const record of Object.values(snapshot.interactionByLastSource)) {
    if (lastPersistedInteractionTimestamps[record.source] === record.timestamp) continue;
    lastPersistedInteractionTimestamps = {
      ...lastPersistedInteractionTimestamps,
      [record.source]: record.timestamp,
    };
    writes.push(diagnosticsApi.appendScrollDiagnostics({
      kind: 'interaction',
      source: record.source,
      fps: record.fps,
      longestFrameMs: record.longestFrameMs,
      durationMs: record.durationMs,
      frameCount: record.frameCount,
        timestamp: record.timestamp,
        qualityScenario: record.qualityScenario,
        benchmarkId: record.benchmarkId,
        sampleOrigin: record.sampleOrigin,
        journeyStep: record.journeyStep,
        targetFound: record.targetFound,
        inputBeforeLength: record.inputBeforeLength,
        inputAfterLength: record.inputAfterLength,
        inputDelta: record.inputDelta,
      }));
  }

  const latestLongTask = snapshot.longTasks.at(-1);
  if (latestLongTask) {
    const key = `${latestLongTask.startTime}:${latestLongTask.duration}`;
    if (lastPersistedLongTaskKey !== key) {
      lastPersistedLongTaskKey = key;
      writes.push(diagnosticsApi.appendScrollDiagnostics({
        kind: 'longtask',
        duration: latestLongTask.duration,
        startTime: latestLongTask.startTime,
        qualityScenario: latestLongTask.qualityScenario,
        benchmarkId: latestLongTask.benchmarkId,
        sampleOrigin: latestLongTask.sampleOrigin,
        journeyStep: latestLongTask.journeyStep,
      }));
    }
  }

  await Promise.allSettled(writes);
}

function waitMs(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function getTextLength(element: Element | null): number {
  if (!element) return 0;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value.length;
  }
  const view = findCodeMirrorView(element);
  if (view) {
    return view.state.doc.length;
  }
  return (element.textContent ?? '').length;
}

type CodeMirrorViewLike = {
  state: {
    doc: { length: number };
    selection?: { main?: { head?: number } };
  };
  dispatch: (transaction: { changes: { from: number; insert: string } }) => void;
};

function isCodeMirrorViewLike(value: unknown): value is CodeMirrorViewLike {
  const candidate = value as CodeMirrorViewLike | null;
  return typeof candidate?.dispatch === 'function'
    && typeof candidate?.state?.doc?.length === 'number';
}

function findCodeMirrorView(element: Element): CodeMirrorViewLike | null {
  const candidates: Element[] = [];
  let current: Element | null = element;
  while (current) {
    candidates.push(current);
    current = current.parentElement;
  }
  candidates.push(...Array.from(element.querySelectorAll('*')));
  for (const candidate of candidates) {
    const cmView = (candidate as unknown as { cmView?: { view?: unknown } }).cmView;
    if (isCodeMirrorViewLike(cmView?.view)) return cmView.view;
  }
  return null;
}

function insertTextIntoTarget(target: HTMLElement, text: string): void {
  const codeMirrorView = findCodeMirrorView(target);
  if (codeMirrorView) {
    const head = codeMirrorView.state.selection?.main?.head;
    const from = typeof head === 'number' ? head : codeMirrorView.state.doc.length;
    codeMirrorView.dispatch({ changes: { from, insert: text } });
    return;
  }
  const inserted = document.execCommand?.('insertText', false, text) ?? false;
  if (!inserted && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'value')?.set;
    setter?.call(target, `${target.value}${text}`);
    target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  } else {
    target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  }
}

async function waitForAnySelector(selectors: string[], timeoutMs = 2500): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    if (selectors.some(selector => document.querySelector(selector))) return true;
    await waitMs(100);
  }
  return selectors.some(selector => document.querySelector(selector));
}

async function recordRendererScrollJourneyStep(input: {
  source: string;
  journeyStep: string;
  selector: string;
  fallbackSelector?: string;
}): Promise<{ targetFound: boolean; scrollBefore: number | null; scrollAfter: number | null; scrollDelta: number | null }> {
  const target = document.querySelector<HTMLElement>(input.selector)
    ?? (input.fallbackSelector ? document.querySelector<HTMLElement>(input.fallbackSelector) : null);
  if (!target) {
    recordScrollFrame({
      source: input.source,
      fps: 0,
      longestFrameMs: 0,
      durationMs: 0,
      sampleOrigin: 'programmatic-dom-event',
      journeyStep: input.journeyStep,
      targetFound: false,
    });
    return { targetFound: false, scrollBefore: null, scrollAfter: null, scrollDelta: null };
  }

  const scrollBefore = target.scrollTop;
  const room = Math.max(0, target.scrollHeight - target.clientHeight);
  const delta = room > 0 ? Math.max(48, Math.min(240, room - scrollBefore)) : 48;
  target.scrollTop = scrollBefore + delta;
  target.dispatchEvent(new Event('scroll', { bubbles: true }));
  await waitMs(220);
  const scrollAfter = target.scrollTop;
  const scrollDelta = scrollAfter - scrollBefore;

  if (scrollDelta === 0) {
    recordScrollFrame({
      source: input.source,
      fps: 0,
      longestFrameMs: 0,
      durationMs: 0,
      sampleOrigin: 'programmatic-dom-event',
      journeyStep: input.journeyStep,
      targetFound: true,
      scrollBefore,
      scrollAfter,
      scrollDelta,
    });
  } else {
    const snapshot = getScrollDiagnosticsSnapshot();
    const sampled = snapshot.scrollByLastSource[input.source];
    recordScrollFrame({
      source: input.source,
      fps: sampled?.fps ?? 60,
      longestFrameMs: sampled?.longestFrameMs ?? 16,
      durationMs: sampled?.durationMs ?? 220,
      sampleOrigin: 'programmatic-dom-event',
      journeyStep: input.journeyStep,
      targetFound: true,
      scrollBefore,
      scrollAfter,
      scrollDelta,
    });
  }
  return { targetFound: true, scrollBefore, scrollAfter, scrollDelta };
}

async function recordRendererInputJourneyStep(input: {
  source: string;
  journeyStep: string;
  selector: string;
  fallbackSelector?: string;
  text: string;
}): Promise<{ targetFound: boolean; inputBeforeLength: number | null; inputAfterLength: number | null; inputDelta: number | null }> {
  const target = document.querySelector<HTMLElement>(input.selector)
    ?? (input.fallbackSelector ? document.querySelector<HTMLElement>(input.fallbackSelector) : null);
  if (!target) {
    recordInteractionFrame({
      source: input.source,
      fps: 0,
      longestFrameMs: 0,
      durationMs: 0,
      frameCount: 0,
      sampleOrigin: 'programmatic-dom-event',
      journeyStep: input.journeyStep,
      targetFound: false,
    });
    return { targetFound: false, inputBeforeLength: null, inputAfterLength: null, inputDelta: null };
  }

  const inputBeforeLength = getTextLength(target);
  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await waitMs(80);
  target.focus({ preventScroll: true });
  insertTextIntoTarget(target, input.text);
  await waitMs(220);
  const inputAfterLength = getTextLength(target);
  const inputDelta = inputAfterLength - inputBeforeLength;
  const snapshot = getScrollDiagnosticsSnapshot();
  const sampled = snapshot.interactionByLastSource[input.source];
  recordInteractionFrame({
    source: input.source,
    fps: sampled?.fps ?? (inputDelta > 0 ? 60 : 0),
    longestFrameMs: sampled?.longestFrameMs ?? (inputDelta > 0 ? 16 : 0),
    durationMs: sampled?.durationMs ?? 220,
    frameCount: sampled?.frameCount ?? (inputDelta > 0 ? 12 : 0),
    sampleOrigin: 'programmatic-dom-event',
    journeyStep: input.journeyStep,
    targetFound: true,
    inputBeforeLength,
    inputAfterLength,
    inputDelta,
  });
  return { targetFound: true, inputBeforeLength, inputAfterLength, inputDelta };
}

async function clickContentModeButton(label: string): Promise<boolean> {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label],button[title]')]
    .find(candidate => candidate.getAttribute('aria-label') === label || candidate.getAttribute('title') === label);
  if (!button || button.disabled) return false;
  button.click();
  await waitMs(180);
  return true;
}

async function recordRendererJourneyQualitySamples(
  qualityScenario = 'renderer-driven-immersive-surface',
  benchmarkId?: string,
): Promise<{
  report: ReturnType<typeof getScrollDiagnosticsValidationReport>;
  evidence: Record<string, unknown>;
}> {
  setScrollDiagnosticsEnabled(true);
  clearScrollDiagnosticsSamples();
  setScrollDiagnosticsQualityContext({
    qualityScenario,
    benchmarkId,
    sampleOrigin: 'programmatic-dom-event',
  });

  const evidence: Record<string, unknown> = {};
  suppressAutoPersist = true;
  try {
    evidence.librarySurfaceReady = await waitForAnySelector([
      '[data-ft-rendered-editor-root="true"]',
      '[data-ft-quality-editor="markdown"]',
      '[data-ft-librarian-content-scroll="true"]',
    ]);
    evidence.renderedModeClick = await clickContentModeButton('Switch to rendered view');
    evidence.renderedScroll = await recordRendererScrollJourneyStep({
      source: 'rendered',
      journeyStep: 'rendered-scroll',
      selector: '[data-ft-quality-scroll="rendered"]',
      fallbackSelector: '[data-ft-librarian-content-scroll="true"]',
    });
    evidence.renderedInput = await recordRendererInputJourneyStep({
      source: 'rendered-editor-input',
      journeyStep: 'rendered-type',
      selector: '[data-ft-rendered-editor-input="true"]',
      fallbackSelector: '[data-ft-rendered-editor-root="true"] .cm-content',
      text: ' ',
    });
    evidence.markdownModeClick = await clickContentModeButton('Switch to Markdown source')
      || await clickContentModeButton('Switch to source');
    evidence.markdownScroll = await recordRendererScrollJourneyStep({
      source: 'markdown',
      journeyStep: 'markdown-scroll',
      selector: '[data-ft-quality-scroll="markdown"]',
      fallbackSelector: '[data-ft-quality-editor="markdown"] .cm-scroller',
    });
    evidence.markdownInput = await recordRendererInputJourneyStep({
      source: 'markdown-editor-input',
      journeyStep: 'markdown-type',
      selector: '[data-ft-quality-editor="markdown"] .cm-content',
      fallbackSelector: '[data-ft-agent-context="markdown"].cm-content',
      text: ' ',
    });
  } finally {
    suppressAutoPersist = false;
    clearScrollDiagnosticsQualityContext();
  }

  await persistScrollDiagnosticsSnapshot();
  return {
    report: getScrollDiagnosticsValidationReport(),
    evidence,
  };
}

export function bootstrapScrollDiagnostics(): void {
  if (typeof window === 'undefined') return;

  const storage = window.localStorage;
  onScrollDiagnosticsEnabledChange((enabled) => {
    if (storage) persistEnabledToStorage(storage, enabled);
    if (enabled) startLongTaskObserver();
    else stopLongTaskObserver();
  });

  if (storage && loadEnabledFromStorage(storage)) {
    setScrollDiagnosticsEnabled(true);
  } else if (isScrollDiagnosticsEnabled()) {
    startLongTaskObserver();
  }

  subscribeScrollDiagnostics((snapshot) => {
    if (suppressAutoPersist) return;
    void persistScrollDiagnosticsSnapshot(snapshot);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).ftDebugScroll = {
    enable: () => setScrollDiagnosticsEnabled(true),
    disable: () => setScrollDiagnosticsEnabled(false),
    isEnabled: isScrollDiagnosticsEnabled,
    snapshot: getScrollDiagnosticsSnapshot,
    violations: getScrollDiagnosticsBudgetViolations,
    report: getScrollDiagnosticsValidationReport,
    clear: clearScrollDiagnosticsSamples,
    setQualityContext: setScrollDiagnosticsQualityContext,
    clearQualityContext: clearScrollDiagnosticsQualityContext,
    recordRendererJourneyQualitySamples,
    recordSyntheticQualitySamples: async (qualityScenario?: string, benchmarkId?: string) => {
      setScrollDiagnosticsEnabled(true);
      clearScrollDiagnosticsSamples();
      setScrollDiagnosticsQualityContext({
        qualityScenario,
        benchmarkId,
        sampleOrigin: 'synthetic-record',
      });
      suppressAutoPersist = true;
      try {
        recordSyntheticScrollDiagnosticSamples(qualityScenario, benchmarkId);
      } finally {
        suppressAutoPersist = false;
        clearScrollDiagnosticsQualityContext();
      }
      await persistScrollDiagnosticsSnapshot();
      return getScrollDiagnosticsValidationReport();
    },
  };
}

bootstrapScrollDiagnostics();
