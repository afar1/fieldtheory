import path from 'path';
import fs from 'fs';
import http from 'http';
import https from 'https';
import { EventEmitter } from 'events';
import * as chokidar from 'chokidar';
import { createLogger } from './logger';
import { bookmarkDataDir, libraryDir } from './fieldTheoryPaths';
import {
  canonicalWebBookmarkUrl,
  extractWebBookmarkMarkdown,
  slugifyWebBookmarkTitle,
  webBookmarkDomain,
  webBookmarkId,
  withWebBookmarkFrontmatter,
} from './webBookmarkMarkdown';

const log = createLogger('Bookmarks');

export interface BookmarkImage {
  url: string;
  width: number;
  height: number;
  type: 'photo' | 'video' | 'animated_gif' | string;
  videoUrl?: string;
  /** Filename in the bookmark media folder. Set when `ft fetch-media` has
   * downloaded this asset. Renderer loads it via ftmedia://media/<filename>. */
  localFilename?: string;
  /** Local MP4 filename when the video itself has been downloaded. */
  localVideoFilename?: string;
}

export interface QuotedTweet {
  id: string;
  text: string;
  authorHandle: string;
  authorName: string;
  authorAvatar: string;
  /** Local avatar filename in the bookmark media folder, if downloaded. */
  localAvatarFilename?: string;
  postedAt: string;
  url: string;
  images: BookmarkImage[];
}

export interface Bookmark {
  id: string;
  sourceType: 'x' | 'web';
  text: string;
  url: string;
  authorHandle: string;
  authorName: string;
  authorAvatar: string;
  /** Local avatar filename in the bookmark media folder, if downloaded. */
  localAvatarFilename?: string;
  postedAt: string;
  images: BookmarkImage[];
  mediaCount: number;
  likeCount: number;
  repostCount: number;
  bookmarkCount: number;
  folders: string[];
  quotedTweet?: QuotedTweet;
  title?: string;
  domain?: string;
  excerpt?: string;
  savedAt?: string;
  markdownPath?: string;
}

export interface BookmarkFolder {
  name: string;
  id?: string;
}

export interface BookmarksSnapshot {
  bookmarks: Bookmark[];
  folders: BookmarkFolder[];
  /** mtime of bookmarks.jsonl, which is written by `ft sync` for X bookmarks. */
  xLastSyncedAt: string | null;
}

interface RawMediaObject {
  type?: string;
  url?: string;
  width?: number;
  height?: number;
  videoVariants?: Array<{ url?: string; bitrate?: number }>;
}

export interface RawQuotedTweet {
  id?: string;
  text?: string;
  authorHandle?: string;
  authorName?: string;
  authorProfileImageUrl?: string;
  postedAt?: string;
  url?: string;
  mediaObjects?: RawMediaObject[];
}

export interface RawBookmark {
  id?: string;
  tweetId?: string;
  text?: string;
  url?: string;
  authorHandle?: string;
  authorName?: string;
  authorProfileImageUrl?: string;
  postedAt?: string;
  media?: unknown[];
  mediaObjects?: RawMediaObject[];
  engagement?: {
    likeCount?: number;
    repostCount?: number;
    bookmarkCount?: number;
  };
  quotedTweet?: RawQuotedTweet;
}

export interface RawWebBookmark {
  id?: string;
  sourceType?: 'web';
  url?: string;
  title?: string;
  domain?: string;
  excerpt?: string;
  savedAt?: string;
  publishedAt?: string;
  markdownPath?: string;
}

export interface SaveWebBookmarkResult {
  bookmark: Bookmark;
  markdownPath: string;
  created: boolean;
}

function bookmarksDir(): string {
  return bookmarkDataDir();
}

function jsonlPath(): string {
  return path.join(bookmarksDir(), 'bookmarks.jsonl');
}

function xBookmarksLastSyncedAt(): string | null {
  try {
    return fs.statSync(jsonlPath()).mtime.toISOString();
  } catch {
    return null;
  }
}

function foldersPath(): string {
  return path.join(bookmarksDir(), 'folders-data.json');
}

function mediaManifestPath(): string {
  return path.join(bookmarksDir(), 'media-manifest.json');
}

export function mediaDir(): string {
  return path.join(bookmarksDir(), 'media');
}

