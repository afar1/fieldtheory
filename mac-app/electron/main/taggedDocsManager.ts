import Database from 'better-sqlite3';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as chokidar from 'chokidar';
import { createLogger } from './logger';
import {
  SCAN_MAX_READ_BYTES,
  ULID_PATTERN,
  isMarkdownPath,
  normalizeEmail,
  isCommonIgnoredDir,
  parseTaggedDocFields,
  scanRoots,
  type ParsedTaggedDoc,
  type ScanLedgerEntry,
  type ScanOutput,
} from './taggedDocsScan';

// Re-export the pure scan-core public API so existing importers of
// './taggedDocsManager' keep resolving after the core moved to ./taggedDocsScan.
export {
  isMarkdownPath,
  parseFrontmatter,
  parseTaggedDocFields,
  walkMarkdownFiles,
  scanRoots,
  type ParsedTaggedDoc,
  type ScanLedgerEntry,
  type ScanFileResult,
  type ScanOutput,
} from './taggedDocsScan';

const log = createLogger('TaggedDocs');

export const TaggedDocsIPCChannels = {
  LIST: 'taggedDocs:list',
  MARK_READ: 'taggedDocs:markRead',
  MARK_ALL_READ: 'taggedDocs:markAllRead',
  RESCAN: 'taggedDocs:rescan',
  UPDATED: 'taggedDocs:updated',
  SCAN_PROGRESS: 'taggedDocs:scanProgress',
} as const;

export interface TaggedDoc {
  ulid: string;
  path: string;
  title: string;
  taggedBy: string | null;
  taggedAt: number | null;
  frontmatterUpdatedAt: number;
  fileHash: string;
  readAt: number | null;
  lastReadHash: string | null;
  unread: boolean;
}

export interface TaggedDocsScanProgress {
  phase: 'idle' | 'scanning' | 'done' | 'error';
  scanned: number;
  matched: number;
  roots: string[];
  currentPath?: string;
  error?: string;
}

interface TaggedDocRow {
  ulid: string;
  path: string;
  title: string;
  tagged_by: string | null;
  tagged_at: number | null;
  frontmatter_updated_at: number;
  file_hash: string;
  read_at: number | null;
  last_read_hash: string | null;
}

interface TaggedDocsManagerOptions {
  dbPath?: string;
  roots?: string[];
  homeDir?: string;
  watch?: boolean;
}

interface ProcessFileOptions {
  emitUpdated?: boolean;
  removeWhenUntagged?: boolean;
}

function rowToTaggedDoc(row: TaggedDocRow): TaggedDoc {
  return {
    ulid: row.ulid,
    path: row.path,
    title: row.title,
    taggedBy: row.tagged_by,
    taggedAt: row.tagged_at,
    frontmatterUpdatedAt: row.frontmatter_updated_at,
    fileHash: row.file_hash,
    readAt: row.read_at,
    lastReadHash: row.last_read_hash,
    unread: row.read_at === null || row.last_read_hash !== row.file_hash,
  };
}

export function discoverTaggedDocsSyncRoots(homeDir = os.homedir()): string[] {
  const candidates: string[] = [
    path.join(homeDir, 'Dropbox'),
    path.join(homeDir, 'Google Drive'),
  ];

  const cloudStorageDir = path.join(homeDir, 'Library', 'CloudStorage');
  if (fs.existsSync(cloudStorageDir)) {
    try {
      for (const entry of fs.readdirSync(cloudStorageDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          candidates.push(path.join(cloudStorageDir, entry.name));
        }
      }
    } catch (err) {
      log.warn('Failed to inspect CloudStorage roots:', err);
    }
  }

  const roots: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    try {
      const resolved = path.resolve(candidate);
      if (seen.has(resolved)) continue;
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) continue;
      roots.push(resolved);
      seen.add(resolved);
    } catch {
      // Ignore inaccessible sync roots.
    }
  }
  return roots;
}

export class TaggedDocsManager extends EventEmitter {
  private db: Database.Database | null = null;
  private dbPath: string | null = null;
  private roots: string[] = [];
  private watcher: chokidar.FSWatcher | null = null;
  private currentEmail: string | null = null;
  private rescanInProgress: Promise<TaggedDoc[]> | null = null;
  private watchEnabled: boolean;
  // Off-main-thread scan worker (lazily forked). Null when unavailable (e.g. in
  // unit tests, or before first use) — the manager then scans in-process.
  private worker: import('electron').UtilityProcess | null = null;
  private scanJobId = 0;

