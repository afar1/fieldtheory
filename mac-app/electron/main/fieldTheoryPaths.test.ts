import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  bookmarkDataDir,
  canonicalBookmarkDataDir,
  canonicalLibraryDir,
  commandsDir,
  ideasDir,
  legacyLibraryDir,
  libraryDir,
  sharedFilesCacheDir,
  sharedFilesRootDir,
} from './fieldTheoryPaths';
import { createFieldTheoryTestEnv } from './testSupport/fieldTheoryTestEnv';

describe('Field Theory path contract', () => {
  const homeDir = '/Users/tester';

  it('uses canonical Field Theory defaults', () => {
    const options = { homeDir, env: {} };

    expect(canonicalBookmarkDataDir(options)).toBe(path.join(homeDir, '.fieldtheory', 'bookmarks'));
    expect(canonicalLibraryDir(options)).toBe(path.join(homeDir, '.fieldtheory', 'library'));
    expect(sharedFilesRootDir(options)).toBe(path.join(homeDir, '.fieldtheory', 'shared'));
    expect(sharedFilesCacheDir(options)).toBe(path.join(homeDir, '.fieldtheory', 'library', 'River (shared)'));
    expect(commandsDir(options)).toBe(path.join(homeDir, '.fieldtheory', 'library', 'Commands'));
    expect(ideasDir(options)).toBe(path.join(homeDir, '.fieldtheory', 'ideas'));
  });

  it('honors explicit env overrides', () => {
    const options = {
      homeDir,
      env: {
        FT_DATA_DIR: '/tmp/ft-data',
        FT_LIBRARY_DIR: '/tmp/ft-library',
        FT_SHARED_FILES_ROOT_DIR: '/tmp/ft-shared',
        FT_SHARED_FILES_CACHE_DIR: '/tmp/ft-shared-cache',
        FT_COMMANDS_DIR: '/tmp/ft-commands',
        FT_IDEAS_DIR: '/tmp/ft-ideas',
      },
    };

    expect(bookmarkDataDir(options)).toBe('/tmp/ft-data');
    expect(libraryDir(options)).toBe('/tmp/ft-library');
    expect(sharedFilesRootDir(options)).toBe('/tmp/ft-shared');
    expect(sharedFilesCacheDir(options)).toBe('/tmp/ft-shared-cache');
    expect(commandsDir(options)).toBe('/tmp/ft-commands');
    expect(ideasDir(options)).toBe('/tmp/ft-ideas');
  });

  it('places default commands inside a custom Library root', () => {
    const options = {
      homeDir,
      env: {
        FT_LIBRARY_DIR: '/tmp/ft-library',
      },
    };

    expect(commandsDir(options)).toBe(path.join('/tmp/ft-library', 'Commands'));
    expect(sharedFilesCacheDir(options)).toBe(path.join('/tmp/ft-library', 'River (shared)'));
  });

  it('uses canonical bookmark data when neither bookmark data root exists', () => {
    const options = { homeDir, env: {} };

    expect(bookmarkDataDir(options)).toBe(path.join(homeDir, '.fieldtheory', 'bookmarks'));
  });

  it('falls back to legacy bookmark data when canonical data is absent and legacy data exists', () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-paths-'));
    const legacyData = path.join(tempHome, '.ft-bookmarks');
    fs.mkdirSync(legacyData, { recursive: true });

    try {
      expect(bookmarkDataDir({ homeDir: tempHome, env: {} })).toBe(legacyData);
    } finally {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('treats an empty bookmark data override like the CLI and still falls back to legacy data', () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-paths-'));
    const legacyData = path.join(tempHome, '.ft-bookmarks');
    fs.mkdirSync(legacyData, { recursive: true });

    try {
      expect(bookmarkDataDir({ homeDir: tempHome, env: { FT_DATA_DIR: '' } })).toBe(legacyData);
    } finally {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('does not fall back to legacy library markdown when canonical library is absent', () => {
    const options = { homeDir, env: {} };

    expect(libraryDir(options)).toBe(path.join(homeDir, '.fieldtheory', 'library'));
  });

  it('prefers canonical paths when both canonical and legacy paths exist', () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-paths-'));
    const canonicalData = path.join(tempHome, '.fieldtheory', 'bookmarks');
    const legacyData = path.join(tempHome, '.ft-bookmarks');
    fs.mkdirSync(canonicalData, { recursive: true });
    fs.mkdirSync(legacyData, { recursive: true });
    const canonicalMd = path.join(tempHome, '.fieldtheory', 'library');
    const options = {
      homeDir: tempHome,
      env: {},
    };

    try {
      expect(bookmarkDataDir(options)).toBe(canonicalData);
      expect(libraryDir(options)).toBe(canonicalMd);
    } finally {
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });

  it('keeps legacyLibraryDir available for old custom data roots without making it active', () => {
    const options = {
      homeDir,
      env: { FT_DATA_DIR: '/tmp/custom-data' },
    };

    expect(legacyLibraryDir(options)).toBe('/tmp/custom-data/md');
    expect(libraryDir(options)).toBe(path.join(homeDir, '.fieldtheory', 'library'));
  });

  it('provides an isolated test fixture for local Field Theory data paths', () => {
    const fixture = createFieldTheoryTestEnv();

    try {
      const options = { homeDir: fixture.homeDir, env: fixture.env };

      expect(bookmarkDataDir(options)).toBe(fixture.bookmarkDataDir);
      expect(libraryDir(options)).toBe(fixture.libraryDir);
      expect(commandsDir(options)).toBe(fixture.commandsDir);
      expect(sharedFilesRootDir(options)).toBe(fixture.sharedFilesRootDir);
      expect(sharedFilesCacheDir(options)).toBe(fixture.sharedFilesCacheDir);
      expect(ideasDir(options)).toBe(fixture.ideasDir);

      fixture.assertInsideTestRoot(libraryDir(options));
      fixture.assertInsideTestRoot(commandsDir(options));
      expect(() => fixture.assertNoRealFieldTheoryPath(path.join(os.homedir(), '.fieldtheory', 'library'))).toThrow(/real Field Theory data path/);
    } finally {
      fixture.cleanup();
    }
  });
});