export function resolveBookmarkMediaFile(filename: string): string | null {
  const cleanFilename = path.basename(filename);
  if (!cleanFilename || cleanFilename !== filename) return null;

  const dir = mediaDir();
  const candidate = path.join(dir, cleanFilename);
  try {
    const realDir = fs.realpathSync(dir);
    const realFile = fs.realpathSync(candidate);
    const relativePath = path.relative(realDir, realFile);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null;
    if (!fs.statSync(realFile).isFile()) return null;
    return realFile;
  } catch {
    return null;
  }
}

function webDir(): string {
  return path.join(bookmarksDir(), 'web');
}

function webIndexPath(): string {
  return path.join(webDir(), 'index.jsonl');
}

function snapshotCachePath(): string {
  return path.join(bookmarksDir(), 'snapshot-cache.json');
}

const SNAPSHOT_CACHE_VERSION = 1;

/**
 * (mtimeMs + size) for a single input file, or null when absent.
 */
type FileGate = { mtimeMs: number; size: number } | null;

function fileGate(filePath: string): FileGate {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    return { mtimeMs: Math.floor(stat.mtimeMs), size: stat.size };
  } catch {
    return null;
  }
}

/**
 * Signature of the media/ directory listing: renderable file count + newest
 * mtime. Cheaper and safer than hashing every name; a rename/add/delete or a
 * touched file shifts one of these. Gating on the listing cleanly is awkward,
 * so we gate on file count + newest mtime per the spec's fallback.
 */
function mediaDirGate(): { count: number; newestMtimeMs: number } {
  const dir = mediaDir();
  let count = 0;
  let newestMtimeMs = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      let stat: fs.Stats;
      try {
        stat = fs.statSync(path.join(dir, name));
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;
      count += 1;
      const mtimeMs = Math.floor(stat.mtimeMs);
      if (mtimeMs > newestMtimeMs) newestMtimeMs = mtimeMs;
    }
  } catch {
    // Dir absent → count 0, newest 0.
  }
  return { count, newestMtimeMs };
}

/**
 * Gate over EVERY input reload() touches: folders-data.json, bookmarks.jsonl,
 * media-manifest.json, the media/ dir listing, and web/index.jsonl. If all are
 * unchanged the cached snapshot is reused; otherwise reload() rebuilds.
 */
interface SnapshotGate {
  folders: FileGate;
  bookmarks: FileGate;
  mediaManifest: FileGate;
  mediaDir: { count: number; newestMtimeMs: number };
  webIndex: FileGate;
}

interface SnapshotCacheFile {
  version: number;
  gate: SnapshotGate;
  snapshot: BookmarksSnapshot;
}

function computeSnapshotGate(): SnapshotGate {
  return {
    folders: fileGate(foldersPath()),
    bookmarks: fileGate(jsonlPath()),
    mediaManifest: fileGate(mediaManifestPath()),
    mediaDir: mediaDirGate(),
    webIndex: fileGate(webIndexPath()),
  };
}

function shouldWatchBookmarkInput(
  inputPath: string,
  input: { directories: Set<string>; files: Set<string>; mediaDirectory: string }
): boolean {
  const candidate = path.resolve(inputPath);
  if (input.directories.has(candidate)) return true;
  if (input.files.has(candidate)) return true;
  return path.dirname(candidate) === input.mediaDirectory;
}

interface RawMediaManifestEntry {
  tweetId?: string;
  sourceUrl?: string;
  localPath?: string;
  status?: string;
  authorHandle?: string;
}

interface RawMediaManifest {
  entries?: RawMediaManifestEntry[];
}

function isProfileImageUrl(url: string): boolean {
  return url.includes('/profile_images/');
}

function isRenderableImageFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.gif' || ext === '.webp';
}

function isRenderableVideoFile(name: string): boolean {
  return path.extname(name).toLowerCase() === '.mp4';
}

/** Prefer exact source-url matches from the manifest; fall back to a single
 * image-only filename per tweet for older archives that predate the manifest.
 * Profile images route to `avatarsByHandle` so they never pollute the tweet-
 * media fallback (which would show up as a bogus tile in the canvas grid). */
