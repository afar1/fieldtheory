import fs from 'fs';
import path from 'path';

export type PersistedBookmarkSyncState = {
  version: 1;
  lastCheckedAt: string | null;
  lastAttemptAt: number | null;
  blockedUntil: number;
  failures: number;
  retryPhase: 'backoff' | 'unsupported' | null;
  pendingMaintenance: boolean;
  needsIndex: boolean;
  maintenanceDue: number | null;
  lastMaintenanceAt: number | null;
};
const DAY = 24 * 60 * 60_000;

export function restoreBookmarkSyncState(value: unknown, now: number): PersistedBookmarkSyncState | null {
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) return null;
  const state = value as Partial<PersistedBookmarkSyncState>;
  const recentPast = (time: unknown): number | null => typeof time === 'number' && Number.isFinite(time) && time > now - DAY && time <= now ? time : null;
  const checked = typeof state.lastCheckedAt === 'string' ? Date.parse(state.lastCheckedAt) : NaN;
  const blockedUntil = typeof state.blockedUntil === 'number' && Number.isFinite(state.blockedUntil) && state.blockedUntil > now && state.blockedUntil <= now + DAY ? state.blockedUntil : 0;
  const pendingMaintenance = state.pendingMaintenance === true;
  const due = typeof state.maintenanceDue === 'number' && Number.isFinite(state.maintenanceDue) && state.maintenanceDue > 0 && state.maintenanceDue <= now + DAY ? Math.max(now + 30_000, state.maintenanceDue) : now + 30_000;
  return {
    version: 1,
    lastCheckedAt: Number.isFinite(checked) && checked >= 0 && checked <= now ? new Date(checked).toISOString() : null,
    lastAttemptAt: recentPast(state.lastAttemptAt),
    blockedUntil,
    failures: blockedUntil && Number.isInteger(state.failures) ? Math.min(10, Math.max(0, state.failures!)) : 0,
    retryPhase: blockedUntil ? state.retryPhase === 'unsupported' ? 'unsupported' : 'backoff' : null,
    pendingMaintenance,
    needsIndex: pendingMaintenance && state.needsIndex === true,
    maintenanceDue: pendingMaintenance ? due : null,
    lastMaintenanceAt: recentPast(state.lastMaintenanceAt),
  };
}

/** Tiny transition-only state; no bookmark content or credentials. */
export class BookmarkSyncStateStore {
  private lastWritten = '';
  constructor(private readonly filePath: string) {}
  load(): unknown {
    try {
      if (fs.statSync(this.filePath).size > 16 * 1024) return null;
      return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    } catch { return null; }
  }
  save(state: PersistedBookmarkSyncState): void {
    const content = JSON.stringify(state);
    if (content === this.lastWritten) return;
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(temporary, content, { mode: 0o600 });
      fs.renameSync(temporary, this.filePath);
      this.lastWritten = content;
    } catch {
      try { fs.unlinkSync(temporary); } catch { /* No temporary file to remove. */ }
    }
  }
}
