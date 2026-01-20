import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { EventEmitter } from 'events';
import * as chokidar from 'chokidar';

/**
 * Auto-run frequency for generating readings.
 */
export type AutoRunFrequency = 'off' | 'occasionally' | 'regularly' | 'frequently' | 'always';

/**
 * Metadata for a reading (cached in index).
 * Path is the identity - no numeric IDs.
 */
export interface ReadingMeta {
  path: string;
  title: string;
  context: string | null;
  readingTime: string | null;
  createdAt: number;
  mtime: number;
}

/**
 * A full reading with content (loaded on demand).
 */
export interface Reading extends ReadingMeta {
  content: string;
}

/**
 * A watched directory configuration.
 * Path is the identity - no numeric IDs.
 */
export interface WatchedDir {
  path: string;
  enabled: boolean;
}

/**
 * Settings stored in JSON file.
 */
interface LibrarianSettings {
  watchedDirs: string[];
  autoRunFrequency: AutoRunFrequency;
  autoShowEnabled: boolean;
  customContentGuidance?: string;
  customThreshold?: number; // If set, use this exact threshold instead of frequency-based random range
}

/**
 * Index stored in JSON file for fast startup.
 */
interface LibrarianIndex {
  version: number;
  files: Record<string, {
    title: string;
    context: string | null;
    readingTime: string | null;
    createdAt: number;
    mtime: number;
  }>;
}

/**
 * LibrarianManager handles watching directories for markdown files
 * and providing access to the reading collection.
 *
 * File-only architecture: .librarian/ directories are the single source of truth.
 * No database, no internal copies. Field Theory is a visibility tool.
 *
 * Named after the AI assistant in Snow Crash that provides contextual
 * intel during missions.
 */
export class LibrarianManager extends EventEmitter {
  private settingsPath: string;
  private indexPath: string;
  private oldDbPath: string;
  private oldLibrarianDir: string;
  private cache: Map<string, ReadingMeta> = new Map();
  private watchers: Map<string, chokidar.FSWatcher> = new Map();
  private settings: LibrarianSettings;
  private scanningDirs: Set<string> = new Set();

  constructor() {
    super();

    // Initialize paths
    const userDataPath = app.getPath('userData');
    this.settingsPath = path.join(userDataPath, 'librarian-settings.json');
    this.indexPath = path.join(userDataPath, 'librarian-index.json');
    this.oldDbPath = path.join(userDataPath, 'librarian.db');
    this.oldLibrarianDir = path.join(userDataPath, 'librarian');

    // Migrate from old database if needed
    this.migrateFromDatabase();

    // Load settings
    this.settings = this.loadSettings();

    // Load index (cached metadata)
    this.loadIndex();

    // Start watching configured directories
    this.startWatching();

    // Log current status for all projects with .librarian directories
    this.logAllProjectStatuses();

    console.log('[LibrarianManager] Initialized (file-only mode)');
  }

  /**
   * Log global status at startup and reconcile with file timestamps.
   * If any reading in any watched dir is newer than lastReading, reset counter.
   */
  private logAllProjectStatuses(): void {
    // Reconcile global status with all watched directories
    this.reconcileStatusWithFiles();

    // Log the global status
    this.logStatus('startup');
  }

  /**
   * Check if any .md file in ANY watched dir is newer than global lastReading.
   * If so, reset the global counter. Handles readings created while app wasn't running.
   */
  private reconcileStatusWithFiles(): void {
    this.ensureGlobalStatusExists();
    const statusFile = this.getGlobalStatusPath();

    try {
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      const lastReadingTime = status.lastReading ? new Date(status.lastReading).getTime() : 0;

      // Find newest .md file across ALL watched directories
      let newestMtime = 0;

      for (const watchedDir of this.settings.watchedDirs) {
        if (!fs.existsSync(watchedDir)) continue;

        const files = fs.readdirSync(watchedDir).filter(f => f.endsWith('.md'));
        for (const file of files) {
          const filePath = path.join(watchedDir, file);
          try {
            const stats = fs.statSync(filePath);
            if (stats.mtimeMs > newestMtime) {
              newestMtime = stats.mtimeMs;
            }
          } catch {
            // Ignore errors reading individual files
          }
        }
      }

      // If there's a file anywhere newer than lastReading, reset the global counter
      if (newestMtime > lastReadingTime) {
        console.log('[Librarian] reconcile → found newer reading, resetting global counter');
        this.resetPromptCount();
      }
    } catch (error) {
      console.warn('[LibrarianManager] Failed to reconcile status:', error);
    }
  }

  // ===========================================================================
  // Path Utilities
  // ===========================================================================

  /**
   * Normalize a path to prevent duplicates from ../, ./, etc.
   */
  private normalizePath(filePath: string): string {
    return path.resolve(filePath);
  }

  /**
   * Expand ~ to home directory.
   */
  private expandPath(filePath: string): string {
    if (filePath.startsWith('~')) {
      return filePath.replace('~', app.getPath('home'));
    }
    return filePath;
  }

  // ===========================================================================
  // Settings Management
  // ===========================================================================

