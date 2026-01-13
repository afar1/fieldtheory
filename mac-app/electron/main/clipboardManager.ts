import { app, clipboard, globalShortcut, nativeImage, systemPreferences } from 'electron';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { exec, spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';
import { EventEmitter } from 'events';

const execAsync = promisify(exec);

/**
 * Terminal/CLI bundle IDs that don't support image pasting.
 * For these apps, we need to paste file paths instead of image buffers.
 * Note: VS Code/Cursor removed - their integrated terminals can render images inline.
 */
const TERMINAL_BUNDLE_IDS = new Set([
  'com.apple.Terminal',
  'com.googlecode.iterm2',
  'dev.warp.Warp-Stable',
  'co.zeit.hyper',
  'com.github.wez.wezterm',
  'io.alacritty',
  'org.vim.MacVim',
  'com.mitchellh.ghostty',
  'net.kovidgoyal.kitty',
  'org.tabby',
]);

/**
 * Check if a bundle ID belongs to a terminal/CLI application.
 */
export function isTerminalApp(bundleId: string | null): boolean {
  if (!bundleId) return false;
  return TERMINAL_BUNDLE_IDS.has(bundleId);
}

/**
 * Replace home directory and app storage path with branded path for privacy.
 * Converts: /Users/username/Library/Application Support/littleai-mac/figures/image.png
 * To: ~/field-theory/image.png
 */
export function obscureHomePath(filePath: string): string {
  const appDataDir = app.getPath('userData');

  // First, try to strip the app data directory and add field-theory branding
  if (filePath.startsWith(appDataDir)) {
    const relativePath = filePath.replace(appDataDir, '').replace(/^\//, '');
    // Remove "figures/" prefix and add "~/field-theory/" instead for a technical path look
    const filename = relativePath.replace(/^figures\//, '');
    return `~/field-theory/${filename}`;
  }

  // Fallback: replace home directory with tilde
  const homeDir = app.getPath('home');
  if (filePath.startsWith(homeDir)) {
    return filePath.replace(homeDir, '~');
  }

  return filePath;
}

/**
 * Resolve branded Field Theory paths back to real filesystem paths.
 * Converts: ~/field-theory/image.png
 * To: /Users/username/Library/Application Support/littleai-mac/figures/image.png
 */
export function resolveFieldTheoryPath(brandedPath: string): string {
  // Handle ~/field-theory/ branded paths
  if (brandedPath.startsWith('~/field-theory/')) {
    const filename = brandedPath.replace('~/field-theory/', '');
    const appDataDir = app.getPath('userData');
    return path.join(appDataDir, 'figures', filename);
  }

  // Handle regular ~ home paths
  if (brandedPath.startsWith('~/')) {
    const homeDir = app.getPath('home');
    return brandedPath.replace('~', homeDir);
  }

  // Already a full path
  return brandedPath;
}

/**
 * Type of clipboard item.
 */
export type ClipboardItemType = 'text' | 'image' | 'transcript' | 'screenshot';

/**
 * Source device for clipboard items.
 * Used to distinguish between items created on Mac vs synced from iOS.
 */
export type ClipboardSource = 'mac' | 'ios';

/**
 * Clipboard item stored in database.
 */
export interface ClipboardItem {
  id: number;
  type: ClipboardItemType;
  content: string | null;
  improvedContent: string | null; // Improved version from Engineer feature
  useImprovedVersion: boolean; // Toggle between improved and original text
  imageData: Buffer | null;
  thumbnailData: Buffer | null; // Small preview image (~10KB) for list view
  imageWidth: number | null;
  imageHeight: number | null;
  imageSize: number | null;
  sourceApp: string | null;
  sourceAppName: string | null;
  wordCount: number | null;
  charCount: number | null;
  createdAt: number;
  contentHash: string;
  stackId: string | null; // Groups items into a prompt stack for batch paste
  source: ClipboardSource; // Device source: 'mac' for local, 'ios' for mobile synced
  figureLabel: string | null; // Figure label for screenshots in stacks (e.g., "A", "B", "C")
  figureId: string | null; // Unique 5-char alphanumeric ID for searchability (e.g., "k7xm2")
  needsLazyLoad?: boolean;
}

/**
 * Summary info for a stack of items.
 */
export interface StackInfo {
  stackId: string;
  itemCount: number;
  imageCount: number;
  textCount: number;
  createdAt: number;
  firstTextPreview: string | null;
}

/**
 * Options for querying clipboard history.
 */
export interface ClipboardQueryOptions {
  type?: ClipboardItemType;
  search?: string;
  limit?: number;
  offset?: number;
  source?: ClipboardSource; // Filter by device source: 'mac', 'ios', or undefined for all
}

/**
 * Configuration for clipboard manager.
 */
interface ClipboardConfig {
  retentionDays?: number;
  maxItems?: number;
  ignoreApps?: string[]; // Bundle IDs to ignore
  screenshotHotkey?: string;
  fullScreenHotkey?: string;
  activeWindowHotkey?: string;
  historyHotkey?: string;
}

/**
 * Callback type for screenshot hotkey.
 */
type ScreenshotCallback = () => void | Promise<void>;

/**
 * Callback type for history hotkey.
 */
type HistoryCallback = () => void;

const DEFAULT_CONFIG: ClipboardConfig = {
  retentionDays: 30,
  maxItems: 1000,
  ignoreApps: [
    'com.1password.1password',
    'com.agilebits.onepassword',
    'com.lastpass.LastPass',
    'com.dashlane.dashlanephonefinal',
  ],
  screenshotHotkey: 'Command+4',
  fullScreenHotkey: 'Command+3',
  activeWindowHotkey: 'Command+Shift+3',
  historyHotkey: 'Alt+Space',
};

/**
 * Continuous Context mode state.
 * Allows continuous screenshotting where each screenshot re-activates the capture tool.
 */
export interface ContinuousContextState {
  active: boolean;
  stackId: string | null;
  screenshotCount: number;
}

/**
 * Events emitted by ClipboardManager.
 */
export interface ClipboardManagerEvents {
  continuousContextChanged: (state: ContinuousContextState) => void;
  continuousContextScreenshot: (itemId: number) => void;
}

/**
 * Manages clipboard history with SQLite storage.
 * Polls clipboard every 500ms and stores changes locally.
 * Also manages Continuous Context mode for multi-screenshot capture sessions.
 */
export class ClipboardManager extends EventEmitter {
  private db: Database.Database;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastContentHash: string = '';
  private config: ClipboardConfig;
  private screenshotHotkeyRegistered: boolean = false;
  private fullScreenHotkeyRegistered: boolean = false;
  private activeWindowHotkeyRegistered: boolean = false;
  private historyHotkeyRegistered: boolean = false;
  private screenshotCallback: ScreenshotCallback | null = null;
  private fullScreenCallback: ScreenshotCallback | null = null;
  private activeWindowCallback: ScreenshotCallback | null = null;
  private historyCallback: HistoryCallback | null = null;
  private onItemAddedCallback: ((id: number) => void) | null = null;
  
  // Continuous Context mode state
  private continuousContextActive: boolean = false;
  private continuousContextStackId: string | null = null;
  private continuousContextScreenshotCount: number = 0;
  private continuousContextHotkeyRegistered: boolean = false;
  private continuousContextHotkey: string = 'Shift+Command+4';
  private continuousContextEnabled: boolean = false;
  private continuousContextCallback: (() => void) | null = null;
  private screencaptureProcess: ChildProcess | null = null;
  private continuousContextEscapeRegistered: boolean = false;
  private continuousContextPausedForCommand: boolean = false;
  
  // Screenshot capture lock to prevent race condition with clipboard polling.
  // When true, checkClipboard() skips to avoid storing duplicate screenshot.
  private screenshotInProgress: boolean = false;

  constructor(config: Partial<ClipboardConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    // Initialize database
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'clipboard.db');
    this.db = new Database(dbPath);
    
    this.initDatabase();
    this.startPolling();
  }

  /**
   * Load hotkeys from preferences and update config.
   */
  loadHotkeysFromPreferences(screenshotHotkey?: string, historyHotkey?: string, fullScreenHotkey?: string, activeWindowHotkey?: string): void {
    if (screenshotHotkey) {
      this.config.screenshotHotkey = screenshotHotkey;
    }
    if (historyHotkey) {
      this.config.historyHotkey = historyHotkey;
    }
    if (fullScreenHotkey) {
      this.config.fullScreenHotkey = fullScreenHotkey;
    }
    if (activeWindowHotkey) {
      this.config.activeWindowHotkey = activeWindowHotkey;
    }
  }

  /**
   * Set callback to be invoked when a new item is added via clipboard polling.
   */
  setOnItemAdded(callback: (id: number) => void): void {
    this.onItemAddedCallback = callback;
  }

  /**
   * Initialize database schema with FTS5 for full-text search.
   */
  private initDatabase(): void {
    // Create main table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS clipboard_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        content TEXT,
        image_data BLOB,
        image_width INTEGER,
        image_height INTEGER,
        image_size INTEGER,
        source_app TEXT,
        source_app_name TEXT,
        word_count INTEGER,
        char_count INTEGER,
        created_at INTEGER NOT NULL,
        content_hash TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_created_at ON clipboard_items(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_type ON clipboard_items(type);
      CREATE INDEX IF NOT EXISTS idx_content_hash ON clipboard_items(content_hash);
      CREATE INDEX IF NOT EXISTS idx_source_app_name ON clipboard_items(source_app_name);
      CREATE INDEX IF NOT EXISTS idx_source_app ON clipboard_items(source_app);

      CREATE VIRTUAL TABLE IF NOT EXISTS clipboard_fts USING fts5(
        content,
        content='clipboard_items',
        content_rowid='id'
      );
    `);

    // Migration: Add stack_id column for prompt stacking feature.
    // SQLite gracefully handles ALTER TABLE on existing tables (NULL for existing rows).
    this.runMigration('add_stack_id', () => {
      this.db.exec(`
        ALTER TABLE clipboard_items ADD COLUMN stack_id TEXT;
        CREATE INDEX IF NOT EXISTS idx_stack_id ON clipboard_items(stack_id);
      `);
    });

    // Migration: Add source column to distinguish Mac vs iOS items.
    // Existing items default to 'mac' since they were created locally.
    this.runMigration('add_source', () => {
      this.db.exec(`
        ALTER TABLE clipboard_items ADD COLUMN source TEXT DEFAULT 'mac';
        CREATE INDEX IF NOT EXISTS idx_source ON clipboard_items(source);
      `);
    });

    // Migration: Add improved_content column for storing improved prompts.
    // When the Engineer feature improves a transcription, the result is stored here
    // while the original content is preserved in the 'content' column.
    this.runMigration('add_improved_content', () => {
      this.db.exec(`
        ALTER TABLE clipboard_items ADD COLUMN improved_content TEXT;
      `);
    });

    // Migration: Add use_improved_version column for toggling between improved and original text.
    // Defaults to 1 (true) so improved content is used by default when available.
    this.runMigration('add_use_improved_version', () => {
      this.db.exec(`
        ALTER TABLE clipboard_items ADD COLUMN use_improved_version INTEGER DEFAULT 1;
      `);
    });

    // Migration: Add cumulative_stats table for tracking all-time stats that shouldn't decrease.
    // Words transcribed is stored here so it persists even when transcriptions are deleted.
    this.runMigration('add_cumulative_stats', () => {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS cumulative_stats (
          key TEXT PRIMARY KEY,
          value INTEGER NOT NULL DEFAULT 0
        );
        -- Initialize with current word count from existing transcriptions.
        INSERT OR IGNORE INTO cumulative_stats (key, value)
        SELECT 'words_transcribed', COALESCE(SUM(word_count), 0)
        FROM clipboard_items
        WHERE type = 'transcript' AND word_count IS NOT NULL;
      `);
    });

    // Migration: Add cumulative counters for screenshots, transcriptions, and stacks.
    // These persist even when items are deleted, so "all time" stats never decrease.
    this.runMigration('add_cumulative_screenshot_transcription_stats', () => {
      this.db.exec(`
        -- Initialize from current counts so existing users don't start at 0.
        INSERT OR IGNORE INTO cumulative_stats (key, value)
        SELECT 'screenshots_taken', COUNT(*) FROM clipboard_items WHERE type = 'screenshot';
        
        INSERT OR IGNORE INTO cumulative_stats (key, value)
        SELECT 'transcriptions_made', COUNT(*) FROM clipboard_items WHERE type = 'transcript';
        
        INSERT OR IGNORE INTO cumulative_stats (key, value)
        SELECT 'stacks_created', COUNT(DISTINCT stack_id) FROM clipboard_items WHERE stack_id IS NOT NULL;
      `);
    });

    // Migration: Add figure_label column for labeling screenshots in stacks.
    // When screenshots are taken during recording, they get labels like "A", "B", "C"
    // which can be referenced in the transcript text.
    this.runMigration('add_figure_label', () => {
      this.db.exec(`
        ALTER TABLE clipboard_items ADD COLUMN figure_label TEXT;
      `);
    });

    // Migration: Add figure_id column for unique figure identification.
    // This is a 5-char alphanumeric ID (e.g., "k7xm2") that makes figures searchable
    // across all recordings, even when multiple figures share the same label (A, B, C).
    this.runMigration('add_figure_id', () => {
      this.db.exec(`
        ALTER TABLE clipboard_items ADD COLUMN figure_id TEXT;
      `);
    });

    // Migration: Add thumbnail_data column for small preview images.
    this.runMigration('add_thumbnail_data', () => {
      this.db.exec(`
        ALTER TABLE clipboard_items ADD COLUMN thumbnail_data BLOB;
      `);
    });

    // Trigger to keep FTS index in sync
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS clipboard_items_ai AFTER INSERT ON clipboard_items BEGIN
        INSERT INTO clipboard_fts(rowid, content) VALUES (new.id, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS clipboard_items_ad AFTER DELETE ON clipboard_items BEGIN
        DELETE FROM clipboard_fts WHERE rowid = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS clipboard_items_au AFTER UPDATE ON clipboard_items BEGIN
        DELETE FROM clipboard_fts WHERE rowid = old.id;
        INSERT INTO clipboard_fts(rowid, content) VALUES (new.id, new.content);
      END;
    `);

    console.log('[ClipboardManager] Database initialized');
  }

  /**
   * Run a migration if it hasn't been run yet.
   * Uses a simple migrations table to track which migrations have been applied.
   */
  private runMigration(name: string, migration: () => void): void {
    // Create migrations table if it doesn't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        name TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);

    // Check if migration already applied
    const existing = this.db
      .prepare('SELECT name FROM migrations WHERE name = ?')
      .get(name);

    if (existing) {
      return; // Already applied
    }

    try {
      migration();
      this.db
        .prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)')
        .run(name, Date.now());
      console.log(`[ClipboardManager] Migration applied: ${name}`);
    } catch (error) {
      // If migration fails (e.g., column already exists), log and continue
      console.warn(`[ClipboardManager] Migration ${name} may have already been applied:`, error);
      // Still mark as applied to avoid retrying
      this.db
        .prepare('INSERT OR IGNORE INTO migrations (name, applied_at) VALUES (?, ?)')
        .run(name, Date.now());
    }
  }

  /**
   * Start polling clipboard for changes.
   */
  private startPolling(): void {
    if (this.pollInterval) {
      return;
    }

    this.pollInterval = setInterval(() => {
      this.checkClipboard();
    }, 500);

    console.log('[ClipboardManager] Started polling clipboard');
  }

  /**
   * Stop polling clipboard.
   */
  private stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      console.log('[ClipboardManager] Stopped polling clipboard');
    }
  }

  /**
   * Check clipboard for changes and store if new.
   */
  private async checkClipboard(): Promise<void> {
    // Skip if a screenshot capture is in progress to avoid race condition.
    // The screenshot method will update lastContentHash and store the image itself.
    if (this.screenshotInProgress) {
      return;
    }
    
    try {
      // Check for text first
      const text = clipboard.readText();
      if (text) {
        const hash = this.hashContent(text);
        if (hash !== this.lastContentHash) {
          this.lastContentHash = hash;
          const existing = this.db
            .prepare('SELECT id FROM clipboard_items WHERE content_hash = ?')
            .get(hash) as { id: number } | undefined;
          
          if (!existing) {
            await this.storeText(text);
          }
        }
        return;
      }

      // Check for image
      const image = clipboard.readImage();
      if (!image.isEmpty()) {
        const imageBuffer = image.toPNG();
        const hash = this.hashContent(imageBuffer.toString('base64'));
        if (hash !== this.lastContentHash) {
          this.lastContentHash = hash;
          const existing = this.db
            .prepare('SELECT id FROM clipboard_items WHERE content_hash = ?')
            .get(hash) as { id: number } | undefined;
          
          if (!existing) {
            await this.storeImage(image, imageBuffer);
          }
        }
      }
    } catch (error) {
      // Silently handle errors (clipboard might be locked)
      console.debug('[ClipboardManager] Error checking clipboard:', error);
    }
  }

  /**
   * Store text content in clipboard history.
   * @param text - The text content to store
   * @param type - Item type (text, transcript, etc.)
   * @param sourceApp - Optional source app bundle ID
   * @param stackId - Optional stack ID to group items for prompt stacking
   * @param source - Device source: 'mac' for local, 'ios' for mobile synced (defaults to 'mac')
   * @param createdAtOverride - Optional timestamp override (for synced items to preserve original creation time)
   */
  async storeText(
    text: string,
    type: ClipboardItemType = 'text',
    sourceApp?: string,
    stackId?: string,
    source: ClipboardSource = 'mac',
    createdAtOverride?: number
  ): Promise<number> {
    const hash = this.hashContent(text);
    
    // Check if already exists (unless it's part of a stack - stacks can have duplicates)
    if (!stackId) {
      const existing = this.db
        .prepare('SELECT id, source FROM clipboard_items WHERE content_hash = ?')
        .get(hash) as { id: number; source: string } | undefined;
      
      if (existing) {
        // If we're syncing from iOS and the existing record is marked as 'mac',
        // update it to 'ios' since iOS is the true origin. This handles the case
        // where text was copied to Mac clipboard before MobileSync ran.
        if (source === 'ios' && existing.source === 'mac') {
          this.db.prepare('UPDATE clipboard_items SET source = ? WHERE id = ?')
            .run('ios', existing.id);
        }
        return existing.id;
      }
    }

    // Get source app info if not provided and source is 'mac'
    // (iOS items don't have source app info)
    if (!sourceApp && source === 'mac') {
      sourceApp = (await this.getFrontmostApp()) || undefined;
    }

    const sourceAppName = sourceApp ? await this.getAppName(sourceApp) : null;

    // Check ignore list (only for Mac items)
    if (source === 'mac' && sourceApp && this.config.ignoreApps?.includes(sourceApp)) {
      return -1; // Ignored
    }

    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
    const charCount = text.length;
    const createdAt = createdAtOverride ?? Date.now();

    // Check if this item will create a new stack (stackId provided but doesn't exist yet).
    let isNewStack = false;
    if (stackId) {
      const existingStack = this.db
        .prepare('SELECT 1 FROM clipboard_items WHERE stack_id = ? LIMIT 1')
        .get(stackId);
      isNewStack = !existingStack;
    }

    const stmt = this.db.prepare(`
      INSERT INTO clipboard_items (
        type, content, source_app, source_app_name,
        word_count, char_count, created_at, content_hash, stack_id, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      type,
      text,
      sourceApp || null,
      sourceAppName,
      wordCount,
      charCount,
      createdAt,
      hash,
      stackId || null,
      source
    );

    // If this is a transcript, increment cumulative counters.
    // These ensure stats never decrease even if items are deleted.
    if (type === 'transcript') {
      // Increment words transcribed.
      if (wordCount > 0) {
        this.db.prepare(`
          INSERT INTO cumulative_stats (key, value) VALUES ('words_transcribed', ?)
          ON CONFLICT(key) DO UPDATE SET value = value + ?
        `).run(wordCount, wordCount);
      }
      // Increment transcriptions count.
      this.db.prepare(`
        INSERT INTO cumulative_stats (key, value) VALUES ('transcriptions_made', 1)
        ON CONFLICT(key) DO UPDATE SET value = value + 1
      `).run();
    }

    // If this item started a new stack, increment the stacks counter.
    if (isNewStack) {
      this.db.prepare(`
        INSERT INTO cumulative_stats (key, value) VALUES ('stacks_created', 1)
        ON CONFLICT(key) DO UPDATE SET value = value + 1
      `).run();
    }

    // Cleanup old items
    this.cleanupOldItems();

    const id = result.lastInsertRowid as number;
    
    // Notify listeners of new item (so UI can refresh immediately)
    if (id > 0 && this.onItemAddedCallback) {
      this.onItemAddedCallback(id);
    }
    
    return id;
  }

  /**
   * Store image in clipboard history.
   * @param image - The NativeImage to store
   * @param imageBuffer - PNG buffer of the image
   * @param type - Item type (image, screenshot, etc.)
   * @param sourceApp - Optional source app bundle ID
   * @param stackId - Optional stack ID to group items for prompt stacking
   * @param source - Device source: 'mac' for local, 'ios' for mobile synced (defaults to 'mac')
   */
  async storeImage(
    image: Electron.NativeImage,
    imageBuffer: Buffer,
    type: ClipboardItemType = 'image',
    sourceApp?: string,
    stackId?: string,
    source: ClipboardSource = 'mac'
  ): Promise<number> {
    const hash = this.hashContent(imageBuffer.toString('base64'));
    
    // Check if already exists (unless it's part of a stack - stacks can have duplicates)
    if (!stackId) {
      const existing = this.db
        .prepare('SELECT id FROM clipboard_items WHERE content_hash = ?')
        .get(hash) as { id: number } | undefined;
      
      if (existing) {
        return existing.id;
      }
    }

    // Get source app info if not provided and source is 'mac'
    if (!sourceApp && source === 'mac') {
      sourceApp = (await this.getFrontmostApp()) || undefined;
    }

    const sourceAppName = sourceApp ? await this.getAppName(sourceApp) : null;

    // Check ignore list (only for Mac items)
    if (source === 'mac' && sourceApp && this.config.ignoreApps?.includes(sourceApp)) {
      return -1; // Ignored
    }

    const size = image.getSize();
    const createdAt = Date.now();

    // Generate thumbnail for list view (50px height, preserving aspect ratio).
    const thumbnailBuffer = this.generateThumbnail(image);

    // Check if this item will create a new stack (stackId provided but doesn't exist yet).
    let isNewStack = false;
    if (stackId) {
      const existingStack = this.db
        .prepare('SELECT 1 FROM clipboard_items WHERE stack_id = ? LIMIT 1')
        .get(stackId);
      isNewStack = !existingStack;
    }

    const stmt = this.db.prepare(`
      INSERT INTO clipboard_items (
        type, image_data, thumbnail_data, image_width, image_height, image_size,
        source_app, source_app_name, created_at, content_hash, stack_id, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      type,
      imageBuffer,
      thumbnailBuffer,
      size.width,
      size.height,
      imageBuffer.length,
      sourceApp || null,
      sourceAppName,
      createdAt,
      hash,
      stackId || null,
      source
    );

    // If this is a screenshot, increment the cumulative counter.
    // This ensures the stat never decreases even if items are deleted.
    if (type === 'screenshot') {
      this.db.prepare(`
        INSERT INTO cumulative_stats (key, value) VALUES ('screenshots_taken', 1)
        ON CONFLICT(key) DO UPDATE SET value = value + 1
      `).run();
    }

    // If this item started a new stack, increment the stacks counter.
    if (isNewStack) {
      this.db.prepare(`
        INSERT INTO cumulative_stats (key, value) VALUES ('stacks_created', 1)
        ON CONFLICT(key) DO UPDATE SET value = value + 1
      `).run();
    }

    // Cleanup old items
    this.cleanupOldItems();

    const id = result.lastInsertRowid as number;
    
    // Notify listeners of new item (so UI can refresh immediately)
    if (id > 0 && this.onItemAddedCallback) {
      this.onItemAddedCallback(id);
    }
    
    return id;
  }

  /**
   * Query clipboard history with optional filters.
   * For list view, large images return thumbnail only; use getItem() for full data.
   */
  queryItems(options: ClipboardQueryOptions = {}): ClipboardItem[] {
    const { type, search, limit = 50, offset = 0, source } = options;

    // Use thumbnail for display; exclude large image_data from list queries.
    let query = `SELECT id, type, content, improved_content, use_improved_version,
      CASE 
        WHEN thumbnail_data IS NOT NULL THEN NULL 
        WHEN length(image_data) > 102400 THEN NULL 
        ELSE image_data 
      END as image_data,
      thumbnail_data,
      image_width, image_height, image_size, source_app, source_app_name,
      word_count, char_count, created_at, content_hash, stack_id, source,
      figure_label, figure_id,
      CASE WHEN thumbnail_data IS NULL AND length(image_data) > 102400 THEN 1 ELSE 0 END as needs_lazy_load
    FROM clipboard_items`;
    const conditions: string[] = [];
    const params: any[] = [];

    if (type) {
      conditions.push('type = ?');
      params.push(type);
    }

    // Filter by device source (mac/ios)
    if (source) {
      conditions.push('source = ?');
      params.push(source);
    }

    if (search) {
      // Enable prefix matching for fuzzy search: "hel wor" matches "hello world"
      const words = search.trim().toLowerCase().split(/\s+/).filter(w => w.length > 0);
      const ftsQuery = words.map(w => `"${w}"*`).join(' ');

      const searchOrClauses: string[] = [];
      const searchParams: any[] = [];

      // Content via FTS (AND semantics across words)
      searchOrClauses.push('id IN (SELECT rowid FROM clipboard_fts WHERE clipboard_fts MATCH ?)');
      searchParams.push(ftsQuery);

      // Match any word against source app name / bundle id / type (OR semantics across words)
      for (const word of words) {
        const like = `%${word}%`;
        searchOrClauses.push('LOWER(source_app_name) LIKE ?');
        searchParams.push(like);
        searchOrClauses.push('LOWER(source_app) LIKE ?');
        searchParams.push(like);
        searchOrClauses.push('LOWER(type) LIKE ?');
        searchParams.push(like);
      }

      conditions.push(`(${searchOrClauses.join(' OR ')})`);
      params.push(...searchParams);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const stmt = this.db.prepare(query);
    const rows = stmt.all(...params) as any[];

    // Map database columns (snake_case) to TypeScript properties (camelCase)
    return rows.map(row => ({
      id: row.id,
      type: row.type,
      content: row.content,
      improvedContent: row.improved_content || null,
      useImprovedVersion: row.use_improved_version === 1,
      imageData: row.image_data ? Buffer.from(row.image_data) : null,
      thumbnailData: row.thumbnail_data ? Buffer.from(row.thumbnail_data) : null,
      imageWidth: row.image_width,
      imageHeight: row.image_height,
      imageSize: row.image_size,
      sourceApp: row.source_app,
      sourceAppName: row.source_app_name,
      wordCount: row.word_count,
      charCount: row.char_count,
      createdAt: row.created_at,
      contentHash: row.content_hash,
      stackId: row.stack_id || null,
      source: row.source || 'mac',
      figureLabel: row.figure_label || null,
      figureId: row.figure_id || null,
      needsLazyLoad: row.needs_lazy_load === 1,
    })) as ClipboardItem[];
  }

  /**
   * Get a single clipboard item by ID.
   */
  getItem(id: number): ClipboardItem | null {
    const row = this.db
      .prepare('SELECT * FROM clipboard_items WHERE id = ?')
      .get(id) as any;

    if (!row) {
      return null;
    }

    // Map database columns (snake_case) to TypeScript properties (camelCase)
    return {
      id: row.id,
      type: row.type,
      content: row.content,
      improvedContent: row.improved_content || null,
      useImprovedVersion: row.use_improved_version === 1,
      imageData: row.image_data ? Buffer.from(row.image_data) : null,
      thumbnailData: row.thumbnail_data ? Buffer.from(row.thumbnail_data) : null,
      imageWidth: row.image_width,
      imageHeight: row.image_height,
      imageSize: row.image_size,
      sourceApp: row.source_app,
      sourceAppName: row.source_app_name,
      wordCount: row.word_count,
      charCount: row.char_count,
      createdAt: row.created_at,
      contentHash: row.content_hash,
      stackId: row.stack_id || null,
      source: row.source || 'mac',
      figureLabel: row.figure_label || null,
      figureId: row.figure_id || null,
    } as ClipboardItem;
  }

  /**
   * Delete a clipboard item.
   */
  deleteItem(id: number): void {
    this.db.prepare('DELETE FROM clipboard_items WHERE id = ?').run(id);
  }

  /**
   * Restore a deleted clipboard item.
   * Used for undo functionality.
   * @param item - The serialized ClipboardItem from renderer (imageData is base64 string)
   */
  async restoreItem(item: { 
    id: number;
    type: ClipboardItemType;
    content: string | null;
    imageData: string | null; // base64 encoded
    imageWidth: number | null;
    imageHeight: number | null;
    imageSize: number | null;
    sourceApp: string | null;
    sourceAppName: string | null;
    wordCount: number | null;
    charCount: number | null;
    createdAt: number;
    contentHash: string;
    stackId: string | null;
    source: ClipboardSource;
  }): Promise<number> {
    if (item.type === 'text' || item.type === 'transcript') {
      // Restore text item
      return await this.storeText(
        item.content || '',
        item.type,
        item.sourceApp || undefined,
        item.stackId || undefined,
        item.source,
        item.createdAt
      );
    } else if (item.type === 'image' || item.type === 'screenshot') {
      // Restore image item
      if (!item.imageData) {
        throw new Error('Cannot restore image item without image data');
      }
      // item.imageData is a base64 string from IPC, convert to Buffer
      const imageBuffer = Buffer.from(item.imageData, 'base64');
      const restoredImage = nativeImage.createFromBuffer(imageBuffer);
      return await this.storeImage(
        restoredImage,
        imageBuffer,
        item.type,
        item.sourceApp || undefined,
        item.stackId || undefined,
        item.source
      );
    } else {
      throw new Error(`Unknown item type: ${item.type}`);
    }
  }

  /**
   * Clear all clipboard history.
   */
  clearAll(): void {
    this.db.exec('DELETE FROM clipboard_items');
    console.log('[ClipboardManager] Cleared all clipboard history');
  }

  // =========================================================================
  // Stack Operations - for prompt stacking feature
  // =========================================================================

  /**
   * Get all items belonging to a specific stack.
   */
  queryItemsByStackId(stackId: string): ClipboardItem[] {
    const rows = this.db
      .prepare('SELECT * FROM clipboard_items WHERE stack_id = ? ORDER BY created_at ASC')
      .all(stackId) as any[];

    return rows.map(row => ({
      id: row.id,
      type: row.type,
      content: row.content,
      improvedContent: row.improved_content || null,
      useImprovedVersion: row.use_improved_version === 1,
      imageData: row.image_data ? Buffer.from(row.image_data) : null,
      thumbnailData: row.thumbnail_data ? Buffer.from(row.thumbnail_data) : null,
      imageWidth: row.image_width,
      imageHeight: row.image_height,
      imageSize: row.image_size,
      sourceApp: row.source_app,
      sourceAppName: row.source_app_name,
      wordCount: row.word_count,
      charCount: row.char_count,
      createdAt: row.created_at,
      contentHash: row.content_hash,
      stackId: row.stack_id || null,
      source: row.source || 'mac',
      figureLabel: row.figure_label || null,
      figureId: row.figure_id || null,
    })) as ClipboardItem[];
  }

  /**
   * Get summary info for all unique stacks.
   * Returns stack metadata including item counts and preview text.
   */
  getUniqueStacks(): StackInfo[] {
    const rows = this.db.prepare(`
      SELECT 
        stack_id,
        COUNT(*) as item_count,
        SUM(CASE WHEN type IN ('image', 'screenshot') THEN 1 ELSE 0 END) as image_count,
        SUM(CASE WHEN type IN ('text', 'transcript') THEN 1 ELSE 0 END) as text_count,
        MIN(created_at) as created_at,
        (SELECT content FROM clipboard_items ci2 
         WHERE ci2.stack_id = clipboard_items.stack_id 
         AND ci2.type IN ('text', 'transcript') 
         AND ci2.content IS NOT NULL 
         ORDER BY ci2.created_at ASC LIMIT 1) as first_text_preview
      FROM clipboard_items 
      WHERE stack_id IS NOT NULL 
      GROUP BY stack_id 
      ORDER BY MIN(created_at) DESC
    `).all() as any[];

    return rows.map(row => ({
      stackId: row.stack_id,
      itemCount: row.item_count,
      imageCount: row.image_count,
      textCount: row.text_count,
      createdAt: row.created_at,
      firstTextPreview: row.first_text_preview ? 
        (row.first_text_preview.length > 100 
          ? row.first_text_preview.substring(0, 100) + '...' 
          : row.first_text_preview) 
        : null,
    }));
  }

  /**
   * Get all-time statistics for the clipboard history.
   * Returns counts of stacks, transcriptions, screenshots, and total words transcribed.
   */
  /**
   * Check if the user has any existing clipboard items.
   * Used to detect existing users vs new installs for onboarding decisions.
   */
  hasExistingItems(): boolean {
    const result = this.db.prepare('SELECT COUNT(*) as count FROM clipboard_items').get() as { count: number };
    return result.count > 0;
  }

  getAllTimeStats(): { stacks: number; transcriptions: number; screenshots: number; words: number } {
    // Read all cumulative stats from the persistent counters table.
    // These counters only increase, so stats persist even when items are deleted.
    const stats = this.db.prepare(`
      SELECT key, value FROM cumulative_stats 
      WHERE key IN ('screenshots_taken', 'transcriptions_made', 'stacks_created', 'words_transcribed')
    `).all() as { key: string; value: number }[];
    
    const statsMap = Object.fromEntries(stats.map(s => [s.key, s.value]));
    
    return {
      stacks: statsMap['stacks_created'] ?? 0,
      transcriptions: statsMap['transcriptions_made'] ?? 0,
      screenshots: statsMap['screenshots_taken'] ?? 0,
      words: statsMap['words_transcribed'] ?? 0,
    };
  }

  /**
   * Update the stack ID for a set of items.
   * Used for combining items into stacks or unstacking them.
   * @param itemIds - Array of item IDs to update
   * @param stackId - New stack ID (or null to unstack)
   */
  updateStackId(itemIds: number[], stackId: string | null): void {
    if (itemIds.length === 0) return;

    // Check if this is a new stack being created (stack_id doesn't exist yet).
    // We only increment the counter for genuinely new stacks, not when adding to existing ones.
    let isNewStack = false;
    if (stackId !== null) {
      const existing = this.db
        .prepare('SELECT 1 FROM clipboard_items WHERE stack_id = ? LIMIT 1')
        .get(stackId);
      isNewStack = !existing;
    }

    const placeholders = itemIds.map(() => '?').join(',');
    this.db
      .prepare(`UPDATE clipboard_items SET stack_id = ? WHERE id IN (${placeholders})`)
      .run(stackId, ...itemIds);
    
    // Increment cumulative stacks counter if this is a new stack.
    if (isNewStack) {
      this.db.prepare(`
        INSERT INTO cumulative_stats (key, value) VALUES ('stacks_created', 1)
        ON CONFLICT(key) DO UPDATE SET value = value + 1
      `).run();
    }
    
    console.log(`[ClipboardManager] Updated stack_id for ${itemIds.length} items to: ${stackId}`);
  }

  /**
   * Update the content field for a specific item.
   * Used to store AI-generated descriptions for images/screenshots.
   * @param itemId - ID of the item to update
   * @param content - New content to set
   */
  updateItemContent(itemId: number, content: string): void {
    const stmt = this.db.prepare('UPDATE clipboard_items SET content = ? WHERE id = ?');
    stmt.run(content, itemId);
  }

  /**
   * Update the figure label and unique ID for an item.
   * Used when screenshots are taken during recording to label them as "A", "B", "C", etc.
   * @param itemId - ID of the item to update
   * @param figureLabel - The figure label (e.g., "A", "B", "C")
   * @param figureId - Optional unique 5-char ID (e.g., "k7xm2"). If not provided, one is generated.
   */
  updateFigureLabel(itemId: number, figureLabel: string, figureId?: string): void {
    const id = figureId || this.generateFigureId();
    const stmt = this.db.prepare('UPDATE clipboard_items SET figure_label = ?, figure_id = ? WHERE id = ?');
    stmt.run(figureLabel, id, itemId);
    console.log(`[ClipboardManager] Updated figure for item ${itemId}: Figure ${figureLabel} (${id})`);
  }

  /**
   * Generate a unique 5-character alphanumeric ID for figure identification.
   * Uses lowercase letters and digits (36^5 = ~60 million combinations).
   * Format: e.g., "k7xm2", "a3b9z"
   */
  generateFigureId(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let id = '';
    for (let i = 0; i < 5; i++) {
      id += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return id;
  }

  /**
   * Save an improved version of text content for an item.
   * The original content is preserved; only the improved_content column is updated.
   * @param itemId - ID of the item to update
   * @param improvedContent - The improved text from the Engineer feature
   */
  saveImprovedContent(itemId: number, improvedContent: string): void {
    const stmt = this.db.prepare('UPDATE clipboard_items SET improved_content = ? WHERE id = ?');
    stmt.run(improvedContent, itemId);
    console.log(`[ClipboardManager] Saved improved content for item ${itemId}`);
  }

  /**
   * Clear the improved content for an item (revert to original only).
   * @param itemId - ID of the item to clear improved content from
   */
  clearImprovedContent(itemId: number): void {
    const stmt = this.db.prepare('UPDATE clipboard_items SET improved_content = NULL WHERE id = ?');
    stmt.run(itemId);
    console.log(`[ClipboardManager] Cleared improved content for item ${itemId}`);
  }

  /**
   * Set whether to use the improved version of content for an item.
   * When true, improved content is used for pasting; when false, original content is used.
   */
  setUseImprovedVersion(itemId: number, useImproved: boolean): void {
    const stmt = this.db.prepare('UPDATE clipboard_items SET use_improved_version = ? WHERE id = ?');
    stmt.run(useImproved ? 1 : 0, itemId);
    console.log(`[ClipboardManager] Set use_improved_version=${useImproved} for item ${itemId}`);
  }

  /**
   * Capture screenshot and add to clipboard history.
   * When region=true, uses interactive selection (drag to select) like macOS Command+Shift+Control+4.
   * When fullScreen=true, captures all displays immediately.
   * When activeWindow=true, captures just the active window.
   * @param options - Capture options (region, fullScreen, activeWindow, saveToDesktop, figureLabel, figureId)
   * @param stackId - Optional stack ID to group this screenshot with other items
   */
  async captureScreenshot(
    options: { region?: boolean; fullScreen?: boolean; activeWindow?: boolean; saveToDesktop?: boolean; figureLabel?: string; figureId?: string } = {},
    stackId?: string
  ): Promise<number> {
    const { region = false, fullScreen = false, activeWindow = false, saveToDesktop = false, figureLabel, figureId } = options;
    
    // Debug: Log screen recording permission status to diagnose Tahoe issues.
    const screenPermission = systemPreferences.getMediaAccessStatus('screen');
    console.log('[ClipboardManager] Attempting screenshot, screen permission:', screenPermission);
    
    // Set flag to prevent polling from picking up the screenshot while we're capturing it.
    this.screenshotInProgress = true;
    
    // Emit event so transcriberManager can pause abandon hotkey during screenshot selection.
    this.emit('screenshotStart');
    
    try {
      if (region) {
        // Interactive selection mode: drag to select area
        let capturePath: string | null = null;
        let command = 'screencapture -i';
        
        if (saveToDesktop) {
          // Generate desktop filename. If figure info is provided, include it for searchability.
          // Format: Field_Figure-A_k7xm2_2026-01-07_14-30-22.png (with figure)
          //    or: Field_Screenshot_2026-01-07_14-30-22.png (without figure)
          const now = new Date();
          const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const desktopPath = app.getPath('desktop');
          
          let filename: string;
          if (figureLabel && figureId) {
            filename = `Field_Figure-${figureLabel}_${figureId}_${timestamp}.png`;
          } else {
            filename = `Field_Screenshot_${timestamp}.png`;
          }
          
          capturePath = path.join(desktopPath, filename);
          command += ` "${capturePath}"`;
        } else {
          // Default: save directly to clipboard
          command += ' -c';
        }

        await execAsync(command);
        
        // Small delay to ensure clipboard or file is updated
        await new Promise(resolve => setTimeout(resolve, 100));
        
        let image: Electron.NativeImage;
        let imageBuffer: Buffer;

        if (saveToDesktop && capturePath) {
          const fs = await import('fs/promises');
          try {
            const fileBuffer = await fs.readFile(capturePath);
            image = nativeImage.createFromBuffer(fileBuffer);
            clipboard.writeImage(image);
            imageBuffer = image.toPNG();
          } catch (error) {
            console.warn('[ClipboardManager] Failed to read desktop screenshot or capture was cancelled');
            this.screenshotInProgress = false;
            this.emit('screenshotEnd');
            return -1;
          }
        } else {
          // Read from clipboard
          image = clipboard.readImage();
          if (image.isEmpty()) {
            console.warn('[ClipboardManager] Screenshot capture cancelled or failed');
            this.screenshotInProgress = false;
            this.emit('screenshotEnd');
            return -1;
          }
          imageBuffer = image.toPNG();
        }
        
        // Update lastContentHash to prevent polling from re-storing this image.
        this.lastContentHash = this.hashContent(imageBuffer.toString('base64'));
        
        // Store in history (with stackId if provided)
        const id = await this.storeImage(image, imageBuffer, 'screenshot', undefined, stackId);
        
        this.screenshotInProgress = false;
        this.emit('screenshotEnd');
        return id;
      } else if (fullScreen) {
        // Full screen capture: captures all displays immediately without interaction
        const tempPath = path.join(app.getPath('temp'), `screenshot-${Date.now()}.png`);
        await execAsync(`screencapture "${tempPath}"`);

        // Read the captured image
        const fs = await import('fs/promises');
        try {
          const imageBuffer = await fs.readFile(tempPath);
          const image = nativeImage.createFromBuffer(imageBuffer);

          // Update lastContentHash to prevent polling from re-storing this image
          this.lastContentHash = this.hashContent(imageBuffer.toString('base64'));

          // Store in history (with stackId if provided)
          const id = await this.storeImage(image, imageBuffer, 'screenshot', undefined, stackId);

          // Clean up temp file
          await fs.unlink(tempPath);

          this.screenshotInProgress = false;
          this.emit('screenshotEnd');
          return id;
        } catch (error) {
          // Clean up temp file even on error
          try {
            await fs.unlink(tempPath);
          } catch {}
          this.screenshotInProgress = false;
          this.emit('screenshotEnd');
          throw error;
        }
      } else if (activeWindow) {
        // Active window capture: captures just the frontmost window
        const tempPath = path.join(app.getPath('temp'), `screenshot-${Date.now()}.png`);
        await execAsync(`screencapture -w "${tempPath}"`);

        // Read the captured image
        const fs = await import('fs/promises');
        try {
          const imageBuffer = await fs.readFile(tempPath);
          const image = nativeImage.createFromBuffer(imageBuffer);

          // Update lastContentHash to prevent polling from re-storing this image
          this.lastContentHash = this.hashContent(imageBuffer.toString('base64'));

          // Store in history (with stackId if provided)
          const id = await this.storeImage(image, imageBuffer, 'screenshot', undefined, stackId);

          // Clean up temp file
          await fs.unlink(tempPath);

          this.screenshotInProgress = false;
          this.emit('screenshotEnd');
          return id;
        } catch (error) {
          // Clean up temp file even on error
          try {
            await fs.unlink(tempPath);
          } catch {}
          this.screenshotInProgress = false;
          this.emit('screenshotEnd');
          throw error;
        }
      } else {
        // Fallback to region mode if no specific mode selected
        console.warn('[ClipboardManager] No capture mode specified, defaulting to region mode');
        this.screenshotInProgress = false;
        this.emit('screenshotEnd');
        return -1;
      }
    } catch (error) {
      console.error('[ClipboardManager] Screenshot capture failed:', error);
      this.screenshotInProgress = false;
      this.emit('screenshotEnd');
      return -1;
    }
  }

  /**
   * Check if a screenshot capture is currently in progress.
   * Used to prevent escape key from canceling recording while user is selecting screenshot region.
   */
  isScreenshotInProgress(): boolean {
    return this.screenshotInProgress;
  }

  /**
   * Update screenshot hotkey configuration.
   */
  setScreenshotHotkey(hotkey: string): boolean {
    // Unregister old hotkey if registered
    if (this.screenshotHotkeyRegistered && this.config.screenshotHotkey) {
      globalShortcut.unregister(this.config.screenshotHotkey);
      this.screenshotHotkeyRegistered = false;
    }

    // Update config
    this.config.screenshotHotkey = hotkey;

    // Re-register if callback exists
    if (this.screenshotCallback && hotkey) {
      return this.registerScreenshotHotkey(this.screenshotCallback);
    }

    return true;
  }

  /**
   * Update full screen screenshot hotkey configuration.
   */
  setFullScreenHotkey(hotkey: string): boolean {
    // Unregister old hotkey if registered
    if (this.fullScreenHotkeyRegistered && this.config.fullScreenHotkey) {
      globalShortcut.unregister(this.config.fullScreenHotkey);
      this.fullScreenHotkeyRegistered = false;
    }

    // Update config
    this.config.fullScreenHotkey = hotkey;

    // Re-register if callback exists
    if (this.fullScreenCallback && hotkey) {
      return this.registerFullScreenHotkey(this.fullScreenCallback);
    }

    return true;
  }

  /**
   * Update active window screenshot hotkey configuration.
   */
  setActiveWindowHotkey(hotkey: string): boolean {
    // Unregister old hotkey if registered
    if (this.activeWindowHotkeyRegistered && this.config.activeWindowHotkey) {
      globalShortcut.unregister(this.config.activeWindowHotkey);
      this.activeWindowHotkeyRegistered = false;
    }

    // Update config
    this.config.activeWindowHotkey = hotkey;

    // Re-register if callback exists
    if (this.activeWindowCallback && hotkey) {
      return this.registerActiveWindowHotkey(this.activeWindowCallback);
    }

    return true;
  }


  /**
   * Update history hotkey configuration.
   */
  setHistoryHotkey(hotkey: string): boolean {
    // Unregister old hotkey if registered
    if (this.historyHotkeyRegistered && this.config.historyHotkey) {
      globalShortcut.unregister(this.config.historyHotkey);
      this.historyHotkeyRegistered = false;
    }

    // Update config
    this.config.historyHotkey = hotkey;

    // Re-register if callback exists
    if (this.historyCallback && hotkey) {
      return this.registerHistoryHotkey(this.historyCallback);
    }

    return true;
  }

  /**
   * Register screenshot hotkey.
   */
  registerScreenshotHotkey(callback: ScreenshotCallback): boolean {
    if (!this.config.screenshotHotkey) {
      return false;
    }

    // Store callback
    this.screenshotCallback = callback;

    if (this.screenshotHotkeyRegistered) {
      globalShortcut.unregister(this.config.screenshotHotkey);
    }

    const registered = globalShortcut.register(this.config.screenshotHotkey, () => {
      const result = callback();
      if (result instanceof Promise) {
        result.catch(err => console.error('[ClipboardManager] Screenshot callback error:', err));
      }
    });
    this.screenshotHotkeyRegistered = registered;

    if (registered) {
      console.log(`[ClipboardManager] Registered screenshot hotkey: ${this.config.screenshotHotkey}`);
    } else {
      console.warn(`[ClipboardManager] Failed to register screenshot hotkey: ${this.config.screenshotHotkey}`);
    }

    return registered;
  }


  /**
   * Register full screen screenshot hotkey (Cmd+3).
   */
  registerFullScreenHotkey(callback: ScreenshotCallback): boolean {
    if (!this.config.fullScreenHotkey) {
      return false;
    }

    // Store callback
    this.fullScreenCallback = callback;

    if (this.fullScreenHotkeyRegistered) {
      globalShortcut.unregister(this.config.fullScreenHotkey);
    }

    const registered = globalShortcut.register(this.config.fullScreenHotkey, () => {
      const result = callback();
      if (result instanceof Promise) {
        result.catch(err => console.error('[ClipboardManager] Full screen screenshot callback error:', err));
      }
    });
    this.fullScreenHotkeyRegistered = registered;

    if (registered) {
      console.log(`[ClipboardManager] Registered full screen screenshot hotkey: ${this.config.fullScreenHotkey}`);
    } else {
      console.warn(`[ClipboardManager] Failed to register full screen screenshot hotkey: ${this.config.fullScreenHotkey}`);
    }

    return registered;
  }

  /**
   * Register active window screenshot hotkey (Cmd+Shift+3).
   */
  registerActiveWindowHotkey(callback: ScreenshotCallback): boolean {
    if (!this.config.activeWindowHotkey) {
      return false;
    }

    // Store callback
    this.activeWindowCallback = callback;

    if (this.activeWindowHotkeyRegistered) {
      globalShortcut.unregister(this.config.activeWindowHotkey);
    }

    const registered = globalShortcut.register(this.config.activeWindowHotkey, () => {
      const result = callback();
      if (result instanceof Promise) {
        result.catch(err => console.error('[ClipboardManager] Active window screenshot callback error:', err));
      }
    });
    this.activeWindowHotkeyRegistered = registered;

    if (registered) {
      console.log(`[ClipboardManager] Registered active window screenshot hotkey: ${this.config.activeWindowHotkey}`);
    } else {
      console.warn(`[ClipboardManager] Failed to register active window screenshot hotkey: ${this.config.activeWindowHotkey}`);
    }

    return registered;
  }

  /**
   * Register clipboard history hotkey.
   */
  registerHistoryHotkey(callback: HistoryCallback): boolean {
    if (!this.config.historyHotkey) {
      return false;
    }

    // Store callback
    this.historyCallback = callback;

    if (this.historyHotkeyRegistered) {
      globalShortcut.unregister(this.config.historyHotkey);
    }

    const registered = globalShortcut.register(this.config.historyHotkey, callback);
    this.historyHotkeyRegistered = registered;

    if (registered) {
      console.log(`[ClipboardManager] Registered history hotkey: ${this.config.historyHotkey}`);
    } else {
      console.warn(`[ClipboardManager] Failed to register history hotkey: ${this.config.historyHotkey}`);
    }

    return registered;
  }

  /**
   * Get current hotkey configuration.
   */
  getHotkeys(): ClipboardConfig {
    return {
      screenshotHotkey: this.config.screenshotHotkey,
      fullScreenHotkey: this.config.fullScreenHotkey,
      activeWindowHotkey: this.config.activeWindowHotkey,
      historyHotkey: this.config.historyHotkey,
    };
  }

  // =========================================================================
  // Continuous Context Mode - allows continuous screenshotting with stacked results
  // User takes multiple screenshots without re-pressing hotkey, until Escape pressed.
  // =========================================================================

  /**
   * Enable or disable continuous context feature globally.
   * When disabled, the hotkey won't be registered.
   */
  setContinuousContextEnabled(enabled: boolean): void {
    this.continuousContextEnabled = enabled;
    
    if (enabled && this.continuousContextCallback) {
      this.registerContinuousContextHotkey(this.continuousContextCallback);
    } else if (!enabled && this.continuousContextHotkeyRegistered) {
      if (this.continuousContextHotkey) {
        globalShortcut.unregister(this.continuousContextHotkey);
        this.continuousContextHotkeyRegistered = false;
      }
    }
    
    console.log(`[ClipboardManager] Continuous Context ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if continuous context feature is enabled.
   */
  isContinuousContextEnabled(): boolean {
    return this.continuousContextEnabled;
  }

  /**
   * Set the continuous context hotkey.
   */
  setContinuousContextHotkey(hotkey: string): boolean {
    // Unregister old hotkey
    if (this.continuousContextHotkeyRegistered && this.continuousContextHotkey) {
      globalShortcut.unregister(this.continuousContextHotkey);
      this.continuousContextHotkeyRegistered = false;
    }

    this.continuousContextHotkey = hotkey;

    // Re-register if enabled and callback exists
    if (this.continuousContextEnabled && this.continuousContextCallback) {
      return this.registerContinuousContextHotkey(this.continuousContextCallback);
    }

    return true;
  }

  /**
   * Get the current continuous context hotkey.
   */
  getContinuousContextHotkey(): string {
    return this.continuousContextHotkey;
  }

  /**
   * Load continuous context settings from preferences.
   */
  loadContinuousContextFromPreferences(enabled?: boolean, hotkey?: string): void {
    if (enabled !== undefined) {
      this.continuousContextEnabled = enabled;
    }
    if (hotkey) {
      this.continuousContextHotkey = hotkey;
    }
  }

  /**
   * Register the continuous context hotkey.
   */
  registerContinuousContextHotkey(callback: () => void): boolean {
    if (!this.continuousContextEnabled) {
      console.log('[ClipboardManager] Continuous Context disabled, not registering hotkey');
      return false;
    }

    if (!this.continuousContextHotkey) {
      return false;
    }

    this.continuousContextCallback = callback;

    if (this.continuousContextHotkeyRegistered) {
      globalShortcut.unregister(this.continuousContextHotkey);
    }

    const registered = globalShortcut.register(this.continuousContextHotkey, callback);
    this.continuousContextHotkeyRegistered = registered;

    if (registered) {
      console.log(`[ClipboardManager] Registered continuous context hotkey: ${this.continuousContextHotkey}`);
    } else {
      console.warn(`[ClipboardManager] Failed to register continuous context hotkey: ${this.continuousContextHotkey}`);
    }

    return registered;
  }

  /**
   * Start continuous context mode.
   * Creates a new stack ID and begins the first screenshot capture.
   * Registers a global Escape key to stop the mode at any time.
   */
  async startContinuousContext(): Promise<void> {
    if (this.continuousContextActive) {
      console.log('[ClipboardManager] Continuous context already active');
      return;
    }

    console.log('[ClipboardManager] Starting continuous context mode');
    
    // Generate a new stack ID for this session
    this.continuousContextStackId = crypto.randomUUID();
    this.continuousContextActive = true;
    this.continuousContextScreenshotCount = 0;

    // Register global Escape key to stop continuous context at any time.
    // This allows user to exit even when not in the screenshot selection UI.
    if (!this.continuousContextEscapeRegistered) {
      const registered = globalShortcut.register('Escape', () => {
        console.log('[ClipboardManager] Escape pressed - stopping continuous context');
        this.stopContinuousContext();
      });
      this.continuousContextEscapeRegistered = registered;
      if (registered) {
        console.log('[ClipboardManager] Registered Escape key for continuous context');
      }
    }

    this.emit('continuousContextChanged', this.getContinuousContextState());

    // Take the first screenshot
    await this.captureContinuousScreenshot();
  }

  /**
   * Stop continuous context mode.
   * Called when user presses Escape or explicitly stops the mode.
   */
  stopContinuousContext(): void {
    if (!this.continuousContextActive) {
      return;
    }

    console.log(`[ClipboardManager] Stopping continuous context mode. Screenshots taken: ${this.continuousContextScreenshotCount}`);
    
    // Unregister the global Escape key we registered for continuous context.
    if (this.continuousContextEscapeRegistered) {
      globalShortcut.unregister('Escape');
      this.continuousContextEscapeRegistered = false;
      console.log('[ClipboardManager] Unregistered Escape key for continuous context');
    }
    
    // Kill any running screencapture process
    if (this.screencaptureProcess && !this.screencaptureProcess.killed) {
      this.screencaptureProcess.kill();
      this.screencaptureProcess = null;
    }

    this.continuousContextActive = false;
    // Keep stackId so transcription can still be added if started during the session
    this.emit('continuousContextChanged', this.getContinuousContextState());
  }

  /**
   * Get the current continuous context state.
   */
  getContinuousContextState(): ContinuousContextState {
    return {
      active: this.continuousContextActive,
      stackId: this.continuousContextStackId,
      screenshotCount: this.continuousContextScreenshotCount,
    };
  }

  /**
   * Get the current continuous context stack ID (for transcription to use).
   */
  getContinuousContextStackId(): string | null {
    return this.continuousContextStackId;
  }

  /**
   * Check if Command key is currently held (macOS only).
   * Used to pause continuous screenshot when user wants to interact with apps.
   */
  private isCommandKeyPressed(): boolean {
    if (process.platform !== 'darwin') {
      return false;
    }
    try {
      const { execSync } = require('child_process');
      const result = execSync(
        `osascript -e 'tell application "System Events" to return command down'`,
        { timeout: 500 }
      ).toString().trim();
      return result === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Capture a screenshot in continuous context mode.
   * After the screenshot is taken, automatically triggers another capture
   * unless the mode has been stopped. Pauses when Command key is held
   * to allow user interaction with apps.
   */
  private async captureContinuousScreenshot(): Promise<void> {
    if (!this.continuousContextActive) {
      return;
    }

    // Check if Command key is held - pause to allow user interaction.
    // This lets users scroll, click, etc. without triggering screenshot UI.
    if (this.isCommandKeyPressed()) {
      if (!this.continuousContextPausedForCommand) {
        this.continuousContextPausedForCommand = true;
        console.log('[ClipboardManager] Command key held - pausing continuous screenshots');
      }
      // Check again after a short delay
      setTimeout(() => this.captureContinuousScreenshot(), 100);
      return;
    }
    
    // Resume logging if we were paused
    if (this.continuousContextPausedForCommand) {
      this.continuousContextPausedForCommand = false;
      console.log('[ClipboardManager] Command key released - resuming continuous screenshots');
    }

    try {
      // Use interactive selection mode with -i flag
      // This matches macOS Command+Shift+4 behavior
      // We use spawn instead of exec to be able to detect when the process exits
      await new Promise<void>((resolve, reject) => {
        this.screencaptureProcess = spawn('screencapture', ['-i', '-c']);

        this.screencaptureProcess.on('close', (code) => {
          this.screencaptureProcess = null;
          
          if (code === 0) {
            resolve();
          } else if (code === 1) {
            // User cancelled (pressed Escape during selection)
            // Stop continuous context mode
            this.stopContinuousContext();
            resolve();
          } else {
            reject(new Error(`screencapture exited with code ${code}`));
          }
        });

        this.screencaptureProcess.on('error', (err) => {
          this.screencaptureProcess = null;
          reject(err);
        });
      });

      // If mode was stopped during capture, don't process
      if (!this.continuousContextActive) {
        return;
      }

      // Small delay to ensure clipboard is updated
      await new Promise(resolve => setTimeout(resolve, 100));

      // Read from clipboard
      const image = clipboard.readImage();
      if (image.isEmpty()) {
        console.warn('[ClipboardManager] Continuous context: screenshot capture cancelled or failed');
        // Still continue if mode is active - maybe user just cancelled this one
        if (this.continuousContextActive) {
          // Small delay before trying again
          setTimeout(() => this.captureContinuousScreenshot(), 200);
        }
        return;
      }

      const imageBuffer = image.toPNG();
      
      // Update lastContentHash to prevent polling from re-storing this image
      this.lastContentHash = this.hashContent(imageBuffer.toString('base64'));
      
      // Store in history with the continuous context stack ID
      const id = await this.storeImage(
        image,
        imageBuffer,
        'screenshot',
        undefined,
        this.continuousContextStackId || undefined
      );
      
      if (id > 0) {
        this.continuousContextScreenshotCount++;
        console.log(`[ClipboardManager] Continuous context: screenshot ${this.continuousContextScreenshotCount} stored (id: ${id})`);
        
        // Emit events
        this.emit('continuousContextScreenshot', id);
        this.emit('continuousContextChanged', this.getContinuousContextState());
        
        // Notify item added
        if (this.onItemAddedCallback) {
          this.onItemAddedCallback(id);
        }
      }

      // If still active, trigger another capture after a brief delay
      if (this.continuousContextActive) {
        setTimeout(() => this.captureContinuousScreenshot(), 200);
      }
    } catch (error) {
      console.error('[ClipboardManager] Continuous context screenshot failed:', error);
      // If error occurs, stop the mode
      this.stopContinuousContext();
    }
  }

  /**
   * Clear the continuous context stack ID.
   * Called when the stack is pasted or the session is fully complete.
   */
  clearContinuousContextStack(): void {
    this.continuousContextStackId = null;
    this.continuousContextScreenshotCount = 0;
  }

  /**
   * Get frontmost application bundle ID.
   */
  private async getFrontmostApp(): Promise<string | null> {
    try {
      const { stdout } = await execAsync(
        "osascript -e 'tell application \"System Events\" to get bundle identifier of first application process whose frontmost is true'"
      );
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Get application display name from bundle ID.
   */
  private async getAppName(bundleId: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync(
        `osascript -e 'tell application "System Events" to get name of first application process whose bundle identifier is "${bundleId}"'`
      );
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Hash content for deduplication.
   */
  private hashContent(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  /**
   * Generate a small thumbnail for list view display.
   * Creates a 50px-height image (preserving aspect ratio) as PNG.
   * Returns null if thumbnail generation fails.
   */
  private generateThumbnail(image: Electron.NativeImage): Buffer | null {
    try {
      const size = image.getSize();
      if (size.width === 0 || size.height === 0) return null;

      // Calculate thumbnail dimensions (50px height, preserve aspect ratio).
      const targetHeight = 50;
      const aspectRatio = size.width / size.height;
      const targetWidth = Math.round(targetHeight * aspectRatio);

      const thumbnail = image.resize({
        width: targetWidth,
        height: targetHeight,
        quality: 'good',
      });

      return thumbnail.toPNG();
    } catch (error) {
      console.error('[ClipboardManager] Failed to generate thumbnail:', error);
      return null;
    }
  }

  syncClipboardHash(): void {
    try {
      const text = clipboard.readText();
      if (text) {
        this.lastContentHash = this.hashContent(text);
        return;
      }
      
      const image = clipboard.readImage();
      if (!image.isEmpty()) {
        const imageBuffer = image.toPNG();
        this.lastContentHash = this.hashContent(imageBuffer.toString('base64'));
      }
    } catch (error) {
      console.debug('[ClipboardManager] Error syncing clipboard hash:', error);
    }
  }

  /**
   * Cleanup old items based on retention policy.
   */
  private cleanupOldItems(): void {
    const { retentionDays, maxItems } = this.config;

    // Delete items older than retention period
    if (retentionDays) {
      const cutoffTime = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      this.db.prepare('DELETE FROM clipboard_items WHERE created_at < ?').run(cutoffTime);
    }

    // Delete oldest items if over max count
    if (maxItems) {
      const count = this.db.prepare('SELECT COUNT(*) as count FROM clipboard_items').get() as { count: number };
      if (count.count > maxItems) {
        const toDelete = count.count - maxItems;
        this.db.prepare(`
          DELETE FROM clipboard_items
          WHERE id IN (
            SELECT id FROM clipboard_items
            ORDER BY created_at ASC
            LIMIT ?
          )
        `).run(toDelete);
      }
    }
  }

  /**
   * Export an image from the database to the figures cache directory.
   * Returns the file path to the exported image.
   * Uses lazy caching: only exports if file doesn't already exist.
   */
  async exportImageToCache(item: ClipboardItem): Promise<string | null> {
    if (!item.imageData) {
      console.warn('[ClipboardManager] Cannot export item without image data');
      return null;
    }

    // Create cache directory if it doesn't exist
    const cacheDir = path.join(app.getPath('userData'), 'figures');
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // Generate filename based on figure label and ID
    let filename: string;
    if (item.figureLabel && item.figureId) {
      filename = `figure-${item.figureLabel}-${item.figureId}.png`;
    } else {
      // Fallback: use timestamp-based naming like macOS screenshots
      // Format: "Screenshot 2026-01-10 at 4.30.15 PM.png"
      const now = new Date(item.createdAt || Date.now());
      const year = now.getFullYear();
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const hours = now.getHours();
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      const period = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours % 12 || 12;

      filename = `Screenshot ${year}-${month}-${day} at ${displayHours}.${minutes}.${seconds} ${period}.png`;
    }

    const filePath = path.join(cacheDir, filename);

    // Check if file already exists (lazy cache)
    if (fs.existsSync(filePath)) {
      return filePath;
    }

    // Export image data to file
    try {
      const imageBuffer = typeof item.imageData === 'string'
        ? Buffer.from(item.imageData, 'base64')
        : item.imageData;

      fs.writeFileSync(filePath, imageBuffer);
      console.log('[ClipboardManager] Exported image to:', filePath);
      return filePath;
    } catch (error) {
      console.error('[ClipboardManager] Failed to export image:', error);
      return null;
    }
  }

  /**
   * Cleanup resources.
   */
  destroy(): void {
    this.stopPolling();
    this.stopContinuousContext();
    
    if (this.screenshotHotkeyRegistered && this.config.screenshotHotkey) {
      globalShortcut.unregister(this.config.screenshotHotkey);
    }

    if (this.fullScreenHotkeyRegistered && this.config.fullScreenHotkey) {
      globalShortcut.unregister(this.config.fullScreenHotkey);
    }

    if (this.activeWindowHotkeyRegistered && this.config.activeWindowHotkey) {
      globalShortcut.unregister(this.config.activeWindowHotkey);
    }

    if (this.historyHotkeyRegistered && this.config.historyHotkey) {
      globalShortcut.unregister(this.config.historyHotkey);
    }
    
    if (this.continuousContextHotkeyRegistered && this.continuousContextHotkey) {
      globalShortcut.unregister(this.continuousContextHotkey);
    }

    this.db.close();
    console.log('[ClipboardManager] Destroyed');
  }
}

