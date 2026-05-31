import fs from 'fs';
import os from 'os';
import path from 'path';

function isInsidePath(candidatePath: string, rootPath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

export interface FieldTheoryTestEnv {
  rootDir: string;
  homeDir: string;
  fieldTheoryDir: string;
  libraryDir: string;
  commandsDir: string;
  sharedFilesRootDir: string;
  sharedFilesCacheDir: string;
  bookmarkDataDir: string;
  ideasDir: string;
  env: NodeJS.ProcessEnv;
  assertInsideTestRoot: (candidatePath: string) => void;
  assertNoRealFieldTheoryPath: (candidatePath: string) => void;
  cleanup: () => void;
}

export function createFieldTheoryTestEnv(prefix = 'fieldtheory-test-'): FieldTheoryTestEnv {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const homeDir = path.join(rootDir, 'home');
  const fieldTheoryDir = path.join(homeDir, '.fieldtheory');
  const libraryDir = path.join(fieldTheoryDir, 'library');
  const commandsDir = path.join(libraryDir, 'Commands');
  const sharedFilesRootDir = path.join(fieldTheoryDir, 'shared');
  const sharedFilesCacheDir = path.join(libraryDir, 'River (shared)');
  const bookmarkDataDir = path.join(fieldTheoryDir, 'bookmarks');
  const ideasDir = path.join(fieldTheoryDir, 'ideas');

  fs.mkdirSync(commandsDir, { recursive: true });
  fs.mkdirSync(sharedFilesRootDir, { recursive: true });
  fs.mkdirSync(sharedFilesCacheDir, { recursive: true });
  fs.mkdirSync(bookmarkDataDir, { recursive: true });
  fs.mkdirSync(ideasDir, { recursive: true });

  const assertInsideTestRoot = (candidatePath: string): void => {
    if (!isInsidePath(candidatePath, rootDir)) {
      throw new Error(`Expected ${candidatePath} to stay inside Field Theory test root ${rootDir}`);
    }
  };

  const assertNoRealFieldTheoryPath = (candidatePath: string): void => {
    const realFieldTheoryDir = path.join(os.homedir(), '.fieldtheory');
    if (isInsidePath(candidatePath, realFieldTheoryDir)) {
      throw new Error(`Refusing to use real Field Theory data path in a test: ${candidatePath}`);
    }
  };

  return {
    rootDir,
    homeDir,
    fieldTheoryDir,
    libraryDir,
    commandsDir,
    sharedFilesRootDir,
    sharedFilesCacheDir,
    bookmarkDataDir,
    ideasDir,
    env: {
      FT_DATA_DIR: bookmarkDataDir,
      FT_LIBRARY_DIR: libraryDir,
      FT_COMMANDS_DIR: commandsDir,
      FT_SHARED_FILES_ROOT_DIR: sharedFilesRootDir,
      FT_SHARED_FILES_CACHE_DIR: sharedFilesCacheDir,
      FT_IDEAS_DIR: ideasDir,
    },
    assertInsideTestRoot,
    assertNoRealFieldTheoryPath,
    cleanup: () => {
      fs.rmSync(rootDir, { recursive: true, force: true });
    },
  };
}
