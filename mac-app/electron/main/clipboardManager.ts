import { app, clipboard, globalShortcut } from 'electron';
import Database from 'better-sqlite3';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import crypto from 'crypto';

const execAsync = promisify(exec);

/**
 * Type of clipboard item.
 */
export type ClipboardItemType = 'text' | 'image' | 'transcript' | 'screenshot';

/**
 * Clipboard item stored in database.
 */
export interface ClipboardItem {
  id: number;
  type: ClipboardItemType;
  content: string | null;
  imageData: Buffer | null;
  imageWidth: number | null;
  imageHeight: number | null;
  imageSize: number | null;
  sourceApp: string | null;
  sourceAppName: string | null;
  wordCount: number | null;
  charCount: number | null;
  createdAt: number;
  contentHash: string;
}

/**
 * Options for querying clipboard history.
 */
export interface ClipboardQueryOptions {
  type?: ClipboardItemType;
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Configuration for clipboard manager.
 */
interface ClipboardConfig {
  retentionDays?: number;
  maxItems?: number;
  ignoreApps?: string[]; // Bundle IDs to ignore
  screenshotHotkey?: string;
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
  screenshotHotkey: 'Alt+1',
  historyHotkey: 'Control+Alt+Space',
};

/**
 * Manages clipboard history with SQLite storage.
 * Polls clipboard every 500ms and stores changes locally.
 */
export class ClipboardManager {
  private db: Database.Database;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastContentHash: string = '';
  private config: ClipboardConfig;
  private screenshotHotkeyRegistered: boolean = false;
  private historyHotkeyRegistered: boolean = false;
  private screenshotCallback: ScreenshotCallback | null = null;
  private historyCallback: HistoryCallback | null = null;

