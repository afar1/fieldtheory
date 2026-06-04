import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isActiveLibraryFileContextAllowed } from './activeLibraryFileContextPolicy';

describe('isActiveLibraryFileContextAllowed', () => {
  let tempDir: string;
  let libraryRoot: string;
  let watchedRoot: string;
  let probeRoot: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'active-library-context-policy-'));
    libraryRoot = path.join(tempDir, 'library');
    watchedRoot = path.join(tempDir, 'watched');
    probeRoot = path.join(tempDir, 'ft-leftnav-runtime-probe', 'home', '.fieldtheory', 'librarian', 'artifacts');
    fs.mkdirSync(libraryRoot, { recursive: true });
    fs.mkdirSync(watchedRoot, { recursive: true });
    fs.mkdirSync(probeRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('accepts documents inside current library roots', () => {
    const filePath = path.join(libraryRoot, 'note.md');
    fs.writeFileSync(filePath, '# Note\n');

    expect(isActiveLibraryFileContextAllowed({
      context: { type: 'wiki', rootPath: libraryRoot, filePath },
      libraryRootPaths: [libraryRoot],
      watchedDirPaths: [],
    })).toBe(true);
  });

  it('accepts documents inside current watched reading roots', () => {
    const filePath = path.join(watchedRoot, 'reading.md');
    fs.writeFileSync(filePath, '# Reading\n');

    expect(isActiveLibraryFileContextAllowed({
      context: { type: 'external', rootPath: watchedRoot, filePath },
      libraryRootPaths: [libraryRoot],
      watchedDirPaths: [watchedRoot],
    })).toBe(true);
  });

  it('rejects stale runtime probe documents outside the current roots', () => {
    const filePath = path.join(probeRoot, 'README.md');
    fs.writeFileSync(filePath, '# Probe\n');

    expect(isActiveLibraryFileContextAllowed({
      context: { type: 'external', rootPath: '', filePath },
      libraryRootPaths: [libraryRoot],
      watchedDirPaths: [watchedRoot],
    })).toBe(false);
  });
});
