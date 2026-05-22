import { describe, expect, it } from 'vitest';
import path from 'path';
import {
  clientIdForLibrarySourcePath,
  deduplicateLocalLibraryDocuments,
  getLibrarySyncSourceRoots,
  getLibrarySyncTargetForSourcePath,
  getRowsToTombstoneForMissingLocalDocs,
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