function indexMediaByTweetSource(): {
  exactImages: Map<string, string>;
  exactVideos: Map<string, string>;
  fallbackImages: Map<string, string>;
  avatarsByHandle: Map<string, string>;
} {
  const exactImages = new Map<string, string>();
  const exactVideos = new Map<string, string>();
  const fallbackImages = new Map<string, string>();
  const avatarsByHandle = new Map<string, string>();
  const manifestPath = mediaManifestPath();
  if (fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as RawMediaManifest;
      for (const entry of manifest.entries ?? []) {
        if (entry.status !== 'downloaded' || !entry.localPath || !entry.tweetId || !entry.sourceUrl) continue;
        const filename = path.basename(entry.localPath);
        if (isProfileImageUrl(entry.sourceUrl)) {
          if (isRenderableImageFile(filename) && entry.authorHandle) {
            const handle = entry.authorHandle.toLowerCase();
            if (!avatarsByHandle.has(handle)) avatarsByHandle.set(handle, filename);
          }
          continue;
        }
        const key = `${entry.tweetId}::${entry.sourceUrl}`;
        if (isRenderableImageFile(filename)) {
          if (!exactImages.has(key)) exactImages.set(key, filename);
          if (!fallbackImages.has(entry.tweetId)) fallbackImages.set(entry.tweetId, filename);
          continue;
        }
        if (isRenderableVideoFile(filename) && !exactVideos.has(key)) exactVideos.set(key, filename);
      }
    } catch (err) {
      log.warn('Failed to parse media-manifest.json:', err);
    }
  }

  const dir = mediaDir();
  if (!fs.existsSync(dir)) return { exactImages, exactVideos, fallbackImages, avatarsByHandle };
  for (const name of fs.readdirSync(dir)) {
    if (!isRenderableImageFile(name)) continue;
    const dash = name.indexOf('-');
    if (dash <= 0) continue; // profile images have no tweetId prefix
    const tweetId = name.slice(0, dash);
    if (!/^\d{15,}$/.test(tweetId)) continue;
    if (!fallbackImages.has(tweetId)) fallbackImages.set(tweetId, name);
  }
  return { exactImages, exactVideos, fallbackImages, avatarsByHandle };
}

function extractImages(raw: { mediaObjects?: RawMediaObject[] }): BookmarkImage[] {
  const mediaObjects = (raw.mediaObjects ?? []).filter(
    (m) => (m.type === 'photo' || m.type === 'video' || m.type === 'animated_gif') && m.url
  );
  return mediaObjects.map((m) => {
    const entry: BookmarkImage = {
      url: m.url!,
      width: m.width ?? 1,
      height: m.height ?? 1,
      type: m.type ?? 'photo',
    };
    if ((m.type === 'video' || m.type === 'animated_gif') && m.videoVariants) {
      const mp4s = m.videoVariants
        .filter((v): v is { url: string; bitrate?: number } => !!v.url && v.url.includes('.mp4'))
        .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
      if (mp4s.length > 0) entry.videoUrl = mp4s[0].url;
    }
    return entry;
  });
}

function parseQuotedTweet(raw: RawQuotedTweet | undefined): QuotedTweet | undefined {
  if (!raw || !raw.id) return undefined;
  return {
    id: raw.id,
    text: raw.text ?? '',
    authorHandle: raw.authorHandle ?? '',
    authorName: raw.authorName ?? '',
    authorAvatar: raw.authorProfileImageUrl ?? '',
    postedAt: raw.postedAt ?? '',
    url: raw.url ?? (raw.authorHandle ? `https://x.com/${raw.authorHandle}/status/${raw.id}` : ''),
    images: extractImages(raw),
  };
}

type MediaIndex = ReturnType<typeof indexMediaByTweetSource>;

function attachLocalImages(
  images: BookmarkImage[],
  tweetId: string,
  mediaIndex: MediaIndex,
): void {
  for (const image of images) {
    const exactImage = mediaIndex.exactImages.get(`${tweetId}::${image.url}`);
    if (exactImage) image.localFilename = exactImage;
    if (image.videoUrl) {
      const exactVideo = mediaIndex.exactVideos.get(`${tweetId}::${image.videoUrl}`);
      if (exactVideo) image.localVideoFilename = exactVideo;
    }
  }
  if (images.length === 1 && !images[0].localFilename) {
    const fallback = mediaIndex.fallbackImages.get(tweetId);
    if (fallback) images[0].localFilename = fallback;
  }
}

