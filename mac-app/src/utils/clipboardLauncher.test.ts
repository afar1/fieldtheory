import { describe, expect, it } from 'vitest';
import {
  clipboardItemTypeIcon,
  compactClipboardLauncherText,
  getClipboardItemLauncherText,
  getClipboardRowImageItem,
  getClipboardRowPreviewContent,
  getClipboardStackLauncherText,
} from './clipboardLauncher';
import type { ClipboardItem, ListRow } from '../types/clipboard';

function makeClipboardItem(overrides: Partial<ClipboardItem>): ClipboardItem {
  return {
    id: 1,
    type: 'text',
    content: null,
    improvedContent: null,
    useImprovedVersion: false,
    imageData: null,
    imageWidth: null,
    imageHeight: null,
    imageSize: null,
    sourceApp: null,
    sourceAppName: null,
    wordCount: null,
    charCount: null,
    createdAt: 1_700_000_000_000,
    contentHash: 'hash',
    stackId: null,
    source: 'mac',
    figureLabel: null,
    figureId: null,
    thumbnailData: null,
    ...overrides,
  };
}

describe('clipboard launcher helpers', () => {
  it('compacts row text for launcher display', () => {
    expect(compactClipboardLauncherText('  hello\n\nworld  ', 'fallback')).toBe('hello world');
    expect(compactClipboardLauncherText('', 'fallback')).toBe('fallback');
  });

  it('prefers improved content when naming clipboard items', () => {
    const item = makeClipboardItem({
      content: 'raw text',
      improvedContent: 'improved text',
      useImprovedVersion: true,
    });

    expect(getClipboardItemLauncherText(item)).toBe('improved text');
  });

  it('uses thumbnails as image previews and image row icons', () => {
    const item = makeClipboardItem({
      type: 'screenshot',
      thumbnailData: 'thumb-data',
      imageWidth: 1200,
      imageHeight: 800,
    });
    const row: ListRow = { type: 'item', item };

    expect(getClipboardRowImageItem(row)).toBe(item);
    expect(getClipboardRowPreviewContent(row)).toEqual({
      type: 'image',
      data: 'thumb-data',
      width: 1200,
      height: 800,
      itemId: 1,
      stackId: null,
      figureLabel: undefined,
      needsFullImage: true,
    });
  });

  it('previews the first image in a stack before combined text', () => {
    const textItem = makeClipboardItem({ id: 1, content: 'first note' });
    const imageItem = makeClipboardItem({ id: 2, type: 'image', imageData: 'full-image', stackId: 'stack-a' });
    const row: Extract<ListRow, { type: 'stack' }> = {
      type: 'stack',
      stack: {
        stackId: 'stack-a',
        itemCount: 2,
        imageCount: 1,
        textCount: 1,
        createdAt: 1_700_000_000_000,
        firstTextPreview: 'first note',
      },
      items: [textItem, imageItem],
      expanded: false,
    };

    expect(getClipboardStackLauncherText(row)).toBe('first note');
    expect(getClipboardRowPreviewContent(row)).toMatchObject({
      type: 'image',
      data: 'full-image',
      itemId: 2,
      stackId: 'stack-a',
    });
  });

  it('provides compact type icons for non-image clipboard rows', () => {
    expect(clipboardItemTypeIcon(makeClipboardItem({ type: 'text' }))).toBe('T');
    expect(clipboardItemTypeIcon(makeClipboardItem({ type: 'transcript' }))).toBe('TR');
    expect(clipboardItemTypeIcon(makeClipboardItem({ type: 'screenshot' }))).toBe('SS');
  });
});
