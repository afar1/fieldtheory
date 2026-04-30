import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readDocumentVersion, writeTextFileWithConflictGuard } from './documentSaveGuard';

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
});
