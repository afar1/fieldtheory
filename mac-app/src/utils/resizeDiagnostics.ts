/** Opt-in, bounded metadata capture. No IPC or console writes while measuring. */
export type ResizeDiagnosticEvent = { timeMs: number; stage: string; [key: string]: number | boolean | string };
const MAX_EVENTS = 6000;
let active = false;
let origin = 0;
let events: ResizeDiagnosticEvent[] = [];
let dropped = 0;
let cleanup: (() => void) | undefined;
let saving: Promise<unknown> | undefined;
let savedCapture: Record<string, unknown> | undefined;
export const exportResizeCapture = () => JSON.stringify(savedCapture ?? resizeCaptureSnapshot(), null, 2);
export const hasResizeCapture = () => events.length > 0;
let status = 'Ready to capture resize diagnostics.';
export const getResizeCaptureStatus = () => status;
function setStatus(value: string) { status = value; window.dispatchEvent(new Event('fieldtheory:resize-capture-status')); }
export const isResizeCaptureActive = () => active;
export function recordResizeDiagnostic(stage: string, details: Record<string, unknown> = {}) {
  if (!active) return;
  if (events.length >= MAX_EVENTS) { dropped++; return; }
  const metadata: Record<string, number | boolean> = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) metadata[key] = value;
  }
  events.push({ ...metadata, timeMs: performance.now() - origin, stage });
}
export function measureResizeStage<T>(stage: string, operation: () => T): T {
  if (!active) return operation();
  const start = performance.now();
  try { return operation(); } finally { recordResizeDiagnostic(stage, { durationMs: performance.now() - start }); }
}
export function resizeCaptureSnapshot() {
  return { events: [...events], dropped, active };
}
export async function stopResizeCapture() {
  if (!active) return saving;
  recordResizeDiagnostic('capture-stop');
  active = false;
  cleanup?.(); cleanup = undefined;
  const snapshot = resizeCaptureSnapshot();
  // Preserve individual frame gaps; RAF cadence is not proof of compositor FPS.
  const frames = snapshot.events.filter(event => event.stage === 'frame');
  const summary = {
    eventCount: snapshot.events.length, dropped, frameCount: frames.length,
    longestFrameGapMs: Math.max(0, ...frames.map(event => Number(event.gapMs))),
    gapsOver33Ms: frames.filter(event => Number(event.gapMs) > 33).length,
  };
  savedCapture = { stage: 'resize-capture', timestamp: Date.now(), summary, events: snapshot.events };
  return saveResizeCapture();
}
export async function saveResizeCapture() {
  if (saving) return saving;
  if (active || !savedCapture) return;
  saving = (async () => {
    if (!window.diagnosticsAPI?.appendRenderedEditorDebug) throw new Error('Diagnostic log API unavailable');
    const result = await window.diagnosticsAPI.appendRenderedEditorDebug(savedCapture);
    if (!result.ok) throw new Error(result.error || 'Could not save resize capture');
    setStatus(`Resize capture saved: ${result.path}`);
    return result;
  })().catch(error => { setStatus('Could not save resize capture. The in-memory snapshot remains available until the next capture.'); throw error; }).finally(() => { saving = undefined; });
  return saving;
}
export function startResizeCapture(durationMs = 60_000) {
  if (active || saving) return;
  savedCapture = undefined;
  active = true; events = []; dropped = 0; origin = performance.now();
  setStatus('Capturing for 60 seconds. Close Settings, open your file, then resize the window.');
  let lastResize = -Infinity;
  let previousFrame = 0;
  let frame = 0;
  const tick = (now: number) => {
    if (!active) return;
    if (performance.now() - lastResize > 300) { frame = 0; previousFrame = 0; return; }
    if (previousFrame) recordResizeDiagnostic('frame', { gapMs: now - previousFrame });
    previousFrame = now;
    frame = requestAnimationFrame(tick);
  };
  const resize = () => {
    lastResize = performance.now();
    recordResizeDiagnostic('window-resize', { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio });
    if (!frame) frame = requestAnimationFrame(tick);
  };
  const visibility = () => recordResizeDiagnostic('visibility', { hidden: document.hidden });
  const observers: PerformanceObserver[] = [];
  for (const type of ['longtask', 'layout-shift']) {
    if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes(type)) continue;
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) recordResizeDiagnostic(type, {
        startTimeMs: entry.startTime - origin, durationMs: entry.duration,
        value: (entry as PerformanceEntry & { value?: number }).value,
      });
    });
    observer.observe({ type, buffered: false }); observers.push(observer);
  }
  window.addEventListener('resize', resize, { passive: true });
  document.addEventListener('visibilitychange', visibility);
  const timer = window.setTimeout(() => { void stopResizeCapture().catch(() => {}); }, Math.min(120_000, Math.max(1000, durationMs)));
  cleanup = () => {
    cancelAnimationFrame(frame); window.clearTimeout(timer);
    observers.forEach(observer => observer.disconnect());
    window.removeEventListener('resize', resize);
    document.removeEventListener('visibilitychange', visibility);
  };
  recordResizeDiagnostic('capture-start', { durationMs, width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio, longTasksSupported: observers.length > 0 });
}
