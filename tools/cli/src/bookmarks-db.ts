import type { Database } from 'sql.js';
import { openDb, saveDb } from './db.js';
import { readJsonLines } from './fs.js';
import { twitterBookmarksCachePath, twitterBookmarksIndexPath } from './paths.js';
import type { BookmarkRecord } from './types.js';
import { classifyBookmark, classifyCorpus, formatClassificationSummary } from './bookmark-classify.js';
import type { ClassificationSummary } from './bookmark-classify.js';

const SCHEMA_VERSION = 3;

export interface SearchResult {
  id: string;
  url: string;
  text: string;
  authorHandle?: string;
  authorName?: string;
  postedAt?: string | null;
  score: number;
}

export interface SearchOptions {
  query: string;
  author?: string;
  limit?: number;
  before?: string;
  after?: string;
}

function initSchema(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);

  db.run(`CREATE TABLE IF NOT EXISTS bookmarks (
    id TEXT PRIMARY KEY,
    tweet_id TEXT NOT NULL,
    url TEXT NOT NULL,
    text TEXT NOT NULL,
    author_handle TEXT,
    author_name TEXT,
    author_profile_image_url TEXT,
    posted_at TEXT,
    bookmarked_at TEXT,
    synced_at TEXT NOT NULL,
    conversation_id TEXT,
    in_reply_to_status_id TEXT,
    quoted_status_id TEXT,
    language TEXT,
    like_count INTEGER,
    repost_count INTEGER,
    reply_count INTEGER,
    quote_count INTEGER,
    bookmark_count INTEGER,
    view_count INTEGER,
    media_count INTEGER DEFAULT 0,
    link_count INTEGER DEFAULT 0,
    links_json TEXT,
    tags_json TEXT,
    ingested_via TEXT,
    categories TEXT,
    primary_category TEXT,
    github_urls TEXT,
    domains TEXT,
    primary_domain TEXT
  )`);

  db.run(`CREATE INDEX IF NOT EXISTS idx_bookmarks_author ON bookmarks(author_handle)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_bookmarks_posted ON bookmarks(posted_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_bookmarks_language ON bookmarks(language)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_bookmarks_category ON bookmarks(primary_category)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_bookmarks_domain ON bookmarks(primary_domain)`);

  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS bookmarks_fts USING fts5(
    text,
    author_handle,
    author_name,
    content=bookmarks,
    content_rowid=rowid,
    tokenize='porter unicode61'
  )`);

  db.run(`REPLACE INTO meta VALUES ('schema_version', '${SCHEMA_VERSION}')`);
}

function ensureMigrations(db: Database): void {
  const rows = db.exec("SELECT value FROM meta WHERE key = 'schema_version'");
  const version = rows.length ? Number(rows[0].values[0]?.[0] ?? 0) : 0;
  if (version < 3) {
    try { db.run('ALTER TABLE bookmarks ADD COLUMN domains TEXT'); } catch { /* already exists */ }
    try { db.run('ALTER TABLE bookmarks ADD COLUMN primary_domain TEXT'); } catch { /* already exists */ }
    db.run('CREATE INDEX IF NOT EXISTS idx_bookmarks_domain ON bookmarks(primary_domain)');
    db.run("REPLACE INTO meta VALUES ('schema_version', '3')");
  }
}

function insertRecord(db: Database, r: BookmarkRecord): void {
  // Extract GitHub URLs (kept inline — no LLM needed for URL parsing)
  const text = r.text ?? '';
  const githubMatches = text.match(/github\.com\/[\w.-]+\/[\w.-]+/gi) ?? [];
  const githubFromLinks = (r.links ?? []).filter((l) => /github\.com/i.test(l));
  const githubUrls = [...new Set([...githubMatches.map((m) => `https://${m}`), ...githubFromLinks])];

  db.run(
    `INSERT OR REPLACE INTO bookmarks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      r.id,
      r.tweetId,
      r.url,
      r.text,
      r.authorHandle ?? null,
      r.authorName ?? null,
      r.authorProfileImageUrl ?? null,
      r.postedAt ?? null,
      r.bookmarkedAt ?? null,
      r.syncedAt,
      r.conversationId ?? null,
      r.inReplyToStatusId ?? null,
      r.quotedStatusId ?? null,
      r.language ?? null,
      r.engagement?.likeCount ?? null,
      r.engagement?.repostCount ?? null,
      r.engagement?.replyCount ?? null,
      r.engagement?.quoteCount ?? null,
      r.engagement?.bookmarkCount ?? null,
      r.engagement?.viewCount ?? null,
      r.media?.length ?? 0,
      r.links?.length ?? 0,
      r.links?.length ? JSON.stringify(r.links) : null,
      r.tags?.length ? JSON.stringify(r.tags) : null,
      r.ingestedVia ?? null,
      null, // categories — populated by classify pass
      'unclassified', // primary_category
      githubUrls.length ? JSON.stringify(githubUrls) : null,
      null, // domains — populated by classify-domains pass
      null, // primary_domain
    ]
  );
}

export async function buildIndex(cwd = process.cwd()): Promise<{ dbPath: string; recordCount: number }> {
  const cachePath = twitterBookmarksCachePath(cwd);
  const dbPath = twitterBookmarksIndexPath(cwd);
  const records = await readJsonLines<BookmarkRecord>(cachePath);

  const db = await openDb(dbPath);
  try {
    // Drop and recreate for a clean rebuild
    db.run('DROP TABLE IF EXISTS bookmarks_fts');
    db.run('DROP TABLE IF EXISTS bookmarks');
    db.run('DROP TABLE IF EXISTS meta');

    initSchema(db);

    db.run('BEGIN TRANSACTION');
    for (const record of records) {
      insertRecord(db, record);
    }
    // Rebuild FTS index from content table
    db.run(`INSERT INTO bookmarks_fts(bookmarks_fts) VALUES('rebuild')`);
    db.run('COMMIT');

    saveDb(db, dbPath);
    return { dbPath, recordCount: records.length };
  } finally {
    db.close();
  }
}

export async function searchBookmarks(options: SearchOptions, cwd = process.cwd()): Promise<SearchResult[]> {
  const dbPath = twitterBookmarksIndexPath(cwd);
  const db = await openDb(dbPath);
  ensureMigrations(db);
  const limit = options.limit ?? 20;

  try {
    const conditions: string[] = [];
    const params: any[] = [];

    if (options.query) {
      conditions.push(`b.rowid IN (SELECT rowid FROM bookmarks_fts WHERE bookmarks_fts MATCH ?)`);
      params.push(options.query);
    }
    if (options.author) {
      conditions.push(`b.author_handle = ? COLLATE NOCASE`);
      params.push(options.author);
    }
    if (options.after) {
      conditions.push(`b.posted_at >= ?`);
      params.push(options.after);
    }
    if (options.before) {
      conditions.push(`b.posted_at <= ?`);
      params.push(options.before);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // If we have an FTS query, use bm25 for ranking; otherwise sort by posted_at
    const orderBy = options.query
      ? `ORDER BY bm25(bookmarks_fts, 5.0, 1.0, 1.0) ASC`
      : `ORDER BY b.posted_at DESC`;

    // For FTS ranking we need to join with the FTS table for bm25
    let sql: string;
    if (options.query) {
      sql = `
        SELECT b.id, b.url, b.text, b.author_handle, b.author_name, b.posted_at,
               bm25(bookmarks_fts, 5.0, 1.0, 1.0) as score
        FROM bookmarks b
        JOIN bookmarks_fts ON bookmarks_fts.rowid = b.rowid
        ${where}
        ${orderBy}
        LIMIT ?
      `;
    } else {
      sql = `
        SELECT b.id, b.url, b.text, b.author_handle, b.author_name, b.posted_at,
               0 as score
        FROM bookmarks b
        ${where}
        ORDER BY b.posted_at DESC
        LIMIT ?
      `;
    }
    params.push(limit);

    const rows = db.exec(sql, params);
    if (!rows.length) return [];

    return rows[0].values.map((row) => ({
      id: row[0] as string,
      url: row[1] as string,
      text: row[2] as string,
      authorHandle: row[3] as string | undefined,
      authorName: row[4] as string | undefined,
      postedAt: row[5] as string | null,
      score: row[6] as number,
    }));
  } finally {
    db.close();
  }
}

export async function getStats(cwd = process.cwd()): Promise<{
  totalBookmarks: number;
  uniqueAuthors: number;
  dateRange: { earliest: string | null; latest: string | null };
  topAuthors: { handle: string; count: number }[];
  languageBreakdown: { language: string; count: number }[];
}> {
  const dbPath = twitterBookmarksIndexPath(cwd);
  const db = await openDb(dbPath);

  try {
    const total = db.exec('SELECT COUNT(*) FROM bookmarks')[0]?.values[0]?.[0] as number;
    const authors = db.exec('SELECT COUNT(DISTINCT author_handle) FROM bookmarks')[0]?.values[0]?.[0] as number;
    const range = db.exec('SELECT MIN(posted_at), MAX(posted_at) FROM bookmarks WHERE posted_at IS NOT NULL')[0]?.values[0];

    const topAuthorsRows = db.exec(
      `SELECT author_handle, COUNT(*) as c FROM bookmarks
       WHERE author_handle IS NOT NULL
       GROUP BY author_handle ORDER BY c DESC LIMIT 15`
    );
    const topAuthors = (topAuthorsRows[0]?.values ?? []).map((r) => ({
      handle: r[0] as string,
      count: r[1] as number,
    }));

    const langRows = db.exec(
      `SELECT language, COUNT(*) as c FROM bookmarks
       WHERE language IS NOT NULL
       GROUP BY language ORDER BY c DESC LIMIT 10`
    );
    const languageBreakdown = (langRows[0]?.values ?? []).map((r) => ({
      language: r[0] as string,
      count: r[1] as number,
    }));

    return {
      totalBookmarks: total,
      uniqueAuthors: authors,
      dateRange: { earliest: (range?.[0] as string) ?? null, latest: (range?.[1] as string) ?? null },
      topAuthors,
      languageBreakdown,
    };
  } finally {
    db.close();
  }
}

// ── Classification ───────────────────────────────────────────────────────

export async function classifyAndRebuild(cwd = process.cwd()): Promise<{
  dbPath: string;
  recordCount: number;
  summary: ClassificationSummary;
}> {
  const cachePath = twitterBookmarksCachePath(cwd);
  const dbPath = twitterBookmarksIndexPath(cwd);
  const records = await readJsonLines<BookmarkRecord>(cachePath);
  const { results, summary } = classifyCorpus(records);

  // Rebuild index then apply regex classifications
  const buildResult = await buildIndex(cwd);
  const db = await openDb(dbPath);
  ensureMigrations(db);
  try {
    const stmt = db.prepare(`UPDATE bookmarks SET categories = ?, primary_category = ?, github_urls = ? WHERE id = ?`);
    for (const [id, r] of results) {
      if (r.categories.length > 0) {
        stmt.run([r.categories.join(','), r.primary, r.githubUrls.length ? JSON.stringify(r.githubUrls) : null, id]);
      }
    }
    stmt.free();
    saveDb(db, dbPath);
  } finally {
    db.close();
  }
  return { ...buildResult, summary };
}

export interface CategorySample {
  id: string;
  url: string;
  text: string;
  authorHandle?: string;
  categories: string;
  githubUrls?: string;
  links?: string;
}

export async function sampleByCategory(
  category: string,
  limit: number,
  cwd = process.cwd()
): Promise<CategorySample[]> {
  const dbPath = twitterBookmarksIndexPath(cwd);
  const db = await openDb(dbPath);
  try {
    const rows = db.exec(
      `SELECT id, url, text, author_handle, categories, github_urls, links_json
       FROM bookmarks
       WHERE categories LIKE ?
       ORDER BY RANDOM()
       LIMIT ?`,
      [`%${category}%`, limit]
    );
    if (!rows.length) return [];
    return rows[0].values.map((r) => ({
      id: r[0] as string,
      url: r[1] as string,
      text: r[2] as string,
      authorHandle: (r[3] as string) ?? undefined,
      categories: (r[4] as string) ?? '',
      githubUrls: (r[5] as string) ?? undefined,
      links: (r[6] as string) ?? undefined,
    }));
  } finally {
    db.close();
  }
}

export async function getCategoryCounts(cwd = process.cwd()): Promise<Record<string, number>> {
  const dbPath = twitterBookmarksIndexPath(cwd);
  const db = await openDb(dbPath);
  ensureMigrations(db);
  try {
    const rows = db.exec(
      `SELECT primary_category, COUNT(*) as c FROM bookmarks
       WHERE primary_category IS NOT NULL
       GROUP BY primary_category ORDER BY c DESC`
    );
    const counts: Record<string, number> = {};
    for (const row of rows[0]?.values ?? []) {
      counts[row[0] as string] = row[1] as number;
    }
    return counts;
  } finally {
    db.close();
  }
}

export async function getDomainCounts(cwd = process.cwd()): Promise<Record<string, number>> {
  const dbPath = twitterBookmarksIndexPath(cwd);
  const db = await openDb(dbPath);
  ensureMigrations(db);
  try {
    const rows = db.exec(
      `SELECT primary_domain, COUNT(*) as c FROM bookmarks
       WHERE primary_domain IS NOT NULL
       GROUP BY primary_domain ORDER BY c DESC`
    );
    const counts: Record<string, number> = {};
    for (const row of rows[0]?.values ?? []) {
      counts[row[0] as string] = row[1] as number;
    }
    return counts;
  } finally {
    db.close();
  }
}

export async function sampleByDomain(
  domain: string,
  limit: number,
  cwd = process.cwd()
): Promise<CategorySample[]> {
  const dbPath = twitterBookmarksIndexPath(cwd);
  const db = await openDb(dbPath);
  ensureMigrations(db);
  try {
    const rows = db.exec(
      `SELECT id, url, text, author_handle, categories, github_urls, links_json
       FROM bookmarks
       WHERE domains LIKE ?
       ORDER BY RANDOM()
       LIMIT ?`,
      [`%${domain}%`, limit]
    );
    if (!rows.length) return [];
    return rows[0].values.map((r) => ({
      id: r[0] as string,
      url: r[1] as string,
      text: r[2] as string,
      authorHandle: (r[3] as string) ?? undefined,
      categories: (r[4] as string) ?? '',
      githubUrls: (r[5] as string) ?? undefined,
      links: (r[6] as string) ?? undefined,
    }));
  } finally {
    db.close();
  }
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return 'No results found.';

  return results
    .map((r, i) => {
      const author = r.authorHandle ? `@${r.authorHandle}` : 'unknown';
      const date = r.postedAt ? r.postedAt.slice(0, 10) : '?';
      const text = r.text.length > 140 ? r.text.slice(0, 140) + '...' : r.text;
      return `${i + 1}. [${date}] ${author}\n   ${text}\n   ${r.url}`;
    })
    .join('\n\n');
}
