import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const manifestPath = path.resolve('automation/sources/x-bookmarks-media-manifest.json');
const mediaDir = path.resolve('automation/sources/x-bookmarks-media');
const maxBytes = 50 * 1024 * 1024;

const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const failed = manifest.entries.filter((e) => e.status === 'failed');

function sanitizeExt(contentType, sourceUrl) {
  if (contentType?.includes('jpeg')) return '.jpg';
  if (contentType?.includes('png')) return '.png';
  if (contentType?.includes('gif')) return '.gif';
  if (contentType?.includes('webp')) return '.webp';
  if (contentType?.includes('mp4')) return '.mp4';
  try {
    const ext = path.extname(new URL(sourceUrl).pathname);
    if (ext) return ext;
  } catch {}
  return '.bin';
}

let recovered = 0;
for (const entry of failed) {
  try {
    const response = await fetch(entry.sourceUrl);
    if (!response.ok) continue;
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) continue;
    const contentType = response.headers.get('content-type') ?? undefined;
    const digest = createHash('sha256').update(buffer).digest('hex').slice(0, 16);
    const ext = sanitizeExt(contentType, entry.sourceUrl);
    const filename = `${entry.tweetId}-${digest}${ext}`;
    const localPath = path.join(mediaDir, filename);
    await fs.writeFile(localPath, buffer);
    entry.localPath = localPath;
    entry.contentType = contentType;
    entry.bytes = buffer.byteLength;
    entry.status = 'downloaded';
    entry.reason = 'recovered on retry';
    entry.fetchedAt = new Date().toISOString();
    recovered += 1;
  } catch {}
}

manifest.failed = manifest.entries.filter((e) => e.status === 'failed').length;
manifest.downloaded = manifest.entries.filter((e) => e.status === 'downloaded').length;
manifest.generatedAt = new Date().toISOString();
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ retried: failed.length, recovered, remainingFailed: manifest.failed }, null, 2));
