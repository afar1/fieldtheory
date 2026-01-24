import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { EventEmitter } from 'events';
import * as chokidar from 'chokidar';

/**
 * Auto-run frequency for generating readings.
 * @deprecated Kept only for migration. State-enforced mode is now the only option.
 */
export type AutoRunFrequency = 'off' | 'occasionally' | 'regularly' | 'frequently' | 'always';

/**
 * Discovery frequency for artifact creation cadence.
 * Controls how often discoveries (artifacts) are triggered.
 */
export type DiscoveryFrequency = 'often' | 'sometimes' | 'rarely';

/**
 * Configuration for discovery cadence.
 * Uses center-biased randomness (median of 3) to feel natural.
 */
export const DISCOVERY_CONFIG: Record<DiscoveryFrequency, { min: number; max: number; cap: number }> = {
  often:     { min: 5,  max: 9,  cap: 10 },
  sometimes: { min: 7,  max: 13, cap: 14 },
  rarely:    { min: 10, max: 18, cap: 20 },
};

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
  enabled: boolean;                    // Single master toggle
  autoShowEnabled: boolean;
  resumeAfterClose?: boolean;          // If true, reopen to last artifact instead of clipboard
  librarianSetupComplete?: boolean;    // True after setup wizard completes
  // State-enforced mode settings (the only mode now)
  stateEnforcedThreshold?: number;     // Prompts before job creation (default: 3)
  stateEnforcedRuleContent?: string;   // Custom rule content (the "job language")
  // Discovery cadence settings
  discoveryFrequency?: DiscoveryFrequency;  // Controls discovery timing (default: 'sometimes')
  // User expertise context
  userExpertiseContext?: string;       // User's background/interests (max 400 chars)
  expertiseInsertMode?: 'insert' | 'append';  // How expertise is included in prompt (admin-only)
  // Legacy fields (kept for migration only)
  autoRunFrequency?: AutoRunFrequency; // @deprecated
  triggerMode?: string;                // @deprecated - always state-enforced now
  promptThreshold?: number;            // @deprecated
  customThreshold?: number;            // @deprecated
  customContentGuidance?: string;      // @deprecated
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

    // Ensure central artifacts directory exists and is watched by default
    this.ensureCentralArtifactsDir();

    // Load index (cached metadata)
    this.loadIndex();

    // Start watching configured directories
    this.startWatching();

    // Log current status for all projects with .librarian directories
    this.logAllProjectStatuses();

    console.log('[LibrarianManager] Initialized (file-only mode)');
  }

  /**
   * Log global status at startup.
   * Resets for offline-created artifacts are handled by scanForNewReadings()
   * which emits reading-added events for files not in cache.
   */
  private logAllProjectStatuses(): void {
    this.logStatus('startup');
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
   * Load settings from JSON file with migration from v1 format.
   */
  private loadSettings(): LibrarianSettings {
    const defaults: LibrarianSettings = {
      watchedDirs: [],
      enabled: true,
      autoShowEnabled: true,
      librarianSetupComplete: undefined,
      stateEnforcedThreshold: 3,
      stateEnforcedRuleContent: undefined,
    };

    try {
      if (fs.existsSync(this.settingsPath)) {
        const data = JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8'));

        // Migrate from v1 format if needed
        let enabled = data.enabled;

        // Migration: convert autoRunFrequency to enabled
        if (enabled === undefined && data.autoRunFrequency !== undefined) {
          enabled = data.autoRunFrequency !== 'off';
          console.log('[LibrarianManager] Migrated autoRunFrequency to enabled:', enabled);
        }

        return {
          watchedDirs: data.watchedDirs || defaults.watchedDirs,
          enabled: enabled ?? defaults.enabled,
          autoShowEnabled: data.autoShowEnabled ?? defaults.autoShowEnabled,
          resumeAfterClose: data.resumeAfterClose,
          librarianSetupComplete: data.librarianSetupComplete,
          // State-enforced mode settings (the only mode now)
          stateEnforcedThreshold: data.stateEnforcedThreshold ?? defaults.stateEnforcedThreshold,
          stateEnforcedRuleContent: data.stateEnforcedRuleContent || undefined,
          // Discovery and expertise settings
          discoveryFrequency: data.discoveryFrequency,
          userExpertiseContext: data.userExpertiseContext,
          expertiseInsertMode: data.expertiseInsertMode,
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

      // Save migrated settings (with new v2 fields)
      const settings: LibrarianSettings = {
        watchedDirs,
        enabled: autoRunFrequency !== 'off',
        triggerMode: 'prompt',
        promptThreshold: 5,
        autoShowEnabled,
        // Keep legacy fields for reference
        autoRunFrequency,
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
    const isActuallyNew = !cached;
    const isUpdated = cached && meta.mtime > cached.mtime;

    // Skip if file hasn't changed (same mtime as cached)
    if (cached && meta.mtime === cached.mtime) {
      return;
    }

    this.cache.set(normalizedPath, meta);
    this.saveIndex();

    if (isActuallyNew) {
      // Emit event - coordinator in index.ts handles counter reset and auto-show
      const content = fs.readFileSync(normalizedPath, 'utf-8');
      const reading: Reading = { ...meta, content };
      this.emit('reading-added', reading);
      console.log(`[LibrarianManager] New artifact: ${meta.title}`);
    } else if (isUpdated) {
      // Existing file was modified - just update UI, no auto-show
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

        // Emit event - coordinator in index.ts handles counter reset
        const content = fs.readFileSync(fullPath, 'utf-8');
        const reading: Reading = { ...meta, content };
        this.emit('reading-added', reading);
        console.log(`[LibrarianManager] Reconciliation found artifact: ${meta.title}`);
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
    // Also watch for newly discovered projects from state-enforced hook
    this.watchDiscoveryFile();
  }

  /**
   * Watch the discovery file for auto-adding new watched directories.
   * The state-enforced hook writes project paths here when creating artifacts.
   */
  private watchDiscoveryFile(): void {
    const discoveryFile = path.join(this.getCentralLibrarianDir(), 'discovered_projects.json');

    // Process any existing discovered projects
    this.processDiscoveryFile(discoveryFile);

    // Watch for changes
    const parentDir = path.dirname(discoveryFile);
    if (fs.existsSync(parentDir)) {
      fs.watch(parentDir, (eventType, filename) => {
        if (filename === 'discovered_projects.json') {
          this.processDiscoveryFile(discoveryFile);
        }
      });
    }
  }

  /**
   * Process the discovery file and auto-add any new directories.
   */
  private processDiscoveryFile(discoveryFile: string): void {
    if (!fs.existsSync(discoveryFile)) return;

    try {
      const discovered: string[] = JSON.parse(fs.readFileSync(discoveryFile, 'utf-8'));
      for (const dirPath of discovered) {
        if (!this.settings.watchedDirs.includes(dirPath)) {
          console.log(`[LibrarianManager] Auto-adding discovered directory: ${dirPath}`);
          this.addWatchedDir(dirPath);
        }
      }
    } catch (error) {
      console.error('[LibrarianManager] Error processing discovery file:', error);
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

  // ===========================================================================
  // New Settings API (v2)
  // ===========================================================================

  /**
   * Check if Librarian is enabled.
   */
  isEnabled(): boolean {
    return this.settings.enabled;
  }

  /**
   * Enable or disable Librarian and update CLAUDE.md.
   */
  setEnabled(enabled: boolean): boolean {
    this.settings.enabled = enabled;
    this.saveSettings();
    const success = this.syncClaudeMd();
    console.log(`[LibrarianManager] Enabled set to: ${enabled}`);
    return success;
  }

  /**
   * Check if Librarian setup wizard has been completed.
   */
  isSetupComplete(): boolean {
    return this.settings.librarianSetupComplete === true;
  }

  /**
   * Mark Librarian setup as complete.
   */
  setSetupComplete(complete: boolean): void {
    this.settings.librarianSetupComplete = complete;
    this.saveSettings();
    console.log(`[LibrarianManager] Setup complete set to: ${complete}`);
  }

  // ===========================================================================
  // State-Enforced Mode Settings
  // ===========================================================================

  /**
   * Default rule content for state-enforced mode artifacts.
   */
  private readonly DEFAULT_RULE_CONTENT =
    'Write 2-3 paragraphs connecting the current work to engineering history, physics, or systems theory.\nInclude at least one concrete technical or historical detail.\nNo time references. No fluff.';

  /**
   * Get the state-enforced mode threshold (prompts before job creation).
   */
  getStateEnforcedThreshold(): number {
    return this.settings.stateEnforcedThreshold ?? 3;
  }

  /**
   * Set the state-enforced mode threshold.
   * Also updates the global config if hook is installed.
   */
  setStateEnforcedThreshold(threshold: number): boolean {
    this.settings.stateEnforcedThreshold = threshold;
    this.saveSettings();

    // Update global config if it exists
    const configPath = this.getGlobalStateEnforcedConfigPath();
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config.threshold = threshold;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      } catch {
        // Ignore errors
      }
    }

    console.log(`[LibrarianManager] State-enforced threshold set to: ${threshold}`);
    return true;
  }

  /**
   * Get the default rule content for state-enforced mode.
   */
  getDefaultRuleContent(): string {
    return this.DEFAULT_RULE_CONTENT;
  }

  /**
   * Get the custom rule content if set.
   */
  getCustomRuleContent(): string | undefined {
    return this.settings.stateEnforcedRuleContent;
  }

  /**
   * Set custom rule content for state-enforced mode.
   * Also updates the global config if hook is installed.
   * Pass undefined to reset to default.
   */
  setCustomRuleContent(content: string | undefined): boolean {
    this.settings.stateEnforcedRuleContent = content?.trim() || undefined;
    this.saveSettings();

    // Update global config if it exists
    const configPath = this.getGlobalStateEnforcedConfigPath();
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config.rule_content = content?.trim() || this.DEFAULT_RULE_CONTENT;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      } catch {
        // Ignore errors
      }
    }

    console.log(`[LibrarianManager] Custom rule content ${content ? 'set' : 'cleared'}`);
    return true;
  }

  // ===========================================================================
  // Discovery Frequency Settings
  // ===========================================================================

  /**
   * Get the current discovery frequency setting.
   */
  getDiscoveryFrequency(): DiscoveryFrequency {
    return this.settings.discoveryFrequency || 'sometimes';
  }

  /**
   * Set the discovery frequency and update global status.
   */
  setDiscoveryFrequency(frequency: DiscoveryFrequency): boolean {
    this.settings.discoveryFrequency = frequency;
    this.saveSettings();

    // Update global status with new threshold
    this.ensureGlobalStatusExists();
    const statusFile = this.getGlobalStatusPath();
    try {
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      status.nextThreshold = this.pickNextDiscoveryThreshold();
      status.discoveryFrequency = frequency;
      fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
    } catch {
      // Ignore errors
    }

    console.log(`[LibrarianManager] Discovery frequency set to: ${frequency}`);
    return true;
  }

  // ===========================================================================
  // User Expertise Context
  // ===========================================================================

  /**
   * Get the user's expertise/interests context.
   */
  getUserExpertiseContext(): string | undefined {
    return this.settings.userExpertiseContext;
  }

  /**
   * Set the user's expertise/interests context.
   * Limited to 400 characters.
   */
  setUserExpertiseContext(context: string | undefined): boolean {
    // Enforce 400 char limit
    const trimmed = context?.trim().slice(0, 400) || undefined;
    this.settings.userExpertiseContext = trimmed;
    this.saveSettings();
    this.updateGlobalConfigWithExpertise();
    console.log(`[LibrarianManager] User expertise context ${trimmed ? 'set' : 'cleared'}`);
    return true;
  }

  /**
   * Get the expertise insert mode (admin-only setting).
   */
  getExpertiseInsertMode(): 'insert' | 'append' {
    return this.settings.expertiseInsertMode || 'append';
  }

  /**
   * Set the expertise insert mode (admin-only).
   */
  setExpertiseInsertMode(mode: 'insert' | 'append'): boolean {
    // Note: Admin check is handled at UI level via authAPI.isSuperAdmin()
    this.settings.expertiseInsertMode = mode;
    this.saveSettings();
    this.updateGlobalConfigWithExpertise();
    console.log(`[LibrarianManager] Expertise insert mode set to: ${mode}`);
    return true;
  }

  /**
   * Get the effective rule content with user expertise included.
   */
  getEffectiveRuleContent(): string {
    const baseRule = this.settings.stateEnforcedRuleContent || this.DEFAULT_RULE_CONTENT;
    const expertise = this.settings.userExpertiseContext;

    if (!expertise) {
      return baseRule;
    }

    const mode = this.settings.expertiseInsertMode || 'append';
    if (mode === 'insert') {
      return `The reader: ${expertise}\n\n${baseRule}`;
    } else {
      return `${baseRule}\n\nContext about the reader: ${expertise}`;
    }
  }

  /**
   * Update global config with effective rule content (includes expertise).
   */
  private updateGlobalConfigWithExpertise(): void {
    const configPath = this.getGlobalStateEnforcedConfigPath();
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config.rule_content = this.getEffectiveRuleContent();
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      } catch {
        // Ignore errors
      }
    }
  }

  /**
   * Sync CLAUDE.md with current settings.
   * Called whenever enabled, triggerMode, or content guidance changes.
   */
  syncClaudeMd(): boolean {
    if (!this.settings.enabled) {
      // If disabled, remove the Librarian section
      return this.removeLibrarianSection();
    }
    return this.writeLibrarianSection();
  }

  // ===========================================================================
  // Legacy Settings API (deprecated, kept for backward compatibility)
  // ===========================================================================

  /**
   * Get the auto-run frequency setting.
   * @deprecated Use isEnabled() + getTriggerMode() instead
   */
  getAutoRunFrequency(): AutoRunFrequency {
    // Map new settings to legacy frequency for backward compatibility
    if (!this.settings.enabled) return 'off';
    return this.settings.autoRunFrequency || 'always';
  }

  /**
   * Set the auto-run frequency and update CLAUDE.md.
   * @deprecated Use setEnabled() + setTriggerMode() instead
   */
  setAutoRunFrequency(frequency: AutoRunFrequency): boolean {
    // Map legacy frequency to new settings
    this.settings.enabled = frequency !== 'off';
    this.settings.autoRunFrequency = frequency;
    this.saveSettings();
    const success = this.syncClaudeMd();

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

  /**
   * Check if resume after close is enabled.
   * When true, reopening the window returns to the last artifact instead of clipboard.
   */
  isResumeAfterCloseEnabled(): boolean {
    return this.settings.resumeAfterClose ?? false;
  }

  /**
   * Set resume after close setting.
   */
  setResumeAfterClose(enabled: boolean): void {
    this.settings.resumeAfterClose = enabled;
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
    const success = this.syncClaudeMd();
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
    const success = this.syncClaudeMd();
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
   * Generate instruction text based on trigger mode (v2).
   * This is the new method that uses enabled/triggerMode instead of frequency.
   */
  private generateInstructionTextV2(): string {
    const contentGuidance = this.getContentGuidance();
    const mode = this.settings.triggerMode;

    if (mode === 'judgment') {
      // AI judgment mode - AI decides when to create based on work volume
      return `## Librarian (Field Theory)

After substantial work in this session—significant implementation, multiple file changes, or ~50K tokens of meaningful problem-solving—create a \`.librarian/\` artifact.

Use your judgment: not every session needs one, but meaty work sessions should produce reflection connecting your work to engineering history, physics, or systems theory.

### How to think about tasks
1. Ask: "What does this echo from engineering history, physics, or systems theory?"
2. When the work feels substantial, write that connection to \`.librarian/YYYY-MM-DD-{slug}.md\`
3. Let the insight shape your implementation approach

This is not a deliverable for the user—it is how you should think about the problem.

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

Field Theory will auto-display readings when created.`;
    }

    // Prompt mode - hook will inject reminder at threshold
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

  /**
   * Get the path to the Librarian command file.
   * This is the single source of truth for Librarian instructions.
   */
  private getLibrarianCommandPath(): string {
    return path.join(os.homedir(), '.fieldtheory', 'commands', 'librarian.md');
  }

  /**
   * Write the full Librarian instructions to ~/.fieldtheory/commands/librarian.md
   * This is the single source of truth that CLAUDE.md references.
   */
  private writeLibrarianCommandFile(): boolean {
    const commandPath = this.getLibrarianCommandPath();
    const commandDir = path.dirname(commandPath);

    try {
      // Ensure directory exists
      if (!fs.existsSync(commandDir)) {
        fs.mkdirSync(commandDir, { recursive: true });
      }

      const contentGuidance = this.getContentGuidance();
      const mode = this.settings.triggerMode;
      const threshold = this.settings.promptThreshold;

      // Build the command file content with conditionals pre-rendered
      let content: string;

      if (mode === 'judgment') {
        content = `# Librarian (Field Theory)

After substantial work in this session—significant implementation, multiple file changes, or ~50K tokens of meaningful problem-solving—create a \`.librarian/\` artifact.

Use your judgment: not every session needs one, but meaty work sessions should produce reflection connecting your work to engineering history, physics, or systems theory.

## How to think about tasks
1. Ask: "What does this echo from engineering history, physics, or systems theory?"
2. When the work feels substantial, write that connection to \`.librarian/YYYY-MM-DD-{slug}.md\`
3. Let the insight shape your implementation approach

This is not a deliverable for the user—it is how you should think about the problem.

## Content
${contentGuidance}

Field Theory will auto-display readings when created.
`;
      } else {
        // Prompt count mode
        content = `# Librarian (Field Theory)

When you receive a task, your first step is understanding it through connection.

**Trigger**: Every ${threshold} prompts (tracked by Field Theory hook)

## How to think about tasks
1. Ask: "What does this echo from engineering history, physics, or systems theory?"
2. Write that connection to \`.librarian/YYYY-MM-DD-{slug}.md\`
3. Let the insight shape your implementation approach

This is not a deliverable for the user—it is how you should think about the problem. The user benefits from seeing how ideas connect, but the primary purpose is better implementation through deeper understanding.

## When to create readings
- Before non-trivial implementation work
- When you notice a pattern worth articulating
- When the connection might change your approach

## Content
${contentGuidance}

You may find the reading changes what you think matters about the task.
`;
      }

      fs.writeFileSync(commandPath, content.trim() + '\n');
      console.log(`[LibrarianManager] Wrote Librarian command file to ${commandPath}`);
      return true;
    } catch (error) {
      console.error('[LibrarianManager] Failed to write command file:', error);
      return false;
    }
  }

  /**
   * Generate the Librarian section for CLAUDE.md.
   * Now just contains reference to command file + permission rule.
   */
  private generateLibrarianSectionV2(): string {
    const commandPath = this.getLibrarianCommandPath();

    return `${this.CLAUDE_MD_START_MARKER}
## Librarian (Field Theory)

Before non-trivial implementations, provide a short reading via the Librarian:

[run this command: librarian.md]
${commandPath}

Store each reading in \`.librarian/\` with a unique filename.

This should feel serendipitous—not every change, just when there's meaningful wait time. Use your discretion.

### Project setup (once per project)
Check if \`.claude/settings.json\` contains \`Write(.librarian/*)\` in the allow array. If not, create/update it:
\`\`\`json
{
  "permissions": {
    "allow": ["Write(.librarian/*)"]
  }
}
\`\`\`
${this.CLAUDE_MD_END_MARKER}`;
  }

  /**
   * Write the Librarian section to CLAUDE.md.
   * Also writes the command file that CLAUDE.md references.
   */
  private writeLibrarianSection(): boolean {
    // First write the command file (single source of truth)
    if (!this.writeLibrarianCommandFile()) {
      console.error('[LibrarianManager] Failed to write command file, aborting CLAUDE.md update');
      return false;
    }

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

      // Append new section (reference to command file + permission rule)
      content = content.trimEnd() + '\n\n' + this.generateLibrarianSectionV2();

      // Ensure directory exists and write
      const claudeDir = path.dirname(claudeMdPath);
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }
      fs.writeFileSync(claudeMdPath, content.trim() + '\n');

      console.log(`[LibrarianManager] Wrote Librarian section to ~/.claude/CLAUDE.md (references ${this.getLibrarianCommandPath()})`);
      return true;
    } catch (error) {
      console.error('[LibrarianManager] Failed to write CLAUDE.md:', error);
      return false;
    }
  }

  /**
   * Remove the Librarian section from CLAUDE.md.
   */
  private removeLibrarianSection(): boolean {
    const claudeMdPath = path.join(os.homedir(), '.claude', 'CLAUDE.md');

    try {
      if (!fs.existsSync(claudeMdPath)) {
        return true; // Nothing to remove
      }

      let content = fs.readFileSync(claudeMdPath, 'utf-8');

      // Remove existing section if present
      const regex = new RegExp(
        `${this.CLAUDE_MD_START_MARKER}[\\s\\S]*?${this.CLAUDE_MD_END_MARKER}\\n?`,
        'g'
      );
      content = content.replace(regex, '');

      fs.writeFileSync(claudeMdPath, content.trim() + '\n');

      console.log(`[LibrarianManager] Removed Librarian section from ~/.claude/CLAUDE.md`);
      return true;
    } catch (error) {
      console.error('[LibrarianManager] Failed to remove from CLAUDE.md:', error);
      return false;
    }
  }

  /**
   * Generate the Librarian section for CLAUDE.md (with markers).
   * @deprecated Use generateLibrarianSectionV2 instead
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
    if (!this.settings.enabled) {
      return 'Librarian is currently disabled. Enable it in Field Theory Settings first.';
    }

    return this.generateInstructionTextV2();
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
   * @deprecated Use getDiscoveryConfig() instead
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

  // ===========================================================================
  // Discovery Cadence Algorithm (center-biased randomness)
  // ===========================================================================

  /**
   * Return the median of three numbers.
   * Used to create center-biased distribution.
   */
  private median3(x: number, y: number, z: number): number {
    if ((x <= y && y <= z) || (z <= y && y <= x)) return y;
    if ((y <= x && x <= z) || (z <= x && x <= y)) return x;
    return z;
  }

  /**
   * Generate a random integer in [min, max] inclusive.
   */
  private randIntInclusive(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Roll a center-biased value using median of 3.
   * Samples 3 times uniformly and returns median -> biases toward center.
   */
  private rollCenterBiased(min: number, max: number): number {
    const r1 = this.randIntInclusive(min, max);
    const r2 = this.randIntInclusive(min, max);
    const r3 = this.randIntInclusive(min, max);
    return this.median3(r1, r2, r3);
  }

  /**
   * Add small jitter to prevent identical patterns.
   */
  private jitter(k: number): number {
    const j = this.randIntInclusive(-1, 1); // -1, 0, or +1
    return k + j;
  }

  /**
   * Clamp value to [min, cap] range.
   */
  private clamp(k: number, min: number, cap: number): number {
    if (k < min) return min;
    if (k > cap) return cap;
    return k;
  }

  /**
   * Pick next discovery threshold using center-biased algorithm.
   * Uses the new DiscoveryFrequency settings.
   */
  private pickNextDiscoveryThreshold(): number {
    const frequency = this.settings.discoveryFrequency || 'sometimes';
    const cfg = DISCOVERY_CONFIG[frequency];

    let k = this.rollCenterBiased(cfg.min, cfg.max);
    k = this.jitter(k);
    k = this.clamp(k, cfg.min, cfg.cap);

    return k;
  }

  /**
   * Pick a random threshold within the range for a frequency.
   * If customThreshold or promptThreshold is set, always use that instead.
   * Now uses center-biased algorithm for discovery frequency.
   */
  private pickNextThreshold(frequency?: AutoRunFrequency): number {
    // New: Use discovery frequency if set
    if (this.settings.discoveryFrequency) {
      return this.pickNextDiscoveryThreshold();
    }
    // If using new v2 settings, use promptThreshold directly
    if (this.settings.promptThreshold !== undefined) {
      return this.settings.promptThreshold;
    }
    // Legacy: If custom threshold is set, use it directly
    if (typeof this.settings.customThreshold === 'number') {
      return this.settings.customThreshold;
    }
    // Legacy: Use frequency-based range (default to 'always' if not set)
    const freq = frequency || 'always';
    const [min, max] = this.getThresholdRange(freq);
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
   * Get the permission string for screenshot access.
   * This allows Claude to read figures from Field Theory's app data directory.
   */
  private getScreenshotPermission(): string {
    const figuresPath = path.join(
      os.homedir(),
      'Library',
      'Application Support',
      'fieldtheory-mac',
      'figures',
      '*'
    );
    return `Read(${figuresPath})`;
  }

  /**
   * Check if screenshot permission is already enabled in Claude settings.
   */
  isScreenshotPermissionEnabled(): boolean {
    try {
      const settingsPath = this.getClaudeSettingsPath();
      if (!fs.existsSync(settingsPath)) {
        return false;
      }

      const content = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(content) as Record<string, unknown>;
      const permissions = settings.permissions as Record<string, unknown> | undefined;
      const allow = permissions?.allow as string[] | undefined;

      if (!Array.isArray(allow)) {
        return false;
      }

      const permissionToCheck = this.getScreenshotPermission();
      return allow.includes(permissionToCheck);
    } catch (error) {
      console.error('[LibrarianManager] Error checking screenshot permission:', error);
      return false;
    }
  }

  /**
   * Enable screenshot permission by adding it to Claude's settings.json.
   * Returns true if successful, false otherwise.
   */
  enableScreenshotPermission(): boolean {
    try {
      const settingsPath = this.getClaudeSettingsPath();
      const claudeDir = path.dirname(settingsPath);

      // Ensure ~/.claude directory exists
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }

      // Read existing settings or create empty object
      let settings: Record<string, unknown> = {};
      if (fs.existsSync(settingsPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        } catch {
          console.warn('[LibrarianManager] Could not parse existing settings.json, starting fresh');
        }
      }

      // Ensure permissions structure exists
      if (!settings.permissions) {
        settings.permissions = { allow: [] };
      }
      const permissions = settings.permissions as Record<string, unknown>;
      if (!Array.isArray(permissions.allow)) {
        permissions.allow = [];
      }

      const allowList = permissions.allow as string[];
      const permissionToAdd = this.getScreenshotPermission();

      // Check if already present
      if (allowList.includes(permissionToAdd)) {
        console.log('[LibrarianManager] Screenshot permission already enabled');
        return true;
      }

      // Add the permission
      allowList.push(permissionToAdd);

      // Write back
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      console.log('[LibrarianManager] Screenshot permission enabled successfully');
      return true;
    } catch (error) {
      console.error('[LibrarianManager] Failed to enable screenshot permission:', error);
      return false;
    }
  }

  // ===========================================================================
  // Permission Profiles System
  // ===========================================================================

  /**
   * Permission profile definitions.
   * Each profile is a set of permissions that can be applied together.
   */
  private getPermissionProfiles(): Record<string, { description: string; permissions: string[] }> {
    return {
      minimal: {
        description: 'Read access for screenshots and files',
        permissions: [
          this.getScreenshotPermission(),
          'Read(**/*)',
        ],
      },
      recommended: {
        description: 'Common development tasks without prompts',
        permissions: [
          this.getScreenshotPermission(),
          'Read(**/*)',
          'Bash(npm run *)',
          'Bash(npm test)',
          'Bash(npm run build)',
          'Bash(npm run lint)',
          'Bash(npx tsc --noEmit)',
          'Bash(git status)',
          'Bash(git diff *)',
          'Bash(git log *)',
        ],
      },
      dev: {
        description: 'Maximum autonomy for trusted workflows',
        permissions: [
          this.getScreenshotPermission(),
          'Read(**/*)',
          'Bash(npm run *)',
          'Bash(npm test)',
          'Bash(npm run build)',
          'Bash(npm run lint)',
          'Bash(npx tsc --noEmit)',
          'Bash(npm install *)',
          'Bash(git status)',
          'Bash(git diff *)',
          'Bash(git log *)',
          'Bash(git add *)',
          'Bash(prettier --write *)',
        ],
      },
    };
  }

  /**
   * Get the path to Field Theory's permission manifest file.
   * This tracks what permissions Field Theory has added to Claude's settings.
   */
  private getPermissionManifestPath(): string {
    return path.join(os.homedir(), '.fieldtheory', 'managed-claude-permissions.json');
  }

  /**
   * Read the permission manifest (what Field Theory has contributed).
   */
  private readPermissionManifest(): { permissions: string[]; profile: string | null } {
    try {
      const manifestPath = this.getPermissionManifestPath();
      if (!fs.existsSync(manifestPath)) {
        return { permissions: [], profile: null };
      }
      const content = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(content);
      return {
        permissions: Array.isArray(manifest.permissions) ? manifest.permissions : [],
        profile: typeof manifest.profile === 'string' ? manifest.profile : null,
      };
    } catch (error) {
      console.error('[LibrarianManager] Error reading permission manifest:', error);
      return { permissions: [], profile: null };
    }
  }

  /**
   * Write the permission manifest.
   */
  private writePermissionManifest(permissions: string[], profile: string | null): boolean {
    try {
      const manifestPath = this.getPermissionManifestPath();
      const manifestDir = path.dirname(manifestPath);

      if (!fs.existsSync(manifestDir)) {
        fs.mkdirSync(manifestDir, { recursive: true });
      }

      fs.writeFileSync(manifestPath, JSON.stringify({ permissions, profile }, null, 2));
      return true;
    } catch (error) {
      console.error('[LibrarianManager] Error writing permission manifest:', error);
      return false;
    }
  }

  /**
   * Get all permissions currently in Claude's settings.json.
   */
  getClaudePermissions(): string[] {
    try {
      const settingsPath = this.getClaudeSettingsPath();
      if (!fs.existsSync(settingsPath)) {
        return [];
      }

      const content = fs.readFileSync(settingsPath, 'utf-8');
      const settings = JSON.parse(content) as Record<string, unknown>;
      const permissions = settings.permissions as Record<string, unknown> | undefined;
      const allow = permissions?.allow as string[] | undefined;

      return Array.isArray(allow) ? [...allow] : [];
    } catch (error) {
      console.error('[LibrarianManager] Error reading Claude permissions:', error);
      return [];
    }
  }

  /**
   * Get available permission profiles.
   */
  getAvailableProfiles(): Array<{ id: string; name: string; description: string; permissionCount: number; permissions: string[] }> {
    const profiles = this.getPermissionProfiles();
    return Object.entries(profiles).map(([id, profile]) => ({
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      description: profile.description,
      permissionCount: profile.permissions.length,
      permissions: profile.permissions,
    }));
  }

  /**
   * Get the current permission status.
   */
  getPermissionStatus(): {
    currentProfile: string | null;
    managedPermissions: string[];
    allClaudePermissions: string[];
  } {
    const manifest = this.readPermissionManifest();
    const allPermissions = this.getClaudePermissions();
    return {
      currentProfile: manifest.profile,
      managedPermissions: manifest.permissions,
      allClaudePermissions: allPermissions,
    };
  }

  /**
   * Add permissions to Claude's settings.json and track in manifest.
   * Returns true if successful.
   */
  addPermissions(permissionsToAdd: string[]): boolean {
    try {
      const settingsPath = this.getClaudeSettingsPath();
      const claudeDir = path.dirname(settingsPath);

      // Ensure ~/.claude directory exists
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }

      // Read existing settings
      let settings: Record<string, unknown> = {};
      if (fs.existsSync(settingsPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        } catch {
          console.warn('[LibrarianManager] Could not parse settings.json, starting fresh');
        }
      }

      // Ensure permissions structure
      if (!settings.permissions) {
        settings.permissions = { allow: [] };
      }
      const permissions = settings.permissions as Record<string, unknown>;
      if (!Array.isArray(permissions.allow)) {
        permissions.allow = [];
      }

      const allowList = permissions.allow as string[];
      const manifest = this.readPermissionManifest();
      const newManaged = [...manifest.permissions];

      // Add each permission if not already present
      for (const perm of permissionsToAdd) {
        if (!allowList.includes(perm)) {
          allowList.push(perm);
        }
        if (!newManaged.includes(perm)) {
          newManaged.push(perm);
        }
      }

      // Write settings
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      // Update manifest (keep existing profile if set)
      this.writePermissionManifest(newManaged, manifest.profile);

      console.log(`[LibrarianManager] Added ${permissionsToAdd.length} permissions`);
      return true;
    } catch (error) {
      console.error('[LibrarianManager] Failed to add permissions:', error);
      return false;
    }
  }

  /**
   * Remove permissions from Claude's settings.json.
   * Only removes permissions that are in our manifest (that we added).
   */
  removePermissions(permissionsToRemove: string[]): boolean {
    try {
      const settingsPath = this.getClaudeSettingsPath();
      if (!fs.existsSync(settingsPath)) {
        // Nothing to remove
        return true;
      }

      const content = fs.readFileSync(settingsPath, 'utf-8');
      let settings: Record<string, unknown>;
      try {
        settings = JSON.parse(content);
      } catch {
        return true; // Can't parse, nothing to remove
      }

      const permissions = settings.permissions as Record<string, unknown> | undefined;
      if (!permissions || !Array.isArray(permissions.allow)) {
        return true;
      }

      const allowList = permissions.allow as string[];
      const manifest = this.readPermissionManifest();

      // Only remove permissions that are both in the remove list AND in our manifest
      const toRemove = permissionsToRemove.filter(p => manifest.permissions.includes(p));

      // Filter out the permissions to remove
      permissions.allow = allowList.filter(p => !toRemove.includes(p));

      // Update manifest
      const newManaged = manifest.permissions.filter(p => !toRemove.includes(p));
      this.writePermissionManifest(newManaged, newManaged.length > 0 ? manifest.profile : null);

      // Write settings
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      console.log(`[LibrarianManager] Removed ${toRemove.length} permissions`);
      return true;
    } catch (error) {
      console.error('[LibrarianManager] Failed to remove permissions:', error);
      return false;
    }
  }

  /**
   * Apply a permission profile.
   * Removes previously managed permissions and adds the new profile's permissions.
   */
  applyPermissionProfile(profileId: string): boolean {
    const profiles = this.getPermissionProfiles();
    const profile = profiles[profileId];

    if (!profile) {
      console.error(`[LibrarianManager] Unknown profile: ${profileId}`);
      return false;
    }

    try {
      // First, remove all previously managed permissions
      const manifest = this.readPermissionManifest();
      if (manifest.permissions.length > 0) {
        this.removePermissions(manifest.permissions);
      }

      // Then add the new profile's permissions
      const success = this.addPermissions(profile.permissions);

      if (success) {
        // Update manifest with profile name
        const newManifest = this.readPermissionManifest();
        this.writePermissionManifest(newManifest.permissions, profileId);
      }

      return success;
    } catch (error) {
      console.error('[LibrarianManager] Failed to apply profile:', error);
      return false;
    }
  }

  /**
   * Clear all Field Theory managed permissions.
   */
  clearManagedPermissions(): boolean {
    const manifest = this.readPermissionManifest();
    if (manifest.permissions.length === 0) {
      return true;
    }
    return this.removePermissions(manifest.permissions);
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

  // ===========================================================================
  // State-Enforced Mode Hook Management (Global Hook)
  // ===========================================================================

  /**
   * Get the path to the global Field Theory Librarian hook script.
   * Lives in ~/.claude/ for Claude Code hook registration.
   */
  private getStateEnforcedHookPath(): string {
    return path.join(os.homedir(), '.claude', 'fieldtheory-librarian-hook.py');
  }

  /**
   * Get the path to the global Field Theory Librarian config.
   */
  private getGlobalStateEnforcedConfigPath(): string {
    return path.join(os.homedir(), '.claude', 'fieldtheory-librarian-config.json');
  }

  /**
   * Get the path to the Field Theory Librarian PreToolUse auto-approve hook.
   */
  private getPreToolUseHookPath(): string {
    return path.join(os.homedir(), '.claude', 'fieldtheory-librarian-pretool.py');
  }

  /**
   * Get the central librarian directory path.
   * All artifacts, jobs, and rules are stored here regardless of project.
   */
  private getCentralLibrarianDir(): string {
    return path.join(os.homedir(), '.fieldtheory', 'librarian');
  }

  /**
   * Ensure the central artifacts directory exists and is watched.
   * This runs on startup so users don't need to configure anything.
   */
  private ensureCentralArtifactsDir(): void {
    const centralDir = this.getCentralLibrarianDir();
    const artifactsDir = path.join(centralDir, 'artifacts');

    // Create directory if it doesn't exist
    if (!fs.existsSync(artifactsDir)) {
      fs.mkdirSync(artifactsDir, { recursive: true });
      console.log('[LibrarianManager] Created central artifacts directory:', artifactsDir);
    }

    // Add to watched dirs if not already present
    if (!this.settings.watchedDirs.includes(artifactsDir)) {
      this.settings.watchedDirs.push(artifactsDir);
      this.saveSettings();
      console.log('[LibrarianManager] Auto-added central artifacts directory to watched dirs:', artifactsDir);
    }
  }

  /**
   * Generate the PreToolUse auto-approve hook script.
   * This hook auto-approves Write/Edit operations to the Field Theory librarian directory,
   * eliminating permission prompts for artifact creation.
   */
  private generatePreToolUseHookScript(): string {
    const centralDir = this.getCentralLibrarianDir();
    return `#!/usr/bin/env python3
"""
PreToolUse Auto-Approve Hook for Field Theory Librarian
Auto-approves Read/Write/Edit to ~/.fieldtheory/librarian/*
"""
import json
import sys
from pathlib import Path

def main():
    try:
        input_data = json.load(sys.stdin)
    except:
        sys.exit(0)

    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input", {})

    # Auto-approve reads/writes to central Field Theory directory
    if tool_name in ("Read", "Write", "Edit"):
        file_path = tool_input.get("file_path", "")
        fieldtheory_dir = "${centralDir}"

        if file_path.startswith(fieldtheory_dir):
            print(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "allow"
                }
            }))
            sys.exit(0)

    # Default: don't interfere, let normal permission flow happen
    sys.exit(0)

if __name__ == "__main__":
    main()
`;
  }

  /**
   * Generate the global state-enforced hook script content (Python).
   * This script:
   * 1. Detects the current project from $CLAUDE_PROJECT_DIR
   * 2. Reads global config for threshold and rule content
   * 3. Creates centralized job files in ~/.fieldtheory/librarian/
   * 4. Outputs additionalContext to tell Claude to fulfill pending jobs
   */
  private generateStateEnforcedHookScript(): string {
    const centralDir = this.getCentralLibrarianDir();
    return `#!/usr/bin/env python3
"""
State-Enforced Librarian Hook (Global)
Works in any directory. Creates job files when threshold is reached.
All artifacts stored centrally in ~/.fieldtheory/librarian/artifacts/
PreToolUse hook handles auto-approval - no permissions needed.
"""
import json
import os
import sys
import fcntl
from pathlib import Path
from datetime import datetime

def main():
    # Get project root from environment (set by Claude Code)
    project_root = Path(os.environ.get('CLAUDE_PROJECT_DIR', os.getcwd()))
    project_name = project_root.name  # Just the directory name

    # Read global config from ~/.claude/
    global_cfg_path = Path.home() / ".claude" / "fieldtheory-librarian-config.json"
    if not global_cfg_path.exists():
        return

    with open(global_cfg_path) as f:
        cfg = json.load(f)

    enabled = cfg.get("enabled", False)
    if not enabled:
        return

    threshold = cfg.get("threshold", 3)
    if not isinstance(threshold, int) or threshold <= 0:
        return

    rule_content = cfg.get("rule_content", "Write 2-3 paragraphs connecting the current work to engineering history, physics, or systems theory.")

    # Central directory for everything (PreToolUse hook auto-approves writes here)
    central_dir = Path("${centralDir}")
    jobs_dir = central_dir / "jobs"
    artifacts_dir = central_dir / "artifacts"
    rules_dir = central_dir / "rules"

    # Per-project state directory (for prompt counting)
    state_dir = central_dir / "state" / project_name
    state_dir.mkdir(parents=True, exist_ok=True)

    count_file = state_dir / "prompt_count"
    lock_file = state_dir / "lock"

    # Create directories
    jobs_dir.mkdir(parents=True, exist_ok=True)
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    rules_dir.mkdir(parents=True, exist_ok=True)
    seq_file = central_dir / ".seq"

    # Use fcntl for cross-platform file locking
    with open(lock_file, "w") as lf:
        fcntl.flock(lf.fileno(), fcntl.LOCK_EX)

        # Read and increment count
        count = 0
        if count_file.exists():
            try:
                count = int(count_file.read_text().strip())
            except:
                count = 0
        count += 1
        count_file.write_text(str(count))

        if count < threshold:
            return

        # Reset count, increment global seq
        count_file.write_text("0")

        seq = 0
        if seq_file.exists():
            try:
                seq = int(seq_file.read_text().strip())
            except:
                seq = 0
        seq += 1
        seq_file.write_text(str(seq))

        # Generate timestamp-based filename
        timestamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
        job_file = jobs_dir / f"job_{seq}.json"
        rule_file = rules_dir / "history_reading.md"
        # Central artifacts directory - PreToolUse hook auto-approves
        out_file = artifacts_dir / f"{project_name}-{timestamp}-artifact.md"

        # 1. Check if job already exists and is done (prevent regression)
        job_is_done = False
        if job_file.exists():
            try:
                existing_job = json.loads(job_file.read_text(encoding="utf-8"))
                if existing_job.get("status") == "done":
                    job_is_done = True
            except (json.JSONDecodeError, OSError):
                pass  # Treat malformed as not-done

        # 2. Create job file if missing (idempotent per seq)
        if not job_file.exists():
            job_data = {
                "schema_version": 1,
                "id": seq,
                "type": "history_artifact",
                "status": "pending",
                "project": project_name,
                "project_path": str(project_root),
                "output": str(out_file),
                "rule_file": str(rule_file),
                "created_at": datetime.now().isoformat()
            }
            job_file.write_text(json.dumps(job_data, indent=2) + "\\n")

        # 3. Create rule file if it does not exist
        if not rule_file.exists():
            rule_file.write_text(rule_content)

        # 4. Output additionalContext with ALL details (no file reads needed)
        if not job_is_done:
            msg = f"""[STATE-ENFORCED] Before responding, write this artifact:

OUTPUT: {out_file}
RULE: {rule_content}
THEN: Update {job_file} setting "status" to "done"

Use the current conversation as context. Write the artifact first, then mark the job done."""
            print(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "UserPromptSubmit",
                    "additionalContext": msg
                }
            }))

if __name__ == "__main__":
    main()
`;
  }

  /**
   * Install the global state-enforced hook.
   * Works in any directory once enabled.
   */
  installStateEnforcedHook(): boolean {
    try {
      // 1. Ensure ~/.claude directory exists
      const claudeDir = path.join(os.homedir(), '.claude');
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }

      // 2. Create central librarian directory structure
      const centralDir = this.getCentralLibrarianDir();
      const dirs = [
        centralDir,
        path.join(centralDir, 'jobs'),
        path.join(centralDir, 'artifacts'),
        path.join(centralDir, 'rules'),
        path.join(centralDir, 'state'),
      ];
      for (const dir of dirs) {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      }

      // 3. Write global hook scripts
      const userPromptHookPath = this.getStateEnforcedHookPath();
      const preToolUseHookPath = this.getPreToolUseHookPath();
      fs.writeFileSync(userPromptHookPath, this.generateStateEnforcedHookScript(), { mode: 0o755 });
      fs.writeFileSync(preToolUseHookPath, this.generatePreToolUseHookScript(), { mode: 0o755 });

      // 4. Write global config
      const configPath = this.getGlobalStateEnforcedConfigPath();
      const config = {
        enabled: true,
        threshold: this.getStateEnforcedThreshold(),
        rule_content: this.getCustomRuleContent() || this.DEFAULT_RULE_CONTENT,
      };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      // 5. Register BOTH hooks in ~/.claude/settings.json
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

      // Helper type for hook entries
      type HookEntry = { matcher?: string; hooks?: Array<{ type?: string; command?: string }> };

      // Check if UserPromptSubmit hook already exists
      const userPromptCommand = `python3 "${userPromptHookPath}"`;
      const userPromptHookExists = (): boolean => {
        if (!Array.isArray(hooks['UserPromptSubmit'])) return false;
        return (hooks['UserPromptSubmit'] as HookEntry[]).some(h =>
          h.hooks?.some(hh => hh.command === userPromptCommand)
        );
      };

      // Add UserPromptSubmit hook (global, no matcher)
      if (!userPromptHookExists()) {
        if (!Array.isArray(hooks['UserPromptSubmit'])) {
          hooks['UserPromptSubmit'] = [];
        }
        (hooks['UserPromptSubmit'] as HookEntry[]).push({
          hooks: [{ type: 'command', command: userPromptCommand }],
        });
      }

      // Check if PreToolUse hook already exists
      const preToolUseCommand = `python3 "${preToolUseHookPath}"`;
      const preToolUseHookExists = (): boolean => {
        if (!Array.isArray(hooks['PreToolUse'])) return false;
        return (hooks['PreToolUse'] as HookEntry[]).some(h =>
          h.hooks?.some(hh => hh.command === preToolUseCommand)
        );
      };

      // Add PreToolUse hook (with matcher for Read|Write|Edit)
      if (!preToolUseHookExists()) {
        if (!Array.isArray(hooks['PreToolUse'])) {
          hooks['PreToolUse'] = [];
        }
        (hooks['PreToolUse'] as HookEntry[]).push({
          matcher: 'Read|Write|Edit',
          hooks: [{ type: 'command', command: preToolUseCommand }],
        });
      }

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      // 6. Auto-add artifacts directory to watched dirs so markdown files open in Field Theory
      const artifactsDir = path.join(centralDir, 'artifacts');
      this.addWatchedDir(artifactsDir);

      console.log('[LibrarianManager] Installed global state-enforced hooks (UserPromptSubmit + PreToolUse)');
      return true;
    } catch (error) {
      console.error('[LibrarianManager] Failed to install state-enforced hook:', error);
      return false;
    }
  }

  /**
   * Uninstall the global state-enforced hooks.
   */
  uninstallStateEnforcedHook(): boolean {
    try {
      const userPromptHookPath = this.getStateEnforcedHookPath();
      const preToolUseHookPath = this.getPreToolUseHookPath();
      const configPath = this.getGlobalStateEnforcedConfigPath();

      // Remove hook scripts
      if (fs.existsSync(userPromptHookPath)) {
        fs.unlinkSync(userPromptHookPath);
      }
      if (fs.existsSync(preToolUseHookPath)) {
        fs.unlinkSync(preToolUseHookPath);
      }

      // Disable in config (don't delete, preserve settings)
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config.enabled = false;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      }

      // Remove from ~/.claude/settings.json
      const settingsPath = this.getClaudeSettingsPath();
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        const userPromptCommand = `python3 "${userPromptHookPath}"`;
        const preToolUseCommand = `python3 "${preToolUseHookPath}"`;

        // Remove UserPromptSubmit hook
        if (settings.hooks?.UserPromptSubmit) {
          settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
            (h: { hooks?: Array<{ command?: string }> }) =>
              !h.hooks?.some(hh => hh.command === userPromptCommand)
          );
          if (settings.hooks.UserPromptSubmit.length === 0) {
            delete settings.hooks.UserPromptSubmit;
          }
        }

        // Remove PreToolUse hook
        if (settings.hooks?.PreToolUse) {
          settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(
            (h: { hooks?: Array<{ command?: string }> }) =>
              !h.hooks?.some(hh => hh.command === preToolUseCommand)
          );
          if (settings.hooks.PreToolUse.length === 0) {
            delete settings.hooks.PreToolUse;
          }
        }

        // Clean up empty hooks object
        if (settings.hooks && Object.keys(settings.hooks).length === 0) {
          delete settings.hooks;
        }

        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      }

      console.log('[LibrarianManager] Uninstalled global state-enforced hooks');
      return true;
    } catch (error) {
      console.error('[LibrarianManager] Failed to uninstall state-enforced hooks:', error);
      return false;
    }
  }

  /**
   * Check if the global state-enforced hook is installed.
   */
  isStateEnforcedHookInstalled(): boolean {
    const hookPath = this.getStateEnforcedHookPath();
    const configPath = this.getGlobalStateEnforcedConfigPath();

    if (!fs.existsSync(hookPath) || !fs.existsSync(configPath)) {
      return false;
    }

    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      return config.enabled === true;
    } catch {
      return false;
    }
  }

  /**
   * Get count of pending jobs (from central directory).
   */
  getPendingJobCount(): number {
    const jobsDir = path.join(this.getCentralLibrarianDir(), 'jobs');

    if (!fs.existsSync(jobsDir)) {
      return 0;
    }

    let count = 0;
    const files = fs.readdirSync(jobsDir).filter(f => f.startsWith('job_') && f.endsWith('.json'));

    for (const file of files) {
      try {
        const jobPath = path.join(jobsDir, file);
        const job = JSON.parse(fs.readFileSync(jobPath, 'utf-8'));
        if (job.status === 'pending') {
          count++;
        }
      } catch {
        // Skip malformed job files
      }
    }

    return count;
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
  getEditStatus(): { edits: number; threshold: number; frequency: string } | null {
    try {
      this.ensureGlobalStatusExists();
      const statusFile = this.getGlobalStatusPath();
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      return {
        edits: status.promptsSinceReading || 0,
        threshold: status.nextThreshold || 5,
        frequency: this.settings.discoveryFrequency || 'sometimes',
      };
    } catch (error) {
      console.error('[LibrarianManager] Failed to get edit status:', error);
      return null;
    }
  }

  /**
   * Get current counter state for UI display.
   * Reset is handled by reading-added event, not here.
   */
  getCounterStatus(): { edits: number; threshold: number } {
    try {
      this.ensureGlobalStatusExists();
      const statusFile = this.getGlobalStatusPath();
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      return {
        edits: status.promptsSinceReading || 0,
        threshold: status.nextThreshold || 5,
      };
    } catch (error) {
      console.error('[LibrarianManager] Failed to get counter status:', error);
      return { edits: 0, threshold: 5 };
    }
  }

  /**
   * @deprecated Use getCounterStatus() instead. Kept for backward compatibility.
   */
  checkAndResetIfNeeded(): { edits: number; threshold: number; didReset: boolean } {
    const status = this.getCounterStatus();
    return { ...status, didReset: false };
  }

  /**
   * Simple check: is count >= threshold?
   * No side effects, just returns the comparison result.
   */
  isOverThreshold(): boolean {
    try {
      this.ensureGlobalStatusExists();
      const statusFile = this.getGlobalStatusPath();
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      return (status.promptsSinceReading || 0) >= (status.nextThreshold || 5);
    } catch {
      return false;
    }
  }

  /**
   * Reset the counter. Called when a reading is created.
   * Simple and direct - no timestamp comparisons.
   */
  resetCounter(): void {
    try {
      this.ensureGlobalStatusExists();
      const statusFile = this.getGlobalStatusPath();
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      status.promptsSinceReading = 0;
      status.nextThreshold = this.pickNextThreshold(this.settings.autoRunFrequency);
      status.lastReading = new Date().toISOString();
      fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
      this.logStatus('reset');
    } catch (error) {
      console.error('[LibrarianManager] Failed to reset counter:', error);
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
  // Setup Wizard Support
  // ===========================================================================

  /**
   * Create a welcome artifact in the specified directory.
   * This introduces users to the Librarian format and braille art style.
   */
  createWelcomeArtifact(dirPath: string): boolean {
    const expandedPath = this.expandPath(dirPath);
    const normalizedPath = this.normalizePath(expandedPath);

    // Ensure directory exists
    if (!fs.existsSync(normalizedPath)) {
      try {
        fs.mkdirSync(normalizedPath, { recursive: true });
        console.log(`[LibrarianManager] Created directory: ${normalizedPath}`);
      } catch (error) {
        console.error(`[LibrarianManager] Failed to create directory ${normalizedPath}:`, error);
        return false;
      }
    }

    // Generate filename with today's date
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
    const filename = `${dateStr}-welcome-to-librarian.md`;
    const filePath = path.join(normalizedPath, filename);

    // Don't overwrite existing welcome artifact
    if (fs.existsSync(filePath)) {
      console.log(`[LibrarianManager] Welcome artifact already exists: ${filePath}`);
      return true;
    }

    const content = `# Welcome to Librarian

⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣤⣴⣶⣶⣶⣦⣤⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣴⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣦⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣄⠀⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣴⣿⣿⣿⣿⣿⣿⣿⡿⠿⠿⠿⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⡀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⢀⣾⣿⣿⣿⣿⣿⡿⠋⠁⠀⠀⠀⠀⠀⠀⠈⠙⢿⣿⣿⣿⣿⣿⣿⣷⡀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⣾⣿⣿⣿⣿⣿⠏⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠹⣿⣿⣿⣿⣿⣿⣷⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⡏⠀⠀⠀⠀⢀⣀⣀⣀⠀⠀⠀⠀⠀⠀⢻⣿⣿⣿⣿⣿⣿⡇⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⣿⣿⣿⣿⣿⣿⠁⠀⠀⠀⣴⣿⣿⣿⣿⣷⡄⠀⠀⠀⠀⠈⣿⣿⣿⣿⣿⣿⣿⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⣿⣿⣿⣿⣿⣿⠀⠀⠀⠀⣿⣿⣿⣿⣿⣿⣿⠀⠀⠀⠀⠀⣿⣿⣿⣿⣿⣿⣿⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⣿⣿⣿⣿⣿⣿⡇⠀⠀⠀⠹⣿⣿⣿⣿⣿⠏⠀⠀⠀⠀⢰⣿⣿⣿⣿⣿⣿⣿⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⢹⣿⣿⣿⣿⣿⣿⡀⠀⠀⠀⠈⠻⠿⠟⠁⠀⠀⠀⠀⢀⣿⣿⣿⣿⣿⣿⣿⡏⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⢻⣿⣿⣿⣿⣿⣷⣄⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣠⣾⣿⣿⣿⣿⣿⣿⡿⠁⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠻⣿⣿⣿⣿⣿⣿⣿⣶⣤⣀⣀⣀⣤⣴⣶⣿⣿⣿⣿⣿⣿⣿⣿⠟⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠿⠋⠀⠀⠀⠀⠀⠀
⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠛⠻⠿⢿⣿⣿⣿⣿⣿⣿⡿⠿⠟⠛⠉⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀

Librarian connects your coding sessions to the deeper history of engineering thought. Each artifact captures not just what you're building, but why it matters—drawing threads to physics, systems theory, and the accumulated wisdom of those who built before us.

This is your first artifact. As you work with Claude Code, Librarian will prompt you to create more, building a collection of insights that contextualize your work within the broader story of technology.

The braille halftone illustrations above each reading are a signature element. They're rendered as Unicode braille characters—a form of ASCII art that dates back to the earliest days of computing, when programmers found creative ways to produce images using only text. Each image is exactly 56 characters wide by 15 lines tall, with density ranging from sparse (⠀) to full (⣿).

Your readings will accumulate here in \`.librarian/\` directories, one per meaningful session. Let them be serendipitous—not every session needs one, but substantial work deserves reflection.
`;

    try {
      fs.writeFileSync(filePath, content, 'utf-8');
      console.log(`[LibrarianManager] Created welcome artifact: ${filePath}`);

      // If this directory is watched, the watcher will pick it up
      // If not, add it to the cache manually for immediate visibility
      if (this.settings.watchedDirs.includes(normalizedPath)) {
        const meta = this.parseFileMetadata(filePath);
        if (meta) {
          this.cache.set(filePath, meta);
          this.saveIndex();
          this.emit('reading-added', meta);
        }
      }

      return true;
    } catch (error) {
      console.error(`[LibrarianManager] Failed to create welcome artifact:`, error);
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
