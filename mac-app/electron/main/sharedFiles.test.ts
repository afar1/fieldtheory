import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  applySharedFileFrontmatter,
  buildSharedCacheFileName,
  buildSharedConflictFileName,
  inferSharedFileType,
  isSharedFilesPath,
  normalizeSharedRelativePath,
  parseSharedFileFrontmatter,
  sharedFilesRoot,
  stripSharedFileFrontmatter,
} from './sharedFiles';

describe('sharedFiles path helpers', () => {
  it('uses the River UI directory under the library root', () => {
    const homeDir = '/tmp/fieldtheory-home';
    expect(sharedFilesRoot({ homeDir })).toBe(path.join(homeDir, '.fieldtheory', 'library', 'River (shared)'));
    expect(isSharedFilesPath(path.join(homeDir, '.fieldtheory', 'library', 'River (shared)', 'Note AF.md'), { homeDir })).toBe(true);
    expect(isSharedFilesPath(path.join(homeDir, '.fieldtheory', 'library', 'scratchpad', 'Note.md'), { homeDir })).toBe(false);
  });

  it('rejects unsafe shared relative paths', () => {
    expect(normalizeSharedRelativePath('/tmp/secret.md')).toBeNull();
    expect(normalizeSharedRelativePath('../secret.md')).toBeNull();
    expect(normalizeSharedRelativePath('Team/../secret.md')).toBeNull();
    expect(normalizeSharedRelativePath('Team/secret.txt')).toBeNull();
    expect(normalizeSharedRelativePath('Team/Note.md')).toBe('Team/Note.md');
  });
});

describe('sharedFiles metadata helpers', () => {
  it('preserves shared frontmatter metadata without dropping existing metadata', () => {
    const content = applySharedFileFrontmatter('---\nkind: command\n---\n\nRun this.\n', {
      sharedId: 'shared-1',
      title: 'review',
      teamId: 'team-1',
      teamName: 'Field Theory Team',
      authorId: 'user-1',
      authorName: 'Andrew Farah',
      authorInitials: 'af',
      authorCallsign: 'afar',
      type: 'command',
      originalSourcePath: '/Users/afar/.fieldtheory/library/Commands/review.md',
      revision: 4,
    });

    expect(content).toContain('kind: command');
    expect(content).toContain('shared: true');
    expect(parseSharedFileFrontmatter(content)).toEqual({
      sharedId: 'shared-1',
      title: 'review',
      teamId: 'team-1',
      teamName: 'Field Theory Team',
      authorId: 'user-1',
      authorName: 'Andrew Farah',
      authorInitials: 'AF',
      authorCallsign: 'afar',
      type: 'command',
      originalSourcePath: '/Users/afar/.fieldtheory/library/Commands/review.md',
      revision: 4,
    });
  });

  it('strips only River-managed frontmatter before storing shared content', () => {
    expect(stripSharedFileFrontmatter('---\ntitle: Roadmap\nshared: true\nshared_id: "shared-1"\nshared_type: "document"\ntags: planning\n---\n\nBody\n')).toBe('---\ntitle: Roadmap\ntags: planning\n---\n\nBody\n');
    expect(stripSharedFileFrontmatter('---\nshared: true\nshared_id: "shared-1"\nshared_type: "document"\n---\n\nBody\n')).toBe('Body\n');
  });

  it('infers command and plan types from frontmatter and paths', () => {
    expect(inferSharedFileType({ content: '---\nkind: command\n---\nbody' })).toBe('command');
    expect(inferSharedFileType({ filePath: '/Users/afar/.fieldtheory/library/Commands/review.md' })).toBe('command');
    expect(inferSharedFileType({ filePath: '/Users/afar/.fieldtheory/library/Plans/launch.md' })).toBe('plan');
    expect(inferSharedFileType({ filePath: '/Users/afar/.fieldtheory/library/scratchpad/note.md' })).toBe('document');
  });
});

describe('sharedFiles naming helpers', () => {
  it('uses author initials and Mac-style suffixes for cache collisions', () => {
    expect(buildSharedCacheFileName({
      title: 'Roadmap.md',
      authorInitials: 'af',
      existingFileNames: ['Roadmap AF.md', 'Roadmap AF 2.md'],
    })).toBe('Roadmap AF 3.md');
  });

  it('builds private conflict copy names with initials and timestamp', () => {
    expect(buildSharedConflictFileName({
      fileName: 'Roadmap.md',
      authorInitials: 'AF',
      date: new Date('2026-05-22T21:31:00.000Z'),
    })).toBe('Roadmap conflict AF 2026-05-22 21-31.md');
  });
});
