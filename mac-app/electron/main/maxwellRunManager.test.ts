import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentVersion } from './documentSaveGuard';

type Row = Record<string, unknown> & { run_id: string; created_at: number };

vi.mock('better-sqlite3', () => {
  class Statement {
    constructor(private db: FakeDatabase, private sql: string) {}

    get(runId: string): Row | undefined {
      return this.db.rows.get(runId);
    }

    all(limit: number): Row[] {
      return Array.from(this.db.rows.values())
        .sort((a, b) => b.created_at - a.created_at)
        .slice(0, limit);
    }

    run(...args: unknown[]): { changes: number } {
      if (/INSERT INTO maxwell_runs/.test(this.sql)) {
        const [
          runId,
          createdAt,
          updatedAt,
          status,
          commandName,
          commandPath,
          commandHash,
          commandContent,
          targetPath,
          targetRelPath,
          targetType,
          mode,
          preVersionJson,
          preContent,
          model,
          harness,
          memorySnapshot,
          progressEventsJson,
          timingsJson,
        ] = args;
        this.db.rows.set(String(runId), {
          run_id: String(runId),
          created_at: Number(createdAt),
          updated_at: Number(updatedAt),
          status,
          command_name: commandName,
          command_path: commandPath,
          command_hash: commandHash,
          command_content: commandContent,
          target_path: targetPath,
          target_rel_path: targetRelPath,
          target_type: targetType,
          mode,
          pre_version_json: preVersionJson,
          pre_content: preContent,
          generated_content: null,
          post_version_json: null,
          post_content: null,
          revert_version_json: null,
          model,
          harness,
          memory_snapshot: memorySnapshot,
          progress_events_json: progressEventsJson,
          summary: null,
          error_message: null,
          timings_json: timingsJson,
        } as Row);
        return { changes: 1 };
      }

      if (/SET progress_events_json = \?/.test(this.sql)) {
        const [progressEventsJson, updatedAt, runId] = args;
        return this.update(String(runId), { progress_events_json: progressEventsJson, updated_at: updatedAt });
      }

      if (/SET status = 'generated'/.test(this.sql)) {
        const [generatedContent, timingsJson, updatedAt, runId] = args;
        return this.update(String(runId), {
          status: 'generated',
          generated_content: generatedContent,
          timings_json: timingsJson,
          updated_at: updatedAt,
        });
      }

      if (/SET status = 'success'/.test(this.sql)) {
        const [generatedContent, postContent, postVersionJson, summary, timingsJson, updatedAt, runId] = args;
        const row = this.db.rows.get(String(runId));
        if (!row) return { changes: 0 };
        row.status = 'success';
        if (generatedContent !== null) row.generated_content = generatedContent;
        row.post_content = postContent;
        row.post_version_json = postVersionJson;
        row.summary = summary;
        row.timings_json = timingsJson;
        row.error_message = null;
        row.updated_at = updatedAt;
        return { changes: 1 };
      }

      if (/SET status = \?, error_message = \?/.test(this.sql)) {
        const [status, errorMessage, updatedAt, runId] = args;
        return this.update(String(runId), { status, error_message: errorMessage, updated_at: updatedAt });
      }

      if (/SET status = 'save_conflict'/.test(this.sql)) {
        const [generatedContent, errorMessage, updatedAt, runId] = args;
        return this.update(String(runId), {
          status: 'save_conflict',
          generated_content: generatedContent,
          error_message: errorMessage,
          updated_at: updatedAt,
        });
      }

      if (/SET status = 'reverted'/.test(this.sql)) {
        const [revertVersionJson, updatedAt, runId] = args;
        return this.update(String(runId), {
          status: 'reverted',
          revert_version_json: revertVersionJson,
          updated_at: updatedAt,
        });
      }

      return { changes: 0 };
    }

    private update(runId: string, values: Record<string, unknown>): { changes: number } {
      const row = this.db.rows.get(runId);
      if (!row) return { changes: 0 };
      Object.assign(row, values);
      return { changes: 1 };
    }
  }

  class FakeDatabase {
    rows = new Map<string, Row>();
    constructor(_path: string) {}
    pragma(): void {}
    exec(): void {}
    prepare(sql: string): Statement {
      return new Statement(this, sql);
    }
    close(): void {}
  }

  return { default: FakeDatabase };
});

