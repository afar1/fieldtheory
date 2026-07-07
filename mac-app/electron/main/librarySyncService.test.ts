import fs from 'fs';
import os from 'os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
import {
  clientIdForLibrarySourcePath,
  deduplicateLocalLibraryDocuments,
  getLibrarySyncSourceRoots,
  getLibrarySyncTargetForSourcePath,
  getRowsToTombstoneForMissingLocalDocs,
  LibrarySyncService,
  normalizeLibrarySourcePath,
  reconcilePendingTombstonesForMissingKnownDocs,
  shouldSkipPrivateLibrarySyncPath,
  sourcePathForLibrarySyncSourceRoot,
  type LibraryDocumentRow,
  type LibrarySyncKnownDocument,
  type LibrarySyncPendingTombstone,
  type LocalLibraryDocument,
} from './librarySyncService';
import { fieldTheoryDir, libraryDir } from './fieldTheoryPaths';

function remoteRow(overrides: Partial<LibraryDocumentRow> = {}): LibraryDocumentRow {
  return {
    id: 'row-1',
    user_id: 'user-1',
    title: 'Today',
    content: '# Today\n',
    tags: [],
    source_path: 'scratchpad/today.md',
    source_kind: 'laptop',
    content_hash: 'remote-hash',
    client_id: 'client-1',
    client_created_at_ms: 1,
    deleted_at: null,
    created_at: '2026-05-01T10:00:00.000Z',
    updated_at: '2026-05-01T10:00:00.000Z',
    ...overrides,
  };
}

function localDocument(overrides: Partial<LocalLibraryDocument> = {}): LocalLibraryDocument {
  return {
    clientId: 'client-1',
    sourcePath: 'scratchpad/today.md',
    title: 'Today',
    content: '# Today\n',
    contentHash: 'remote-hash',
    createdAtMs: 1,
    updatedAtMs: Date.parse('2026-05-01T10:00:00.000Z'),
    ...overrides,
  };
}

function knownDocument(overrides: Partial<LibrarySyncKnownDocument> = {}): LibrarySyncKnownDocument {
  return {
    clientId: 'client-1',
    sourcePath: 'scratchpad/today.md',
    contentHash: 'remote-hash',
    remoteUpdatedAtMs: Date.parse('2026-05-01T10:00:00.000Z'),
    seenAtMs: Date.parse('2026-05-01T10:00:00.000Z'),
    ...overrides,
  };
}

function pendingTombstone(overrides: Partial<LibrarySyncPendingTombstone> = {}): LibrarySyncPendingTombstone {
  return {
    clientId: 'client-1',
    sourcePath: 'scratchpad/today.md',
    contentHash: 'remote-hash',
    remoteUpdatedAtMs: Date.parse('2026-05-01T10:00:00.000Z'),
    deletedAtMs: Date.parse('2026-05-01T10:05:00.000Z'),
    ...overrides,
  };
}

describe('librarySyncService path helpers', () => {
  it('normalizes remote source paths to markdown paths', () => {
    expect(normalizeLibrarySourcePath('scratchpad/today', 'Today')).toBe('scratchpad/today.md');
    expect(normalizeLibrarySourcePath('entries/note.md', 'Note')).toBe('entries/note.md');
    expect(normalizeLibrarySourcePath(null, 'Quick Note')).toBe('scratchpad/Quick Note.md');
  });

  it('rejects path traversal segments', () => {
    expect(normalizeLibrarySourcePath('../secrets.md', 'Secrets')).toBeNull();
    expect(normalizeLibrarySourcePath('scratchpad/../secrets.md', 'Secrets')).toBeNull();
    expect(normalizeLibrarySourcePath('/Users/afar/secrets.md', 'Secrets')).toBeNull();
  });

  it('generates stable client ids from source paths', () => {
    expect(clientIdForLibrarySourcePath('scratchpad/today.md')).toBe(clientIdForLibrarySourcePath('scratchpad/today.md'));
    expect(clientIdForLibrarySourcePath('scratchpad/today.md')).not.toBe(clientIdForLibrarySourcePath('entries/today.md'));
  });

  it('syncs both the library directory and central artifacts directory', () => {
    expect(getLibrarySyncSourceRoots()).toEqual([
      { dirPath: libraryDir(), sourcePrefix: '' },
      { dirPath: path.join(fieldTheoryDir(), 'librarian', 'artifacts'), sourcePrefix: 'artifacts' },
    ]);
  });

  it('routes artifacts paths to the central artifacts directory', () => {
    expect(getLibrarySyncTargetForSourcePath('artifacts/README.md')).toEqual({
      rootDir: path.join(fieldTheoryDir(), 'librarian', 'artifacts'),
      relPath: 'README.md',
    });
    expect(getLibrarySyncTargetForSourcePath('library/artifacts/README.md')).toEqual({
      rootDir: libraryDir(),
      relPath: 'artifacts/README.md',
    });
    expect(getLibrarySyncTargetForSourcePath('scratchpad/today.md')).toEqual({
      rootDir: libraryDir(),
      relPath: 'scratchpad/today.md',
    });
  });

  it('keeps user-created library artifacts paths distinct from central artifacts', () => {
    expect(sourcePathForLibrarySyncSourceRoot(
      { dirPath: libraryDir(), sourcePrefix: '' },
      'artifacts/README.md',
    )).toBe('library/artifacts/README.md');
    expect(sourcePathForLibrarySyncSourceRoot(
      { dirPath: path.join(fieldTheoryDir(), 'librarian', 'artifacts'), sourcePrefix: 'artifacts' },
      'README.md',
    )).toBe('artifacts/README.md');
  });

  it('excludes River shared cache files from private library sync', () => {
    expect(shouldSkipPrivateLibrarySyncPath(path.join(libraryDir(), 'River (shared)', 'Plan AF.md'))).toBe(true);
    expect(shouldSkipPrivateLibrarySyncPath(path.join(libraryDir(), 'scratchpad', 'Plan.md'))).toBe(false);
  });

  it('deduplicates local documents by client id and keeps the newer copy', () => {
    const older = localDocument({
      title: 'Older',
      contentHash: 'older-hash',
      updatedAtMs: Date.parse('2026-05-01T09:00:00.000Z'),
    });
    const newer = localDocument({
      title: 'Newer',
      contentHash: 'newer-hash',
      updatedAtMs: Date.parse('2026-05-01T10:00:00.000Z'),
    });

    expect(deduplicateLocalLibraryDocuments([older, newer])).toEqual([newer]);
  });
});

