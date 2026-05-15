import type { ClipboardItem, ListRow } from '../types/clipboard';

export type LauncherClipboardPreviewContent =
  | { type: 'image'; data: string; width: number; height: number; itemId: number; stackId: string | null; figureLabel?: string; needsFullImage?: boolean }
  | { type: 'text'; content: string };

export function compactClipboardLauncherText(rawText: string | null | undefined, fallback: string): string {
  const compact = rawText?.replace(/\s+/g, ' ').trim();
  if (!compact) return fallback;
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}

export function getClipboardItemLauncherText(item: ClipboardItem): string {
  const text = (item.useImprovedVersion && item.improvedContent) ? item.improvedContent : item.content;
  if (text?.trim()) return compactClipboardLauncherText(text, 'Clipboard item');
  if (item.type === 'screenshot') return 'Screenshot';
  if (item.type === 'image') return 'Image';
  if (item.type === 'transcript') return 'Transcript';
  return 'Clipboard item';
}

export function getClipboardStackLauncherText(row: Extract<ListRow, { type: 'stack' }>): string {
  const fallback = `${row.stack.itemCount} clipboard items`;
  const itemText = row.items
    .map(getClipboardItemLauncherText)
    .find(text => text !== 'Clipboard item' && text !== 'Image' && text !== 'Screenshot');
  return compactClipboardLauncherText(row.stack.firstTextPreview ?? itemText, fallback);
}

export function getClipboardItemPreviewContent(item: ClipboardItem): LauncherClipboardPreviewContent | null {
  const imageData = item.imageData || item.thumbnailData;
  if (imageData) {
    return {
      type: 'image',
      data: imageData,
      width: item.imageWidth || 0,
      height: item.imageHeight || 0,
      itemId: item.id,
      stackId: item.stackId,
      figureLabel: item.figureLabel ?? undefined,
      needsFullImage: !item.imageData && Boolean(item.thumbnailData),
    };
  }

  const text = (item.useImprovedVersion && item.improvedContent) ? item.improvedContent : item.content;
  return text?.trim() ? { type: 'text', content: text } : null;
}

export function getClipboardRowPreviewContent(row: ListRow): LauncherClipboardPreviewContent | null {
  if (row.type === 'item') return getClipboardItemPreviewContent(row.item);

  const imageItem = row.items.find(item => item.imageData || item.thumbnailData);
  if (imageItem) return getClipboardItemPreviewContent(imageItem);

  const combinedText = row.items
    .map(item => (item.useImprovedVersion && item.improvedContent) ? item.improvedContent : item.content)
    .filter((text): text is string => Boolean(text?.trim()))
    .join('\n\n');
  return combinedText ? { type: 'text', content: combinedText } : null;
}

export function getClipboardRowImageItem(row: ListRow | undefined): ClipboardItem | null {
  if (!row) return null;
  if (row.type === 'item') return (row.item.imageData || row.item.thumbnailData) ? row.item : null;
  return row.items.find(item => item.imageData || item.thumbnailData) ?? null;
}

export function clipboardItemTypeIcon(item: ClipboardItem | undefined): string {
  if (!item) return 'S';
  if (item.type === 'transcript') return 'TR';
  if (item.type === 'screenshot') return 'SS';
  if (item.type === 'image') return 'I';
  return 'T';
}