  constructor(config: Partial<ClipboardConfig> = {}) {
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
  loadHotkeysFromPreferences(screenshotHotkey?: string, historyHotkey?: string): void {
    if (screenshotHotkey) {
      this.config.screenshotHotkey = screenshotHotkey;
    }
    if (historyHotkey) {
      this.config.historyHotkey = historyHotkey;
    }
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
    try {
      // Check for text first
      const text = clipboard.readText();
      if (text) {
        const hash = this.hashContent(text);
        if (hash !== this.lastContentHash) {
          await this.storeText(text);
          this.lastContentHash = hash;
        }
        return;
      }

      // Check for image
      const image = clipboard.readImage();
      if (!image.isEmpty()) {
        const imageBuffer = image.toPNG();
        const hash = this.hashContent(imageBuffer.toString('base64'));
        if (hash !== this.lastContentHash) {
          await this.storeImage(image, imageBuffer);
          this.lastContentHash = hash;
        }
      }
    } catch (error) {
      // Silently handle errors (clipboard might be locked)
      console.debug('[ClipboardManager] Error checking clipboard:', error);
    }
  }

  /**
   * Store text content in clipboard history.
   */
  async storeText(
    text: string,
    type: ClipboardItemType = 'text',
    sourceApp?: string
  ): Promise<number> {
    const hash = this.hashContent(text);
    
    // Check if already exists
    const existing = this.db
      .prepare('SELECT id FROM clipboard_items WHERE content_hash = ?')
      .get(hash) as { id: number } | undefined;
    
    if (existing) {
      return existing.id;
    }

    // Get source app info if not provided
    if (!sourceApp) {
      sourceApp = (await this.getFrontmostApp()) || undefined;
    }

    const sourceAppName = sourceApp ? await this.getAppName(sourceApp) : null;

    // Check ignore list
    if (sourceApp && this.config.ignoreApps?.includes(sourceApp)) {
      return -1; // Ignored
    }

    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;
    const charCount = text.length;
    const createdAt = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO clipboard_items (
        type, content, source_app, source_app_name,
        word_count, char_count, created_at, content_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      type,
      text,
      sourceApp,
      sourceAppName,
      wordCount,
      charCount,
      createdAt,
      hash
    );

    // Cleanup old items
    this.cleanupOldItems();

    return result.lastInsertRowid as number;
  }

  /**
   * Store image in clipboard history.
   */
  async storeImage(
    image: Electron.NativeImage,
    imageBuffer: Buffer,
    type: ClipboardItemType = 'image',
    sourceApp?: string
  ): Promise<number> {
    const hash = this.hashContent(imageBuffer.toString('base64'));
    
    // Check if already exists
    const existing = this.db
      .prepare('SELECT id FROM clipboard_items WHERE content_hash = ?')
      .get(hash) as { id: number } | undefined;
    
    if (existing) {
      return existing.id;
    }

    // Get source app info if not provided
    if (!sourceApp) {
      sourceApp = (await this.getFrontmostApp()) || undefined;
    }

    const sourceAppName = sourceApp ? await this.getAppName(sourceApp) : null;

    // Check ignore list
    if (sourceApp && this.config.ignoreApps?.includes(sourceApp)) {
      return -1; // Ignored
    }

    const size = image.getSize();
    const createdAt = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO clipboard_items (
        type, image_data, image_width, image_height, image_size,
        source_app, source_app_name, created_at, content_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      type,
      imageBuffer,
      size.width,
      size.height,
      imageBuffer.length,
      sourceApp,
      sourceAppName,
      createdAt,
      hash
    );

    // Cleanup old items
    this.cleanupOldItems();

    return result.lastInsertRowid as number;
  }

  /**
   * Query clipboard history with optional filters.
   */
  queryItems(options: ClipboardQueryOptions = {}): ClipboardItem[] {
    const { type, search, limit = 50, offset = 0 } = options;

    let query = 'SELECT * FROM clipboard_items';
    const conditions: string[] = [];
    const params: any[] = [];

    if (type) {
      conditions.push('type = ?');
      params.push(type);
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
      imageData: row.image_data ? Buffer.from(row.image_data) : null,
      imageWidth: row.image_width,
      imageHeight: row.image_height,
      imageSize: row.image_size,
      sourceApp: row.source_app,
      sourceAppName: row.source_app_name,
      wordCount: row.word_count,
      charCount: row.char_count,
      createdAt: row.created_at,
      contentHash: row.content_hash,
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
      imageData: row.image_data ? Buffer.from(row.image_data) : null,
      imageWidth: row.image_width,
      imageHeight: row.image_height,
      imageSize: row.image_size,
      sourceApp: row.source_app,
      sourceAppName: row.source_app_name,
      wordCount: row.word_count,
      charCount: row.char_count,
      createdAt: row.created_at,
      contentHash: row.content_hash,
    } as ClipboardItem;
  }

  /**
   * Delete a clipboard item.
   */
  deleteItem(id: number): void {
    this.db.prepare('DELETE FROM clipboard_items WHERE id = ?').run(id);
  }

  /**
   * Clear all clipboard history.
   */
  clearAll(): void {
    this.db.exec('DELETE FROM clipboard_items');
    console.log('[ClipboardManager] Cleared all clipboard history');
  }

  /**
   * Capture screenshot and add to clipboard history.
   * When region=true, uses interactive selection (drag to select) like macOS Command+Shift+Control+4.
   */
  async captureScreenshot(region: boolean = false): Promise<number> {
    try {
      if (region) {
        // Interactive selection mode: drag to select area, saves directly to clipboard
        // This matches macOS Command+Shift+Control+4 behavior
        await execAsync('screencapture -i -c');
        
        // Small delay to ensure clipboard is updated
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Read from clipboard
        const image = clipboard.readImage();
        if (image.isEmpty()) {
          console.warn('[ClipboardManager] Screenshot capture cancelled or failed');
          return -1;
        }
        
        const imageBuffer = image.toPNG();
        
        // Store in history
        const id = await this.storeImage(image, imageBuffer, 'screenshot');
        return id;
      } else {
        // Full screen capture
        const tempPath = path.join(app.getPath('temp'), `screenshot-${Date.now()}.png`);
        await execAsync(`screencapture -s "${tempPath}"`);

        // Read the captured image
        const fs = await import('fs/promises');
        try {
          const imageBuffer = await fs.readFile(tempPath);
          const image = clipboard.readImage();
          
          // Store in history
          const id = await this.storeImage(image, imageBuffer, 'screenshot');
          
          // Clean up temp file
          await fs.unlink(tempPath);
          
          return id;
        } catch (error) {
          // Clean up temp file even on error
          try {
            await fs.unlink(tempPath);
          } catch {}
          throw error;
        }
      }
    } catch (error) {
      console.error('[ClipboardManager] Screenshot capture failed:', error);
      return -1;
    }
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
      historyHotkey: this.config.historyHotkey,
    };
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
   * Cleanup resources.
   */
  destroy(): void {
    this.stopPolling();
    
    if (this.screenshotHotkeyRegistered && this.config.screenshotHotkey) {
      globalShortcut.unregister(this.config.screenshotHotkey);
    }
    
    if (this.historyHotkeyRegistered && this.config.historyHotkey) {
      globalShortcut.unregister(this.config.historyHotkey);
    }

    this.db.close();
    console.log('[ClipboardManager] Destroyed');
  }
}

