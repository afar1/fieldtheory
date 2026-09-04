// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readDocumentVersion } from '../../electron/main/documentSaveGuard';
import { LibraryLinkRelationReader } from '../../electron/main/libraryLinkRelationReader';
import { type LinkRelationSnapshot, type LinkRelationTarget } from '../../electron/shared/libraryLinkRelations';
import { LibraryLinkRelationCache } from '../services/libraryLinkRelationCache';
import { MarkdownLinkRelationIndex } from '../utils/markdownLinkRelationIndex';
import { buildWikiIndex, getMarkdownEditorLinkHits, getMarkdownLinkedDocuments, type MarkdownLinkRelationDocument } from '../utils/wikiLinks';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function fixture(count = 3) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldtheory-link-relations-'));
  dirs.push(root);
  const targets: LinkRelationTarget[] = Array.from({ length: count }, (_, i) => ({ kind: 'wiki', relPath: `Page ${i}` }));
  const pages = targets.map((_, i) => ({ relPath: `Page ${i}`, title: `Page ${i}` }));
  const file = (i: number) => path.join(root, `Page ${i}.md`);
  for (let i = 0; i < count; i++) fs.writeFileSync(file(i), `# Page ${i}\nFirst [[Page ${(i + 1) % count}]]\nSecond [[Page ${(i + 1) % count}]]\n`);
  let scope = root;
  const load = vi.fn((target: LinkRelationTarget) => {
    if (target.kind !== 'wiki') return null;
    const filename = path.join(root, `${target.relPath}.md`);
    return { target, title: target.relPath, content: fs.readFileSync(filename, 'utf8'), documentVersion: readDocumentVersion(filename) };
  });
  const reader = new LibraryLinkRelationReader({
    scope: () => scope,
    resolve: (target) => target.kind === 'wiki' ? {
      path: path.join(root, `${target.relPath}.md`), metadataVersion: '', load: () => load(target),
    } : null,
  });
  const cache = new LibraryLinkRelationCache();
  const index = buildWikiIndex(pages);
  const repair = (requested = targets, catalog = index) => cache.load(requested, catalog, (request) => reader.read(request, 'test'), () => true);
  const fullLoad = () => targets.flatMap((target) => {
    try {
      const doc = load(target);
      if (!doc) return [];
      const { documentVersion: _, ...document } = doc;
      return [{ ...document, linkHits: getMarkdownEditorLinkHits(document.content, index) }];
    } catch { return []; }
  });
  return { targets, pages, file, reader, cache, index, repair, fullLoad, load, setScope: (next: string) => { scope = next; } };
}

