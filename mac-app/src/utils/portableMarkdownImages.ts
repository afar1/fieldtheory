const SAFE_REMOTE_IMAGE_URL_RE = /^(https?|ftlocalfile|ftmedia):/i;
const LOCAL_IMAGE_EXTENSION_RE = /\.(avif|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i;

function stripMarkdownDestinationBrackets(destination: string): string {
  return destination.trim().replace(/^<(.+)>$/, '$1');
}

function encodeAbsolutePathAsFileUrl(filePath: string): string {
  return `file://${filePath.split('/').map((part, index) => (
    index === 0 ? '' : encodeURIComponent(part)
  )).join('/')}`;
}

function normalizeAbsolutePath(filePath: string): string {
  const parts: string[] = [];
  for (const part of filePath.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `/${parts.join('/')}`;
}

function dirname(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index > 0 ? filePath.slice(0, index) : '/';
}

export function resolveRelativeMarkdownImageUrl(destination: string, documentPath?: string | null): string | null {
  const raw = stripMarkdownDestinationBrackets(destination);
  if (!raw || raw.startsWith('#') || raw.startsWith('/')) return null;
  if (SAFE_REMOTE_IMAGE_URL_RE.test(raw) || /^file:/i.test(raw) || /^data:image\//i.test(raw)) return null;
  if (!documentPath || !documentPath.startsWith('/')) return null;

  const relativePath = raw.split(/[?#]/, 1)[0] ?? raw;
  if (!LOCAL_IMAGE_EXTENSION_RE.test(relativePath)) return null;

  try {
    const decoded = decodeURIComponent(relativePath);
    const resolvedPath = normalizeAbsolutePath(`${dirname(documentPath)}/${decoded}`);
    return encodeAbsolutePathAsFileUrl(resolvedPath).replace(/^file:/i, 'ftlocalfile:');
  } catch {
    return null;
  }
}

export function normalizeMarkdownImageUrl(destination: string, documentPath?: string | null): string | null {
  const raw = stripMarkdownDestinationBrackets(destination);
  if (/^file:/i.test(raw)) return raw.replace(/^file:/i, 'ftlocalfile:');
  if (SAFE_REMOTE_IMAGE_URL_RE.test(raw)) return raw;
  if (/^data:image\//i.test(raw)) return raw;
  return resolveRelativeMarkdownImageUrl(raw, documentPath);
}
