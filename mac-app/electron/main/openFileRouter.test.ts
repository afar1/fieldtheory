import path from 'path';
import { describe, it, expect } from 'vitest';
import { isAllowedFieldTheoryDocumentExt, isAllowedMarkdownExt, resolveIncomingMarkdownPath } from './openFileRouter';

describe('isAllowedMarkdownExt', () => {
  it('accepts .md / .markdown / .mdx regardless of case', () => {
    expect(isAllowedMarkdownExt('/x/a.md')).toBe(true);
    expect(isAllowedMarkdownExt('/x/a.MD')).toBe(true);
    expect(isAllowedMarkdownExt('/x/a.markdown')).toBe(true);
    expect(isAllowedMarkdownExt('/x/a.MDX')).toBe(true);
  });

  it('rejects non-markdown extensions', () => {
    expect(isAllowedMarkdownExt('/x/a.txt')).toBe(false);
    expect(isAllowedMarkdownExt('/x/a')).toBe(false);
    expect(isAllowedMarkdownExt('/x/a.md.bak')).toBe(false);
  });
});

describe('isAllowedFieldTheoryDocumentExt', () => {
  it('accepts markdown, html, and css document files', () => {
    expect(isAllowedFieldTheoryDocumentExt('/x/a.md')).toBe(true);
    expect(isAllowedFieldTheoryDocumentExt('/x/a.mdx')).toBe(true);
    expect(isAllowedFieldTheoryDocumentExt('/x/a.html')).toBe(true);
    expect(isAllowedFieldTheoryDocumentExt('/x/a.htm')).toBe(true);
    expect(isAllowedFieldTheoryDocumentExt('/x/a.css')).toBe(true);
    expect(isAllowedFieldTheoryDocumentExt('/x/a.png')).toBe(false);
  });
});

describe('resolveIncomingMarkdownPath', () => {
  const wikiRoot = '/users/me/.fieldtheory/library';
  const identityRealpath = (p: string) => p;
  const throwingRealpath = () => { throw new Error('ENOENT'); };

  it('returns null for non-markdown files', () => {
    expect(resolveIncomingMarkdownPath('/x/a.txt', wikiRoot, identityRealpath)).toBeNull();
  });

  it('returns null when the path cannot be realpath-resolved', () => {
    expect(resolveIncomingMarkdownPath('/missing/a.md', wikiRoot, throwingRealpath)).toBeNull();
  });

  it('routes paths inside the wiki root to the wiki flow with .md stripped', () => {
    const p = path.join(wikiRoot, 'debates', 'test-entry.md');
    expect(resolveIncomingMarkdownPath(p, wikiRoot, identityRealpath)).toEqual({
      kind: 'wiki',
      relPath: path.join('debates', 'test-entry'),
      absPath: p,
    });
  });

  it('strips markdown-like wiki extensions before routing', () => {
    const p = path.join(wikiRoot, 'debates', 'test-entry.mdx');
    expect(resolveIncomingMarkdownPath(p, wikiRoot, identityRealpath)).toEqual({
      kind: 'wiki',
      relPath: path.join('debates', 'test-entry'),
      absPath: p,
    });
  });

  it('routes html and css files as external documents even inside the wiki root', () => {
    const htmlPath = path.join(wikiRoot, 'reports', 'summary.html');
    const cssPath = path.join(wikiRoot, 'reports', 'styles.css');
    expect(resolveIncomingMarkdownPath(htmlPath, wikiRoot, identityRealpath)).toEqual({
      kind: 'external',
      absPath: htmlPath,
    });
    expect(resolveIncomingMarkdownPath(cssPath, wikiRoot, identityRealpath)).toEqual({
      kind: 'external',
      absPath: cssPath,
    });
  });

  it('routes paths outside the wiki root to the external flow', () => {
    expect(resolveIncomingMarkdownPath('/tmp/notes/journal.md', wikiRoot, identityRealpath)).toEqual({
      kind: 'external',
      absPath: '/tmp/notes/journal.md',
    });
  });

  it('treats null wikiRoot as always-external', () => {
    expect(resolveIncomingMarkdownPath('/anywhere/note.md', null, identityRealpath)).toEqual({
      kind: 'external',
      absPath: '/anywhere/note.md',
    });
  });

  it('uses the canonical path after realpath so symlinks into the wiki root become wiki files', () => {
    const canonical = path.join(wikiRoot, 'scratchpad', 'linked.md');
    const symlink = '/tmp/outside/linked.md';
    const realpath = (p: string) => (p === symlink ? canonical : p);
    expect(resolveIncomingMarkdownPath(symlink, wikiRoot, realpath)).toEqual({
      kind: 'wiki',
      relPath: path.join('scratchpad', 'linked'),
      absPath: canonical,
    });
  });

  it('does not match sibling directories that share a prefix with the wiki root', () => {
    // e.g. wikiRoot = /x/md, sibling = /x/md-backup/... should NOT be treated as wiki.
    const sibling = '/users/me/.fieldtheory/library-backup/note.md';
    expect(resolveIncomingMarkdownPath(sibling, wikiRoot, identityRealpath)).toEqual({
      kind: 'external',
      absPath: sibling,
    });
  });
});
