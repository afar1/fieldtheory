import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaggedDocsManager, discoverTaggedDocsSyncRoots, parseFrontmatter, scanRoots } from './taggedDocsManager';

vi.mock('./logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock('better-sqlite3', () => {
  interface Row {
    ulid: string;
    path: string;
    title: string;
    tagged_by: string | null;
    tagged_at: number | null;
    frontmatter_updated_at: number;
    file_hash: string;
    read_at: number | null;
    last_read_hash: string | null;
    unread_sort: number;
  }

  class Statement {
    constructor(private db: FakeDatabase, private sql: string) {}

    all(): any[] {
      if (/scanned_files/.test(this.sql)) {
        return Array.from(this.db.scanned.values());
      }
      return Array.from(this.db.rows.values())
        .sort((a, b) => {
          if (b.unread_sort !== a.unread_sort) return b.unread_sort - a.unread_sort;
          if (b.frontmatter_updated_at !== a.frontmatter_updated_at) {
            return b.frontmatter_updated_at - a.frontmatter_updated_at;
          }
          return a.title.localeCompare(b.title);
        })
        .map(({ unread_sort: _unreadSort, ...row }) => row as Row);
    }

    get(key: string): any {
      if (/scanned_files/.test(this.sql)) {
        return this.db.scanned.get(key);
      }
      const row = this.db.rows.get(key.toUpperCase());
      if (!row) return undefined;
      if (/SELECT file_hash FROM tagged_docs/.test(this.sql)) {
        return { file_hash: row.file_hash };
      }
      const { unread_sort: _unreadSort, ...withoutSort } = row;
      return withoutSort as Row;
    }

    run(...args: unknown[]): { changes: number } {
      if (/INSERT INTO scanned_files/.test(this.sql)) {
        const [path, mtimeMs, size] = args as [string, number, number];
        this.db.scanned.set(path, { path, mtime_ms: mtimeMs, size });
        return { changes: 1 };
      }

      if (/DELETE FROM scanned_files WHERE path = \?/.test(this.sql)) {
        const [path] = args as [string];
        return { changes: this.db.scanned.delete(path) ? 1 : 0 };
      }

      if (/INSERT INTO tagged_docs/.test(this.sql)) {
        const [ulid, filePath, title, taggedBy, taggedAt, frontmatterUpdatedAt, fileHash] = args as [
          string,
          string,
          string,
          string | null,
          number | null,
          number,
          string,
        ];
        this.db.rows.set(ulid.toUpperCase(), {
          ulid: ulid.toUpperCase(),
          path: filePath,
          title,
          tagged_by: taggedBy,
          tagged_at: taggedAt,
          frontmatter_updated_at: frontmatterUpdatedAt,
          file_hash: fileHash,
          read_at: null,
          last_read_hash: null,
          unread_sort: 1,
        });
        return { changes: 1 };
      }

      if (/UPDATE tagged_docs SET read_at = \?, last_read_hash = \?, unread_sort = 0 WHERE ulid = \?/.test(this.sql)) {
        const [readAt, lastReadHash, ulid] = args as [number, string, string];
        const row = this.db.rows.get(ulid.toUpperCase());
        if (!row) return { changes: 0 };
        row.read_at = readAt;
        row.last_read_hash = lastReadHash;
        row.unread_sort = 0;
        return { changes: 1 };
      }

      if (/UPDATE tagged_docs SET read_at = \?, last_read_hash = file_hash, unread_sort = 0/.test(this.sql)) {
        const [readAt] = args as [number];
        for (const row of this.db.rows.values()) {
          row.read_at = readAt;
          row.last_read_hash = row.file_hash;
          row.unread_sort = 0;
        }
        return { changes: this.db.rows.size };
      }

      if (/UPDATE tagged_docs\s+SET path = \?/.test(this.sql)) {
        const [
          filePath,
          title,
          taggedBy,
          taggedAt,
          frontmatterUpdatedAt,
          fileHash,
          unreadHash,
          ulid,
        ] = args as [string, string, string | null, number | null, number, string, string, string];
        const row = this.db.rows.get(ulid.toUpperCase());
        if (!row) return { changes: 0 };
        row.path = filePath;
        row.title = title;
        row.tagged_by = taggedBy;
        row.tagged_at = taggedAt;
        row.frontmatter_updated_at = frontmatterUpdatedAt;
        row.file_hash = fileHash;
        row.unread_sort = row.read_at === null || row.last_read_hash !== unreadHash ? 1 : 0;
        return { changes: 1 };
      }

      if (/DELETE FROM tagged_docs WHERE path = \?/.test(this.sql)) {
        const [filePath] = args as [string];
        let changes = 0;
        for (const [ulid, row] of this.db.rows.entries()) {
          if (row.path === filePath) {
            this.db.rows.delete(ulid);
            changes += 1;
          }
        }
        return { changes };
      }

      return { changes: 0 };
    }
  }

  class FakeDatabase {
    rows = new Map<string, Row>();
    scanned = new Map<string, { path: string; mtime_ms: number; size: number }>();
    pragma(): void {}
    exec(): void {}
    close(): void {}
    prepare(sql: string): Statement {
      return new Statement(this, sql);
    }
    // better-sqlite3 transactions are synchronous; a pass-through is faithful for tests.
    transaction<T extends (...args: unknown[]) => unknown>(fn: T): T {
      return ((...args: unknown[]) => fn(...args)) as T;
    }
  }

  return {
    default: FakeDatabase,
  };
});

