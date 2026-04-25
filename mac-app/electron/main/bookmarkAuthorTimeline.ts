import type { Bookmark } from './bookmarksManager';

export interface BookmarkAuthorSummary {
  handle: string;
  name: string;
  count: number;
  firstPostedAt: string;
  lastPostedAt: string;
}

export function normalizeBookmarkAuthorHandle(handle: string): string {
  return handle.trim().replace(/^@+/, '').toLowerCase();
}

function cleanHandle(handle: string): string {
  return handle.trim().replace(/^@+/, '');
}

function displayHandle(handle: string): string {
  const normalized = cleanHandle(handle);
  return normalized ? `@${normalized}` : '';
}

function timestamp(postedAt: string): number {
  return new Date(postedAt).getTime() || 0;
}

function bookmarkTime(bookmark: Bookmark): number {
  return timestamp(bookmark.postedAt);
}

function formatBookmarkDate(postedAt: string): string {
  const time = new Date(postedAt).getTime();
  if (!time) return 'undated';
  return new Date(time).toISOString().slice(0, 10);
}

function bookmarkAuthorTitle(bookmark: Bookmark): string {
  const name = bookmark.authorName.trim();
  const handle = displayHandle(bookmark.authorHandle);
  if (name && handle) return `${name} (${handle})`;
  return name || handle || 'Unknown author';
}

export function buildBookmarkAuthorSummaries(bookmarks: Bookmark[]): BookmarkAuthorSummary[] {
  const byHandle = new Map<string, BookmarkAuthorSummary>();

  for (const bookmark of bookmarks) {
    const key = normalizeBookmarkAuthorHandle(bookmark.authorHandle);
    if (!key) continue;

    const existing = byHandle.get(key);
    if (!existing) {
      const handle = cleanHandle(bookmark.authorHandle);
      byHandle.set(key, {
        handle,
        name: bookmark.authorName || handle,
        count: 1,
        firstPostedAt: bookmark.postedAt,
        lastPostedAt: bookmark.postedAt,
      });
      continue;
    }

    existing.count += 1;
    if (!existing.name && bookmark.authorName) existing.name = bookmark.authorName;

    const currentTime = bookmarkTime(bookmark);
    const firstTime = timestamp(existing.firstPostedAt);
    const lastTime = timestamp(existing.lastPostedAt);
    if (currentTime && (!firstTime || currentTime < firstTime)) {
      existing.firstPostedAt = bookmark.postedAt;
    }
    if (currentTime && currentTime > lastTime) {
      existing.lastPostedAt = bookmark.postedAt;
    }
  }

  return [...byHandle.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.handle.localeCompare(b.handle);
  });
}

export function bookmarksForAuthor(handle: string, bookmarks: Bookmark[]): Bookmark[] {
  const key = normalizeBookmarkAuthorHandle(handle);
  if (!key) return [];

  return bookmarks
    .filter((bookmark) => normalizeBookmarkAuthorHandle(bookmark.authorHandle) === key)
    .sort((a, b) => bookmarkTime(a) - bookmarkTime(b));
}

export function bookmarkById(id: string, bookmarks: Bookmark[]): Bookmark | null {
  return bookmarks.find((bookmark) => bookmark.id === id) ?? null;
}

export function formatBookmarkPost(bookmark: Bookmark): string {
  const lines = [
    `# ${formatBookmarkDate(bookmark.postedAt)} - ${bookmarkAuthorTitle(bookmark)}`,
    bookmark.text.trim(),
  ];

  if (bookmark.url) lines.push(bookmark.url);
  if (bookmark.quotedTweet?.text) {
    lines.push(`Quoted ${displayHandle(bookmark.quotedTweet.authorHandle)}: ${bookmark.quotedTweet.text.trim()}`);
  }

  return lines.filter(Boolean).join('\n\n');
}

export function formatBookmarkAuthorTimeline(handle: string, bookmarks: Bookmark[]): string | null {
  const authorBookmarks = bookmarksForAuthor(handle, bookmarks);
  if (authorBookmarks.length === 0) return null;

  const namedBookmark = authorBookmarks.find((bookmark) => bookmark.authorName.trim()) ?? authorBookmarks[0];
  const handledBookmark = authorBookmarks.find((bookmark) => bookmark.authorHandle.trim()) ?? authorBookmarks[0];
  const name = namedBookmark.authorName.trim();
  const handleText = displayHandle(handledBookmark.authorHandle || handle);
  const title = name && handleText ? `${name} (${handleText})` : (handleText || name || handle);

  const sections = authorBookmarks.map((bookmark, index) => {
    return [
      `${index + 1}. ${formatBookmarkDate(bookmark.postedAt)} - ${displayHandle(bookmark.authorHandle)}`,
      bookmark.text.trim(),
      bookmark.url,
      bookmark.quotedTweet?.text
        ? `Quoted ${displayHandle(bookmark.quotedTweet.authorHandle)}: ${bookmark.quotedTweet.text.trim()}`
        : '',
    ].filter(Boolean).join('\n');
  });

  return [`# Bookmarked posts from ${title}`, ...sections].join('\n\n');
}
