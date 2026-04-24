import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildLibraryMigrationPlan, executeLibraryMigration } from './libraryMigration';

describe('library migration planner', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-library-migration-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function oldDir(): string {
    return path.join(tempDir, '.ft-bookmarks', 'md');
  }

  function newDir(): string {
    return path.join(tempDir, '.fieldtheory', 'library');
  }

  function write(root: string, relPath: string, content: string): void {
    const absPath = path.join(root, ...relPath.split('/'));
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content);
  }

  it('reports old-only files as copy work and plans a legacy symlink', () => {
    write(oldDir(), 'entries/a.md', '# A\n');
    write(oldDir(), 'scratchpad/b.md', '# B\n');

    const plan = buildLibraryMigrationPlan({
      sourceDir: oldDir(),
      targetDir: newDir(),
      timestamp: '20260424T010203Z',
    });

    expect(plan.canExecute).toBe(true);
    expect(plan.filesToCopy.map((file) => file.relPath)).toEqual(['entries/a.md', 'scratchpad/b.md']);
    expect(plan.identicalFiles).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.missingFolders).toContain(newDir());
    expect(plan.symlinksToCreate).toEqual([{ linkPath: oldDir(), targetPath: newDir() }]);
    expect(plan.backupDir).toBe(path.join(tempDir, '.ft-bookmarks', 'md.backup-20260424T010203Z'));
  });

  it('reports new-only files without copy work', () => {
    write(newDir(), 'entries/new.md', '# New\n');

    const plan = buildLibraryMigrationPlan({
      sourceDir: oldDir(),
      targetDir: newDir(),
      timestamp: '20260424T010203Z',
    });

    expect(plan.canExecute).toBe(true);
    expect(plan.filesToCopy).toEqual([]);
    expect(plan.targetOnlyFiles).toEqual(['entries/new.md']);
    expect(plan.missingFolders).toContain(oldDir());
    expect(plan.symlinksToCreate).toEqual([{ linkPath: oldDir(), targetPath: newDir() }]);
  });

  it('reports identical files separately from conflicts', () => {
    write(oldDir(), 'entries/same.md', '# Same\n');
    write(newDir(), 'entries/same.md', '# Same\n');

    const plan = buildLibraryMigrationPlan({
      sourceDir: oldDir(),
      targetDir: newDir(),
      timestamp: '20260424T010203Z',
    });

    expect(plan.filesToCopy).toEqual([]);
    expect(plan.identicalFiles.map((file) => file.relPath)).toEqual(['entries/same.md']);
    expect(plan.conflicts).toEqual([]);
  });

  it('reports conflicting files with a no-overwrite conflict copy path', () => {
    write(oldDir(), 'entries/topic.md', '# Old\n');
    write(newDir(), 'entries/topic.md', '# New\n');

    const plan = buildLibraryMigrationPlan({
      sourceDir: oldDir(),
      targetDir: newDir(),
      timestamp: '20260424T010203Z',
    });

    expect(plan.filesToCopy).toEqual([]);
    expect(plan.identicalFiles).toEqual([]);
    expect(plan.conflicts.map((file) => ({
      relPath: file.relPath,
      conflictCopyPath: path.relative(newDir(), file.conflictCopyPath),
    }))).toEqual([
      {
        relPath: 'entries/topic.md',
        conflictCopyPath: path.join('entries', 'topic.conflict-20260424T010203Z.md'),
      },
    ]);
  });

  it('treats an existing legacy symlink to canonical library as complete', () => {
    fs.mkdirSync(path.dirname(oldDir()), { recursive: true });
    fs.mkdirSync(newDir(), { recursive: true });
    fs.symlinkSync(newDir(), oldDir(), 'dir');

    const plan = buildLibraryMigrationPlan({
      sourceDir: oldDir(),
      targetDir: newDir(),
      timestamp: '20260424T010203Z',
    });

    expect(plan.canExecute).toBe(true);
    expect(plan.sourceState).toBe('symlink-to-target');
    expect(plan.filesToCopy).toEqual([]);
    expect(plan.symlinksToCreate).toEqual([]);
  });

  it('handles interrupted partial state', () => {
    write(oldDir(), 'entries/same.md', '# Same\n');
    write(oldDir(), 'entries/different.md', '# Old\n');
    write(oldDir(), 'entries/missing.md', '# Missing\n');
    write(newDir(), 'entries/same.md', '# Same\n');
    write(newDir(), 'entries/different.md', '# New\n');
    write(newDir(), 'entries/new-only.md', '# New only\n');

    const plan = buildLibraryMigrationPlan({
      sourceDir: oldDir(),
      targetDir: newDir(),
      timestamp: '20260424T010203Z',
    });

    expect(plan.filesToCopy.map((file) => file.relPath)).toEqual(['entries/missing.md']);
    expect(plan.identicalFiles.map((file) => file.relPath)).toEqual(['entries/same.md']);
    expect(plan.conflicts.map((file) => file.relPath)).toEqual(['entries/different.md']);
    expect(plan.targetOnlyFiles).toEqual(['entries/new-only.md']);
  });
});

