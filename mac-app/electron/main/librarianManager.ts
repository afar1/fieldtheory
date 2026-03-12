import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { EventEmitter } from 'events';
import * as chokidar from 'chokidar';
import { UserDataManager } from './userDataManager';
import { createLogger } from './logger';

const log = createLogger('Librarian');

// ===========================================================================
// Pure TOML editing helpers (exported for testing)
// ===========================================================================

/**
 * Add a `notify` command to TOML content. Replaces existing notify line
 * or appends if absent. Returns updated content.
 */
export function tomlSetNotify(content: string, command: string): string {
  if (content.includes(command)) return content;
  if (content.match(/^notify\s*=/m)) {
    return content.replace(/^notify\s*=.*$/m, `notify = "${command}"`);
  }
  return content.trimEnd() + `\nnotify = "${command}"\n`;
}

/**
 * Remove a `notify` line that matches the given script name from TOML content.
 */
export function tomlRemoveNotify(content: string, scriptName: string): string {
  const escaped = scriptName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return content.replace(new RegExp(`^notify\\s*=\\s*".*${escaped}.*"\\s*\\n?`, 'm'), '');
}

/**
 * Add a path to the `writable_roots` array in TOML content.
 * Creates the array if absent, appends to it if present.
 */
export function tomlAddWritableRoot(content: string, dirPath: string): string {
  if (content.includes(dirPath)) return content;
  if (content.match(/^writable_roots\s*=/m)) {
    return content.replace(
      /^(writable_roots\s*=\s*\[)(.*?)(\])/ms,
      (match, prefix, items, suffix) => {
        const trimmed = items.trimEnd();
        const needsComma = trimmed.length > 0 && !trimmed.endsWith(',');
        return `${prefix}${items}${needsComma ? ',' : ''}\n  "${dirPath}"${suffix}`;
      }
    );
  }
  return content.trimEnd() + `\nwritable_roots = [\n  "${dirPath}"\n]\n`;
}

/**
 * Remove a path from the `writable_roots` array in TOML content.
 * Cleans up empty array if nothing remains.
 */
export function tomlRemoveWritableRoot(content: string, dirPath: string): string {
  const escaped = dirPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let result = content.replace(
    new RegExp(`^\\s*"${escaped}"\\s*,?\\s*\\n?`, 'm'),
    ''
  );
  // Clean up empty writable_roots array
  result = result.replace(/^writable_roots\s*=\s*\[\s*\]\s*\n?/m, '');
  return result;
}

/**
 * Add or remove a managed section in markdown content, delimited by HTML comments.
 */
export function managedSectionUpsert(content: string, marker: string, section: string): string {
  if (content.includes(marker)) return content;
  return content.trimEnd() + '\n' + section;
}

export function managedSectionRemove(content: string, startMarker: string, endMarker: string): string {
  const startEscaped = startMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const endEscaped = endMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return content.replace(
    new RegExp(`\\n?${startEscaped}[\\s\\S]*?${endEscaped}\\n?`),
    ''
  );
}

/**
 * Parse markdown content to extract metadata (title, context, reading time).
 * Only reads first ~20 lines for efficiency.
 */
