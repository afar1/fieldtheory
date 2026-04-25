import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  bookmarkDataDir,
  canonicalBookmarkDataDir,
  canonicalLibraryDir,
  commandsDir,
  legacyLibraryDir,
  libraryDir,
} from './fieldTheoryPaths';

function existsOnly(paths: string[]): (filePath: string) => boolean {
  const existing = new Set(paths);
  return (filePath) => existing.has(filePath);
}

describe('Field Theory path contract', () => {
  const homeDir = '/Users/tester';

  it('uses canonical Field Theory defaults', () => {
    const options = { homeDir, env: {}, existsSync: existsOnly([]) };

    expect(canonicalBookmarkDataDir(options)).toBe(path.join(homeDir, '.fieldtheory', 'bookmarks'));
    expect(canonicalLibraryDir(options)).toBe(path.join(homeDir, '.fieldtheory', 'library'));
    expect(commandsDir(options)).toBe(path.join(homeDir, '.fieldtheory', 'commands'));
  });

  it('honors explicit env overrides', () => {
    const options = {
      homeDir,
      env: {
        FT_DATA_DIR: '/tmp/ft-data',
        FT_LIBRARY_DIR: '/tmp/ft-library',
        FT_COMMANDS_DIR: '/tmp/ft-commands',
      },
      existsSync: existsOnly([]),
    };

    expect(bookmarkDataDir(options)).toBe('/tmp/ft-data');
    expect(libraryDir(options)).toBe('/tmp/ft-library');
    expect(commandsDir(options)).toBe('/tmp/ft-commands');
  });

  it('falls back to legacy bookmark data when canonical data is absent', () => {
    const legacy = path.join(homeDir, '.ft-bookmarks');
    const options = { homeDir, env: {}, existsSync: existsOnly([legacy]) };

    expect(bookmarkDataDir(options)).toBe(legacy);
  });

  it('falls back to legacy library markdown when canonical library is absent', () => {
    const legacy = path.join(homeDir, '.ft-bookmarks', 'md');
    const options = { homeDir, env: {}, existsSync: existsOnly([legacy]) };

    expect(libraryDir(options)).toBe(legacy);
  });

  it('prefers canonical paths when both canonical and legacy paths exist', () => {
    const canonicalData = path.join(homeDir, '.fieldtheory', 'bookmarks');
    const canonicalMd = path.join(homeDir, '.fieldtheory', 'library');
    const options = {
      homeDir,
      env: {},
      existsSync: existsOnly([
        canonicalData,
        canonicalMd,
        path.join(homeDir, '.ft-bookmarks'),
        path.join(homeDir, '.ft-bookmarks', 'md'),
      ]),
    };

    expect(bookmarkDataDir(options)).toBe(canonicalData);
    expect(libraryDir(options)).toBe(canonicalMd);
  });

  it('keeps legacy markdown under FT_DATA_DIR for old custom data roots', () => {
    const options = {
      homeDir,
      env: { FT_DATA_DIR: '/tmp/custom-data' },
      existsSync: existsOnly(['/tmp/custom-data/md']),
    };

    expect(legacyLibraryDir(options)).toBe('/tmp/custom-data/md');
    expect(libraryDir(options)).toBe('/tmp/custom-data/md');
  });
});
