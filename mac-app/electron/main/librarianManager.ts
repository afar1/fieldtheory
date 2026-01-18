import { app } from 'electron';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { EventEmitter } from 'events';

/**
 * A reading imported into the Librarian.
 */
export interface Reading {
  id: number;
  filename: string;
  originalPath: string | null;
  title: string;
  context: string | null;
  readingTime: string | null;
  content: string;
  sourceDir: string | null;
  createdAt: number;
  importedAt: number;
}

/**
 * Metadata for a reading (without full content).
 */
export interface ReadingMeta {
  id: number;
  title: string;
  context: string | null;
  readingTime: string | null;
  createdAt: number;
}

/**
 * A watched directory configuration.
 */
export interface WatchedDir {
  id: number;
  path: string;
  enabled: boolean;
  addedAt: number;
}

/**
 * LibrarianManager handles watching directories for markdown files,
 * importing them into Field Theory's internal storage, and providing
 * access to the reading collection.
 *
 * Named after the AI assistant in Snow Crash that provides contextual
 * intel during missions.
 */
export class LibrarianManager extends EventEmitter {
  private db: Database.Database;
  private librarianDir: string;
  private watchers: Map<string, fs.FSWatcher> = new Map();

  constructor() {
    super();

    // Initialize paths
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'librarian.db');
    this.librarianDir = path.join(userDataPath, 'librarian');

    // Ensure librarian directory exists
    if (!fs.existsSync(this.librarianDir)) {
      fs.mkdirSync(this.librarianDir, { recursive: true });
    }

    // Initialize database
    this.db = new Database(dbPath);
    this.initDatabase();

    // Start watching configured directories
    this.startWatching();

