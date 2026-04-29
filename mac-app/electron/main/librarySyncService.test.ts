import { describe, expect, it } from 'vitest';
import path from 'path';
import {
  clientIdForLibrarySourcePath,
  getLibrarySyncSourceRoots,
  normalizeLibrarySourcePath,
} from './librarySyncService';
import { fieldTheoryDir, libraryDir } from './fieldTheoryPaths';

describe('librarySyncService path helpers', () => {
  it('normalizes remote source paths to markdown paths', () => {
    expect(normalizeLibrarySourcePath('scratchpad/today', 'Today')).toBe('scratchpad/today.md');
    expect(normalizeLibrarySourcePath('entries/note.md', 'Note')).toBe('entries/note.md');
    expect(normalizeLibrarySourcePath(null, 'Quick Note')).toBe('scratchpad/Quick Note.md');
  });

  it('rejects path traversal segments', () => {
    expect(normalizeLibrarySourcePath('../secrets.md', 'Secrets')).toBeNull();
    expect(normalizeLibrarySourcePath('scratchpad/../secrets.md', 'Secrets')).toBeNull();
    expect(normalizeLibrarySourcePath('/Users/afar/secrets.md', 'Secrets')).toBeNull();
  });

  it('generates stable client ids from source paths', () => {
    expect(clientIdForLibrarySourcePath('scratchpad/today.md')).toBe(clientIdForLibrarySourcePath('scratchpad/today.md'));
    expect(clientIdForLibrarySourcePath('scratchpad/today.md')).not.toBe(clientIdForLibrarySourcePath('entries/today.md'));
  });

  it('syncs both the library directory and central artifacts directory', () => {
    expect(getLibrarySyncSourceRoots()).toEqual([
      { dirPath: libraryDir(), sourcePrefix: '' },
      { dirPath: path.join(fieldTheoryDir(), 'librarian', 'artifacts'), sourcePrefix: 'artifacts' },
    ]);
  });
});