describe('complete versioned link relations', () => {
  it('matches full hydration, reuses unchanged documents, and reads same-size edits with unchanged timestamps', async () => {
    const f = fixture();
    const expected = f.fullLoad();
    f.load.mockClear();
    const cold = await f.repair();
    expect(cold).toEqual(expected);
    expect(f.load).toHaveBeenCalledTimes(3);
    f.load.mockClear();
    expect(await f.repair()).toBe(cold);
    expect(f.load).not.toHaveBeenCalled();
    const stat = fs.statSync(f.file(0));
    fs.writeFileSync(f.file(0), fs.readFileSync(f.file(0), 'utf8').replaceAll('[[Page 1]]', '[[Page 2]]'));
    fs.utimesSync(f.file(0), stat.atime, stat.mtime);
    const changed = await f.repair();
    expect(f.load).toHaveBeenCalledTimes(1);
    expect(changed).toEqual(f.fullLoad());
    expect(changed![0]).not.toBe(cold![0]);
    expect(changed![1]).toBe(cold![1]);
  });

  it('repairs deletion, recreation, rename, catalog additions, and account/root changes without file events', async () => {
    const f = fixture();
    await f.repair();
    fs.unlinkSync(f.file(1));
    expect(await f.repair()).toEqual(f.fullLoad());
    fs.writeFileSync(f.file(1), '# Recreated\n[[Page 0]]');
    expect(await f.repair()).toEqual(f.fullLoad());
    fs.renameSync(f.file(1), f.file(3));
    const targets: LinkRelationTarget[] = [f.targets[0], { kind: 'wiki', relPath: 'Page 3' }, f.targets[2]];
    const catalog = buildWikiIndex([...f.pages.filter((p) => p.relPath !== 'Page 1'), { relPath: 'Page 3', title: 'Page 3' }]);
    const renamed = await f.repair(targets, catalog);
    expect(renamed!.map((doc) => doc.target)).toEqual(targets);
    expect(renamed![0].linkHits).toEqual(getMarkdownEditorLinkHits(renamed![0].content, catalog));
    f.load.mockClear();
    f.setScope('different account or roots');
    expect(await f.repair(targets, catalog)).toEqual(renamed);
    expect(f.load).toHaveBeenCalledTimes(3);
  });

  it('resolves previously missing titles and title collisions when the catalog changes, without loading bodies again', async () => {
    const f = fixture();
    fs.writeFileSync(f.file(0), 'See [[Later]] and [[Alias]]');
    const cold = await f.repair();
    f.load.mockClear();
    const index = buildWikiIndex([...f.pages, { relPath: 'Page 2', title: 'Later' }, { relPath: 'Page 1', title: 'Alias' }]);
    const resolved = await f.repair(f.targets, index);
    expect(f.load).not.toHaveBeenCalled();
    expect(resolved![0].linkHits).toEqual(getMarkdownEditorLinkHits(resolved![0].content, index));
    expect(resolved![0]).not.toBe(cold![0]);
    expect(await f.repair(f.targets, buildWikiIndex([...f.pages, { relPath: 'Page 2', title: 'Later' }, { relPath: 'Page 1', title: 'Alias' }]))).toBe(resolved);
  });

  it('falls back for absent, failed, incomplete, or inconsistent bridges without publishing a partial snapshot', async () => {
    const f = fixture();
    const cold = await f.repair();
    const bridges: Array<Parameters<LibraryLinkRelationCache['load']>[2]> = [undefined,
      async () => { throw new Error('offline'); }, async () => ({ complete: false }),
      async () => ({ complete: true, scope: 'new', changes: [] })];
    for (const bridge of bridges) {
      expect(await f.cache.load(f.targets, f.index, bridge, () => true)).toBeNull();
    }
    expect(await f.repair()).toBe(cold);
    expect(await f.cache.load(f.targets, f.index, async () => ({ complete: true, scope: 'new', changes: [] }), () => false)).toBeNull();
  });

  it('does not publish an older overlapping repair and cancels backend work for the same client only', async () => {
    const f = fixture(96);
    const request = { clientId: 'one', sources: f.targets.map((target) => ({ target })) };
    const old = f.reader.read(request, 'renderer:1');
    const other = f.reader.read(request, 'renderer:2');
    const latest = f.reader.read(request, 'renderer:1');
    expect(await old).toEqual({ complete: false });
    expect((await other).complete).toBe(true);
    expect((await latest).complete).toBe(true);
    let resolveOld!: (snapshot: LinkRelationSnapshot) => void;
    const pending = f.cache.load(f.targets, f.index, () => new Promise((resolve) => { resolveOld = resolve; }), () => true);
    const current = await f.repair();
    resolveOld({ complete: true, scope: 'obsolete', changes: [] });
    expect(await pending).toBeNull();
    expect(await f.repair()).toBe(current);
  });

  it('never versions a snapshot whose file changed during the full read', async () => {
    const f = fixture(1);
    await f.repair();
    f.load.mockClear();
    fs.writeFileSync(f.file(0), 'Changed before repair');
    const original = f.load.getMockImplementation()!;
    f.load.mockImplementationOnce((target) => {
      fs.writeFileSync(f.file(0), 'Changed during load');
      return original(target);
    });
    await f.repair();
    await f.repair();
    expect(f.load).toHaveBeenCalledTimes(2);
  });

  it('does not cache transient content even if a file changes back before its version is read', async () => {
    const f = fixture(1);
    const original = f.load.getMockImplementation()!;
    f.load.mockImplementationOnce((target) => ({ ...original(target)!, content: 'Transient contents' }));
    const first = await f.repair();
    expect(first![0].content).toBe('Transient contents');
    const repaired = await f.repair();
    expect(repaired![0].content).toBe(fs.readFileSync(f.file(0), 'utf8'));
    expect(f.load).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed requests before resolving paths', async () => {
    const f = fixture(1);
    await expect(f.reader.read({ clientId: 'bad', sources: [{ target: { kind: 'file', path: '/' } }] }, 'test')).rejects.toThrow('Invalid');
    expect(f.load).not.toHaveBeenCalled();
  });
});

