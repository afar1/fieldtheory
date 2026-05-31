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
  qualityScenario?: string;
  benchmarkId?: string;
  sampleOrigin?: string;
  journeyStep?: string;
  targetFound?: boolean;
  scrollBefore?: number;
  scrollAfter?: number;
  scrollDelta?: number;
}

export interface InteractionFrameRecord {
  source: string;
  fps: number;
  longestFrameMs: number;
  durationMs: number;
  frameCount: number;
  timestamp: number;
  qualityScenario?: string;
  benchmarkId?: string;
  sampleOrigin?: string;
  journeyStep?: string;
  targetFound?: boolean;
  inputBeforeLength?: number;
  inputAfterLength?: number;
  inputDelta?: number;
}

export interface ScrollDiagnosticsSnapshot {
  enabled: boolean;
  scrollByLastSource: Record<string, ScrollFrameRecord>;
  interactionByLastSource: Record<string, InteractionFrameRecord>;
  longTasks: Array<{
    duration: number;
    startTime: number;
    qualityScenario?: string;
    benchmarkId?: string;
    sampleOrigin?: string;
    journeyStep?: string;
  }>;
}

export interface ScrollDiagnosticsBudgetViolation {
  kind: 'scroll' | 'interaction';
  source: string;
  fps: number;
  targetFps: number;
  allowedDropFps: number;
  longestFrameMs: number;
  durationMs: number;
  timestamp: number;
}

export interface ScrollDiagnosticsValidationReport {
  pass: boolean;
  targetFps: number;
  allowedDropFps: number;
  firstSampleTimestamp: number | null;
  lastSampleTimestamp: number | null;
  sampleSpanMs: number | null;
  longTaskCount: number;
  longTaskTotalMs: number;
  longestLongTaskMs: number;
  requiredScrollSources: string[];
  sampledScrollSources: string[];
  missingScrollSources: string[];
  requiredInteractionSources: string[];
  sampledInteractionSources: string[];
  missingInteractionSources: string[];
  violations: ScrollDiagnosticsBudgetViolation[];
}

export const SCROLL_DIAGNOSTICS_STORAGE_KEY = 'ft-debug-scroll';
export const SCROLL_DIAGNOSTICS_TARGET_FPS = 120;
export const SCROLL_DIAGNOSTICS_ALLOWED_DROP_FPS = 1;
export const SCROLL_DIAGNOSTICS_REQUIRED_SCROLL_SOURCES = [
  'markdown',
  'rendered',
] as const;
export const SCROLL_DIAGNOSTICS_REQUIRED_INTERACTION_SOURCES = [
  'launcher-input',
  'markdown-editor-input',
  'rendered-editor-input',
] as const;
const SCROLL_DIAGNOSTICS_WARNING_DROP_FPS = 10;
const LONG_TASK_HISTORY = 16;

const listeners = new Set<(snap: ScrollDiagnosticsSnapshot) => void>();

let state: ScrollDiagnosticsSnapshot = {
  enabled: false,
  scrollByLastSource: {},
  interactionByLastSource: {},
  longTasks: [],
};

type EnabledChangeListener = (enabled: boolean) => void;
const enabledChangeListeners = new Set<EnabledChangeListener>();

export interface ScrollDiagnosticsQualityContext {
  qualityScenario?: string;
  benchmarkId?: string;
  sampleOrigin?: string;
  journeyStep?: string;
}

let qualityContext: ScrollDiagnosticsQualityContext = {};

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
  const merged = [...state.longTasks, { ...qualityContext, ...entry }].slice(-LONG_TASK_HISTORY);
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
  const next: ScrollFrameRecord = { ...qualityContext, ...record, timestamp: performance.now() };
  state = {
    ...state,
    scrollByLastSource: { ...state.scrollByLastSource, [record.source]: next },
  };
  emit();
}

export function recordInteractionFrame(record: Omit<InteractionFrameRecord, 'timestamp'>): void {
  if (!state.enabled) return;
  const next: InteractionFrameRecord = { ...qualityContext, ...record, timestamp: performance.now() };
  state = {
    ...state,
    interactionByLastSource: { ...state.interactionByLastSource, [record.source]: next },
  };
  emit();
}

export function setScrollDiagnosticsQualityContext(context: ScrollDiagnosticsQualityContext): void {
  qualityContext = { ...context };
}

export function clearScrollDiagnosticsQualityContext(): void {
  qualityContext = {};
}

export function recordSyntheticScrollDiagnosticSamples(
  qualityScenario = 'synthetic-immersive-surface',
  benchmarkId?: string,
): void {
  if (!state.enabled) return;
  const samples = [
    { source: 'markdown', fps: 120, longestFrameMs: 8, durationMs: 220 },
    { source: 'rendered', fps: 120, longestFrameMs: 8, durationMs: 220 },
  ];
  for (const sample of samples) {
    recordScrollFrame({
      ...sample,
      qualityScenario,
      benchmarkId,
      sampleOrigin: 'synthetic-record',
    });
  }
  const interactionSamples = [
    { source: 'launcher-input', fps: 120, longestFrameMs: 8, durationMs: 180, frameCount: 22 },
    { source: 'markdown-editor-input', fps: 120, longestFrameMs: 8, durationMs: 180, frameCount: 22 },
    { source: 'rendered-editor-input', fps: 120, longestFrameMs: 8, durationMs: 180, frameCount: 22 },
  ];
  for (const sample of interactionSamples) {
    recordInteractionFrame({
      ...sample,
      qualityScenario,
      benchmarkId,
      sampleOrigin: 'synthetic-record',
    });
  }
}

