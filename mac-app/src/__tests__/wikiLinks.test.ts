import { describe, expect, it } from 'vitest';
import {
  buildWikiIndex,
  classifyLinkHref,
  decodeUnresolvedWikiHref,
  isUnresolvedWikiHref,
  normalizeWikiRelPath,
  resolveWikiLink,
  transformWikiLinks,
} from '../utils/wikiLinks';

const index = buildWikiIndex([
  { relPath: 'entries/my-page', title: 'My Page' },
  { relPath: 'debates/consensus', title: 'Consensus' },
  { relPath: 'scratchpad/idea', title: 'Idea' },
]);

describe('normalizeWikiRelPath', () => {
  it('trims whitespace, strips leading slashes, and drops a trailing .md', () => {
    expect(normalizeWikiRelPath('  /debates/consensus.md  ')).toBe('debates/consensus');
  });

  it('leaves already-normalized paths untouched', () => {
    expect(normalizeWikiRelPath('entries/my-page')).toBe('entries/my-page');
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(normalizeWikiRelPath('   ')).toBe('');
  });

  it('only strips the trailing .md, not embedded ones', () => {
    expect(normalizeWikiRelPath('entries/foo.md.md')).toBe('entries/foo.md');
  });
});

describe('buildWikiIndex', () => {
  it('keeps the first relPath when two pages share the same title', () => {
    const idx = buildWikiIndex([
      { relPath: 'entries/a', title: 'Shared Title' },
      { relPath: 'debates/b', title: 'Shared Title' },
    ]);
    expect(idx.byTitle.get('shared title')).toBe('entries/a');
    expect(idx.byRelPath.has('entries/a')).toBe(true);
    expect(idx.byRelPath.has('debates/b')).toBe(true);
  });

  it('skips pages with an empty title so the empty string never maps anywhere', () => {
    const idx = buildWikiIndex([
      { relPath: 'entries/untitled', title: '' },
      { relPath: 'entries/spaces', title: '   ' },
    ]);
    expect(idx.byTitle.size).toBe(0);
    expect(idx.byRelPath.size).toBe(2);
  });
});

describe('resolveWikiLink', () => {
  it('resolves by case-insensitive title', () => {
    expect(resolveWikiLink('my page', index).relPath).toBe('entries/my-page');
    expect(resolveWikiLink('MY PAGE', index).relPath).toBe('entries/my-page');
  });

  it('resolves by relPath when the target contains a slash', () => {
    expect(resolveWikiLink('debates/consensus', index).relPath).toBe('debates/consensus');
  });

  it('strips trailing .md and leading slashes', () => {
    expect(resolveWikiLink('/debates/consensus.md', index).relPath).toBe('debates/consensus');
  });

  it('returns null for unknown targets', () => {
    expect(resolveWikiLink('nothing here', index).relPath).toBeNull();
    expect(resolveWikiLink('', index).relPath).toBeNull();
  });
});

