/**
 * RecentManager
 *
 * Tracks recently opened library items (wiki pages and external markdown files)
 * so the sidebar can surface "Recent" sections. Persists to recent.json in the
 * per-user data directory. Schema-versioned JSON, capped list, write-on-change.
 */

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { UserDataManager } from './userDataManager';
import { createLogger } from './logger';

const log = createLogger('Recent');

const MAX_ENTRIES = 50;
const SCHEMA_VERSION = 1;

export type RecentKind = 'wiki' | 'external';

export interface RecentEntry {
  kind: RecentKind;
  path: string;        // Canonical abs path for external; relPath for wiki
  title: string;
  lastOpenedAt: number;
}

interface RecentFile {
  schemaVersion: number;
  entries: RecentEntry[];
}

/** Pure: merge a newly-visited entry into the existing list, dedup on
 *  (kind,path), and cap at MAX_ENTRIES with newest-first ordering. */
export function upsertRecent(
  entries: RecentEntry[],
  entry: RecentEntry,
  max: number = MAX_ENTRIES,
): RecentEntry[] {
  const filtered = entries.filter((e) => !(e.kind === entry.kind && e.path === entry.path));
  return [entry, ...filtered].slice(0, max);
}

export function removeRecent(
  entries: RecentEntry[],
  kind: RecentKind,
  path: string,
): RecentEntry[] {
  return entries.filter((e) => !(e.kind === kind && e.path === path));
}

export function isLegacyCommandsRecentEntry(entry: RecentEntry): boolean {
  const legacyCommandsSegment = `${path.sep}.fieldtheory${path.sep}commands${path.sep}`;
  return entry.kind === 'external' && path.normalize(entry.path).includes(legacyCommandsSegment);
}

function parseRecentFile(raw: string): RecentEntry[] {
  try {
    const parsed = JSON.parse(raw) as Partial<RecentFile>;
    if (!parsed?.entries || !Array.isArray(parsed.entries)) return [];
    return parsed.entries.filter(isValidEntry).filter((entry) => !isLegacyCommandsRecentEntry(entry));
  } catch {
    return [];
  }
}

function isValidEntry(e: unknown): e is RecentEntry {
  if (!e || typeof e !== 'object') return false;
  const r = e as Record<string, unknown>;
  return (
    (r.kind === 'wiki' || r.kind === 'external') &&
    typeof r.path === 'string' && r.path.length > 0 &&
    typeof r.title === 'string' &&
    typeof r.lastOpenedAt === 'number'
  );
}

export class RecentManager {
  private entries: RecentEntry[] = [];
  private userDataManager: UserDataManager | null = null;
  private loaded = false;

  setUserDataManager(manager: UserDataManager): void {
    this.userDataManager = manager;
    this.loaded = false;
    this.entries = [];
  }

  private filePath(): string {
    if (this.userDataManager?.isLoggedIn()) {
      return this.userDataManager.getUserDataPath('recent.json');
    }
    return path.join(app.getPath('userData'), 'recent.json');
  }

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    const file = this.filePath();
    if (!fs.existsSync(file)) {
      this.entries = [];
      return;
    }
    try {
      this.entries = parseRecentFile(fs.readFileSync(file, 'utf-8'));
    } catch (err) {
      log.error('Failed to read recent.json:', err);
      this.entries = [];
    }
  }

  private writeToDisk(): void {
    const file = this.filePath();
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const payload: RecentFile = { schemaVersion: SCHEMA_VERSION, entries: this.entries };
      fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8');
    } catch (err) {
      log.error('Failed to write recent.json:', err);
    }
  }

  list(): RecentEntry[] {
    this.ensureLoaded();
    return this.entries.slice();
  }

  visit(entry: RecentEntry): RecentEntry[] {
    this.ensureLoaded();
    if (isLegacyCommandsRecentEntry(entry)) {
      return this.entries.slice();
    }
    this.entries = upsertRecent(this.entries, entry);
    this.writeToDisk();
    return this.entries.slice();
  }

  remove(kind: RecentKind, entryPath: string): RecentEntry[] {
    this.ensureLoaded();
    this.entries = removeRecent(this.entries, kind, entryPath);
    this.writeToDisk();
    return this.entries.slice();
  }
}
