import { describe, expect, it } from 'vitest';
import type { ClipboardItem, StackInfo } from '../types/clipboard';
import {
  buildClipboardListRows,
  getStackHydrationIds,
} from './clipboardStacks';

function makeItem(overrides: Partial<ClipboardItem>): ClipboardItem {
  return {
    id: overrides.id ?? 1,
    type: overrides.type ?? 'transcript',
    content: overrides.content ?? null,
    improvedContent: overrides.improvedContent ?? null,
    useImprovedVersion: overrides.useImprovedVersion ?? false,
    imageData: overrides.imageData ?? null,
    imageWidth: overrides.imageWidth ?? null,
    imageHeight: overrides.imageHeight ?? null,
    imageSize: overrides.imageSize ?? null,
    sourceApp: overrides.sourceApp ?? null,
    sourceAppName: overrides.sourceAppName ?? null,
    wordCount: overrides.wordCount ?? null,
    charCount: overrides.charCount ?? null,
    createdAt: overrides.createdAt ?? 0,
    contentHash: overrides.contentHash ?? `hash-${overrides.id ?? 1}`,
    stackId: overrides.stackId ?? null,
    source: overrides.source ?? 'mac',
    figureLabel: overrides.figureLabel ?? null,
    figureId: overrides.figureId ?? null,
    thumbnailData: overrides.thumbnailData ?? null,
    needsLazyLoad: overrides.needsLazyLoad ?? false,
  };
}

function makeStack(overrides: Partial<StackInfo>): StackInfo {
  return {
    stackId: overrides.stackId ?? 'stack-1',
    itemCount: overrides.itemCount ?? 1,
    imageCount: overrides.imageCount ?? 0,
    textCount: overrides.textCount ?? 1,
    createdAt: overrides.createdAt ?? 0,
    firstTextPreview: overrides.firstTextPreview ?? null,
  };
}

describe('getStackHydrationIds', () => {
  it('hydrates partial stacks when visible items are only a subset of the stack', () => {
    const items = [makeItem({ id: 10, stackId: 'stack-1', type: 'transcript' })];
    const stacks = [makeStack({ stackId: 'stack-1', itemCount: 3, imageCount: 2, textCount: 1 })];

    expect(getStackHydrationIds(items, stacks, {})).toEqual(['stack-1']);
  });

  it('does not hydrate stacks that are already complete in view', () => {
    const items = [
      makeItem({ id: 10, stackId: 'stack-1', type: 'transcript' }),
      makeItem({ id: 11, stackId: 'stack-1', type: 'screenshot', thumbnailData: 'thumb' }),
    ];
    const stacks = [makeStack({ stackId: 'stack-1', itemCount: 2, imageCount: 1, textCount: 1 })];

    expect(getStackHydrationIds(items, stacks, {})).toEqual([]);
  });

  it('rehydrates when cached stack items no longer match stack membership', () => {
    const items = [makeItem({ id: 10, stackId: 'stack-1', type: 'transcript' })];
    const stacks = [makeStack({ stackId: 'stack-1', itemCount: 2, imageCount: 1, textCount: 1 })];
    const hydrated = {
      'stack-1': [makeItem({ id: 99, stackId: 'stack-1', type: 'screenshot', thumbnailData: 'thumb' })],
    };

    expect(getStackHydrationIds(items, stacks, hydrated)).toEqual(['stack-1']);
  });
});

describe('buildClipboardListRows', () => {
  it('prefers hydrated stack items when available', () => {
    const visibleTranscript = makeItem({ id: 10, stackId: 'stack-1', type: 'transcript', content: 'hello' });
    const hydratedItems = [
      visibleTranscript,
      makeItem({ id: 11, stackId: 'stack-1', type: 'screenshot', thumbnailData: 'thumb' }),
    ];
    const rows = buildClipboardListRows(
      [visibleTranscript],
      [makeStack({ stackId: 'stack-1', itemCount: 2, imageCount: 1, textCount: 1 })],
      new Set<string>(),
      { 'stack-1': hydratedItems }
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('stack');
    if (rows[0].type !== 'stack') {
      throw new Error('Expected stack row');
    }
    expect(rows[0].items.map((item) => item.id)).toEqual([10, 11]);
  });
});
