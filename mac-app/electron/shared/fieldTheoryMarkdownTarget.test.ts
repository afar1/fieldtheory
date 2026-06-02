import { describe, expect, it } from 'vitest';
import {
  browserLibraryTargetFromSearchParams,
  normalizeBrowserLibraryOpenTarget,
  normalizeFieldTheoryMarkdownTarget,
} from './fieldTheoryMarkdownTarget';

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

describe('normalizeBrowserLibraryOpenTarget', () => {
  it('allows only the Browser Library included surfaces and documents', () => {
    expect(normalizeBrowserLibraryOpenTarget({ kind: 'wiki', path: 'scratchpad/note' })).toEqual({
      kind: 'wiki',
      path: 'scratchpad/note',
    });
    expect(normalizeBrowserLibraryOpenTarget({ kind: 'commands' })).toEqual({
      kind: 'commands',
      path: 'commands',
    });
    expect(normalizeBrowserLibraryOpenTarget({ kind: 'bookmarks' })).toEqual({
      kind: 'bookmarks',
      path: 'bookmarks',
    });
    expect(normalizeBrowserLibraryOpenTarget({ kind: 'clipboard' })).toBeNull();
    expect(normalizeBrowserLibraryOpenTarget({ kind: 'settings', path: 'settings' })).toBeNull();
    expect(normalizeBrowserLibraryOpenTarget({ kind: 'feedback', path: 'feedback' })).toBeNull();
  });
});

describe('browserLibraryTargetFromSearchParams', () => {
  it('parses JSON target params through the shared Browser Library boundary', () => {
    const target = {
      kind: 'wiki',
      path: 'scratchpad/June 2.md',
      contentMode: 'markdown',
      selectionStart: 5,
      selectionEnd: 12,
      focusChrome: true,
    };
    const params = new URLSearchParams({ target: JSON.stringify(target) });

    expect(browserLibraryTargetFromSearchParams(params)).toEqual(target);
  });

  it('parses flat query params including path aliases and flags', () => {
    const params = new URLSearchParams('kind=external&file=%2Ftmp%2FPlan.md&contentMode=rendered&sidebarCollapsed=1&selectionStart=2&selectionEnd=8');

    expect(browserLibraryTargetFromSearchParams(params)).toEqual({
      kind: 'external',
      path: '/tmp/Plan.md',
      contentMode: 'rendered',
      sidebarCollapsed: true,
      selectionStart: 2,
      selectionEnd: 8,
    });
  });

  it('uses the default kind for direct surface links', () => {
    expect(browserLibraryTargetFromSearchParams(new URLSearchParams('focusChrome=true'), 'ember')).toEqual({
      kind: 'ember',
      path: 'ember',
      focusChrome: true,
    });
  });

  it('rejects excluded or invalid targets', () => {
    expect(browserLibraryTargetFromSearchParams(new URLSearchParams('kind=clipboard'))).toBeNull();
    expect(browserLibraryTargetFromSearchParams(new URLSearchParams('kind=settings&path=settings'))).toBeNull();
    expect(browserLibraryTargetFromSearchParams(new URLSearchParams('target={bad json'))).toBeNull();
  });
});