export function getScrollDiagnosticsFpsLevel(fps: number): 'muted' | 'ok' | 'warning' | 'bad' {
  if (fps === 0) return 'muted';
  if (fps >= SCROLL_DIAGNOSTICS_TARGET_FPS - SCROLL_DIAGNOSTICS_ALLOWED_DROP_FPS) return 'ok';
  if (fps >= SCROLL_DIAGNOSTICS_TARGET_FPS - SCROLL_DIAGNOSTICS_WARNING_DROP_FPS) return 'warning';
  return 'bad';
}

export function getScrollDiagnosticsBudgetViolations(
  snapshot: ScrollDiagnosticsSnapshot = state,
): ScrollDiagnosticsBudgetViolation[] {
  const floor = SCROLL_DIAGNOSTICS_TARGET_FPS - SCROLL_DIAGNOSTICS_ALLOWED_DROP_FPS;
  const violations: ScrollDiagnosticsBudgetViolation[] = [];
  const collect = (
    kind: ScrollDiagnosticsBudgetViolation['kind'],
    records: Record<string, ScrollFrameRecord | InteractionFrameRecord>,
  ) => {
    for (const record of Object.values(records)) {
      if (record.fps === 0 || record.fps >= floor) continue;
      violations.push({
        kind,
        source: record.source,
        fps: record.fps,
        targetFps: SCROLL_DIAGNOSTICS_TARGET_FPS,
        allowedDropFps: SCROLL_DIAGNOSTICS_ALLOWED_DROP_FPS,
        longestFrameMs: record.longestFrameMs,
        durationMs: record.durationMs,
        timestamp: record.timestamp,
      });
    }
  };
  collect('scroll', snapshot.scrollByLastSource);
  collect('interaction', snapshot.interactionByLastSource);
  return violations.sort((a, b) => a.fps - b.fps || b.timestamp - a.timestamp);
}

export function getScrollDiagnosticsValidationReport(
  snapshot: ScrollDiagnosticsSnapshot = state,
  requiredInteractionSources: readonly string[] = SCROLL_DIAGNOSTICS_REQUIRED_INTERACTION_SOURCES,
  requiredScrollSources: readonly string[] = SCROLL_DIAGNOSTICS_REQUIRED_SCROLL_SOURCES,
): ScrollDiagnosticsValidationReport {
  const sampledScrollSources = Object.keys(snapshot.scrollByLastSource).sort();
  const sampledScrollSourceSet = new Set(sampledScrollSources);
  const missingScrollSources = requiredScrollSources
    .filter(source => !sampledScrollSourceSet.has(source));
  const sampledInteractionSources = Object.keys(snapshot.interactionByLastSource).sort();
  const sampledInteractionSourceSet = new Set(sampledInteractionSources);
  const missingInteractionSources = requiredInteractionSources
    .filter(source => !sampledInteractionSourceSet.has(source));
  const violations = getScrollDiagnosticsBudgetViolations(snapshot);
  const sampleTimestamps = [
    ...Object.values(snapshot.scrollByLastSource).map(record => record.timestamp),
    ...Object.values(snapshot.interactionByLastSource).map(record => record.timestamp),
    ...snapshot.longTasks.map(task => task.startTime),
  ];
  const firstSampleTimestamp = sampleTimestamps.length > 0 ? Math.min(...sampleTimestamps) : null;
  const lastSampleTimestamp = sampleTimestamps.length > 0 ? Math.max(...sampleTimestamps) : null;
  const longTaskCount = snapshot.longTasks.length;
  const longTaskTotalMs = snapshot.longTasks.reduce((sum, task) => sum + task.duration, 0);
  const longestLongTaskMs = snapshot.longTasks.reduce((max, task) => Math.max(max, task.duration), 0);
  return {
    pass: missingScrollSources.length === 0
      && missingInteractionSources.length === 0
      && violations.length === 0
      && longTaskCount === 0,
    targetFps: SCROLL_DIAGNOSTICS_TARGET_FPS,
    allowedDropFps: SCROLL_DIAGNOSTICS_ALLOWED_DROP_FPS,
    firstSampleTimestamp,
    lastSampleTimestamp,
    sampleSpanMs: firstSampleTimestamp !== null && lastSampleTimestamp !== null
      ? lastSampleTimestamp - firstSampleTimestamp
      : null,
    longTaskCount,
    longTaskTotalMs,
    longestLongTaskMs,
    requiredScrollSources: [...requiredScrollSources],
    sampledScrollSources,
    missingScrollSources,
    requiredInteractionSources: [...requiredInteractionSources],
    sampledInteractionSources,
    missingInteractionSources,
    violations,
  };
}

export function clearScrollDiagnosticsSamples(): void {
  state = {
    ...state,
    scrollByLastSource: {},
    interactionByLastSource: {},
    longTasks: [],
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
    interactionByLastSource: {},
    longTasks: [],
  };
  qualityContext = {};
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
