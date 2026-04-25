import path from 'path';
import type { Bookmark, BookmarkImage } from './bookmarksManager';

function displayHandle(handle: string): string {
  const trimmed = handle.trim();
  return trimmed ? `@${trimmed.replace(/^@/, '')}` : '';
}

function localMediaPaths(images: BookmarkImage[] | undefined, mediaRoot: string): string[] {
  if (!images?.length) return [];

  const paths: string[] = [];
  for (const image of images) {
    if (image.localVideoFilename) paths.push(path.join(mediaRoot, image.localVideoFilename));
    if (image.localFilename) paths.push(path.join(mediaRoot, image.localFilename));
  }
  return paths;
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths));
}

function formatPathList(title: string, paths: string[]): string {
  if (paths.length === 0) return '';
  return [title, ...paths.map((filePath) => `- ${filePath}`)].join('\n');
}

export function buildBookmarkAgentCopyText(bookmark: Bookmark, mediaRoot: string): string {
  const author = [bookmark.authorName.trim(), displayHandle(bookmark.authorHandle)]
    .filter(Boolean)
    .join(' ');
  const mediaPaths = uniquePaths(localMediaPaths(bookmark.images, mediaRoot));
  const quotedMediaPaths = uniquePaths(localMediaPaths(bookmark.quotedTweet?.images, mediaRoot));

  return [
    author ? `Bookmark from ${author}` : 'Bookmark',
    bookmark.text.trim(),
    bookmark.url,
    bookmark.quotedTweet
      ? [
          `Quoted ${displayHandle(bookmark.quotedTweet.authorHandle) || bookmark.quotedTweet.authorName.trim()}:`,
          bookmark.quotedTweet.text.trim(),
          bookmark.quotedTweet.url,
        ].filter(Boolean).join('\n')
      : '',
    formatPathList('Media files:', mediaPaths),
    formatPathList('Quoted media files:', quotedMediaPaths),
  ].filter(Boolean).join('\n\n');
}
