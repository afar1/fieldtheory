import type { ClipboardItem } from '../types/clipboard';

export type ClipboardMarkdownImagePaths = Record<number, string | null | undefined>;

const LOCAL_IMAGE_PATH_PREFIX_RE = /^(file:\/\/|\/|~\/)/i;
const LOCAL_IMAGE_EXTENSION_RE = /\.(avif|gif|jpe?g|png|svg|webp)(?=\s|$)/i;

function isImageItem(item: ClipboardItem): boolean {
  return item.type === 'image' || item.type === 'screenshot' || !!item.imageData || !!item.thumbnailData;
}

function getItemText(item: ClipboardItem): string {
  if (item.type !== 'text' && item.type !== 'transcript') return '';
  return (item.useImprovedVersion && item.improvedContent ? item.improvedContent : item.content) ?? '';
}

function normalizeTitlePart(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function formatLocalTimestamp(timestamp: number): string {
  const date = new Date(Number.isFinite(timestamp) ? timestamp : Date.now());
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const period = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${year}-${month}-${day} at ${displayHours}.${minutes} ${period}`;
}

export function getClipboardItemsMarkdownTitle(items: ClipboardItem[]): string {
  const firstTimestamp = items
    .map((item) => item.createdAt)
    .filter((timestamp) => Number.isFinite(timestamp))
    .sort((a, b) => a - b)[0] ?? Date.now();
  return `Field Theory Notes ${formatLocalTimestamp(firstTimestamp)}`;
}

export function localFilePathToMarkdownUrl(filePath: string): string {
  if (/^file:\/\//i.test(filePath)) return filePath;
  const expandedPath = expandHomePath(filePath);
  if (!expandedPath.startsWith('/')) return filePath;
  return `file://${expandedPath.split('/').map((part, index) => (
    index === 0 ? '' : encodeURIComponent(part)
  )).join('/')}`;
}

function expandHomePath(filePath: string): string {
  if (filePath !== '~' && !filePath.startsWith('~/')) return filePath;
  const env = typeof process === 'undefined' ? undefined : process.env;
  const home = env?.HOME || env?.USERPROFILE || '';
  if (!home) return filePath;
  return `${home}${filePath.slice(1)}`;
}

function formatMarkdownDestination(destination: string): string {
  return `<${destination.replace(/>/g, '%3E')}>`;
}

function escapeImageAlt(text: string): string {
  return normalizeTitlePart(text).replace(/\]/g, '\\]');
}

function getImageAlt(item: ClipboardItem, imageIndex: number): string {
  if (item.figureLabel) return `figure ${item.figureLabel}`;
  if (item.sourceAppName) return `${item.sourceAppName} image`;
  return `Image ${imageIndex}`;
}

export function formatLocalImageMarkdown(filePath: string, alt = 'Image'): string {
  const destination = formatMarkdownDestination(localFilePathToMarkdownUrl(filePath));
  return `![${escapeImageAlt(alt)}](${destination})`;
}

function getPastedLocalImagePaths(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const paths: string[] = [];
  let index = 0;
  while (index < trimmed.length) {
    while (/\s/.test(trimmed[index] ?? '')) index += 1;
    if (index >= trimmed.length) break;
    if (!LOCAL_IMAGE_PATH_PREFIX_RE.test(trimmed.slice(index))) return [];

    const rest = trimmed.slice(index);
    const imageExtMatch = LOCAL_IMAGE_EXTENSION_RE.exec(rest);
    if (!imageExtMatch || imageExtMatch.index === undefined) return [];

    const end = index + imageExtMatch.index + imageExtMatch[0].length;
    paths.push(trimmed.slice(index, end));
    index = end;
  }

  return paths;
}

export function formatPastedLocalImageMarkdown(text: string): string | null {
  const imagePaths = getPastedLocalImagePaths(text);
  if (imagePaths.length === 0) return null;
  return imagePaths
    .map((imagePath, index) => formatLocalImageMarkdown(
      imagePath,
      imagePaths.length === 1 ? 'Image' : `Image ${index + 1}`,
    ))
    .join('\n\n');
}

function formatTextBlock(text: string): string {
  const trimmed = text.trim();
  if (/^https?:\/\/\S+$/i.test(trimmed)) return formatMarkdownDestination(trimmed);
  return text.trimEnd();
}

export function buildClipboardItemsMarkdown(
  items: ClipboardItem[],
  imagePaths: ClipboardMarkdownImagePaths,
  title = getClipboardItemsMarkdownTitle(items),
): string {
  const textBlocks: string[] = [];
  const imageBlocks: string[] = [];
  let imageIndex = 1;

  const chronologicalItems = [...items].sort((a, b) => a.createdAt - b.createdAt);

  for (const item of chronologicalItems) {
    const text = getItemText(item);
    if (text.trim()) textBlocks.push(formatTextBlock(text));
  }

  for (const item of chronologicalItems) {
    if (!isImageItem(item)) continue;

    const imagePath = imagePaths[item.id];
    if (!imagePath) {
      imageBlocks.push(`> Image ${imageIndex} was unavailable when this note was created.`);
      imageIndex += 1;
      continue;
    }

    const alt = getImageAlt(item, imageIndex);
    imageBlocks.push(formatLocalImageMarkdown(imagePath, alt));
    imageIndex += 1;
  }

  const blocks = [...textBlocks, ...imageBlocks];
  const body = blocks.length > 0 ? blocks.join('\n\n') : '_No text or images were available._';
  return `# ${normalizeTitlePart(title)}\n\n${body}\n`;
}