function lookupAvatar(handle: string, mediaIndex: MediaIndex): string | undefined {
  if (!handle) return undefined;
  return mediaIndex.avatarsByHandle.get(handle.toLowerCase());
}

export function parseRawBookmark(raw: RawBookmark): Bookmark | null {
  const id = raw.tweetId || raw.id;
  if (!id) return null;

  const images = extractImages(raw);

  return {
    id,
    sourceType: 'x',
    text: raw.text ?? '',
    url: raw.url ?? `https://x.com/${raw.authorHandle ?? 'i'}/status/${id}`,
    authorHandle: raw.authorHandle ?? '',
    authorName: raw.authorName ?? '',
    authorAvatar: raw.authorProfileImageUrl ?? '',
    postedAt: raw.postedAt ?? '',
    images,
    mediaCount: Array.isArray(raw.media) ? raw.media.length : 0,
    likeCount: raw.engagement?.likeCount ?? 0,
    repostCount: raw.engagement?.repostCount ?? 0,
    bookmarkCount: raw.engagement?.bookmarkCount ?? 0,
    folders: [],
    quotedTweet: parseQuotedTweet(raw.quotedTweet),
  };
}

function loadFolders(): { folders: BookmarkFolder[]; folderMap: Record<string, string[]> } {
  const p = foldersPath();
  if (!fs.existsSync(p)) return { folders: [], folderMap: {} };
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return {
      folders: Array.isArray(data.folders) ? data.folders : [],
      folderMap: data.folderMap ?? {},
    };
  } catch (err) {
    log.warn('Failed to parse folders-data.json:', err);
    return { folders: [], folderMap: {} };
  }
}

function resolveStoredMarkdownPath(markdownPath: string | undefined): string | undefined {
  if (!markdownPath) return undefined;
  if (path.isAbsolute(markdownPath)) return markdownPath;
  const normalized = markdownPath.replace(/\\/g, '/');
  if (normalized === 'entries' || normalized.startsWith('entries/')) {
    return path.join(libraryDir(), markdownPath);
  }
  return path.join(bookmarksDir(), markdownPath);
}

export function parseRawWebBookmark(raw: RawWebBookmark): Bookmark | null {
  if (raw.sourceType !== 'web' && raw.sourceType !== undefined) return null;
  if (!raw.url) return null;

  let url: string;
  try {
    url = canonicalWebBookmarkUrl(raw.url);
  } catch {
    return null;
  }

  const id = raw.id || webBookmarkId(url);
  const domain = raw.domain || webBookmarkDomain(url);
  const title = (raw.title || domain).trim();
  const excerpt = (raw.excerpt || '').trim();
  const savedAt = raw.savedAt || raw.publishedAt || '';
  const text = [title, excerpt].filter(Boolean).join('\n\n') || url;

  return {
    id,
    sourceType: 'web',
    text,
    url,
    authorHandle: '',
    authorName: domain,
    authorAvatar: '',
    postedAt: raw.publishedAt || savedAt,
    images: [],
    mediaCount: 0,
    likeCount: 0,
    repostCount: 0,
    bookmarkCount: 0,
    folders: [],
    title,
    domain,
    excerpt,
    savedAt,
    markdownPath: resolveStoredMarkdownPath(raw.markdownPath),
  };
}

function readWebBookmarkRows(): RawWebBookmark[] {
  const p = webIndexPath();
  if (!fs.existsSync(p)) return [];

  const rows: RawWebBookmark[] = [];
  const text = fs.readFileSync(p, 'utf-8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as RawWebBookmark);
    } catch {
      // skip malformed lines
    }
  }
  return rows;
}

function loadWebBookmarks(): Bookmark[] {
  return readWebBookmarkRows()
    .map((row) => parseRawWebBookmark(row))
    .filter((bookmark): bookmark is Bookmark => !!bookmark);
}

