import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LibraryIndexStore } from './libraryIndexStore';

vi.mock('better-sqlite3', () => {
  type Row = { path: string; mtime_ms: number; size: number; metadata_json: string; indexed_at: number };
  type LinkHitRow = {
    source_path: string;
    kind: string;
    raw_target: string | null;
    href: string | null;
    start_offset: number;
    end_offset: number;
    display_start: number;
    display_end: number;
    display_text: string;
    indexed_at: number;
  };

  class Statement {
    constructor(private db: FakeDatabase, private sql: string) {}

    all(...values: string[]): LinkHitRow[] {
      const value = values[0];
      if (/FROM library_link_hits/.test(this.sql) && /WHERE source_path = \?/.test(this.sql)) {
        return this.db.linkRows
          .filter(row => row.source_path === value)
          .sort(compareLinkHitRows);
      }
      if (/FROM library_link_hits/.test(this.sql) && /source_path IN/.test(this.sql)) {
        const sourcePaths = new Set(values);
        this.db.sourceBatchQueryCount += 1;
        return this.db.linkRows
          .filter(row => sourcePaths.has(row.source_path))
          .sort(compareLinkHitRows);
      }
      if (/FROM library_link_hits/.test(this.sql) && /raw_target = \?/.test(this.sql)) {
        return this.db.linkRows
          .filter(row => row.kind === 'wikilink' && row.raw_target === value)
          .sort(compareLinkHitRows);
      }
      if (/FROM library_link_hits/.test(this.sql) && /lower\(trim\(raw_target\)\)/.test(this.sql)) {
        const normalized = value.trim().toLowerCase();
        return this.db.linkRows
          .filter(row => row.kind === 'wikilink' && row.raw_target?.trim().toLowerCase() === normalized)
          .sort(compareLinkHitRows);
      }
      if (/FROM library_link_hits/.test(this.sql) && /href = \?/.test(this.sql)) {
        return this.db.linkRows
          .filter(row => row.href === value)
          .sort(compareLinkHitRows);
      }
      return [];
    }

    get(filePath: string, mtimeMs: number, size: number): { metadata_json: string } | undefined {
      const row = this.db.rows.get(filePath);
      if (!row || row.mtime_ms !== mtimeMs || row.size !== size) return undefined;
      return { metadata_json: row.metadata_json };
    }

    run(...args: unknown[]): { changes: number } {
      if (/INSERT INTO library_file_metadata/.test(this.sql)) {
        const [filePath, mtimeMs, size, metadataJson, indexedAt] = args as [string, number, number, string, number];
        this.db.rows.set(filePath, {
          path: filePath,
          mtime_ms: mtimeMs,
          size,
          metadata_json: metadataJson,
          indexed_at: indexedAt,
        });
        return { changes: 1 };
      }
      if (/DELETE FROM library_file_metadata WHERE path = \?/.test(this.sql)) {
        const [filePath] = args as [string];
        const metadataDeleted = this.db.rows.delete(filePath);
        this.db.linkRows = this.db.linkRows.filter(row => row.source_path !== filePath);
        return { changes: metadataDeleted ? 1 : 0 };
      }
      if (/DELETE FROM library_link_hits WHERE source_path = \?/.test(this.sql)) {
        const [filePath] = args as [string];
        const before = this.db.linkRows.length;
        this.db.linkRows = this.db.linkRows.filter(row => row.source_path !== filePath);
        return { changes: before - this.db.linkRows.length };
      }
      if (/INSERT INTO library_link_hits/.test(this.sql)) {
        const [
          sourcePath,
          kind,
          rawTarget,
          href,
          startOffset,
          endOffset,
          displayStart,
          displayEnd,
          displayText,
          indexedAt,
        ] = args as [string, string, string | null, string | null, number, number, number, number, string, number];
        this.db.linkRows.push({
          source_path: sourcePath,
          kind,
          raw_target: rawTarget,
          href,
          start_offset: startOffset,
          end_offset: endOffset,
          display_start: displayStart,
          display_end: displayEnd,
          display_text: displayText,
          indexed_at: indexedAt,
        });
        return { changes: 1 };
      }
      return { changes: 0 };
    }
  }

  type PersistedDb = { rows: Map<string, Row>; linkRows: LinkHitRow[] };
  const persisted = new Map<string, PersistedDb>();

  class FakeDatabase {
    rows: Map<string, Row>;
    linkRows: LinkHitRow[];
    sourceBatchQueryCount = 0;

    constructor(private dbPath: string) {
      const current = persisted.get(dbPath) ?? { rows: new Map<string, Row>(), linkRows: [] };
      this.rows = current.rows;
      this.linkRows = current.linkRows;
      persisted.set(dbPath, current);
    }

    pragma(): void {}
    exec(): void {}
    close(): void {}
    prepare(sql: string): Statement {
      return new Statement(this, sql);
    }
    transaction<T extends (...args: any[]) => any>(fn: T): T {
      return ((...args: Parameters<T>) => fn(...args)) as T;
    }
  }

  return { default: FakeDatabase };
});

