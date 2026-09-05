import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BookmarkSyncStateStore, restoreBookmarkSyncState } from './bookmarkSyncStateStore';
const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

describe('BookmarkSyncStateStore', () => {
  it('rejects malformed state and bounds corrupt or stale timestamps', () => {
    const now = Date.parse('2026-09-05T12:00:00Z');
    expect(restoreBookmarkSyncState(null, now)).toBeNull();
    expect(restoreBookmarkSyncState({ version: 99 }, now)).toBeNull();
    expect(restoreBookmarkSyncState({ version: 1, lastCheckedAt: 'invalid', lastAttemptAt: now + 1, blockedUntil: now + 1e12, pendingMaintenance: true, maintenanceDue: Infinity, lastMaintenanceAt: now - 1e12, failures: 999 }, now)).toMatchObject({
      lastCheckedAt: null, lastAttemptAt: null, blockedUntil: 0, failures: 0, maintenanceDue: now + 30_000, lastMaintenanceAt: null,
    });
    expect(restoreBookmarkSyncState({ version: 1, lastCheckedAt: new Date(now + 1).toISOString() }, now)?.lastCheckedAt).toBeNull();
  });

  it('writes a small atomic snapshot only when persisted state changes', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bookmark-sync-state-')); directories.push(directory);
    const file = path.join(directory, 'app-sync-state.json');
    const store = new BookmarkSyncStateStore(file);
    const state = restoreBookmarkSyncState({ version: 1 }, Date.now())!;
    const writes = vi.spyOn(fs, 'renameSync');
    try {
      store.save(state); store.save({ ...state });
      expect(writes).toHaveBeenCalledTimes(1);
      expect(store.load()).toEqual(state);
      expect(fs.readdirSync(directory)).toEqual(['app-sync-state.json']);
      fs.writeFileSync(file, '{broken'); expect(store.load()).toBeNull();
      fs.writeFileSync(file, 'x'.repeat(17 * 1024)); expect(store.load()).toBeNull();
    } finally { writes.mockRestore(); }
  });
});
