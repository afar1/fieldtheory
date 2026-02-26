import { EventEmitter } from 'events';
import { createLogger } from '../logger';
import { NativeHelper } from '../nativeHelper';
import { NativeWindowInfo } from '../types/audio';
import { GazeWindowSnapshot } from '../types/gaze';

const log = createLogger('GazeWindowListCache');
const DEFAULT_REFRESH_INTERVAL_MS = 500;

/**
 * Maintains a cached list of on-screen windows for gaze-to-window mapping.
 */
export class GazeWindowListCache extends EventEmitter {
  private readonly helper: NativeHelper;
  private readonly refreshIntervalMs: number;
  private intervalHandle: NodeJS.Timeout | null = null;
  private refreshInFlight = false;
  private running = false;
  private windows: GazeWindowSnapshot[] = [];
  private lastRefreshedAtMs: number | null = null;

  constructor(helper: NativeHelper, refreshIntervalMs: number = DEFAULT_REFRESH_INTERVAL_MS) {
    super();
    this.helper = helper;
    this.refreshIntervalMs = Math.max(200, Math.round(refreshIntervalMs));
  }

  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;

    this.intervalHandle = setInterval(() => {
      void this.refreshNow('interval');
    }, this.refreshIntervalMs);
    this.intervalHandle.unref?.();

    void this.refreshNow('start');
  }

  stop(): void {
    this.running = false;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  getSnapshot(): GazeWindowSnapshot[] {
    return this.windows.map(cloneWindow);
  }

  getLastRefreshedAtMs(): number | null {
    return this.lastRefreshedAtMs;
  }

  async refreshNow(reason: string = 'manual'): Promise<GazeWindowSnapshot[]> {
    if (this.refreshInFlight) {
      return this.getSnapshot();
    }
    this.refreshInFlight = true;

    try {
      const raw = await this.helper.getWindowList();
      const next = normalizeWindowList(raw);
      this.windows = next;
      this.lastRefreshedAtMs = Date.now();
      this.emit('updated', this.getSnapshot(), reason);
      return this.getSnapshot();
    } catch (error) {
      log.warn('Failed to refresh window list cache:', error);
      return this.getSnapshot();
    } finally {
      this.refreshInFlight = false;
    }
  }
}

function normalizeWindowList(rawWindows: NativeWindowInfo[]): GazeWindowSnapshot[] {
  if (!Array.isArray(rawWindows)) {
    return [];
  }

  const seenWindowIds = new Set<number>();
  const normalized: GazeWindowSnapshot[] = [];

  for (const raw of rawWindows) {
    if (!raw || typeof raw.windowId !== 'number' || seenWindowIds.has(raw.windowId)) {
      continue;
    }
    if (!isFinitePositive(raw.width) || !isFinitePositive(raw.height)) {
      continue;
    }
    if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y)) {
      continue;
    }
    if (!Number.isFinite(raw.layer) || raw.layer !== 0) {
      continue;
    }
    if (raw.width < 80 || raw.height < 80) {
      continue;
    }

    seenWindowIds.add(raw.windowId);
    normalized.push({
      windowId: raw.windowId,
      ownerName: typeof raw.ownerName === 'string' ? raw.ownerName : 'Unknown App',
      ownerBundleId: typeof raw.ownerBundleId === 'string' ? raw.ownerBundleId : '',
      ownerPID: typeof raw.ownerPID === 'number' && Number.isFinite(raw.ownerPID) ? raw.ownerPID : -1,
      title: typeof raw.title === 'string' ? raw.title : '',
      bounds: {
        x: raw.x,
        y: raw.y,
        width: raw.width,
        height: raw.height,
      },
      layer: raw.layer,
    });
  }

  return normalized;
}

function cloneWindow(window: GazeWindowSnapshot): GazeWindowSnapshot {
  return {
    windowId: window.windowId,
    ownerName: window.ownerName,
    ownerBundleId: window.ownerBundleId,
    ownerPID: window.ownerPID,
    title: window.title,
    bounds: { ...window.bounds },
    layer: window.layer,
  };
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
