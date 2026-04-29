import { describe, expect, it } from 'vitest';
import {
  clientIdForLibrarySourcePath,
  normalizeLibrarySourcePath,
} from './librarySyncService';

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
});
