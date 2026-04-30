import path from 'path';
import { describe, expect, it } from 'vitest';
import { isPathInside } from './pathSafety';

describe('pathSafety', () => {
  it('allows nested paths and rejects parent traversal', () => {
    const root = path.join(path.sep, 'tmp', 'notes');

    expect(isPathInside(root, path.join(root, 'entry.md'))).toBe(true);
    expect(isPathInside(root, path.join(root, 'folder', 'entry.md'))).toBe(true);
    expect(isPathInside(root, path.dirname(root))).toBe(false);
    expect(isPathInside(root, path.join(path.dirname(root), 'notes-other', 'entry.md'))).toBe(false);
  });

  it('does not reject an in-folder filename just because it starts with two dots', () => {
    const root = path.join(path.sep, 'tmp', 'notes');

    expect(isPathInside(root, path.join(root, '..draft.md'))).toBe(true);
  });
});