  /**
   * Load settings from JSON file.
   */
  private loadSettings(): LibrarianSettings {
    const defaults: LibrarianSettings = {
      watchedDirs: [],
      autoRunFrequency: 'frequently',
      autoShowEnabled: true,
      customContentGuidance: undefined,
    };

    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8'));
        return {
          watchedDirs: data.watchedDirs || defaults.watchedDirs,
          autoRunFrequency: data.autoRunFrequency || defaults.autoRunFrequency,
          autoShowEnabled: data.autoShowEnabled ?? defaults.autoShowEnabled,
          customContentGuidance: data.customContentGuidance || undefined,
          customThreshold: typeof data.customThreshold === 'number' ? data.customThreshold : undefined,
        };
      }
    } catch (error) {
      console.warn('[LibrarianManager] Failed to load settings, using defaults:', error);
    }

    return defaults;
  }

  /**
   * Save settings to JSON file.
   */
  private saveSettings(): void {
    try {
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2));
    } catch (error) {
      console.error('[LibrarianManager] Failed to save settings:', error);
    }
  }

  // ===========================================================================
  // Index Management (for fast startup)
  // ===========================================================================

  /**
   * Load index from JSON file with corruption fallback.
   */
  private loadIndex(): void {
    try {
      if (fs.existsSync(this.indexPath)) {
        const data: LibrarianIndex = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
        if (data.version === 1 && data.files) {
          for (const [filePath, meta] of Object.entries(data.files)) {
            this.cache.set(filePath, {
              path: filePath,
              title: meta.title,
              context: meta.context,
              readingTime: meta.readingTime,
              createdAt: meta.createdAt,
              mtime: meta.mtime,
            });
          }
          console.log(`[LibrarianManager] Loaded ${this.cache.size} readings from index`);
        }
      }
    } catch (error) {
      console.warn('[LibrarianManager] Index corrupted or invalid, starting fresh:', error);
      this.cache.clear();
    }
  }

  /**
   * Save index to JSON file.
   */
  private saveIndex(): void {
    try {
      const index: LibrarianIndex = {
        version: 1,
        files: {},
      };
      for (const [filePath, meta] of this.cache.entries()) {
        index.files[filePath] = {
          title: meta.title,
          context: meta.context,
          readingTime: meta.readingTime,
          createdAt: meta.createdAt,
          mtime: meta.mtime,
        };
      }
      fs.writeFileSync(this.indexPath, JSON.stringify(index, null, 2));
    } catch (error) {
      console.error('[LibrarianManager] Failed to save index:', error);
    }
  }

  // ===========================================================================
  // Migration from Old Database
  // ===========================================================================

  /**
   * Migrate settings from old SQLite database if it exists.
   */
  private migrateFromDatabase(): void {
    if (!fs.existsSync(this.oldDbPath)) {
      return;
    }

    // Check if we've already migrated
    if (fs.existsSync(this.settingsPath)) {
      console.log('[LibrarianManager] Already migrated, skipping');
      return;
    }

    console.log('[LibrarianManager] Migrating from old database...');

    try {
      // Dynamic import to avoid requiring better-sqlite3 if not needed
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Database = require('better-sqlite3');
      const db = new Database(this.oldDbPath, { readonly: true });

      // Extract watched directories
      const watchedDirs: string[] = [];
      try {
        const rows = db.prepare('SELECT path FROM watched_dirs WHERE enabled = 1').all() as { path: string }[];
        for (const row of rows) {
          watchedDirs.push(row.path);
        }
      } catch {
        console.warn('[LibrarianManager] Could not read watched_dirs');
      }

      // Extract settings
      let autoRunFrequency: AutoRunFrequency = 'frequently';
      let autoShowEnabled = true;
      try {
        const freqRow = db.prepare("SELECT value FROM settings WHERE key = 'librarian_auto_frequency'").get() as { value: string } | undefined;
        if (freqRow?.value && ['off', 'occasionally', 'regularly', 'frequently', 'always'].includes(freqRow.value)) {
          autoRunFrequency = freqRow.value as AutoRunFrequency;
        }
        const showRow = db.prepare("SELECT value FROM settings WHERE key = 'auto_show_on_new_reading'").get() as { value: string } | undefined;
        if (showRow?.value === 'false') {
          autoShowEnabled = false;
        }
      } catch {
        console.warn('[LibrarianManager] Could not read settings');
      }

      db.close();

      // Save migrated settings
      const settings: LibrarianSettings = {
        watchedDirs,
        autoRunFrequency,
        autoShowEnabled,
      };
      fs.writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2));

      console.log(`[LibrarianManager] Migrated ${watchedDirs.length} watched directories`);

      // Clean up old files
      try {
        fs.unlinkSync(this.oldDbPath);
        console.log('[LibrarianManager] Deleted old database');
      } catch {
        console.warn('[LibrarianManager] Could not delete old database');
      }

      if (fs.existsSync(this.oldLibrarianDir)) {
        try {
          fs.rmSync(this.oldLibrarianDir, { recursive: true });
          console.log('[LibrarianManager] Deleted old librarian directory');
        } catch {
          console.warn('[LibrarianManager] Could not delete old librarian directory');
        }
      }

      console.log('[LibrarianManager] Migration complete');
    } catch (error) {
      console.error('[LibrarianManager] Migration failed:', error);
    }
  }

  // ===========================================================================
  // Markdown Parsing
  // ===========================================================================

  /**
   * Parse markdown content to extract metadata.
   * Only reads first ~20 lines for efficiency.
   */
  private parseMarkdownHeader(content: string): { title: string; context: string | null; readingTime: string | null } {
    const lines = content.split('\n').slice(0, 20);
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
   * Parse file metadata from disk.
   */
  private parseFileMetadata(filePath: string): ReadingMeta | null {
    try {
      const stats = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, 'utf-8');
      const { title, context, readingTime } = this.parseMarkdownHeader(content);

      return {
        path: filePath,
        title,
        context,
        readingTime,
        createdAt: Math.floor(stats.birthtimeMs),
        mtime: Math.floor(stats.mtimeMs),
      };
    } catch (error) {
      console.error(`[LibrarianManager] Error parsing file ${filePath}:`, error);
      return null;
    }
  }

  // ===========================================================================
  // Directory Scanning
  // ===========================================================================

  /**
   * Scan a directory with mtime-based diffing.
   * Only re-parses files that have changed.
   * Returns true if any files were added/updated.
   */
  scanDirectory(dirPath: string): boolean {
    const normalizedDir = this.normalizePath(dirPath);

    if (!fs.existsSync(normalizedDir)) {
      console.warn(`[LibrarianManager] Directory not found: ${normalizedDir}`);
      return false;
    }

    this.scanningDirs.add(normalizedDir);
    let hasChanges = false;

    try {
      const files = fs.readdirSync(normalizedDir).filter(f => f.endsWith('.md'));
      const seenPaths = new Set<string>();

      for (const file of files) {
        const fullPath = this.normalizePath(path.join(normalizedDir, file));
        seenPaths.add(fullPath);

        try {
          const stats = fs.statSync(fullPath);
          const mtime = Math.floor(stats.mtimeMs);
          const cached = this.cache.get(fullPath);

          // Skip if mtime unchanged
          if (cached && cached.mtime === mtime) {
            continue;
          }

          // Parse and cache
          const meta = this.parseFileMetadata(fullPath);
          if (meta) {
            const isNew = !this.cache.has(fullPath);
            this.cache.set(fullPath, meta);
            hasChanges = true;

            if (isNew) {
              console.log(`[LibrarianManager] Added: ${meta.title}`);
            } else {
              console.log(`[LibrarianManager] Updated: ${meta.title}`);
            }
          }
        } catch (error) {
          console.error(`[LibrarianManager] Error processing ${file}:`, error);
        }
      }

      // Remove cached entries for files that no longer exist in this directory
      for (const [cachedPath] of this.cache) {
        if (cachedPath.startsWith(normalizedDir + path.sep) && !seenPaths.has(cachedPath)) {
          this.cache.delete(cachedPath);
          hasChanges = true;
          console.log(`[LibrarianManager] Removed: ${cachedPath}`);
        }
      }

      if (hasChanges) {
        this.saveIndex();
      }
    } finally {
      this.scanningDirs.delete(normalizedDir);
    }

    return hasChanges;
  }

  /**
   * Check if a directory is currently being scanned.
   */
  isScanning(dirPath?: string): boolean {
    if (dirPath) {
      return this.scanningDirs.has(this.normalizePath(dirPath));
    }
    return this.scanningDirs.size > 0;
  }

  // ===========================================================================
  // Directory Watching
  // ===========================================================================

  /**
   * Watch a directory for file changes using chokidar for reliability.
   */
  private watchDirectory(dirPath: string): void {
    const normalizedDir = this.normalizePath(dirPath);

    if (this.watchers.has(normalizedDir)) {
      return;
    }

    if (!fs.existsSync(normalizedDir)) {
      console.warn(`[LibrarianManager] Directory not found: ${normalizedDir}`);
      return;
    }

    console.log(`[LibrarianManager] Watching: ${normalizedDir}`);
    this.scanDirectory(normalizedDir);

    // Watch for .md files in the directory using chokidar
    const watcher = chokidar.watch(`${normalizedDir}/*.md`, {
      ignoreInitial: true,           // Don't fire for existing files
      awaitWriteFinish: {            // Wait for file to be fully written
        stabilityThreshold: 100,
        pollInterval: 50,
      },
      ignorePermissionErrors: true,
      depth: 0,                      // Only watch immediate directory, not subdirs
    });

    watcher.on('ready', () => {
      console.log(`[LibrarianManager] Watcher ready: ${normalizedDir}`);
      // Reconciliation scan to catch files created during initialization
      this.scanForNewReadings(normalizedDir);
    });

    watcher.on('add', (filePath) => {
      console.log(`[LibrarianManager] File added: ${filePath}`);
      this.handleFileChange(filePath, true);
    });

    watcher.on('change', (filePath) => {
      console.log(`[LibrarianManager] File changed: ${filePath}`);
      this.handleFileChange(filePath, false);
    });

    watcher.on('unlink', (filePath) => {
      console.log(`[LibrarianManager] File removed: ${filePath}`);
      this.handleFileDelete(filePath);
    });

    watcher.on('error', (error) => {
      console.error(`[LibrarianManager] Watcher error:`, error);
    });

    this.watchers.set(normalizedDir, watcher);
  }

  /**
   * Handle file add or change events.
   */
  private handleFileChange(filePath: string, _isNewFile: boolean): void {
    const normalizedPath = this.normalizePath(filePath);
    const meta = this.parseFileMetadata(normalizedPath);

    if (!meta) return;

    // Check cache to determine if this is truly new or just an update.
    // Don't trust chokidar's isNewFile hint - reconciliation scan may have processed it first.
    const cached = this.cache.get(normalizedPath);
    const isActuallyNew = !cached || meta.mtime > cached.mtime;

    this.cache.set(normalizedPath, meta);
    this.saveIndex();

    if (isActuallyNew) {
      // Note: Counter reset is handled by polling mechanism (checkAndResetIfNeeded)
      // This keeps reset logic in ONE place - the poll is the single source of truth
      const content = fs.readFileSync(normalizedPath, 'utf-8');
      const reading: Reading = { ...meta, content };
      this.emit('reading-added', reading);
      console.log(`[LibrarianManager] New reading: ${meta.title}`);
    } else {
      this.emit('reading-updated', meta);
      console.log(`[LibrarianManager] Updated reading: ${meta.title}`);
    }
  }

  /**
   * Handle file delete events.
   */
  private handleFileDelete(filePath: string): void {
    const normalizedPath = this.normalizePath(filePath);
    if (this.cache.has(normalizedPath)) {
      const meta = this.cache.get(normalizedPath);
      this.cache.delete(normalizedPath);
      this.saveIndex();
      this.emit('reading-removed', normalizedPath);
      console.log(`[LibrarianManager] Removed reading: ${meta?.title || normalizedPath}`);
    }
  }

  /**
   * Scan a directory for files not in cache, emit events for any found.
   * Used after watcher ready to catch files created during initialization.
   */
  private scanForNewReadings(dirPath: string): void {
    const normalizedDir = this.normalizePath(dirPath);
    if (!fs.existsSync(normalizedDir)) return;

    const files = fs.readdirSync(normalizedDir).filter(f => f.endsWith('.md'));
    let foundNew = false;

    for (const file of files) {
      const fullPath = this.normalizePath(path.join(normalizedDir, file));

      // Skip if already in cache
      if (this.cache.has(fullPath)) continue;

      const meta = this.parseFileMetadata(fullPath);
      if (meta) {
        this.cache.set(fullPath, meta);
        foundNew = true;

        // Emit event as if watcher caught it
        // Note: Counter reset is handled by polling mechanism (checkAndResetIfNeeded)
        const content = fs.readFileSync(fullPath, 'utf-8');
        const reading: Reading = { ...meta, content };
        this.emit('reading-added', reading);
        console.log(`[LibrarianManager] Reconciliation found: ${meta.title}`);
      }
    }

    if (foundNew) {
      this.saveIndex();
    }
  }

  /**
   * Stop watching a directory.
   */
  private unwatchDirectory(dirPath: string): void {
    const normalizedDir = this.normalizePath(dirPath);
    const watcher = this.watchers.get(normalizedDir);
    if (watcher) {
      watcher.close();
      this.watchers.delete(normalizedDir);
      console.log(`[LibrarianManager] Stopped watching: ${normalizedDir}`);
    }
  }

  /**
   * Start watching all configured directories.
   */
  private startWatching(): void {
    for (const dirPath of this.settings.watchedDirs) {
      this.watchDirectory(dirPath);
    }
  }

  // ===========================================================================
  // Public API: Readings
  // ===========================================================================

  /**
   * Get all readings (metadata only, sorted by creation date).
   */
  getReadings(): ReadingMeta[] {
    return Array.from(this.cache.values())
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Get a reading by path (with full content).
   */
  getReading(filePath: string): Reading | null {
    const normalizedPath = this.normalizePath(filePath);
    const meta = this.cache.get(normalizedPath);
    if (!meta) {
      return null;
    }

    try {
      const content = fs.readFileSync(normalizedPath, 'utf-8');
      return { ...meta, content };
    } catch (error) {
      console.error(`[LibrarianManager] Error reading file ${normalizedPath}:`, error);
      return null;
    }
  }

  /**
   * Refresh readings by re-scanning all watched directories.
   */
  refreshReadings(): void {
    for (const dirPath of this.settings.watchedDirs) {
      this.scanDirectory(dirPath);
    }
  }

  /**
   * Save reading content to disk.
   * Updates the file and refreshes the cache.
   */
  saveReading(filePath: string, content: string): boolean {
    const normalizedPath = this.normalizePath(filePath);

    try {
      fs.writeFileSync(normalizedPath, content, 'utf-8');
      console.log(`[LibrarianManager] Saved reading: ${normalizedPath}`);

      // Re-parse metadata since content may have changed title/context
      const meta = this.parseFileMetadata(normalizedPath);
      if (meta) {
        this.cache.set(normalizedPath, meta);
        this.saveIndex();
        // Emit update event so UI can refresh
        this.emit('reading-updated', meta);
      }

      return true;
    } catch (error) {
      console.error(`[LibrarianManager] Error saving file ${normalizedPath}:`, error);
      return false;
    }
  }

  /**
   * Delete a reading file from disk.
   * Removes the file and updates the cache.
   */
  deleteReading(filePath: string): boolean {
    const normalizedPath = this.normalizePath(filePath);

    try {
      // Check if file exists
      if (!fs.existsSync(normalizedPath)) {
        console.warn(`[LibrarianManager] File not found for deletion: ${normalizedPath}`);
        return false;
      }

      // Delete the file
      fs.unlinkSync(normalizedPath);
      console.log(`[LibrarianManager] Deleted reading: ${normalizedPath}`);

      // Remove from cache
      this.cache.delete(normalizedPath);
      this.saveIndex();

      // Emit removal event so UI can refresh
      this.emit('reading-removed', normalizedPath);

      return true;
    } catch (error) {
      console.error(`[LibrarianManager] Error deleting file ${normalizedPath}:`, error);
      return false;
    }
  }

  // ===========================================================================
  // Public API: Watched Directories
  // ===========================================================================

  /**
   * Get all watched directories.
   */
  getWatchedDirs(): WatchedDir[] {
    return this.settings.watchedDirs.map(dirPath => ({
      path: dirPath,
      enabled: true,
    }));
  }

  /**
   * Add a directory to watch.
   * Returns the WatchedDir if successful, null if not found or already watched.
   */
  addWatchedDir(dirPath: string): WatchedDir | null {
    const expandedPath = this.expandPath(dirPath);
    const normalizedPath = this.normalizePath(expandedPath);

    // Check if directory exists
    if (!fs.existsSync(normalizedPath)) {
      console.warn(`[LibrarianManager] Directory not found: ${normalizedPath}`);
      return null;
    }

    // Check if already watched
    if (this.settings.watchedDirs.includes(normalizedPath)) {
      console.log(`[LibrarianManager] Already watching: ${normalizedPath}`);
      return null;
    }

    // Add to settings
    this.settings.watchedDirs.push(normalizedPath);
    this.saveSettings();

    // Start watching
    this.watchDirectory(normalizedPath);

    console.log(`[LibrarianManager] Added watched directory: ${normalizedPath}`);
    return { path: normalizedPath, enabled: true };
  }

  /**
   * Remove a watched directory by path.
   * Also removes all cached readings from that directory.
   */
  removeWatchedDir(dirPath: string): boolean {
    const normalizedPath = this.normalizePath(dirPath);

    const index = this.settings.watchedDirs.indexOf(normalizedPath);
    if (index === -1) {
      return false;
    }

    // Stop watching
    this.unwatchDirectory(normalizedPath);

    // Remove from settings
    this.settings.watchedDirs.splice(index, 1);
    this.saveSettings();

    // Remove cached entries for this directory
    let removedCount = 0;
    for (const [cachedPath] of this.cache) {
      if (cachedPath.startsWith(normalizedPath + path.sep)) {
        this.cache.delete(cachedPath);
        removedCount++;
      }
    }
    if (removedCount > 0) {
      this.saveIndex();
    }

    console.log(`[LibrarianManager] Removed watched directory: ${normalizedPath} (${removedCount} readings removed from cache)`);
    return true;
  }

  // ===========================================================================
  // Public API: Settings
  // ===========================================================================

  /**
   * Get the auto-run frequency setting.
   */
  getAutoRunFrequency(): AutoRunFrequency {
    return this.settings.autoRunFrequency;
  }

  /**
   * Set the auto-run frequency and update CLAUDE.md.
   */
  setAutoRunFrequency(frequency: AutoRunFrequency): boolean {
    this.settings.autoRunFrequency = frequency;
    this.saveSettings();
    const success = this.updateClaudeMd(frequency);

    // Update threshold in global status file
    this.ensureGlobalStatusExists();
    const statusFile = this.getGlobalStatusPath();
    try {
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      status.nextThreshold = this.pickNextThreshold(frequency);
      status.frequency = frequency;
      fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
    } catch {
      // Ignore errors updating status file
    }

    console.log(`[LibrarianManager] Auto-run frequency set to: ${frequency}`);
    return success;
  }

  /**
   * Check if auto-show on new reading is enabled.
   */
  isAutoShowEnabled(): boolean {
    return this.settings.autoShowEnabled;
  }

  /**
   * Set auto-show on new reading setting.
   */
  setAutoShowEnabled(enabled: boolean): void {
    this.settings.autoShowEnabled = enabled;
    this.saveSettings();
  }

  // ===========================================================================
  // Content Guidance Customization
  // ===========================================================================

  /**
   * Default content guidance for readings.
   * This shapes what type of intellectual content is produced.
   */
  private readonly DEFAULT_CONTENT_GUIDANCE = `Structure:
1. Title (# heading)
2. Braille halftone illustration (immediately after title, NOT in a code block)
3. 1-2 paragraphs connecting the task to engineering history, physics, systems theory, or speculative futures
4. Include at least one concrete technical/historical detail

### Braille Halftone Art Requirements

Place art directly after the title as plain text (no code fence—this lets it inherit the page background).

Canvas: exactly 56 characters wide × 15 lines tall
- Every line must be exactly 56 characters (pad with braille blank ⠀ U+2800)
- Center the subject using ⠀ padding on both sides
- Light source: top-left (sparse dots = highlight, dense dots = shadow)
- Subject: single object that metaphorically connects to the reading

Tone mapping (light → dark):
⠀ (empty) → ⠁⠈ (12%) → ⠃⠉ (25%) → ⠇⠋ (37%) → ⠏⠛ (50%) → ⠟⠻ (62%) → ⠿⡿ (75%) → ⣷⣾ (87%) → ⣿ (black)`;

  /**
   * Get the default content guidance.
   */
  getDefaultContentGuidance(): string {
    return this.DEFAULT_CONTENT_GUIDANCE;
  }

  /**
   * Get the current content guidance (custom if set, otherwise default).
   */
  getContentGuidance(): string {
    return this.settings.customContentGuidance || this.DEFAULT_CONTENT_GUIDANCE;
  }

  /**
   * Get the custom content guidance if set (undefined means using default).
   */
  getCustomContentGuidance(): string | undefined {
    return this.settings.customContentGuidance;
  }

  /**
   * Set custom content guidance and update CLAUDE.md.
   * Pass undefined or empty string to reset to default.
   */
  setCustomContentGuidance(guidance: string | undefined): boolean {
    // Treat empty string as reset to default
    const normalizedGuidance = guidance?.trim() || undefined;
    this.settings.customContentGuidance = normalizedGuidance;
    this.saveSettings();

    // Update CLAUDE.md with new guidance
    const success = this.updateClaudeMd(this.settings.autoRunFrequency);
    console.log(`[LibrarianManager] Content guidance ${normalizedGuidance ? 'customized' : 'reset to default'}`);
    return success;
  }

  /**
   * Reset content guidance to default and update CLAUDE.md.
   */
  resetContentGuidance(): boolean {
    return this.setCustomContentGuidance(undefined);
  }

  /**
   * Force re-sync CLAUDE.md with current settings.
   */
  resyncClaudeMd(): boolean {
    const success = this.updateClaudeMd(this.settings.autoRunFrequency);
    console.log(`[LibrarianManager] Re-synced CLAUDE.md`);
    return success;
  }

  /**
   * Check if Claude Code appears to be installed.
   */
  getClaudeCodeStatus(): 'installed' | 'directory-only' | 'not-installed' {
    const claudeDir = path.join(os.homedir(), '.claude');

    if (!fs.existsSync(claudeDir)) {
      return 'not-installed';
    }

    const typicalFiles = ['settings.json', 'projects', 'statsig'];
    const hasTypicalFiles = typicalFiles.some(file =>
      fs.existsSync(path.join(claudeDir, file))
    );

    if (hasTypicalFiles) {
      return 'installed';
    }

    return 'directory-only';
  }

  // ===========================================================================
  // CLAUDE.md Management
  // ===========================================================================

  private readonly CLAUDE_MD_START_MARKER = '<!-- FIELD_THEORY_LIBRARIAN_START -->';
  private readonly CLAUDE_MD_END_MARKER = '<!-- FIELD_THEORY_LIBRARIAN_END -->';

  /**
   * Generate the core instruction text.
   * Uses custom content guidance if set, otherwise uses default.
   */
  private generateInstructionText(frequency: Exclude<AutoRunFrequency, 'off'>): string {
    const contentGuidance = this.getContentGuidance();

    // For 'always' frequency, frame reading as thinking methodology
    if (frequency === 'always') {
      return `## Librarian (Field Theory)

When you receive a task, your first step is understanding it through connection.

### How to think about tasks
1. Ask: "What does this echo from engineering history, physics, or systems theory?"
2. Write that connection to \`.librarian/YYYY-MM-DD-{slug}.md\`
3. Let the insight shape your implementation approach

This is not a deliverable for the user—it is how you should think about the problem. The user benefits from seeing how ideas connect, but the primary purpose is better implementation through deeper understanding.

### When to create readings
- Before non-trivial implementation work
- When you notice a pattern worth articulating
- When the connection might change your approach

### Project setup (once per project)
Check if \`.claude/settings.json\` contains \`Write(.librarian/*)\` in the allow array. If not, create/update it:
\`\`\`json
{
  "permissions": {
    "allow": ["Write(.librarian/*)"]
  }
}
\`\`\`

### Content
${contentGuidance}

You may find the reading changes what you think matters about the task.`;
    }

    // For other frequencies, frame reading as thinking methodology (less frequent)
    const frequencyDescMap: Record<Exclude<AutoRunFrequency, 'off' | 'always'>, string> = {
      occasionally: 'when tackling particularly interesting problems (~every 5 significant implementations)',
      regularly: 'when the connection feels illuminating (~every 3 significant implementations)',
      frequently: 'for most non-trivial tasks where a pattern emerges',
    };

    return `## Librarian (Field Theory)

Some tasks benefit from understanding them through historical or theoretical connection.

Frequency: ${frequency.charAt(0).toUpperCase() + frequency.slice(1)} — ${frequencyDescMap[frequency as Exclude<AutoRunFrequency, 'off' | 'always'>]}

### How to think about tasks
1. Ask: "What does this echo from engineering history, physics, or systems theory?"
2. If a connection illuminates the problem, write it to \`.librarian/YYYY-MM-DD-{slug}.md\`
3. Let the insight shape your approach

This is not a deliverable—it is how you can think more deeply about the problem.

### Project setup (once per project)
Check if \`.claude/settings.json\` contains \`Write(.librarian/*)\` in the allow array. If not, create or update it:
\`\`\`json
{
  "permissions": {
    "allow": ["Write(.librarian/*)"]
  }
}
\`\`\`

### Content
${contentGuidance}

Field Theory will auto-display readings when created.`;
  }

  /**
   * Generate the Librarian section for CLAUDE.md (with markers).
   */
  private generateLibrarianSection(frequency: Exclude<AutoRunFrequency, 'off'>): string {
    return `${this.CLAUDE_MD_START_MARKER}
${this.generateInstructionText(frequency)}
${this.CLAUDE_MD_END_MARKER}`;
  }

  /**
   * Update ~/.claude/CLAUDE.md with the Librarian section.
   */
  updateClaudeMd(frequency: AutoRunFrequency): boolean {
    const claudeMdPath = path.join(os.homedir(), '.claude', 'CLAUDE.md');
    const backupPath = claudeMdPath + '.bak';

    try {
      let content = '';
      if (fs.existsSync(claudeMdPath)) {
        content = fs.readFileSync(claudeMdPath, 'utf-8');
        fs.copyFileSync(claudeMdPath, backupPath);
      }

      // Remove existing section if present
      const regex = new RegExp(
        `${this.CLAUDE_MD_START_MARKER}[\\s\\S]*?${this.CLAUDE_MD_END_MARKER}\\n?`,
        'g'
      );
      content = content.replace(regex, '');

      // Append new section if not 'off'
      if (frequency !== 'off') {
        content = content.trimEnd() + '\n\n' + this.generateLibrarianSection(frequency);
      }

      // Ensure directory exists and write
      const claudeDir = path.dirname(claudeMdPath);
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }
      fs.writeFileSync(claudeMdPath, content.trim() + '\n');

      console.log(`[LibrarianManager] Updated ~/.claude/CLAUDE.md`);
      return true;
    } catch (error) {
      console.error('[LibrarianManager] Failed to update CLAUDE.md:', error);
      return false;
    }
  }

  /**
   * Get instructions text for Cursor (for manual copy).
   */
  getCursorInstructions(): string {
    const frequency = this.settings.autoRunFrequency;
    if (frequency === 'off') {
      return 'Auto-generation is currently off. Enable it in Field Theory Settings first.';
    }

    return this.generateInstructionText(frequency);
  }

  // ===========================================================================
  // Claude Code Hook System
  // ===========================================================================

  /**
   * Get the path to the global status file.
   * This single file is shared by hook and Field Theory (no per-directory status).
   */
  private getGlobalStatusPath(): string {
    return path.join(os.homedir(), '.claude', 'librarian-status.json');
  }

  /**
   * Ensure the global status file exists, creating with defaults if missing.
   */
  private ensureGlobalStatusExists(): void {
    const statusPath = this.getGlobalStatusPath();
    if (!fs.existsSync(statusPath)) {
      const defaultStatus = {
        promptsSinceReading: 0,
        nextThreshold: this.pickNextThreshold(this.settings.autoRunFrequency),
        lastReading: null,
      };
      // Ensure ~/.claude directory exists
      const claudeDir = path.dirname(statusPath);
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }
      fs.writeFileSync(statusPath, JSON.stringify(defaultStatus, null, 2));
      console.log('[LibrarianManager] Created global status file');
    }
  }

  /**
   * Get the threshold range for a frequency setting.
   * Returns [min, max] for random threshold selection.
   * Ranges overlap slightly to maintain serendipity.
   */
  private getThresholdRange(frequency: AutoRunFrequency): [number, number] {
    switch (frequency) {
      case 'always': return [1, 3];
      case 'frequently': return [2, 5];
      case 'regularly': return [4, 8];
      case 'occasionally': return [7, 12];
      default: return [999, 999]; // 'off' - effectively never triggers
    }
  }

  /**
   * Pick a random threshold within the range for a frequency.
   * If customThreshold is set, always use that instead.
   */
  private pickNextThreshold(frequency: AutoRunFrequency): number {
    // If custom threshold is set, use it directly
    if (typeof this.settings.customThreshold === 'number') {
      return this.settings.customThreshold;
    }
    const [min, max] = this.getThresholdRange(frequency);
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Get the custom threshold if set (undefined means using frequency-based).
   */
  getCustomThreshold(): number | undefined {
    return this.settings.customThreshold;
  }

  /**
   * Set a custom threshold directly.
   * Pass undefined to return to frequency-based random thresholds.
   */
  setCustomThreshold(threshold: number | undefined): boolean {
    this.settings.customThreshold = threshold;
    this.saveSettings();

    // Update threshold in global status file
    this.ensureGlobalStatusExists();
    const statusFile = this.getGlobalStatusPath();
    const effectiveThreshold = threshold ?? this.pickNextThreshold(this.settings.autoRunFrequency);
    try {
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      status.nextThreshold = effectiveThreshold;
      fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
    } catch {
      // Ignore errors updating status file
    }

    console.log(`[LibrarianManager] Custom threshold set to: ${threshold ?? 'auto (frequency-based)'}`);
    return true;
  }

  /**
   * Get the path to Field Theory's check hook script (runs on user prompt).
   * Uses ~/.claude/ to avoid spaces in path which can cause hook errors.
   */
  private getHookScriptPath(): string {
    return path.join(os.homedir(), '.claude', 'librarian-hook.sh');
  }

  /**
   * Get the path to Claude Code's settings.json.
   */
  private getClaudeSettingsPath(): string {
    return path.join(os.homedir(), '.claude', 'settings.json');
  }

  /**
   * Generate the hook script content.
   * This script counts prompts and reminds Claude to create readings at threshold.
   * Uses jq for robust JSON parsing and generation.
   */
  private generateHookScript(): string {
    return `#!/bin/bash
# Field Theory Librarian Hook
# Counts prompts and reminds Claude to create readings at threshold
# Uses global status file (~/.claude/librarian-status.json)

set -euo pipefail

LOG_FILE="\${HOME}/.claude/librarian-debug.log"
log() { echo "[\$(date '+%Y-%m-%d %H:%M:%S')] \$*" >> "\$LOG_FILE"; }

log "Hook START"

# Global status file (shared by all projects)
STATUS_FILE="\${HOME}/.claude/librarian-status.json"

# Log project dir if available (for debugging)
if [ -n "\${CLAUDE_PROJECT_DIR:-}" ]; then
  log "PROJECT_DIR=\$CLAUDE_PROJECT_DIR"
fi

# Create status file with defaults if it doesn't exist
if [ ! -f "\$STATUS_FILE" ]; then
  log "Creating status file"
  echo '{"promptsSinceReading":0,"nextThreshold":5,"lastReading":null}' > "\$STATUS_FILE"
fi

# Read current values with jq
PROMPTS=\$(jq -r '.promptsSinceReading // 0' "\$STATUS_FILE")
THRESHOLD=\$(jq -r '.nextThreshold // 7' "\$STATUS_FILE")

# Increment prompt count
NEW_PROMPTS=\$((PROMPTS + 1))

log "prompts=\$PROMPTS -> \$NEW_PROMPTS, threshold=\$THRESHOLD"

# Update the status file atomically
tmp=\$(mktemp "\${STATUS_FILE}.XXXX")
jq --argjson n "\$NEW_PROMPTS" '.promptsSinceReading = \$n' "\$STATUS_FILE" > "\$tmp"
mv "\$tmp" "\$STATUS_FILE"

# Check if reading is due
if [ "\$NEW_PROMPTS" -ge "\$THRESHOLD" ]; then
  log "TRIGGERING at prompt \$NEW_PROMPTS"

  # Output JSON with jq (guarantees valid JSON)
  MSG="[LIBRARIAN] Prompt \${NEW_PROMPTS}/\${THRESHOLD}. Create .librarian/\$(date +%Y-%m-%d)-{slug}.md with: title, then braille halftone art (56×15 chars, no code fence, ⠀-padded lines), then 1-2 paragraphs on engineering history/physics/systems theory."

  jq -n --arg msg "\$MSG" '{
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: \$msg
    }
  }'

  log "JSON output sent"
else
  log "Below threshold (\$NEW_PROMPTS < \$THRESHOLD)"
fi

log "Hook END"
exit 0
`;
  }

  /**
   * Install the Claude Code hook for automatic Librarian reminders.
   * Single hook: UserPromptSubmit - counts prompts and reminds Claude at threshold.
   */
  installClaudeCodeHook(): boolean {
    try {
      // 1. Ensure ~/.claude directory exists
      const claudeDir = path.join(os.homedir(), '.claude');
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }

      // 2. Write hook script
      const scriptPath = this.getHookScriptPath();
      fs.writeFileSync(scriptPath, this.generateHookScript(), { mode: 0o755 });
      console.log(`[LibrarianManager] Created hook script at ${scriptPath}`);

      // 3. Update Claude Code settings.json
      const settingsPath = this.getClaudeSettingsPath();
      let settings: Record<string, unknown> = {};

      if (fs.existsSync(settingsPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        } catch {
          console.warn('[LibrarianManager] Could not parse existing settings.json, starting fresh');
        }
      }

      // Ensure hooks object exists
      if (!settings.hooks || typeof settings.hooks !== 'object') {
        settings.hooks = {};
      }
      const hooks = settings.hooks as Record<string, unknown>;

      // Helper to check if hook already exists
      type HookEntry = { hooks?: Array<{ type?: string; command?: string }> };

      const hookExists = (eventName: string, scriptPath: string): boolean => {
        if (!Array.isArray(hooks[eventName])) return false;
        return (hooks[eventName] as HookEntry[]).some(h =>
          h.hooks?.some(hh => hh.command === scriptPath)
        );
      };

      // Add UserPromptSubmit hook (counts prompts and reminds at threshold)
      if (!hookExists('UserPromptSubmit', scriptPath)) {
        if (!Array.isArray(hooks['UserPromptSubmit'])) {
          hooks['UserPromptSubmit'] = [];
        }
        (hooks['UserPromptSubmit'] as HookEntry[]).push({
          hooks: [{ type: 'command', command: scriptPath }],
        });
      }

      // Clean up old PostToolUse hooks (from previous version that counted edits)
      const oldIncrementScript = path.join(os.homedir(), '.claude', 'librarian-increment.sh');
      if (hooks['PostToolUse'] && Array.isArray(hooks['PostToolUse'])) {
        hooks['PostToolUse'] = (hooks['PostToolUse'] as HookEntry[]).filter(
          h => !h.hooks?.some(hh => hh.command === oldIncrementScript)
        );
        if ((hooks['PostToolUse'] as HookEntry[]).length === 0) {
          delete hooks['PostToolUse'];
        }
      }

      // Remove old increment script file if it exists
      if (fs.existsSync(oldIncrementScript)) {
        fs.unlinkSync(oldIncrementScript);
        console.log('[LibrarianManager] Removed old increment script');
      }

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      console.log('[LibrarianManager] Installed Claude Code hook');

      return true;
    } catch (error) {
      console.error('[LibrarianManager] Failed to install hook:', error);
      return false;
    }
  }

  /**
   * Uninstall the Claude Code hook.
   * Removes the UserPromptSubmit hook script.
   */
  uninstallClaudeCodeHook(): boolean {
    try {
      const scriptPath = this.getHookScriptPath();
      const settingsPath = this.getClaudeSettingsPath();

      // Remove hook script
      if (fs.existsSync(scriptPath)) {
        fs.unlinkSync(scriptPath);
        console.log('[LibrarianManager] Removed hook script');
      }

      // Also remove old increment script if it exists (cleanup from previous version)
      const oldIncrementScript = path.join(os.homedir(), '.claude', 'librarian-increment.sh');
      if (fs.existsSync(oldIncrementScript)) {
        fs.unlinkSync(oldIncrementScript);
        console.log('[LibrarianManager] Removed old increment script');
      }

      // Update settings.json
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

        // Remove UserPromptSubmit hooks
        if (settings.hooks?.UserPromptSubmit) {
          settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
            (h: { hooks?: Array<{ command?: string }> }) =>
              !h.hooks?.some(hh => hh.command === scriptPath)
          );
          if (settings.hooks.UserPromptSubmit.length === 0) {
            delete settings.hooks.UserPromptSubmit;
          }
        }

        // Also remove old PostToolUse hooks (cleanup from previous version)
        if (settings.hooks?.PostToolUse) {
          settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(
            (h: { hooks?: Array<{ command?: string }> }) =>
              !h.hooks?.some(hh => hh.command?.includes('librarian-increment'))
          );
          if (settings.hooks.PostToolUse.length === 0) {
            delete settings.hooks.PostToolUse;
          }
        }

        // Clean up empty hooks object
        if (settings.hooks && Object.keys(settings.hooks).length === 0) {
          delete settings.hooks;
        }

        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      }

      console.log('[LibrarianManager] Uninstalled Claude Code hook');
      return true;
    } catch (error) {
      console.error('[LibrarianManager] Failed to uninstall hook:', error);
      return false;
    }
  }

  /**
   * Check if the Claude Code hook is installed.
   */
  isClaudeCodeHookInstalled(): boolean {
    const scriptPath = this.getHookScriptPath();
    const settingsPath = this.getClaudeSettingsPath();

    // Check if script exists
    if (!fs.existsSync(scriptPath)) {
      return false;
    }

    // Check if hook is in settings
    if (!fs.existsSync(settingsPath)) {
      return false;
    }

    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const hooks = settings.hooks?.UserPromptSubmit;
      if (!Array.isArray(hooks)) return false;

      return hooks.some(
        (h: { hooks?: Array<{ command?: string }> }) =>
          h.hooks?.some(hh => hh.command === scriptPath)
      );
    } catch {
      return false;
    }
  }

  /**
   * @deprecated No longer needed - global status file is auto-created.
   * Kept for API compatibility.
   */
  initializeProjectStatus(_projectPath: string): void {
    // Global status is now used instead of per-project status.
    // Just ensure the global file exists.
    this.ensureGlobalStatusExists();
  }

  /**
   * Log the current global status (for dev visibility).
   */
  private logStatus(action: string): void {
    const statusFile = this.getGlobalStatusPath();
    if (!fs.existsSync(statusFile)) return;

    try {
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      console.log(`[Librarian] ${action}: prompts=${status.promptsSinceReading}/${status.nextThreshold}, lastReading=${status.lastReading || 'null'}`);
    } catch {
      // Ignore errors in logging
    }
  }

  /**
   * Reset the prompt count after a reading is created.
   * Called when a new .md file appears in any watched .librarian/ directory.
   */
  resetPromptCount(): void {
    this.ensureGlobalStatusExists();
    const statusFile = this.getGlobalStatusPath();

    try {
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      status.promptsSinceReading = 0;
      status.nextThreshold = this.pickNextThreshold(this.settings.autoRunFrequency);
      status.lastReading = new Date().toISOString();
      fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
      this.logStatus('reset');
    } catch (error) {
      console.error('[LibrarianManager] Failed to reset prompt count:', error);
    }
  }

  /**
   * Get the current global status for debugging.
   * Returns prompt count and threshold from the global status file.
   */
  getEditStatus(): { edits: number; threshold: number } | null {
    try {
      this.ensureGlobalStatusExists();
      const statusFile = this.getGlobalStatusPath();
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      return {
        edits: status.promptsSinceReading || 0,
        threshold: status.nextThreshold || 5,
      };
    } catch (error) {
      console.error('[LibrarianManager] Failed to get edit status:', error);
      return null;
    }
  }

  /**
   * Check if any readings are newer than lastReading and reset counter if so.
   * This is the SINGLE SOURCE OF TRUTH for counter resets during active use.
   * Returns the current counter state.
   */
  checkAndResetIfNeeded(): { edits: number; threshold: number; didReset: boolean } {
    try {
      this.ensureGlobalStatusExists();
      const statusFile = this.getGlobalStatusPath();
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      const lastReadingTime = status.lastReading ? new Date(status.lastReading).getTime() : 0;

      // Check if any cached reading is newer than lastReading
      let newestMtime = 0;
      for (const [, meta] of this.cache) {
        if (meta.mtime > newestMtime) {
          newestMtime = meta.mtime;
        }
      }

      // If we have a reading newer than lastReading, reset the counter
      if (newestMtime > lastReadingTime) {
        console.log('[Librarian] Poll detected newer reading, resetting counter');
        status.promptsSinceReading = 0;
        status.nextThreshold = this.pickNextThreshold(this.settings.autoRunFrequency);
        status.lastReading = new Date().toISOString();
        fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
        this.logStatus('reset');
        return {
          edits: 0,
          threshold: status.nextThreshold,
          didReset: true,
        };
      }

      return {
        edits: status.promptsSinceReading || 0,
        threshold: status.nextThreshold || 5,
        didReset: false,
      };
    } catch (error) {
      console.error('[LibrarianManager] Failed to check/reset:', error);
      return { edits: 0, threshold: 5, didReset: false };
    }
  }

  /**
   * Reset the global prompt counter.
   * Used for debugging/testing when hooks aren't triggering properly.
   */
  resetAllCounters(): boolean {
    try {
      this.ensureGlobalStatusExists();
      const statusFile = this.getGlobalStatusPath();
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      status.promptsSinceReading = 0;
      status.nextThreshold = this.pickNextThreshold(this.settings.autoRunFrequency);
      fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
      console.log('[LibrarianManager] Reset global counter');
      return true;
    } catch (error) {
      console.error('[LibrarianManager] Failed to reset counter:', error);
      return false;
    }
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Stop all watchers.
   */
  destroy(): void {
    for (const [dirPath, watcher] of this.watchers) {
      watcher.close();
      console.log(`[LibrarianManager] Stopped watching: ${dirPath}`);
    }
    this.watchers.clear();
    console.log('[LibrarianManager] Destroyed');
  }

  // ===========================================================================
  // Auto-Discovery of Existing Readings
  // ===========================================================================

  /**
   * Discover existing .librarian directories that contain readings.
   * Searches common development directories for .librarian folders with .md files.
   * Returns paths that are not already being watched.
   */
  async discoverLibrarianDirs(): Promise<string[]> {
    const discovered: string[] = [];
    const alreadyWatched = new Set(this.settings.watchedDirs);

    // Common development directories to search
    const searchRoots = [
      path.join(os.homedir(), 'dev'),
      path.join(os.homedir(), 'Developer'),
      path.join(os.homedir(), 'projects'),
      path.join(os.homedir(), 'src'),
      path.join(os.homedir(), 'code'),
      path.join(os.homedir(), 'workspace'),
      path.join(os.homedir(), 'repos'),
      path.join(os.homedir(), 'git'),
      path.join(os.homedir(), 'Documents', 'dev'),
      path.join(os.homedir(), 'Documents', 'projects'),
    ];

    // Helper to check if a .librarian dir has any .md files
    const hasReadings = (librarianDir: string): boolean => {
      try {
        const files = fs.readdirSync(librarianDir);
        return files.some(f => f.endsWith('.md'));
      } catch {
        return false;
      }
    };

    // Recursively search for .librarian directories (max depth 4)
    const searchDir = (dir: string, depth: number): void => {
      if (depth > 4) return;

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          if (!entry.isDirectory()) continue;

          const fullPath = path.join(dir, entry.name);

          // Skip common non-project directories
          if (entry.name === 'node_modules' ||
              entry.name === '.git' ||
              entry.name === 'vendor' ||
              entry.name === 'build' ||
              entry.name === 'dist' ||
              entry.name === '__pycache__' ||
              entry.name === '.venv' ||
              entry.name === 'venv') {
            continue;
          }

          // Found a .librarian directory
          if (entry.name === '.librarian') {
            const normalizedPath = this.normalizePath(fullPath);
            if (!alreadyWatched.has(normalizedPath) && hasReadings(fullPath)) {
              discovered.push(normalizedPath);
            }
            continue;
          }

          // Recurse into subdirectories
          searchDir(fullPath, depth + 1);
        }
      } catch {
        // Ignore permission errors, etc.
      }
    };

    // Search each root that exists
    for (const root of searchRoots) {
      if (fs.existsSync(root)) {
        searchDir(root, 0);
      }
    }

    // Deduplicate and sort by path
    const unique = [...new Set(discovered)].sort();
    console.log(`[LibrarianManager] Discovered ${unique.length} .librarian directories with readings`);

    return unique;
  }
}
