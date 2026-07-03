import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  documentSaveConflictIfVersionChanged,
  documentSaveResultForSharedConflict,
  documentSaveResultForUpdatedFile,
  readDocumentVersion,
  writeTextFileAtomically,
  writeTextFileWithConflictGuard,
} from './documentSaveGuard';

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldtheory-save-guard-'));
  tempDirs.push(dir);
  return dir;
}

describe('document save guard', () => {
  it('writes a file and returns the new document version', () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, 'note.md');
    fs.writeFileSync(filePath, '# Original\n');
    const expectedVersion = readDocumentVersion(filePath);

    const result = writeTextFileWithConflictGuard(filePath, '# Updated\n', expectedVersion);

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('# Updated\n');
  });

  it('preserves the original file mode when replacing content', () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, 'private.md');
    fs.writeFileSync(filePath, '# Original\n');
    fs.chmodSync(filePath, 0o600);
    const expectedVersion = readDocumentVersion(filePath);

    const result = writeTextFileWithConflictGuard(filePath, '# Updated\n', expectedVersion);

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it('creates a new file atomically when no previous mode exists', () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, 'downloaded.md');

    writeTextFileAtomically(filePath, '# Downloaded\n');

    expect(fs.readFileSync(filePath, 'utf-8')).toBe('# Downloaded\n');
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it('leaves the original file intact if the atomic replace fails', () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, 'note.md');
    fs.writeFileSync(filePath, '# Original\n');
    const expectedVersion = readDocumentVersion(filePath);
    vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('rename failed');
    });

    const result = writeTextFileWithConflictGuard(filePath, '# Updated\n', expectedVersion);

    expect(result).toEqual({ ok: false, reason: 'error' });
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('# Original\n');
    expect(fs.readdirSync(dir).filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('returns a document save result for a refreshed shared cache file', () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, 'shared.md');
    fs.writeFileSync(filePath, '# Remote update\n');

    const result = documentSaveResultForUpdatedFile(filePath);

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    if (result.ok) {
      expect(result.version.sha256).toBe(readDocumentVersion(filePath).sha256);
    }
  });

  it('maps a remote shared edit conflict to the normal document conflict shape', () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, 'shared.md');
    fs.writeFileSync(filePath, '# Remote content\n');

    const result = documentSaveResultForSharedConflict('# Remote content\n', filePath);

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      reason: 'conflict',
      currentContent: '# Remote content\n',
    }));
    if (!result.ok) {
      expect(result.currentVersion?.sha256).toBe(readDocumentVersion(filePath).sha256);
    }
  });

  it('reports a conflict when a shared cache file changed since the editor opened', () => {
    const dir = makeTempDir();
    const filePath = path.join(dir, 'shared.md');
    fs.writeFileSync(filePath, '# Original\n');
    const expectedVersion = readDocumentVersion(filePath);
    fs.writeFileSync(filePath, '# Remote refresh\n');

    const result = documentSaveConflictIfVersionChanged(filePath, expectedVersion);

    expect(result).toEqual(expect.objectContaining({
      ok: false,
      reason: 'conflict',
      currentContent: '# Remote refresh\n',
    }));
  });
});
