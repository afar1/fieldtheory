import fs from 'fs';
import type { Bookmark } from './bookmarksManager';

function bookmarkTime(bookmark: Bookmark): number {
  return new Date(bookmark.postedAt).getTime() || 0;
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function tweetIdFromUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    if (host !== 'x.com' && host !== 'twitter.com') return null;
    const match = parsed.pathname.match(/\/status\/(\d+)/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function normalizedUrlKey(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    parsed.hash = '';
    parsed.search = '';
    parsed.hostname = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    return `url:${parsed.origin.toLowerCase()}${parsed.pathname.replace(/\/$/, '')}`;
  } catch {
    return null;
  }
}

function bookmarkKeys(bookmark: Bookmark): string[] {
  const tweetId = tweetIdFromUrl(bookmark.url);
  return [
    bookmark.id ? `tweet:${bookmark.id}` : '',
    tweetId ? `tweet:${tweetId}` : '',
    normalizedUrlKey(bookmark.url) ?? '',
  ].filter(Boolean);
}

export function extractBookmarkSourceKeys(markdown: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const urlPattern = /https?:\/\/[^\s)\]]+/g;
  for (const match of markdown.matchAll(urlPattern)) {
    const rawUrl = match[0].replace(/[.,;:!?]+$/, '');
    const tweetId = tweetIdFromUrl(rawUrl);
    const key = tweetId ? `tweet:${tweetId}` : normalizedUrlKey(rawUrl);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function isBookmarkTaxonomyFilePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').replace(/\.md$/i, '');
  return [
    '/.fieldtheory/library/categories/',
    '/.fieldtheory/library/domains/',
    '/.fieldtheory/library/entities/',
    '/.fieldtheory/library/bookmarks-from-x/categories/',
    '/.fieldtheory/library/bookmarks-from-x/domains/',
    '/.fieldtheory/library/bookmarks-from-x/entities/',
    '/.ft-bookmarks/md/categories/',
    '/.ft-bookmarks/md/domains/',
    '/.ft-bookmarks/md/entities/',
    '/.ft-bookmarks/md/bookmarks-from-x/categories/',
    '/.ft-bookmarks/md/bookmarks-from-x/domains/',
    '/.ft-bookmarks/md/bookmarks-from-x/entities/',
  ].some((marker) => normalized.includes(marker));
}

export function bookmarksForTaxonomyFiles(filePaths: string[], bookmarks: Bookmark[]): Bookmark[] {
  const orderedKeys: string[] = [];
  const seenKeys = new Set<string>();

  for (const filePath of filePaths) {
    if (!isBookmarkTaxonomyFilePath(filePath) || !fs.existsSync(filePath)) continue;
    let keys: string[];
    try {
      keys = extractBookmarkSourceKeys(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      continue;
    }
    for (const key of keys) {
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      orderedKeys.push(key);
    }
  }

  if (orderedKeys.length === 0) return [];

  const bookmarkByKey = new Map<string, Bookmark>();
  for (const bookmark of bookmarks) {
    for (const key of bookmarkKeys(bookmark)) {
      if (!bookmarkByKey.has(key)) bookmarkByKey.set(key, bookmark);
    }
  }

  const seenBookmarks = new Set<string>();
  const matches: Bookmark[] = [];
  for (const key of orderedKeys) {
    const bookmark = bookmarkByKey.get(key);
    if (!bookmark || seenBookmarks.has(bookmark.id)) continue;
    seenBookmarks.add(bookmark.id);
    matches.push(bookmark);
  }
  return matches;
}

export function searchBookmarks(query: string, bookmarks: Bookmark[]): Bookmark[] {
  const terms = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  return bookmarks
    .filter((bookmark) => {
      const haystack = normalizeSearchText([
        bookmark.text,
        bookmark.url,
        bookmark.authorHandle,
        bookmark.authorName,
        bookmark.quotedTweet?.text ?? '',
        bookmark.quotedTweet?.authorHandle ?? '',
        bookmark.quotedTweet?.authorName ?? '',
        ...bookmark.folders,
      ].join(' '));
      return terms.every((term) => haystack.includes(term));
    })
    .sort((a, b) => bookmarkTime(b) - bookmarkTime(a));
}
