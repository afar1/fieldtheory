import path from 'path';
import { parseMarkdownFrontmatter } from '../shared/markdownFrontmatter';
import { type FieldTheoryPathOptions, sharedFilesCacheDir, sharedFilesDir } from './fieldTheoryPaths';

export const SHARED_FILES_UI_LABEL = 'River (shared)';
export const SHARED_FILES_DOMAIN = 'Shared';

export type SharedFileType = 'document' | 'command' | 'plan';
export type SharedFileKind = 'document' | 'command';
export type SharedFileContentType = 'markdown';

export interface SharedFrontmatterMetadata {
  kind: SharedFileKind;
  type: SharedFileContentType;
  sharedPath: string;
  title?: string;
  sharedDocumentId?: string;
  teamScopeUserId?: string;
  authorName?: string;
  authorInitials?: string;
  updatedAt?: string;
}

export interface ParsedSharedFrontmatterMetadata extends SharedFrontmatterMetadata {
  source: 'shared';
  visibility: 'team';
}

export interface SharedConflictFileNameOptions {
  authorName?: string | null;
  timestamp?: Date;
}

export interface SharedFileFrontmatter {
  sharedId: string;
  title?: string;
  teamId?: string;
  teamName?: string;
  authorId?: string;
  authorName?: string;
  authorInitials?: string;
  authorCallsign?: string;
  type: SharedFileType;
  originalSourcePath?: string;
  revision?: number;
}

function safeFileNamePart(value: string): string {
  return (value.trim() || 'Untitled')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 120)
    .trim() || 'Untitled';
}

function markdownExtension(fileName: string): string {
  return fileName.toLowerCase().endsWith('.markdown') ? '.markdown' : '.md';
}

function stripMarkdownExtension(fileName: string): string {
  return fileName.replace(/\.(md|markdown)$/i, '');
}

function quoteYamlScalar(value: string): string {
  return JSON.stringify(value);
}

function normalizeInitials(value: string | undefined): string {
  return (value ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6);
}

const SHARED_MANAGED_FRONTMATTER_RE = /^\s*(source|visibility|type|kind|title|shared|shared_[A-Za-z0-9_]+)\s*:/i;
const SHARED_CACHE_FRONTMATTER_RE = /^\s*shared(?:_|:)/i;

function isWindowsAbsolutePath(rawPath: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(rawPath) || rawPath.startsWith('\\\\');
}

function isSharedMarkdownPath(relPath: string): boolean {
  return /\.(md|markdown)$/i.test(relPath);
}

export function inferSharedFileType(input: { filePath?: string | null; content?: string | null }): SharedFileType {
  const meta = input.content ? parseMarkdownFrontmatter(input.content).meta : {};
  if (meta.kind?.toLowerCase() === 'command' || meta.type?.toLowerCase() === 'command') return 'command';

  const normalizedPath = (input.filePath ?? '').replace(/\\/g, '/').toLowerCase();
  if (normalizedPath.includes('/commands/')) return 'command';
  if (normalizedPath.includes('/plans/')) return 'plan';
  return 'document';
}

export function normalizeSharedRelativePath(sourcePath: string): string | null {
  const normalized = sourcePath.trim();
  if (!normalized || normalized.includes('\0')) return null;
  if (normalized.startsWith('/') || path.isAbsolute(normalized) || isWindowsAbsolutePath(normalized) || normalized.includes('\\')) {
    return null;
  }

  const parts = normalized.split('/');
  if (parts.length === 0) return null;
  if (parts.some((part) => !part || !part.trim() || part === '.' || part === '..' || part.startsWith('.'))) return null;

  const fileName = parts[parts.length - 1] ?? '';
  if (!isSharedMarkdownPath(fileName)) return null;
  return parts.join('/');
}

export function sharedFilesRoot(options?: FieldTheoryPathOptions): string {
  return sharedFilesDir(options);
}

