import Database from 'better-sqlite3';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as chokidar from 'chokidar';
import { createLogger } from './logger';

const log = createLogger('TaggedDocs');

const MARKDOWN_EXTENSIONS = new Set(['.md']);
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export const TaggedDocsIPCChannels = {
  LIST: 'taggedDocs:list',
  MARK_READ: 'taggedDocs:markRead',
  MARK_ALL_READ: 'taggedDocs:markAllRead',
  RESCAN: 'taggedDocs:rescan',
  UPDATED: 'taggedDocs:updated',
  SCAN_PROGRESS: 'taggedDocs:scanProgress',
} as const;

export interface TaggedDoc {
  ulid: string;
  path: string;
  title: string;
  taggedBy: string | null;
  taggedAt: number | null;
  frontmatterUpdatedAt: number;
  fileHash: string;
  readAt: number | null;
  lastReadHash: string | null;
  unread: boolean;
}

export interface TaggedDocsScanProgress {
  phase: 'idle' | 'scanning' | 'done' | 'error';
  scanned: number;
  matched: number;
  roots: string[];
  currentPath?: string;
  error?: string;
}

type ParsedYamlValue =
  | string
  | number
  | boolean
  | null
  | ParsedYamlValue[]
  | { [key: string]: ParsedYamlValue };

type ParsedFrontmatter = Record<string, ParsedYamlValue>;

interface ParsedTaggedDoc {
  ulid: string;
  title: string;
  taggedBy: string | null;
  taggedAt: number | null;
  frontmatterUpdatedAt: number;
  fileHash: string;
  taggedForCurrentEmail: boolean;
}

interface TaggedDocRow {
  ulid: string;
  path: string;
  title: string;
  tagged_by: string | null;
  tagged_at: number | null;
  frontmatter_updated_at: number;
  file_hash: string;
  read_at: number | null;
  last_read_hash: string | null;
}

interface TaggedDocsManagerOptions {
  dbPath?: string;
  roots?: string[];
  homeDir?: string;
  watch?: boolean;
}

interface ProcessFileOptions {
  emitUpdated?: boolean;
  removeWhenUntagged?: boolean;
}

export function isMarkdownPath(filePath: string): boolean {
  return MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function normalizeEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim().toLowerCase();
  return trimmed || null;
}

function isCommonIgnoredDir(name: string): boolean {
  return name === '.git' ||
    name === 'node_modules' ||
    name === '.Trash' ||
    name === '.DS_Store';
}

function stripInlineComment(value: string): string {
  let quote: string | null = null;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if ((char === '"' || char === "'") && value[i - 1] !== '\\') {
      quote = quote === char ? null : quote ?? char;
      continue;
    }
    if (char === '#' && !quote && (i === 0 || /\s/.test(value[i - 1]))) {
      return value.slice(0, i).trimEnd();
    }
  }
  return value;
}

function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  let depth = 0;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if ((char === '"' || char === "'") && input[i - 1] !== '\\') {
      quote = quote === char ? null : quote ?? char;
      current += char;
      continue;
    }
    if (!quote) {
      if (char === '[' || char === '{') depth += 1;
      if (char === ']' || char === '}') depth -= 1;
      if (char === separator && depth === 0) {
        parts.push(current.trim());
        current = '';
        continue;
      }
    }
    current += char;
  }

  if (current.trim().length > 0) {
    parts.push(current.trim());
  }
  return parts;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineValue(rawValue: string): ParsedYamlValue {
  const value = stripInlineComment(rawValue).trim();
  if (value === '' || value === '~' || value.toLowerCase() === 'null') return null;
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;

  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner, ',').map(parseInlineValue);
  }

  if (value.startsWith('{') && value.endsWith('}')) {
    const inner = value.slice(1, -1).trim();
    const object: Record<string, ParsedYamlValue> = {};
    if (!inner) return object;

    for (const entry of splitTopLevel(inner, ',')) {
      const colonIndex = entry.indexOf(':');
      if (colonIndex <= 0) {
        throw new Error(`Invalid inline object entry: ${entry}`);
      }
      const key = entry.slice(0, colonIndex).trim();
      object[key] = parseInlineValue(entry.slice(colonIndex + 1));
    }
    return object;
  }

  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }

  return unquote(value);
}