    console.log('[LibrarianManager] Initialized');
  }

  /**
   * Initialize database schema.
   */
  private initDatabase(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS readings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT UNIQUE NOT NULL,
        original_path TEXT,
        title TEXT NOT NULL,
        context TEXT,
        reading_time TEXT,
        content TEXT NOT NULL,
        source_dir TEXT,
        created_at INTEGER NOT NULL,
        imported_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_readings_created_at ON readings(created_at DESC);

      CREATE TABLE IF NOT EXISTS watched_dirs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        enabled INTEGER DEFAULT 1,
        added_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS migrations (
        name TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);

    console.log('[LibrarianManager] Database initialized');
  }

  /**
   * Run a migration if it hasn't been applied yet.
   */
  private runMigration(name: string, migration: () => void): void {
    const existing = this.db
      .prepare('SELECT name FROM migrations WHERE name = ?')
      .get(name);

    if (existing) {
      return;
    }

    try {
      migration();
      this.db
        .prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)')
        .run(name, Date.now());
      console.log(`[LibrarianManager] Migration applied: ${name}`);
    } catch (error) {
      console.warn(`[LibrarianManager] Migration ${name} may have already been applied:`, error);
      this.db
        .prepare('INSERT OR IGNORE INTO migrations (name, applied_at) VALUES (?, ?)')
        .run(name, Date.now());
    }
  }

  /**
   * Parse markdown content to extract metadata.
   */
  private parseMarkdown(content: string): { title: string; context: string | null; readingTime: string | null } {
    const lines = content.split('\n');
    let title = 'Untitled Reading';
    let context: string | null = null;
    let readingTime: string | null = null;

    for (const line of lines) {
      const trimmed = line.trim();

      // Extract H1 title
      if (trimmed.startsWith('# ') && title === 'Untitled Reading') {
        title = trimmed.slice(2).trim();
        continue;
      }

      // Extract reading time (e.g., *Reading time: ~4 minutes*)
      const readingTimeMatch = trimmed.match(/^\*Reading time:\s*(.+?)\*$/i);
      if (readingTimeMatch) {
        readingTime = readingTimeMatch[1].trim();
        continue;
      }

      // Extract context (e.g., *Context: Auth architecture refactoring*)
      const contextMatch = trimmed.match(/^\*Context:\s*(.+?)\*$/i);
      if (contextMatch) {
        context = contextMatch[1].trim();
        continue;
      }
    }

    return { title, context, readingTime };
  }

  /**
   * Generate a unique filename for internal storage.
   */
  private generateFilename(): string {
    const date = new Date().toISOString().split('T')[0];
    const hash = crypto.randomBytes(4).toString('hex');
    return `${date}-${hash}.md`;
  }

  /**
   * Import a markdown file into the librarian.
   */
  async importFile(sourcePath: string): Promise<Reading | null> {
    try {
      // Check if file exists
      if (!fs.existsSync(sourcePath)) {
        console.warn(`[LibrarianManager] File not found: ${sourcePath}`);
        return null;
      }

      // Check if already imported (by original path)
      const existing = this.db
        .prepare('SELECT id FROM readings WHERE original_path = ?')
        .get(sourcePath);

      if (existing) {
        console.log(`[LibrarianManager] Already imported: ${sourcePath}`);
        return null;
      }

      // Read content
      const content = fs.readFileSync(sourcePath, 'utf-8');
      const { title, context, readingTime } = this.parseMarkdown(content);

      // Generate internal filename and copy
      const filename = this.generateFilename();
      const destPath = path.join(this.librarianDir, filename);
      fs.copyFileSync(sourcePath, destPath);

      // Get source directory
      const sourceDir = path.dirname(sourcePath);

      // Get file stats for created time
      const stats = fs.statSync(sourcePath);
      const createdAt = Math.floor(stats.birthtimeMs);
      const importedAt = Date.now();

      // Insert into database
      const result = this.db
        .prepare(`
          INSERT INTO readings (filename, original_path, title, context, reading_time, content, source_dir, created_at, imported_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(filename, sourcePath, title, context, readingTime, content, sourceDir, createdAt, importedAt);

      const reading: Reading = {
        id: result.lastInsertRowid as number,
        filename,
        originalPath: sourcePath,
        title,
        context,
        readingTime,
        content,
        sourceDir,
        createdAt,
        importedAt,
      };

      console.log(`[LibrarianManager] Imported: ${title}`);
      this.emit('reading-added', reading);

      return reading;
    } catch (error) {
      console.error(`[LibrarianManager] Error importing file:`, error);
      return null;
    }
  }

  /**
   * Watch a directory for new markdown files.
   */
  private watchDirectory(dirPath: string): void {
    // Skip if already watching
    if (this.watchers.has(dirPath)) {
      return;
    }

    // Check if directory exists
    if (!fs.existsSync(dirPath)) {
      console.warn(`[LibrarianManager] Directory not found: ${dirPath}`);
      return;
    }

    console.log(`[LibrarianManager] Watching: ${dirPath}`);

    // Import existing files first
    this.scanDirectory(dirPath);

    // Start watching for new files
    try {
      const watcher = fs.watch(dirPath, (eventType, filename) => {
        if (eventType === 'rename' && filename && filename.endsWith('.md')) {
          const filePath = path.join(dirPath, filename);

          // Small delay to ensure file is fully written
          setTimeout(() => {
            if (fs.existsSync(filePath)) {
              this.importFile(filePath);
            }
          }, 100);
        }
      });

      this.watchers.set(dirPath, watcher);
    } catch (error) {
      console.error(`[LibrarianManager] Error watching directory:`, error);
    }
  }

  /**
   * Scan a directory and import all markdown files.
   */
  private scanDirectory(dirPath: string): void {
    try {
      const files = fs.readdirSync(dirPath);

      for (const file of files) {
        if (file.endsWith('.md')) {
          const filePath = path.join(dirPath, file);
          this.importFile(filePath);
        }
      }
    } catch (error) {
      console.error(`[LibrarianManager] Error scanning directory:`, error);
    }
  }

  /**
   * Stop watching a directory.
   */
  private unwatchDirectory(dirPath: string): void {
    const watcher = this.watchers.get(dirPath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(dirPath);
      console.log(`[LibrarianManager] Stopped watching: ${dirPath}`);
    }
  }

  /**
   * Start watching all configured directories.
   */
  private startWatching(): void {
    const dirs = this.getWatchedDirs();
    for (const dir of dirs) {
      if (dir.enabled) {
        this.watchDirectory(dir.path);
      }
    }
  }

  /**
   * Get all watched directories.
   */
  getWatchedDirs(): WatchedDir[] {
    const rows = this.db
      .prepare('SELECT id, path, enabled, added_at FROM watched_dirs ORDER BY added_at DESC')
      .all() as { id: number; path: string; enabled: number; added_at: number }[];

    return rows.map(row => ({
      id: row.id,
      path: row.path,
      enabled: row.enabled === 1,
      addedAt: row.added_at,
    }));
  }

  /**
   * Add a directory to watch.
   */
  addWatchedDir(dirPath: string): WatchedDir | null {
    // Expand ~ to home directory
    const expandedPath = dirPath.startsWith('~')
      ? dirPath.replace('~', app.getPath('home'))
      : dirPath;

    // Check if directory exists
    if (!fs.existsSync(expandedPath)) {
      console.warn(`[LibrarianManager] Directory not found: ${expandedPath}`);
      return null;
    }

    // Check if already added
    const existing = this.db
      .prepare('SELECT id FROM watched_dirs WHERE path = ?')
      .get(expandedPath);

    if (existing) {
      console.log(`[LibrarianManager] Already watching: ${expandedPath}`);
      return null;
    }

    const addedAt = Date.now();
    const result = this.db
      .prepare('INSERT INTO watched_dirs (path, enabled, added_at) VALUES (?, 1, ?)')
      .run(expandedPath, addedAt);

    const watchedDir: WatchedDir = {
      id: result.lastInsertRowid as number,
      path: expandedPath,
      enabled: true,
      addedAt,
    };

    // Start watching immediately
    this.watchDirectory(expandedPath);

    console.log(`[LibrarianManager] Added watched directory: ${expandedPath}`);
    return watchedDir;
  }

  /**
   * Remove a watched directory.
   */
  removeWatchedDir(id: number): boolean {
    const dir = this.db
      .prepare('SELECT path FROM watched_dirs WHERE id = ?')
      .get(id) as { path: string } | undefined;

    if (!dir) {
      return false;
    }

    // Stop watching
    this.unwatchDirectory(dir.path);

    // Remove from database
    this.db.prepare('DELETE FROM watched_dirs WHERE id = ?').run(id);

    console.log(`[LibrarianManager] Removed watched directory: ${dir.path}`);
    return true;
  }

  /**
   * Get all readings (metadata only).
   */
  getReadings(): ReadingMeta[] {
    const rows = this.db
      .prepare('SELECT id, title, context, reading_time, created_at FROM readings ORDER BY created_at DESC')
      .all() as { id: number; title: string; context: string | null; reading_time: string | null; created_at: number }[];

    return rows.map(row => ({
      id: row.id,
      title: row.title,
      context: row.context,
      readingTime: row.reading_time,
      createdAt: row.created_at,
    }));
  }

  /**
   * Get a reading by ID (with full content).
   */
  getReading(id: number): Reading | null {
    const row = this.db
      .prepare('SELECT * FROM readings WHERE id = ?')
      .get(id) as {
        id: number;
        filename: string;
        original_path: string | null;
        title: string;
        context: string | null;
        reading_time: string | null;
        content: string;
        source_dir: string | null;
        created_at: number;
        imported_at: number;
      } | undefined;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      filename: row.filename,
      originalPath: row.original_path,
      title: row.title,
      context: row.context,
      readingTime: row.reading_time,
      content: row.content,
      sourceDir: row.source_dir,
      createdAt: row.created_at,
      importedAt: row.imported_at,
    };
  }

  /**
   * Delete a reading.
   */
  deleteReading(id: number): boolean {
    const reading = this.getReading(id);
    if (!reading) {
      return false;
    }

    // Delete the internal file
    const filePath = path.join(this.librarianDir, reading.filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Delete from database
    this.db.prepare('DELETE FROM readings WHERE id = ?').run(id);

    console.log(`[LibrarianManager] Deleted reading: ${reading.title}`);
    return true;
  }

  /**
   * Stop all watchers and close database.
   */
  destroy(): void {
    // Stop all watchers
    for (const [dirPath, watcher] of this.watchers) {
      watcher.close();
      console.log(`[LibrarianManager] Stopped watching: ${dirPath}`);
    }
    this.watchers.clear();

    // Close database
    this.db.close();
    console.log('[LibrarianManager] Destroyed');
  }
}
