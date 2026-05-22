import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { isAllowedLocalImagePath, localImagePathFromProtocolUrl } from './localImageProtocol';

export interface PortableMarkdownImageCopyResult {
  markdown: string;
  destination: string;
  copiedPath: string;
}

export interface PortableMarkdownImagesRepairResult {
  content: string;
  copied: number;
  rewritten: number;
  missing: number;
}

export interface PortableMarkdownImagesDeleteResult {
  deleted: number;
  skipped: number;
  missing: number;
}

const PRIVATE_FIELD_THEORY_FIGURES_RE = /\/Library\/Application Support\/fieldtheory-mac\/users\/[^/]+\/figures\//i;
const MARKDOWN_IMAGE_RE = /!\[([^\]\n]*(?:\\.[^\]\n]*)*)\]\((<[^>\n]+>|[^)\s]+)\)/g;

function documentAssetsDir(documentPath: string): string {
  const ext = path.extname(documentPath);
  const base = path.basename(documentPath, ext || undefined);
  return path.join(path.dirname(documentPath), `${base}.assets`);
}

function encodeMarkdownPathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function markdownDestinationForCopiedPath(documentPath: string, copiedPath: string): string {
  const relPath = path.relative(path.dirname(documentPath), copiedPath).split(path.sep).map(encodeMarkdownPathSegment).join('/');
  return `./${relPath}`;
}

function markdownImage(destination: string, alt = 'Image'): string {
  return `![${alt.replace(/\]/g, '\\]')}](<${destination}>)`;
}

function localPathFromMarkdownDestination(destination: string): string | null {
  const raw = destination.trim().replace(/^<(.+)>$/, '$1');
  if (/^file:/i.test(raw)) {
    try {
      return fileURLToPath(raw);
    } catch {
      return null;
    }
  }
  if (/^ftlocalfile:/i.test(raw)) return localImagePathFromProtocolUrl(raw);
  if (raw.startsWith('~/')) return path.join(os.homedir(), raw.slice(2));
  if (path.isAbsolute(raw)) return raw;
  return null;
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const relPath = path.relative(parentPath, childPath);
  return relPath !== '' && !relPath.startsWith('..') && !path.isAbsolute(relPath);
}

function copiedAssetPathFromMarkdownDestination(documentPath: string, destination: string): string | null {
  const raw = destination.trim().replace(/^<(.+)>$/, '$1');
  if (!raw || path.isAbsolute(raw) || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const assetsDir = documentAssetsDir(documentPath);
  const assetPath = path.resolve(path.dirname(documentPath), decoded);
  return isPathInside(assetsDir, assetPath) ? assetPath : null;
}

function isPrivateFieldTheoryFigurePath(filePath: string): boolean {
  return PRIVATE_FIELD_THEORY_FIGURES_RE.test(filePath);
}

function uniqueDestinationPath(dir: string, sourcePath: string): string {
  const ext = path.extname(sourcePath) || '.png';
  const rawBase = path.basename(sourcePath, path.extname(sourcePath)) || 'Image';
  const base = rawBase.replace(/[^\w .()-]+/g, '-').replace(/\s+/g, ' ').trim() || 'Image';
  let candidate = path.join(dir, `${base}${ext}`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}-${index}${ext}`);
    index += 1;
  }
  return candidate;
}

export function copyImageForMarkdownDocument(documentPath: string, imagePath: string, alt = 'Image'): PortableMarkdownImageCopyResult | null {
  if (!path.isAbsolute(documentPath) || !isAllowedLocalImagePath(imagePath) || !fs.existsSync(imagePath)) return null;
  const assetsDir = documentAssetsDir(documentPath);
  fs.mkdirSync(assetsDir, { recursive: true });
  const copiedPath = uniqueDestinationPath(assetsDir, imagePath);
  fs.copyFileSync(imagePath, copiedPath);
  const destination = markdownDestinationForCopiedPath(documentPath, copiedPath);
  return {
    markdown: markdownImage(destination, alt),
    destination,
    copiedPath,
  };
}

export function makeMarkdownImagesPortable(documentPath: string, content: string): PortableMarkdownImagesRepairResult {
  let copied = 0;
  let rewritten = 0;
  let missing = 0;

  const nextContent = content.replace(MARKDOWN_IMAGE_RE, (match, alt: string, destination: string) => {
    const sourcePath = localPathFromMarkdownDestination(destination);
    if (!sourcePath || !isPrivateFieldTheoryFigurePath(sourcePath)) return match;
    const result = copyImageForMarkdownDocument(documentPath, sourcePath, alt || 'Image');
    if (!result) {
      missing += 1;
      return match;
    }
    copied += 1;
    rewritten += 1;
    return result.markdown;
  });

  return {
    content: nextContent,
    copied,
    rewritten,
    missing,
  };
}

export function deleteUnusedCopiedMarkdownImages(
  documentPath: string,
  removedMarkdown: string,
  remainingContent: string,
): PortableMarkdownImagesDeleteResult {
  if (!path.isAbsolute(documentPath)) return { deleted: 0, skipped: 0, missing: 0 };

  const referencedAssets = new Set<string>();
  for (const match of remainingContent.matchAll(MARKDOWN_IMAGE_RE)) {
    const assetPath = copiedAssetPathFromMarkdownDestination(documentPath, match[2]);
    if (assetPath) referencedAssets.add(assetPath);
  }

  let deleted = 0;
  let skipped = 0;
  let missing = 0;
  const seenRemovedAssets = new Set<string>();
  for (const match of removedMarkdown.matchAll(MARKDOWN_IMAGE_RE)) {
    const assetPath = copiedAssetPathFromMarkdownDestination(documentPath, match[2]);
    if (!assetPath || seenRemovedAssets.has(assetPath) || referencedAssets.has(assetPath)) {
      skipped += 1;
      continue;
    }
    seenRemovedAssets.add(assetPath);
    if (!fs.existsSync(assetPath)) {
      missing += 1;
      continue;
    }
    fs.unlinkSync(assetPath);
    deleted += 1;
  }

  return { deleted, skipped, missing };
}