const userEmail = 'reader@example.com';
const firstUlid = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const secondUlid = '01BRZ3NDEKTSV4RRFFQ69G5FAV';

function doc(frontmatter: string, body = '# Shared Note\n\nBody'): string {
  return `---\n${frontmatter.trim()}\n---\n${body}\n`;
}

describe('parseFrontmatter', () => {
  it('parses frontmatter arrays and simple objects', () => {
    const parsed = parseFrontmatter(doc(`
ulid: ${firstUlid}
to:
  - Reader <reader@example.com>
  - email: teammate@example.com
    name: Teammate
cc: [{ email: other@example.com }]
tagged_by:
  email: sender@example.com
  name: Sender
`));

    expect(parsed?.data.ulid).toBe(firstUlid);
    expect(parsed?.data.to).toEqual([
      'Reader <reader@example.com>',
      { email: 'teammate@example.com', name: 'Teammate' },
    ]);
    expect(parsed?.data.cc).toEqual([{ email: 'other@example.com' }]);
    expect(parsed?.data.tagged_by).toEqual({ email: 'sender@example.com', name: 'Sender' });
  });

  it('returns null for malformed frontmatter instead of throwing', () => {
    // A scan reads thousands of files; the parser must skip bad input gracefully,
    // not throw (and not log) per file.
    expect(parseFrontmatter(doc(`
ulid: ${firstUlid}
not valid yaml
`))).toBeNull();
    // Opens with --- but never closes the block.
    expect(parseFrontmatter('---\nulid: x\nno closing delimiter\n')).toBeNull();
  });
});