describe('reverse link index equivalence', () => {
  it('preserves directions, first excerpts, tie order, aliases, commands, artifacts, bookmarks, and unsaved source text', () => {
    const pages = [
      { relPath: 'Home', title: 'Home' },
      { relPath: 'a', title: 'Same' },
      { relPath: 'b', title: 'Same' },
      { relPath: '', title: 'Run', commandPath: '/commands/Run.md' },
      { relPath: '', title: 'Essay', artifactPath: '/artifacts/Essay.md' },
    ];
    const catalog = buildWikiIndex(pages);
    const docs: MarkdownLinkRelationDocument[] = [
      { target: { kind: 'wiki', relPath: 'a' }, title: 'Same', content: 'First [[Home]]\nSecond [[Home]]' },
      { target: { kind: 'wiki', relPath: 'b' }, title: 'Same', content: '[Home](wiki://Home)\n`[[ignored]]`' },
      { target: { kind: 'command', path: '/commands/Run.md' }, title: 'Run', content: 'Run [[Home]]' },
      { target: { kind: 'artifact', path: '/artifacts/Essay.md' }, title: 'Essay', content: 'Essay [[Home]]' },
      { target: { kind: 'bookmarks' }, title: 'Bookmarks', content: '' },
    ].map((doc) => ({ ...doc, linkHits: getMarkdownEditorLinkHits(doc.content, catalog) })) as MarkdownLinkRelationDocument[];
    const relationIndex = new MarkdownLinkRelationIndex();
    const source = { kind: 'wiki', relPath: '/Home.md' } as const;
    const contents = ['[[a]] [[Run]] [[Essay]] @bookmarks\n[[a]] again', 'No outgoing links', '[[b]] [[Unknown]]', '[[Home]]'];
    for (const documents of [docs, [...docs].reverse(), docs.slice(1), docs.map((doc, i) => i === 1 ? { ...doc, content: '', linkHits: [] } : doc)]) {
      relationIndex.update(documents, catalog);
      for (const content of contents) {
        expect(relationIndex.getLinks(source, content, catalog)).toEqual(getMarkdownLinkedDocuments(source, content, documents, catalog));
        expect(relationIndex.getLinks(null, content, catalog)).toEqual(getMarkdownLinkedDocuments(null, content, documents, catalog));
      }
    }
  });

  it('matches full hydration after an incremental edit in a bounded filesystem workload', async () => {
    const f = fixture(512);
    const relationIndex = new MarkdownLinkRelationIndex();
    const baseline = f.fullLoad();
    const cold = (await f.repair())!;
    expect(cold).toEqual(baseline);
    f.load.mockClear();
    const unchanged = (await f.repair())!;
    expect(f.load).not.toHaveBeenCalled();
    fs.writeFileSync(f.file(40), 'New first [[Page 0]]\nSecond [[Page 0]]');
    const edited = (await f.repair())!;
    expect(f.load).toHaveBeenCalledTimes(1);
    expect(edited.filter((doc, i) => doc !== unchanged[i])).toHaveLength(1);
    relationIndex.update(edited, f.index);
    const full = f.fullLoad();
    for (const i of [0, 1, 40, 511]) {
      expect(relationIndex.getLinks(f.targets[i], edited[i].content, f.index)).toEqual(getMarkdownLinkedDocuments(f.targets[i], full[i].content, full, f.index));
    }
  });

  it.runIf(process.env.FT_LINK_RELATION_BENCHMARK === '1')('measures full and versioned repairs against the same isolated files', async () => {
    const f = fixture(8395);
    const relationIndex = new MarkdownLinkRelationIndex();
    const samples: Record<string, number[]> = { full: [], cold: [], coldWarmFilesystem: [], unchanged: [], edited: [], fullQuery: [], indexedQuery: [] };
    let start = performance.now();
    const cold = (await f.repair())!;
    samples.cold.push(performance.now() - start);
    relationIndex.update(cold, f.index);
    for (let iteration = 0; iteration < 6; iteration++) {
      start = performance.now();
      const full = f.fullLoad();
      const fullLinks = getMarkdownLinkedDocuments(f.targets[0], full[0].content, full, f.index);
      const fullMs = performance.now() - start;
      start = performance.now();
      const freshCache = new LibraryLinkRelationCache();
      const fresh = (await freshCache.load(f.targets, f.index, (request) => f.reader.read(request, 'benchmark'), () => true))!;
      const freshIndex = new MarkdownLinkRelationIndex();
      freshIndex.update(fresh, f.index);
      freshIndex.getLinks(f.targets[0], fresh[0].content, f.index);
      const coldWarmMs = performance.now() - start;
      f.load.mockClear();
      start = performance.now();
      const unchanged = (await f.repair())!;
      relationIndex.update(unchanged, f.index);
      const links = relationIndex.getLinks(f.targets[0], unchanged[0].content, f.index);
      const unchangedMs = performance.now() - start;
      expect(f.load).not.toHaveBeenCalled();
      expect(links).toEqual(fullLinks);
      fs.writeFileSync(f.file(40), `Edit ${iteration}\nNew [[Page 0]]`);
      start = performance.now();
      const edited = (await f.repair())!;
      relationIndex.update(edited, f.index);
      const editedLinks = relationIndex.getLinks(f.targets[0], edited[0].content, f.index);
      const editedMs = performance.now() - start;
      expect(f.load).toHaveBeenCalledTimes(1);
      const expected = f.fullLoad();
      expect(edited).toEqual(expected);
      expect(editedLinks).toEqual(getMarkdownLinkedDocuments(f.targets[0], expected[0].content, expected, f.index));
      start = performance.now();
      for (let query = 0; query < 100; query++) getMarkdownLinkedDocuments(f.targets[0], `Unsaved ${query} [[Page 1]]`, edited, f.index);
      const fullQueryMs = (performance.now() - start) / 100;
      start = performance.now();
      for (let query = 0; query < 100; query++) relationIndex.getLinks(f.targets[0], `Unsaved ${query} [[Page 1]]`, f.index);
      const indexedQueryMs = (performance.now() - start) / 100;
      if (iteration > 0) {
        samples.full.push(fullMs);
        samples.coldWarmFilesystem.push(coldWarmMs);
        samples.unchanged.push(unchangedMs);
        samples.edited.push(editedMs);
        samples.fullQuery.push(fullQueryMs);
        samples.indexedQuery.push(indexedQueryMs);
      }
    }
    console.log('LINK_RELATION_BENCHMARK', JSON.stringify({ files: f.targets.length, samplesMs: samples,
      bodyLoadsPerRepair: { full: f.targets.length, unchanged: 0, edited: 1 } }));
  }, 30000);
});
