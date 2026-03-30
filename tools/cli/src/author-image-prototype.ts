import path from 'node:path';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { ensureDir, readJsonLines } from './fs.js';
import { bookmarkMediaDir, twitterBookmarksCachePath } from './paths.js';
import type { BookmarkRecord } from './types.js';

export async function fetchAuthorImagePrototypes(cwd = process.cwd(), limit = 2) {
  const rows = await readJsonLines<BookmarkRecord>(twitterBookmarksCachePath(cwd));
  const chosen = rows.filter((r) => r.authorHandle && r.authorProfileImageUrl).slice(0, limit);
  const outDir = path.join(bookmarkMediaDir(cwd), 'author-prototypes');
  await ensureDir(outDir);

  const results = [];
  for (const row of chosen) {
    const url = row.authorProfileImageUrl!;
    const response = await fetch(url);
    if (!response.ok) {
      results.push({ tweetId: row.tweetId, authorHandle: row.authorHandle, sourceUrl: url, status: `HTTP ${response.status}` });
      continue;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
    const ext = contentType.includes('png') ? '.png' : '.jpg';
    const digest = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const filePath = path.join(outDir, `${row.authorHandle}-${digest}${ext}`);
    await writeFile(filePath, buffer);
    results.push({
      tweetId: row.tweetId,
      authorHandle: row.authorHandle,
      authorName: row.authorName,
      sourceUrl: url,
      localPath: filePath,
      bytes: buffer.byteLength,
      contentType,
      status: 'downloaded',
    });
  }
  return results;
}
