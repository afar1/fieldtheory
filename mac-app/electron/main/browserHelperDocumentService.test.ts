import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { readDocumentVersion } from './documentSaveGuard';
import { BrowserHelperDocumentService } from './browserHelperDocumentService';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldtheory-browser-helper-'));
  tempDirs.push(dir);
  return dir;
}

describe('BrowserHelperDocumentService', () => {
  it('returns only supported text documents in the tree', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'Notes'));
    fs.mkdirSync(path.join(root, 'Empty'));
    fs.mkdirSync(path.join(root, '_Hidden'));
    fs.mkdirSync(path.join(root, 'Doc.assets'));
    fs.writeFileSync(path.join(root, 'Notes', 'Plan.md'), '# Plan\n');
    fs.writeFileSync(path.join(root, 'Notes', 'Page.html'), '<p>Hello</p>\n');
    fs.writeFileSync(path.join(root, 'Notes', 'Image.png'), 'not included');

    const service = new BrowserHelperDocumentService([root]);

    expect(service.getRoots()[0].tree).toEqual([
      {
        kind: 'dir',
        name: 'Empty',
        relPath: 'Empty',
        children: [],
      },
      {
        kind: 'dir',
        name: 'Notes',
        relPath: 'Notes',
        children: [
          { kind: 'file', name: 'Page.html', relPath: 'Notes/Page.html', documentKind: 'html' },
          { kind: 'file', name: 'Plan.md', relPath: 'Notes/Plan.md', documentKind: 'markdown' },
        ],
      },
    ]);
  });

  it('reads and saves a document with expected-version protection', () => {
    const root = makeTempDir();
    const filePath = path.join(root, 'Plan.md');
    fs.writeFileSync(filePath, '# Plan\n');
    const service = new BrowserHelperDocumentService([root]);

    const document = service.getDocument({ rootId: 'root-1', relPath: 'Plan.md' });
    expect(document?.content).toBe('# Plan\n');

    const result = service.saveDocument({ rootId: 'root-1', relPath: 'Plan.md' }, '# Updated\n', document?.version);

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('# Updated\n');
  });

  it('returns native-shaped library roots and extensionless wiki pages', () => {
    const root = makeTempDir();
    fs.mkdirSync(path.join(root, 'Notes'));
    fs.mkdirSync(path.join(root, 'Empty'));
    fs.mkdirSync(path.join(root, '_Drafts'));
    const filePath = path.join(root, 'Notes', 'Plan.md');
    fs.writeFileSync(filePath, '# Plan\n');
    const service = new BrowserHelperDocumentService([root]);

    const libraryRoot = service.getLibraryRoots()[0];
    const page = service.getWikiPage('Notes/Plan');

    expect(libraryRoot).toEqual(expect.objectContaining({
      path: root,
      label: path.basename(root),
      builtin: true,
      writable: true,
    }));
    expect(libraryRoot.tree).toEqual([
      {
        kind: 'dir',
        name: 'Empty',
        relPath: 'Empty',
        children: [],
      },
      {
        kind: 'dir',
        name: 'Notes',
        relPath: 'Notes',
        children: [
          expect.objectContaining({
            kind: 'file',
            name: 'Plan.md',
            relPath: 'Notes/Plan',
            absPath: filePath,
            title: 'Plan',
            documentKind: 'markdown',
          }),
        ],
      },
    ]);
    expect(page).toEqual(expect.objectContaining({
      rootPath: root,
      relPath: 'Notes/Plan',
      absPath: filePath,
      title: 'Plan',
      content: '# Plan\n',
    }));
  });

  it('creates wiki files, default files, directories, and renames pages using native rel paths', () => {
    const root = makeTempDir();
    const service = new BrowserHelperDocumentService([root]);

    const page = service.createWikiFile('Notes', 'Browser Plan');
    const defaultPage = service.createWikiFileWithDefaultTitle('Scratchpad', new Date('2026-06-02T03:04:05Z'));
    const dirCreated = service.createWikiDir('Projects');
    const renamed = service.renameWikiPage('Notes/Browser Plan', 'Renamed Plan');

    expect(page).toEqual(expect.objectContaining({
      relPath: 'Notes/Browser Plan',
      title: 'Browser Plan',
      content: '',
    }));
    expect(defaultPage).toEqual(expect.objectContaining({
      relPath: 'Scratchpad/2026-06-02',
      title: '2026-06-02',
    }));
    expect(dirCreated).toBe(true);
    expect(renamed).toBe('Notes/Renamed Plan');
    expect(fs.existsSync(path.join(root, 'Notes', 'Browser Plan.md'))).toBe(false);
    expect(fs.readFileSync(path.join(root, 'Notes', 'Renamed Plan.md'), 'utf-8')).toBe('');
    expect(fs.statSync(path.join(root, 'Projects')).isDirectory()).toBe(true);
    expect(service.createWikiFile('../outside', 'Nope')).toBeNull();
    expect(service.createWikiFile('artifacts', 'Nope')).toBeNull();
    expect(service.createWikiFile('', '_draft')).toBeNull();
    expect(service.createWikiDir('artifacts/nested')).toBe(false);
    expect(service.createWikiDir('_drafts')).toBe(false);
  });

  it('preserves external text document extensions when renaming', () => {
    const root = makeTempDir();
    const cssPath = path.join(root, 'theme.css');
    fs.writeFileSync(cssPath, 'body { color: red; }\n');
    const service = new BrowserHelperDocumentService([root]);

    const renamed = service.renameExternal(cssPath, 'brand');

    expect(renamed).toEqual(expect.objectContaining({
      path: path.join(root, 'brand.css'),
      name: 'brand.css',
      documentKind: 'css',
    }));
    expect(fs.existsSync(cssPath)).toBe(false);
    expect(fs.readFileSync(path.join(root, 'brand.css'), 'utf-8')).toBe('body { color: red; }\n');
  });

  it('rejects stale saves instead of overwriting', () => {
    const root = makeTempDir();
    const filePath = path.join(root, 'Plan.md');
    fs.writeFileSync(filePath, '# Plan\n');
    const expectedVersion = readDocumentVersion(filePath);
    fs.writeFileSync(filePath, '# Other writer\n');
    const service = new BrowserHelperDocumentService([root]);

    const result = service.saveDocument({ rootId: 'root-1', relPath: 'Plan.md' }, '# Browser write\n', expectedVersion);

    expect(result).toEqual(expect.objectContaining({ ok: false, reason: 'conflict' }));
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('# Other writer\n');
  });

  it('rejects traversal, absolute paths, unsupported files, and symlink escapes', () => {
    const root = makeTempDir();
    const outside = makeTempDir();
    fs.writeFileSync(path.join(root, 'Plan.md'), '# Plan\n');
    fs.writeFileSync(path.join(root, 'Image.png'), 'not markdown');
    fs.writeFileSync(path.join(outside, 'Secret.md'), '# Secret\n');
    fs.symlinkSync(path.join(outside, 'Secret.md'), path.join(root, 'Secret.md'));
    const service = new BrowserHelperDocumentService([root]);

    expect(service.getDocument({ rootId: 'root-1', relPath: '../outside.md' })).toBeNull();
    expect(service.getDocument({ rootId: 'root-1', relPath: path.join(root, 'Plan.md') })).toBeNull();
    expect(service.getDocument({ rootId: 'root-1', relPath: 'Image.png' })).toBeNull();
    expect(service.getDocument({ rootId: 'root-1', relPath: 'Secret.md' })).toBeNull();
    expect(JSON.stringify(service.getRoots())).not.toContain('Secret.md');
  });
});