describe('scanRoots (pure scan core, runs in the worker)', () => {
  it('reads+parses on a cold ledger and skips unchanged files on a warm one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-scanroots-'));
    const file = path.join(dir, 'note.md');
    fs.writeFileSync(file, doc(`
ulid: ${firstUlid}
title: Scanned
to: [Reader <${userEmail}>]
frontmatter_updated_at: 2026-04-20T12:05:00Z
`));
    try {
      const cold = await scanRoots({ roots: [dir], email: userEmail, ledger: new Map() });
      expect(cold.read).toBe(1);
      expect(cold.seenPaths).toContain(file);
      expect(cold.results).toHaveLength(1);
      expect(cold.results[0].parsed?.title).toBe('Scanned');
      expect(cold.results[0].parsed?.taggedForCurrentEmail).toBe(true);

      const st = fs.statSync(file);
      const ledger = new Map([[file, { mtimeMs: Math.floor(st.mtimeMs), size: st.size }]]);
      const warm = await scanRoots({ roots: [dir], email: userEmail, ledger });
      expect(warm.read).toBe(0); // stat-gated: no re-read
      expect(warm.results).toHaveLength(0);
      expect(warm.seenPaths).toContain(file); // still seen, for vanished detection
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('TaggedDocsManager', () => {
  let tempDir: string;
  let rootDir: string;
  let manager: TaggedDocsManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldtheory-tagged-docs-'));
    rootDir = path.join(tempDir, 'CloudStorage', 'GoogleDrive-test');
    fs.mkdirSync(rootDir, { recursive: true });
    manager = new TaggedDocsManager({
      dbPath: path.join(tempDir, 'tagged.db'),
      roots: [rootDir],
      watch: false,
    });
  });

  afterEach(() => {
    manager.destroy();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('discovers existing CloudStorage sync roots', () => {
    const homeDir = path.join(tempDir, 'home');
    const cloudRoot = path.join(homeDir, 'Library', 'CloudStorage', 'Dropbox');
    const googleRoot = path.join(homeDir, 'Google Drive');
    fs.mkdirSync(cloudRoot, { recursive: true });
    fs.mkdirSync(googleRoot, { recursive: true });

    expect(discoverTaggedDocsSyncRoots(homeDir)).toEqual([
      googleRoot,
      cloudRoot,
    ]);
  });

  it('scans nothing by default and only picks up directories added via setRoots', async () => {
    const target = path.join(rootDir, 'scoped.md');
    fs.writeFileSync(target, doc(`
ulid: ${firstUlid}
title: Scoped Doc
to: [Reader <${userEmail}>]
tagged_by: sender@example.com
tagged_at: 2026-04-20T12:00:00Z
frontmatter_updated_at: 2026-04-20T12:05:00Z
`));

    // No roots by default — must not auto-discover/scan whole cloud-storage trees.
    const scoped = new TaggedDocsManager({
      dbPath: path.join(tempDir, 'scoped.db'),
      watch: false,
    });
    try {
      scoped.setIdentity(userEmail);
      await scoped.rescan();
      expect(scoped.list()).toHaveLength(0);

      // User adds the directory to their library → its existing tagged docs appear.
      scoped.setRoots([rootDir]);
      await scoped.rescan();
      expect(scoped.list().map((d) => d.title)).toEqual(['Scoped Doc']);
    } finally {
      scoped.destroy();
    }
  });

  it('does zero file reads on a rescan when nothing changed (stat-gate)', async () => {
    const target = path.join(rootDir, 'note.md');
    fs.writeFileSync(target, doc(`
ulid: ${firstUlid}
title: Tagged
to: [Reader <${userEmail}>]
frontmatter_updated_at: 2026-04-20T12:05:00Z
`));
    manager.setIdentity(userEmail);
    await manager.rescan(); // first pass populates the scanned_files ledger
    expect(manager.list()).toHaveLength(1);

    const readSpy = vi.spyOn(fs.promises, 'readFile');
    try {
      await manager.rescan(); // nothing changed on disk
      expect(readSpy).not.toHaveBeenCalled(); // the whole point: no re-reading
      expect(manager.list()).toHaveLength(1); // and the indexed doc is unchanged
    } finally {
      readSpy.mockRestore();
    }
  });

  it('re-reads only files whose mtime/size changed', async () => {
    const target = path.join(rootDir, 'note.md');
    const stable = path.join(rootDir, 'stable.md');
    fs.writeFileSync(target, doc(`
ulid: ${firstUlid}
title: First Title
to: [Reader <${userEmail}>]
frontmatter_updated_at: 2026-04-20T12:05:00Z
`));
    fs.writeFileSync(stable, doc(`
ulid: ${secondUlid}
title: Stable
to: [Reader <${userEmail}>]
frontmatter_updated_at: 2026-04-20T12:05:00Z
`));
    manager.setIdentity(userEmail);
    await manager.rescan();

    fs.writeFileSync(target, doc(`
ulid: ${firstUlid}
title: A Much Longer Second Title
to: [Reader <${userEmail}>]
frontmatter_updated_at: 2026-04-21T12:05:00Z
`));

    const readSpy = vi.spyOn(fs.promises, 'readFile');
    try {
      await manager.rescan();
      expect(readSpy).toHaveBeenCalledTimes(1); // only the changed file
      expect(readSpy).toHaveBeenCalledWith(target, 'utf-8');
    } finally {
      readSpy.mockRestore();
    }
    expect(manager.list().find((d) => d.ulid === firstUlid)?.title).toBe('A Much Longer Second Title');
  });

  it('removes the indexed doc when its file vanishes', async () => {
    const target = path.join(rootDir, 'note.md');
    fs.writeFileSync(target, doc(`
ulid: ${firstUlid}
title: Tagged
to: [Reader <${userEmail}>]
frontmatter_updated_at: 2026-04-20T12:05:00Z
`));
    manager.setIdentity(userEmail);
    await manager.rescan();
    expect(manager.list()).toHaveLength(1);

    fs.rmSync(target);
    await manager.rescan();
    expect(manager.list()).toHaveLength(0);
  });

  it('lists tagged markdown for the current email only', async () => {
    const target = path.join(rootDir, 'target.md');
    const other = path.join(rootDir, 'other.md');
    fs.writeFileSync(target, doc(`
ulid: ${firstUlid}
title: Tagged for Me
to: [Reader <${userEmail}>]
cc:
  - email: teammate@example.com
tagged_by: sender@example.com
tagged_at: 2026-04-20T12:00:00Z
frontmatter_updated_at: 2026-04-20T12:05:00Z
`));
    fs.writeFileSync(other, doc(`
ulid: ${secondUlid}
title: Not Mine
to: [someone@example.com]
frontmatter_updated_at: 2026-04-20T12:06:00Z
`));

    manager.setIdentity(userEmail);
    await manager.rescan();

    const docs = manager.list();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      ulid: firstUlid,
      title: 'Tagged for Me',
      taggedBy: 'sender@example.com',
      unread: true,
      readAt: null,
    });
  });

  it('parses ft share frontmatter shape', async () => {
    const filePath = path.join(rootDir, 'share.md');
    fs.writeFileSync(filePath, doc(`
id: ${firstUlid}
title: Launch Note
from: sender@example.com
to:
  - ${userEmail}
created_at: 2026-04-20T12:00:00Z
updated_at: 2026-04-20T12:05:00Z
`));

    manager.setIdentity(userEmail);
    await manager.rescan();

    const docs = manager.list();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      ulid: firstUlid,
      title: 'Launch Note',
      taggedBy: 'sender@example.com',
      taggedAt: Date.parse('2026-04-20T12:00:00Z'),
      frontmatterUpdatedAt: Date.parse('2026-04-20T12:05:00Z'),
    });
  });

  it('deduplicates by ulid and keeps the newer frontmatter update', async () => {
    const olderPath = path.join(rootDir, 'older.md');
    const newerPath = path.join(rootDir, 'folder', 'newer.md');
    fs.mkdirSync(path.dirname(newerPath), { recursive: true });
    fs.writeFileSync(olderPath, doc(`
ulid: ${firstUlid}
title: Older Copy
to: [${userEmail}]
frontmatter_updated_at: 2026-04-20T12:00:00Z
`));
    fs.writeFileSync(newerPath, doc(`
ulid: ${firstUlid}
title: Newer Copy
to:
  - email: ${userEmail}
frontmatter_updated_at: 2026-04-20T12:10:00Z
`));

    manager.setIdentity(userEmail);
    await manager.rescan();

    const docs = manager.list();
    expect(docs).toHaveLength(1);
    expect(docs[0].title).toBe('Newer Copy');
    expect(docs[0].path).toBe(newerPath);
  });

  it('marks read and returns to unread when the file hash changes', async () => {
    const filePath = path.join(rootDir, 'read-state.md');
    fs.writeFileSync(filePath, doc(`
ulid: ${firstUlid}
to: [${userEmail}]
frontmatter_updated_at: 2026-04-20T12:00:00Z
`, '# First Title\n\nOriginal body'));

    manager.setIdentity(userEmail);
    await manager.rescan();
    const read = manager.markRead(firstUlid);
    expect(read?.unread).toBe(false);
    expect(manager.list()[0].unread).toBe(false);

    fs.writeFileSync(filePath, doc(`
ulid: ${firstUlid}
to: [${userEmail}]
frontmatter_updated_at: 2026-04-20T12:00:00Z
`, '# First Title\n\nChanged body'));
    await manager.processMarkdownFile(filePath);

    const [updated] = manager.list();
    expect(updated.unread).toBe(true);
    expect(updated.lastReadHash).not.toBe(updated.fileHash);
  });

  it('removes a stored doc when frontmatter no longer tags the current email', async () => {
    const filePath = path.join(rootDir, 'removed.md');
    fs.writeFileSync(filePath, doc(`
ulid: ${firstUlid}
to: [${userEmail}]
frontmatter_updated_at: 2026-04-20T12:00:00Z
`));

    manager.setIdentity(userEmail);
    await manager.rescan();
    expect(manager.list()).toHaveLength(1);

    fs.writeFileSync(filePath, doc(`
ulid: ${firstUlid}
to: [someone@example.com]
frontmatter_updated_at: 2026-04-20T12:01:00Z
`));
    await manager.processMarkdownFile(filePath);

    expect(manager.list()).toEqual([]);
  });
});
