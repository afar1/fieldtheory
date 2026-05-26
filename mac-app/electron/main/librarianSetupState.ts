import fs from 'fs';
import path from 'path';
import { libraryDir } from './fieldTheoryPaths';
import { getLibraryTextDocumentKind, stripMarkdownFileExtension } from './pathSafety';

const SETUP_SKIP_FILE_NAMES = new Set(['md-state.json', 'index.md', 'log.md', 'schema.md']);

function isHiddenLibrarySetupFolderName(name: string): boolean {
  return name.startsWith('.') || name.startsWith('_') || /\.assets$/i.test(name);
}

function isHiddenLibrarySetupFileName(name: string): boolean {
  return name.startsWith('.') || name.startsWith('_');
}

function isLibrarySetupSkipFileName(fileName: string): boolean {
  return SETUP_SKIP_FILE_NAMES.has(fileName)
    || SETUP_SKIP_FILE_NAMES.has(`${stripMarkdownFileExtension(fileName)}.md`);
}

function isLibrarySetupContentFileName(fileName: string): boolean {
  if (fileName.toLowerCase().startsWith('readme.')) return false;
  return getLibraryTextDocumentKind(fileName) !== null && !isLibrarySetupSkipFileName(fileName);
}

export function hasExistingLibraryContent(rootPath = libraryDir()): boolean {
  const pendingDirs = [rootPath];
  const seenRealPaths = new Set<string>();

  while (pendingDirs.length > 0) {
    const currentDir = pendingDirs.pop()!;
    let currentRealPath: string;
    try {
      if (!fs.existsSync(currentDir) || !fs.statSync(currentDir).isDirectory()) continue;
      currentRealPath = fs.realpathSync(currentDir);
    } catch {
      continue;
    }

    if (seenRealPaths.has(currentRealPath)) continue;
    seenRealPaths.add(currentRealPath);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isDirectory() ? isHiddenLibrarySetupFolderName(entry.name) : isHiddenLibrarySetupFileName(entry.name)) continue;

      const absPath = path.join(currentDir, entry.name);
      let stats: fs.Stats;
      try {
        stats = fs.statSync(absPath);
      } catch {
        continue;
      }

      if (stats.isDirectory()) {
        pendingDirs.push(absPath);
      } else if (stats.isFile() && isLibrarySetupContentFileName(entry.name)) {
        return true;
      }
    }
  }

  return false;
}

export function inferLibrarianSetupComplete(options: {
  settingsPath?: string;
  libraryPath?: string;
} = {}): boolean {
  if (options.settingsPath && fs.existsSync(options.settingsPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(options.settingsPath, 'utf-8')) as { librarianSetupComplete?: unknown };
      if (data.librarianSetupComplete === true) return true;
    } catch {
      // Fall back to the library-content check below.
    }
  }

  return hasExistingLibraryContent(options.libraryPath ?? libraryDir());
}
