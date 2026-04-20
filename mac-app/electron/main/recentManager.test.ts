import { describe, it, expect } from 'vitest';
import { upsertRecent, removeRecent, type RecentEntry } from './recentManager';

const e = (kind: 'wiki' | 'external', p: string, t: number): RecentEntry => ({
  kind,
  path: p,
  title: p.split('/').pop() ?? p,
  lastOpenedAt: t,
});

describe('upsertRecent', () => {
  it('prepends a new entry to an empty list', () => {
    const out = upsertRecent([], e('wiki', 'debates/x', 100));
    expect(out).toHaveLength(1);
    expect(out[0].path).toBe('debates/x');
  });

  it('moves an existing (kind,path) entry to the front with the new timestamp', () => {
    // List is already newest-first (c most-recent, a oldest).
    const before = [e('wiki', 'c', 3), e('wiki', 'b', 2), e('wiki', 'a', 1)];
    const out = upsertRecent(before, e('wiki', 'a', 99));
    expect(out.map((r) => r.path)).toEqual(['a', 'c', 'b']);
    expect(out[0].lastOpenedAt).toBe(99);
  });

  it('dedupes on (kind,path) composite so wiki and external with the same string coexist', () => {
    const before = [e('wiki', 'readme.md', 1)];
    const out = upsertRecent(before, e('external', 'readme.md', 2));
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe('external');
    expect(out[1].kind).toBe('wiki');
  });

  it('caps the list at max, dropping the oldest (tail of a newest-first list)', () => {
    // Newest-first: p0 is newest, p49 is oldest.
    const before = Array.from({ length: 50 }, (_, i) => e('wiki', `p${i}`, 50 - i));
    const out = upsertRecent(before, e('wiki', 'new', 999), 50);
    expect(out).toHaveLength(50);
    expect(out[0].path).toBe('new');
    // Oldest ('p49') gets dropped.
    expect(out.some((r) => r.path === 'p49')).toBe(false);
    expect(out.some((r) => r.path === 'p0')).toBe(true);
  });
});

describe('removeRecent', () => {
  it('removes only the matching (kind,path) entry', () => {
    const before = [
      e('wiki', 'readme.md', 1),
      e('external', 'readme.md', 2),
      e('wiki', 'other.md', 3),
    ];
    const out = removeRecent(before, 'external', 'readme.md');
    expect(out).toHaveLength(2);
    expect(out.some((r) => r.kind === 'external')).toBe(false);
  });

  it('is a no-op when the entry is missing', () => {
    const before = [e('wiki', 'a', 1)];
    const out = removeRecent(before, 'wiki', 'missing');
    expect(out).toEqual(before);
  });
});
