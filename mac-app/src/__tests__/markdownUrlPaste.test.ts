import { describe, expect, it } from 'vitest';
import {
  getDefaultMarkdownUrlPasteKind,
  getMarkdownUrlPasteEdit,
} from '../utils/markdownUrlPaste';

describe('markdown URL paste helpers', () => {
  it('wraps selected words as a markdown link when a URL is pasted over them', () => {
    const result = getMarkdownUrlPasteEdit('Read this now', 5, 9, 'https://example.com/article?x=1');

    expect(result?.nextValue).toBe('Read [this](<https://example.com/article?x=1>) now');
    expect(result?.selectionStart).toBe(6);
    expect(result?.selectionEnd).toBe(10);
    expect(result?.kind).toBe('link');
  });

  it('turns a bare URL paste into a markdown link with the label selected', () => {
    const result = getMarkdownUrlPasteEdit('', 0, 0, 'https://example.com/post');

    expect(result?.nextValue).toBe('[example.com](<https://example.com/post>)');
    expect(result?.selectionStart).toBe(1);
    expect(result?.selectionEnd).toBe(12);
  });

  it('normalizes www URLs before inserting markdown', () => {
    const result = getMarkdownUrlPasteEdit('', 0, 0, 'www.example.com/path');

    expect(result?.nextValue).toBe('[example.com](<https://www.example.com/path>)');
  });

  it('defaults image URLs to embed syntax when no text is selected', () => {
    const result = getMarkdownUrlPasteEdit('', 0, 0, 'https://example.com/image.png');

    expect(result?.nextValue).toBe('![example.com](<https://example.com/image.png>)');
    expect(result?.selectionStart).toBe(2);
    expect(result?.selectionEnd).toBe(13);
    expect(result?.kind).toBe('embed');
  });

  it('can keep a pasted URL raw', () => {
    const result = getMarkdownUrlPasteEdit('A ', 2, 2, 'https://example.com', 'raw');

    expect(result?.nextValue).toBe('A https://example.com');
    expect(result?.selectionStart).toBe(result?.selectionEnd);
    expect(result?.selectionEnd).toBe('A https://example.com'.length);
  });

  it('ignores non-URL paste text', () => {
    expect(getMarkdownUrlPasteEdit('', 0, 0, 'not a url')).toBeNull();
  });

  it('keeps selected text as a link even when the URL is embeddable', () => {
    expect(getDefaultMarkdownUrlPasteKind('https://example.com/image.png', 'diagram')).toBe('link');
  });
});
