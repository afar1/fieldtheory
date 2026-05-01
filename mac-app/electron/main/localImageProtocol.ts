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
