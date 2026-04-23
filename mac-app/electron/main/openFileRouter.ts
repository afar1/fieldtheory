import fs from 'fs';
import path from 'path';

const ALLOWED_MD_EXTS = new Set(['.md', '.markdown', '.mdx']);

export function isAllowedMarkdownExt(filePath: string): boolean {
  return ALLOWED_MD_EXTS.has(path.extname(filePath).toLowerCase());
}

export type ResolvedMarkdownPath =
  | { kind: 'wiki'; relPath: string; absPath: string }
  | { kind: 'external'; absPath: string };

/** Classify an incoming file path for the open-file router.
 *  Realpath first so a symlink into the wiki root is treated as a wiki file
 *  (and vice versa). Returns null when the path isn't a markdown file we handle
 *  or can't be read. `wikiRoot` should already be canonical (realpath'd). */
export function resolveIncomingMarkdownPath(
  inputPath: string,
  wikiRoot: string | null,
  realpathSync: (p: string) => string = fs.realpathSync,
): ResolvedMarkdownPath | null {
  if (!isAllowedMarkdownExt(inputPath)) return null;
  let canonical: string;
  try {
    canonical = realpathSync(inputPath);
  } catch {
    return null;
  }
  if (wikiRoot && (canonical === wikiRoot || canonical.startsWith(wikiRoot + path.sep))) {
    const relWithExt = path.relative(wikiRoot, canonical);
    const relPath = relWithExt.replace(/\.md$/i, '');
    return { kind: 'wiki', relPath, absPath: canonical };
  }
  return { kind: 'external', absPath: canonical };
}
