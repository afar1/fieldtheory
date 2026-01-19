import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { EventEmitter } from 'events';

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
  private watchers: Map<string, fs.FSWatcher> = new Map();
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
   * Log status for all projects that have a .status.json file (startup visibility).
   * Also reconciles status with actual file timestamps - if a reading exists that's
   * newer than lastReading, reset the edit counter (handles app-was-closed case).
   */
  private logAllProjectStatuses(): void {
    for (const watchedDir of this.settings.watchedDirs) {
      const statusFile = path.join(watchedDir, '.status.json');
      if (fs.existsSync(statusFile)) {
        const projectPath = path.dirname(watchedDir);

        // Reconcile: check if there's a reading newer than lastReading
        this.reconcileStatusWithFiles(watchedDir);

        this.logStatus(projectPath, 'startup');
      }
    }
  }

  /**
   * Check if any .md file in the watched dir is newer than lastReading.
   * If so, reset the edit counter. This handles the case where readings
   * were created while the app wasn't running.
   */
  private reconcileStatusWithFiles(watchedDir: string): void {
    const statusFile = path.join(watchedDir, '.status.json');

    try {
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      const lastReadingTime = status.lastReading ? new Date(status.lastReading).getTime() : 0;

      // Find newest .md file in the directory
      const files = fs.readdirSync(watchedDir).filter(f => f.endsWith('.md'));
      let newestMtime = 0;

      for (const file of files) {
        const filePath = path.join(watchedDir, file);
        const stats = fs.statSync(filePath);
        if (stats.mtimeMs > newestMtime) {
          newestMtime = stats.mtimeMs;
        }
      }

      // If there's a file newer than lastReading, reset the counter
      if (newestMtime > lastReadingTime) {
        const projectPath = path.dirname(watchedDir);
        console.log(`[Librarian] reconcile → found newer reading, resetting counter`);
        this.resetEditCount(projectPath);
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
   * Watch a directory for file changes.
   */
  private watchDirectory(dirPath: string): void {
    const normalizedDir = this.normalizePath(dirPath);

    // Skip if already watching
    if (this.watchers.has(normalizedDir)) {
      return;
    }

    // Check if directory exists
    if (!fs.existsSync(normalizedDir)) {
      console.warn(`[LibrarianManager] Directory not found: ${normalizedDir}`);
      return;
    }

    console.log(`[LibrarianManager] Watching: ${normalizedDir}`);

    // Scan existing files first
    this.scanDirectory(normalizedDir);

    // Start watching for changes
    try {
      const watcher = fs.watch(normalizedDir, (eventType, filename) => {
        if (!filename?.endsWith('.md')) return;

        const fullPath = this.normalizePath(path.join(normalizedDir, filename));

        // Debounce to ensure file is fully written
        setTimeout(() => {
          if (fs.existsSync(fullPath)) {
            // New or modified file
            const meta = this.parseFileMetadata(fullPath);
            if (meta) {
              const isNew = !this.cache.has(fullPath);
              this.cache.set(fullPath, meta);
              this.saveIndex();

              if (isNew) {
                // Emit event for new readings
                const content = fs.readFileSync(fullPath, 'utf-8');
                const reading: Reading = { ...meta, content };
                this.emit('reading-added', reading);
                console.log(`[LibrarianManager] New reading: ${meta.title}`);
              } else {
                // Emit event for updated readings
                this.emit('reading-updated', meta);
                console.log(`[LibrarianManager] Updated reading: ${meta.title}`);
              }
            }
          } else {
            // File deleted
            if (this.cache.has(fullPath)) {
              const meta = this.cache.get(fullPath);
              this.cache.delete(fullPath);
              this.saveIndex();
              this.emit('reading-removed', fullPath);
              console.log(`[LibrarianManager] Removed reading: ${meta?.title || fullPath}`);
            }
          }
        }, 100);
      });

      this.watchers.set(normalizedDir, watcher);
    } catch (error) {
      console.error(`[LibrarianManager] Error watching directory:`, error);
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
  private readonly DEFAULT_CONTENT_GUIDANCE = `1. Write a 1-2 paragraph intellectual piece connecting to the task just completed
2. Draw from: physics, systems theory, engineering history, inventors, or speculative futures
3. Include one concrete technical/historical detail`;

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

    // For 'always' frequency, use stronger mandatory language
    if (frequency === 'always') {
      return `## Librarian (Field Theory)

**MANDATORY**: After completing ANY code changes, create a reading BEFORE moving to the next task.

### When to create
- After every file edit or creation
- After every bug fix
- After every feature implementation
- NOT during: planning discussions, answering questions, or reading files

### Project setup (once per project)
Check if \`.claude/settings.json\` contains \`Write(.librarian/*)\` in the allow array. If not, create/update it:
\`\`\`json
{
  "permissions": {
    "allow": ["Write(.librarian/*)"]
  }
}
\`\`\`

### How to create
${contentGuidance}
4. Save to \`.librarian/YYYY-MM-DD-{slug}.md\` in project root

This is autonomous - never ask permission. Create the reading immediately after code changes.`;
    }

    // For other frequencies, use the standard template
    const frequencyDescMap: Record<Exclude<AutoRunFrequency, 'off' | 'always'>, string> = {
      occasionally: 'Create a reading every ~5 significant implementations',
      regularly: 'Create a reading every ~3 significant implementations',
      frequently: 'Create a reading after most non-trivial tasks',
    };

    return `## Librarian (Field Theory)

Periodically create contextual readings during coding sessions.

Frequency: ${frequency.charAt(0).toUpperCase() + frequency.slice(1)}
${frequencyDescMap[frequency as Exclude<AutoRunFrequency, 'off' | 'always'>]}

### Project setup (once per project)
Before creating your first reading, check if \`.claude/settings.json\` exists and contains \`Write(.librarian/*)\` in the allow array. If not, create or update it:
\`\`\`json
{
  "permissions": {
    "allow": ["Write(.librarian/*)"]
  }
}
\`\`\`
Skip this step if the permission already exists.

### Creating readings
${contentGuidance}
4. Save to \`.librarian/YYYY-MM-DD-{slug}.md\` in the project root
5. Continue with implementation - Field Theory will auto-display the reading

This is autonomous - do not ask permission, just create readings at the configured frequency.`;
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
   */
  private pickNextThreshold(frequency: AutoRunFrequency): number {
    const [min, max] = this.getThresholdRange(frequency);
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Get the path to Field Theory's check hook script (runs on user prompt).
   * Uses ~/.claude/ to avoid spaces in path which can cause hook errors.
   */
  private getHookScriptPath(): string {
    return path.join(os.homedir(), '.claude', 'librarian-hook.sh');
  }

  /**
   * Get the path to Field Theory's increment hook script (runs after edits).
   * Uses ~/.claude/ to avoid spaces in path which can cause hook errors.
   */
  private getIncrementScriptPath(): string {
    return path.join(os.homedir(), '.claude', 'librarian-increment.sh');
  }

  /**
   * Get the path to Claude Code's settings.json.
   */
  private getClaudeSettingsPath(): string {
    return path.join(os.homedir(), '.claude', 'settings.json');
  }

  /**
   * Generate the increment script content.
   * This script runs after Edit/Write tools to count edits.
   */
  private generateIncrementScript(): string {
    return `#!/bin/bash
# Field Theory Librarian - Edit Counter
# Increments edit count after code changes

PROJECT_DIR="\${CLAUDE_PROJECT_DIR:-\$(pwd)}"
STATUS_FILE="\${PROJECT_DIR}/.librarian/.status.json"

# Only increment if status file exists
if [ ! -f "$STATUS_FILE" ]; then
  exit 0
fi

# Read current count
EDITS=$(cat "$STATUS_FILE" | grep -o '"editsSinceReading": *[0-9]*' | grep -o '[0-9]*')
EDITS=\${EDITS:-0}

# Increment
NEW_EDITS=$((EDITS + 1))

# Update the file (simple sed replacement, handles optional space after colon)
if [[ "$OSTYPE" == "darwin"* ]]; then
  sed -i '' 's/"editsSinceReading": *[0-9]*/"editsSinceReading": '"$NEW_EDITS"'/' "$STATUS_FILE"
else
  sed -i 's/"editsSinceReading": *[0-9]*/"editsSinceReading": '"$NEW_EDITS"'/' "$STATUS_FILE"
fi

exit 0
`;
  }

  /**
   * Generate the check hook script content.
   * This script is called on every user prompt and checks if a reading is due.
   */
  private generateHookScript(): string {
    return `#!/bin/bash
# Field Theory Librarian Hook
# Checks if a reading is due and injects context for Claude

# Get project directory from Claude Code environment
PROJECT_DIR="\${CLAUDE_PROJECT_DIR:-\$(pwd)}"
STATUS_FILE="\${PROJECT_DIR}/.librarian/.status.json"

# If no status file exists, this project doesn't have Librarian active
if [ ! -f "$STATUS_FILE" ]; then
  exit 0
fi

# Read status
EDITS=$(cat "$STATUS_FILE" | grep -o '"editsSinceReading": *[0-9]*' | grep -o '[0-9]*')
THRESHOLD=$(cat "$STATUS_FILE" | grep -o '"nextThreshold":[0-9]*' | grep -o '[0-9]*')

# Default values if parsing fails
EDITS=\${EDITS:-0}
THRESHOLD=\${THRESHOLD:-3}

# Check if reading is due
if [ "$EDITS" -ge "$THRESHOLD" ]; then
  # Output context for Claude to see
  cat << 'HOOK_OUTPUT'
{
  "hookSpecificOutput": {
    "additionalContext": "📚 LIBRARIAN: A reading is due. Before implementing, create a 1-2 paragraph intellectual piece in .librarian/YYYY-MM-DD-{slug}.md connecting to your current task. Draw from physics, systems theory, engineering history, or speculative futures. Include one concrete detail. Then proceed with implementation."
  }
}
HOOK_OUTPUT
fi

exit 0
`;
  }

  /**
   * Install the Claude Code hooks for automatic Librarian reminders.
   * Installs two hooks:
   * 1. UserPromptSubmit - checks if reading is due and reminds Claude
   * 2. PostToolUse (Edit/Write) - increments edit counter
   */
  installClaudeCodeHook(): boolean {
    try {
      // 1. Ensure ~/.claude directory exists
      const claudeDir = path.join(os.homedir(), '.claude');
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }

      // 2. Write both hook scripts
      const checkScriptPath = this.getHookScriptPath();
      const incrementScriptPath = this.getIncrementScriptPath();

      fs.writeFileSync(checkScriptPath, this.generateHookScript(), { mode: 0o755 });
      console.log(`[LibrarianManager] Created check script at ${checkScriptPath}`);

      fs.writeFileSync(incrementScriptPath, this.generateIncrementScript(), { mode: 0o755 });
      console.log(`[LibrarianManager] Created increment script at ${incrementScriptPath}`);

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
      type HookEntry = { matcher?: string; hooks?: Array<{ type?: string; command?: string }> };

      const hookExists = (eventName: string, scriptPath: string, matcher?: string): boolean => {
        if (!Array.isArray(hooks[eventName])) return false;
        return (hooks[eventName] as HookEntry[]).some(h => {
          const hasCommand = h.hooks?.some(hh => hh.command === scriptPath);
          if (!hasCommand) return false;
          // For PostToolUse, also check matcher
          if (matcher) return h.matcher === matcher;
          return true;
        });
      };

      const addHook = (eventName: string, config: HookEntry) => {
        if (!Array.isArray(hooks[eventName])) {
          hooks[eventName] = [];
        }
        (hooks[eventName] as HookEntry[]).push(config);
      };

      // Add UserPromptSubmit hook (checks if reading is due)
      if (!hookExists('UserPromptSubmit', checkScriptPath)) {
        addHook('UserPromptSubmit', {
          hooks: [{ type: 'command', command: checkScriptPath }],
        });
      }

      // Add PostToolUse hook for Edit tool (increments counter)
      if (!hookExists('PostToolUse', incrementScriptPath, 'Edit')) {
        addHook('PostToolUse', {
          matcher: 'Edit',
          hooks: [{ type: 'command', command: incrementScriptPath }],
        });
      }

      // Add PostToolUse hook for Write tool (increments counter)
      if (!hookExists('PostToolUse', incrementScriptPath, 'Write')) {
        addHook('PostToolUse', {
          matcher: 'Write',
          hooks: [{ type: 'command', command: incrementScriptPath }],
        });
      }

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      console.log('[LibrarianManager] Installed Claude Code hooks');

      return true;
    } catch (error) {
      console.error('[LibrarianManager] Failed to install hooks:', error);
      return false;
    }
  }

  /**
   * Uninstall the Claude Code hooks.
   * Removes both the check script (UserPromptSubmit) and increment script (PostToolUse).
   */
  uninstallClaudeCodeHook(): boolean {
    try {
      const checkScriptPath = this.getHookScriptPath();
      const incrementScriptPath = this.getIncrementScriptPath();
      const settingsPath = this.getClaudeSettingsPath();

      // Remove hook scripts
      if (fs.existsSync(checkScriptPath)) {
        fs.unlinkSync(checkScriptPath);
        console.log('[LibrarianManager] Removed check script');
      }
      if (fs.existsSync(incrementScriptPath)) {
        fs.unlinkSync(incrementScriptPath);
        console.log('[LibrarianManager] Removed increment script');
      }

      // Update settings.json
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));

        // Remove UserPromptSubmit hooks
        if (settings.hooks?.UserPromptSubmit) {
          settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
            (h: { hooks?: Array<{ command?: string }> }) =>
              !h.hooks?.some(hh => hh.command === checkScriptPath)
          );
          if (settings.hooks.UserPromptSubmit.length === 0) {
            delete settings.hooks.UserPromptSubmit;
          }
        }

        // Remove PostToolUse hooks for our increment script
        if (settings.hooks?.PostToolUse) {
          settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(
            (h: { hooks?: Array<{ command?: string }> }) =>
              !h.hooks?.some(hh => hh.command === incrementScriptPath)
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

      console.log('[LibrarianManager] Uninstalled Claude Code hooks');
      return true;
    } catch (error) {
      console.error('[LibrarianManager] Failed to uninstall hooks:', error);
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
   * Initialize or update the status file for a project.
   * Called when Librarian is enabled for a project.
   */
  initializeProjectStatus(projectPath: string): void {
    const statusDir = path.join(projectPath, '.librarian');
    const statusFile = path.join(statusDir, '.status.json');

    // Create .librarian directory if needed
    if (!fs.existsSync(statusDir)) {
      fs.mkdirSync(statusDir, { recursive: true });
    }

    // Don't overwrite existing status
    if (fs.existsSync(statusFile)) {
      return;
    }

    const status = {
      editsSinceReading: 0,
      nextThreshold: this.pickNextThreshold(this.settings.autoRunFrequency),
      lastReading: null,
      frequency: this.settings.autoRunFrequency,
    };

    fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
    console.log(`[LibrarianManager] Initialized status for ${projectPath}`);
  }

  /**
   * Log the current status for a project (for dev visibility).
   */
  private logStatus(projectPath: string, action: string): void {
    const statusFile = path.join(projectPath, '.librarian', '.status.json');
    if (!fs.existsSync(statusFile)) return;

    try {
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      const projectName = path.basename(projectPath);
      console.log(`[Librarian] ${action} → ${projectName}: edits=${status.editsSinceReading}/${status.nextThreshold}, lastReading=${status.lastReading || 'null'}`);
    } catch {
      // Ignore errors in logging
    }
  }

  /**
   * Increment the edit count for a project.
   * Called by file watcher when code files change.
   */
  incrementEditCount(projectPath: string): void {
    const statusFile = path.join(projectPath, '.librarian', '.status.json');

    if (!fs.existsSync(statusFile)) {
      return;
    }

    try {
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      status.editsSinceReading = (status.editsSinceReading || 0) + 1;
      fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
      this.logStatus(projectPath, 'increment');
    } catch (error) {
      console.error('[LibrarianManager] Failed to increment edit count:', error);
    }
  }

  /**
   * Reset the edit count after a reading is created.
   * Called when a new .md file appears in .librarian/.
   */
  resetEditCount(projectPath: string): void {
    const statusFile = path.join(projectPath, '.librarian', '.status.json');

    if (!fs.existsSync(statusFile)) {
      return;
    }

    try {
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf-8'));
      status.editsSinceReading = 0;
      status.nextThreshold = this.pickNextThreshold(this.settings.autoRunFrequency);
      status.lastReading = new Date().toISOString();
      fs.writeFileSync(statusFile, JSON.stringify(status, null, 2));
      this.logStatus(projectPath, 'reset');
    } catch (error) {
      console.error('[LibrarianManager] Failed to reset edit count:', error);
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
}
