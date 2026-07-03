import { describe, expect, it, vi } from 'vitest';
import * as plist from 'plist';
import {
  parseClipboardFileUrl,
  parseMacClipboardFilePaths,
  readCodexTerminalPasteText,
  type TerminalPasteClipboard,
} from './codexTerminalClipboard';

function clipboard(input: {
  text?: string;
  imageEmpty?: boolean;
  filePaths?: string[];
  fileUrl?: string;
} = {}): TerminalPasteClipboard {
  return {
    readText: vi.fn(() => input.text ?? ''),
    readImage: vi.fn(() => ({ isEmpty: () => input.imageEmpty ?? true })),
    read: vi.fn((format: string) => (
      format === 'public.file-url' ? input.fileUrl ?? '' : ''
    )),
    readBuffer: vi.fn((format: string) => (
      format === 'NSFilenamesPboardType' && input.filePaths
        ? Buffer.from(plist.build(input.filePaths))
        : Buffer.alloc(0)
    )),
  };
}

describe('parseMacClipboardFilePaths', () => {
  it('reads Finder-style file paths from NSFilenamesPboardType data', () => {
    expect(parseMacClipboardFilePaths(Buffer.from(plist.build([
      '/Users/afar/Desktop/one.png',
      '/Users/afar/Desktop/two.png',
    ])))).toEqual([
      '/Users/afar/Desktop/one.png',
      '/Users/afar/Desktop/two.png',
    ]);
  });

  it('ignores invalid file clipboard data', () => {
    expect(parseMacClipboardFilePaths(Buffer.from('not plist'))).toEqual([]);
  });
});

describe('parseClipboardFileUrl', () => {
  it('converts file urls to local paths', () => {
    expect(parseClipboardFileUrl('file:///Users/afar/Desktop/My%20Shot.png')).toBe('/Users/afar/Desktop/My Shot.png');
  });

  it('ignores non-file urls', () => {
    expect(parseClipboardFileUrl('https://example.com/image.png')).toBeNull();
  });
});

describe('readCodexTerminalPasteText', () => {
  it('returns clipboard text as terminal paste text', async () => {
    await expect(readCodexTerminalPasteText({
      clipboard: clipboard({ text: 'hello terminal' }),
    })).resolves.toBe('hello terminal');
  });

  it('returns copied file paths when macOS exposes them', async () => {
    await expect(readCodexTerminalPasteText({
      clipboard: clipboard({ filePaths: ['/tmp/one.png', '/tmp/two.png'] }),
    })).resolves.toBe('/tmp/one.png\n/tmp/two.png');
  });

  it('exports image clipboard content to a terminal file path', async () => {
    await expect(readCodexTerminalPasteText({
      clipboard: clipboard({ imageEmpty: false }),
      imageExporter: {
        exportCurrentClipboardImageToCache: vi.fn(async () => '/tmp/Pasted Image.png'),
      },
    })).resolves.toBe('/tmp/Pasted Image.png');
  });

  it('returns empty text for unsupported clipboard content', async () => {
    await expect(readCodexTerminalPasteText({
      clipboard: clipboard(),
    })).resolves.toBe('');
  });
});