describe('library migration executor', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-library-migration-exec-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function oldDir(): string {
    return path.join(tempDir, '.ft-bookmarks', 'md');
  }

  function newDir(): string {
    return path.join(tempDir, '.fieldtheory', 'library');
  }

  function write(root: string, relPath: string, content: string): void {
    const absPath = path.join(root, ...relPath.split('/'));
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content);
  }

  it('copies missing files, conflict-copies changed files, backs up old, and creates the symlink', () => {
    write(oldDir(), 'entries/missing.md', '# Missing\n');
    write(oldDir(), 'entries/different.md', '# Old\n');
    write(newDir(), 'entries/different.md', '# New\n');

    const plan = buildLibraryMigrationPlan({
      sourceDir: oldDir(),
      targetDir: newDir(),
      timestamp: '20260424T010203Z',
    });
    const result = executeLibraryMigration(plan);

    expect(result.success).toBe(true);
    expect(result.copiedFiles).toEqual(['entries/missing.md']);
    expect(result.conflictCopies).toEqual([
      {
        relPath: 'entries/different.md',
        copiedTo: path.join(newDir(), 'entries', 'different.conflict-20260424T010203Z.md'),
      },
    ]);
    expect(result.backupDir).toBe(path.join(tempDir, '.ft-bookmarks', 'md.backup-20260424T010203Z'));
    expect(result.symlinkCreated).toBe(true);
    expect(fs.readFileSync(path.join(newDir(), 'entries', 'missing.md'), 'utf-8')).toBe('# Missing\n');
    expect(fs.readFileSync(path.join(newDir(), 'entries', 'different.md'), 'utf-8')).toBe('# New\n');
    expect(fs.readFileSync(path.join(newDir(), 'entries', 'different.conflict-20260424T010203Z.md'), 'utf-8')).toBe('# Old\n');
    expect(fs.lstatSync(oldDir()).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(oldDir())).toBe(fs.realpathSync(newDir()));
  });

  it('creates the legacy symlink when only the canonical library exists', () => {
    write(newDir(), 'entries/new.md', '# New\n');

    const plan = buildLibraryMigrationPlan({
      sourceDir: oldDir(),
      targetDir: newDir(),
      timestamp: '20260424T010203Z',
    });
    const result = executeLibraryMigration(plan);

    expect(result.success).toBe(true);
    expect(result.backupDir).toBeNull();
    expect(result.symlinkCreated).toBe(true);
    expect(fs.realpathSync(oldDir())).toBe(fs.realpathSync(newDir()));
  });

  it('refuses to execute a blocked plan', () => {
    fs.mkdirSync(path.dirname(oldDir()), { recursive: true });
    fs.writeFileSync(oldDir(), 'not a directory');

    const plan = buildLibraryMigrationPlan({
      sourceDir: oldDir(),
      targetDir: newDir(),
      timestamp: '20260424T010203Z',
    });
    const result = executeLibraryMigration(plan);

    expect(plan.canExecute).toBe(false);
    expect(result.success).toBe(false);
    expect(result.errors[0]).toContain('Legacy library path is not a normal directory');
  });
});