  constructor(options: TaggedDocsManagerOptions = {}) {
    super();
    this.watchEnabled = options.watch ?? true;
    if (options.dbPath) {
      this.setDatabasePath(options.dbPath);
    }
    // Roots are scoped to the directories the user added to their library
    // (left nav), supplied via setRoots(). We deliberately do NOT auto-discover
    // entire cloud-storage trees (~/Google Drive, ~/Library/CloudStorage/*) —
    // recursively scanning + watching those pegged the CPU because of their size
    // and constant background-sync churn.
    this.roots = options.roots ? this.normalizeRoots(options.roots) : [];
  }

  setDatabasePath(dbPath: string): void {
    if (this.dbPath === dbPath && this.db) return;

    this.db?.close();
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.initDatabase();
  }

  setRoots(roots: string[]): void {
    const normalized = this.normalizeRoots(roots);
    if (JSON.stringify(normalized) === JSON.stringify(this.roots)) return;
    this.roots = normalized;
    this.restartWatcher();
    // The watcher uses ignoreInitial, so it won't surface existing tagged docs
    // in a newly added root — rescan to pick them up. No-ops without a signed-in
    // user (rescan returns early), and concurrent calls are de-duped.
    void this.rescan();
  }

  setIdentity(email: string | null | undefined): void {
    const nextEmail = normalizeEmail(email);
    if (nextEmail === this.currentEmail) return;
    this.currentEmail = nextEmail;

    if (!this.currentEmail) {
      this.stopWatcher();
      this.emit('updated', []);
      return;
    }

    this.restartWatcher();
    void this.rescan();
  }

  list(): TaggedDoc[] {
    if (!this.db || !this.currentEmail) return [];
    const rows = this.db
      .prepare(`
        SELECT ulid, path, title, tagged_by, tagged_at, frontmatter_updated_at, file_hash, read_at, last_read_hash
        FROM tagged_docs
        ORDER BY unread_sort DESC, frontmatter_updated_at DESC, title COLLATE NOCASE ASC
      `)
      .all() as TaggedDocRow[];
    return rows.map(rowToTaggedDoc);
  }

  async rescan(): Promise<TaggedDoc[]> {
    // Never run overlapping passes. If one is already running (started against a
    // possibly-stale roots snapshot), wait for it, then run exactly one fresh pass
    // so this caller's result reflects state at-or-after their call.
    if (this.rescanInProgress) {
      return this.rescanInProgress.then(() => this.rescan());
    }

    this.rescanInProgress = this.performRescan()
      .finally(() => {
        this.rescanInProgress = null;
      });
    return this.rescanInProgress;
  }

  markRead(ulid: string): TaggedDoc | null {
    if (!this.db || !ULID_PATTERN.test(ulid)) return null;
    const row = this.db
      .prepare('SELECT file_hash FROM tagged_docs WHERE ulid = ?')
      .get(ulid) as { file_hash: string } | undefined;
    if (!row) return null;

    this.db
      .prepare('UPDATE tagged_docs SET read_at = ?, last_read_hash = ?, unread_sort = 0 WHERE ulid = ?')
      .run(Date.now(), row.file_hash, ulid);
    const updated = this.getByUlid(ulid);
    this.emitUpdated();
    return updated;
  }

  markAllRead(): TaggedDoc[] {
    if (!this.db) return [];
    this.db
      .prepare('UPDATE tagged_docs SET read_at = ?, last_read_hash = file_hash, unread_sort = 0')
      .run(Date.now());
    const docs = this.list();
    this.emit('updated', docs);
    return docs;
  }

  onUserLoggedOut(): void {
    this.currentEmail = null;
    this.stopWatcher();
    this.emit('updated', []);
  }

  destroy(): void {
    this.stopWatcher();
    this.worker?.kill();
    this.worker = null;
    this.db?.close();
    this.db = null;
    this.removeAllListeners();
  }

