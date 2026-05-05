import { describe, expect, it } from 'vitest';
import type { ClipboardItem } from '../types/clipboard';
import {
  buildClipboardItemsMarkdown,
  formatLocalImageMarkdown,
  formatPastedLocalImageMarkdown,
  localFilePathToMarkdownUrl,
} from './clipboardMarkdown';

function item(overrides: Partial<ClipboardItem>): ClipboardItem {
  return {
    id: overrides.id ?? 1,
    type: overrides.type ?? 'text',
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
    createdAt: overrides.createdAt ?? 1000,
    contentHash: overrides.contentHash ?? `hash-${overrides.id ?? 1}`,
    stackId: overrides.stackId ?? null,
    source: overrides.source ?? 'mac',
    figureLabel: overrides.figureLabel ?? null,
    figureId: overrides.figureId ?? null,
    thumbnailData: overrides.thumbnailData ?? null,
  };
}

function withHome(home: string, run: () => void): void {
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    run();
  } finally {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
  }
}

describe('clipboard markdown export', () => {
  it('preserves chronological text and improved transcript content', () => {
    const markdown = buildClipboardItemsMarkdown([
      item({ id: 2, createdAt: 2000, content: 'Second' }),
      item({ id: 1, createdAt: 1000, type: 'transcript', content: 'raw', improvedContent: 'Clean transcript', useImprovedVersion: true }),
    ], {}, 'Meeting notes');

    expect(markdown).toBe('# Meeting notes\n\nClean transcript\n\nSecond\n');
  });

  it('formats standalone urls as markdown autolinks', () => {
    const markdown = buildClipboardItemsMarkdown([
      item({ content: 'https://fieldtheory.ai/notes' }),
    ], {}, 'Links');

    expect(markdown).toContain('<https://fieldtheory.ai/notes>');
  });

  it('writes images as file-url markdown embeds', () => {
    const markdown = buildClipboardItemsMarkdown([
      item({ id: 3, type: 'screenshot', imageData: 'base64', figureLabel: 'A', sourceAppName: 'Safari' }),
    ], { 3: '/Users/afar/Library/Application Support/fieldtheory-mac/users/u/figures/Screenshot 1.png' }, 'Images');

    expect(markdown).toContain('![figure A](<file:///Users/afar/Library/Application%20Support/fieldtheory-mac/users/u/figures/Screenshot%201.png>)');
  });

  it('places text and transcript blocks before image blocks', () => {
    const markdown = buildClipboardItemsMarkdown([
      item({ id: 1, createdAt: 1000, content: 'First text' }),
      item({ id: 2, createdAt: 2000, type: 'screenshot', imageData: 'base64' }),
      item({ id: 3, createdAt: 3000, type: 'transcript', content: 'Spoken note' }),
    ], { 2: '/tmp/Figure 1.png' }, 'Stack');

    expect(markdown).toBe([
      '# Stack',
      '',
      'First text',
      '',
      'Spoken note',
      '',
      '![Image 1](<file:///tmp/Figure%201.png>)',
      '',
    ].join('\n'));
  });

  it('keeps mixed chronology readable by grouping text before later and earlier images', () => {
    const markdown = buildClipboardItemsMarkdown([
      item({ id: 3, createdAt: 3000, type: 'screenshot', imageData: 'newer' }),
      item({ id: 2, createdAt: 2000, content: 'Middle text' }),
      item({ id: 1, createdAt: 1000, type: 'image', imageData: 'older' }),
    ], {
      1: '/tmp/Older.png',
      3: '/tmp/Newer.png',
    }, 'Mixed chronology');

    expect(markdown).toBe([
      '# Mixed chronology',
      '',
      'Middle text',
      '',
      '![Image 1](<file:///tmp/Older.png>)',
      '',
      '![Image 2](<file:///tmp/Newer.png>)',
      '',
    ].join('\n'));
  });

  it('keeps a readable placeholder for missing image exports', () => {
    const markdown = buildClipboardItemsMarkdown([
      item({ id: 1, createdAt: 1000, content: 'Available text' }),
      item({ id: 4, createdAt: 2000, type: 'screenshot', imageData: 'base64' }),
    ], { 4: null }, 'Missing image');

    expect(markdown).toBe([
      '# Missing image',
      '',
      'Available text',
      '',
      '> Image 1 was unavailable when this note was created.',
      '',
    ].join('\n'));
  });

  it('uses chronological image indexes for image alt labels after text grouping', () => {
    const markdown = buildClipboardItemsMarkdown([
      item({ id: 3, createdAt: 3000, type: 'screenshot', imageData: 'base64', sourceAppName: 'Safari' }),
      item({ id: 2, createdAt: 2000, content: 'Text between images' }),
      item({ id: 1, createdAt: 1000, type: 'image', imageData: 'base64', figureLabel: 'A' }),
      item({ id: 4, createdAt: 4000, type: 'image', imageData: 'base64' }),
    ], {
      1: '/tmp/Figure A.png',
      3: '/tmp/Safari.png',
      4: '/tmp/Image.png',
    }, 'Alt labels');

    expect(markdown).toContain('![figure A](<file:///tmp/Figure%20A.png>)');
    expect(markdown).toContain('![Safari image](<file:///tmp/Safari.png>)');
    expect(markdown).toContain('![Image 3](<file:///tmp/Image.png>)');
  });

  it('converts local paths with spaces to file urls', () => {
    expect(localFilePathToMarkdownUrl('/tmp/Figure 1.png')).toBe('file:///tmp/Figure%201.png');
  });

  it('expands home-relative local image paths before making file urls', () => {
    withHome('/Users/afar', () => {
      expect(localFilePathToMarkdownUrl('~/Library/Application Support/fieldtheory-mac/users/u/figures/Screenshot 1.png'))
        .toBe('file:///Users/afar/Library/Application%20Support/fieldtheory-mac/users/u/figures/Screenshot%201.png');
    });
  });

  it('formats a local image path as a markdown image embed', () => {
    expect(formatLocalImageMarkdown('/tmp/Figure 1.png', 'figure A')).toBe('![figure A](<file:///tmp/Figure%201.png>)');
  });

  it('converts pasted local image paths into markdown image embeds', () => {
    expect(formatPastedLocalImageMarkdown(
      '/Users/afar/Library/Application Support/fieldtheory-mac/users/u/figures/Screenshot 2026-05-01 at 11.57.03 AM.png',
    )).toBe('![Image](<file:///Users/afar/Library/Application%20Support/fieldtheory-mac/users/u/figures/Screenshot%202026-05-01%20at%2011.57.03%20AM.png>)');
  });

  it('converts pasted home-relative image paths into markdown image embeds', () => {
    withHome('/Users/afar', () => {
      expect(formatPastedLocalImageMarkdown(
        '~/Library/Application Support/fieldtheory-mac/users/u/figures/Screenshot 2026-05-01 at 1.28.35 PM.png',
      )).toBe('![Image](<file:///Users/afar/Library/Application%20Support/fieldtheory-mac/users/u/figures/Screenshot%202026-05-01%20at%201.28.35%20PM.png>)');
    });
  });

  it('converts multiple pasted local image paths into markdown image embeds', () => {
    expect(formatPastedLocalImageMarkdown(
      '/Users/afar/Library/Application Support/fieldtheory-mac/users/u/figures/Screenshot 2026-05-01 at 2.26.05 PM.png /Users/afar/Library/Application Support/fieldtheory-mac/users/u/figures/Screenshot 2026-05-01 at 2.26.01 PM.png',
    )).toBe([
      '![Image 1](<file:///Users/afar/Library/Application%20Support/fieldtheory-mac/users/u/figures/Screenshot%202026-05-01%20at%202.26.05%20PM.png>)',
      '![Image 2](<file:///Users/afar/Library/Application%20Support/fieldtheory-mac/users/u/figures/Screenshot%202026-05-01%20at%202.26.01%20PM.png>)',
    ].join('\n\n'));
  });

  it('converts newline-separated pasted local image paths into markdown image embeds', () => {
    expect(formatPastedLocalImageMarkdown(
      '/tmp/Figure 1.png\n/tmp/Figure 2.jpg',
    )).toBe([
      '![Image 1](<file:///tmp/Figure%201.png>)',
      '![Image 2](<file:///tmp/Figure%202.jpg>)',
    ].join('\n\n'));
  });

  it('does not convert non-image local paths', () => {
    expect(formatPastedLocalImageMarkdown('/Users/afar/notes/example.md')).toBeNull();
  });
});