import { MaxwellRunManager, hashMaxwellContent } from './maxwellRunManager';

vi.mock('./logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function version(sha256: string, size = 10): DocumentVersion {
  return { mtimeMs: 1, size, sha256 };
}

describe('MaxwellRunManager', () => {
  let tempDir: string;
  let manager: MaxwellRunManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldtheory-maxwell-runs-'));
    manager = new MaxwellRunManager(path.join(tempDir, 'maxwell.db'));
  });

  afterEach(() => {
    manager.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates a pending run with command and document provenance', () => {
    const run = manager.createPendingRun({
      commandName: 'tidy',
      commandPath: '/Users/a/.fieldtheory/library/Commands/tidy.md',
      commandContent: '# tidy\nClean notes.',
      targetPath: '/Users/a/.fieldtheory/library/scratchpad/today.md',
      targetRelPath: 'scratchpad/today',
      targetType: 'wiki',
      mode: 'document',
      preContent: '# Messy\n',
      preVersion: version('pre'),
      model: 'gemma',
      harness: 'direct',
      memorySnapshot: 'Keep task intent.',
    });

    expect(run.status).toBe('pending');
    expect(run.commandHash).toBe(hashMaxwellContent('# tidy\nClean notes.'));
    expect(run.preContent).toBe('# Messy\n');
    expect(run.progressEvents).toEqual([]);
    expect(run.model).toBe('gemma');
    expect(manager.getRun(run.runId)?.targetRelPath).toBe('scratchpad/today');
  });

  it('records progress, generated content, and successful applied content separately', () => {
    const run = manager.createPendingRun({
      commandName: 'tidy',
      targetPath: '/tmp/today.md',
      targetType: 'reading',
      mode: 'document',
      preContent: 'before',
      preVersion: version('pre', 6),
    });

    manager.appendProgressEvent(run.runId, {
      kind: 'model_output',
      message: 'Gemma is generating locally',
      phase: 'model',
    });
    manager.markGenerated(run.runId, 'candidate', { generationMs: 42 });
    const applied = manager.markSuccess(run.runId, {
      postContent: 'applied',
      postVersion: version('post', 7),
      summary: 'Tidied notes.',
      timings: { totalMs: 50 },
    });

    expect(applied?.status).toBe('success');
    expect(applied?.generatedContent).toBe('candidate');
    expect(applied?.postContent).toBe('applied');
    expect(applied?.postVersion).toEqual(version('post', 7));
    expect(applied?.progressEvents).toEqual([
      expect.objectContaining({ message: 'Gemma is generating locally', phase: 'model' }),
    ]);
    expect(applied?.timings).toEqual({ generationMs: 42, totalMs: 50 });
  });

  it('stores save conflicts without pretending an applied result exists', () => {
    const run = manager.createPendingRun({
      commandName: 'tidy',
      targetPath: '/tmp/today.md',
      targetType: 'reading',
      mode: 'document',
      preContent: 'before',
      preVersion: version('pre', 6),
    });

    const conflict = manager.markSaveConflict(run.runId, {
      generatedContent: 'candidate',
      errorMessage: 'Current document changed while the local command was running',
    });

    expect(conflict?.status).toBe('save_conflict');
    expect(conflict?.generatedContent).toBe('candidate');
    expect(conflict?.postVersion).toBeNull();
    expect(conflict?.postContent).toBeNull();
  });

  it('prepares guarded undo only when the current document still matches the applied version', () => {
    const run = manager.createPendingRun({
      commandName: 'tidy',
      targetPath: '/tmp/today.md',
      targetType: 'reading',
      mode: 'document',
      preContent: 'before',
      preVersion: version('pre', 6),
    });
    manager.markSuccess(run.runId, {
      postContent: 'after',
      postVersion: version('post', 5),
    });

    expect(manager.prepareUndo(run.runId, version('other', 5), 'changed')).toEqual(expect.objectContaining({
      ok: false,
      reason: 'conflict',
      currentContent: 'changed',
      preContent: 'before',
      postContent: 'after',
    }));

    expect(manager.prepareUndo(run.runId, version('post', 5))).toEqual(expect.objectContaining({
      ok: true,
      preContent: 'before',
      expectedVersion: version('post', 5),
      targetPath: '/tmp/today.md',
    }));
  });
});
