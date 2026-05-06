import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { createLogger } from './logger';
import type { DocumentVersion } from './documentSaveGuard';

const log = createLogger('MaxwellRunManager');

export type MaxwellRunStatus =
  | 'pending'
  | 'generated'
  | 'success'
  | 'generation_error'
  | 'selection_error'
  | 'save_conflict'
  | 'save_error'
  | 'cancelled'
  | 'reverted';

export type MaxwellRunMode = 'document' | 'selection';
export type MaxwellTargetType = 'wiki' | 'reading';

export interface MaxwellProgressEvent {
  kind?: string;
  message: string;
  detail?: string;
  phase?: string;
  createdAt?: number;
}

export interface MaxwellRunCreateInput {
  commandName: string;
  commandPath?: string | null;
  commandContent?: string | null;
  targetPath: string;
  targetRelPath?: string | null;
  targetType: MaxwellTargetType;
  mode: MaxwellRunMode;
  preContent: string;
  preVersion: DocumentVersion;
  model?: string | null;
  harness?: string | null;
  memorySnapshot?: string | null;
}

export interface MaxwellRunRecord {
  runId: string;
  createdAt: number;
  updatedAt: number;
  status: MaxwellRunStatus;
  commandName: string;
  commandPath: string | null;
  commandHash: string | null;
  commandContent: string | null;
  targetPath: string;
  targetRelPath: string | null;
  targetType: MaxwellTargetType;
  mode: MaxwellRunMode;
  preVersion: DocumentVersion;
  preContent: string;
  generatedContent: string | null;
  postVersion: DocumentVersion | null;
  postContent: string | null;
  revertVersion: DocumentVersion | null;
  model: string | null;
  harness: string | null;
  memorySnapshot: string | null;
  progressEvents: MaxwellProgressEvent[];
  summary: string | null;
  errorMessage: string | null;
  timings: Record<string, number>;
}

export type MaxwellUndoPrepareResult =
  | {
      ok: true;
      run: MaxwellRunRecord;
      targetPath: string;
      targetRelPath: string | null;
      targetType: MaxwellTargetType;
      preContent: string;
      expectedVersion: DocumentVersion;
    }
  | {
      ok: false;
      reason: 'not-found' | 'not-applied' | 'conflict';
      run?: MaxwellRunRecord;
      currentVersion?: DocumentVersion;
      expectedVersion?: DocumentVersion;
      currentContent?: string;
      preContent?: string;
      postContent?: string;
    };

interface MaxwellRunRow {
  run_id: string;
  created_at: number;
  updated_at: number;
  status: MaxwellRunStatus;
  command_name: string;
  command_path: string | null;
  command_hash: string | null;
  command_content: string | null;
  target_path: string;
  target_rel_path: string | null;
  target_type: MaxwellTargetType;
  mode: MaxwellRunMode;
  pre_version_json: string;
  pre_content: string;
  generated_content: string | null;
  post_version_json: string | null;
  post_content: string | null;
  revert_version_json: string | null;
  model: string | null;
  harness: string | null;
  memory_snapshot: string | null;
  progress_events_json: string;
  summary: string | null;
  error_message: string | null;
  timings_json: string;
}

