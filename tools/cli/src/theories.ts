import { AgentMailClient } from 'agentmail';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { openDb, saveDb } from './db.js';
import { loadEnv } from './config.js';
import { ensureDir, pathExists, readJson } from './fs.js';
import { theoryIndexPath, theoryMailCacheDir } from './paths.js';
import { resolveRepoReference } from './repo-resolution.js';

const THEORY_SCHEMA_VERSION = 3;
const THEORY_CACHE_TTL_MS = 5 * 60 * 1000;
const THEORY_SELECT_COLUMNS = `
        id,
        kind,
        numeric_id,
        display_id,
        date,
        created_at_ms,
        title,
        value_dollars,
        section_title,
        bookmarks_label,
        what_we_found,
        what_to_do,
        confidence,
        digest_path,
        transcript_path,
        transcript_type,
        transcript_repo_name,
        transcript_repo_path,
        transcript_repo_github,
        bookmark_urls_json,
        sort_order,
        model_signature,
        source_message_id,
        source_subject,
        source_created_at
`;

export interface TheoryTranscriptMeta {
  type?: string | null;
  repoName?: string | null;
  repoPath?: string | null;
  githubRepo?: string | null;
  bookmarkUrls: string[];
}

export interface TheoryItem {
  id: string;
  kind: 'ft' | 'legacy';
  numericId: number;
  displayId: string;
  date: string;
  createdAtMs: number;
  title: string;
  valueDollars?: number | null;
  sectionTitle?: string | null;
  bookmarksLabel?: string | null;
  whatWeFound: string;
  whatToDo: string;
  confidence?: string | null;
  digestPath: string;
  transcriptPath?: string | null;
  transcriptMeta: TheoryTranscriptMeta;
  sortOrder: number;
  modelSignature?: string | null;
  sourceMessageId?: string | null;
  sourceSubject?: string | null;
  sourceCreatedAt?: string | null;
}

export interface TheoryListFilters {
  query?: string;
  repo?: string;
  confidence?: string;
  type?: string;
  sort?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface TheoryStateFile {
  next_id?: number;
}

export interface TheorySyncResult {
  dbPath: string;
  findingCount: number;
  newMessages: number;
  addedFindings: number;
  newestMessageId?: string;
  stopReason: string;
  syncedAt: string;
}

interface TheoryInsertableItem extends TheoryItem {
  sourceMessageId: string | null;
  sourceSubject: string | null;
  sourceCreatedAt: string | null;
}

interface TheoryEmailConfig {
  apiKey: string;
  domain: string;
  inboxId: string;
}

interface TheoryEmailHeader {
  messageId: string;
  subject: string;
  createdAt: string;
}

interface EmailSectionMeta {
  type: string | null;
  repoName: string | null;
}

interface ParseTheoryBlockOptions {
  id: string;
  kind: 'ft' | 'legacy';
  displayId: string;
  numericId: number;
  date: string;
  createdAtMs: number;
  digestPath: string;
  transcriptPath?: string | null;
  transcriptMeta: TheoryTranscriptMeta;
  sectionTitle?: string | null;
  block: string;
  valueDollars?: number | null;
  sortOrder: number;
  modelSignature?: string | null;
  sourceMessageId?: string | null;
  sourceSubject?: string | null;
  sourceCreatedAt?: string | null;
}

let theorySyncPromise: Promise<TheorySyncResult> | undefined;
let theoryCacheFreshUntil = 0;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function normalizeMarkdown(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

function formatLocalDate(value: number): string {
  const date = new Date(value);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function parseMessageBody(message: Record<string, unknown>): string {
  return normalizeMarkdown(String(
    message.text ??
    message.extractedText ??
    message.extractedHtml ??
    message.html ??
    message.preview ??
    ''
  ));
}

function parseTheorySubject(subject: string): { repoName: string | null } {
  const match = subject.match(/^Theories\s+\(([^)]+)\)/i);
  return { repoName: match?.[1]?.trim() ?? null };
}

function cleanSectionTitle(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace(/^[^\p{L}\p{N}]+/u, '').trim() || null;
}

function parseEmailSectionMeta(sectionTitle: string | null, subjectRepoName: string | null): EmailSectionMeta {
  const cleaned = cleanSectionTitle(sectionTitle);
  if (!cleaned) {
    return {
      type: null,
      repoName: subjectRepoName,
    };
  }

  const [typePart, repoPart] = cleaned.split(/\s+—\s+/, 2);
  return {
    type: typePart?.trim() || null,
    repoName: repoPart?.trim() || subjectRepoName || null,
  };
}

function extractUrls(value: string): string[] {
  const matches = value.match(/https?:\/\/[^\s)>]+/g) ?? [];
  return [...new Set(matches.map((entry) => entry.replace(/[),.;]+$/, '')))];
}

