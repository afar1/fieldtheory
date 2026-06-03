import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  clearLauncherFileIndexForTests,
  getDefaultLauncherFileSearchRoots,
  isLauncherFileIndexing,
  openLauncherFile,
  resolveLauncherFilePath,
  searchLauncherFiles,
  warmLauncherFileIndex,
} from './launcherFiles';

function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-files-test-'));
}

describe('launcher file index', () => {
  beforeEach(() => {
    clearLauncherFileIndexForTests();
  });

  afterEach(() => {
    clearLauncherFileIndexForTests();
  });

  it('builds a reusable index, searches it, and skips heavy generated directories', async () => {
    const root = makeTempRoot();
    try {
      const skippedPath = path.join(root, 'node_modules', 'needle.txt');
      const includedPath = path.join(root, 'src', 'needle.txt');
      const draftPath = path.join(root, 'Documents', 'Draft Notes.md');
      const nestedDraftPath = path.join(root, 'Documents', 'Project', 'Draft Plan.txt');
      fs.mkdirSync(path.dirname(skippedPath), { recursive: true });
      fs.mkdirSync(path.dirname(includedPath), { recursive: true });
      fs.mkdirSync(path.dirname(nestedDraftPath), { recursive: true });
      fs.writeFileSync(skippedPath, 'skip');
      fs.writeFileSync(includedPath, 'include');
      fs.writeFileSync(draftPath, '# Draft');
      fs.writeFileSync(nestedDraftPath, 'plan');

      await warmLauncherFileIndex({ roots: [root], now: 1, maxAgeMs: 0 });
      const needleResult = await searchLauncherFiles('needle', { roots: [root], now: 2, maxAgeMs: 10_000 });
      const draftResult = await searchLauncherFiles('draft', { roots: [root], now: 3, maxAgeMs: 10_000 });

      expect(needleResult.files.map(file => file.filePath)).toEqual([includedPath]);
      expect(isLauncherFileIndexing()).toBe(false);
      expect(draftResult.files.map(file => file.filePath)).toEqual(expect.arrayContaining([draftPath, nestedDraftPath]));
      expect(draftResult.indexing).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('prioritizes matching directories before matching files', async () => {
    const root = makeTempRoot();
    try {
      const docsDir = path.join(root, 'Documents', 'Drafts');
      const docsFile = path.join(root, 'Documents', 'Drafts.md');
      fs.mkdirSync(docsDir, { recursive: true });
      fs.writeFileSync(docsFile, '# Drafts');
      expect((await fsPromises.stat(docsDir)).isDirectory()).toBe(true);
      expect((await fsPromises.stat(docsFile)).isFile()).toBe(true);

      await warmLauncherFileIndex({ roots: [root], maxAgeMs: 0, maxEntries: 10 });
      const result = await searchLauncherFiles('drafts', { roots: [root], maxAgeMs: 10_000, maxEntries: 10 });

      expect(result.files.map(file => file.filePath).slice(0, 2)).toEqual([docsDir, docsFile]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('searches a warmed representative index inside the launcher latency budget', async () => {
    const root = makeTempRoot();
    try {
      const docsDir = path.join(root, 'Documents');
      fs.mkdirSync(docsDir, { recursive: true });
      for (let index = 0; index < 1200; index += 1) {
        fs.writeFileSync(path.join(docsDir, `note-${index}.md`), `# Note ${index}`);
      }
      const needlePath = path.join(docsDir, 'needle-project-plan.md');
      fs.writeFileSync(needlePath, '# Needle');
      expect((await fsPromises.stat(needlePath)).isFile()).toBe(true);
      expect((await fsPromises.readdir(docsDir)).length).toBeGreaterThan(1000);

      await warmLauncherFileIndex({ roots: [root], maxAgeMs: 0, maxEntries: 1500 });
      const startedAt = performance.now();
      const result = await searchLauncherFiles('needle', { roots: [root], maxAgeMs: 10_000, maxEntries: 1500 });
      const elapsedMs = performance.now() - startedAt;

      expect(result.indexing).toBe(false);
      expect(result.files[0]?.filePath).toBe(needlePath);
      expect(elapsedMs).toBeLessThan(100);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('opens only existing files under allowed roots', async () => {
    const root = makeTempRoot();
    const outside = makeTempRoot();
    try {
      const filePath = path.join(root, 'Allowed.txt');
      const outsidePath = path.join(outside, 'Outside.txt');
      fs.writeFileSync(filePath, 'ok');
      fs.writeFileSync(outsidePath, 'nope');
      const opened: string[] = [];

      expect(resolveLauncherFilePath(filePath, [root])).toBe(filePath);
      expect(resolveLauncherFilePath(outsidePath, [root])).toBeNull();

      const result = await openLauncherFile(filePath, {
        roots: [root],
        openPath: async (resolvedPath) => {
          opened.push(resolvedPath);
          return '';
        },
      });
      const rejected = await openLauncherFile(outsidePath, {
        roots: [root],
        openPath: async () => '',
      });

      expect(result).toEqual({ success: true });
      expect(rejected).toEqual({ success: false, error: 'File not found' });
      expect(opened).toEqual([filePath]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('defaults file search to common user file roots and the Field Theory library', () => {
    expect(getDefaultLauncherFileSearchRoots('/Users/tester')).toEqual([
      '/Users/tester/Desktop',
      '/Users/tester/Documents',
      '/Users/tester/Downloads',
      '/Users/tester/.fieldtheory/library',
    ]);
  });
});