export function hashMaxwellContent(content: string | null | undefined): string | null {
  if (typeof content !== 'string') return null;
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

export class MaxwellRunManager {
  private db: Database.Database | null = null;
  private dbPath: string | null = null;

  constructor(dbPath?: string) {
    if (dbPath) this.setDatabasePath(dbPath);
  }

  setDatabasePath(dbPath: string): void {
    const resolved = path.resolve(dbPath);
    if (this.dbPath === resolved && this.db) return;

    this.close();
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    this.db = new Database(resolved);
    this.dbPath = resolved;
    this.initDatabase();
  }

  close(): void {
    try {
      this.db?.close();
    } catch (error) {
      log.warn('Failed to close Maxwell database', error);
    }
    this.db = null;
  }

  createPendingRun(input: MaxwellRunCreateInput): MaxwellRunRecord {
    const db = this.requireDb();
    const now = Date.now();
    const runId = this.generateRunId();
    const commandHash = hashMaxwellContent(input.commandContent);

    db.prepare(`
      INSERT INTO maxwell_runs (
        run_id, created_at, updated_at, status,
        command_name, command_path, command_hash, command_content,
        target_path, target_rel_path, target_type, mode,
        pre_version_json, pre_content,
        generated_content, post_version_json, post_content, revert_version_json,
        model, harness, memory_snapshot,
        progress_events_json, summary, error_message, timings_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, NULL, NULL, ?)
    `).run(
      runId,
      now,
      now,
      'pending',
      input.commandName,
      input.commandPath ?? null,
      commandHash,
      input.commandContent ?? null,
      input.targetPath,
      input.targetRelPath ?? null,
      input.targetType,
      input.mode,
      JSON.stringify(input.preVersion),
      input.preContent,
      input.model ?? null,
      input.harness ?? null,
      input.memorySnapshot ?? null,
      JSON.stringify([]),
      JSON.stringify({}),
    );

    return this.getRunOrThrow(runId);
  }

  appendProgressEvent(runId: string, event: MaxwellProgressEvent): MaxwellRunRecord | null {
    const run = this.getRun(runId);
    if (!run) return null;
    const nextEvents = [
      ...run.progressEvents,
      { ...event, createdAt: event.createdAt ?? Date.now() },
    ];
    this.requireDb().prepare(`
      UPDATE maxwell_runs
      SET progress_events_json = ?, updated_at = ?
      WHERE run_id = ?
    `).run(JSON.stringify(nextEvents), Date.now(), runId);
    return this.getRun(runId);
  }

  markGenerated(runId: string, generatedContent: string, timings: Record<string, number> = {}): MaxwellRunRecord | null {
    const existing = this.getRun(runId);
    const nextTimings = { ...(existing?.timings ?? {}), ...timings };
    this.requireDb().prepare(`
      UPDATE maxwell_runs
      SET status = 'generated', generated_content = ?, timings_json = ?, updated_at = ?
      WHERE run_id = ?
    `).run(generatedContent, JSON.stringify(nextTimings), Date.now(), runId);
    return this.getRun(runId);
  }

  markSuccess(runId: string, input: {
    generatedContent?: string;
    postContent: string;
    postVersion: DocumentVersion;
    summary?: string | null;
    timings?: Record<string, number>;
  }): MaxwellRunRecord | null {
    const existing = this.getRun(runId);
    const nextTimings = { ...(existing?.timings ?? {}), ...(input.timings ?? {}) };
    this.requireDb().prepare(`
      UPDATE maxwell_runs
      SET status = 'success',
          generated_content = COALESCE(?, generated_content),
          post_content = ?,
          post_version_json = ?,
          summary = ?,
          timings_json = ?,
          error_message = NULL,
          updated_at = ?
      WHERE run_id = ?
    `).run(
      input.generatedContent ?? null,
      input.postContent,
      JSON.stringify(input.postVersion),
      input.summary ?? null,
      JSON.stringify(nextTimings),
      Date.now(),
      runId,
    );
    return this.getRun(runId);
  }

  markError(runId: string, status: Extract<MaxwellRunStatus, 'generation_error' | 'selection_error' | 'save_error' | 'cancelled'>, errorMessage: string): MaxwellRunRecord | null {
    this.requireDb().prepare(`
      UPDATE maxwell_runs
      SET status = ?, error_message = ?, updated_at = ?
      WHERE run_id = ?
    `).run(status, errorMessage, Date.now(), runId);
    return this.getRun(runId);
  }

  markSaveConflict(runId: string, input: {
    generatedContent: string;
    errorMessage: string;
  }): MaxwellRunRecord | null {
    this.requireDb().prepare(`
      UPDATE maxwell_runs
      SET status = 'save_conflict',
          generated_content = ?,
          error_message = ?,
          updated_at = ?
      WHERE run_id = ?
    `).run(input.generatedContent, input.errorMessage, Date.now(), runId);
    return this.getRun(runId);
  }

  markReverted(runId: string, revertVersion: DocumentVersion): MaxwellRunRecord | null {
    this.requireDb().prepare(`
      UPDATE maxwell_runs
      SET status = 'reverted',
          revert_version_json = ?,
          updated_at = ?
      WHERE run_id = ?
    `).run(JSON.stringify(revertVersion), Date.now(), runId);
    return this.getRun(runId);
  }

  getRun(runId: string): MaxwellRunRecord | null {
    const row = this.requireDb()
      .prepare('SELECT * FROM maxwell_runs WHERE run_id = ?')
      .get(runId) as MaxwellRunRow | undefined;
    return row ? rowToRun(row) : null;
  }

  listRuns(limit = 50): MaxwellRunRecord[] {
    const rows = this.requireDb()
      .prepare('SELECT * FROM maxwell_runs ORDER BY created_at DESC LIMIT ?')
      .all(Math.max(1, Math.min(500, Math.floor(limit)))) as MaxwellRunRow[];
    return rows.map(rowToRun);
  }

  prepareUndo(runId: string, currentVersion: DocumentVersion, currentContent?: string): MaxwellUndoPrepareResult {
    const run = this.getRun(runId);
    if (!run) return { ok: false, reason: 'not-found' };
    if (run.status !== 'success' || !run.postVersion || !run.postContent) {
      return {
        ok: false,
        reason: 'not-applied',
        run,
        preContent: run.preContent,
        postContent: run.postContent ?? undefined,
      };
    }
    if (!documentVersionsMatch(currentVersion, run.postVersion)) {
      return {
        ok: false,
        reason: 'conflict',
        run,
        currentVersion,
        expectedVersion: run.postVersion,
        currentContent,
        preContent: run.preContent,
        postContent: run.postContent,
      };
    }
    return {
      ok: true,
      run,
      targetPath: run.targetPath,
      targetRelPath: run.targetRelPath,
      targetType: run.targetType,
      preContent: run.preContent,
      expectedVersion: run.postVersion,
    };
  }

  private initDatabase(): void {
    if (!this.db) return;
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS maxwell_runs (
        run_id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        status TEXT NOT NULL,
        command_name TEXT NOT NULL,
        command_path TEXT,
        command_hash TEXT,
        command_content TEXT,
        target_path TEXT NOT NULL,
        target_rel_path TEXT,
        target_type TEXT NOT NULL,
        mode TEXT NOT NULL,
        pre_version_json TEXT NOT NULL,
        pre_content TEXT NOT NULL,
        generated_content TEXT,
        post_version_json TEXT,
        post_content TEXT,
        revert_version_json TEXT,
        model TEXT,
        harness TEXT,
        memory_snapshot TEXT,
        progress_events_json TEXT NOT NULL DEFAULT '[]',
        summary TEXT,
        error_message TEXT,
        timings_json TEXT NOT NULL DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_maxwell_runs_created_at ON maxwell_runs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_maxwell_runs_target_path ON maxwell_runs(target_path);
      CREATE INDEX IF NOT EXISTS idx_maxwell_runs_status ON maxwell_runs(status);
    `);
  }

  private requireDb(): Database.Database {
    if (!this.db) throw new Error('MaxwellRunManager database path has not been set');
    return this.db;
  }

  private getRunOrThrow(runId: string): MaxwellRunRecord {
    const run = this.getRun(runId);
    if (!run) throw new Error(`Maxwell run was not created: ${runId}`);
    return run;
  }

  private generateRunId(): string {
    return `maxwell-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  }
}

function documentVersionsMatch(left: DocumentVersion, right: DocumentVersion): boolean {
  return left.size === right.size && left.sha256 === right.sha256;
}

function rowToRun(row: MaxwellRunRow): MaxwellRunRecord {
  return {
    runId: row.run_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    commandName: row.command_name,
    commandPath: row.command_path,
    commandHash: row.command_hash,
    commandContent: row.command_content,
    targetPath: row.target_path,
    targetRelPath: row.target_rel_path,
    targetType: row.target_type,
    mode: row.mode,
    preVersion: parseJson<DocumentVersion>(row.pre_version_json),
    preContent: row.pre_content,
    generatedContent: row.generated_content,
    postVersion: parseJsonOrNull<DocumentVersion>(row.post_version_json),
    postContent: row.post_content,
    revertVersion: parseJsonOrNull<DocumentVersion>(row.revert_version_json),
    model: row.model,
    harness: row.harness,
    memorySnapshot: row.memory_snapshot,
    progressEvents: parseJson<MaxwellProgressEvent[]>(row.progress_events_json),
    summary: row.summary,
    errorMessage: row.error_message,
    timings: parseJson<Record<string, number>>(row.timings_json),
  };
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}

function parseJsonOrNull<T>(value: string | null): T | null {
  return value ? parseJson<T>(value) : null;
}
