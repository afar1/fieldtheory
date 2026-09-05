/** App-owned freshness checks. Timers do no work until a bounded CLI job is due. */
export type BookmarkSyncState = {
  phase: 'idle' | 'syncing' | 'offline' | 'backoff' | 'unsupported';
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  error: string | null;
};
export type QuickBookmarkSync = {
  status: 'synced' | 'rate_limited' | 'timeout' | 'error' | 'unsupported';
  added?: number;
  changed?: number;
  retryAfterSec?: number;
  error?: string;
};
export type BookmarkSyncResult = {
  status: 'synced' | 'too-recent' | 'offline' | 'unavailable' | 'unsupported' | 'failed';
  lastCheckedAt: string | null;
  error?: string;
};

const MINUTE = 60_000;
const MAINTENANCE_INTERVAL = 15 * MINUTE;

type Options = {
  quick: (signal: AbortSignal) => Promise<QuickBookmarkSync>;
  maintenance?: (signal: AbortSignal, work: { index: boolean }) => Promise<{ remaining?: boolean; changed?: boolean; retryAfterSec?: number }>;
  isOnline: () => boolean;
  onChanged: () => void;
  onState: (state: BookmarkSyncState) => void;
  now?: () => number;
};

export class BookmarkSyncController {
  private state: BookmarkSyncState = { phase: 'idle', lastCheckedAt: null, nextCheckAt: null, error: null };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<BookmarkSyncResult> | null = null;
  private runningKind: 'quick' | 'maintenance' | null = null;
  private abort: AbortController | null = null;
  private started = false;
  private suspended = false;
  private lastActivity = -Infinity;
  private lastAttempt = -Infinity;
  private blockedUntil = 0;
  private failures = 0;
  private maintenanceDue: number | null = null;
  private lastMaintenance = -Infinity;
  private needsIndex = false;
  private readonly now: () => number;

