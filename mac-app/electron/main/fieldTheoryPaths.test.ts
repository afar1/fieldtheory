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

describe('Field Theory path contract', () => {
  const homeDir = '/Users/tester';

  it('uses canonical Field Theory defaults', () => {
    const options = { homeDir, env: {} };

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
    };

    expect(bookmarkDataDir(options)).toBe('/tmp/ft-data');
    expect(libraryDir(options)).toBe('/tmp/ft-library');
    expect(commandsDir(options)).toBe('/tmp/ft-commands');
  });

  it('does not fall back to legacy bookmark data when canonical data is absent', () => {
    const options = { homeDir, env: {} };

    expect(bookmarkDataDir(options)).toBe(path.join(homeDir, '.fieldtheory', 'bookmarks'));
  });

  it('does not fall back to legacy library markdown when canonical library is absent', () => {
    const options = { homeDir, env: {} };

    expect(libraryDir(options)).toBe(path.join(homeDir, '.fieldtheory', 'library'));
  });

  it('prefers canonical paths when both canonical and legacy paths exist', () => {
    const canonicalData = path.join(homeDir, '.fieldtheory', 'bookmarks');
    const canonicalMd = path.join(homeDir, '.fieldtheory', 'library');
    const options = {
      homeDir,
      env: {},
    };

    expect(bookmarkDataDir(options)).toBe(canonicalData);
    expect(libraryDir(options)).toBe(canonicalMd);
  });

  it('keeps legacyLibraryDir available for old custom data roots without making it active', () => {
    const options = {
      homeDir,
      env: { FT_DATA_DIR: '/tmp/custom-data' },
    };

    expect(legacyLibraryDir(options)).toBe('/tmp/custom-data/md');
    expect(libraryDir(options)).toBe(path.join(homeDir, '.fieldtheory', 'library'));
  });
});