describe('transformWikiLinks', () => {
  it('rewrites resolved links to wiki:// markdown links', () => {
    const out = transformWikiLinks('See [[My Page]] for context.', index);
    expect(out).toBe('See [My Page](wiki://entries/my-page) for context.');
  });

  it('uses the alias as display text when provided', () => {
    const out = transformWikiLinks('See [[My Page|this thing]].', index);
    expect(out).toBe('See [this thing](wiki://entries/my-page).');
  });

  it('emits an unresolved sentinel href for missing targets', () => {
    const out = transformWikiLinks('Link to [[Brand New]] page.', index);
    expect(out).toBe('Link to [Brand New](wiki://!/Brand%20New) page.');
  });

  it('leaves wikilink syntax inside fenced code blocks untouched', () => {
    const input = '```\n[[My Page]]\n```\n\nNormal [[My Page]] here.';
    const out = transformWikiLinks(input, index);
    expect(out).toContain('```\n[[My Page]]\n```');
    expect(out).toContain('[My Page](wiki://entries/my-page)');
  });

  it('leaves wikilink syntax inside inline code untouched', () => {
    const out = transformWikiLinks('Use `[[My Page]]` then [[My Page]].', index);
    expect(out).toBe('Use `[[My Page]]` then [My Page](wiki://entries/my-page).');
  });

  it('leaves empty [[]] alone', () => {
    expect(transformWikiLinks('nothing [[]] here', index)).toBe('nothing [[]] here');
  });

  it('rewrites multiple wikilinks in the same line independently', () => {
    const out = transformWikiLinks('[[My Page]] then [[Consensus]] then [[missing]]', index);
    expect(out).toBe(
      '[My Page](wiki://entries/my-page) then [Consensus](wiki://debates/consensus) then [missing](wiki://!/missing)',
    );
  });

  it('rewrites wikilinks sitting back-to-back', () => {
    const out = transformWikiLinks('[[My Page]][[Consensus]]', index);
    expect(out).toBe('[My Page](wiki://entries/my-page)[Consensus](wiki://debates/consensus)');
  });

  it('falls back to the target when the alias is whitespace-only', () => {
    const out = transformWikiLinks('[[My Page|   ]]', index);
    expect(out).toBe('[My Page](wiki://entries/my-page)');
  });

  it('does not match wikilink syntax that spans a newline', () => {
    const input = '[[My\nPage]]';
    expect(transformWikiLinks(input, index)).toBe(input);
  });
});

describe('classifyLinkHref', () => {
  it('returns noop for empty or missing hrefs', () => {
    expect(classifyLinkHref(undefined, index)).toEqual({ kind: 'noop' });
    expect(classifyLinkHref('', index)).toEqual({ kind: 'noop' });
  });

  it('routes unresolved sentinels to create with the decoded title', () => {
    expect(classifyLinkHref('wiki://!/Brand%20New', index)).toEqual({
      kind: 'create',
      title: 'Brand New',
    });
  });

  it('routes resolved wiki:// hrefs to wiki with the decoded relPath', () => {
    expect(classifyLinkHref('wiki://entries/my-page', index)).toEqual({
      kind: 'wiki',
      relPath: 'entries/my-page',
    });
  });

  it('treats bare relative hrefs that match the index as wiki links', () => {
    expect(classifyLinkHref('debates/consensus', index)).toEqual({
      kind: 'wiki',
      relPath: 'debates/consensus',
    });
  });

  it('falls back to external for bare relative hrefs that miss the index', () => {
    expect(classifyLinkHref('does/not/exist', index)).toEqual({
      kind: 'external',
      href: 'does/not/exist',
    });
  });

  it('treats http(s) and other absolute URLs as external', () => {
    expect(classifyLinkHref('https://example.com', index)).toEqual({
      kind: 'external',
      href: 'https://example.com',
    });
    expect(classifyLinkHref('mailto:a@b.com', index)).toEqual({
      kind: 'external',
      href: 'mailto:a@b.com',
    });
  });

  it('does not treat anchors, absolute paths, or query-only hrefs as wiki lookups', () => {
    expect(classifyLinkHref('#section', index)).toEqual({ kind: 'external', href: '#section' });
    expect(classifyLinkHref('/abs/path', index)).toEqual({ kind: 'external', href: '/abs/path' });
    expect(classifyLinkHref('?q=1', index)).toEqual({ kind: 'external', href: '?q=1' });
  });
});

describe('isUnresolvedWikiHref / decodeUnresolvedWikiHref', () => {
  it('detects the unresolved sentinel and decodes the title', () => {
    expect(isUnresolvedWikiHref('wiki://!/Brand%20New')).toBe(true);
    expect(isUnresolvedWikiHref('wiki://entries/my-page')).toBe(false);
    expect(decodeUnresolvedWikiHref('wiki://!/Brand%20New')).toBe('Brand New');
  });
});
