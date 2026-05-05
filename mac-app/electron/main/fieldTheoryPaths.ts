import fs from 'fs';
import os from 'os';
import path from 'path';

export interface FieldTheoryPathOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

function pathEnv(options?: FieldTheoryPathOptions): NodeJS.ProcessEnv {
  return options?.env ?? process.env;
}

function homeDir(options?: FieldTheoryPathOptions): string {
  return options?.homeDir ?? os.homedir();
}

export function fieldTheoryDir(options?: FieldTheoryPathOptions): string {
  return path.join(homeDir(options), '.fieldtheory');
}

export function legacyBookmarkDataDir(options?: FieldTheoryPathOptions): string {
  return path.join(homeDir(options), '.ft-bookmarks');
}

export function legacyLibraryDir(options?: FieldTheoryPathOptions): string {
  const dataOverride = pathEnv(options).FT_DATA_DIR;
  return path.join(dataOverride ?? legacyBookmarkDataDir(options), 'md');
}

export function canonicalBookmarkDataDir(options?: FieldTheoryPathOptions): string {
  return pathEnv(options).FT_DATA_DIR ?? path.join(fieldTheoryDir(options), 'bookmarks');
}

export function canonicalLibraryDir(options?: FieldTheoryPathOptions): string {
  return pathEnv(options).FT_LIBRARY_DIR ?? path.join(fieldTheoryDir(options), 'library');
}

export function commandsDir(options?: FieldTheoryPathOptions): string {
  return pathEnv(options).FT_COMMANDS_DIR ?? path.join(fieldTheoryDir(options), 'commands');
}

export function bookmarkDataDir(options?: FieldTheoryPathOptions): string {
  const dataOverride = pathEnv(options).FT_DATA_DIR;
  if (dataOverride) return dataOverride;

  const canonical = canonicalBookmarkDataDir(options);
  const legacy = legacyBookmarkDataDir(options);
  if (fs.existsSync(canonical) || !fs.existsSync(legacy)) return canonical;
  return legacy;
}

export function libraryDir(options?: FieldTheoryPathOptions): string {
  return canonicalLibraryDir(options);
}
