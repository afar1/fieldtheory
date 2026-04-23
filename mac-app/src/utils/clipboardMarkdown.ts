import type { ClipboardItem } from '../types/clipboard';

export type ClipboardMarkdownImagePaths = Record<number, string | null | undefined>;

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
  if (!filePath.startsWith('/')) return filePath;
  return `file://${filePath.split('/').map((part, index) => (
    index === 0 ? '' : encodeURIComponent(part)
  )).join('/')}`;
}

function formatMarkdownDestination(destination: string): string {
  return `<${destination.replace(/>/g, '%3E')}>`;
}

function escapeImageAlt(text: string): string {
  return normalizeTitlePart(text).replace(/\]/g, '\\]');
}

function getImageAlt(item: ClipboardItem, imageIndex: number): string {
  if (item.figureLabel) return `Figure ${item.figureLabel}`;
  if (item.sourceAppName) return `${item.sourceAppName} image`;
  return `Image ${imageIndex}`;
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
  const blocks: string[] = [];
  let imageIndex = 1;

  for (const item of [...items].sort((a, b) => a.createdAt - b.createdAt)) {
    const text = getItemText(item);
    if (text.trim()) blocks.push(formatTextBlock(text));

    if (!isImageItem(item)) continue;

    const imagePath = imagePaths[item.id];
    if (!imagePath) {
      blocks.push(`> Image ${imageIndex} was unavailable when this note was created.`);
      imageIndex += 1;
      continue;
    }

    const alt = escapeImageAlt(getImageAlt(item, imageIndex));
    const destination = formatMarkdownDestination(localFilePathToMarkdownUrl(imagePath));
    blocks.push(`![${alt}](${destination})`);
    imageIndex += 1;
  }

  const body = blocks.length > 0 ? blocks.join('\n\n') : '_No text or images were available._';
  return `# ${normalizeTitlePart(title)}\n\n${body}\n`;
}
