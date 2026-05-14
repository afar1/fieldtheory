import fs from 'fs';
import path from 'path';

const MARKDOWN_FILE_EXTENSION_RE = /\.(md|markdown|mdx)$/i;
const MARKDOWN_DOCUMENT_EXTENSION_RE = /\.(md|markdown)$/i;
const LIBRARY_TEXT_DOCUMENT_EXTENSION_RE = /\.(md|markdown|mdx|html?|css)$/i;
const LIBRARY_TEXT_DOCUMENT_EXTENSIONS = ['.md', '.markdown', '.mdx', '.html', '.htm', '.css'];

export function isPathInside(parentPath: string, childPath: string): boolean {
  const relPath = path.relative(parentPath, childPath);
  return relPath === ''
    || (!!relPath && relPath !== '..' && !relPath.startsWith(`..${path.sep}`) && !path.isAbsolute(relPath));
}

export function realpathIfExists(filePath: string): string | null {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return null;
  }
}

export function existingPathInsideRoots(filePath: string, rootPaths: string[]): string | null {
  const realFilePath = realpathIfExists(filePath);
  if (!realFilePath) return null;

  for (const rootPath of rootPaths) {
    const realRootPath = realpathIfExists(rootPath);
    if (realRootPath && isPathInside(realRootPath, realFilePath)) {
      return realFilePath;
    }
  }

  return null;
}

export function isMarkdownDocumentPath(filePath: string): boolean {
  return MARKDOWN_DOCUMENT_EXTENSION_RE.test(path.basename(filePath));
}

export type LibraryTextDocumentKind = 'markdown' | 'html' | 'css';

export function getLibraryTextDocumentKind(filePath: string): LibraryTextDocumentKind | null {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.md' || extension === '.markdown' || extension === '.mdx') return 'markdown';
  if (extension === '.html' || extension === '.htm') return 'html';
  if (extension === '.css') return 'css';
  return null;
}

export function isLibraryTextDocumentPath(filePath: string): boolean {
  return LIBRARY_TEXT_DOCUMENT_EXTENSION_RE.test(path.basename(filePath));
}

export function stripMarkdownFileExtension(fileName: string): string {
  return fileName.replace(MARKDOWN_FILE_EXTENSION_RE, '');
}

export function normalizeUserDocumentNameInput(name: string, options: { rejectLeadingUnderscore?: boolean } = {}): string | null {
  const trimmed = name.trim();
  if (!trimmed || trimmed.includes('\0') || /[\\/]/.test(trimmed)) return null;

  const stem = stripMarkdownFileExtension(trimmed).trim();
  if (!stem || stem === '.' || stem === '..' || stem.startsWith('.')) return null;
  if (options.rejectLeadingUnderscore && stem.startsWith('_')) return null;

  return trimmed;
}

export function markdownFileNameFromUserInput(name: string, options: { rejectLeadingUnderscore?: boolean } = {}): string | null {
  const normalized = normalizeUserDocumentNameInput(name, options);
  if (!normalized) return null;

  const lower = normalized.toLowerCase();
  const fileName = lower.endsWith('.md') || lower.endsWith('.markdown')
    ? normalized
    : `${normalized}.md`;
  return path.basename(fileName) === fileName ? fileName : null;
}

export function libraryTextDocumentFileNameFromUserInput(
  name: string,
  fallbackExtension = '.md',
  options: { rejectLeadingUnderscore?: boolean } = {},
): string | null {
  const normalized = normalizeUserDocumentNameInput(name, options);
  if (!normalized) return null;

  const lower = normalized.toLowerCase();
  const extension = LIBRARY_TEXT_DOCUMENT_EXTENSIONS.includes(fallbackExtension.toLowerCase())
    ? fallbackExtension
    : '.md';
  const fileName = LIBRARY_TEXT_DOCUMENT_EXTENSIONS.some((candidate) => lower.endsWith(candidate))
    ? normalized
    : `${normalized}${extension}`;
  return path.basename(fileName) === fileName ? fileName : null;
}

export function normalizeUserDocumentRelPathInput(relPath: string, options: { rejectHiddenSegments?: boolean } = {}): string | null {
  const trimmed = relPath.trim();
  if (!trimmed) return '';
  if (trimmed.includes('\0')) return null;

  const parts = trimmed.split(/[\\/]+/).map((part) => part.trim()).filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..' || part.startsWith('.'))) return null;
  if (options.rejectHiddenSegments && parts.some((part) => part.startsWith('_'))) return null;
  return parts.join('/');
}
