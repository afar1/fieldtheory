import path from 'path';
import fs from 'fs';
import os from 'os';
import { EventEmitter } from 'events';
import * as chokidar from 'chokidar';
import { createLogger } from './logger';

const log = createLogger('Bookmarks');

export interface BookmarkImage {
  url: string;
  width: number;
  height: number;
  type: 'photo' | 'video' | 'animated_gif' | string;
  videoUrl?: string;
}

export interface QuotedTweet {
  id: string;
  text: string;
  authorHandle: string;
  authorName: string;
  authorAvatar: string;
  postedAt: string;
  url: string;
  images: BookmarkImage[];
}

export interface Bookmark {
  id: string;
  text: string;
  url: string;
  authorHandle: string;
  authorName: string;
  authorAvatar: string;
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
  const ftDataDir = process.env.FT_DATA_DIR;
  return ftDataDir ?? path.join(os.homedir(), '.ft-bookmarks');
}

function jsonlPath(): string {
  return path.join(bookmarksDir(), 'bookmarks.jsonl');
}

function foldersPath(): string {
  return path.join(bookmarksDir(), 'folders-data.json');
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

export function parseRawBookmark(raw: RawBookmark): Bookmark | null {
  const id = raw.tweetId || raw.id;
  if (!id) return null;

  const images = extractImages(raw);

  return {
    id,
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