async function fetchWebPageHtml(url: string, redirects = 0): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(parsed, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FieldTheory/1.0; +https://fieldtheory.dev)',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      },
    }, (res) => {
      const status = res.statusCode ?? 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location) {
        res.resume();
        if (redirects >= 5) {
          reject(new Error('Too many redirects'));
          return;
        }
        resolve(fetchWebPageHtml(new URL(location, url).toString(), redirects + 1));
        return;
      }

      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`HTTP ${status}`));
        return;
      }

      const contentType = String(res.headers['content-type'] ?? '');
      if (contentType && !/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
        res.resume();
        reject(new Error(`Unsupported content type: ${contentType}`));
        return;
      }

      res.setEncoding('utf-8');
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve(body));
    });
    req.setTimeout(30000, () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
  });
}

export class BookmarksManager extends EventEmitter {
  private watcher: chokidar.FSWatcher | null = null;
  private watcherPending = false;
  private cached: BookmarksSnapshot | null = null;

  getSnapshot(): BookmarksSnapshot {
    if (this.cached) return this.cached;
    return this.reload();
  }

  reloadAndEmitChanged(): BookmarksSnapshot {
    this.cached = null;
    const snapshot = this.reload(true);
    this.emit('bookmarks:changed');
    return snapshot;
  }

  /**
   * Read the persisted snapshot cache when its gate matches every current input.
   * Returns null on missing/corrupt cache or any changed input.
   */
  private loadCachedSnapshot(gate: SnapshotGate): BookmarksSnapshot | null {
    try {
      const cachePath = snapshotCachePath();
      if (!fs.existsSync(cachePath)) return null;
      const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8')) as SnapshotCacheFile;
      if (data.version !== SNAPSHOT_CACHE_VERSION || !data.gate || !data.snapshot) return null;
      if (JSON.stringify(data.gate) !== JSON.stringify(gate)) return null;
      return data.snapshot;
    } catch (err) {
      log.warn('Failed to read bookmarks snapshot cache:', err);
      return null;
    }
  }

  private saveCachedSnapshot(gate: SnapshotGate, snapshot: BookmarksSnapshot): void {
    try {
      const payload: SnapshotCacheFile = { version: SNAPSHOT_CACHE_VERSION, gate, snapshot };
      fs.mkdirSync(bookmarksDir(), { recursive: true });
      fs.writeFileSync(snapshotCachePath(), JSON.stringify(payload));
    } catch (err) {
      log.warn('Failed to write bookmarks snapshot cache:', err);
    }
  }

