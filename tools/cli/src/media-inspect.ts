import { readJsonLines } from './fs.js';
import { twitterBookmarksCachePath } from './paths.js';
import type { BookmarkRecord } from './types.js';

export async function inspectStoredMovingMedia(cwd = process.cwd(), limit = 5): Promise<any[]> {
  const rows = await readJsonLines<BookmarkRecord>(twitterBookmarksCachePath(cwd));
  return rows
    .filter((row) => (row.mediaObjects ?? []).some((m) => (m.type && m.type !== 'photo') || (m.variants?.length ?? 0) > 0))
    .slice(0, limit)
    .map((row) => ({
      tweetId: row.tweetId,
      url: row.url,
      authorHandle: row.authorHandle,
      mediaObjects: row.mediaObjects,
    }));
}
