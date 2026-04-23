import { describe, expect, it } from 'vitest';
import {
  buildWikiIndex,
  classifyLinkHref,
  decodeUnresolvedWikiHref,
  getActiveMarkdownWikiLinkCompletion,
  getMarkdownEditorLinkActionAtOffset,
  getMarkdownEditorLinkHits,
  getMarkdownWikiLinkAutoCloseEdit,
  getMarkdownWikiLinkCompletionReplacement,
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
    expect(idx.byTitle.get('shared title')).toEqual({ kind: 'wiki', relPath: 'entries/a' });
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

  it('rewrites artifact title links to artifact hrefs', () => {
    const artifactIndex = buildWikiIndex([
      { relPath: 'entries/my-page', title: 'My Page' },
      { relPath: '/tmp/artifact.md', title: 'Artifact One', artifactPath: '/tmp/artifact.md' },
    ]);
    const out = transformWikiLinks('See [[Artifact One]].', artifactIndex);
    expect(out).toBe('See [Artifact One](artifact://%2Ftmp%2Fartifact.md).');
  });

  it('rewrites command title links to command hrefs', () => {
    const commandIndex = buildWikiIndex([
      { relPath: 'entries/my-page', title: 'My Page' },
      { relPath: '/tmp/refactor.md', title: 'refactor', commandPath: '/tmp/refactor.md' },
    ]);
    const out = transformWikiLinks('Run [[refactor]].', commandIndex);
    expect(out).toBe('Run [refactor](command://%2Ftmp%2Frefactor.md).');
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

  it('rewrites bare external urls to rendered markdown links beside wikilinks', () => {
    const out = transformWikiLinks([
      '- [[categories/technique]]',
      '- [[domains/mac-app]]',
      '- [[entities/bookmarks-manager]]',
      '- https://github.com/mozilla/readability',
      '- https://github.com/mixmark-io/turndown',
      '- https://github.com/simonw/tools/blob/main/jina-reader.html',
    ].join('\n'), index);

    expect(out).toContain('- [categories/technique](wiki://!/categories%2Ftechnique)');
    expect(out).toContain('- [https://github.com/mozilla/readability](https://github.com/mozilla/readability)');
    expect(out).toContain('- [https://github.com/mixmark-io/turndown](https://github.com/mixmark-io/turndown)');
    expect(out).toContain(
      '- [https://github.com/simonw/tools/blob/main/jina-reader.html](https://github.com/simonw/tools/blob/main/jina-reader.html)',
    );
  });

  it('does not rewrite urls inside code, existing markdown links, or autolinks', () => {
    const input = [
      'Use `https://example.com/code`.',
      'Read [site](https://example.com/link).',
      'Open <https://example.com/autolink>.',
      'Then https://example.com/plain.',
    ].join('\n');
    const out = transformWikiLinks(input, index);

    expect(out).toContain('`https://example.com/code`');
    expect(out).toContain('[site](https://example.com/link)');
    expect(out).toContain('<https://example.com/autolink>');
    expect(out).toContain('[https://example.com/plain](https://example.com/plain).');
  });

  it('trims trailing punctuation from rendered bare external urls', () => {
    const out = transformWikiLinks('Read https://example.com/path, then stop.', index);

    expect(out).toBe('Read [https://example.com/path](https://example.com/path), then stop.');
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

  it('routes artifact:// hrefs to artifacts with the decoded path', () => {
    expect(classifyLinkHref('artifact://%2Ftmp%2Fartifact.md', index)).toEqual({
      kind: 'artifact',
      path: '/tmp/artifact.md',
    });
  });

  it('routes command:// hrefs to commands with the decoded path', () => {
    expect(classifyLinkHref('command://%2Ftmp%2Frefactor.md', index)).toEqual({
      kind: 'command',
      path: '/tmp/refactor.md',
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

describe('getMarkdownEditorLinkActionAtOffset', () => {
  it('activates resolved wikilinks from edit mode', () => {
    const input = 'See [[My Page|this page]] now.';
    expect(getMarkdownEditorLinkActionAtOffset(input, input.indexOf('this'), index)).toEqual({
      kind: 'wiki',
      relPath: 'entries/my-page',
    });
  });

  it('activates unresolved wikilinks as create actions', () => {
    const input = 'See [[New Thing]] now.';
    expect(getMarkdownEditorLinkActionAtOffset(input, input.indexOf('New'), index)).toEqual({
      kind: 'create',
      title: 'New Thing',
    });
  });

  it('activates markdown links using the href', () => {
    const input = 'Read [the docs](https://example.com/docs).';
    expect(getMarkdownEditorLinkActionAtOffset(input, input.indexOf('docs'), index)).toEqual({
      kind: 'external',
      href: 'https://example.com/docs',
    });
  });

  it('activates empty markdown hrefs using the label as an index lookup', () => {
    const input = 'Read [Consensus]().';
    expect(getMarkdownEditorLinkActionAtOffset(input, input.indexOf('Consensus'), index)).toEqual({
      kind: 'wiki',
      relPath: 'debates/consensus',
    });
  });

  it('activates autolinks and bare urls', () => {
    const autolink = 'Open <mailto:a@b.com>.';
    expect(getMarkdownEditorLinkActionAtOffset(autolink, autolink.indexOf('mailto'), index)).toEqual({
      kind: 'external',
      href: 'mailto:a@b.com',
    });

    const bare = 'Open https://example.com/path.';
    expect(getMarkdownEditorLinkActionAtOffset(bare, bare.indexOf('example'), index)).toEqual({
      kind: 'external',
      href: 'https://example.com/path',
    });
  });

  it('returns noop when the offset is not on a link', () => {
    expect(getMarkdownEditorLinkActionAtOffset('plain text', 2, index)).toEqual({ kind: 'noop' });
  });
});

describe('getMarkdownEditorLinkHits', () => {
  it('returns link ranges for hover highlighting in edit mode', () => {
    const input = 'See [[My Page]] and https://example.com/path.';
    const hits = getMarkdownEditorLinkHits(input, index);

    expect(hits).toEqual([
      {
        action: { kind: 'wiki', relPath: 'entries/my-page' },
        start: 4,
        end: 15,
        displayStart: 6,
        displayEnd: 13,
        displayText: 'My Page',
      },
      {
        action: { kind: 'external', href: 'https://example.com/path' },
        start: 20,
        end: 44,
        displayStart: 20,
        displayEnd: 44,
        displayText: 'https://example.com/path',
      },
    ]);
  });

  it('uses the rendered link word as the edit-mode display range', () => {
    const input = 'See [[My Page|this page]] and [ docs ](https://example.com).';
    const hits = getMarkdownEditorLinkHits(input, index);

    expect(hits[0]).toMatchObject({
      displayStart: input.indexOf('this'),
      displayEnd: input.indexOf('this') + 'this page'.length,
      displayText: 'this page',
    });
    expect(hits[1]).toMatchObject({
      displayStart: input.indexOf('docs'),
      displayEnd: input.indexOf('docs') + 'docs'.length,
      displayText: 'docs',
    });
  });

  it('trims trailing bare-url punctuation from the hover range', () => {
    const input = 'Open https://example.com/path.';
    const [hit] = getMarkdownEditorLinkHits(input, index);

    expect(hit).toEqual({
      action: { kind: 'external', href: 'https://example.com/path' },
      start: 5,
      end: 29,
      displayStart: 5,
      displayEnd: 29,
      displayText: 'https://example.com/path',
    });
  });
});

describe('getActiveMarkdownWikiLinkCompletion', () => {
  it('returns the active double-bracket query before closing brackets exist', () => {
    const input = 'See [[Cons';

    expect(getActiveMarkdownWikiLinkCompletion(input, input.length, input.length)).toEqual({
      openStart: 4,
      queryStart: 6,
      queryEnd: 10,
      replaceEnd: 10,
      query: 'Cons',
    });
  });

  it('replaces the current bracket target and keeps existing closing brackets', () => {
    const input = 'See [[Cons]] today';
    const caret = input.indexOf('s') + 1;
    const completion = getActiveMarkdownWikiLinkCompletion(input, caret, caret);

    expect(completion).toMatchObject({
      query: 'Cons',
      replaceEnd: input.indexOf(']]'),
    });
    expect(getMarkdownWikiLinkCompletionReplacement(input, completion!, 'Consensus')).toEqual({
      nextValue: 'See [[Consensus]] today',
      selectionStart: 17,
      selectionEnd: 17,
    });
  });

  it('adds closing brackets when accepting an unfinished link', () => {
    const input = 'See [[Cons today';
    const caret = input.indexOf(' today');
    const completion = getActiveMarkdownWikiLinkCompletion(input, caret, caret);

    expect(getMarkdownWikiLinkCompletionReplacement(input, completion!, 'Consensus')).toEqual({
      nextValue: 'See [[Consensus]] today',
      selectionStart: 17,
      selectionEnd: 17,
    });
  });

  it('does not complete outside an active simple wikilink target', () => {
    expect(getActiveMarkdownWikiLinkCompletion('See [[Cons]]', 12, 12)).toBeNull();
    expect(getActiveMarkdownWikiLinkCompletion('See [[Con\ns', 10, 10)).toBeNull();
    expect(getActiveMarkdownWikiLinkCompletion('See [[Target|alias', 18, 18)).toBeNull();
    expect(getActiveMarkdownWikiLinkCompletion('See [[Cons', 7, 9)).toBeNull();
  });
});

describe('getMarkdownWikiLinkAutoCloseEdit', () => {
  it('adds closing brackets when the user has just typed opening brackets', () => {
    const input = 'See [[';

    expect(getMarkdownWikiLinkAutoCloseEdit(input, input.length, input.length)).toEqual({
      nextValue: 'See [[]]',
      selectionStart: input.length,
      selectionEnd: input.length,
    });
  });

  it('does not duplicate closing brackets or run on non-caret edits', () => {
    expect(getMarkdownWikiLinkAutoCloseEdit('See [[]]', 6, 6)).toBeNull();
    expect(getMarkdownWikiLinkAutoCloseEdit('See [[[', 7, 7)).toBeNull();
    expect(getMarkdownWikiLinkAutoCloseEdit('See [[', 5, 6)).toBeNull();
  });
});

describe('isUnresolvedWikiHref / decodeUnresolvedWikiHref', () => {
  it('detects the unresolved sentinel and decodes the title', () => {
    expect(isUnresolvedWikiHref('wiki://!/Brand%20New')).toBe(true);
    expect(isUnresolvedWikiHref('wiki://entries/my-page')).toBe(false);
    expect(decodeUnresolvedWikiHref('wiki://!/Brand%20New')).toBe('Brand New');
  });
});