  private reload(forceRebuild = false): BookmarksSnapshot {
    // Gate on ALL inputs. When unchanged, reuse the persisted snapshot so the
    // cold first getSnapshot() per process skips the big jsonl read + parse.
    const gate = computeSnapshotGate();
    if (!forceRebuild) {
      const cachedSnapshot = this.loadCachedSnapshot(gate);
      if (cachedSnapshot) {
        this.cached = cachedSnapshot;
        return this.cached;
      }
    }

    const { folders, folderMap } = loadFolders();
    const mediaIndex = indexMediaByTweetSource();

    const bookmarks: Bookmark[] = [];
    const p = jsonlPath();
    if (fs.existsSync(p)) {
      const text = fs.readFileSync(p, 'utf-8');
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const raw = JSON.parse(trimmed) as RawBookmark;
          const bm = parseRawBookmark(raw);
          if (bm) {
            bm.folders = folderMap[bm.id] ?? [];
            attachLocalImages(bm.images, bm.id, mediaIndex);
            const bmAvatar = lookupAvatar(bm.authorHandle, mediaIndex);
            if (bmAvatar) bm.localAvatarFilename = bmAvatar;
            if (bm.quotedTweet) {
              attachLocalImages(bm.quotedTweet.images, bm.quotedTweet.id, mediaIndex);
              const qAvatar = lookupAvatar(bm.quotedTweet.authorHandle, mediaIndex);
              if (qAvatar) bm.quotedTweet.localAvatarFilename = qAvatar;
            }
            bookmarks.push(bm);
          }
        } catch {
          // skip malformed lines
        }
      }
    }
    bookmarks.push(...loadWebBookmarks());

    bookmarks.sort((a, b) => {
      const ta = new Date(a.postedAt).getTime() || 0;
      const tb = new Date(b.postedAt).getTime() || 0;
      return tb - ta;
    });

    this.cached = { bookmarks, folders, xLastSyncedAt: xBookmarksLastSyncedAt() };
    this.saveCachedSnapshot(gate, this.cached);
    return this.cached;
  }

  saveWebBookmarkFromHtml(rawUrl: string, html: string, savedAt = new Date().toISOString()): SaveWebBookmarkResult {
    const url = canonicalWebBookmarkUrl(rawUrl);
    const id = webBookmarkId(url);
    const existing = readWebBookmarkRows().find((row) => {
      if (row.id === id) return true;
      if (!row.url) return false;
      try {
        return webBookmarkId(canonicalWebBookmarkUrl(row.url)) === id;
      } catch {
        return false;
      }
    });
    if (existing) {
      const bookmark = parseRawWebBookmark(existing);
      if (bookmark) {
        return { bookmark, markdownPath: bookmark.markdownPath ?? '', created: false };
      }
    }

    const domain = webBookmarkDomain(url);
    const extracted = extractWebBookmarkMarkdown(html, url);
    const title = extracted.title || domain;
    const slug = slugifyWebBookmarkTitle(title, domain);
    const fileName = `${slug}-${id.replace(/^web:/, '').slice(0, 8)}.md`;
    const relativeMarkdownPath = path.join('entries', 'web', domain, fileName);
    const absoluteMarkdownPath = path.join(libraryDir(), relativeMarkdownPath);
    const markdown = withWebBookmarkFrontmatter({
      title,
      url,
      domain,
      savedAt,
      markdown: extracted.markdown,
    });

    fs.mkdirSync(path.dirname(absoluteMarkdownPath), { recursive: true });
    fs.writeFileSync(absoluteMarkdownPath, markdown, 'utf-8');

    fs.mkdirSync(webDir(), { recursive: true });
    const row: RawWebBookmark = {
      id,
      sourceType: 'web',
      url,
      title,
      domain,
      excerpt: extracted.excerpt,
      savedAt,
      markdownPath: relativeMarkdownPath,
    };
    fs.appendFileSync(webIndexPath(), `${JSON.stringify(row)}\n`, 'utf-8');

    const bookmark = parseRawWebBookmark(row);
    if (!bookmark) {
      throw new Error('Saved web bookmark could not be read back');
    }

    this.cached = null;
    this.emit('bookmarks:changed');
    return { bookmark, markdownPath: absoluteMarkdownPath, created: true };
  }

  async saveWebBookmarkFromUrl(rawUrl: string): Promise<SaveWebBookmarkResult> {
    const url = canonicalWebBookmarkUrl(rawUrl);
    const html = await fetchWebPageHtml(url);
    return this.saveWebBookmarkFromHtml(url, html);
  }

  startWatcher(): void {
    if (this.watcher || this.watcherPending) return;

    const dir = bookmarksDir();
    if (!fs.existsSync(dir)) {
      this.watcherPending = true;
      const parent = path.dirname(dir);
      if (!fs.existsSync(parent)) return;
      const parentWatcher = chokidar.watch(parent, { depth: 0, ignoreInitial: true });
      parentWatcher.on('addDir', (dirPath) => {
        if (path.basename(dirPath) === path.basename(dir)) {
          parentWatcher.close();
          this.watcherPending = false;
          this.startWatcher();
        }
      });
      return;
    }

    const watchedInputs = {
      directories: new Set([dir, mediaDir(), webDir()].map((dirPath) => path.resolve(dirPath))),
      files: new Set([jsonlPath(), foldersPath(), mediaManifestPath(), webIndexPath()].map((filePath) => path.resolve(filePath))),
      mediaDirectory: path.resolve(mediaDir()),
    };

    this.watcher = chokidar.watch(
      dir,
      {
        depth: 2,
        ignored: (inputPath) => !shouldWatchBookmarkInput(inputPath, watchedInputs),
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
        ignorePermissionErrors: true,
      }
    );

    const emit = () => {
      this.cached = null;
      this.emit('bookmarks:changed');
    };
    this.watcher.on('add', emit);
    this.watcher.on('change', emit);
    this.watcher.on('unlink', emit);
    this.watcher.on('error', (err) => log.error('Bookmarks watcher error:', err));
  }

  async stopWatcher(): Promise<void> {
    const watcher = this.watcher;
    this.watcher = null;
    await watcher?.close();
  }
}
