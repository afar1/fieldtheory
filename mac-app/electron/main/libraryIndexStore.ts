import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { createLogger } from './logger';
import type { MarkdownEditActor } from '../shared/markdownFrontmatter';
import type { RawMarkdownLinkHit } from '../shared/wikiLinkParser';

const log = createLogger('LibraryIndexStore');
const SQLITE_MAX_QUERY_PARAMETERS = 900;

export interface StoredLibraryFileMetadata {
  title: string;
  todoState?: 'open' | 'done';
  archived?: boolean;
  sharedOriginalSourcePath?: string;
  sharedAuthorCallsign?: string;
  editActor?: MarkdownEditActor;
  contentEditedAt?: number;
}

interface LibraryFileMetadataRow {
  metadata_json: string;
}

interface LibraryLinkHitRow {
  source_path?: string;
  kind: RawMarkdownLinkHit['kind'];
  raw_target: string | null;
  href: string | null;
  start_offset: number;
  end_offset: number;
  display_start: number;
  display_end: number;
  display_text: string;
}

export interface StoredLibraryLinkHit {
  sourcePath: string;
  hit: RawMarkdownLinkHit;
}

export class LibraryIndexStore {
  private db: Database.Database | null = null;
  private dbPath: string | null = null;

  constructor(dbPath?: string) {
    if (dbPath) this.setDatabasePath(dbPath);
  }

  setDatabasePath(dbPath: string): void {
    if (this.dbPath === dbPath && this.db) return;
    this.close();
    this.dbPath = dbPath;
    try {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      this.db = new Database(dbPath);
      this.initDatabase();
    } catch (error) {
      this.db = null;
      log.warn('Library index store unavailable:', error);
    }
  }

  getMetadata(filePath: string, mtimeMs: number, size: number): StoredLibraryFileMetadata | null {
    if (!this.db) return null;
    try {
      const row = this.db
        .prepare('SELECT metadata_json FROM library_file_metadata WHERE path = ? AND mtime_ms = ? AND size = ?')
        .get(filePath, mtimeMs, size) as LibraryFileMetadataRow | undefined;
      if (!row) return null;
      const parsed = JSON.parse(row.metadata_json) as StoredLibraryFileMetadata;
      return typeof parsed?.title === 'string' ? parsed : null;
    } catch (error) {
      log.warn('Failed to read Library metadata cache:', error);
      return null;
    }
  }

  setMetadata(filePath: string, mtimeMs: number, size: number, metadata: StoredLibraryFileMetadata): void {
    if (!this.db) return;
    try {
      this.db
        .prepare(`
          INSERT INTO library_file_metadata (path, mtime_ms, size, metadata_json, indexed_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(path) DO UPDATE SET
            mtime_ms = excluded.mtime_ms,
            size = excluded.size,
            metadata_json = excluded.metadata_json,
            indexed_at = excluded.indexed_at
        `)
        .run(filePath, mtimeMs, size, JSON.stringify(metadata), Date.now());
    } catch (error) {
      log.warn('Failed to write Library metadata cache:', error);
    }
  }

  getLinkHits(filePath: string): RawMarkdownLinkHit[] {
    if (!this.db) return [];
    try {
      const rows = this.db
        .prepare(`
          SELECT kind, raw_target, href, start_offset, end_offset, display_start, display_end, display_text
          FROM library_link_hits
          WHERE source_path = ?
          ORDER BY start_offset ASC, end_offset ASC
        `)
        .all(filePath) as LibraryLinkHitRow[];
      return rows.flatMap(rowToRawMarkdownLinkHit);
    } catch (error) {
      log.warn('Failed to read Library link-hit cache:', error);
      return [];
    }
  }

  getLinkHitsForSources(filePaths: string[]): StoredLibraryLinkHit[] {
    const uniquePaths = [...new Set(filePaths)].filter(Boolean);
    if (!this.db || uniquePaths.length === 0) return [];
    try {
      const hits: StoredLibraryLinkHit[] = [];
      for (let index = 0; index < uniquePaths.length; index += SQLITE_MAX_QUERY_PARAMETERS) {
        const chunk = uniquePaths.slice(index, index + SQLITE_MAX_QUERY_PARAMETERS);
        const placeholders = chunk.map(() => '?').join(', ');
        const rows = this.db
          .prepare(`
            SELECT source_path, kind, raw_target, href, start_offset, end_offset, display_start, display_end, display_text
            FROM library_link_hits
            WHERE source_path IN (${placeholders})
            ORDER BY source_path ASC, start_offset ASC, end_offset ASC
          `)
          .all(...chunk) as LibraryLinkHitRow[];
        hits.push(...rows.flatMap(rowToStoredLibraryLinkHit));
      }
      return hits;
    } catch (error) {
      log.warn('Failed to read Library link-hit cache by sources:', error);
      return [];
    }
  }

  findWikiLinkHitsByRawTarget(rawTarget: string): StoredLibraryLinkHit[] {
    if (!this.db) return [];
    try {
      const rows = this.db
        .prepare(`
          SELECT source_path, kind, raw_target, href, start_offset, end_offset, display_start, display_end, display_text
          FROM library_link_hits
          WHERE kind = 'wikilink' AND lower(trim(raw_target)) = lower(trim(?))
          ORDER BY source_path ASC, start_offset ASC, end_offset ASC
        `)
        .all(rawTarget) as LibraryLinkHitRow[];
      return rows.flatMap(rowToStoredLibraryLinkHit);
    } catch (error) {
      log.warn('Failed to read Library wikilink cache by raw target:', error);
      return [];
    }
  }