describe('librarySyncService tombstone detection', () => {
  it('does not tombstone remote rows this device has never seen', () => {
    expect(getRowsToTombstoneForMissingLocalDocs([remoteRow()], [], {})).toEqual([]);
  });

  it('does not tombstone rows that are already remotely deleted', () => {
    expect(getRowsToTombstoneForMissingLocalDocs(
      [remoteRow({ deleted_at: '2026-05-01T10:00:30.000Z' })],
      [],
      { 'client-1': knownDocument() },
    )).toEqual([]);
  });

  it('tombstones a previously seen remote row when the local file disappears', () => {
    const row = remoteRow();
    expect(getRowsToTombstoneForMissingLocalDocs(
      [row],
      [],
      { 'client-1': knownDocument() },
    )).toEqual([row]);
  });

  it('keeps a row active when the local file still exists', () => {
    expect(getRowsToTombstoneForMissingLocalDocs(
      [remoteRow()],
      [localDocument()],
      { 'client-1': knownDocument() },
    )).toEqual([]);
  });

  it('does not tombstone when the remote row changed after this device last saw it', () => {
    expect(getRowsToTombstoneForMissingLocalDocs(
      [remoteRow({ updated_at: '2026-05-01T10:01:01.000Z' })],
      [],
      { 'client-1': knownDocument() },
    )).toEqual([]);
  });
});

describe('librarySyncService pending tombstones', () => {
  it('records a durable tombstone when a known local doc disappears before network sync', () => {
    expect(reconcilePendingTombstonesForMissingKnownDocs(
      [],
      { 'client-1': knownDocument() },
      {},
      Date.parse('2026-05-01T10:05:00.000Z'),
    )).toEqual({
      'client-1': pendingTombstone(),
    });
  });

  it('does not record a tombstone for a document that still exists locally by source path', () => {
    expect(reconcilePendingTombstonesForMissingKnownDocs(
      [localDocument({ clientId: 'different-client-id' })],
      { 'client-1': knownDocument() },
      {},
      Date.parse('2026-05-01T10:05:00.000Z'),
    )).toEqual({});
  });

  it('clears a pending tombstone when the same document reappears locally', () => {
    expect(reconcilePendingTombstonesForMissingKnownDocs(
      [localDocument()],
      { 'client-1': knownDocument() },
      { 'client-1': pendingTombstone() },
      Date.parse('2026-05-01T10:06:00.000Z'),
    )).toEqual({});
  });
});

