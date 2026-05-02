/**
 * LibrarySyncService - Syncs the Mac markdown library with Supabase.
 *
 * Local deletes become contentless tombstones. The local Trash is the recovery
 * surface; Supabase keeps only enough metadata to prevent deleted files from
 * being recreated on the next sync.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { AuthManager } from './authManager';
import { fieldTheoryDir, libraryDir } from './fieldTheoryPaths';
import { createLogger } from './logger';

const log = createLogger('LibrarySync');

const DEBOUNCE_MS = 1500;
const MIN_SYNC_INTERVAL_MS = 5000;
const POLL_INTERVAL_MS = 90_000;
const CLOCK_SKEW_MS = 1000;
const LIBRARY_SYNC_STATE_SCHEMA_VERSION = 1;
const EMPTY_CONTENT_HASH = '';

export interface LibraryDocumentRow {
  id: string;
  user_id: string;
  title: string;
  content: string;
  tags: string[] | null;
  source_path: string | null;
  source_kind: string | null;
  content_hash: string | null;
  client_id: string;
  client_created_at_ms: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LocalLibraryDocument {
  clientId: string;
  sourcePath: string;
  title: string;
  content: string;
  contentHash: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface LibrarySyncSourceRoot {
  dirPath: string;
  sourcePrefix: string;
}

export interface LibrarySyncResult {
  success: boolean;
  uploaded: number;
  updated: number;
  downloaded: number;
  deleted: number;
  tombstoned: number;
  skipped: number;
  errors: string[];
}

export interface LibrarySyncKnownDocument {
  clientId: string;
  sourcePath: string;
  contentHash: string;
  remoteUpdatedAtMs: number;
  seenAtMs: number;
}

export interface LibrarySyncPendingTombstone {
  clientId: string;
  sourcePath: string;
  contentHash: string;
  remoteUpdatedAtMs: number;
  deletedAtMs: number;
}

interface LibrarySyncUserState {
  documents: Record<string, LibrarySyncKnownDocument>;
  pendingTombstones: Record<string, LibrarySyncPendingTombstone>;
}

interface LibrarySyncStateFile {
  schemaVersion: number;
  users: Record<string, LibrarySyncUserState>;
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeFileName(value: string): string {
  return (value.trim() || 'Untitled')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
}

export function normalizeLibrarySourcePath(sourcePath: string | null, title = 'Untitled'): string | null {
  const fallback = `scratchpad/${safeFileName(title)}.md`;
  const rawPath = (sourcePath?.trim() || fallback).replace(/\\/g, '/');
  if (rawPath.startsWith('/')) return null;

  const parts = rawPath.split('/').filter(Boolean);

  if (parts.length === 0) return fallback;
  if (parts.some((part) => part === '.' || part === '..')) return null;

  const lastIndex = parts.length - 1;
  if (!parts[lastIndex].toLowerCase().endsWith('.md')) {
    parts[lastIndex] = `${parts[lastIndex]}.md`;
  }

  return parts.join('/');
}

export function clientIdForLibrarySourcePath(sourcePath: string): string {
  return `library-${sha256(sourcePath).slice(0, 32)}`;
}

function parseMarkdownTitle(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

function isInsidePath(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function relativeMarkdownPath(rootDir: string, filePath: string): string | null {
  const relPath = path.relative(rootDir, filePath);
  if (!relPath || relPath.startsWith('..') || path.isAbsolute(relPath)) return null;
  return relPath.split(path.sep).join('/');
}

export function getLibrarySyncSourceRoots(): LibrarySyncSourceRoot[] {
  return [
    { dirPath: libraryDir(), sourcePrefix: '' },
    { dirPath: path.join(fieldTheoryDir(), 'librarian', 'artifacts'), sourcePrefix: 'artifacts' },
  ];
}

export function getLibrarySyncTargetForSourcePath(sourcePath: string): { rootDir: string; relPath: string } {
  const artifactsPrefix = 'artifacts/';
  const libraryPrefix = 'library/';
  if (sourcePath.startsWith(artifactsPrefix)) {
    return {
      rootDir: path.join(fieldTheoryDir(), 'librarian', 'artifacts'),
      relPath: sourcePath.slice(artifactsPrefix.length),
    };
  }
  if (sourcePath.startsWith(libraryPrefix)) {
    return { rootDir: libraryDir(), relPath: sourcePath.slice(libraryPrefix.length) };
  }

  return { rootDir: libraryDir(), relPath: sourcePath };
}

export function sourcePathForLibrarySyncSourceRoot(root: LibrarySyncSourceRoot, relPath: string): string {
  const sourcePath = prefixedSourcePath(root.sourcePrefix, relPath);
  if (root.sourcePrefix === '' && sourcePath.startsWith('artifacts/')) {
    return `library/${sourcePath}`;
  }
  return sourcePath;
}

export function deduplicateLocalLibraryDocuments(localDocs: LocalLibraryDocument[]): LocalLibraryDocument[] {
  const byClientId = new Map<string, LocalLibraryDocument>();

  for (const doc of localDocs) {
    const existing = byClientId.get(doc.clientId);
    if (!existing || doc.updatedAtMs >= existing.updatedAtMs) {
      byClientId.set(doc.clientId, doc);
    }
  }

  return [...byClientId.values()];
}

function prefixedSourcePath(prefix: string, relPath: string): string {
  return prefix ? `${prefix}/${relPath}` : relPath;
}

function walkMarkdownFiles(rootDir: string): string[] {
  const files: string[] = [];
  if (!fs.existsSync(rootDir)) return files;

  function walk(currentDir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const absPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(absPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        files.push(absPath);
      }
    }
  }

  walk(rootDir);
  return files.sort();
}

function remoteUpdatedAtMs(row: LibraryDocumentRow): number {
  const parsed = new Date(row.updated_at).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function remoteDeletedAtMs(row: LibraryDocumentRow): number {
  const parsed = row.deleted_at ? new Date(row.deleted_at).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowVersionUpdatedAtMs(row: LibraryDocumentRow): number {
  return Math.max(remoteUpdatedAtMs(row), remoteDeletedAtMs(row));
}

function rowContentHash(row: LibraryDocumentRow): string {
  return row.content_hash || sha256(row.content ?? '');
}

export function getRowsToTombstoneForMissingLocalDocs(
  remoteRows: LibraryDocumentRow[],
  localDocs: LocalLibraryDocument[],
  knownDocuments: Record<string, LibrarySyncKnownDocument>,
): LibraryDocumentRow[] {
  const localClientIds = new Set(localDocs.map((doc) => doc.clientId));
  const localSourcePaths = new Set(localDocs.map((doc) => doc.sourcePath));

  return remoteRows.filter((row) => {
    if (row.deleted_at) return false;
    const sourcePath = normalizeLibrarySourcePath(row.source_path, row.title);
    if (!sourcePath) return false;
    if (localClientIds.has(row.client_id) || localSourcePaths.has(sourcePath)) return false;

    const known = knownDocuments[row.client_id];
    if (!known || known.sourcePath !== sourcePath) return false;
    return rowVersionUpdatedAtMs(row) <= known.remoteUpdatedAtMs + CLOCK_SKEW_MS;
  });
}

export function reconcilePendingTombstonesForMissingKnownDocs(
  localDocs: LocalLibraryDocument[],
  knownDocuments: Record<string, LibrarySyncKnownDocument>,
  pendingTombstones: Record<string, LibrarySyncPendingTombstone> = {},
  deletedAtMs = Date.now(),
): Record<string, LibrarySyncPendingTombstone> {
  const localClientIds = new Set(localDocs.map((doc) => doc.clientId));
  const localSourcePaths = new Set(localDocs.map((doc) => doc.sourcePath));
  const next: Record<string, LibrarySyncPendingTombstone> = {};

  for (const tombstone of Object.values(pendingTombstones)) {
    if (localClientIds.has(tombstone.clientId) || localSourcePaths.has(tombstone.sourcePath)) continue;
    next[tombstone.clientId] = tombstone;
  }

  for (const known of Object.values(knownDocuments)) {
    if (localClientIds.has(known.clientId) || localSourcePaths.has(known.sourcePath)) continue;
    const existing = next[known.clientId];
    if (existing && existing.deletedAtMs >= deletedAtMs) continue;
    next[known.clientId] = {
      clientId: known.clientId,
      sourcePath: known.sourcePath,
      contentHash: known.contentHash,
      remoteUpdatedAtMs: known.remoteUpdatedAtMs,
      deletedAtMs,
    };
  }

  return next;
}

function localDocMatchesRow(doc: LocalLibraryDocument, row: LibraryDocumentRow, sourcePath: string): boolean {
  return doc.clientId === row.client_id || doc.sourcePath === sourcePath;
}

function moveFileToTrash(filePath: string): boolean {
  const trashDir = path.join(os.homedir(), '.Trash');
  const parsed = path.parse(filePath);
  fs.mkdirSync(trashDir, { recursive: true });

  let targetPath = path.join(trashDir, path.basename(filePath));
  if (fs.existsSync(targetPath)) {
    targetPath = path.join(trashDir, `${parsed.name} ${Date.now()}${parsed.ext}`);
  }

  fs.renameSync(filePath, targetPath);
  return true;
}

export class LibrarySyncService {
  private authManager: AuthManager;
  private isSyncing = false;
  private lastSyncAt: number | null = null;
  private pendingSyncTimeout: ReturnType<typeof setTimeout> | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private readonly handleSessionChanged = (session: unknown): void => {
    if (session) this.scheduleSync();
  };

  constructor(authManager: AuthManager) {
    this.authManager = authManager;

    this.authManager.on('sessionChanged', this.handleSessionChanged);

    if (this.authManager.isAuthenticated()) {
      this.scheduleSync();
    }

    this.pollInterval = setInterval(() => {
      if (!this.authManager.isAuthenticated()) return;
      this.syncIfNeeded().catch((error) => {
        log.warn('Periodic library sync failed:', error);
      });
    }, POLL_INTERVAL_MS);
  }

  isReady(): boolean {
    return this.authManager.isAuthenticated();
  }

  getLastSyncAt(): number | null {
    return this.lastSyncAt;
  }

  dispose(): void {
    if (this.pendingSyncTimeout) {
      clearTimeout(this.pendingSyncTimeout);
      this.pendingSyncTimeout = null;
    }
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.authManager.off('sessionChanged', this.handleSessionChanged);
  }

  scheduleSync(delayMs = DEBOUNCE_MS): void {
    if (this.pendingSyncTimeout) {
      clearTimeout(this.pendingSyncTimeout);
    }

    this.pendingSyncTimeout = setTimeout(() => {
      this.pendingSyncTimeout = null;
      this.syncIfNeeded().catch((error) => {
        log.warn('Scheduled library sync failed:', error);
      });
    }, delayMs);
  }

  private async syncIfNeeded(): Promise<void> {
    if (this.lastSyncAt && Date.now() - this.lastSyncAt < MIN_SYNC_INTERVAL_MS) {
      return;
    }
    await this.syncToSupabase();
  }

  private syncStatePath(): string {
    return path.join(fieldTheoryDir(), 'library-sync-state.json');
  }

  private loadSyncState(): LibrarySyncStateFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.syncStatePath(), 'utf-8'));
      if (
        parsed?.schemaVersion === LIBRARY_SYNC_STATE_SCHEMA_VERSION &&
        parsed.users &&
        typeof parsed.users === 'object'
      ) {
        return parsed as LibrarySyncStateFile;
      }
    } catch {}

    return { schemaVersion: LIBRARY_SYNC_STATE_SCHEMA_VERSION, users: {} };
  }

  private saveSyncState(state: LibrarySyncStateFile): void {
    const statePath = this.syncStatePath();
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  }

  private getUserSyncState(state: LibrarySyncStateFile, userId: string): LibrarySyncUserState {
    state.users[userId] ??= { documents: {}, pendingTombstones: {} };
    state.users[userId].pendingTombstones ??= {};
    return state.users[userId];
  }

  private sourceRootExistsForPath(sourcePath: string): boolean {
    const { rootDir } = getLibrarySyncTargetForSourcePath(sourcePath);
    return fs.existsSync(rootDir);
  }

  private recordPendingLocalTombstones(userState: LibrarySyncUserState, localDocs: LocalLibraryDocument[]): boolean {
    const knownDocuments = Object.fromEntries(
      Object.entries(userState.documents).filter(([, doc]) => this.sourceRootExistsForPath(doc.sourcePath)),
    );
    const next = reconcilePendingTombstonesForMissingKnownDocs(
      localDocs,
      knownDocuments,
      userState.pendingTombstones,
    );
    const changed = JSON.stringify(next) !== JSON.stringify(userState.pendingTombstones);
    userState.pendingTombstones = next;
    return changed;
  }

  private updateKnownDocuments(
    userId: string,
    remoteRows: LibraryDocumentRow[],
    localDocs: LocalLibraryDocument[],
  ): void {
    const state = this.loadSyncState();
    const userState = this.getUserSyncState(state, userId);
    const nowMs = Date.now();

    for (const row of remoteRows) {
      const sourcePath = normalizeLibrarySourcePath(row.source_path, row.title);
      if (!sourcePath) continue;
      if (row.deleted_at) {
        delete userState.documents[row.client_id];
        delete userState.pendingTombstones[row.client_id];
        continue;
      }

      if (!localDocs.some((doc) => localDocMatchesRow(doc, row, sourcePath))) {
        continue;
      }

      userState.documents[row.client_id] = {
        clientId: row.client_id,
        sourcePath,
        contentHash: rowContentHash(row),
        remoteUpdatedAtMs: rowVersionUpdatedAtMs(row),
        seenAtMs: nowMs,
      };
    }

    this.saveSyncState(state);
  }

  private scanLocalDocuments(remoteRows: LibraryDocumentRow[]): LocalLibraryDocument[] {
    const remoteBySourcePath = new Map<string, LibraryDocumentRow>();
    for (const row of remoteRows) {
      const sourcePath = normalizeLibrarySourcePath(row.source_path, row.title);
      if (sourcePath) remoteBySourcePath.set(sourcePath, row);
    }

    const localDocs = getLibrarySyncSourceRoots().flatMap((root) => (
      this.scanSourceRoot(root, remoteBySourcePath)
    ));

    return deduplicateLocalLibraryDocuments(localDocs);
  }

  private scanSourceRoot(
    root: LibrarySyncSourceRoot,
    remoteBySourcePath: Map<string, LibraryDocumentRow>,
  ): LocalLibraryDocument[] {
    return walkMarkdownFiles(root.dirPath).flatMap((filePath): LocalLibraryDocument[] => {
      const relPath = relativeMarkdownPath(root.dirPath, filePath);
      if (!relPath) return [];
      const sourcePath = sourcePathForLibrarySyncSourceRoot(root, relPath);

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const stats = fs.statSync(filePath);
        const existingRemote = remoteBySourcePath.get(sourcePath);
        return [{
          clientId: existingRemote?.client_id ?? clientIdForLibrarySourcePath(sourcePath),
          sourcePath,
          title: parseMarkdownTitle(filePath),
          content,
          contentHash: sha256(content),
          createdAtMs: existingRemote?.client_created_at_ms ?? Math.floor(stats.birthtimeMs || stats.ctimeMs || stats.mtimeMs),
          updatedAtMs: Math.floor(stats.mtimeMs),
        }];
      } catch (error) {
        log.warn(`Skipping unreadable library file ${filePath}:`, error);
        return [];
      }
    });
  }

  private async fetchRemoteRows(userId: string): Promise<LibraryDocumentRow[]> {
    const supabase = this.authManager.getSupabaseClient();
    if (!supabase) return [];

    const { data, error } = await supabase
      .from('library_documents')
      .select('*')
      .eq('user_id', userId);

    if (error) throw error;
    return (data ?? []) as LibraryDocumentRow[];
  }

  private async tombstoneLocalDeletions(userId: string, rows: LibraryDocumentRow[], result: LibrarySyncResult): Promise<void> {
    const supabase = this.authManager.getSupabaseClient();
    if (!supabase || rows.length === 0) return;

    const deletedAt = new Date().toISOString();
    for (const row of rows) {
      const { error } = await supabase
        .from('library_documents')
        .update({
          title: '',
          content: '',
          tags: [],
          content_hash: EMPTY_CONTENT_HASH,
          deleted_at: deletedAt,
        })
        .eq('user_id', userId)
        .eq('client_id', row.client_id)
        .is('deleted_at', null);

      if (error) throw error;
      result.tombstoned++;
    }
  }

  private async tombstonePendingLocalDeletions(
    userId: string,
    tombstones: LibrarySyncPendingTombstone[],
    result: LibrarySyncResult,
  ): Promise<void> {
    const supabase = this.authManager.getSupabaseClient();
    if (!supabase || tombstones.length === 0) return;

    for (const tombstone of tombstones) {
      const { error } = await supabase
        .from('library_documents')
        .update({
          title: '',
          content: '',
          tags: [],
          source_path: tombstone.sourcePath,
          source_kind: 'laptop',
          content_hash: EMPTY_CONTENT_HASH,
          deleted_at: new Date(tombstone.deletedAtMs).toISOString(),
        })
        .eq('user_id', userId)
        .eq('client_id', tombstone.clientId)
        .is('deleted_at', null);

      if (error) throw error;
      result.tombstoned++;
    }
  }

  private async upsertLocalChanges(userId: string, localDocs: LocalLibraryDocument[], remoteRows: LibraryDocumentRow[], result: LibrarySyncResult): Promise<void> {
    const supabase = this.authManager.getSupabaseClient();
    if (!supabase) return;

    const remoteByClientId = new Map(remoteRows.map((row) => [row.client_id, row]));
    const rowsToUpsert: object[] = [];

    for (const doc of localDocs) {
      const remote = remoteByClientId.get(doc.clientId);
      if (!remote) {
        result.uploaded++;
      } else if (rowContentHash(remote) !== doc.contentHash) {
        if (doc.updatedAtMs <= remoteUpdatedAtMs(remote) + CLOCK_SKEW_MS) {
          result.skipped++;
          continue;
        }
        result.updated++;
      } else {
        result.skipped++;
        continue;
      }

      rowsToUpsert.push({
        user_id: userId,
        title: doc.title,
        content: doc.content,
        tags: [],
        source_path: doc.sourcePath,
        source_kind: 'laptop',
        content_hash: doc.contentHash,
        client_id: doc.clientId,
        client_created_at_ms: doc.createdAtMs,
        deleted_at: null,
      });
    }

    if (rowsToUpsert.length === 0) return;

    const { error } = await supabase
      .from('library_documents')
      .upsert(rowsToUpsert, { onConflict: 'user_id,client_id' });

    if (error) throw error;
  }

  private applyRemoteTombstones(
    remoteRows: LibraryDocumentRow[],
    localDocs: LocalLibraryDocument[],
    knownDocuments: Record<string, LibrarySyncKnownDocument>,
    result: LibrarySyncResult,
  ): void {
    const localByClientId = new Map(localDocs.map((doc) => [doc.clientId, doc]));
    const localBySourcePath = new Map(localDocs.map((doc) => [doc.sourcePath, doc]));

    for (const row of remoteRows) {
      if (!row.deleted_at) continue;
      const sourcePath = normalizeLibrarySourcePath(row.source_path, row.title);
      if (!sourcePath) {
        result.errors.push(`Skipped unsafe library tombstone path for ${row.client_id}`);
        continue;
      }

      const local = localByClientId.get(row.client_id) ?? localBySourcePath.get(sourcePath);
      if (!local || !knownDocuments[row.client_id]) continue;

      const { rootDir, relPath } = getLibrarySyncTargetForSourcePath(sourcePath);
      const targetPath = path.resolve(rootDir, ...relPath.split('/'));
      if (!isInsidePath(rootDir, targetPath)) {
        result.errors.push(`Skipped library tombstone outside root: ${sourcePath}`);
        continue;
      }
      if (!fs.existsSync(targetPath)) continue;

      const stats = fs.statSync(targetPath);
      if (!stats.isFile()) {
        result.errors.push(`Skipped library tombstone path that is not a file: ${sourcePath}`);
        continue;
      }
      if (Math.floor(stats.mtimeMs) > rowVersionUpdatedAtMs(row) + CLOCK_SKEW_MS) {
        result.skipped++;
        continue;
      }

      try {
        moveFileToTrash(targetPath);
        result.deleted++;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        result.errors.push(`Failed moving tombstoned library file to Trash: ${sourcePath}: ${message}`);
      }
    }
  }

  private pullRemoteChanges(remoteRows: LibraryDocumentRow[], localDocs: LocalLibraryDocument[], result: LibrarySyncResult): void {
    const localByClientId = new Map(localDocs.map((doc) => [doc.clientId, doc]));
    const localBySourcePath = new Map(localDocs.map((doc) => [doc.sourcePath, doc]));

    for (const row of remoteRows) {
      if (row.deleted_at) continue;
      const sourcePath = normalizeLibrarySourcePath(row.source_path, row.title);
      if (!sourcePath) {
        result.errors.push(`Skipped unsafe library path for ${row.client_id}`);
        continue;
      }

      const { rootDir, relPath } = getLibrarySyncTargetForSourcePath(sourcePath);
      if (!fs.existsSync(rootDir)) {
        fs.mkdirSync(rootDir, { recursive: true });
      }

      const targetPath = path.resolve(rootDir, ...relPath.split('/'));
      if (!isInsidePath(rootDir, targetPath)) {
        result.errors.push(`Skipped library path outside root: ${sourcePath}`);
        continue;
      }

      const remoteHash = rowContentHash(row);
      const local = localByClientId.get(row.client_id) ?? localBySourcePath.get(sourcePath);
      if (local?.contentHash === remoteHash) {
        result.skipped++;
        continue;
      }

      if (fs.existsSync(targetPath)) {
        const stats = fs.statSync(targetPath);
        if (!stats.isFile()) {
          result.errors.push(`Skipped library path that is not a file: ${sourcePath}`);
          continue;
        }
        const content = fs.readFileSync(targetPath, 'utf-8');
        if (sha256(content) === remoteHash) {
          result.skipped++;
          continue;
        }
        if (remoteUpdatedAtMs(row) <= Math.floor(stats.mtimeMs) + CLOCK_SKEW_MS) {
          result.skipped++;
          continue;
        }
      }

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, row.content ?? '', 'utf-8');
      result.downloaded++;
    }
  }

  async syncToSupabase(): Promise<LibrarySyncResult> {
    const result: LibrarySyncResult = {
      success: false,
      uploaded: 0,
      updated: 0,
      downloaded: 0,
      deleted: 0,
      tombstoned: 0,
      skipped: 0,
      errors: [],
    };

    if (!this.authManager.isAuthenticated()) {
      result.errors.push('Not authenticated');
      return result;
    }

    if (this.isSyncing) {
      result.errors.push('Sync already in progress');
      return result;
    }

    const session = this.authManager.getSession();
    if (!session?.user?.id) {
      result.errors.push('No session user');
      return result;
    }

    this.isSyncing = true;
    try {
      const syncState = this.loadSyncState();
      const userState = this.getUserSyncState(syncState, session.user.id);
      const preflightLocalDocs = this.scanLocalDocuments([]);
      if (this.recordPendingLocalTombstones(userState, preflightLocalDocs)) {
        this.saveSyncState(syncState);
      }

      const remoteRows = await this.fetchRemoteRows(session.user.id);
      const knownDocuments = userState.documents;
      const pendingTombstones = Object.values(userState.pendingTombstones);
      const localDocs = this.scanLocalDocuments(remoteRows);
      const rowsToTombstone = getRowsToTombstoneForMissingLocalDocs(remoteRows, localDocs, knownDocuments);
      await this.tombstoneLocalDeletions(session.user.id, rowsToTombstone, result);
      await this.tombstonePendingLocalDeletions(session.user.id, pendingTombstones, result);
      if (pendingTombstones.length > 0) {
        for (const tombstone of pendingTombstones) {
          delete userState.pendingTombstones[tombstone.clientId];
          delete userState.documents[tombstone.clientId];
        }
        this.saveSyncState(syncState);
      }

      const remoteRowsAfterTombstones = rowsToTombstone.length > 0 || pendingTombstones.length > 0
        ? await this.fetchRemoteRows(session.user.id)
        : remoteRows;
      this.applyRemoteTombstones(remoteRowsAfterTombstones, localDocs, knownDocuments, result);
      const localDocsAfterTombstones = this.scanLocalDocuments(remoteRowsAfterTombstones);
      await this.upsertLocalChanges(session.user.id, localDocsAfterTombstones, remoteRowsAfterTombstones, result);
      const freshRemoteRows = await this.fetchRemoteRows(session.user.id);
      this.pullRemoteChanges(freshRemoteRows, localDocsAfterTombstones, result);
      const localDocsAfterPull = this.scanLocalDocuments(freshRemoteRows);
      this.updateKnownDocuments(session.user.id, freshRemoteRows, localDocsAfterPull);

      result.success = result.errors.length === 0;
      this.lastSyncAt = Date.now();
      log.debug('Library sync complete:', result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(message);
      log.error('Library sync failed:', error);
    } finally {
      this.isSyncing = false;
    }

    return result;
  }
}
