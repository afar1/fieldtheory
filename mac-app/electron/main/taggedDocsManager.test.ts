import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaggedDocsManager, discoverTaggedDocsSyncRoots, parseFrontmatter } from './taggedDocsManager';

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

    all(): Row[] {
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

    get(ulid: string): Row | { file_hash: string } | undefined {
      const row = this.db.rows.get(ulid.toUpperCase());
      if (!row) return undefined;
      if (/SELECT file_hash FROM tagged_docs/.test(this.sql)) {
        return { file_hash: row.file_hash };
      }
      const { unread_sort: _unreadSort, ...withoutSort } = row;
      return withoutSort as Row;
    }

    run(...args: unknown[]): { changes: number } {
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
    pragma(): void {}
    exec(): void {}
    close(): void {}
    prepare(sql: string): Statement {
      return new Statement(this, sql);
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

  it('throws for malformed frontmatter', () => {
    expect(() => parseFrontmatter(doc(`
ulid: ${firstUlid}
not valid yaml
`))).toThrow(/Invalid frontmatter line/);
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