describe('LibrarySyncService selected document publish', () => {
  let tempRoot: string;
  let originalLibraryDir: string | undefined;
  let originalSharedRootDir: string | undefined;
  let originalSharedCacheDir: string | undefined;
  let homedirSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldtheory-library-sync-service-'));
    originalLibraryDir = process.env.FT_LIBRARY_DIR;
    originalSharedRootDir = process.env.FT_SHARED_FILES_ROOT_DIR;
    originalSharedCacheDir = process.env.FT_SHARED_FILES_CACHE_DIR;
    process.env.FT_LIBRARY_DIR = path.join(tempRoot, 'library');
    process.env.FT_SHARED_FILES_ROOT_DIR = path.join(tempRoot, 'shared');
    process.env.FT_SHARED_FILES_CACHE_DIR = path.join(tempRoot, 'library', 'River (shared)');
    fs.mkdirSync(process.env.FT_LIBRARY_DIR, { recursive: true });
    homedirSpy = vi.spyOn(os, 'homedir').mockReturnValue(path.join(tempRoot, 'home'));
  });

  afterEach(() => {
    if (originalLibraryDir === undefined) delete process.env.FT_LIBRARY_DIR;
    else process.env.FT_LIBRARY_DIR = originalLibraryDir;
    if (originalSharedRootDir === undefined) delete process.env.FT_SHARED_FILES_ROOT_DIR;
    else process.env.FT_SHARED_FILES_ROOT_DIR = originalSharedRootDir;
    if (originalSharedCacheDir === undefined) delete process.env.FT_SHARED_FILES_CACHE_DIR;
    else process.env.FT_SHARED_FILES_CACHE_DIR = originalSharedCacheDir;
    homedirSpy.mockRestore();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  function createAuthMock(options: {
    authenticated?: boolean;
    rows?: LibraryDocumentRow[];
    userId?: string;
  } = {}) {
    const userId = options.userId ?? 'user-1';
    const store = {
      rows: [...(options.rows ?? [])],
      upserts: [] as Record<string, unknown>[],
    };
    const table = {
      select: vi.fn(() => ({
        eq: vi.fn(async () => ({ data: store.rows, error: null })),
      })),
      upsert: vi.fn(async (rows: Record<string, unknown>[]) => {
        store.upserts.push(...rows);
        rows.forEach((row) => {
          const clientId = row.client_id as string;
          const existingIndex = store.rows.findIndex((item) => item.client_id === clientId);
          const next = remoteRow({
            id: existingIndex === -1 ? `row-${store.rows.length + 1}` : store.rows[existingIndex].id,
            user_id: row.user_id as string,
            title: row.title as string,
            content: row.content as string,
            tags: row.tags as string[],
            source_path: row.source_path as string,
            source_kind: row.source_kind as string,
            content_hash: row.content_hash as string,
            client_id: clientId,
            client_created_at_ms: row.client_created_at_ms as number,
            deleted_at: row.deleted_at as string | null,
            created_at: existingIndex === -1 ? '2026-05-01T10:00:00.000Z' : store.rows[existingIndex].created_at,
            updated_at: '2026-05-01T10:05:00.000Z',
          });
          if (existingIndex === -1) store.rows.push(next);
          else store.rows[existingIndex] = next;
        });
        return { error: null };
      }),
    };
    const supabase = {
      from: vi.fn(() => table),
    };
    const session = options.authenticated === false ? null : { user: { id: userId } };
    const auth = {
      on: vi.fn(),
      off: vi.fn(),
      isAuthenticated: vi.fn(() => Boolean(session)),
      getSession: vi.fn(() => session),
      getSupabaseClient: vi.fn(() => session ? supabase : null),
    };
    return { auth, store, table };
  }

  it('reports not_authenticated when selected document publish has no usable session', async () => {
    const { auth } = createAuthMock({ authenticated: false });
    const service = new LibrarySyncService(auth as any);

    try {
      await expect(service.publishLocalDocument('/tmp/Brief.md')).resolves.toMatchObject({
        success: false,
        reason: 'not_authenticated',
        error: 'Not authenticated',
      });
    } finally {
      service.dispose();
    }
  });

  it('counts pending local docs and uploads a selected Library markdown document', async () => {
    const briefPath = path.join(process.env.FT_LIBRARY_DIR!, 'briefs', 'Agent Brief.md');
    fs.mkdirSync(path.dirname(briefPath), { recursive: true });
    fs.writeFileSync(briefPath, '# Agent Brief\n\nCreated by Codex.\n');
    const { auth, store } = createAuthMock();
    const service = new LibrarySyncService(auth as any);

    try {
      await expect(service.getStatusDetails()).resolves.toMatchObject({
        ready: true,
        reason: 'enabled',
        pendingLocalDocumentCount: 1,
      });

      const result = await service.publishLocalDocument(briefPath);

      expect(result).toMatchObject({
        success: true,
        reason: 'published',
        uploaded: 1,
        updated: 0,
        sourcePath: 'briefs/Agent Brief.md',
        title: 'Agent Brief',
      });
      expect(result.lastPushAt).toEqual(expect.any(Number));
      expect(store.upserts).toHaveLength(1);
      expect(store.upserts[0]).toMatchObject({
        user_id: 'user-1',
        title: 'Agent Brief',
        content: '# Agent Brief\n\nCreated by Codex.\n',
        source_path: 'briefs/Agent Brief.md',
        source_kind: 'laptop',
        client_id: clientIdForLibrarySourcePath('briefs/Agent Brief.md'),
        deleted_at: null,
      });
      await expect(service.getStatusDetails()).resolves.toMatchObject({
        ready: true,
        reason: 'enabled',
        pendingLocalDocumentCount: 0,
      });
    } finally {
      service.dispose();
    }
  });
});