function getIndent(line: string): number {
  const match = line.match(/^ */);
  return match ? match[0].length : 0;
}

function findTopLevelColon(line: string): number {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if ((char === '"' || char === "'") && line[i - 1] !== '\\') {
      quote = quote === char ? null : quote ?? char;
      continue;
    }
    if (char === ':' && !quote) {
      return i;
    }
  }
  return -1;
}

function parseYamlBlock(lines: string[], startIndex: number): { value: ParsedYamlValue; nextIndex: number } {
  const firstLine = lines[startIndex];
  const baseIndent = getIndent(firstLine);
  const firstTrimmed = firstLine.trim();

  if (firstTrimmed.startsWith('- ')) {
    const items: ParsedYamlValue[] = [];
    let index = startIndex;

    while (index < lines.length) {
      const line = lines[index];
      const trimmed = line.trim();
      if (!trimmed) {
        index += 1;
        continue;
      }
      const indent = getIndent(line);
      if (indent < baseIndent || (indent === 0 && !trimmed.startsWith('- '))) break;
      if (indent !== baseIndent || !trimmed.startsWith('- ')) {
        throw new Error(`Invalid array item indentation: ${line}`);
      }

      const itemText = trimmed.slice(2).trim();
      const colonIndex = findTopLevelColon(itemText);
      if (colonIndex > 0 && !itemText.startsWith('{')) {
        const object: Record<string, ParsedYamlValue> = {};
        const key = itemText.slice(0, colonIndex).trim();
        object[key] = parseInlineValue(itemText.slice(colonIndex + 1));
        index += 1;

        while (index < lines.length) {
          const nextLine = lines[index];
          const nextTrimmed = nextLine.trim();
          if (!nextTrimmed) {
            index += 1;
            continue;
          }
          const nextIndent = getIndent(nextLine);
          if (nextIndent <= baseIndent) break;
          const nextColon = findTopLevelColon(nextTrimmed);
          if (nextColon <= 0) {
            throw new Error(`Invalid object entry: ${nextLine}`);
          }
          object[nextTrimmed.slice(0, nextColon).trim()] = parseInlineValue(nextTrimmed.slice(nextColon + 1));
          index += 1;
        }
        items.push(object);
        continue;
      }

      items.push(parseInlineValue(itemText));
      index += 1;
    }

    return { value: items, nextIndex: index };
  }

  const object: Record<string, ParsedYamlValue> = {};
  let index = startIndex;
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }
    const indent = getIndent(line);
    if (indent < baseIndent || indent === 0) break;
    const colonIndex = findTopLevelColon(trimmed);
    if (colonIndex <= 0) {
      throw new Error(`Invalid object entry: ${line}`);
    }
    object[trimmed.slice(0, colonIndex).trim()] = parseInlineValue(trimmed.slice(colonIndex + 1));
    index += 1;
  }

  return { value: object, nextIndex: index };
}

export function parseFrontmatter(content: string): { data: ParsedFrontmatter; body: string } | null {
  if (!content.startsWith('---')) {
    return null;
  }

  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return null;
  }

  const endIndex = normalized.indexOf('\n---', 4);
  if (endIndex === -1) {
    throw new Error('Missing frontmatter closing delimiter');
  }

  const delimiterEnd = normalized.indexOf('\n', endIndex + 1);
  const frontmatter = normalized.slice(4, endIndex);
  const body = delimiterEnd === -1 ? '' : normalized.slice(delimiterEnd + 1);
  const lines = frontmatter.split('\n');
  const data: ParsedFrontmatter = {};

  let index = 0;
  while (index < lines.length) {
    const rawLine = lines[index];
    const line = stripInlineComment(rawLine).trimEnd();
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }
    if (getIndent(rawLine) !== 0) {
      throw new Error(`Unexpected indented top-level line: ${rawLine}`);
    }

    const colonIndex = findTopLevelColon(trimmed);
    if (colonIndex <= 0) {
      throw new Error(`Invalid frontmatter line: ${rawLine}`);
    }

    const key = trimmed.slice(0, colonIndex).trim();
    const rawValue = trimmed.slice(colonIndex + 1);
    if (rawValue.trim().length > 0) {
      data[key] = parseInlineValue(rawValue);
      index += 1;
      continue;
    }

    index += 1;
    while (index < lines.length && lines[index].trim().length === 0) {
      index += 1;
    }
    if (index >= lines.length || getIndent(lines[index]) === 0) {
      data[key] = null;
      continue;
    }
    const parsed = parseYamlBlock(lines, index);
    data[key] = parsed.value;
    index = parsed.nextIndex;
  }

  return { data, body };
}