function normalizeTheoryDate(raw: string, fallbackMs: number): string {
  const match = raw.match(/^#\s+Theories\s+—\s+(\d{4}-\d{2}-\d{2})$/m);
  return match?.[1] ?? formatLocalDate(fallbackMs);
}

function extractField(block: string, label: string, nextLabels: string[]): string {
  const lookahead = nextLabels.length
    ? `(?=\\n\\n?(?:${nextLabels.map((entry) => escapeRegExp(entry)).join('|')})|$)`
    : '$';
  const pattern = new RegExp(`^${escapeRegExp(label)}\\s*([\\s\\S]*?)${lookahead}`, 'm');
  return block.match(pattern)?.[1]?.trim() ?? '';
}

function parseTranscriptTimestamp(transcriptPath: string | null | undefined, fallbackDate: string): number {
  const fromTranscript = transcriptPath
    ? path.basename(transcriptPath).match(/^(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})(\d{2})_/)
    : null;

  if (fromTranscript) {
    const [, datePart, hh, mm, ss] = fromTranscript;
    return Date.parse(`${datePart}T${hh}:${mm}:${ss}Z`);
  }

  return Date.parse(`${fallbackDate}T00:00:00Z`);
}

function emailCachePath(messageId: string, createdAt: string, cwd = process.cwd()): string {
  const stamp = (createdAt || new Date().toISOString()).slice(0, 10);
  const hash = createHash('sha1').update(messageId).digest('hex').slice(0, 16);
  return path.join(theoryMailCacheDir(cwd), `${stamp}-${hash}.md`);
}