  findLinkHitsByHref(href: string): StoredLibraryLinkHit[] {
    if (!this.db) return [];
    try {
      const rows = this.db
        .prepare(`
          SELECT source_path, kind, raw_target, href, start_offset, end_offset, display_start, display_end, display_text
          FROM library_link_hits
          WHERE href = ?
          ORDER BY source_path ASC, start_offset ASC, end_offset ASC
        `)
        .all(href) as LibraryLinkHitRow[];
      return rows.flatMap(rowToStoredLibraryLinkHit);
    } catch (error) {
      log.warn('Failed to read Library link-hit cache by href:', error);
      return [];
    }
  }

  replaceLinkHits(filePath: string, hits: RawMarkdownLinkHit[]): void {
    if (!this.db) return;
    try {
      const replace = this.db.transaction(() => {
        this.db?.prepare('DELETE FROM library_link_hits WHERE source_path = ?').run(filePath);
        const insert = this.db?.prepare(`
          INSERT INTO library_link_hits (
            source_path,
            kind,
            raw_target,
            href,
            start_offset,
            end_offset,
            display_start,
            display_end,
            display_text,
            indexed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const hit of hits) {
          insert?.run(
            filePath,
            hit.kind,
            hit.rawTarget,
            hit.href,
            hit.start,
            hit.end,
            hit.displayStart,
            hit.displayEnd,
            hit.displayText,
            Date.now(),
          );
        }
      });
      replace();
    } catch (error) {
      log.warn('Failed to write Library link-hit cache:', error);
    }
  }

  removePath(filePath: string): void {
    this.removePaths([filePath]);
  }

  removePaths(filePaths: string[]): void {
    if (!this.db) return;
    const uniquePaths = [...new Set(filePaths)].filter(Boolean);
    if (uniquePaths.length === 0) return;
    try {
      const remove = this.db.transaction(() => {
        const deleteMetadata = this.db?.prepare('DELETE FROM library_file_metadata WHERE path = ?');
        const deleteLinkHits = this.db?.prepare('DELETE FROM library_link_hits WHERE source_path = ?');
        for (const filePath of uniquePaths) {
          deleteMetadata?.run(filePath);
          deleteLinkHits?.run(filePath);
        }
      });
      remove();
    } catch (error) {
      log.warn('Failed to remove Library metadata cache entry:', error);
    }
  }

  close(): void {
    try {
      this.db?.close();
    } catch (error) {
      log.warn('Failed to close Library index store:', error);
    } finally {
      this.db = null;
    }
  }

  private initDatabase(): void {
    if (!this.db) return;
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS library_file_metadata (
        path TEXT PRIMARY KEY,
        mtime_ms INTEGER NOT NULL,
        size INTEGER NOT NULL,
        metadata_json TEXT NOT NULL,
        indexed_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_library_file_metadata_freshness
        ON library_file_metadata(path, mtime_ms, size);

      CREATE TABLE IF NOT EXISTS library_link_hits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_path TEXT NOT NULL,
        kind TEXT NOT NULL,
        raw_target TEXT,
        href TEXT,
        start_offset INTEGER NOT NULL,
        end_offset INTEGER NOT NULL,
        display_start INTEGER NOT NULL,
        display_end INTEGER NOT NULL,
        display_text TEXT NOT NULL,
        indexed_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_library_link_hits_source
        ON library_link_hits(source_path, start_offset);

      CREATE INDEX IF NOT EXISTS idx_library_link_hits_wikilink_target
        ON library_link_hits(lower(trim(raw_target)), source_path, start_offset)
        WHERE kind = 'wikilink';

      CREATE INDEX IF NOT EXISTS idx_library_link_hits_href
        ON library_link_hits(href, source_path, start_offset)
        WHERE href IS NOT NULL;
    `);
  }
}

function rowToStoredLibraryLinkHit(row: LibraryLinkHitRow): StoredLibraryLinkHit[] {
  const sourcePath = row.source_path;
  if (!sourcePath) return [];
  return rowToRawMarkdownLinkHit(row).map(hit => ({ sourcePath, hit }));
}

function rowToRawMarkdownLinkHit(row: LibraryLinkHitRow): RawMarkdownLinkHit[] {
  if (row.kind === 'wikilink') {
    if (row.raw_target === null) return [];
    return [{
      kind: 'wikilink',
      rawTarget: row.raw_target,
      href: null,
      start: row.start_offset,
      end: row.end_offset,
      displayStart: row.display_start,
      displayEnd: row.display_end,
      displayText: row.display_text,
    }];
  }

  if (
    row.kind === 'markdown-link'
    || row.kind === 'autolink'
    || row.kind === 'bare-url'
  ) {
    if (row.href === null) return [];
    return [{
      kind: row.kind,
      rawTarget: null,
      href: row.href,
      start: row.start_offset,
      end: row.end_offset,
      displayStart: row.display_start,
      displayEnd: row.display_end,
      displayText: row.display_text,
    }];
  }

  return [];
}