export function parseMarkdownHeader(content: string): { title: string; context: string | null; readingTime: string | null } {
  const lines = content.split('\n').slice(0, 20);
  let title = 'Untitled Reading';
  let context: string | null = null;
  let readingTime: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Extract title from first heading (H1, H2, or H3)
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)/);
    if (headingMatch && title === 'Untitled Reading') {
      title = headingMatch[2].trim();
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
  often:     { min: 3,  max: 7,  cap: 8 },
  sometimes: { min: 10, max: 18, cap: 20 },
  rarely:    { min: 25, max: 40, cap: 50 },
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
  stateEnforcedThreshold?: number;     // Prompts before job creation (default: 7 = 'sometimes')
  stateEnforcedRuleContent?: string;   // Custom rule content (the "job language")
  // Discovery cadence settings
  discoveryFrequency?: DiscoveryFrequency;  // Controls discovery timing (default: 'sometimes')
  // User expertise context
  userExpertiseContext?: string;       // User's background/interests (max 400 chars)
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
  private userDataManager: UserDataManager | null = null;

  constructor() {
    super();

    // Initialize paths (legacy - will be updated when user logs in)
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
  }

  /**
   * Set the UserDataManager for per-user paths.
   */
  setUserDataManager(manager: UserDataManager): void {
    this.userDataManager = manager;
  }

  /**
   * Update paths for the current user.
   */
  private updatePathsForUser(): void {
    if (this.userDataManager?.isLoggedIn()) {
      this.settingsPath = this.userDataManager.getUserDataPath('librarian-settings.json');
      this.indexPath = this.userDataManager.getUserDataPath('librarian-index.json');
    }
  }

  /**
   * Get the central librarian directory (user-specific).
   */
  getCentralLibrarianDir(): string {
    if (this.userDataManager?.isLoggedIn()) {
      return this.userDataManager.getFieldTheoryPath('librarian');
    }
    // Fallback to legacy path
    return path.join(os.homedir(), '.fieldtheory', 'librarian');
  }

  /**
   * Get the central artifacts directory (user-specific).
   */
  getCentralArtifactsDir(): string {
    return path.join(this.getCentralLibrarianDir(), 'artifacts');
  }

  /**
   * Get the concepts index for story/lesson deduplication.
   * Returns null if the index doesn't exist.
   * Note: Always reads from global path since hook.py writes there (no user context).
   */
  getConceptsIndex(): {
    schema_version: number;
    description?: string;
    indexed_at: string | null;
    artifacts: Record<string, { title: string; stories: string[]; lessons: string[] }>;
    stories_used: string[];
    lessons_used: string[];
  } | null {
    // Hook writes to global path (no user context), so always read from there
    const globalLibrarianDir = path.join(os.homedir(), '.fieldtheory', 'librarian');
    const indexPath = path.join(globalLibrarianDir, 'concepts_index.json');
    if (!fs.existsSync(indexPath)) {
      return null;
    }
    try {
      const content = fs.readFileSync(indexPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      log.error('Failed to read concepts index:', error);
      return null;
    }
  }

  /**
   * Reinitialize for the current user. Call after setUserDataManager when user changes.
   */
  async reinitializeForUser(): Promise<void> {
    // Stop existing watchers
    for (const watcher of this.watchers.values()) {
      await watcher.close();
    }
    this.watchers.clear();
    this.cache.clear();

    // Update paths
    this.updatePathsForUser();

    // Reload settings and index for new user
    this.settings = this.loadSettings();
    this.ensureCentralArtifactsDir();
    this.loadIndex();
    this.startWatching();

    // Sync user's settings to global config for hooks
    this.syncToGlobalConfig(false);
  }

  /**
   * Clear state on logout.
   */
  async onUserLoggedOut(): Promise<void> {
    // Stop watchers
    for (const watcher of this.watchers.values()) {
      await watcher.close();
    }
    this.watchers.clear();
    this.cache.clear();

    // Disable hooks in global config (hooks should not fire when logged out)
    const globalConfigPath = path.join(os.homedir(), '.fieldtheory', 'librarian', 'config.json');
    if (fs.existsSync(globalConfigPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(globalConfigPath, 'utf-8'));
        config.enabled = false;
        fs.writeFileSync(globalConfigPath, JSON.stringify(config, null, 2));
      } catch (error) {
        log.error('Failed to disable hooks in global config:', error);
      }
    }
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
      stateEnforcedThreshold: 7,  // Default to 'sometimes' frequency (7-13 prompts)
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
        };
      }
    } catch (error) {
      log.warn('Failed to load settings, using defaults:', error);
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
      log.error('Failed to save settings:', error);
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
        }
      }
    } catch (error) {
      log.warn('Index corrupted or invalid, starting fresh:', error);
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
      log.error('Failed to save index:', error);
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
      return;
    }

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
        // Could not read watched_dirs
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
        // Could not read settings
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

      // Clean up old files
      try {
        fs.unlinkSync(this.oldDbPath);
      } catch {
        // Could not delete old database
      }

      if (fs.existsSync(this.oldLibrarianDir)) {
        try {
          fs.rmSync(this.oldLibrarianDir, { recursive: true });
        } catch {
          // Could not delete old librarian directory
        }
      }
    } catch (error) {
      log.error('Migration failed:', error);
    }
  }

  // ===========================================================================
  // Markdown Parsing
  // ===========================================================================

  private parseMarkdownHeader(content: string): { title: string; context: string | null; readingTime: string | null } {
    return parseMarkdownHeader(content);
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
      log.error(`Error parsing file ${filePath}:`, error);
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
            this.cache.set(fullPath, meta);
            hasChanges = true;
          }
        } catch (error) {
          log.error(`Error processing ${file}:`, error);
        }
      }

      // Remove cached entries for files that no longer exist in this directory
      for (const [cachedPath] of this.cache) {
        if (cachedPath.startsWith(normalizedDir + path.sep) && !seenPaths.has(cachedPath)) {
          this.cache.delete(cachedPath);
          hasChanges = true;
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
      return;
    }

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
      // Reconciliation scan to catch files created during initialization
      this.scanForNewReadings(normalizedDir);
    });

    watcher.on('add', (filePath) => {
      this.handleFileChange(filePath, true);
    });

    watcher.on('change', (filePath) => {
      this.handleFileChange(filePath, false);
    });

    watcher.on('unlink', (filePath) => {
      this.handleFileDelete(filePath);
    });

    watcher.on('error', (error) => {
      log.error('Watcher error:', error);
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
      log.info(`New artifact: ${meta.title}`);
    } else if (isUpdated) {
      // Existing file was modified - just update UI, no auto-show
      this.emit('reading-updated', meta);
    }
  }

  /**
   * Handle file delete events.
   */
  private handleFileDelete(filePath: string): void {
    const normalizedPath = this.normalizePath(filePath);
    if (this.cache.has(normalizedPath)) {
      this.cache.delete(normalizedPath);
      this.saveIndex();
      this.emit('reading-removed', normalizedPath);
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
        log.info(`Reconciliation found artifact: ${meta.title}`);
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
          this.addWatchedDir(dirPath);
        }
      }
    } catch (error) {
      log.error('Error processing discovery file:', error);
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
      let content = fs.readFileSync(normalizedPath, 'utf-8');
      // Strip STORY/LESSON metadata lines (used for indexing, not display)
      content = content
        .split('\n')
        .filter(line => !line.startsWith('STORY:') && !line.startsWith('LESSON:'))
        .join('\n')
        .trimEnd();
      return { ...meta, content };
    } catch (error) {
      log.error(`Error reading file ${normalizedPath}:`, error);
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
      log.error(`Error saving file ${normalizedPath}:`, error);
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
        return false;
      }

      // Delete the file
      fs.unlinkSync(normalizedPath);

      // Remove from cache
      this.cache.delete(normalizedPath);
      this.saveIndex();

      // Emit removal event so UI can refresh
      this.emit('reading-removed', normalizedPath);

      return true;
    } catch (error) {
      log.error(`Error deleting file ${normalizedPath}:`, error);
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
      return null;
    }

    // Check if already watched
    if (this.settings.watchedDirs.includes(normalizedPath)) {
      return null;
    }

    // Add to settings
    this.settings.watchedDirs.push(normalizedPath);
    this.saveSettings();

    // Start watching
    this.watchDirectory(normalizedPath);

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
   * When disabling, also uninstalls hooks to prevent blocking Claude Code/Cursor.
   */
  setEnabled(enabled: boolean): boolean {
    this.settings.enabled = enabled;
    this.saveSettings();

    // Sync enabled state to global config (hook reads this)
    this.syncToGlobalConfig(false);

    if (!enabled) {
      // Uninstall hooks when disabling to prevent blocking user.
      // If hooks point to non-existent scripts, Claude Code fails entirely.
      this.uninstallStateEnforcedHook();
      this.uninstallCursorHook();
      this.uninstallCodexHook();
    }

    const success = this.syncClaudeMd();
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
  }

  // ===========================================================================
  // State-Enforced Mode Settings
  // ===========================================================================

  /**
   * Default rule content for state-enforced mode artifacts.
   * 120-200 word reflective story format.
   */
  private readonly DEFAULT_RULE_CONTENT =
    'Write a short reflective story (120–200 words) that connects the current work to science, technology, companies, history, biology, chemistry, or physics. Stories are memorable. Don\'t hallucinate.\n\nDefault behavior:\n\t•\tBe grounded, calm, and practical.\n\t•\tMake the connection feel natural but also surprising.\n\t•\tFavor novelty.\n\nOccasionally—but not predictably—shift modes and do one of the following:\n\t•\tReveal an adjacent historical or technical parallel that reframes the work.\n\t•\tIntroduce a concept from another discipline that subtly changes how the problem can be seen.\n\nAvoid forced cleverness.\nAvoid maximalism.';

  /**
   * Get the state-enforced mode threshold (prompts before job creation).
   */
  getStateEnforcedThreshold(): number {
    return this.settings.stateEnforcedThreshold ?? 7;  // Default to 'sometimes' frequency
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
   * Also syncs to global config for hooks.
   * Pass undefined to reset to default.
   */
  setCustomRuleContent(content: string | undefined): boolean {
    this.settings.stateEnforcedRuleContent = content?.trim() || undefined;
    this.saveSettings();

    // Sync to global config (no threshold recalculation)
    this.syncToGlobalConfig(false);

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
   * Set the discovery frequency and update thresholds.
   */
  setDiscoveryFrequency(frequency: DiscoveryFrequency): boolean {
    this.settings.discoveryFrequency = frequency;
    this.saveSettings();

    // Sync to global config with threshold recalculation
    this.syncToGlobalConfig(true);

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
    this.syncToGlobalConfig(false);
    return true;
  }

  /**
   * Get the effective rule content with user expertise appended.
   */
  getEffectiveRuleContent(): string {
    const baseRule = this.settings.stateEnforcedRuleContent || this.DEFAULT_RULE_CONTENT;
    const expertise = this.settings.userExpertiseContext;

    if (!expertise) {
      return baseRule;
    }

    return `${baseRule}\n\nContext about the reader: ${expertise}`;
  }

  /**
   * Sync current user's preferences to the global config that hooks read.
   * Called on login and whenever settings change.
   *
   * @param recalculateThreshold - Only true when frequency changes. Other settings
   *                               changes should preserve existing threshold.
   */
  private syncToGlobalConfig(recalculateThreshold: boolean = false): void {
    const globalConfigPath = path.join(os.homedir(), '.fieldtheory', 'librarian', 'config.json');
    const globalStatePath = path.join(os.homedir(), '.fieldtheory', 'librarian', 'state.json');

    // Ensure directory exists
    const dir = path.dirname(globalConfigPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Write config with all user preferences
    const config = {
      enabled: this.settings.enabled,
      frequency: this.settings.discoveryFrequency || 'sometimes',
      rule_content: this.getEffectiveRuleContent(),  // Includes expertise!
    };
    fs.writeFileSync(globalConfigPath, JSON.stringify(config, null, 2));

    // Only update state.json threshold if frequency changed
    if (recalculateThreshold) {
      const threshold = this.pickNextDiscoveryThreshold();
      let state = { count: 0, threshold };
      if (fs.existsSync(globalStatePath)) {
        try {
          const existing = JSON.parse(fs.readFileSync(globalStatePath, 'utf-8'));
          state.count = existing.count || 0;  // Preserve count
          state.threshold = threshold;
        } catch {
          // Use fresh state on parse error
        }
      }
      fs.writeFileSync(globalStatePath, JSON.stringify(state, null, 2));
    }

    // Clean up any legacy duplicate hooks and regenerate if needed
    this.cleanupLegacyHooks();
    this.ensureHookUpToDate();
  }

  /**
   * Remove legacy run-hook.sh based hooks that cause double-counting.
   * Called on every sync to ensure cleanup happens even if app was updated.
   */
  private cleanupLegacyHooks(): void {
    const settingsPath = this.getClaudeSettingsPath();
    if (!fs.existsSync(settingsPath)) return;

    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      if (!settings.hooks) return;

      const legacyPatterns = [
        'run-hook.sh',
        '.fieldtheory/librarian/hook.py',
        '.fieldtheory/librarian/pretool.py',
      ];
      const isLegacyHook = (command?: string): boolean => {
        if (!command) return false;
        return legacyPatterns.some(pattern => command.includes(pattern));
      };

      type HookEntry = { matcher?: string; hooks?: Array<{ type?: string; command?: string }> };
      let modified = false;

      if (Array.isArray(settings.hooks.UserPromptSubmit)) {
        const before = settings.hooks.UserPromptSubmit.length;
        settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
          (h: HookEntry) => !h.hooks?.some(hh => isLegacyHook(hh.command))
        );
        if (settings.hooks.UserPromptSubmit.length < before) {
          modified = true;
        }
        if (settings.hooks.UserPromptSubmit.length === 0) {
          delete settings.hooks.UserPromptSubmit;
        }
      }

      if (Array.isArray(settings.hooks.PreToolUse)) {
        const before = settings.hooks.PreToolUse.length;
        settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(
          (h: HookEntry) => !h.hooks?.some(hh => isLegacyHook(hh.command))
        );
        if (settings.hooks.PreToolUse.length < before) {
          modified = true;
        }
        if (settings.hooks.PreToolUse.length === 0) {
          delete settings.hooks.PreToolUse;
        }
      }

      if (modified) {
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      }
    } catch (error) {
      log.error('Failed to cleanup legacy hooks:', error);
    }
  }

  /**
   * Hook version for detecting when regeneration is needed.
   */
  private readonly HOOK_VERSION = '2.0';

  /**
   * Ensure hooks are up to date with current template.
   * Checks version marker and regenerates if needed.
   * Only updates the active ~/.claude/ hooks (legacy .fieldtheory/librarian/ hooks are cleaned up).
   */
  private ensureHookUpToDate(): void {
    const hookScript = this.generateStateEnforcedHookScript();

    // Only update the active hook at ~/.claude/
    const hookPath = this.getStateEnforcedHookPath();
    if (fs.existsSync(hookPath)) {
      try {
        const content = fs.readFileSync(hookPath, 'utf-8');
        const versionMatch = content.match(/# Field Theory Librarian Hook v(\d+\.\d+)/);
        const currentVersion = versionMatch?.[1];

        if (currentVersion !== this.HOOK_VERSION) {
          // Regenerate hook with new template
          fs.writeFileSync(hookPath, hookScript, { mode: 0o755 });
        }
      } catch (error) {
        log.error(`Failed to check hook version at ${hookPath}:`, error);
      }
    }

    // Check Cursor pretool hook
    const cursorPreToolPath = this.getCursorPreToolScriptPath();
    if (fs.existsSync(cursorPreToolPath)) {
      try {
        const content = fs.readFileSync(cursorPreToolPath, 'utf-8');
        const versionMatch = content.match(/# Field Theory Librarian PreToolUse Hook v(\d+\.\d+)/);
        const currentVersion = versionMatch?.[1];

        if (currentVersion !== this.HOOK_VERSION) {
          // Regenerate Cursor pretool with new template
          fs.writeFileSync(cursorPreToolPath, this.generateCursorPreToolScript(), { mode: 0o755 });
        }
      } catch (error) {
        log.error('Failed to check Cursor pretool version:', error);
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
      return true;
    } catch (error) {
      log.error('Failed to write command file:', error);
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

Store each reading in \`~/.fieldtheory/librarian/artifacts/\` with a unique filename.

This should feel serendipitous—not every change, just when there's meaningful wait time. Use your discretion.
${this.CLAUDE_MD_END_MARKER}`;
  }

  /**
   * Write the Librarian section to CLAUDE.md.
   * Also writes the command file that CLAUDE.md references.
   */
  private writeLibrarianSection(): boolean {
    // First write the command file (single source of truth)
    if (!this.writeLibrarianCommandFile()) {
      log.error('Failed to write command file, aborting CLAUDE.md update');
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

      return true;
    } catch (error) {
      log.error('Failed to write CLAUDE.md:', error);
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

      return true;
    } catch (error) {
      log.error('Failed to remove from CLAUDE.md:', error);
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

      return true;
    } catch (error) {
      log.error('Failed to update CLAUDE.md:', error);
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
      log.error('Error checking screenshot permission:', error);
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
          // Could not parse existing settings.json, starting fresh
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
        return true;
      }

      // Add the permission
      allowList.push(permissionToAdd);

      // Write back
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      return true;
    } catch (error) {
      log.error('Failed to enable screenshot permission:', error);
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
      log.error('Error reading permission manifest:', error);
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
      log.error('Error writing permission manifest:', error);
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
      log.error('Error reading Claude permissions:', error);
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
          // Could not parse settings.json, starting fresh
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

      return true;
    } catch (error) {
      log.error('Failed to add permissions:', error);
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

      return true;
    } catch (error) {
      log.error('Failed to remove permissions:', error);
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
      log.error(`Unknown profile: ${profileId}`);
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
      log.error('Failed to apply profile:', error);
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

      // 3. Update Claude Code settings.json
      const settingsPath = this.getClaudeSettingsPath();
      let settings: Record<string, unknown> = {};

      if (fs.existsSync(settingsPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        } catch {
          // Could not parse existing settings.json, starting fresh
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
      }

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      return true;
    } catch (error) {
      log.error('Failed to install hook:', error);
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
      }

      // Also remove old increment script if it exists (cleanup from previous version)
      const oldIncrementScript = path.join(os.homedir(), '.claude', 'librarian-increment.sh');
      if (fs.existsSync(oldIncrementScript)) {
        fs.unlinkSync(oldIncrementScript);
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

      return true;
    } catch (error) {
      log.error('Failed to uninstall hook:', error);
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
    // Shared config path - both Claude Code and Cursor hooks read from here
    return path.join(os.homedir(), '.fieldtheory', 'librarian', 'config.json');
  }

  /**
   * Get the path to the Field Theory Librarian PreToolUse auto-approve hook.
   */
  private getPreToolUseHookPath(): string {
    return path.join(os.homedir(), '.claude', 'fieldtheory-librarian-pretool.py');
  }

  /**
   * Ensure the global artifacts directory exists and is watched.
   * Uses GLOBAL path (same as hook.py) so artifacts auto-open.
   * This runs on startup so users don't need to configure anything.
   */
  private ensureCentralArtifactsDir(): void {
    // Use global path - hooks write artifacts here, not per-user path
    const globalLibrarianDir = path.join(os.homedir(), '.fieldtheory', 'librarian');
    const artifactsDir = path.join(globalLibrarianDir, 'artifacts');

    // Create directory if it doesn't exist
    if (!fs.existsSync(artifactsDir)) {
      fs.mkdirSync(artifactsDir, { recursive: true });
    }

    // Add to watched dirs if not already present
    if (!this.settings.watchedDirs.includes(artifactsDir)) {
      this.settings.watchedDirs.push(artifactsDir);
      this.saveSettings();
    }
  }

  /**
   * Generate the PreToolUse auto-approve hook script.
   * This hook auto-approves Write/Edit operations to the Field Theory librarian directory,
   * eliminating permission prompts for artifact creation.
   */
  private generatePreToolUseHookScript(): string {
    // Use global path (same as hook.py) - NOT per-user path
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

    # Auto-approve reads/writes to global librarian directory (where hooks write artifacts/jobs)
    if tool_name in ("Read", "Write", "Edit"):
        file_path = tool_input.get("file_path", "")
        global_librarian_dir = str(Path.home() / ".fieldtheory" / "librarian")

        if file_path.startswith(global_librarian_dir):
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

  // ============================================================================
  // Read Permission Hooks (separate from Librarian)
  // These auto-approve reads for Field Theory files (figures, commands)
  // ============================================================================

  /**
   * Generate PreToolUse hook for auto-approving Field Theory file reads.
   * This is SEPARATE from the Librarian hooks - it handles read permissions only.
   * The hook never blocks - it can only auto-approve or pass through.
   */
  private generateReadPermissionHookScript(): string {
    return `#!/usr/bin/env python3
"""
PreToolUse Auto-Approve Hook for Field Theory Read Permissions

Auto-approves Read/Write/Edit operations for:
- ~/Library/Application Support/fieldtheory-mac/users/*/figures/* (screenshot figures)
- .cursor/commands/* (portable commands)

This is separate from Librarian functionality.
Never blocks - only auto-approves or passes through to normal flow.
"""
import json
import sys

def main():
    try:
        input_data = json.load(sys.stdin)
    except:
        sys.exit(0)

    tool_name = input_data.get("tool_name", "")
    tool_input = input_data.get("tool_input", {})

    if tool_name in ("Read", "Write", "Edit"):
        file_path = tool_input.get("file_path", "")

        # Check for screenshot figures (fieldtheory-mac/.../figures/...)
        if "fieldtheory-mac" in file_path and "/figures/" in file_path:
            print(json.dumps({
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "allow"
                }
            }))
            sys.exit(0)

        # Check for portable commands (.cursor/commands/...)
        if "/.cursor/commands/" in file_path:
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
   * Get the path for the read permission hook script.
   */
  private getReadPermissionHookPath(): string {
    return path.join(os.homedir(), '.claude', 'fieldtheory-read-permission-hook.py');
  }

  /**
   * Check if the read permission hook is installed.
   */
  isReadPermissionHookInstalled(): boolean {
    try {
      const settingsPath = this.getClaudeSettingsPath();
      if (!fs.existsSync(settingsPath)) return false;

      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const hookPath = this.getReadPermissionHookPath();
      const command = `python3 "${hookPath}"`;

      if (!Array.isArray(settings.hooks?.PreToolUse)) return false;

      return settings.hooks.PreToolUse.some(
        (h: { hooks?: Array<{ command?: string }> }) =>
          h.hooks?.some(hh => hh.command === command)
      );
    } catch {
      return false;
    }
  }

  /**
   * Check if the read permission hook needs updating (installed but missing newer permissions).
   */
  needsReadPermissionUpdate(): boolean {
    try {
      if (!this.isReadPermissionHookInstalled()) return false;

      const settingsPath = this.getClaudeSettingsPath();
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      const allowList: string[] = settings.permissions?.allow ?? [];

      const handoffsDir = path.join(os.homedir(), '.fieldtheory', 'handoffs');
      const requiredPerms = [
        `Read(${handoffsDir}/*)`,
        `Write(${handoffsDir}/*)`,
        `Edit(${handoffsDir}/*)`,
      ];

      return requiredPerms.some(p => !allowList.includes(p));
    } catch {
      return false;
    }
  }

  /**
   * Install the read permission auto-approve hook for Claude Code.
   * Separate from Librarian hooks. Returns result with feedback message.
   */
  installReadPermissionHook(): { success: boolean; message: string } {
    try {
      const claudeDir = path.join(os.homedir(), '.claude');
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }

      // Write hook script
      const hookPath = this.getReadPermissionHookPath();
      fs.writeFileSync(hookPath, this.generateReadPermissionHookScript(), { mode: 0o755 });

      // Register in settings.json
      const settingsPath = this.getClaudeSettingsPath();
      let settings: Record<string, unknown> = {};
      if (fs.existsSync(settingsPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        } catch {
          // Could not parse settings.json, starting fresh
        }
      }

      // Ensure hooks structure exists
      if (!settings.hooks || typeof settings.hooks !== 'object') {
        settings.hooks = {};
      }
      const hooks = settings.hooks as Record<string, unknown>;

      // Add to PreToolUse hooks if not already present
      if (!Array.isArray(hooks.PreToolUse)) {
        hooks.PreToolUse = [];
      }

      const command = `python3 "${hookPath}"`;
      type HookEntry = { matcher?: string; hooks?: Array<{ type?: string; command?: string }> };
      const exists = (hooks.PreToolUse as HookEntry[]).some(h =>
        h.hooks?.some(hh => hh.command === command)
      );

      if (!exists) {
        (hooks.PreToolUse as HookEntry[]).push({
          matcher: 'Read|Write|Edit',
          hooks: [{ type: 'command', command }],
        });
      }

      // Create handoffs directory and add permissions
      const handoffsDir = path.join(os.homedir(), '.fieldtheory', 'handoffs');
      if (!fs.existsSync(handoffsDir)) {
        fs.mkdirSync(handoffsDir, { recursive: true });
      }

      // Ensure permissions.allow exists
      if (!settings.permissions) {
        settings.permissions = { allow: [] };
      }
      const permissions = settings.permissions as Record<string, unknown>;
      if (!Array.isArray(permissions.allow)) {
        permissions.allow = [];
      }
      const allowList = permissions.allow as string[];

      // Add handoff permissions if not already present
      const handoffPerms = [
        `Read(${handoffsDir}/*)`,
        `Write(${handoffsDir}/*)`,
        `Edit(${handoffsDir}/*)`,
      ];
      for (const perm of handoffPerms) {
        if (!allowList.includes(perm)) {
          allowList.push(perm);
        }
      }

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

      return {
        success: true,
        message: 'Hook added to ~/.claude/settings.json',
      };
    } catch (error) {
      log.error('Failed to install read permission hook:', error);
      return {
        success: false,
        message: `Failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Uninstall the read permission hook for Claude Code.
   * Returns result with feedback message.
   */
  uninstallReadPermissionHook(): { success: boolean; message: string } {
    try {
      const hookPath = this.getReadPermissionHookPath();
      const settingsPath = this.getClaudeSettingsPath();

      // Remove from settings.json
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        const command = `python3 "${hookPath}"`;

        if (settings.hooks?.PreToolUse) {
          settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(
            (h: { hooks?: Array<{ command?: string }> }) =>
              !h.hooks?.some(hh => hh.command === command)
          );
          if (settings.hooks.PreToolUse.length === 0) {
            delete settings.hooks.PreToolUse;
          }
        }

        // Clean up empty hooks object
        if (settings.hooks && Object.keys(settings.hooks).length === 0) {
          delete settings.hooks;
        }

        // Remove handoff permissions
        const handoffsDir = path.join(os.homedir(), '.fieldtheory', 'handoffs');
        if (settings.permissions && Array.isArray((settings.permissions as Record<string, unknown>).allow)) {
          const allowList = (settings.permissions as Record<string, unknown>).allow as string[];
          const handoffPerms = [
            `Read(${handoffsDir}/*)`,
            `Write(${handoffsDir}/*)`,
            `Edit(${handoffsDir}/*)`,
          ];
          (settings.permissions as Record<string, unknown>).allow = allowList.filter(
            (p: string) => !handoffPerms.includes(p)
          );
        }

        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      }

      // Remove hook file
      if (fs.existsSync(hookPath)) {
        fs.unlinkSync(hookPath);
      }

      return {
        success: true,
        message: 'Hook removed from ~/.claude/settings.json',
      };
    } catch (error) {
      log.error('Failed to uninstall read permission hook:', error);
      return {
        success: false,
        message: `Failed: ${(error as Error).message}`,
      };
    }
  }

  // ============================================================================
  // Cursor Read Permission Hooks
  // ============================================================================

  /**
   * Get the path for the Cursor read permission hook script.
   */
  private getCursorReadPermissionHookPath(): string {
    return path.join(os.homedir(), '.cursor', 'fieldtheory-read-permission-hook.py');
  }

  /**
   * Check if the Cursor read permission hook is installed.
   */
  isCursorReadPermissionHookInstalled(): boolean {
    try {
      const hooksPath = path.join(os.homedir(), '.cursor', 'hooks.json');
      if (!fs.existsSync(hooksPath)) return false;

      const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf-8'));
      const hookPath = this.getCursorReadPermissionHookPath();
      const command = `python3 "${hookPath}"`;

      if (!Array.isArray(hooks.preToolUse)) return false;

      return hooks.preToolUse.some(
        (h: { command?: string }) => h.command === command
      );
    } catch {
      return false;
    }
  }

  /**
   * Install the read permission hook for Cursor.
   */
  installCursorReadPermissionHook(): { success: boolean; message: string } {
    try {
      const cursorDir = path.join(os.homedir(), '.cursor');
      if (!fs.existsSync(cursorDir)) {
        fs.mkdirSync(cursorDir, { recursive: true });
      }

      // Write hook script (same script, Cursor-compatible)
      const hookPath = this.getCursorReadPermissionHookPath();
      fs.writeFileSync(hookPath, this.generateReadPermissionHookScript(), { mode: 0o755 });

      // Register in hooks.json
      const hooksPath = path.join(cursorDir, 'hooks.json');
      let hooks: Record<string, unknown> = {};
      if (fs.existsSync(hooksPath)) {
        try {
          hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf-8'));
        } catch {
          // Could not parse Cursor hooks.json, starting fresh
        }
      }

      // Add to preToolUse hooks if not already present
      if (!Array.isArray(hooks.preToolUse)) {
        hooks.preToolUse = [];
      }

      const command = `python3 "${hookPath}"`;
      type CursorHook = { command?: string; matcher?: string };
      const exists = (hooks.preToolUse as CursorHook[]).some(h => h.command === command);

      if (!exists) {
        (hooks.preToolUse as CursorHook[]).push({
          matcher: 'read_file|write_new_file|file_str_replace|edit_file',
          command,
        });
      }

      fs.writeFileSync(hooksPath, JSON.stringify(hooks, null, 2));

      return {
        success: true,
        message: 'Hook added to ~/.cursor/hooks.json',
      };
    } catch (error) {
      log.error('Failed to install Cursor read permission hook:', error);
      return {
        success: false,
        message: `Failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Uninstall the read permission hook for Cursor.
   */
  uninstallCursorReadPermissionHook(): { success: boolean; message: string } {
    try {
      const hookPath = this.getCursorReadPermissionHookPath();
      const hooksPath = path.join(os.homedir(), '.cursor', 'hooks.json');

      // Remove from hooks.json
      if (fs.existsSync(hooksPath)) {
        const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf-8'));
        const command = `python3 "${hookPath}"`;

        if (hooks.preToolUse) {
          hooks.preToolUse = hooks.preToolUse.filter(
            (h: { command?: string }) => h.command !== command
          );
          if (hooks.preToolUse.length === 0) {
            delete hooks.preToolUse;
          }
        }

        fs.writeFileSync(hooksPath, JSON.stringify(hooks, null, 2));
      }

      // Remove hook file
      if (fs.existsSync(hookPath)) {
        fs.unlinkSync(hookPath);
      }

      return {
        success: true,
        message: 'Hook removed from ~/.cursor/hooks.json',
      };
    } catch (error) {
      log.error('Failed to uninstall Cursor read permission hook:', error);
      return {
        success: false,
        message: `Failed: ${(error as Error).message}`,
      };
    }
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
    return `#!/usr/bin/env python3
# Field Theory Librarian Hook v${this.HOOK_VERSION}
"""
State-Enforced Librarian Hook (Global)
Works in any directory. Creates job files when threshold is reached.
All artifacts stored centrally in ~/.fieldtheory/librarian/artifacts/
PreToolUse hook handles auto-approval - no permissions needed.

Config is synced by Field Theory app to ~/.fieldtheory/librarian/config.json
"""
import json
import os
import sys
import fcntl
from pathlib import Path
from datetime import datetime

DEFAULT_RULE_CONTENT = """${this.DEFAULT_RULE_CONTENT.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/"/g, '\\"')}"""

def main():
    # Get project root from environment (set by Claude Code)
    project_root = Path(os.environ.get('CLAUDE_PROJECT_DIR', os.getcwd()))
    project_name = project_root.name  # Just the directory name

    # Read global config from ~/.fieldtheory/librarian/ (synced by Field Theory app)
    central_dir = Path.home() / ".fieldtheory" / "librarian"
    config_path = central_dir / "config.json"
    state_path = central_dir / "state.json"

    if not config_path.exists():
        return

    with open(config_path) as f:
        cfg = json.load(f)

    enabled = cfg.get("enabled", False)
    if not enabled:
        return

    # Read rule_content from config (includes user expertise if set)
    rule_content = cfg.get("rule_content", DEFAULT_RULE_CONTENT)

    # Read threshold and mute status from state.json (managed by app's game mechanics)
    threshold = 7  # Default
    muted_until = 0
    if state_path.exists():
        try:
            with open(state_path) as f:
                state = json.load(f)
                threshold = state.get("threshold", 7)
                muted_until = state.get("mutedUntil", 0)
        except:
            pass

    if not isinstance(threshold, int) or threshold <= 0:
        threshold = 7

    # Check if muted for today
    import time
    if muted_until and time.time() * 1000 < muted_until:
        return  # Muted, skip artifact generation

    jobs_dir = central_dir / "jobs"
    artifacts_dir = central_dir / "artifacts"

    # Create directories
    jobs_dir.mkdir(parents=True, exist_ok=True)
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    lock_file = central_dir / ".lock"
    seq_file = central_dir / ".seq"

    # Use fcntl for cross-platform file locking
    with open(lock_file, "w") as lf:
        fcntl.flock(lf.fileno(), fcntl.LOCK_EX)

        # Read current count from state.json
        count = 0
        if state_path.exists():
            try:
                with open(state_path) as f:
                    state = json.load(f)
                    count = state.get("count", 0)
            except:
                pass

        count += 1

        # Update count in state.json
        state_data = {"count": count, "threshold": threshold}
        with open(state_path, "w") as f:
            json.dump(state_data, f, indent=2)

        if count < threshold:
            return

        # Reset count
        state_data["count"] = 0
        with open(state_path, "w") as f:
            json.dump(state_data, f, indent=2)

        # Increment global seq
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
                "created_at": datetime.now().isoformat()
            }
            job_file.write_text(json.dumps(job_data, indent=2) + "\\n")

        # 3. Output additionalContext with ALL details (no file reads needed)
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

      // 4. Write global config (includes user expertise context)
      const configPath = this.getGlobalStateEnforcedConfigPath();
      const config = {
        enabled: true,
        threshold: this.getStateEnforcedThreshold(),
        rule_content: this.getEffectiveRuleContent(),
      };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

      // 5. Register BOTH hooks in ~/.claude/settings.json
      const settingsPath = this.getClaudeSettingsPath();
      let settings: Record<string, unknown> = {};

      if (fs.existsSync(settingsPath)) {
        try {
          settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        } catch {
          // Could not parse existing settings.json, starting fresh
        }
      }

      // Ensure hooks object exists
      if (!settings.hooks || typeof settings.hooks !== 'object') {
        settings.hooks = {};
      }
      const hooks = settings.hooks as Record<string, unknown>;

      // Helper type for hook entries
      type HookEntry = { matcher?: string; hooks?: Array<{ type?: string; command?: string }> };

      // Clean up legacy run-hook.sh based hooks (these cause double-counting)
      // Only keep the direct Python hook we're about to add
      const legacyPatterns = [
        'run-hook.sh',
        '.fieldtheory/librarian/hook.py',
        '.fieldtheory/librarian/pretool.py',
      ];
      const isLegacyHook = (command?: string): boolean => {
        if (!command) return false;
        return legacyPatterns.some(pattern => command.includes(pattern));
      };

      if (Array.isArray(hooks['UserPromptSubmit'])) {
        hooks['UserPromptSubmit'] = (hooks['UserPromptSubmit'] as HookEntry[]).filter(
          h => !h.hooks?.some(hh => isLegacyHook(hh.command))
        );
      }

      if (Array.isArray(hooks['PreToolUse'])) {
        hooks['PreToolUse'] = (hooks['PreToolUse'] as HookEntry[]).filter(
          h => !h.hooks?.some(hh => isLegacyHook(hh.command))
        );
      }

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

      // 6. Auto-add GLOBAL artifacts directory to watched dirs so markdown files open in Field Theory
      // Use global path (same as hook.py writes to), not per-user path
      const globalArtifactsDir = path.join(os.homedir(), '.fieldtheory', 'librarian', 'artifacts');
      this.addWatchedDir(globalArtifactsDir);

      log.info('Installed global state-enforced hooks');
      return true;
    } catch (error) {
      log.error('Failed to install state-enforced hook:', error);
      return false;
    }
  }

  /**
   * Uninstall the global state-enforced hooks.
   * Note: We keep hook files on disk but set enabled=false in config.
   * This allows running Claude sessions to gracefully stop (hooks check enabled flag)
   * instead of erroring on missing files.
   */
  uninstallStateEnforcedHook(): boolean {
    try {
      const userPromptHookPath = this.getStateEnforcedHookPath();
      const preToolUseHookPath = this.getPreToolUseHookPath();
      const configPath = this.getGlobalStateEnforcedConfigPath();

      // Disable in config - hooks check this flag and exit silently if false
      // This allows running Claude sessions to gracefully stop without errors
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        config.enabled = false;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      } else {
        // Create config with enabled=false if it doesn't exist
        fs.writeFileSync(configPath, JSON.stringify({ enabled: false }, null, 2));
      }

      // Remove hook registrations from ~/.claude/settings.json (for new sessions)
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

      return true;
    } catch (error) {
      log.error('Failed to uninstall state-enforced hooks:', error);
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
   * Get count of pending jobs (from global directory where hooks write).
   */
  getPendingJobCount(): number {
    // Use GLOBAL path (same as hook.py writes to), not per-user path
    const jobsDir = path.join(os.homedir(), '.fieldtheory', 'librarian', 'jobs');

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
  private logStatus(_action: string): void {
    // Status logging disabled for cleaner output
  }

  /**
   * Get the current status for debugging.
   * Reads from the GLOBAL state.json file (shared across all projects).
   */
  getEditStatus(): { edits: number; threshold: number; frequency: string } | null {
    try {
      // Read from GLOBAL state file (same location hook writes to)
      const stateFile = path.join(os.homedir(), '.fieldtheory', 'librarian', 'state.json');
      const frequency = this.settings.discoveryFrequency || 'sometimes';

      if (fs.existsSync(stateFile)) {
        const raw = fs.readFileSync(stateFile, 'utf-8');
        const state = JSON.parse(raw);
        return {
          edits: state.count || 0,
          threshold: state.threshold || 7,
          frequency,
        };
      }

      // Initialize global state file
      const initialState = { count: 0, threshold: this.pickNextDiscoveryThreshold() };
      fs.writeFileSync(stateFile, JSON.stringify(initialState, null, 2));
      return { edits: 0, threshold: initialState.threshold, frequency };
    } catch (error) {
      log.error('Failed to get edit status:', error);
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
      log.error('Failed to get counter status:', error);
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
   * Reset the counter and pick new threshold. Called when a reading is created.
   * Updates the GLOBAL state.json with a fresh game-mechanics threshold.
   */
  resetCounter(): void {
    const newThreshold = this.pickNextDiscoveryThreshold();

    try {
      // Use GLOBAL state file (same location hook writes to)
      const stateFile = path.join(os.homedir(), '.fieldtheory', 'librarian', 'state.json');
      const newState = { count: 0, threshold: newThreshold };
      fs.writeFileSync(stateFile, JSON.stringify(newState, null, 2));
    } catch (error) {
      log.error('Failed to reset counter:', error);
    }
  }

  /**
   * Reset the global prompt counter.
   * Used for debugging/testing when hooks aren't triggering properly.
   */
  resetAllCounters(): boolean {
    try {
      // Use GLOBAL state file (same location hook writes to)
      const stateFile = path.join(os.homedir(), '.fieldtheory', 'librarian', 'state.json');
      const newState = { count: 0, threshold: this.pickNextDiscoveryThreshold() };
      fs.writeFileSync(stateFile, JSON.stringify(newState, null, 2));
      return true;
    } catch (error) {
      log.error('Failed to reset counter:', error);
      return false;
    }
  }

  // ===========================================================================
  // Mute for Today
  // ===========================================================================

  /**
   * Mute the Librarian until end of today (midnight local time).
   * Updates state.json with a mutedUntil timestamp.
   */
  muteForToday(): boolean {
    try {
      const stateFile = path.join(os.homedir(), '.fieldtheory', 'librarian', 'state.json');

      // Calculate midnight tonight (local time)
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
      const mutedUntil = midnight.getTime();

      // Read existing state
      let state: { count: number; threshold: number; mutedUntil?: number } = { count: 0, threshold: 7 };
      if (fs.existsSync(stateFile)) {
        try {
          state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
        } catch {
          // Use defaults
        }
      }

      // Add mutedUntil
      state.mutedUntil = mutedUntil;
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
      return true;
    } catch (error) {
      log.error('Failed to mute:', error);
      return false;
    }
  }

  /**
   * Check if the Librarian is currently muted.
   */
  isMutedForToday(): boolean {
    try {
      const stateFile = path.join(os.homedir(), '.fieldtheory', 'librarian', 'state.json');
      if (!fs.existsSync(stateFile)) {
        return false;
      }

      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      if (!state.mutedUntil) {
        return false;
      }

      return Date.now() < state.mutedUntil;
    } catch (error) {
      log.error('Failed to check mute status:', error);
      return false;
    }
  }

  /**
   * Unmute the Librarian (clear the mutedUntil timestamp).
   */
  unmute(): boolean {
    try {
      const stateFile = path.join(os.homedir(), '.fieldtheory', 'librarian', 'state.json');
      if (!fs.existsSync(stateFile)) {
        return true;
      }

      const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      delete state.mutedUntil;
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
      return true;
    } catch (error) {
      log.error('Failed to unmute:', error);
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
      } catch (error) {
        log.error(`Failed to create directory ${normalizedPath}:`, error);
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
      log.error('Failed to create welcome artifact:', error);
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
    for (const [, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
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

    return unique;
  }

  // ===========================================================================
  // Shared Hook Install Helpers
  // ===========================================================================

  /**
   * Ensure central librarian directories, rule file, config, and watched dirs
   * exist and are properly configured. Shared by all platform install methods.
   * Returns the central directory path.
   */
  private ensureCentralLibrarianSetup(): string {
    const centralDir = this.getCentralLibrarianDir();
    const dirs = [
      centralDir,
      path.join(centralDir, 'jobs'),
      path.join(centralDir, 'artifacts'),
      path.join(centralDir, 'rules'),
    ];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Ensure rule file exists
    const ruleFile = path.join(centralDir, 'rules', 'history_reading.md');
    if (!fs.existsSync(ruleFile)) {
      fs.writeFileSync(ruleFile, this.getEffectiveRuleContent());
    }

    // Ensure config file exists and is enabled
    const configFile = path.join(centralDir, 'config.json');
    if (!fs.existsSync(configFile)) {
      fs.writeFileSync(configFile, JSON.stringify({ enabled: true }, null, 2));
    } else {
      try {
        const config = JSON.parse(fs.readFileSync(configFile, 'utf-8'));
        config.enabled = true;
        fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
      } catch {
        fs.writeFileSync(configFile, JSON.stringify({ enabled: true }, null, 2));
      }
    }

    // Auto-add GLOBAL artifacts directory to watched dirs
    const globalArtifactsDir = path.join(os.homedir(), '.fieldtheory', 'librarian', 'artifacts');
    this.addWatchedDir(globalArtifactsDir);

    return centralDir;
  }

  // ===========================================================================
  // Cursor Hook Management
  // ===========================================================================

  /**
   * Get the path to the global Cursor hooks config file.
   */
  private getCursorHooksConfigPath(): string {
    return path.join(os.homedir(), '.cursor', 'hooks.json');
  }

  /**
   * Get the path to the Field Theory Cursor beforeSubmitPrompt hook script.
   */
  private getCursorHookScriptPath(): string {
    return path.join(os.homedir(), '.fieldtheory', 'librarian', 'cursor-hook.py');
  }

  /**
   * Get the path to the Field Theory Cursor preToolUse hook script.
   */
  private getCursorPreToolScriptPath(): string {
    return path.join(os.homedir(), '.fieldtheory', 'librarian', 'cursor-pretool.py');
  }

  /**
   * Get the path to the Field Theory Cursor hook config.
   * @deprecated - now uses central librarian config
   */
  private getCursorHookConfigPath(): string {
    return path.join(os.homedir(), '.fieldtheory', 'hooks', 'cursor-config.json');
  }

  /**
   * Generate the Cursor beforeSubmitPrompt hook script content (Python).
   * This script counts prompts and creates jobs at threshold.
   * It does NOT output additionalContext (Cursor ignores it).
   * The preToolUse hook (cursor-pretool.py) enforces artifact creation via deny pattern.
   */
  private generateCursorHookScript(): string {
    return `#!/usr/bin/env python3
"""
Field Theory Librarian Hook for Cursor (beforeSubmitPrompt)

Counts prompts and creates job files when threshold is reached.
Does NOT output additionalContext (Cursor ignores it anyway).
The preToolUse hook (cursor-pretool.py) handles artifact enforcement via deny pattern.

State is GLOBAL at ~/.fieldtheory/librarian/state.json
"""
import json
import os
import sys
import fcntl
from pathlib import Path
from datetime import datetime

DEFAULT_THRESHOLD = 7


def main():
    # Read stdin (Cursor passes JSON here)
    input_data = {}
    try:
        import select
        if select.select([sys.stdin], [], [], 0.0)[0]:
            input_data = json.load(sys.stdin)
    except:
        pass

    # Get project info (for artifact metadata)
    workspace_roots = input_data.get("workspace_roots", [])
    if workspace_roots:
        project_root = Path(workspace_roots[0])
    else:
        project_root = Path(os.environ.get("CURSOR_PROJECT_DIR", os.getcwd()))
    project_name = project_root.name

    # Read config
    central_dir = Path.home() / ".fieldtheory" / "librarian"
    config_path = central_dir / "config.json"
    if not config_path.exists():
        return

    with open(config_path) as f:
        cfg = json.load(f)

    if not cfg.get("enabled", False):
        return

    # Paths
    jobs_dir = central_dir / "jobs"
    artifacts_dir = central_dir / "artifacts"
    rules_dir = central_dir / "rules"
    rule_file = rules_dir / "history_reading.md"
    state_file = central_dir / "state.json"
    lock_file = central_dir / ".lock"
    seq_file = central_dir / ".seq"

    # Check mute status
    if state_file.exists():
        try:
            import time
            state_data = json.loads(state_file.read_text())
            muted_until = state_data.get("mutedUntil", 0)
            if muted_until and time.time() * 1000 < muted_until:
                return  # Muted, skip artifact generation
        except:
            pass

    # Ensure directories exist
    jobs_dir.mkdir(parents=True, exist_ok=True)
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    rules_dir.mkdir(parents=True, exist_ok=True)

    # File-locked state update
    with open(lock_file, "w") as lf:
        fcntl.flock(lf.fileno(), fcntl.LOCK_EX)

        # Read current state
        state = {"count": 0, "threshold": DEFAULT_THRESHOLD}
        if state_file.exists():
            try:
                state = json.loads(state_file.read_text())
            except:
                pass

        count = state.get("count", 0) + 1
        threshold = state.get("threshold", DEFAULT_THRESHOLD)
        triggered = count >= threshold

        # Single write: either incremented count, or reset to 0 if triggered
        state["count"] = 0 if triggered else count
        state_file.write_text(json.dumps(state, indent=2))

        if not triggered:
            return

        # Threshold reached - create artifact job
        seq = 0
        if seq_file.exists():
            try:
                seq = int(seq_file.read_text().strip())
            except:
                seq = 0
        seq += 1
        seq_file.write_text(str(seq))

        timestamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
        job_file = jobs_dir / f"job_{seq}.json"
        out_file = artifacts_dir / f"{project_name}-{timestamp}-artifact.md"

        # Check if job already done
        job_is_done = False
        if job_file.exists():
            try:
                existing = json.loads(job_file.read_text())
                job_is_done = existing.get("status") == "done"
            except:
                pass

        # Single pending job rule: abandon any existing pending jobs before creating new one
        for old_job_file in list(jobs_dir.glob("job_*.json")) + list(jobs_dir.glob("cursor-job_*.json")):
            if old_job_file == job_file:
                continue  # Skip the current job file
            try:
                old_job = json.loads(old_job_file.read_text())
                if old_job.get("status") == "pending":
                    old_job["status"] = "abandoned"
                    old_job["abandoned_at"] = datetime.now().isoformat()
                    old_job_file.write_text(json.dumps(old_job, indent=2) + "\\n")
            except:
                continue

        # Create job file (preToolUse hook will enforce artifact creation)
        if not job_file.exists():
            job_file.write_text(json.dumps({
                "schema_version": 1,
                "id": seq,
                "type": "history_artifact",
                "status": "pending",
                "project": project_name,
                "project_path": str(project_root),
                "output": str(out_file),
                "rule_file": str(rule_file),
                "created_at": datetime.now().isoformat()
            }, indent=2) + "\\n")

        # No additionalContext output - Cursor ignores it
        # The preToolUse hook (cursor-pretool.py) will enforce artifact creation


if __name__ == "__main__":
    main()
`;
  }

  /**
   * Generate the Cursor preToolUse hook script content (Python).
   * This script gates tool use on pending Librarian jobs.
   * When a pending job exists, it denies tool use with instructions to create artifact first.
   * This is the "semaphore" that enforces artifact-before-implementation ordering.
   */
  private generateCursorPreToolScript(): string {
    return `#!/usr/bin/env python3
# Field Theory Librarian PreToolUse Hook v${this.HOOK_VERSION}
"""
Field Theory Librarian PreToolUse Hook for Cursor

Gates tool use on pending Librarian jobs.
When a pending job exists, denies tool use with instructions to create artifact first.
Always allows operations on the librarian directory (needed to write artifact and mark done).

This is the "semaphore" that enforces artifact-before-implementation ordering.
"""
import json
import sys
from pathlib import Path

LIBRARIAN_DIR = Path.home() / ".fieldtheory" / "librarian"
CONFIG_PATH = LIBRARIAN_DIR / "config.json"


def main():
    # Parse stdin for tool info
    input_data = {}
    try:
        import select
        if select.select([sys.stdin], [], [], 0.0)[0]:
            input_data = json.load(sys.stdin)
    except:
        pass

    # Extract file path from tool arguments
    # Cursor format - trying common patterns
    file_path = ""
    if "arguments" in input_data:
        args = input_data["arguments"]
        if isinstance(args, dict):
            file_path = args.get("file_path", "") or args.get("path", "") or args.get("filePath", "")

    # Also check tool_input for some tools
    if not file_path and "tool_input" in input_data:
        tool_input = input_data["tool_input"]
        if isinstance(tool_input, dict):
            file_path = tool_input.get("file_path", "") or tool_input.get("path", "")

    # Always allow operations on librarian directory
    # (needed to write artifact and mark job done)
    if file_path and file_path.startswith(str(LIBRARIAN_DIR)):
        print(json.dumps({"decision": "allow"}))
        return

    # Check for pending jobs
    jobs_dir = LIBRARIAN_DIR / "jobs"
    pending_job = None

    if jobs_dir.exists():
        for job_file in sorted(jobs_dir.glob("job_*.json"), reverse=True):
            try:
                job = json.loads(job_file.read_text())
                if job.get("status") == "pending":
                    pending_job = (job_file, job)
                    break
            except:
                continue

    if pending_job:
        job_file, job = pending_job

        # Read rule_content from config (synced by Field Theory app)
        rule_content = "Write a short reflective story (120-200 words) connecting current work to science/history."
        if CONFIG_PATH.exists():
            try:
                cfg = json.loads(CONFIG_PATH.read_text())
                rule_content = cfg.get("rule_content", rule_content)
            except:
                pass

        reason = f"""[LIBRARIAN] Pending artifact job must be completed first.

Job file: {job_file}
Output path: {job.get('output')}

Rule: {rule_content}

Steps:
1. Write artifact to the output path following the rule above
2. Update the job file, setting "status" to "done"
3. Retry your original tool operation"""

        # DENY: output JSON reason AND exit code 2 (Cursor honors exit code 2 for blocking)
        print(json.dumps({"decision": "deny", "reason": reason}))
        sys.exit(2)
    else:
        # No pending jobs - allow
        print(json.dumps({"decision": "allow"}))


if __name__ == "__main__":
    main()
`;
  }

  /**
   * Check if the Cursor hooks are installed.
   * Only checks preToolUse - Cursor reads Claude's hook.py for counting.
   */
  isCursorHookInstalled(): boolean {
    const preToolPath = this.getCursorPreToolScriptPath();
    const cursorConfigPath = this.getCursorHooksConfigPath();

    if (!fs.existsSync(preToolPath) || !fs.existsSync(cursorConfigPath)) {
      return false;
    }

    try {
      const cursorConfig = JSON.parse(fs.readFileSync(cursorConfigPath, 'utf-8'));
      const preToolHooks = cursorConfig.hooks?.preToolUse;
      if (!Array.isArray(preToolHooks)) {
        return false;
      }
      const preToolCommand = `python3 ${preToolPath}`;
      return preToolHooks.some((h: { command?: string }) =>
        h.command === preToolCommand || h.command === `python3 "${preToolPath}"`
      );
    } catch {
      return false;
    }
  }

  /**
   * Install the Cursor hooks.
   * Installs both beforeSubmitPrompt (job creation) and preToolUse (deny pattern gate).
   */
  installCursorHook(): boolean {
    try {
      // 1. Shared setup: directories, rule file, config, watched dirs
      this.ensureCentralLibrarianSetup();

      // 2. Ensure ~/.cursor directory exists
      const cursorDir = path.dirname(this.getCursorHooksConfigPath());
      if (!fs.existsSync(cursorDir)) {
        fs.mkdirSync(cursorDir, { recursive: true });
      }

      // 3. Write preToolUse hook script (for artifact enforcement via deny pattern)
      // NOTE: We don't write a beforeSubmitPrompt hook - Cursor reads Claude's hook.py
      // from ~/.claude/settings.json for counting.
      const preToolPath = this.getCursorPreToolScriptPath();
      fs.writeFileSync(preToolPath, this.generateCursorPreToolScript(), { mode: 0o755 });

      // 4. Register hooks in Cursor's ~/.cursor/hooks.json
      const cursorConfigPath = this.getCursorHooksConfigPath();
      let cursorConfig: Record<string, unknown> = { version: 1, hooks: {} };

      if (fs.existsSync(cursorConfigPath)) {
        try {
          cursorConfig = JSON.parse(fs.readFileSync(cursorConfigPath, 'utf-8'));
        } catch {
          // Could not parse existing Cursor hooks.json, starting fresh
        }
      }

      // Ensure hooks object exists
      if (!cursorConfig.hooks || typeof cursorConfig.hooks !== 'object') {
        cursorConfig.hooks = {};
      }
      const hooks = cursorConfig.hooks as Record<string, unknown>;

      // NOTE: We do NOT register beforeSubmitPrompt hook for Cursor.
      // Cursor reads ~/.claude/settings.json hooks, so Claude Code's hook.py handles counting.
      // We only register preToolUse for artifact enforcement (deny pattern with exit code 2).

      // Register preToolUse hook
      if (!Array.isArray(hooks.preToolUse)) {
        hooks.preToolUse = [];
      }
      const preToolCommand = `python3 ${preToolPath}`;
      const preToolHooks = hooks.preToolUse as Array<{ type?: string; command?: string; timeout?: number }>;
      const preToolExists = preToolHooks.some(h => h.command === preToolCommand);
      if (!preToolExists) {
        preToolHooks.push({ type: 'command', command: preToolCommand, timeout: 5 });
      }

      // Write updated Cursor config
      fs.writeFileSync(cursorConfigPath, JSON.stringify(cursorConfig, null, 2));

      // 5. Add librarian paths to Cursor's permissions allow list
      const cursorCliConfigPath = path.join(os.homedir(), '.cursor', 'cli-config.json');
      try {
        let cliConfig: Record<string, unknown> = { version: 1, permissions: { allow: [], deny: [] } };

        if (fs.existsSync(cursorCliConfigPath)) {
          cliConfig = JSON.parse(fs.readFileSync(cursorCliConfigPath, 'utf-8'));
        }

        // Ensure permissions.allow exists
        if (!cliConfig.permissions) cliConfig.permissions = { allow: [], deny: [] };
        if (!Array.isArray((cliConfig.permissions as Record<string, unknown>).allow)) {
          (cliConfig.permissions as Record<string, unknown>).allow = [];
        }

        const allowList = (cliConfig.permissions as Record<string, unknown>).allow as string[];
        // Use tilde notation for portable paths that work for any user
        const librarianPatterns = [
          'Read(~/.fieldtheory/librarian/**)',
          'Write(~/.fieldtheory/librarian/**)',
        ];

        for (const pattern of librarianPatterns) {
          if (!allowList.includes(pattern)) {
            allowList.push(pattern);
          }
        }

        fs.writeFileSync(cursorCliConfigPath, JSON.stringify(cliConfig, null, 2));
      } catch {
        // Could not update Cursor cli-config.json
      }

      log.info('Installed Cursor hooks');
      return true;
    } catch (error) {
      log.error('Failed to install Cursor hooks:', error);
      return false;
    }
  }

  /**
   * Uninstall the Cursor hooks.
   */
  uninstallCursorHook(): boolean {
    try {
      const hookPath = this.getCursorHookScriptPath();
      const preToolPath = this.getCursorPreToolScriptPath();

      // Remove hook scripts
      if (fs.existsSync(hookPath)) {
        fs.unlinkSync(hookPath);
      }
      if (fs.existsSync(preToolPath)) {
        fs.unlinkSync(preToolPath);
      }

      // Remove from Cursor's hooks.json
      const cursorConfigPath = this.getCursorHooksConfigPath();
      if (fs.existsSync(cursorConfigPath)) {
        const cursorConfig = JSON.parse(fs.readFileSync(cursorConfigPath, 'utf-8'));

        // Remove beforeSubmitPrompt hook
        if (cursorConfig.hooks?.beforeSubmitPrompt) {
          cursorConfig.hooks.beforeSubmitPrompt = cursorConfig.hooks.beforeSubmitPrompt.filter(
            (h: { command?: string }) => !h.command?.includes('cursor-hook.py')
          );
          if (cursorConfig.hooks.beforeSubmitPrompt.length === 0) {
            delete cursorConfig.hooks.beforeSubmitPrompt;
          }
        }

        // Remove preToolUse hook
        if (cursorConfig.hooks?.preToolUse) {
          cursorConfig.hooks.preToolUse = cursorConfig.hooks.preToolUse.filter(
            (h: { command?: string }) => !h.command?.includes('cursor-pretool.py')
          );
          if (cursorConfig.hooks.preToolUse.length === 0) {
            delete cursorConfig.hooks.preToolUse;
          }
        }

        // Clean up empty hooks object
        if (cursorConfig.hooks && Object.keys(cursorConfig.hooks).length === 0) {
          delete cursorConfig.hooks;
        }

        fs.writeFileSync(cursorConfigPath, JSON.stringify(cursorConfig, null, 2));
      }

      // Remove librarian paths from Cursor's permissions allow list
      const cursorCliConfigPath = path.join(os.homedir(), '.cursor', 'cli-config.json');
      try {
        if (fs.existsSync(cursorCliConfigPath)) {
          const cliConfig = JSON.parse(fs.readFileSync(cursorCliConfigPath, 'utf-8'));

          if (cliConfig.permissions?.allow && Array.isArray(cliConfig.permissions.allow)) {
            // Use tilde notation to match what we added during install
            const librarianPatterns = [
              'Read(~/.fieldtheory/librarian/**)',
              'Write(~/.fieldtheory/librarian/**)',
            ];

            cliConfig.permissions.allow = cliConfig.permissions.allow.filter(
              (p: string) => !librarianPatterns.includes(p)
            );

            fs.writeFileSync(cursorCliConfigPath, JSON.stringify(cliConfig, null, 2));
          }
        }
      } catch {
        // Could not update Cursor cli-config.json
      }

      return true;
    } catch (error) {
      log.error('Failed to uninstall Cursor hooks:', error);
      return false;
    }
  }

  // ===========================================================================
  // Codex CLI Hook Management
  // ===========================================================================

  /**
   * Get the path to the Codex hooks config file.
   */
  private getCodexHooksConfigPath(): string {
    return path.join(os.homedir(), '.codex', 'hooks.json');
  }

  /**
   * Get the path to the Codex config file.
   */
  private getCodexConfigPath(): string {
    return path.join(os.homedir(), '.codex', 'config.toml');
  }

  /**
   * Get the path to the Codex AGENTS.md file.
   */
  private getCodexAgentsMdPath(): string {
    return path.join(os.homedir(), '.codex', 'AGENTS.md');
  }

  /**
   * Get the path to the Codex notify hook script.
   */
  private getCodexNotifyScriptPath(): string {
    return path.join(os.homedir(), '.fieldtheory', 'librarian', 'codex-notify.py');
  }

  /**
   * Get the path to the Codex session-start hook script.
   */
  private getCodexSessionStartScriptPath(): string {
    return path.join(os.homedir(), '.fieldtheory', 'librarian', 'codex-session-start.py');
  }

  /**
   * Get the path to the Codex stop hook script.
   */
  private getCodexStopScriptPath(): string {
    return path.join(os.homedir(), '.fieldtheory', 'librarian', 'codex-stop.py');
  }

  /**
   * Generate the Codex notify hook script (Python).
   * Receives AfterAgent payload as argv, increments shared state.json counter,
   * creates jobs at threshold, and writes a sentinel file for the Stop hook.
   */
  private generateCodexNotifyScript(): string {
    return `#!/usr/bin/env python3
"""
Field Theory Librarian Notify Hook for Codex CLI (AfterAgent)

Counts agent turns and creates job files when threshold is reached.
Writes a sentinel file so the Stop hook can enforce artifact creation
in the same session.

State is GLOBAL at ~/.fieldtheory/librarian/state.json
"""
import json
import os
import sys
import fcntl
from pathlib import Path
from datetime import datetime

DEFAULT_THRESHOLD = 7


def main():
    # Read config
    central_dir = Path.home() / ".fieldtheory" / "librarian"
    config_path = central_dir / "config.json"
    if not config_path.exists():
        return

    with open(config_path) as f:
        cfg = json.load(f)

    if not cfg.get("enabled", False):
        return

    # Paths
    jobs_dir = central_dir / "jobs"
    artifacts_dir = central_dir / "artifacts"
    rules_dir = central_dir / "rules"
    rule_file = rules_dir / "history_reading.md"
    state_file = central_dir / "state.json"
    lock_file = central_dir / ".lock"
    seq_file = central_dir / ".seq"
    sentinel_file = central_dir / ".codex-pending"

    # Check mute status
    if state_file.exists():
        try:
            import time
            state_data = json.loads(state_file.read_text())
            muted_until = state_data.get("mutedUntil", 0)
            if muted_until and time.time() * 1000 < muted_until:
                return
        except:
            pass

    # Ensure directories exist
    jobs_dir.mkdir(parents=True, exist_ok=True)
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    rules_dir.mkdir(parents=True, exist_ok=True)

    # Try to get project name from cwd
    project_root = Path(os.getcwd())
    project_name = project_root.name

    # File-locked state update
    with open(lock_file, "w") as lf:
        fcntl.flock(lf.fileno(), fcntl.LOCK_EX)

        # Read current state
        state = {"count": 0, "threshold": DEFAULT_THRESHOLD}
        if state_file.exists():
            try:
                state = json.loads(state_file.read_text())
            except:
                pass

        count = state.get("count", 0) + 1
        threshold = state.get("threshold", DEFAULT_THRESHOLD)
        triggered = count >= threshold

        # Single write: either incremented count, or reset to 0 if triggered
        state["count"] = 0 if triggered else count
        state_file.write_text(json.dumps(state, indent=2))

        if not triggered:
            return

        # Threshold reached - create artifact job
        seq = 0
        if seq_file.exists():
            try:
                seq = int(seq_file.read_text().strip())
            except:
                seq = 0
        seq += 1
        seq_file.write_text(str(seq))

        timestamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
        job_file = jobs_dir / f"job_{seq}.json"
        out_file = artifacts_dir / f"{project_name}-{timestamp}-artifact.md"

        # Single pending job rule: abandon any existing pending jobs
        for old_job_file in sorted(jobs_dir.glob("job_*.json")):
            if old_job_file == job_file:
                continue
            try:
                old_job = json.loads(old_job_file.read_text())
                if old_job.get("status") == "pending":
                    old_job["status"] = "abandoned"
                    old_job["abandoned_at"] = datetime.now().isoformat()
                    old_job_file.write_text(json.dumps(old_job, indent=2) + "\\n")
            except:
                continue

        # Create job file
        if not job_file.exists():
            job_file.write_text(json.dumps({
                "schema_version": 1,
                "id": seq,
                "type": "history_artifact",
                "status": "pending",
                "project": project_name,
                "project_path": str(project_root),
                "output": str(out_file),
                "rule_file": str(rule_file),
                "created_at": datetime.now().isoformat()
            }, indent=2) + "\\n")

        # Write sentinel file so Stop hook can block in same session
        sentinel_file.write_text(json.dumps({
            "job_file": str(job_file),
            "output": str(out_file),
            "created_at": datetime.now().isoformat()
        }, indent=2))


if __name__ == "__main__":
    main()
`;
  }

  /**
   * Generate the Codex session-start hook script (Python).
   * Checks for pending jobs from prior sessions and injects artifact
   * instructions via additionalContext.
   */
  private generateCodexSessionStartScript(): string {
    return `#!/usr/bin/env python3
"""
Field Theory Librarian SessionStart Hook for Codex CLI

Checks for pending artifact jobs (from prior sessions or cross-tool).
If found, outputs additionalContext so the model creates the artifact.
"""
import json
import sys
from pathlib import Path

LIBRARIAN_DIR = Path.home() / ".fieldtheory" / "librarian"
CONFIG_PATH = LIBRARIAN_DIR / "config.json"


def main():
    # Check if enabled
    if not CONFIG_PATH.exists():
        return
    try:
        cfg = json.loads(CONFIG_PATH.read_text())
        if not cfg.get("enabled", False):
            return
    except:
        return

    # Check mute status
    state_file = LIBRARIAN_DIR / "state.json"
    if state_file.exists():
        try:
            import time
            state_data = json.loads(state_file.read_text())
            muted_until = state_data.get("mutedUntil", 0)
            if muted_until and time.time() * 1000 < muted_until:
                return
        except:
            pass

    # Find pending jobs
    jobs_dir = LIBRARIAN_DIR / "jobs"
    if not jobs_dir.exists():
        return

    pending_job = None
    for job_file in sorted(jobs_dir.glob("job_*.json"), reverse=True):
        try:
            job = json.loads(job_file.read_text())
            if job.get("status") == "pending":
                pending_job = (job_file, job)
                break
        except:
            continue

    if not pending_job:
        return

    job_file, job = pending_job

    # Read rule_content from config
    rule_content = "Write a short reflective story (120-200 words) connecting current work to science/history."
    try:
        rule_content = cfg.get("rule_content", rule_content)
    except:
        pass

    context = f"""[STATE-ENFORCED] Before responding to the user, you must complete this Librarian artifact job.

Job file: {job_file}
Output path: {job.get('output')}

Rule: {rule_content}

Steps:
1. Write the artifact to the output path following the rule above
2. Update the job file, setting "status" to "done"
3. Then proceed with the user's request"""

    # Output additionalContext for Codex to inject into session
    print(json.dumps({
        "additionalContext": context
    }))


if __name__ == "__main__":
    main()
`;
  }

  /**
   * Generate the Codex stop hook script (Python).
   * Blocks agent completion when a sentinel file exists (job was just created
   * in this session). Returns blocking instructions as the reason.
   * Once the artifact is written and job marked done, allows completion.
   */
  private generateCodexStopScript(): string {
    return `#!/usr/bin/env python3
"""
Field Theory Librarian Stop Hook for Codex CLI

Blocks agent from completing when a Librarian artifact job was just
created in this session (sentinel file exists). The model must write
the artifact and mark the job done before proceeding.
"""
import json
import sys
from pathlib import Path

LIBRARIAN_DIR = Path.home() / ".fieldtheory" / "librarian"
CONFIG_PATH = LIBRARIAN_DIR / "config.json"
SENTINEL_FILE = LIBRARIAN_DIR / ".codex-pending"


def main():
    # Check if enabled
    if not CONFIG_PATH.exists():
        return
    try:
        cfg = json.loads(CONFIG_PATH.read_text())
        if not cfg.get("enabled", False):
            return
    except:
        return

    # No sentinel = no pending job from this session
    if not SENTINEL_FILE.exists():
        return

    # Read sentinel
    try:
        sentinel = json.loads(SENTINEL_FILE.read_text())
    except:
        # Corrupt sentinel, clean up
        SENTINEL_FILE.unlink(missing_ok=True)
        return

    job_file = Path(sentinel.get("job_file", ""))
    output_path = sentinel.get("output", "")

    # Check if the job is still pending
    if not job_file.exists():
        SENTINEL_FILE.unlink(missing_ok=True)
        return

    try:
        job = json.loads(job_file.read_text())
    except:
        SENTINEL_FILE.unlink(missing_ok=True)
        return

    if job.get("status") != "pending":
        # Job completed - clean up sentinel and allow
        SENTINEL_FILE.unlink(missing_ok=True)
        return

    # Read rule_content from config
    rule_content = "Write a short reflective story (120-200 words) connecting current work to science/history."
    try:
        rule_content = cfg.get("rule_content", rule_content)
    except:
        pass

    # Job still pending - block with instructions
    reason = f"""[LIBRARIAN] A Librarian artifact must be written before completing.

Job file: {job_file}
Output path: {output_path}

Rule: {rule_content}

Steps:
1. Write the artifact to the output path following the rule above
2. Update the job file, setting "status" to "done"
3. Then you may complete"""

    # Exit code 1 signals Codex to block completion
    print(reason, file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
`;
  }

  /**
   * Check if Codex CLI appears to be installed.
   */
  getCodexStatus(): 'installed' | 'not-installed' {
    const codexDir = path.join(os.homedir(), '.codex');
    return fs.existsSync(codexDir) ? 'installed' : 'not-installed';
  }

  /**
   * Check if the Codex hooks are installed.
   * Checks that all 3 hook scripts exist and hooks.json has our entries.
   */
  isCodexHookInstalled(): boolean {
    const notifyPath = this.getCodexNotifyScriptPath();
    const sessionStartPath = this.getCodexSessionStartScriptPath();
    const stopPath = this.getCodexStopScriptPath();
    const hooksConfigPath = this.getCodexHooksConfigPath();

    // Check that at least the main scripts exist
    if (!fs.existsSync(notifyPath) || !fs.existsSync(stopPath)) {
      return false;
    }

    // Check hooks.json has our Stop entry (most critical hook)
    if (!fs.existsSync(hooksConfigPath)) {
      return false;
    }

    try {
      const config = JSON.parse(fs.readFileSync(hooksConfigPath, 'utf-8'));
      const stopHooks = config.hooks?.Stop;
      if (!Array.isArray(stopHooks)) {
        return false;
      }
      // Check for our stop hook in the nested structure
      return stopHooks.some((entry: { hooks?: Array<{ command?: string }> }) =>
        entry.hooks?.some(h => h.command?.includes('codex-stop.py'))
      );
    } catch {
      return false;
    }
  }

  /**
   * Install all Codex hooks.
   * 1. Ensure directories exist
   * 2. Write 3 Python scripts
   * 3. Merge hooks into ~/.codex/hooks.json
   * 4. Add notify line to ~/.codex/config.toml
   * 5. Add writable_roots for librarian dir to config.toml
   * 6. Append Librarian section to ~/.codex/AGENTS.md
   * 7. Add global artifacts dir to watched dirs
   */
  installCodexHook(): boolean {
    try {
      // 1. Shared setup: directories, rule file, config, watched dirs
      this.ensureCentralLibrarianSetup();

      // 2. Ensure ~/.codex directory exists
      const codexDir = path.join(os.homedir(), '.codex');
      if (!fs.existsSync(codexDir)) {
        fs.mkdirSync(codexDir, { recursive: true });
      }

      // 3. Write 3 Python hook scripts
      const notifyPath = this.getCodexNotifyScriptPath();
      const sessionStartPath = this.getCodexSessionStartScriptPath();
      const stopPath = this.getCodexStopScriptPath();

      fs.writeFileSync(notifyPath, this.generateCodexNotifyScript(), { mode: 0o755 });
      fs.writeFileSync(sessionStartPath, this.generateCodexSessionStartScript(), { mode: 0o755 });
      fs.writeFileSync(stopPath, this.generateCodexStopScript(), { mode: 0o755 });

      // 4. Register hooks in ~/.codex/hooks.json
      const hooksConfigPath = this.getCodexHooksConfigPath();
      let hooksConfig: Record<string, unknown> = { hooks: {} };

      if (fs.existsSync(hooksConfigPath)) {
        try {
          hooksConfig = JSON.parse(fs.readFileSync(hooksConfigPath, 'utf-8'));
        } catch {
          // Start fresh if unparseable
        }
      }

      if (!hooksConfig.hooks || typeof hooksConfig.hooks !== 'object') {
        hooksConfig.hooks = {};
      }
      const hooks = hooksConfig.hooks as Record<string, unknown>;

      // Register SessionStart hook
      if (!Array.isArray(hooks.SessionStart)) {
        hooks.SessionStart = [];
      }
      const sessionStartHooks = hooks.SessionStart as Array<{ hooks?: Array<{ type?: string; command?: string; timeout_sec?: number }> }>;
      const sessionStartCommand = `python3 ${sessionStartPath}`;
      const hasSessionStart = sessionStartHooks.some(entry =>
        entry.hooks?.some(h => h.command?.includes('codex-session-start.py'))
      );
      if (!hasSessionStart) {
        sessionStartHooks.push({
          hooks: [{ type: 'command', command: sessionStartCommand, timeout_sec: 10 }]
        });
      }

      // Register Stop hook
      if (!Array.isArray(hooks.Stop)) {
        hooks.Stop = [];
      }
      const stopHooks = hooks.Stop as Array<{ hooks?: Array<{ type?: string; command?: string; timeout_sec?: number }> }>;
      const stopCommand = `python3 ${stopPath}`;
      const hasStop = stopHooks.some(entry =>
        entry.hooks?.some(h => h.command?.includes('codex-stop.py'))
      );
      if (!hasStop) {
        stopHooks.push({
          hooks: [{ type: 'command', command: stopCommand, timeout_sec: 10 }]
        });
      }

      fs.writeFileSync(hooksConfigPath, JSON.stringify(hooksConfig, null, 2));

      // 6. Add notify line and writable_roots to ~/.codex/config.toml
      const configTomlPath = this.getCodexConfigPath();
      let tomlContent = '';
      if (fs.existsSync(configTomlPath)) {
        tomlContent = fs.readFileSync(configTomlPath, 'utf-8');
      }

      const notifyCommand = `python3 ${notifyPath}`;
      const librarianDir = path.join(os.homedir(), '.fieldtheory', 'librarian');
      tomlContent = tomlSetNotify(tomlContent, notifyCommand);
      tomlContent = tomlAddWritableRoot(tomlContent, librarianDir);
      fs.writeFileSync(configTomlPath, tomlContent);

      // 7. Append Librarian section to ~/.codex/AGENTS.md (if not present)
      const agentsMdPath = this.getCodexAgentsMdPath();
      let agentsMd = '';
      if (fs.existsSync(agentsMdPath)) {
        agentsMd = fs.readFileSync(agentsMdPath, 'utf-8');
      }

      const librarianSection = `
<!-- Field Theory Librarian - managed section, do not edit -->
## Field Theory Librarian
When you receive instructions prefixed with [STATE-ENFORCED] or [LIBRARIAN],
follow them before proceeding. These create short reflective artifacts.
Artifacts go in ~/.fieldtheory/librarian/artifacts/.
After writing, update the job file in ~/.fieldtheory/librarian/jobs/ setting "status" to "done".
<!-- End Field Theory Librarian -->
`;
      agentsMd = managedSectionUpsert(agentsMd, 'Field Theory Librarian - managed section', librarianSection);
      fs.writeFileSync(agentsMdPath, agentsMd);

      log.info('Installed Codex hooks');
      return true;
    } catch (error) {
      log.error('Failed to install Codex hooks:', error);
      return false;
    }
  }

  /**
   * Uninstall all Codex hooks.
   */
  uninstallCodexHook(): boolean {
    try {
      // Remove hook scripts
      const scripts = [
        this.getCodexNotifyScriptPath(),
        this.getCodexSessionStartScriptPath(),
        this.getCodexStopScriptPath(),
      ];
      for (const scriptPath of scripts) {
        if (fs.existsSync(scriptPath)) {
          fs.unlinkSync(scriptPath);
        }
      }

      // Remove sentinel file
      const sentinelFile = path.join(os.homedir(), '.fieldtheory', 'librarian', '.codex-pending');
      if (fs.existsSync(sentinelFile)) {
        fs.unlinkSync(sentinelFile);
      }

      // Remove from ~/.codex/hooks.json
      const hooksConfigPath = this.getCodexHooksConfigPath();
      if (fs.existsSync(hooksConfigPath)) {
        try {
          const config = JSON.parse(fs.readFileSync(hooksConfigPath, 'utf-8'));

          // Remove SessionStart entries
          if (Array.isArray(config.hooks?.SessionStart)) {
            config.hooks.SessionStart = config.hooks.SessionStart.filter(
              (entry: { hooks?: Array<{ command?: string }> }) =>
                !entry.hooks?.some(h => h.command?.includes('codex-session-start.py'))
            );
            if (config.hooks.SessionStart.length === 0) {
              delete config.hooks.SessionStart;
            }
          }

          // Remove Stop entries
          if (Array.isArray(config.hooks?.Stop)) {
            config.hooks.Stop = config.hooks.Stop.filter(
              (entry: { hooks?: Array<{ command?: string }> }) =>
                !entry.hooks?.some(h => h.command?.includes('codex-stop.py'))
            );
            if (config.hooks.Stop.length === 0) {
              delete config.hooks.Stop;
            }
          }

          // Clean up empty hooks object
          if (config.hooks && Object.keys(config.hooks).length === 0) {
            delete config.hooks;
          }

          fs.writeFileSync(hooksConfigPath, JSON.stringify(config, null, 2));
        } catch {
          // Could not update hooks.json
        }
      }

      // Remove notify line and writable_roots from ~/.codex/config.toml
      const configTomlPath = this.getCodexConfigPath();
      if (fs.existsSync(configTomlPath)) {
        try {
          let tomlContent = fs.readFileSync(configTomlPath, 'utf-8');
          const librarianDir = path.join(os.homedir(), '.fieldtheory', 'librarian');
          tomlContent = tomlRemoveNotify(tomlContent, 'codex-notify.py');
          tomlContent = tomlRemoveWritableRoot(tomlContent, librarianDir);
          fs.writeFileSync(configTomlPath, tomlContent);
        } catch {
          // Could not update config.toml
        }
      }

      // Remove managed section from ~/.codex/AGENTS.md
      const agentsMdPath = this.getCodexAgentsMdPath();
      if (fs.existsSync(agentsMdPath)) {
        try {
          let agentsMd = fs.readFileSync(agentsMdPath, 'utf-8');
          agentsMd = managedSectionRemove(
            agentsMd,
            '<!-- Field Theory Librarian - managed section, do not edit -->',
            '<!-- End Field Theory Librarian -->'
          );
          fs.writeFileSync(agentsMdPath, agentsMd);
        } catch {
          // Could not update AGENTS.md
        }
      }

      log.info('Uninstalled Codex hooks');
      return true;
    } catch (error) {
      log.error('Failed to uninstall Codex hooks:', error);
      return false;
    }
  }
}
