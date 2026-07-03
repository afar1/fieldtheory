import path from 'path';

const LOCAL_IMAGE_EXTENSIONS = new Set(['.avif', '.gif', '.jpg', '.jpeg', '.png', '.svg', '.webp']);

export function localImagePathFromProtocolUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;
    const root = hostname === 'users' ? 'Users' : hostname === 'volumes' ? 'Volumes' : hostname;
    const hostPrefix = root ? `/${root}` : '';
    return decodeURIComponent(`${hostPrefix}${parsed.pathname}`);
  } catch {
    return null;
  }
}

export function isAllowedLocalImagePath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return path.isAbsolute(filePath) && LOCAL_IMAGE_EXTENSIONS.has(ext);
}

export function getLocalImageContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.avif':
      return 'image/avif';
    case '.gif':
      return 'image/gif';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.svg':
      return 'image/svg+xml';
    case '.webp':
      return 'image/webp';
    default:
      return 'image/png';
  }
}

export function getLocalImageCacheHeaders(stat: { mtimeMs: number; size: number }): Record<string, string> {
  const mtimeMs = Math.trunc(stat.mtimeMs);
  return {
    'Cache-Control': 'private, max-age=3600',
    ETag: `"${mtimeMs.toString(36)}-${stat.size.toString(36)}"`,
    'Last-Modified': new Date(mtimeMs).toUTCString(),
  };
}

export function shouldReturnLocalImageNotModified(
  stat: { mtimeMs: number; size: number },
  headers: { ifNoneMatch?: string | string[] | null; ifModifiedSince?: string | string[] | null },
): boolean {
  const cacheHeaders = getLocalImageCacheHeaders(stat);
  const ifNoneMatch = firstHeaderValue(headers.ifNoneMatch);
  if (ifNoneMatch) {
    const etags = ifNoneMatch.split(',').map((etag) => etag.trim());
    if (etags.includes('*') || etags.includes(cacheHeaders.ETag)) return true;
  }

  const ifModifiedSince = firstHeaderValue(headers.ifModifiedSince);
  if (!ifModifiedSince) return false;
  const modifiedSince = Date.parse(ifModifiedSince);
  if (Number.isNaN(modifiedSince)) return false;
  return Math.floor(stat.mtimeMs / 1000) * 1000 <= modifiedSince;
}

function firstHeaderValue(value: string | string[] | null | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}
