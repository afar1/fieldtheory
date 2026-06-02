import { describe, expect, it } from 'vitest';
import { normalizeFieldTheoryMarkdownTarget } from './fieldTheoryMarkdownTarget';

describe('normalizeFieldTheoryMarkdownTarget', () => {
  it('allows Field Theory surface targets without a file path', () => {
    expect(normalizeFieldTheoryMarkdownTarget({ kind: 'library' })).toEqual({ kind: 'library', path: 'library' });
    expect(normalizeFieldTheoryMarkdownTarget({ kind: 'commands' })).toEqual({ kind: 'commands', path: 'commands' });
    expect(normalizeFieldTheoryMarkdownTarget({ kind: 'bookmarks' })).toEqual({ kind: 'bookmarks', path: 'bookmarks' });
    expect(normalizeFieldTheoryMarkdownTarget({ kind: 'ember' })).toEqual({ kind: 'ember', path: 'ember' });
    expect(normalizeFieldTheoryMarkdownTarget({ kind: 'clipboard' })).toEqual({ kind: 'clipboard', path: 'clipboard' });
  });

  it('requires document targets to include a path', () => {
    expect(normalizeFieldTheoryMarkdownTarget({ kind: 'wiki' })).toBeNull();
    expect(normalizeFieldTheoryMarkdownTarget({ kind: 'artifact' })).toBeNull();
    expect(normalizeFieldTheoryMarkdownTarget({ kind: 'command' })).toBeNull();
    expect(normalizeFieldTheoryMarkdownTarget({ kind: 'external' })).toBeNull();
  });

  it('preserves extra target fields when normalizing', () => {
    expect(normalizeFieldTheoryMarkdownTarget({
      kind: 'bookmarks',
      focusChrome: true,
      sidebarCollapsed: true,
    })).toEqual({
      kind: 'bookmarks',
      path: 'bookmarks',
      focusChrome: true,
      sidebarCollapsed: true,
    });
  });
});
