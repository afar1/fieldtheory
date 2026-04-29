/**
 * LibrarySyncService - Syncs the Mac markdown library with Supabase.
 *
 * This intentionally avoids remote deletes for now. A missing local file should
 * not erase a user's mobile copy until we have explicit tombstone handling.
 */

import fs from 'fs';
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

interface LibraryDocumentRow {
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

interface LocalLibraryDocument {
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
  skipped: number;
  errors: string[];
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

function parseMarkdownTitle(filePath: string, content: string): string {
  const lines = content.split(/\r?\n/).slice(0, 40);
  for (const line of lines) {
    const match = line.match(/^#\s+(.+)/);
    if (match) return match[1].trim();
  }
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

function rowContentHash(row: LibraryDocumentRow): string {
  return row.content_hash || sha256(row.content ?? '');
}

export class LibrarySyncService {
  private authManager: AuthManager;
  private isSyncing = false;
  private lastSyncAt: number | null = null;
  private pendingSyncTimeout: ReturnType<typeof setTimeout> | null = null;
  private pollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(authManager: AuthManager) {
    this.authManager = authManager;

    this.authManager.on('sessionChanged', (session) => {
      if (session) this.scheduleSync();
    });

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

  private scanLocalDocuments(remoteRows: LibraryDocumentRow[]): LocalLibraryDocument[] {
    const remoteBySourcePath = new Map<string, LibraryDocumentRow>();
    for (const row of remoteRows) {
      const sourcePath = normalizeLibrarySourcePath(row.source_path, row.title);
      if (sourcePath) remoteBySourcePath.set(sourcePath, row);
    }

    return getLibrarySyncSourceRoots().flatMap((root) => (
      this.scanSourceRoot(root, remoteBySourcePath)
    ));
  }

  private scanSourceRoot(
    root: LibrarySyncSourceRoot,
    remoteBySourcePath: Map<string, LibraryDocumentRow>,
  ): LocalLibraryDocument[] {
    return walkMarkdownFiles(root.dirPath).flatMap((filePath): LocalLibraryDocument[] => {
      const relPath = relativeMarkdownPath(root.dirPath, filePath);
      if (!relPath) return [];
      const sourcePath = prefixedSourcePath(root.sourcePrefix, relPath);

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const stats = fs.statSync(filePath);
        const existingRemote = remoteBySourcePath.get(sourcePath);
        return [{
          clientId: existingRemote?.client_id ?? clientIdForLibrarySourcePath(sourcePath),
          sourcePath,
          title: parseMarkdownTitle(filePath, content),
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
      .eq('user_id', userId)
      .is('deleted_at', null);

    if (error) throw error;
    return (data ?? []) as LibraryDocumentRow[];
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

  private pullRemoteChanges(remoteRows: LibraryDocumentRow[], localDocs: LocalLibraryDocument[], result: LibrarySyncResult): void {
    const rootDir = libraryDir();
    const localByClientId = new Map(localDocs.map((doc) => [doc.clientId, doc]));
    const localBySourcePath = new Map(localDocs.map((doc) => [doc.sourcePath, doc]));

    if (!fs.existsSync(rootDir)) {
      fs.mkdirSync(rootDir, { recursive: true });
    }

    for (const row of remoteRows) {
      const sourcePath = normalizeLibrarySourcePath(row.source_path, row.title);
      if (!sourcePath) {
        result.errors.push(`Skipped unsafe library path for ${row.client_id}`);
        continue;
      }

      const targetPath = path.resolve(rootDir, ...sourcePath.split('/'));
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
      const remoteRows = await this.fetchRemoteRows(session.user.id);
      const localDocs = this.scanLocalDocuments(remoteRows);

      await this.upsertLocalChanges(session.user.id, localDocs, remoteRows, result);
      const freshRemoteRows = await this.fetchRemoteRows(session.user.id);
      this.pullRemoteChanges(freshRemoteRows, localDocs, result);

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