export function isSharedFilesPath(filePath: string, options?: FieldTheoryPathOptions): boolean {
  const relative = path.relative(sharedFilesRoot(options), path.resolve(filePath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function sharedCachePathForRelativePath(
  relPath: string,
  options?: FieldTheoryPathOptions,
): string | null {
  const normalized = normalizeSharedRelativePath(relPath);
  if (!normalized) return null;
  return path.join(sharedFilesCacheDir(options), ...normalized.split('/'));
}

export function sharedRelativePathFromCachePath(
  filePath: string,
  options?: FieldTheoryPathOptions,
): string | null {
  const relPath = path.relative(sharedFilesCacheDir(options), filePath);
  if (!relPath || relPath.startsWith('..') || path.isAbsolute(relPath)) return null;
  return normalizeSharedRelativePath(relPath.split(path.sep).join('/'));
}

export function buildSharedCacheFileName(input: {
  title: string;
  authorInitials?: string;
  extension?: '.md' | '.markdown';
  existingFileNames?: Iterable<string>;
}): string {
  const extension = input.extension ?? '.md';
  const initials = normalizeInitials(input.authorInitials);
  const base = safeFileNamePart(stripMarkdownExtension(input.title));
  const displayBase = initials ? `${base} ${initials}` : base;
  const existing = new Set(Array.from(input.existingFileNames ?? []).map((name) => name.toLowerCase()));

  let candidate = `${displayBase}${extension}`;
  let suffix = 2;
  while (existing.has(candidate.toLowerCase())) {
    candidate = `${displayBase} ${suffix}${extension}`;
    suffix += 1;
  }
  return candidate;
}

export function buildSharedConflictFileName(input: {
  fileName: string;
  authorInitials?: string;
  date: Date;
}): string {
  const extension = markdownExtension(input.fileName);
  const base = safeFileNamePart(stripMarkdownExtension(input.fileName));
  const initials = normalizeInitials(input.authorInitials);
  const timestamp = input.date.toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
  return `${base} conflict${initials ? ` ${initials}` : ''} ${timestamp}${extension}`;
}

function splitMarkdownFileName(fileName: string): { stem: string; extension: string } | null {
  if (!fileName || fileName.includes('\0') || /[\\/]/.test(fileName) || path.posix.basename(fileName) !== fileName) {
    return null;
  }
  const extension = path.posix.extname(fileName);
  if (!['.md', '.markdown'].includes(extension.toLowerCase())) return null;
  const stem = fileName.slice(0, -extension.length);
  return stem ? { stem, extension } : null;
}

export function sharedAuthorInitials(authorName: string | null | undefined): string {
  const trimmed = authorName?.trim() ?? '';
  const namePart = trimmed.includes('@') ? trimmed.slice(0, trimmed.indexOf('@')) : trimmed;
  const parts = namePart.match(/[A-Za-z0-9]+/g) ?? [];
  if (parts.length === 0) return 'U';
  const firstPart = parts[0] ?? '';
  if (parts.length === 1) return firstPart.slice(0, 2).toUpperCase();
  const lastPart = parts[parts.length - 1] ?? '';
  return `${firstPart[0] ?? ''}${lastPart[0] ?? ''}`.toUpperCase();
}

function nextMacStyleFileName(baseFileName: string, takenFileNames: Iterable<string>): string | null {
  const parsed = splitMarkdownFileName(baseFileName);
  if (!parsed) return null;

  const taken = new Set(Array.from(takenFileNames, (fileName) => fileName.toLowerCase()));
  if (!taken.has(baseFileName.toLowerCase())) return baseFileName;

  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${parsed.stem} ${index}${parsed.extension}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  throw new Error(`Could not find available shared file name for ${baseFileName}`);
}

export function sharedCollisionFileName(
  fileName: string,
  authorName: string | null | undefined,
  takenFileNames: Iterable<string> = [],
): string | null {
  const parsed = splitMarkdownFileName(fileName);
  if (!parsed) return null;

  const baseFileName = `${parsed.stem} - ${sharedAuthorInitials(authorName)}${parsed.extension}`;
  return nextMacStyleFileName(baseFileName, takenFileNames);
}

export function sharedCollisionRelativePath(
  relPath: string,
  authorName: string | null | undefined,
  takenRelPaths: Iterable<string> = [],
): string | null {
  const normalized = normalizeSharedRelativePath(relPath);
  if (!normalized) return null;

  const dirPath = path.posix.dirname(normalized);
  const fileName = path.posix.basename(normalized);
  const takenFileNames = Array.from(takenRelPaths)
    .map((takenPath) => normalizeSharedRelativePath(takenPath))
    .filter((takenPath): takenPath is string => Boolean(takenPath))
    .filter((takenPath) => path.posix.dirname(takenPath) === dirPath)
    .map((takenPath) => path.posix.basename(takenPath));
  const collisionFileName = sharedCollisionFileName(fileName, authorName, takenFileNames);
  if (!collisionFileName) return null;

  return dirPath === '.' ? collisionFileName : `${dirPath}/${collisionFileName}`;
}

function compactUtcTimestamp(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  const minute = String(date.getUTCMinutes()).padStart(2, '0');
  const second = String(date.getUTCSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hour}${minute}${second}`;
}

export function sharedConflictFileName(
  fileName: string,
  options: SharedConflictFileNameOptions = {},
): string | null {
  const parsed = splitMarkdownFileName(fileName);
  if (!parsed) return null;

  const timestamp = compactUtcTimestamp(options.timestamp ?? new Date());
  const authorSuffix = options.authorName ? `-${sharedAuthorInitials(options.authorName).toLowerCase()}` : '';
  return `${parsed.stem}.conflict${authorSuffix}-${timestamp}${parsed.extension}`;
}

export function sharedConflictRelativePath(
  relPath: string,
  options: SharedConflictFileNameOptions = {},
): string | null {
  const normalized = normalizeSharedRelativePath(relPath);
  if (!normalized) return null;

  const dirPath = path.posix.dirname(normalized);
  const conflictFileName = sharedConflictFileName(path.posix.basename(normalized), options);
  if (!conflictFileName) return null;
  return dirPath === '.' ? conflictFileName : `${dirPath}/${conflictFileName}`;
}

export function serializeSharedFileFrontmatter(meta: SharedFileFrontmatter): string[] {
  const lines = [
    'shared: true',
    `shared_id: ${quoteYamlScalar(meta.sharedId)}`,
    `shared_type: ${quoteYamlScalar(meta.type)}`,
  ];
  if (meta.title) lines.push(`title: ${quoteYamlScalar(meta.title.trim())}`);
  if (meta.teamId) lines.push(`shared_team_id: ${quoteYamlScalar(meta.teamId)}`);
  if (meta.teamName) lines.push(`shared_team: ${quoteYamlScalar(meta.teamName)}`);
  if (meta.authorId) lines.push(`shared_author_id: ${quoteYamlScalar(meta.authorId)}`);
  if (meta.authorName) lines.push(`shared_author: ${quoteYamlScalar(meta.authorName)}`);
  if (meta.authorInitials) lines.push(`shared_author_initials: ${quoteYamlScalar(normalizeInitials(meta.authorInitials))}`);
  if (meta.authorCallsign) lines.push(`shared_author_callsign: ${quoteYamlScalar(meta.authorCallsign.trim())}`);
  if (meta.originalSourcePath) lines.push(`shared_original_source_path: ${quoteYamlScalar(meta.originalSourcePath)}`);
  if (typeof meta.revision === 'number') lines.push(`shared_revision: ${Math.max(0, Math.floor(meta.revision))}`);
  return lines;
}

export function parseSharedFileFrontmatter(content: string): SharedFileFrontmatter | null {
  const parsed = parseMarkdownFrontmatter(content);
  if (parsed.meta.shared !== 'true' || !parsed.meta.shared_id) return null;
  const type = parsed.meta.shared_type === 'command' || parsed.meta.shared_type === 'plan'
    ? parsed.meta.shared_type
    : 'document';
  const revision = parsed.meta.shared_revision ? Number.parseInt(parsed.meta.shared_revision, 10) : undefined;

  return {
    sharedId: parsed.meta.shared_id,
    title: parsed.meta.title,
    type,
    teamId: parsed.meta.shared_team_id,
    teamName: parsed.meta.shared_team,
    authorId: parsed.meta.shared_author_id,
    authorName: parsed.meta.shared_author,
    authorInitials: parsed.meta.shared_author_initials,
    authorCallsign: parsed.meta.shared_author_callsign,
    originalSourcePath: parsed.meta.shared_original_source_path,
    revision: Number.isFinite(revision) ? revision : undefined,
  };
}

export function applySharedFileFrontmatter(content: string, meta: SharedFileFrontmatter): string {
  const parsed = parseMarkdownFrontmatter(content);
  const body = parsed.raw === null ? content : parsed.body;
  const retainedLines = parsed.raw?.trim()
    ? parsed.lines.filter((line) => !SHARED_CACHE_FRONTMATTER_RE.test(line) && !/^\s*title\s*:/i.test(line))
    : [];
  const nextLines = [
    ...retainedLines.filter((line) => line.trim().length > 0),
    ...(retainedLines.some((line) => line.trim().length > 0) ? [''] : []),
    ...serializeSharedFileFrontmatter(meta),
  ];
  return `---\n${nextLines.join('\n')}\n---\n\n${body}`;
}

export function stripSharedFileFrontmatter(content: string): string {
  const parsed = parseMarkdownFrontmatter(content);
  if (parsed.raw === null) return content;

  const retainedLines = parsed.lines.filter((line) => !SHARED_CACHE_FRONTMATTER_RE.test(line));
  if (!retainedLines.some((line) => line.trim().length > 0)) return parsed.body;
  return `---\n${retainedLines.join('\n')}\n---\n\n${parsed.body}`;
}

function optionalFrontmatterLine(key: string, value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? `${key}: ${quoteYamlScalar(trimmed)}` : null;
}

function sharedFrontmatterMetadataLines(metadata: SharedFrontmatterMetadata): string[] {
  const sharedPath = normalizeSharedRelativePath(metadata.sharedPath);
  if (!sharedPath) throw new Error(`Invalid shared relative path: ${metadata.sharedPath}`);

  return [
    'source: shared',
    'visibility: team',
    `type: ${metadata.type}`,
    `kind: ${metadata.kind}`,
    optionalFrontmatterLine('title', metadata.title),
    optionalFrontmatterLine('shared_document_id', metadata.sharedDocumentId),
    `shared_path: ${quoteYamlScalar(sharedPath)}`,
    optionalFrontmatterLine('shared_team_scope_user_id', metadata.teamScopeUserId),
    optionalFrontmatterLine('shared_author_name', metadata.authorName),
    optionalFrontmatterLine('shared_author_initials', metadata.authorInitials),
    optionalFrontmatterLine('shared_updated_at', metadata.updatedAt),
  ].filter((line): line is string => Boolean(line));
}

export function serializeSharedFrontmatterMetadata(metadata: SharedFrontmatterMetadata): string {
  return `---\n${sharedFrontmatterMetadataLines(metadata).join('\n')}\n---\n`;
}

export function withSharedFrontmatterMetadata(content: string, metadata: SharedFrontmatterMetadata): string {
  const parsed = parseMarkdownFrontmatter(content);
  const body = parsed.raw === null ? content.replace(/^\n+/, '') : parsed.body;
  const retainedLines = parsed.raw?.trim()
    ? parsed.lines.filter((line) => !SHARED_MANAGED_FRONTMATTER_RE.test(line))
    : [];
  const nextLines = [
    ...retainedLines,
    ...(retainedLines.length > 0 ? [''] : []),
    ...sharedFrontmatterMetadataLines(metadata),
  ];

  return `---\n${nextLines.join('\n')}\n---\n\n${body}`;
}

function parseSharedFileKind(value: string | undefined): SharedFileKind | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'document' || normalized === 'command') return normalized;
  return null;
}

function parseSharedFileContentType(value: string | undefined): SharedFileContentType | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'markdown' ? 'markdown' : null;
}

function optionalMetaString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function parseSharedFrontmatterMetadata(content: string): ParsedSharedFrontmatterMetadata | null {
  const parsed = parseMarkdownFrontmatter(content);
  if (parsed.meta.source?.trim().toLowerCase() === 'shared') {
    if (parsed.meta.visibility?.trim().toLowerCase() !== 'team') return null;

    const kind = parseSharedFileKind(parsed.meta.kind);
    const type = parseSharedFileContentType(parsed.meta.type);
    const sharedPath = normalizeSharedRelativePath(parsed.meta.shared_path ?? '');
    if (!kind || !type || !sharedPath) return null;

    return {
      source: 'shared',
      visibility: 'team',
      kind,
      type,
      sharedPath,
      title: optionalMetaString(parsed.meta.title),
      sharedDocumentId: optionalMetaString(parsed.meta.shared_document_id),
      teamScopeUserId: optionalMetaString(parsed.meta.shared_team_scope_user_id),
      authorName: optionalMetaString(parsed.meta.shared_author_name),
      authorInitials: optionalMetaString(parsed.meta.shared_author_initials),
      updatedAt: optionalMetaString(parsed.meta.shared_updated_at),
    };
  }

  const legacy = parseSharedFileFrontmatter(content);
  const legacyPath = normalizeSharedRelativePath(parsed.meta.shared_path ?? parsed.meta.shared_original_source_path ?? '');
  if (!legacy || !legacyPath) return null;

  return {
    source: 'shared',
    visibility: 'team',
    kind: legacy.type === 'command' ? 'command' : 'document',
    type: 'markdown',
    sharedPath: legacyPath,
    sharedDocumentId: legacy.sharedId,
    teamScopeUserId: legacy.teamId,
    title: legacy.title,
    authorName: legacy.authorName,
    authorInitials: legacy.authorInitials,
  };
}