function parseTheoryBlock(options: ParseTheoryBlockOptions): TheoryInsertableItem {
  const titleMatch = options.block.match(/^\*\*(.+?)\*\*/m);
  const confidenceMatch = options.block.match(/^CONFIDENCE:\s*(.+)$/m);
  const bookmarkUrls = extractUrls(options.block).filter((url) => /^https?:\/\//.test(url));

  return {
    id: options.id,
    kind: options.kind,
    numericId: options.numericId,
    displayId: options.displayId,
    date: options.date,
    createdAtMs: options.createdAtMs,
    title: titleMatch?.[1]?.trim() ?? options.id,
    valueDollars: options.valueDollars ?? null,
    sectionTitle: options.sectionTitle ?? null,
    bookmarksLabel: extractField(options.block, 'BOOKMARKS:', ['WHAT WE FOUND:']) || null,
    whatWeFound: extractField(options.block, 'WHAT WE FOUND:', ['WHAT TO DO:']),
    whatToDo: extractField(options.block, 'WHAT TO DO:', ['CONFIDENCE:']),
    confidence: confidenceMatch?.[1]?.trim() ?? null,
    digestPath: options.digestPath,
    transcriptPath: options.transcriptPath ?? null,
    transcriptMeta: {
      ...options.transcriptMeta,
      bookmarkUrls: options.transcriptMeta.bookmarkUrls.length
        ? options.transcriptMeta.bookmarkUrls
        : bookmarkUrls,
    },
    sortOrder: options.sortOrder,
    modelSignature: options.modelSignature ?? null,
    sourceMessageId: options.sourceMessageId ?? null,
    sourceSubject: options.sourceSubject ?? null,
    sourceCreatedAt: options.sourceCreatedAt ?? null,
  };
}

function lastSectionTitle(
  headings: Array<{ index: number; title: string }>,
  index: number
): string | null {
  return headings
    .filter((heading) => heading.index < index)
    .at(-1)?.title ?? null;
}

function parseTranscriptMeta(raw: string): TheoryTranscriptMeta {
  const typeMatch = raw.match(/^\*\*Type\*\*:\s*(.+)$/m);
  const repoMatch = raw.match(/^\*\*Repo\*\*:\s*(.+?)\s+\((.+)\)$/m);
  const bookmarksMatch = raw.match(/^\*\*Bookmarks\*\*:\s*([\s\S]*?)\n\n---/m);
  const bookmarkUrls = (bookmarksMatch?.[1] ?? '')
    .split('\n')
    .map((line) => line.trim())
    .flatMap((line) => line ? line.split(/\s+/) : [])
    .filter((entry) => entry.startsWith('http'));

  return {
    type: typeMatch?.[1]?.trim() ?? null,
    repoName: repoMatch?.[1]?.trim() ?? null,
    repoPath: repoMatch?.[2]?.trim() ?? null,
    bookmarkUrls,
  };
}

async function loadTranscriptMeta(transcriptPath?: string | null): Promise<TheoryTranscriptMeta> {
  if (!transcriptPath || !(await pathExists(transcriptPath))) {
    return { bookmarkUrls: [] };
  }
  const raw = await readFile(transcriptPath, 'utf8');
  const parsed = parseTranscriptMeta(raw);
  const resolved = await resolveRepoReference({
    repoName: parsed.repoName,
    repoPath: parsed.repoPath,
  });
  return {
    ...parsed,
    repoName: resolved.repoName,
    repoPath: resolved.repoPath,
    githubRepo: resolved.githubRepo,
  };
}

async function parseTheoryDigest(filePath: string): Promise<TheoryInsertableItem[]> {
  const raw = await readFile(filePath, 'utf8');
  const date = normalizeTheoryDate(raw, Date.now());
  const transcriptPath = raw.match(/\*Full session:\s+(.+?)\*/)?.[1]?.trim() ?? null;
  const transcriptMeta = await loadTranscriptMeta(transcriptPath);
  const baseCreatedAtMs = parseTranscriptTimestamp(transcriptPath, date);
  const sectionHeadings = [...raw.matchAll(/^##\s+(.+)$/gm)].map((match) => ({
    index: match.index ?? 0,
    title: match[1].trim(),
  }));
  const findings = [...raw.matchAll(/^###\s+(FT-\d+)\s+—\s+\$([0-9]+)\s*\n([\s\S]*?)(?=^---\s*$|^\*Full session:|\Z)/gm)];

  if (findings.length > 0) {
    return findings.map((match) => {
      const id = normalizeTheoryId(match[1]);
      const numericId = Number(id.replace(/^FT-/, ''));
      return parseTheoryBlock({
        id,
        kind: 'ft',
        displayId: formatTheoryId(numericId),
        numericId,
        date,
        createdAtMs: baseCreatedAtMs + numericId,
        digestPath: filePath,
        transcriptPath,
        transcriptMeta,
        sectionTitle: lastSectionTitle(sectionHeadings, match.index ?? 0),
        block: match[3].trim(),
        valueDollars: Number(match[2]),
        sortOrder: numericId,
      });
    });
  }

  const legacyBlocks = [...raw.matchAll(/^\*\*(.+?)\*\*\n\nBOOKMARKS:\s*[\s\S]*?(?=^---\s*$|^\*Full session:|\Z)/gm)];
  return legacyBlocks.map((match, index) => {
    const order = index + 1;
    return parseTheoryBlock({
      id: `LEGACY-${date.replace(/-/g, '')}-${String(order).padStart(2, '0')}`,
      kind: 'legacy',
      displayId: `L-${String(order).padStart(2, '0')}`,
      numericId: 0,
      date,
      createdAtMs: baseCreatedAtMs + order,
      digestPath: filePath,
      transcriptPath,
      transcriptMeta,
      sectionTitle: lastSectionTitle(sectionHeadings, match.index ?? 0),
      block: match[0].trim(),
      sortOrder: order,
    });
  });
}

async function parseTheoryEmailMessage(
  raw: string,
  header: TheoryEmailHeader,
  cachePath: string,
): Promise<TheoryInsertableItem[]> {
  const createdAtMs = Date.parse(header.createdAt || new Date().toISOString());
  const date = normalizeTheoryDate(raw, createdAtMs);
  const subjectMeta = parseTheorySubject(header.subject);
  const sectionHeadings = [...raw.matchAll(/^##\s+(.+)$/gm)].map((match) => ({
    index: match.index ?? 0,
    title: match[1].trim(),
  }));
  const findings = [...raw.matchAll(/^###\s+(FT-\d+)\s+—\s+\$([0-9]+)\s*$/gm)];

  const items: TheoryInsertableItem[] = [];
  for (let index = 0; index < findings.length; index += 1) {
    const match = findings[index];
    const nextFindingIndex = findings[index + 1]?.index ?? raw.length;
    const nextSectionIndex = sectionHeadings.find((heading) => heading.index > (match.index ?? 0))?.index ?? raw.length;
    const nextIndex = Math.min(nextFindingIndex, nextSectionIndex);
    const blockStart = (match.index ?? 0) + match[0].length;
    const block = raw
      .slice(blockStart, nextIndex)
      .replace(/^\s+/, '')
      .replace(/\n---\s*$/m, '')
      .trim();
    const normalizedId = normalizeTheoryId(match[1]);
    const numericId = Number(normalizedId.replace(/^FT-/, ''));
    const sectionTitle = lastSectionTitle(sectionHeadings, match.index ?? 0);
    const sectionMeta = parseEmailSectionMeta(sectionTitle, subjectMeta.repoName);
    const resolvedRepo = await resolveRepoReference({
      repoName: sectionMeta.repoName,
      text: block,
    });

    items.push(parseTheoryBlock({
      id: normalizedId,
      kind: 'ft',
      displayId: formatTheoryId(numericId),
      numericId,
      date,
      createdAtMs: createdAtMs + numericId,
      digestPath: cachePath,
      transcriptPath: null,
      transcriptMeta: {
        bookmarkUrls: [],
        repoName: resolvedRepo.repoName,
        repoPath: resolvedRepo.repoPath,
        githubRepo: resolvedRepo.githubRepo,
        type: sectionMeta.type,
      },
      sectionTitle,
      block,
      valueDollars: Number(match[2]),
      sortOrder: numericId,
      sourceMessageId: header.messageId,
      sourceSubject: header.subject,
      sourceCreatedAt: header.createdAt,
    }));
  }

  return items;
}

export async function parseTheoryEmailMarkdownForTest(
  raw: string,
  header: TheoryEmailHeader,
  cachePath: string,
): Promise<TheoryItem[]> {
  return parseTheoryEmailMessage(raw, header, cachePath);
}

function initTheorySchema(db: Awaited<ReturnType<typeof openDb>>): void {
  db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS theories (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    numeric_id INTEGER NOT NULL,
    display_id TEXT NOT NULL,
    date TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    title TEXT NOT NULL,
    value_dollars INTEGER,
    section_title TEXT,
    bookmarks_label TEXT,
    what_we_found TEXT NOT NULL,
    what_to_do TEXT NOT NULL,
    confidence TEXT,
    digest_path TEXT NOT NULL,
    transcript_path TEXT,
    transcript_type TEXT,
    transcript_repo_name TEXT,
    transcript_repo_path TEXT,
    transcript_repo_github TEXT,
    bookmark_urls_json TEXT,
    sort_order INTEGER NOT NULL,
    model_signature TEXT,
    source_message_id TEXT,
    source_subject TEXT,
    source_created_at TEXT
  )`);
  try {
    db.run(`ALTER TABLE theories ADD COLUMN transcript_repo_github TEXT`);
  } catch {
    // Existing databases already on the latest schema will reject the duplicate column.
  }
  db.run(`CREATE INDEX IF NOT EXISTS idx_theories_created_at ON theories(created_at_ms DESC, numeric_id DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_theories_display_id ON theories(display_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_theories_repo ON theories(transcript_repo_name)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_theories_confidence ON theories(confidence)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_theories_source_message ON theories(source_message_id)`);
  db.run(`INSERT OR IGNORE INTO meta VALUES ('schema_version', '${THEORY_SCHEMA_VERSION}')`);
}

function readMetaValue(db: Awaited<ReturnType<typeof openDb>>, key: string): string | null {
  const rows = db.exec(`SELECT value FROM meta WHERE key = ? LIMIT 1`, [key]);
  return String(rows[0]?.values?.[0]?.[0] ?? '') || null;
}

function writeMetaValue(db: Awaited<ReturnType<typeof openDb>>, key: string, value: string): void {
  db.run(`REPLACE INTO meta(key, value) VALUES (?, ?)`, [key, value]);
}

async function backfillTheoryRepoMetadata(
  db: Awaited<ReturnType<typeof openDb>>,
): Promise<number> {
  const rows = db.exec(`
    SELECT
      id,
      transcript_repo_name,
      transcript_repo_path,
      transcript_repo_github,
      what_we_found,
      what_to_do,
      source_subject
    FROM theories
    WHERE
      COALESCE(transcript_repo_github, '') = ''
      OR COALESCE(transcript_repo_path, '') = ''
  `);

  let updated = 0;
  for (const row of rows[0]?.values ?? []) {
    const id = String(row[0] ?? '');
    if (!id) continue;

    const repoName = (row[1] as string) ?? null;
    const repoPath = (row[2] as string) ?? null;
    const githubRepo = (row[3] as string) ?? null;
    const context = [
      (row[4] as string) ?? '',
      (row[5] as string) ?? '',
      (row[6] as string) ?? '',
    ].filter(Boolean).join('\n\n');

    const resolved = await resolveRepoReference({
      repoName,
      repoPath,
      text: context,
    });

    const nextRepoName = resolved.repoName ?? repoName ?? null;
    const nextRepoPath = resolved.repoPath ?? repoPath ?? null;
    const nextGitHubRepo = resolved.githubRepo ?? githubRepo ?? null;
    if (
      nextRepoName === repoName
      && nextRepoPath === repoPath
      && nextGitHubRepo === githubRepo
    ) {
      continue;
    }

    db.run(
      `UPDATE theories
       SET transcript_repo_name = ?, transcript_repo_path = ?, transcript_repo_github = ?
       WHERE id = ?`,
      [nextRepoName, nextRepoPath, nextGitHubRepo, id],
    );
    updated += 1;
  }

  return updated;
}

export async function backfillTheoryRepoMetadataInPlace(cwd = process.cwd()): Promise<number> {
  const dbPath = theoryIndexPath(cwd);
  if (!(await pathExists(dbPath))) return 0;

  const db = await openDb(dbPath);
  try {
    initTheorySchema(db);
    const updated = await backfillTheoryRepoMetadata(db);
    writeMetaValue(db, 'schema_version', String(THEORY_SCHEMA_VERSION));
    saveDb(db, dbPath);
    return updated;
  } finally {
    db.close();
  }
}

function insertTheoryItem(db: Awaited<ReturnType<typeof openDb>>, item: TheoryInsertableItem): void {
  db.run(
    `INSERT OR REPLACE INTO theories (
      id,
      kind,
      numeric_id,
      display_id,
      date,
      created_at_ms,
      title,
      value_dollars,
      section_title,
      bookmarks_label,
      what_we_found,
      what_to_do,
      confidence,
      digest_path,
      transcript_path,
      transcript_type,
      transcript_repo_name,
      transcript_repo_path,
      transcript_repo_github,
      bookmark_urls_json,
      sort_order,
      model_signature,
      source_message_id,
      source_subject,
      source_created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      item.id,
      item.kind,
      item.numericId,
      item.displayId,
      item.date,
      item.createdAtMs,
      item.title,
      item.valueDollars ?? null,
      item.sectionTitle ?? null,
      item.bookmarksLabel ?? null,
      item.whatWeFound,
      item.whatToDo,
      item.confidence ?? null,
      item.digestPath,
      item.transcriptPath ?? null,
      item.transcriptMeta.type ?? null,
      item.transcriptMeta.repoName ?? null,
      item.transcriptMeta.repoPath ?? null,
      item.transcriptMeta.githubRepo ?? null,
      item.transcriptMeta.bookmarkUrls.length ? JSON.stringify(item.transcriptMeta.bookmarkUrls) : null,
      item.sortOrder,
      item.modelSignature ?? null,
      item.sourceMessageId ?? null,
      item.sourceSubject ?? null,
      item.sourceCreatedAt ?? null,
    ],
  );
}

function mapTheoryRow(row: unknown[]): TheoryItem {
  return {
    id: String(row[0]),
    kind: String(row[1]) === 'legacy' ? 'legacy' : 'ft',
    numericId: Number(row[2] ?? 0),
    displayId: String(row[3] ?? ''),
    date: String(row[4] ?? ''),
    createdAtMs: Number(row[5] ?? 0),
    title: String(row[6] ?? ''),
    valueDollars: row[7] == null ? null : Number(row[7]),
    sectionTitle: (row[8] as string) ?? null,
    bookmarksLabel: (row[9] as string) ?? null,
    whatWeFound: String(row[10] ?? ''),
    whatToDo: String(row[11] ?? ''),
    confidence: (row[12] as string) ?? null,
    digestPath: String(row[13] ?? ''),
    transcriptPath: (row[14] as string) ?? null,
    transcriptMeta: {
      type: (row[15] as string) ?? null,
      repoName: (row[16] as string) ?? null,
      repoPath: (row[17] as string) ?? null,
      githubRepo: (row[18] as string) ?? null,
      bookmarkUrls: parseJsonArray(row[19]),
    },
    sortOrder: Number(row[20] ?? 0),
    modelSignature: (row[21] as string) ?? null,
    sourceMessageId: (row[22] as string) ?? null,
    sourceSubject: (row[23] as string) ?? null,
    sourceCreatedAt: (row[24] as string) ?? null,
  };
}

function buildTheoryWhereClause(filters: TheoryListFilters): {
  where: string;
  params: Array<string | number>;
} {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (filters.repo) {
    const needle = `%${filters.repo}%`;
    conditions.push(`(
      COALESCE(transcript_repo_name, '') LIKE ? COLLATE NOCASE
      OR COALESCE(transcript_repo_path, '') LIKE ? COLLATE NOCASE
      OR COALESCE(transcript_repo_github, '') LIKE ? COLLATE NOCASE
      OR COALESCE(section_title, '') LIKE ? COLLATE NOCASE
    )`);
    params.push(needle, needle, needle, needle);
  }

  if (filters.confidence) {
    conditions.push(`COALESCE(confidence, '') = ? COLLATE NOCASE`);
    params.push(filters.confidence);
  }

  if (filters.type) {
    conditions.push(`COALESCE(transcript_type, '') = ? COLLATE NOCASE`);
    params.push(filters.type);
  }

  if (filters.query) {
    const needle = `%${filters.query}%`;
    conditions.push(`(
      id LIKE ? COLLATE NOCASE
      OR display_id LIKE ? COLLATE NOCASE
      OR title LIKE ? COLLATE NOCASE
      OR COALESCE(section_title, '') LIKE ? COLLATE NOCASE
      OR COALESCE(bookmarks_label, '') LIKE ? COLLATE NOCASE
      OR what_we_found LIKE ? COLLATE NOCASE
      OR what_to_do LIKE ? COLLATE NOCASE
      OR COALESCE(transcript_repo_name, '') LIKE ? COLLATE NOCASE
      OR COALESCE(transcript_repo_path, '') LIKE ? COLLATE NOCASE
      OR COALESCE(transcript_repo_github, '') LIKE ? COLLATE NOCASE
      OR COALESCE(source_subject, '') LIKE ? COLLATE NOCASE
    )`);
    params.push(needle, needle, needle, needle, needle, needle, needle, needle, needle, needle, needle);
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

function theorySortClause(direction: 'asc' | 'desc' = 'desc'): string {
  const normalized = direction === 'asc' ? 'ASC' : 'DESC';
  return `ORDER BY created_at_ms ${normalized}, numeric_id ${normalized}`;
}

async function indexedTheoryCount(cwd = process.cwd()): Promise<number> {
  const dbPath = theoryIndexPath(cwd);
  if (!(await pathExists(dbPath))) return 0;
  const db = await openDb(dbPath);
  try {
    initTheorySchema(db);
    const rows = db.exec(`SELECT COUNT(*) FROM theories`);
    return Number(rows[0]?.values?.[0]?.[0] ?? 0);
  } finally {
    db.close();
  }
}

async function listIndexedTheoryItems(
  filters: TheoryListFilters = {},
  cwd = process.cwd(),
): Promise<TheoryItem[]> {
  const dbPath = theoryIndexPath(cwd);
  if (!(await pathExists(dbPath))) return [];
  const db = await openDb(dbPath);
  try {
    initTheorySchema(db);
    const limit = filters.limit ?? 30;
    const offset = filters.offset ?? 0;
    const { where, params } = buildTheoryWhereClause(filters);
    const sql = `
      SELECT
      ${THEORY_SELECT_COLUMNS}
      FROM theories
      ${where}
      ${theorySortClause(filters.sort)}
      LIMIT ?
      OFFSET ?
    `;
    params.push(limit, offset);
    const rows = db.exec(sql, params);
    return (rows[0]?.values ?? []).map((row) => mapTheoryRow(row));
  } finally {
    db.close();
  }
}

async function countIndexedTheoryItems(
  filters: TheoryListFilters = {},
  cwd = process.cwd(),
): Promise<number> {
  const dbPath = theoryIndexPath(cwd);
  if (!(await pathExists(dbPath))) return 0;
  const db = await openDb(dbPath);
  try {
    initTheorySchema(db);
    const { where, params } = buildTheoryWhereClause(filters);
    const rows = db.exec(`SELECT COUNT(*) FROM theories ${where}`, params);
    return Number(rows[0]?.values?.[0]?.[0] ?? 0);
  } finally {
    db.close();
  }
}

async function getIndexedTheoryItem(theoryId: string, cwd = process.cwd()): Promise<TheoryItem | null> {
  const dbPath = theoryIndexPath(cwd);
  if (!(await pathExists(dbPath))) return null;
  const db = await openDb(dbPath);
  try {
    initTheorySchema(db);
    const normalized = normalizeTheoryId(theoryId);
    const formatted = formatTheoryId(normalized);
    const rows = db.exec(
      `SELECT
      ${THEORY_SELECT_COLUMNS}
      FROM theories
      WHERE id = ? OR display_id = ?
      LIMIT 1`,
      [normalized, formatted],
    );
    const row = rows[0]?.values?.[0];
    return row ? mapTheoryRow(row) : null;
  } finally {
    db.close();
  }
}

async function loadAllDigestTheoryItems(rootDir = defaultTheoriesRoot()): Promise<TheoryInsertableItem[]> {
  const digestsDir = theoriesDigestsDir(rootDir);
  const digestEntries = (await pathExists(digestsDir))
    ? (await readdir(digestsDir))
        .filter((name) => /^\d{4}-\d{2}-\d{2}-theories\.md$/.test(name))
        .sort()
        .reverse()
    : [];

  return (await Promise.all(
    digestEntries.map((name) => parseTheoryDigest(path.join(digestsDir, name)))
  )).flat();
}

function theoryMatchesFilters(item: TheoryItem, filters: TheoryListFilters): boolean {
  if (filters.repo) {
    const needle = filters.repo.toLowerCase();
    const haystacks = [
      item.transcriptMeta.repoName ?? '',
      item.transcriptMeta.repoPath ?? '',
      item.transcriptMeta.githubRepo ?? '',
      item.sectionTitle ?? '',
    ].map((entry) => entry.toLowerCase());
    if (!haystacks.some((entry) => entry.includes(needle))) return false;
  }

  if (filters.confidence && (item.confidence ?? '').toLowerCase() !== filters.confidence.toLowerCase()) {
    return false;
  }

  if (filters.type && (item.transcriptMeta.type ?? '').toLowerCase() !== filters.type.toLowerCase()) {
    return false;
  }

  if (filters.query) {
    const query = filters.query.toLowerCase();
    const haystack = [
      item.id,
      item.displayId,
      item.title,
      item.whatWeFound,
      item.whatToDo,
      item.bookmarksLabel ?? '',
      item.sectionTitle ?? '',
      item.transcriptMeta.repoName ?? '',
      item.transcriptMeta.repoPath ?? '',
      item.transcriptMeta.githubRepo ?? '',
      item.modelSignature ?? '',
      item.sourceSubject ?? '',
    ].join('\n').toLowerCase();
    if (!haystack.includes(query)) return false;
  }

  return true;
}

function sortTheoryItems(items: TheoryItem[], direction: 'asc' | 'desc' = 'desc'): TheoryItem[] {
  const factor = direction === 'asc' ? 1 : -1;
  return items.slice().sort((a, b) => {
    if (a.createdAtMs !== b.createdAtMs) {
      return (a.createdAtMs - b.createdAtMs) * factor;
    }
    if (a.date !== b.date) {
      return a.date.localeCompare(b.date) * factor;
    }
    return (a.sortOrder - b.sortOrder) * factor;
  });
}

function shouldUseEmailIndex(rootDir: string): boolean {
  return path.resolve(rootDir) === path.resolve(defaultTheoriesRoot());
}

function loadTheoryEmailConfig(cwd = process.cwd()): TheoryEmailConfig | null {
  loadEnv(cwd);
  const apiKey = process.env.AGENTMAIL_API_KEY ?? process.env.EMAIL_DEBATE_AGENTMAIL_API_KEY;
  if (!apiKey) return null;
  const domain = process.env.AGENTMAIL_DOMAIN ?? process.env.EMAIL_DEBATE_AGENTMAIL_DOMAIN ?? 'agentmail.to';
  return {
    apiKey,
    domain,
    inboxId: `theories@${domain}`,
  };
}

async function ensureIndexedTheoriesReady(rootDir = defaultTheoriesRoot(), cwd = process.cwd()): Promise<void> {
  if (!shouldUseEmailIndex(rootDir)) return;
  if (Date.now() < theoryCacheFreshUntil) return;

  const config = loadTheoryEmailConfig(cwd);
  if (!config) return;

  const existingCount = await indexedTheoryCount(cwd);
  const dbPath = theoryIndexPath(cwd);
  let lastSyncedAt: string | null = null;
  let schemaVersion = THEORY_SCHEMA_VERSION;

  if (await pathExists(dbPath)) {
    const db = await openDb(dbPath);
    try {
      initTheorySchema(db);
      lastSyncedAt = readMetaValue(db, 'last_synced_at');
      schemaVersion = Number(readMetaValue(db, 'schema_version') ?? THEORY_SCHEMA_VERSION);
    } finally {
      db.close();
    }
  }

  const isEmpty = existingCount === 0;
  const isStale = schemaVersion < THEORY_SCHEMA_VERSION
    || !lastSyncedAt
    || (Date.now() - Date.parse(lastSyncedAt)) > THEORY_CACHE_TTL_MS;
  if (!isEmpty && !isStale) {
    theoryCacheFreshUntil = Date.now() + THEORY_CACHE_TTL_MS;
    return;
  }

  if (!theorySyncPromise) {
    theorySyncPromise = syncTheoryInbox(cwd).finally(() => {
      theorySyncPromise = undefined;
    });
  }

  if (isEmpty) {
    await theorySyncPromise;
    return;
  }

  void theorySyncPromise.catch(() => undefined);
}

export async function syncTheoryInbox(cwd = process.cwd()): Promise<TheorySyncResult> {
  const config = loadTheoryEmailConfig(cwd);
  if (!config) {
    throw new Error('Missing AgentMail credentials for theories sync.');
  }

  const dbPath = theoryIndexPath(cwd);
  const cacheDir = theoryMailCacheDir(cwd);
  await ensureDir(cacheDir);

  const db = await openDb(dbPath);
  initTheorySchema(db);

  const schemaVersion = Number(readMetaValue(db, 'schema_version') ?? 0);
  let latestStoredMessageId = readMetaValue(db, 'latest_source_message_id');
  let newestMessageId = latestStoredMessageId ?? undefined;
  let stopReason = 'reached end of sent theory mail';
  let addedFindings = 0;
  const pendingHeaders: TheoryEmailHeader[] = [];

  try {
    if (schemaVersion < THEORY_SCHEMA_VERSION) {
      await backfillTheoryRepoMetadata(db);
    }

    const client = new AgentMailClient({ apiKey: config.apiKey }) as unknown as {
      inboxes: {
        messages: {
          list: (inboxId: string, request: Record<string, unknown>) => Promise<Record<string, unknown>>;
          get: (inboxId: string, messageId: string) => Promise<Record<string, unknown>>;
        };
      };
    };

    let pageToken: string | undefined;
    let seenRemoteNewest = false;

    while (true) {
      const response = await client.inboxes.messages.list(config.inboxId, {
        limit: 100,
        pageToken,
        labels: ['sent'],
      });
      const messages = Array.isArray(response)
        ? response
        : ((response.messages as Record<string, unknown>[] | undefined) ?? []);

      if (!messages.length) {
        stopReason = latestStoredMessageId
          ? 'caught up to latest stored message'
          : 'no sent theory mail found';
        break;
      }

      let sawKnownMessage = false;
      for (const message of messages) {
        const labels = Array.isArray(message.labels) ? message.labels.map(String) : [];
        if (labels.length && !labels.includes('sent')) continue;

        const messageId = String(message.messageId ?? message.message_id ?? '');
        if (!messageId) continue;
        const subject = String(message.subject ?? '');
        const createdAt = String(message.createdAt ?? message.created_at ?? new Date().toISOString());

        if (!seenRemoteNewest) {
          newestMessageId = messageId;
          seenRemoteNewest = true;
        }

        if (latestStoredMessageId && messageId === latestStoredMessageId) {
          stopReason = 'caught up to latest stored message';
          sawKnownMessage = true;
          break;
        }

        pendingHeaders.push({ messageId, subject, createdAt });
      }

      if (sawKnownMessage) break;

      const nextPageToken = String(response.nextPageToken ?? '');
      if (!nextPageToken) break;
      pageToken = nextPageToken;
    }

    if (pendingHeaders.length > 0) {
      db.run('BEGIN TRANSACTION');
      try {
        for (const header of pendingHeaders.reverse()) {
          const fullMessage = await client.inboxes.messages.get(config.inboxId, header.messageId);
          const body = parseMessageBody(fullMessage);
          if (!body) continue;

          const cachePath = emailCachePath(header.messageId, header.createdAt, cwd);
          await writeFile(cachePath, `${body}\n`, 'utf8');

          const items = await parseTheoryEmailMessage(body, header, cachePath);
          db.run(`DELETE FROM theories WHERE source_message_id = ?`, [header.messageId]);
          for (const item of items) {
            insertTheoryItem(db, item);
            addedFindings += 1;
          }
        }
        db.run('COMMIT');
      } catch (error) {
        try {
          db.run('ROLLBACK');
        } catch {
          // best effort rollback only
        }
        throw error;
      }
    }

    const syncedAt = new Date().toISOString();
    writeMetaValue(db, 'schema_version', String(THEORY_SCHEMA_VERSION));
    writeMetaValue(db, 'last_synced_at', syncedAt);
    if (newestMessageId) {
      writeMetaValue(db, 'latest_source_message_id', newestMessageId);
      latestStoredMessageId = newestMessageId;
    }
    saveDb(db, dbPath);

    const findingCount = Number(db.exec(`SELECT COUNT(*) FROM theories`)[0]?.values?.[0]?.[0] ?? 0);
    theoryCacheFreshUntil = Date.now() + THEORY_CACHE_TTL_MS;

    return {
      dbPath,
      findingCount,
      newMessages: pendingHeaders.length,
      addedFindings,
      newestMessageId: latestStoredMessageId ?? undefined,
      stopReason,
      syncedAt,
    };
  } finally {
    db.close();
  }
}

export function defaultTheoriesRoot(): string {
  return path.join(os.homedir(), 'theories');
}

export function theoriesDigestsDir(rootDir = defaultTheoriesRoot()): string {
  return path.join(rootDir, 'digests');
}

export function theoriesStatePath(rootDir = defaultTheoriesRoot()): string {
  return path.join(rootDir, 'state.json');
}

export function normalizeTheoryId(input: string): string {
  const trimmed = input.trim().toUpperCase();
  const match = trimmed.match(/^FT-?0*(\d+)$/) ?? trimmed.match(/^0*(\d+)$/);
  if (!match) return trimmed;
  return `FT-${Number(match[1])}`;
}

export function formatTheoryId(input: string | number, digits = 3): string {
  if (typeof input === 'number') {
    return `FT-${String(input).padStart(digits, '0')}`;
  }

  const normalized = normalizeTheoryId(String(input));
  const match = normalized.match(/^FT-(\d+)$/);
  if (!match) return normalized;
  return `FT-${String(Number(match[1])).padStart(digits, '0')}`;
}

export async function loadTheoryState(rootDir = defaultTheoriesRoot()): Promise<TheoryStateFile> {
  const filePath = theoriesStatePath(rootDir);
  if (!(await pathExists(filePath))) return {};
  return readJson<TheoryStateFile>(filePath);
}

export async function countTheoryItems(
  filters: TheoryListFilters = {},
  rootDir = defaultTheoriesRoot()
): Promise<number> {
  await ensureIndexedTheoriesReady(rootDir);
  if (shouldUseEmailIndex(rootDir)) {
    const totalIndexed = await indexedTheoryCount();
    if (totalIndexed > 0) {
      return countIndexedTheoryItems(filters);
    }
  }

  const allItems = await loadAllDigestTheoryItems(rootDir);
  return allItems.filter((item) => theoryMatchesFilters(item, filters)).length;
}

export async function listTheoryItems(
  filters: TheoryListFilters = {},
  rootDir = defaultTheoriesRoot()
): Promise<TheoryItem[]> {
  await ensureIndexedTheoriesReady(rootDir);
  if (shouldUseEmailIndex(rootDir)) {
    const indexedItems = await listIndexedTheoryItems(filters);
    if (indexedItems.length > 0 || await indexedTheoryCount() > 0) {
      return indexedItems;
    }
  }

  const allItems = await loadAllDigestTheoryItems(rootDir);
  const filtered = sortTheoryItems(
    allItems.filter((item) => theoryMatchesFilters(item, filters)),
    filters.sort ?? 'desc'
  );
  const offset = filters.offset ?? 0;
  const limit = filters.limit ?? 30;
  return filtered.slice(offset, offset + limit);
}

export async function getTheoryItem(
  theoryId: string,
  rootDir = defaultTheoriesRoot()
): Promise<TheoryItem | null> {
  await ensureIndexedTheoriesReady(rootDir);
  if (shouldUseEmailIndex(rootDir)) {
    const indexedItem = await getIndexedTheoryItem(theoryId);
    if (indexedItem) return indexedItem;
  }

  const normalized = normalizeTheoryId(theoryId);
  const formatted = formatTheoryId(normalized);
  const all = await loadAllDigestTheoryItems(rootDir);
  return all.find((item) => item.id === normalized || item.displayId.toUpperCase() === formatted) ?? null;
}
