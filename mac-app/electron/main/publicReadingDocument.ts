import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { existingPathInsideRoots, isMarkdownDocumentPath, isPathInside } from './pathSafety';

export interface PublicReadingDocument {
  path: string;
  title: string;
  content: string;
}

export type PublicReadingVisibility = 'listed' | 'unlisted';

export function isPublicReadingVisibility(value: unknown): value is PublicReadingVisibility {
  return value === 'listed' || value === 'unlisted';
}

export function hasStrongUnlistedReadingSlug(value: unknown): value is string {
  return typeof value === 'string' && /-[0-9a-f]{32,}$/.test(value);
}

export function publicReadingSlug(
  title: string,
  visibility: PublicReadingVisibility,
  existing?: { slug: string; visibility?: PublicReadingVisibility },
  randomHex: (bytes: number) => string = (bytes) => crypto.randomBytes(bytes).toString('hex'),
): string {
  if (existing) {
    if (visibility === 'listed') return existing.slug;
    if (existing.visibility === 'unlisted' && hasStrongUnlistedReadingSlug(existing.slug)) {
      return existing.slug;
    }
  }

  const baseSlug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'reading';
  const randomSuffix = randomHex(visibility === 'unlisted' ? 16 : 3);
  return `${baseSlug}-${randomSuffix}`;
}

function titleFromContent(filePath: string, content: string): string {
  const heading = content.split('\n').find((line) => /^#\s+/.test(line));
  if (heading) return heading.replace(/^#\s+/, '').trim();
  return path.basename(filePath, path.extname(filePath));
}

export function resolvePublicReadingPath(filePath: string, libraryRoots: string[]): string | null {
  const canonicalPath = existingPathInsideRoots(filePath, libraryRoots);
  return canonicalPath && isMarkdownDocumentPath(canonicalPath) ? canonicalPath : null;
}

export function resolvePublicReadingSourcePath(
  filePath: string,
  cached: PublicReadingDocument | null,
  libraryRoots: string[],
): string | null {
  const absolutePath = path.resolve(filePath);
  const isCanonicalLibraryPath = libraryRoots.some((rootPath) => (
    isPathInside(path.resolve(rootPath), absolutePath)
  ));
  if (isCanonicalLibraryPath) return resolvePublicReadingPath(filePath, libraryRoots);

  return cached?.path ?? null;
}

export function resolvePublicReadingDocument(
  filePath: string,
  cached: PublicReadingDocument | null,
  libraryRoots: string[],
): PublicReadingDocument | null {
  if (cached) return cached;

  const canonicalPath = resolvePublicReadingPath(filePath, libraryRoots);
  if (!canonicalPath) return null;

  try {
    const content = fs.readFileSync(canonicalPath, 'utf8');
    return {
      path: canonicalPath,
      title: titleFromContent(canonicalPath, content),
      content,
    };
  } catch {
    return null;
  }
}