function collectEmails(value: ParsedYamlValue | undefined, emails: Set<string>): void {
  if (value === undefined || value === null) return;

  if (typeof value === 'string') {
    for (const match of value.matchAll(EMAIL_PATTERN)) {
      const normalized = normalizeEmail(match[0]);
      if (normalized) emails.add(normalized);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectEmails(item, emails);
    }
    return;
  }

  if (typeof value === 'object') {
    for (const nested of Object.values(value)) {
      collectEmails(nested, emails);
    }
  }
}

function stringValue(value: ParsedYamlValue | undefined): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function taggedByValue(value: ParsedYamlValue | undefined): string | null {
  const direct = stringValue(value);
  if (direct) return direct;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const email = stringValue(value.email);
    if (email) return email;
    const name = stringValue(value.name) ?? stringValue(value.display_name);
    if (name) return name;
  }
  return null;
}

function parseDateMs(value: ParsedYamlValue | undefined): number | null {
  const raw = stringValue(value);
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function headingTitle(body: string): string | null {
  for (const line of body.split('\n')) {
    const match = line.match(/^#\s+(.+)$/);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

function titleFromPath(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

function rowToTaggedDoc(row: TaggedDocRow): TaggedDoc {
  return {
    ulid: row.ulid,
    path: row.path,
    title: row.title,
    taggedBy: row.tagged_by,
    taggedAt: row.tagged_at,
    frontmatterUpdatedAt: row.frontmatter_updated_at,
    fileHash: row.file_hash,
    readAt: row.read_at,
    lastReadHash: row.last_read_hash,
    unread: row.read_at === null || row.last_read_hash !== row.file_hash,
  };
}

export function discoverTaggedDocsSyncRoots(homeDir = os.homedir()): string[] {
  const candidates: string[] = [
    path.join(homeDir, 'Dropbox'),
    path.join(homeDir, 'Google Drive'),
  ];

  const cloudStorageDir = path.join(homeDir, 'Library', 'CloudStorage');
  if (fs.existsSync(cloudStorageDir)) {
    try {
      for (const entry of fs.readdirSync(cloudStorageDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          candidates.push(path.join(cloudStorageDir, entry.name));
        }
      }
    } catch (err) {
      log.warn('Failed to inspect CloudStorage roots:', err);
    }
  }

  const roots: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    try {
      const resolved = path.resolve(candidate);
      if (seen.has(resolved)) continue;
      if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) continue;
      roots.push(resolved);
      seen.add(resolved);
    } catch {
      // Ignore inaccessible sync roots.
    }
  }
  return roots;
}

export class TaggedDocsManager extends EventEmitter {
  private db: Database.Database | null = null;
  private dbPath: string | null = null;
  private roots: string[] = [];
  private watcher: chokidar.FSWatcher | null = null;
  private currentEmail: string | null = null;
  private rescanInProgress: Promise<TaggedDoc[]> | null = null;
  private watchEnabled: boolean;

  constructor(options: TaggedDocsManagerOptions = {}) {
    super();
    this.watchEnabled = options.watch ?? true;
    if (options.dbPath) {
      this.setDatabasePath(options.dbPath);
    }
    this.roots = options.roots ? this.normalizeRoots(options.roots) : discoverTaggedDocsSyncRoots(options.homeDir);
  }

  setDatabasePath(dbPath: string): void {
    if (this.dbPath === dbPath && this.db) return;

    this.db?.close();
    this.dbPath = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.initDatabase();
  }

  setRoots(roots: string[]): void {
    const normalized = this.normalizeRoots(roots);
    if (JSON.stringify(normalized) === JSON.stringify(this.roots)) return;
    this.roots = normalized;
    this.restartWatcher();
  }

  setIdentity(email: string | null | undefined): void {
    const nextEmail = normalizeEmail(email);
    if (nextEmail === this.currentEmail) return;
    this.currentEmail = nextEmail;

    if (!this.currentEmail) {
      this.stopWatcher();
      this.emit('updated', []);
      return;
    }

    this.restartWatcher();
    void this.rescan();
  }

  list(): TaggedDoc[] {
    if (!this.db || !this.currentEmail) return [];
    const rows = this.db
      .prepare(`
        SELECT ulid, path, title, tagged_by, tagged_at, frontmatter_updated_at, file_hash, read_at, last_read_hash
        FROM tagged_docs
        ORDER BY unread_sort DESC, frontmatter_updated_at DESC, title COLLATE NOCASE ASC
      `)
      .all() as TaggedDocRow[];
    return rows.map(rowToTaggedDoc);
  }

  async rescan(): Promise<TaggedDoc[]> {
    if (this.rescanInProgress) return this.rescanInProgress;

    this.rescanInProgress = this.performRescan()
      .finally(() => {
        this.rescanInProgress = null;
      });
    return this.rescanInProgress;
  }

  markRead(ulid: string): TaggedDoc | null {
    if (!this.db || !ULID_PATTERN.test(ulid)) return null;
    const row = this.db
      .prepare('SELECT file_hash FROM tagged_docs WHERE ulid = ?')
      .get(ulid) as { file_hash: string } | undefined;
    if (!row) return null;

    this.db
      .prepare('UPDATE tagged_docs SET read_at = ?, last_read_hash = ?, unread_sort = 0 WHERE ulid = ?')
      .run(Date.now(), row.file_hash, ulid);
    const updated = this.getByUlid(ulid);
    this.emitUpdated();
    return updated;
  }

  markAllRead(): TaggedDoc[] {
    if (!this.db) return [];
    this.db
      .prepare('UPDATE tagged_docs SET read_at = ?, last_read_hash = file_hash, unread_sort = 0')
      .run(Date.now());
    const docs = this.list();
    this.emit('updated', docs);
    return docs;
  }

  onUserLoggedOut(): void {
    this.currentEmail = null;
    this.stopWatcher();
    this.emit('updated', []);
  }

  destroy(): void {
    this.stopWatcher();
    this.db?.close();
    this.db = null;
    this.removeAllListeners();
  }

  async processMarkdownFile(filePath: string, options: ProcessFileOptions = {}): Promise<TaggedDoc | null> {
    if (!this.db || !this.currentEmail || !isMarkdownPath(filePath)) return null;

    let content: string;
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) return null;
      content = await fs.promises.readFile(filePath, 'utf-8');
    } catch (err) {
      log.warn('Failed to read tagged doc candidate:', filePath, err);
      return null;
    }

    const parsed = this.parseTaggedDoc(filePath, content, stat);
    if (!parsed) return null;

    if (!parsed.taggedForCurrentEmail) {
      if (options.removeWhenUntagged ?? true) {
        this.removePath(filePath, options.emitUpdated);
      }
      return null;
    }

    const existing = this.getRowByUlid(parsed.ulid);
    if (!existing) {
      this.db.prepare('DELETE FROM tagged_docs WHERE path = ?').run(filePath);
      this.db
        .prepare(`
          INSERT INTO tagged_docs (
            ulid, path, title, tagged_by, tagged_at, frontmatter_updated_at, file_hash, read_at, last_read_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)
        `)
        .run(
          parsed.ulid,
          filePath,
          parsed.title,
          parsed.taggedBy,
          parsed.taggedAt,
          parsed.frontmatterUpdatedAt,
          parsed.fileHash,
        );
      const inserted = this.getByUlid(parsed.ulid);
      if (options.emitUpdated) this.emitUpdated();
      return inserted;
    }

    const samePath = existing.path === filePath;
    const isNewer = parsed.frontmatterUpdatedAt > existing.frontmatter_updated_at;
    const sameTimestampPreferredPath = parsed.frontmatterUpdatedAt === existing.frontmatter_updated_at &&
      filePath.localeCompare(existing.path) < 0;

    if (samePath || isNewer || sameTimestampPreferredPath) {
      this.db
        .prepare(`
          UPDATE tagged_docs
          SET path = ?,
              title = ?,
              tagged_by = ?,
              tagged_at = ?,
              frontmatter_updated_at = ?,
              file_hash = ?,
              unread_sort = CASE WHEN read_at IS NULL OR last_read_hash != ? THEN 1 ELSE 0 END
          WHERE ulid = ?
        `)
        .run(
          filePath,
          parsed.title,
          parsed.taggedBy,
          parsed.taggedAt,
          parsed.frontmatterUpdatedAt,
          parsed.fileHash,
          parsed.fileHash,
          parsed.ulid,
        );
      const updated = this.getByUlid(parsed.ulid);
      if (options.emitUpdated) this.emitUpdated();
      return updated;
    }

    return rowToTaggedDoc(existing);
  }

  removePath(filePath: string, emitUpdated = true): void {
    if (!this.db) return;
    const result = this.db.prepare('DELETE FROM tagged_docs WHERE path = ?').run(filePath);
    if (result.changes > 0 && emitUpdated) {
      this.emitUpdated();
    }
  }

  private initDatabase(): void {
    if (!this.db) return;
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tagged_docs (
        ulid TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        title TEXT NOT NULL,
        tagged_by TEXT,
        tagged_at INTEGER,
        frontmatter_updated_at INTEGER NOT NULL,
        file_hash TEXT NOT NULL,
        read_at INTEGER,
        last_read_hash TEXT,
        unread_sort INTEGER NOT NULL DEFAULT 1
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_tagged_docs_path ON tagged_docs(path);
      CREATE INDEX IF NOT EXISTS idx_tagged_docs_unread_sort ON tagged_docs(unread_sort, frontmatter_updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tagged_docs_frontmatter_updated_at ON tagged_docs(frontmatter_updated_at DESC);
    `);
  }

  private normalizeRoots(roots: string[]): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const root of roots) {
      try {
        const resolved = path.resolve(root);
        if (seen.has(resolved)) continue;
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) continue;
        normalized.push(resolved);
        seen.add(resolved);
      } catch {
        // Skip inaccessible roots.
      }
    }
    return normalized;
  }

  private async performRescan(): Promise<TaggedDoc[]> {
    if (!this.db || !this.currentEmail) return [];

    let scanned = 0;
    let matched = 0;
    this.emitScanProgress({ phase: 'scanning', scanned, matched, roots: this.roots });

    try {
      for (const root of this.roots) {
        for await (const filePath of this.walkMarkdownFiles(root)) {
          scanned += 1;
          const doc = await this.processMarkdownFile(filePath, { emitUpdated: false, removeWhenUntagged: true });
          if (doc) matched += 1;
          if (scanned % 25 === 0) {
            this.emitScanProgress({ phase: 'scanning', scanned, matched, roots: this.roots, currentPath: filePath });
          }
        }
      }

      const docs = this.list();
      this.emitScanProgress({ phase: 'done', scanned, matched, roots: this.roots });
      this.emit('updated', docs);
      return docs;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emitScanProgress({ phase: 'error', scanned, matched, roots: this.roots, error: message });
      log.error('Tagged docs rescan failed:', err);
      return this.list();
    }
  }

  private async *walkMarkdownFiles(root: string): AsyncGenerator<string> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(root, { withFileTypes: true });
    } catch (err) {
      log.warn('Failed to read tagged docs root:', root, err);
      return;
    }

    for (const entry of entries) {
      const entryPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        if (isCommonIgnoredDir(entry.name)) continue;
        yield* this.walkMarkdownFiles(entryPath);
        continue;
      }
      if (entry.isFile() && isMarkdownPath(entryPath)) {
        yield entryPath;
      }
    }
  }

  private restartWatcher(): void {
    this.stopWatcher();
    if (!this.watchEnabled || !this.currentEmail || this.roots.length === 0) return;

    this.watcher = chokidar.watch(this.roots, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      ignorePermissionErrors: true,
      ignored: (candidatePath: string) => {
        return candidatePath.split(path.sep).some(isCommonIgnoredDir);
      },
    });

    this.watcher.on('add', (filePath) => {
      if (isMarkdownPath(filePath)) {
        void this.processMarkdownFile(filePath, { emitUpdated: true, removeWhenUntagged: true });
      }
    });
    this.watcher.on('change', (filePath) => {
      if (isMarkdownPath(filePath)) {
        void this.processMarkdownFile(filePath, { emitUpdated: true, removeWhenUntagged: true });
      }
    });
    this.watcher.on('unlink', (filePath) => {
      if (isMarkdownPath(filePath)) {
        this.removePath(filePath);
      }
    });
    this.watcher.on('error', (err) => log.error('Tagged docs watcher error:', err));
  }

  private stopWatcher(): void {
    this.watcher?.close();
    this.watcher = null;
  }

  private parseTaggedDoc(filePath: string, content: string, stat: fs.Stats): ParsedTaggedDoc | null {
    let frontmatter: { data: ParsedFrontmatter; body: string } | null;
    try {
      frontmatter = parseFrontmatter(content);
    } catch (err) {
      log.warn('Skipping malformed tagged doc frontmatter:', filePath, err);
      return null;
    }
    if (!frontmatter) return null;

    const ulid = stringValue(frontmatter.data.id) ?? stringValue(frontmatter.data.ulid);
    if (!ulid || !ULID_PATTERN.test(ulid)) {
      return null;
    }

    const title = stringValue(frontmatter.data.title) ?? headingTitle(frontmatter.body) ?? titleFromPath(filePath);
    const taggedAt = parseDateMs(frontmatter.data.created_at) ?? parseDateMs(frontmatter.data.tagged_at);
    const frontmatterUpdatedAt =
      parseDateMs(frontmatter.data.updated_at) ??
      parseDateMs(frontmatter.data.frontmatter_updated_at) ??
      taggedAt ??
      Math.floor(stat.mtimeMs);
    const taggedEmails = new Set<string>();
    collectEmails(frontmatter.data.to, taggedEmails);
    collectEmails(frontmatter.data.cc, taggedEmails);

    return {
      ulid: ulid.toUpperCase(),
      title,
      taggedBy: taggedByValue(frontmatter.data.from) ?? taggedByValue(frontmatter.data.tagged_by),
      taggedAt,
      frontmatterUpdatedAt,
      fileHash: crypto.createHash('sha256').update(content).digest('hex'),
      taggedForCurrentEmail: this.currentEmail !== null && taggedEmails.has(this.currentEmail),
    };
  }

  private getRowByUlid(ulid: string): TaggedDocRow | null {
    if (!this.db) return null;
    return (this.db
      .prepare(`
        SELECT ulid, path, title, tagged_by, tagged_at, frontmatter_updated_at, file_hash, read_at, last_read_hash
        FROM tagged_docs
        WHERE ulid = ?
      `)
      .get(ulid.toUpperCase()) as TaggedDocRow | undefined) ?? null;
  }

  private getByUlid(ulid: string): TaggedDoc | null {
    const row = this.getRowByUlid(ulid);
    return row ? rowToTaggedDoc(row) : null;
  }

  private emitUpdated(): void {
    this.emit('updated', this.list());
  }

  private emitScanProgress(progress: TaggedDocsScanProgress): void {
    this.emit('scanProgress', progress);
  }
}