function getFakeDatabase(store: LibraryIndexStore): { sourceBatchQueryCount: number } {
  return (store as unknown as { db: { sourceBatchQueryCount: number } }).db;
}

function compareLinkHitRows(
  a: { source_path: string; start_offset: number; end_offset: number },
  b: { source_path: string; start_offset: number; end_offset: number },
): number {
  return a.source_path.localeCompare(b.source_path) || a.start_offset - b.start_offset || a.end_offset - b.end_offset;
}

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldtheory-library-index-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('LibraryIndexStore', () => {
  it('returns metadata only when mtime and size match', () => {
    const dir = makeTempDir();
    const store = new LibraryIndexStore(path.join(dir, 'library-index.db'));
    const filePath = path.join(dir, 'note.md');

    store.setMetadata(filePath, 100, 12, {
      title: 'Note',
      archived: true,
      contentEditedAt: 1234,
    });

    expect(store.getMetadata(filePath, 100, 12)).toEqual({
      title: 'Note',
      archived: true,
      contentEditedAt: 1234,
    });
    expect(store.getMetadata(filePath, 101, 12)).toBeNull();
    expect(store.getMetadata(filePath, 100, 13)).toBeNull();

    store.removePath(filePath);
    expect(store.getMetadata(filePath, 100, 12)).toBeNull();
    store.close();
  });

  it('reopens persisted metadata from disk', () => {
    const dir = makeTempDir();
    const dbPath = path.join(dir, 'library-index.db');
    const filePath = path.join(dir, 'note.md');

    const first = new LibraryIndexStore(dbPath);
    first.setMetadata(filePath, 100, 12, { title: 'Persisted' });
    first.close();

    const second = new LibraryIndexStore(dbPath);
    expect(second.getMetadata(filePath, 100, 12)).toEqual({ title: 'Persisted' });
    second.close();
  });

  it('replaces and reads raw link hits for a document', () => {
    const dir = makeTempDir();
    const store = new LibraryIndexStore(path.join(dir, 'library-index.db'));
    const filePath = path.join(dir, 'source.md');

    store.replaceLinkHits(filePath, [
      {
        kind: 'bare-url',
        rawTarget: null,
        href: 'https://example.com',
        start: 20,
        end: 39,
        displayStart: 20,
        displayEnd: 39,
        displayText: 'https://example.com',
      },
      {
        kind: 'wikilink',
        rawTarget: 'Target',
        href: null,
        start: 4,
        end: 14,
        displayStart: 6,
        displayEnd: 12,
        displayText: 'Target',
      },
    ]);

    expect(store.getLinkHits(filePath)).toEqual([
      {
        kind: 'wikilink',
        rawTarget: 'Target',
        href: null,
        start: 4,
        end: 14,
        displayStart: 6,
        displayEnd: 12,
        displayText: 'Target',
      },
      {
        kind: 'bare-url',
        rawTarget: null,
        href: 'https://example.com',
        start: 20,
        end: 39,
        displayStart: 20,
        displayEnd: 39,
        displayText: 'https://example.com',
      },
    ]);

    store.replaceLinkHits(filePath, [{
      kind: 'wikilink',
      rawTarget: 'Fresh',
      href: null,
      start: 0,
      end: 9,
      displayStart: 2,
      displayEnd: 7,
      displayText: 'Fresh',
    }]);

    expect(store.getLinkHits(filePath)).toEqual([{
      kind: 'wikilink',
      rawTarget: 'Fresh',
      href: null,
      start: 0,
      end: 9,
      displayStart: 2,
      displayEnd: 7,
      displayText: 'Fresh',
    }]);
    store.close();
  });

  it('removes link hits when a document path is removed', () => {
    const dir = makeTempDir();
    const store = new LibraryIndexStore(path.join(dir, 'library-index.db'));
    const filePath = path.join(dir, 'source.md');

    store.setMetadata(filePath, 100, 12, { title: 'Source' });
    store.replaceLinkHits(filePath, [{
      kind: 'wikilink',
      rawTarget: 'Target',
      href: null,
      start: 0,
      end: 10,
      displayStart: 2,
      displayEnd: 8,
      displayText: 'Target',
    }]);

    store.removePath(filePath);

    expect(store.getMetadata(filePath, 100, 12)).toBeNull();
    expect(store.getLinkHits(filePath)).toEqual([]);
    store.close();
  });

  it('removes metadata and link hits for multiple document paths', () => {
    const dir = makeTempDir();
    const store = new LibraryIndexStore(path.join(dir, 'library-index.db'));
    const firstPath = path.join(dir, 'first.md');
    const secondPath = path.join(dir, 'second.md');

    store.setMetadata(firstPath, 100, 12, { title: 'First' });
    store.setMetadata(secondPath, 100, 12, { title: 'Second' });
    for (const filePath of [firstPath, secondPath]) {
      store.replaceLinkHits(filePath, [{
        kind: 'wikilink',
        rawTarget: 'Target',
        href: null,
        start: 0,
        end: 10,
        displayStart: 2,
        displayEnd: 8,
        displayText: 'Target',
      }]);
    }

    store.removePaths([firstPath, secondPath]);

    expect(store.getMetadata(firstPath, 100, 12)).toBeNull();
    expect(store.getMetadata(secondPath, 100, 12)).toBeNull();
    expect(store.getLinkHits(firstPath)).toEqual([]);
    expect(store.getLinkHits(secondPath)).toEqual([]);
    store.close();
  });

  it('reads raw link hits for selected sources', () => {
    const dir = makeTempDir();
    const store = new LibraryIndexStore(path.join(dir, 'library-index.db'));
    const firstPath = path.join(dir, 'first.md');
    const secondPath = path.join(dir, 'second.md');

    store.replaceLinkHits(firstPath, [{
      kind: 'wikilink',
      rawTarget: 'Target',
      href: null,
      start: 10,
      end: 20,
      displayStart: 12,
      displayEnd: 18,
      displayText: 'Target',
    }]);
    store.replaceLinkHits(secondPath, [{
      kind: 'markdown-link',
      rawTarget: null,
      href: 'https://example.com',
      start: 0,
      end: 28,
      displayStart: 1,
      displayEnd: 8,
      displayText: 'example',
    }]);

    const db = getFakeDatabase(store);
    expect(store.getLinkHitsForSources([secondPath, firstPath])).toEqual([
      {
        sourcePath: firstPath,
        hit: {
          kind: 'wikilink',
          rawTarget: 'Target',
          href: null,
          start: 10,
          end: 20,
          displayStart: 12,
          displayEnd: 18,
          displayText: 'Target',
        },
      },
      {
        sourcePath: secondPath,
        hit: {
          kind: 'markdown-link',
          rawTarget: null,
          href: 'https://example.com',
          start: 0,
          end: 28,
          displayStart: 1,
          displayEnd: 8,
          displayText: 'example',
        },
      },
    ]);
    expect(db.sourceBatchQueryCount).toBe(1);
    store.close();
  });

  it('finds backlink candidate rows by raw wikilink target', () => {
    const dir = makeTempDir();
    const store = new LibraryIndexStore(path.join(dir, 'library-index.db'));
    const sourcePath = path.join(dir, 'source.md');
    const otherPath = path.join(dir, 'other.md');

    store.replaceLinkHits(sourcePath, [
      {
        kind: 'wikilink',
        rawTarget: ' target ',
        href: null,
        start: 0,
        end: 10,
        displayStart: 2,
        displayEnd: 8,
        displayText: 'target',
      },
      {
        kind: 'markdown-link',
        rawTarget: null,
        href: 'Target',
        start: 20,
        end: 30,
        displayStart: 21,
        displayEnd: 27,
        displayText: 'Target',
      },
    ]);
    store.replaceLinkHits(otherPath, [{
      kind: 'wikilink',
      rawTarget: 'Other',
      href: null,
      start: 0,
      end: 9,
      displayStart: 2,
      displayEnd: 7,
      displayText: 'Other',
    }]);

    expect(store.findWikiLinkHitsByRawTarget('Target')).toEqual([{
      sourcePath,
      hit: {
        kind: 'wikilink',
        rawTarget: ' target ',
        href: null,
        start: 0,
        end: 10,
        displayStart: 2,
        displayEnd: 8,
        displayText: 'target',
      },
    }]);
    store.close();
  });

  it('finds external link rows by href', () => {
    const dir = makeTempDir();
    const store = new LibraryIndexStore(path.join(dir, 'library-index.db'));
    const sourcePath = path.join(dir, 'source.md');
    const otherPath = path.join(dir, 'other.md');

    store.replaceLinkHits(sourcePath, [
      {
        kind: 'markdown-link',
        rawTarget: null,
        href: 'https://example.com',
        start: 0,
        end: 28,
        displayStart: 1,
        displayEnd: 8,
        displayText: 'example',
      },
      {
        kind: 'wikilink',
        rawTarget: 'https://example.com',
        href: null,
        start: 30,
        end: 53,
        displayStart: 32,
        displayEnd: 51,
        displayText: 'https://example.com',
      },
    ]);
    store.replaceLinkHits(otherPath, [{
      kind: 'bare-url',
      rawTarget: null,
      href: 'https://example.com',
      start: 0,
      end: 19,
      displayStart: 0,
      displayEnd: 19,
      displayText: 'https://example.com',
    }]);

    expect(store.findLinkHitsByHref('https://example.com')).toEqual([
      {
        sourcePath: otherPath,
        hit: {
          kind: 'bare-url',
          rawTarget: null,
          href: 'https://example.com',
          start: 0,
          end: 19,
          displayStart: 0,
          displayEnd: 19,
          displayText: 'https://example.com',
        },
      },
      {
        sourcePath,
        hit: {
          kind: 'markdown-link',
          rawTarget: null,
          href: 'https://example.com',
          start: 0,
          end: 28,
          displayStart: 1,
          displayEnd: 8,
          displayText: 'example',
        },
      },
    ]);
    store.close();
  });
});
