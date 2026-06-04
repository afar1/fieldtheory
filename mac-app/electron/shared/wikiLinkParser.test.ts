import { describe, expect, it } from 'vitest';
import { getRawMarkdownLinkHits } from './wikiLinkParser';

describe('getRawMarkdownLinkHits', () => {
  it('extracts wikilinks, markdown links, autolinks, and bare URLs with display ranges', () => {
    const markdown = 'See [[Target Page|target]] and [ docs ](https://example.com). Also <mailto:a@b.test> and https://field.test/path.';

    expect(getRawMarkdownLinkHits(markdown)).toEqual([
      {
        kind: 'wikilink',
        rawTarget: 'Target Page',
        href: null,
        start: 4,
        end: 26,
        displayStart: 18,
        displayEnd: 24,
        displayText: 'target',
      },
      {
        kind: 'markdown-link',
        rawTarget: null,
        href: 'https://example.com',
        start: 31,
        end: 60,
        displayStart: 33,
        displayEnd: 37,
        displayText: 'docs',
      },
      {
        kind: 'autolink',
        rawTarget: null,
        href: 'mailto:a@b.test',
        start: 67,
        end: 84,
        displayStart: 68,
        displayEnd: 83,
        displayText: 'mailto:a@b.test',
      },
      {
        kind: 'bare-url',
        rawTarget: null,
        href: 'https://example.com',
        start: 40,
        end: 59,
        displayStart: 40,
        displayEnd: 59,
        displayText: 'https://example.com',
      },
      {
        kind: 'bare-url',
        rawTarget: null,
        href: 'mailto:a@b.test',
        start: 68,
        end: 83,
        displayStart: 68,
        displayEnd: 83,
        displayText: 'mailto:a@b.test',
      },
      {
        kind: 'bare-url',
        rawTarget: null,
        href: 'https://field.test/path',
        start: 89,
        end: 112,
        displayStart: 89,
        displayEnd: 112,
        displayText: 'https://field.test/path',
      },
    ]);
  });

  it('trims bare URL punctuation from the persisted range', () => {
    expect(getRawMarkdownLinkHits('Open https://example.com/path.')).toEqual([
      {
        kind: 'bare-url',
        rawTarget: null,
        href: 'https://example.com/path',
        start: 5,
        end: 29,
        displayStart: 5,
        displayEnd: 29,
        displayText: 'https://example.com/path',
      },
    ]);
  });
});
