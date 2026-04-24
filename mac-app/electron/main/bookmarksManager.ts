import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';
import * as chokidar from 'chokidar';
import { createLogger } from './logger';
import { bookmarkDataDir } from './fieldTheoryPaths';

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
  sourceType: 'x';
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
}

export interface BookmarkFolder {
  name: string;
  id?: string;
}

export interface BookmarksSnapshot {
  bookmarks: Bookmark[];
  folders: BookmarkFolder[];
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

function bookmarksDir(): string {
  return bookmarkDataDir();
}

function jsonlPath(): string {
  return path.join(bookmarksDir(), 'bookmarks.jsonl');
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

export class BookmarksManager extends EventEmitter {
  private watcher: chokidar.FSWatcher | null = null;
  private watcherPending = false;
  private cached: BookmarksSnapshot | null = null;

  getSnapshot(): BookmarksSnapshot {
    if (this.cached) return this.cached;
    return this.reload();
  }

  private reload(): BookmarksSnapshot {
    const p = jsonlPath();
    if (!fs.existsSync(p)) {
      this.cached = { bookmarks: [], folders: [] };
      return this.cached;
    }

    const { folders, folderMap } = loadFolders();
    const mediaIndex = indexMediaByTweetSource();

    const bookmarks: Bookmark[] = [];
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

    bookmarks.sort((a, b) => {
      const ta = new Date(a.postedAt).getTime() || 0;
      const tb = new Date(b.postedAt).getTime() || 0;
      return tb - ta;
    });

    this.cached = { bookmarks, folders };
    return this.cached;
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

    this.watcher = chokidar.watch(
      [jsonlPath(), foldersPath()],
      {
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

  stopWatcher(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}
