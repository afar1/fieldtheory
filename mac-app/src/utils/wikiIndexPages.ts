import { normalizeWikiRelPath, type WikiIndexInput } from './wikiLinks';

export type WikiIndexPageSource = {
  relPath: string;
  title: string;
  absPath?: string;
};

export function wikiPageToWikiIndexInput(page: WikiIndexPageSource): WikiIndexInput {
  return {
    relPath: page.relPath,
    title: page.title,
    absPath: page.absPath,
  };
}

export function upsertWikiIndexPages(
  pages: WikiIndexInput[],
  page: WikiIndexPageSource,
): WikiIndexInput[] {
  const next = wikiPageToWikiIndexInput(page);
  const index = pages.findIndex((entry) => entry.relPath === next.relPath);
  if (index < 0) return [...pages, next];
  const copy = pages.slice();
  copy[index] = { ...copy[index], ...next };
  return copy;
}

export function removeWikiIndexPages(
  pages: WikiIndexInput[],
  relPaths: string[],
): WikiIndexInput[] {
  if (relPaths.length === 0) return pages;
  const removed = new Set(relPaths);
  return pages.filter((page) => !removed.has(page.relPath));
}

export function renameWikiIndexPages(
  pages: WikiIndexInput[],
  oldRelPath: string,
  newRelPath: string,
  next?: Partial<WikiIndexPageSource>,
): WikiIndexInput[] {
  const index = pages.findIndex((page) => page.relPath === oldRelPath);
  if (index < 0) return pages;
  const copy = pages.slice();
  copy[index] = {
    ...copy[index],
    relPath: newRelPath,
    ...(next?.title ? { title: next.title } : {}),
    ...(next?.absPath ? { absPath: next.absPath } : {}),
  };
  return copy;
}

export function wikiIndexPagesFromTree(
  folders: Array<{ files: Array<{ relPath: string; title: string; absPath: string }> }>,
): WikiIndexInput[] {
  return folders.flatMap((folder) => folder.files.map((page) => ({
    relPath: page.relPath,
    title: page.title,
    absPath: page.absPath,
  })));
}

export function wikiTargetPartsFromUnresolvedTitle(title: string): {
  folder: string;
  fileName: string;
  relPath: string;
} {
  const targetPart = title.split('|', 1)[0]?.trim() ?? '';
  const normalized = normalizeWikiRelPath(targetPart);
  const parts = normalized.split('/').filter(Boolean);
  const fileName = parts.pop() ?? targetPart;
  const folder = parts.join('/') || 'scratchpad';
  const relPath = folder ? `${folder}/${fileName}` : fileName;
  return { folder, fileName, relPath };
}