  // Watcher path (add/change): read one file and reconcile its row immediately.
  async processMarkdownFile(filePath: string, options: ProcessFileOptions = {}): Promise<TaggedDoc | null> {
    if (!this.db || !this.currentEmail || !isMarkdownPath(filePath)) return null;

    let content: string;
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) return null;
      content = await fs.promises.readFile(filePath, 'utf-8');
    } catch (err) {
      log.warn('Failed to read tagged doc candidate:', filePath, err);
      return null;
    }

    // Keep the freshness ledger current so the next reconcile skips this file.
    this.recordScannedFile(filePath, Math.floor(stat.mtimeMs), stat.size);

    const parsed = parseTaggedDocFields(filePath, content, Math.floor(stat.mtimeMs), this.currentEmail);
    if (!parsed || !parsed.taggedForCurrentEmail) {
      if (options.removeWhenUntagged ?? true) {
        this.removePath(filePath, options.emitUpdated);
      }
      return null;
    }

    this.applyParsedDoc(filePath, parsed);
    const result = this.getByUlid(parsed.ulid);
    if (options.emitUpdated) this.emitUpdated();
    return result;
  }

  // Insert/update the tagged_docs row for a parsed, tagged-for-current-user doc.
  // Synchronous (no FS, no emit) so it is safe to batch inside a db.transaction().
  private applyParsedDoc(filePath: string, parsed: ParsedTaggedDoc): void {
    if (!this.db) return;
    const existing = this.getRowByUlid(parsed.ulid);
    if (!existing) {
      this.db.prepare('DELETE FROM tagged_docs WHERE path = ?').run(filePath);
      this.db
        .prepare(`
          INSERT INTO tagged_docs (
            ulid, path, title, tagged_by, tagged_at, frontmatter_updated_at, file_hash, read_at, last_read_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)
        `)
        .run(
          parsed.ulid,
          filePath,
          parsed.title,
          parsed.taggedBy,
          parsed.taggedAt,
          parsed.frontmatterUpdatedAt,
          parsed.fileHash,
        );
      return;
    }

    const samePath = existing.path === filePath;
    const isNewer = parsed.frontmatterUpdatedAt > existing.frontmatter_updated_at;
    const sameTimestampPreferredPath = parsed.frontmatterUpdatedAt === existing.frontmatter_updated_at &&
      filePath.localeCompare(existing.path) < 0;

    if (samePath || isNewer || sameTimestampPreferredPath) {
      this.db
        .prepare(`
          UPDATE tagged_docs
          SET path = ?,
              title = ?,
              tagged_by = ?,
              tagged_at = ?,
              frontmatter_updated_at = ?,
              file_hash = ?,
              unread_sort = CASE WHEN read_at IS NULL OR last_read_hash != ? THEN 1 ELSE 0 END
          WHERE ulid = ?
        `)
        .run(
          filePath,
          parsed.title,
          parsed.taggedBy,
          parsed.taggedAt,
          parsed.frontmatterUpdatedAt,
          parsed.fileHash,
          parsed.fileHash,
          parsed.ulid,
        );
    }
  }

  private recordScannedFile(filePath: string, mtimeMs: number, size: number): void {
    this.db
      ?.prepare(`
        INSERT INTO scanned_files (path, mtime_ms, size) VALUES (?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET mtime_ms = excluded.mtime_ms, size = excluded.size
      `)
      .run(filePath, mtimeMs, size);
  }

  removePath(filePath: string, emitUpdated = true): void {
    if (!this.db) return;
    const result = this.db.prepare('DELETE FROM tagged_docs WHERE path = ?').run(filePath);
    if (result.changes > 0 && emitUpdated) {
      this.emitUpdated();
    }
  }

  private initDatabase(): void {
    if (!this.db) return;
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tagged_docs (
        ulid TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        title TEXT NOT NULL,
        tagged_by TEXT,
        tagged_at INTEGER,
        frontmatter_updated_at INTEGER NOT NULL,
        file_hash TEXT NOT NULL,
        read_at INTEGER,
        last_read_hash TEXT,
        unread_sort INTEGER NOT NULL DEFAULT 1
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_tagged_docs_path ON tagged_docs(path);
      CREATE INDEX IF NOT EXISTS idx_tagged_docs_unread_sort ON tagged_docs(unread_sort, frontmatter_updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tagged_docs_frontmatter_updated_at ON tagged_docs(frontmatter_updated_at DESC);

      -- Freshness ledger: every markdown file we've stat'd, tagged or not. Lets a
      -- rescan skip files whose mtime+size are unchanged (stat-gate) so we never
      -- re-read+parse the whole tree on startup. Keyed by path (the only lookup).
      CREATE TABLE IF NOT EXISTS scanned_files (
        path TEXT PRIMARY KEY,
        mtime_ms INTEGER NOT NULL,
        size INTEGER NOT NULL
      );
    `);
  }

  private normalizeRoots(roots: string[]): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const root of roots) {
      try {
        const resolved = path.resolve(root);
        if (seen.has(resolved)) continue;
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) continue;
        normalized.push(resolved);
        seen.add(resolved);
      } catch {
        // Skip inaccessible roots.
      }
    }
    return normalized;
  }

  // Incremental reconcile. Two phases so we never block on a giant tree and never
  // re-read unchanged files:
  //   Phase A (async, no DB writes): walk + stat each file, skip anything whose
  //     mtime+size matches the scanned_files ledger (zero reads), and only read +
  //     parse changed/new files (skipping dataless cloud placeholders + oversized).
  //   Phase B (one sync transaction): apply all tagged_docs + ledger writes and
  //     remove vanished files. Keeps list() from ever seeing a half-written scan.
  private async performRescan(): Promise<TaggedDoc[]> {
    if (!this.db || !this.currentEmail) return [];
    const db = this.db;
    const roots = this.roots; // snapshot; roots changing mid-scan triggers a follow-up pass via rescan()
    const email = this.currentEmail;

    let scanned = 0;
    let read = 0;
    let matched = 0;
    this.emitScanProgress({ phase: 'scanning', scanned, matched, roots });

    try {
      // Everything we currently know about, to detect files that vanished while closed.
      const knownPaths = new Set<string>();
      const ledger = new Map<string, ScanLedgerEntry>();
      for (const r of db.prepare('SELECT path, mtime_ms, size FROM scanned_files').all() as Array<{ path: string; mtime_ms: number; size: number }>) {
        knownPaths.add(r.path);
        ledger.set(r.path, { mtimeMs: r.mtime_ms, size: r.size });
      }
      for (const r of db.prepare('SELECT path FROM tagged_docs').all() as Array<{ path: string }>) {
        knownPaths.add(r.path);
      }

      // Phase A: the file crawl (stat + read + parse). Off the main thread when a
      // worker is available; in-process otherwise (tests, or worker unavailable).
      const out = await this.runScan({ roots, email, ledger });
      scanned = out.scanned;
      read = out.read;
      matched = out.matched;
      const seen = new Set(out.seenPaths);
      const vanished = [...knownPaths].filter((p) => !seen.has(p));

      // Phase B: apply every write in one synchronous transaction.
      const applyBatch = db.transaction(() => {
        for (const p of out.results) {
          this.recordScannedFile(p.path, p.mtimeMs, p.size);
          if (p.ledgerOnly) continue;
          if (p.parsed) this.applyParsedDoc(p.path, p.parsed);
          else db.prepare('DELETE FROM tagged_docs WHERE path = ?').run(p.path);
        }
        for (const p of vanished) {
          db.prepare('DELETE FROM tagged_docs WHERE path = ?').run(p);
          db.prepare('DELETE FROM scanned_files WHERE path = ?').run(p);
        }
      });
      applyBatch();

      const docs = this.list();
      this.emitScanProgress({ phase: 'done', scanned, matched, roots });
      this.emit('updated', docs);
      if (read > 0 || vanished.length > 0) {
        log.info(`Tagged docs reconcile: ${scanned} scanned, ${read} read, ${matched} tagged, ${vanished.length} removed`);
      }
      return docs;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emitScanProgress({ phase: 'error', scanned, matched, roots, error: message });
      log.error('Tagged docs rescan failed:', err);
      return this.list();
    }
  }

  // Run Phase A on the worker if one can be forked; otherwise in-process. Any
  // worker failure (fork error, crash, bad message) transparently falls back.
  private async runScan(opts: { roots: string[]; email: string; ledger: Map<string, ScanLedgerEntry> }): Promise<ScanOutput> {
    const worker = this.ensureWorker();
    if (!worker) return scanRoots(opts);
    return new Promise<ScanOutput>((resolve) => {
      const jobId = ++this.scanJobId;
      let done = false;
      const finish = (value: ScanOutput) => {
        if (done) return;
        done = true;
        worker.removeListener('message', onMessage);
        worker.removeListener('exit', onExit);
        resolve(value);
      };
      const onMessage = (msg: { type?: string; jobId?: number; out?: ScanOutput; message?: string }) => {
        if (!msg || msg.jobId !== jobId) return;
        if (msg.type === 'result' && msg.out) {
          finish(msg.out);
        } else {
          log.warn('Tagged docs worker reported an error; scanning in-process:', msg.message);
          void scanRoots(opts).then(finish);
        }
      };
      const onExit = () => {
        this.worker = null;
        log.warn('Tagged docs worker exited mid-scan; scanning in-process');
        void scanRoots(opts).then(finish);
      };
      worker.on('message', onMessage);
      worker.once('exit', onExit);
      worker.postMessage({ type: 'reconcile', jobId, roots: opts.roots, email: opts.email, ledger: opts.ledger, maxReadBytes: SCAN_MAX_READ_BYTES });
    });
  }

  // Lazily fork the scan worker. Returns null when utilityProcess is unavailable
  // (unit tests / non-Electron) or the compiled worker is missing — caller scans
  // in-process. The worker entry resolves next to this file in electron-dist.
  private ensureWorker(): import('electron').UtilityProcess | null {
    if (this.worker) return this.worker;
    try {
      const electron = require('electron') as typeof import('electron');
      if (!electron.utilityProcess?.fork) return null;
      const workerPath = path.join(__dirname, 'taggedDocsWorker.js');
      if (!fs.existsSync(workerPath)) return null;
      this.worker = electron.utilityProcess.fork(workerPath, [], { serviceName: 'tagged-docs-scan' });
      this.worker.once('exit', () => { this.worker = null; });
      return this.worker;
    } catch (err) {
      log.warn('Tagged docs scan worker unavailable; scanning in-process:', err);
      return null;
    }
  }

  private restartWatcher(): void {
    this.stopWatcher();
    if (!this.watchEnabled || !this.currentEmail || this.roots.length === 0) return;

    this.watcher = chokidar.watch(this.roots, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      ignorePermissionErrors: true,
      ignored: (candidatePath: string) => {
        return candidatePath.split(path.sep).some(isCommonIgnoredDir);
      },
    });

    this.watcher.on('add', (filePath) => {
      if (isMarkdownPath(filePath)) {
        void this.processMarkdownFile(filePath, { emitUpdated: true, removeWhenUntagged: true });
      }
    });
    this.watcher.on('change', (filePath) => {
      if (isMarkdownPath(filePath)) {
        void this.processMarkdownFile(filePath, { emitUpdated: true, removeWhenUntagged: true });
      }
    });
    this.watcher.on('unlink', (filePath) => {
      if (isMarkdownPath(filePath)) {
        this.removePath(filePath);
        this.db?.prepare('DELETE FROM scanned_files WHERE path = ?').run(filePath);
      }
    });
    this.watcher.on('error', (err) => log.error('Tagged docs watcher error:', err));
  }

  private stopWatcher(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  private getRowByUlid(ulid: string): TaggedDocRow | null {
    if (!this.db) return null;
    return (this.db
      .prepare(`
        SELECT ulid, path, title, tagged_by, tagged_at, frontmatter_updated_at, file_hash, read_at, last_read_hash
        FROM tagged_docs
        WHERE ulid = ?
      `)
      .get(ulid.toUpperCase()) as TaggedDocRow | undefined) ?? null;
  }

  private getByUlid(ulid: string): TaggedDoc | null {
    const row = this.getRowByUlid(ulid);
    return row ? rowToTaggedDoc(row) : null;
  }

  private emitUpdated(): void {
    this.emit('updated', this.list());
  }

  private emitScanProgress(progress: TaggedDocsScanProgress): void {
    this.emit('scanProgress', progress);
  }
}