  constructor(private readonly options: Options) { this.now = options.now ?? Date.now; }
  getState(): BookmarkSyncState { return { ...this.state }; }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.plan(this.now() + 10_000);
  }
  stop(): void {
    this.started = false;
    this.suspended = false;
    this.clearTimer();
    this.abort?.abort();
    this.publish({ nextCheckAt: null });
  }
  suspend(): void {
    this.suspended = true;
    this.clearTimer();
    this.abort?.abort();
    this.publish({ nextCheckAt: null });
  }
  resume(): void {
    this.suspended = false;
    if (this.started) this.plan(Math.max(this.now() + 3_000, this.blockedUntil, this.lastAttempt + MINUTE));
  }
  request(reason: 'activity' | 'timer' | 'network' = 'activity'): Promise<BookmarkSyncResult> {
    if (reason === 'activity') this.lastActivity = this.now();
    if (!this.started || this.suspended) return Promise.resolve(this.result('unavailable'));
    if (this.running) {
      if (this.runningKind === 'maintenance' && reason === 'activity') {
        const due = Math.max(this.blockedUntil, this.lastAttempt + MINUTE);
        if (this.now() < due) return Promise.resolve(this.result('too-recent'));
        // Foreground freshness takes precedence over optional media. Wait for the child
        // process to exit before starting another job so cancellation cannot overlap work.
        const maintenance = this.running;
        this.abort?.abort();
        return maintenance.then(() => this.request('activity'));
      }
      return this.running;
    }
    if (!this.options.isOnline()) {
      this.publish({ phase: 'offline', error: null });
      this.plan(this.now() + MINUTE);
      return Promise.resolve(this.result('offline'));
    }
    const due = Math.max(this.blockedUntil, this.lastAttempt + MINUTE);
    if (this.now() < due) {
      this.plan(due);
      return Promise.resolve(this.result('too-recent'));
    }
    this.clearTimer();
    this.lastAttempt = this.now();
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.publish({ phase: 'syncing', nextCheckAt: null, error: null });
    this.runningKind = 'quick';
    this.running = Promise.resolve().then(async () => {
      try {
        const outcome = await this.options.quick(signal);
        if (signal.aborted || !this.started) return this.result('unavailable');
        // Partial quick checks can still deliver new records before a rate limit.
        // Their data is useful, but only a completed check advances lastCheckedAt.
        if ((outcome.added ?? 0) + (outcome.changed ?? 0) > 0) {
          this.options.onChanged();
          this.needsIndex = true;
          if (this.options.maintenance && this.maintenanceDue === null) {
            this.maintenanceDue = Math.max(this.now() + 30_000, this.lastMaintenance + MAINTENANCE_INTERVAL);
          }
        }
        if (outcome.status !== 'synced') return this.failed(outcome);
        this.failures = 0;
        this.blockedUntil = 0;
        this.publish({ phase: 'idle', lastCheckedAt: new Date(this.now()).toISOString(), error: null });
        return this.result('synced');
      } catch (error) {
        if (signal.aborted || !this.started) return this.result('unavailable');
        return this.failed({ status: 'error', error: error instanceof Error ? error.message : String(error) });
      } finally {
        this.running = null;
        this.runningKind = null;
        this.abort = null;
        this.planNext();
      }
    });
    return this.running;
  }

  private result(status: BookmarkSyncResult['status'], error?: string): BookmarkSyncResult {
    return { status, lastCheckedAt: this.state.lastCheckedAt, ...(error ? { error } : {}) };
  }
  private failed(outcome: QuickBookmarkSync): BookmarkSyncResult {
    this.failures++;
    const backoff = outcome.status === 'unsupported' ? 6 * 60 * MINUTE
      : Math.max(Math.min(30 * MINUTE, MINUTE * 2 ** Math.min(this.failures - 1, 5)),
        outcome.status === 'rate_limited' ? 15 * MINUTE : 0,
        Math.min(24 * 60 * MINUTE, Math.max(0, outcome.retryAfterSec ?? 0) * 1000));
    this.blockedUntil = this.now() + backoff;
    const error = outcome.error ?? (outcome.status === 'unsupported' ? 'Bookmark sync requires an updated CLI.' : `Bookmark check ${outcome.status.replace('_', ' ')}.`);
    this.publish({ phase: outcome.status === 'unsupported' ? 'unsupported' : 'backoff', error });
    return this.result(outcome.status === 'unsupported' ? 'unsupported' : 'failed', error);
  }
  private interval(): number {
    const idle = this.now() - this.lastActivity;
    return idle < 5 * MINUTE ? MINUTE : idle < 30 * MINUTE ? 5 * MINUTE : 15 * MINUTE;
  }
  private planNext(): void {
    if (!this.started || this.suspended) return;
    const next = Math.max(this.now(), this.lastAttempt + this.interval(), this.blockedUntil);
    this.plan(this.maintenanceDue !== null && this.blockedUntil <= this.now() ? Math.min(next, this.maintenanceDue) : next);
  }
  private plan(at: number): void {
    if (!this.started || this.suspended) return;
    this.clearTimer();
    this.publish({ nextCheckAt: new Date(at).toISOString() });
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.options.isOnline()) { void this.request('network'); return; }
      const quickDue = Math.max(this.lastAttempt + this.interval(), this.blockedUntil);
      if (this.maintenanceDue !== null && this.maintenanceDue <= this.now() && quickDue > this.now()) {
        this.runMaintenance();
      } else { void this.request('timer'); }
    }, Math.max(0, at - this.now()));
    this.timer.unref?.();
  }
  private runMaintenance(): void {
    if (!this.options.maintenance || this.running || !this.started || this.suspended) return;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.maintenanceDue = null;
    this.lastMaintenance = this.now();
    const index = this.needsIndex;
    // Share the process lane; due foreground freshness can preempt optional media.
    this.runningKind = 'maintenance';
    this.running = Promise.resolve().then(async () => {
      try {
        const result = await this.options.maintenance!(signal, { index });
        if (!signal.aborted && this.started) {
          if (index) this.needsIndex = false;
          if (result.remaining) this.maintenanceDue = this.now() + Math.max(MAINTENANCE_INTERVAL, Math.min(24 * 60 * MINUTE, Math.max(0, result.retryAfterSec ?? 0) * 1000));
          if (result.changed) this.options.onChanged();
        }
      } catch {
        // Media is optional. Retry later, without invalidating a successful metadata check.
        this.maintenanceDue = this.now() + MAINTENANCE_INTERVAL;
      } finally {
        if (signal.aborted && this.maintenanceDue === null) this.maintenanceDue = this.now() + MAINTENANCE_INTERVAL;
        this.running = null;
        this.runningKind = null;
        this.abort = null;
        this.planNext();
      }
      return this.result('too-recent');
    });
  }
  private clearTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private publish(update: Partial<BookmarkSyncState>): void {
    const next = { ...this.state, ...update };
    if (JSON.stringify(next) !== JSON.stringify(this.state)) {
      this.state = next;
      this.options.onState(this.getState());
    }
  }
}
