import fs from 'fs';
import crypto from 'crypto';
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

export interface PortableMarkdownImagesShareResult {
  content: string;
  embedded: number;
  missing: number;
}

export interface PortableMarkdownImageOptions {
  libraryRoots?: string[];
}

export interface MarkdownAssetsConsolidationResult {
  filesScanned: number;
  filesRewritten: number;
  copied: number;
  rewritten: number;
  missing: number;
  deleted: number;
  skipped: number;
  oldFoldersRemoved: number;
  errors: string[];
}

const PRIVATE_FIELD_THEORY_FIGURES_RE = /\/Library\/Application Support\/fieldtheory-mac\/users\/[^/]+\/figures\//i;
const MARKDOWN_FILE_RE = /\.(?:md|markdown)$/i;
const MARKDOWN_IMAGE_RE = /!\[([^\]\n]*(?:\\.[^\]\n]*)*)\]\((<[^>\n]+>|[^)\s]+)\)/g;
const ASSETS_DIR_NAME = '.assets';
const LEGACY_ASSETS_DIR_RE = /\.assets$/i;
const DATA_IMAGE_RE = /^data:(image\/(?:avif|gif|jpe?g|png|svg\+xml|webp));base64,([a-z0-9+/=\s]+)$/i;

function documentAssetsDir(documentPath: string): string {
  const ext = path.extname(documentPath);
  const base = path.basename(documentPath, ext || undefined);
  return path.join(path.dirname(documentPath), `${base}.assets`);
}

function normalizeRootPath(rootPath: string): string | null {
  if (!path.isAbsolute(rootPath)) return null;
  return path.resolve(rootPath);
}

function libraryRootForDocument(documentPath: string, options: PortableMarkdownImageOptions = {}): string {
  const resolvedDocumentPath = path.resolve(documentPath);
  const roots = (options.libraryRoots ?? [])
    .map(normalizeRootPath)
    .filter((rootPath): rootPath is string => !!rootPath)
    .filter((rootPath) => resolvedDocumentPath === rootPath || isPathInside(rootPath, resolvedDocumentPath))
    .sort((a, b) => b.length - a.length);
  return roots[0] ?? path.dirname(resolvedDocumentPath);
}

function libraryAssetsDirForDocument(documentPath: string, options: PortableMarkdownImageOptions = {}): string {
  return path.join(libraryRootForDocument(documentPath, options), ASSETS_DIR_NAME);
}

function encodeMarkdownPathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function markdownDestinationForCopiedPath(documentPath: string, copiedPath: string): string {
  const relPath = path.relative(path.dirname(documentPath), copiedPath).split(path.sep).map(encodeMarkdownPathSegment).join('/');
  return relPath.startsWith('..') ? relPath : `./${relPath}`;
}

function markdownImage(destination: string, alt = 'Image'): string {
  return `![${alt.replace(/\]/g, '\\]')}](<${destination}>)`;
}

function rawMarkdownDestination(destination: string): string {
  return destination.trim().replace(/^<(.+)>$/, '$1');
}

function localPathFromMarkdownDestination(destination: string): string | null {
  const raw = rawMarkdownDestination(destination);
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

function localRelativePathFromMarkdownDestination(documentPath: string, destination: string): string | null {
  const raw = rawMarkdownDestination(destination);
  if (!raw || path.isAbsolute(raw) || /^[a-z][a-z0-9+.-]*:/i.test(raw)) return null;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return path.resolve(path.dirname(documentPath), decoded);
}

function copiedAssetPathFromMarkdownDestination(
  documentPath: string,
  destination: string,
  options: PortableMarkdownImageOptions = {},
): string | null {
  const assetPath = localRelativePathFromMarkdownDestination(documentPath, destination);
  if (!assetPath) return null;
  const assetsDir = libraryAssetsDirForDocument(documentPath, options);
  const legacyAssetsDir = documentAssetsDir(documentPath);
  if (isPathInside(assetsDir, assetPath)) return assetPath;
  if (isPathInside(legacyAssetsDir, assetPath)) return assetPath;
  const rootDir = libraryRootForDocument(documentPath, options);
  return isPathInside(rootDir, assetPath) && LEGACY_ASSETS_DIR_RE.test(path.basename(path.dirname(assetPath)))
    ? assetPath
    : null;
}

function shouldConsolidateRelativeAsset(documentPath: string, destination: string, options: PortableMarkdownImageOptions): string | null {
  const assetPath = localRelativePathFromMarkdownDestination(documentPath, destination);
  if (!assetPath || !fs.existsSync(assetPath)) return null;
  const assetsDir = libraryAssetsDirForDocument(documentPath, options);
  if (isPathInside(assetsDir, assetPath)) return null;
  if (LEGACY_ASSETS_DIR_RE.test(path.basename(path.dirname(assetPath)))) return assetPath;
  return null;
}

function isPrivateFieldTheoryFigurePath(filePath: string): boolean {
  return PRIVATE_FIELD_THEORY_FIGURES_RE.test(filePath);
}

function extensionForMimeType(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case 'image/avif': return '.avif';
    case 'image/gif': return '.gif';
    case 'image/jpeg':
    case 'image/jpg': return '.jpg';
    case 'image/svg+xml': return '.svg';
    case 'image/webp': return '.webp';
    default: return '.png';
  }
}

function mimeTypeForExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.avif': return 'image/avif';
    case '.gif': return 'image/gif';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.svg': return 'image/svg+xml';
    case '.webp': return 'image/webp';
    default: return 'image/png';
  }
}

function dataUrlForImagePath(filePath: string): string | null {
  if (!isAllowedLocalImagePath(filePath) || !fs.existsSync(filePath)) return null;
  const mime = mimeTypeForExtension(path.extname(filePath));
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

function hashBytes(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function assetPathForBytes(dir: string, bytes: Buffer, ext: string): string {
  return path.join(dir, `sha256-${hashBytes(bytes)}${ext.toLowerCase() || '.png'}`);
}

function copyImageBytesForMarkdownDocument(
  documentPath: string,
  bytes: Buffer,
  ext: string,
  alt = 'Image',
  options: PortableMarkdownImageOptions = {},
): PortableMarkdownImageCopyResult | null {
  if (!path.isAbsolute(documentPath)) return null;
  const assetsDir = libraryAssetsDirForDocument(documentPath, options);
  fs.mkdirSync(assetsDir, { recursive: true });
  const copiedPath = assetPathForBytes(assetsDir, bytes, ext);
  if (!fs.existsSync(copiedPath)) fs.writeFileSync(copiedPath, bytes);
  const destination = markdownDestinationForCopiedPath(documentPath, copiedPath);
  return {
    markdown: markdownImage(destination, alt),
    destination,
    copiedPath,
  };
}

export function copyImageForMarkdownDocument(
  documentPath: string,
  imagePath: string,
  alt = 'Image',
  options: PortableMarkdownImageOptions = {},
): PortableMarkdownImageCopyResult | null {
  if (!path.isAbsolute(documentPath) || !isAllowedLocalImagePath(imagePath) || !fs.existsSync(imagePath)) return null;
  return copyImageBytesForMarkdownDocument(documentPath, fs.readFileSync(imagePath), path.extname(imagePath) || '.png', alt, options);
}

export function makeMarkdownImagesPortable(
  documentPath: string,
  content: string,
  options: PortableMarkdownImageOptions = {},
): PortableMarkdownImagesRepairResult {
  let copied = 0;
  let rewritten = 0;
  let missing = 0;

  const nextContent = content.replace(MARKDOWN_IMAGE_RE, (match, alt: string, destination: string) => {
    const dataMatch = rawMarkdownDestination(destination).match(DATA_IMAGE_RE);
    if (dataMatch) {
      const bytes = Buffer.from(dataMatch[2].replace(/\s+/g, ''), 'base64');
      const result = copyImageBytesForMarkdownDocument(documentPath, bytes, extensionForMimeType(dataMatch[1]), alt || 'Image', options);
      if (!result) {
        missing += 1;
        return match;
      }
      copied += 1;
      rewritten += 1;
      return result.markdown;
    }
    const sourcePath = localPathFromMarkdownDestination(destination);
    const legacyAssetPath = shouldConsolidateRelativeAsset(documentPath, destination, options);
    const copySourcePath = sourcePath && isPrivateFieldTheoryFigurePath(sourcePath)
      ? sourcePath
      : legacyAssetPath;
    if (!copySourcePath) return match;
    const result = copyImageForMarkdownDocument(documentPath, copySourcePath, alt || 'Image', options);
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

export function makeMarkdownImagesSharePortable(
  documentPath: string,
  content: string,
  options: PortableMarkdownImageOptions = {},
): PortableMarkdownImagesShareResult {
  let embedded = 0;
  let missing = 0;
  const nextContent = content.replace(MARKDOWN_IMAGE_RE, (match, alt: string, destination: string) => {
    if (DATA_IMAGE_RE.test(rawMarkdownDestination(destination))) return match;
    const assetPath = copiedAssetPathFromMarkdownDestination(documentPath, destination, options);
    if (!assetPath) return match;
    const dataUrl = dataUrlForImagePath(assetPath);
    if (!dataUrl) {
      missing += 1;
      return match;
    }
    embedded += 1;
    return markdownImage(dataUrl, alt || 'Image');
  });
  return { content: nextContent, embedded, missing };
}

function walkMarkdownFiles(rootDir: string): string[] {
  const files: string[] = [];
  const walk = (currentDir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ASSETS_DIR_NAME || LEGACY_ASSETS_DIR_RE.test(entry.name)) continue;
        walk(entryPath);
      } else if (entry.isFile() && MARKDOWN_FILE_RE.test(entry.name)) {
        files.push(entryPath);
      }
    }
  };
  walk(rootDir);
  return files;
}

function referencedAssetPathsForLibraryRoot(
  rootDir: string,
  options: PortableMarkdownImageOptions,
  contentOverride?: { documentPath: string; content: string },
): Set<string> {
  const referenced = new Set<string>();
  const files = walkMarkdownFiles(rootDir);
  if (contentOverride && !files.includes(contentOverride.documentPath)) files.push(contentOverride.documentPath);
  for (const filePath of files) {
    let content: string;
    try {
      content = contentOverride?.documentPath === filePath
        ? contentOverride.content
        : fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }
    for (const match of content.matchAll(MARKDOWN_IMAGE_RE)) {
      const assetPath = copiedAssetPathFromMarkdownDestination(filePath, match[2], options);
      if (assetPath) referenced.add(assetPath);
    }
  }
  return referenced;
}

function removeEmptyLegacyAssetFolders(rootDir: string): number {
  let removed = 0;
  const folders: string[] = [];
  const walk = (currentDir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (!entry.isDirectory()) continue;
      if (entry.name === ASSETS_DIR_NAME) continue;
      if (LEGACY_ASSETS_DIR_RE.test(entry.name)) {
        folders.push(entryPath);
        continue;
      }
      walk(entryPath);
    }
  };
  walk(rootDir);
  for (const folderPath of folders.sort((a, b) => b.length - a.length)) {
    try {
      if (fs.readdirSync(folderPath).length === 0) {
        fs.rmdirSync(folderPath);
        removed += 1;
      }
    } catch {
      // Leave folders alone if they cannot be read or removed.
    }
  }
  return removed;
}

export function consolidateMarkdownAssetsForLibraryRoot(rootDir: string): MarkdownAssetsConsolidationResult {
  const result: MarkdownAssetsConsolidationResult = {
    filesScanned: 0,
    filesRewritten: 0,
    copied: 0,
    rewritten: 0,
    missing: 0,
    deleted: 0,
    skipped: 0,
    oldFoldersRemoved: 0,
    errors: [],
  };
  const rootPath = normalizeRootPath(rootDir);
  if (!rootPath || !fs.existsSync(rootPath)) return result;
  const options = { libraryRoots: [rootPath] };
  for (const filePath of walkMarkdownFiles(rootPath)) {
    result.filesScanned += 1;
    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    const repaired = makeMarkdownImagesPortable(filePath, content, options);
    result.copied += repaired.copied;
    result.rewritten += repaired.rewritten;
    result.missing += repaired.missing;
    if (repaired.content === content) continue;
    try {
      fs.writeFileSync(filePath, repaired.content, 'utf-8');
      result.filesRewritten += 1;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const referenced = referencedAssetPathsForLibraryRoot(rootPath, options);
  const legacyAssetFiles: string[] = [];
  const walkLegacyAssets = (currentDir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === ASSETS_DIR_NAME) continue;
        if (LEGACY_ASSETS_DIR_RE.test(entry.name)) {
          for (const legacyEntry of fs.readdirSync(entryPath, { withFileTypes: true })) {
            if (legacyEntry.isFile()) legacyAssetFiles.push(path.join(entryPath, legacyEntry.name));
          }
          continue;
        }
        walkLegacyAssets(entryPath);
      }
    }
  };
  walkLegacyAssets(rootPath);
  for (const legacyAsset of legacyAssetFiles) {
    if (referenced.has(legacyAsset)) {
      result.skipped += 1;
      continue;
    }
    try {
      fs.unlinkSync(legacyAsset);
      result.deleted += 1;
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  result.oldFoldersRemoved = removeEmptyLegacyAssetFolders(rootPath);
  return result;
}

export function deleteUnusedCopiedMarkdownImages(
  documentPath: string,
  removedMarkdown: string,
  remainingContent: string,
  options: PortableMarkdownImageOptions = {},
): PortableMarkdownImagesDeleteResult {
  if (!path.isAbsolute(documentPath)) return { deleted: 0, skipped: 0, missing: 0 };
  const rootDir = libraryRootForDocument(documentPath, options);
  const referencedAssets = referencedAssetPathsForLibraryRoot(rootDir, options, { documentPath, content: remainingContent });

  let deleted = 0;
  let skipped = 0;
  let missing = 0;
  const seenRemovedAssets = new Set<string>();
  for (const match of removedMarkdown.matchAll(MARKDOWN_IMAGE_RE)) {
    const assetPath = copiedAssetPathFromMarkdownDestination(documentPath, match[2], options);
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
