import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'os';
import path from 'path';

export interface LauncherFileInfo {
  name: string;
  displayName: string;
  filePath: string;
  isDirectory: boolean;
  lastModified: number;
}

export interface LauncherFileSearchResult {
  files: LauncherFileInfo[];
  indexing: boolean;
  indexedAt: number | null;
}

export interface FileIndexOptions {
  roots?: string[];
  now?: number;
  maxAgeMs?: number;
  maxDepth?: number;
  maxEntries?: number;
}

export interface OpenLauncherFileOptions {
  roots?: string[];
  openPath: (filePath: string) => Promise<string>;
}

const FILE_INDEX_TTL_MS = 10 * 60_000;
const DEFAULT_MAX_INDEX_DEPTH = 8;
const DEFAULT_MAX_INDEX_ENTRIES = 80_000;
const SKIPPED_DIRECTORY_NAMES = new Set([
  '.cache',
  '.git',
  '.Trash',
  'Applications',
  'build',
  'DerivedData',
  'dist',
  'electron-dist',
  'Library',
  'node_modules',
  'venv',
  '.venv',
]);

let indexedAt = 0;
let indexRootsKey = '';
let fileIndex: LauncherFileInfo[] = [];
let indexingPromise: Promise<void> | null = null;
let indexGeneration = 0;

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawPath of paths) {
    const normalized = path.normalize(rawPath);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

async function uniqueExistingDirs(dirs: string[]): Promise<string[]> {
  const result: string[] = [];
  for (const dir of uniquePaths(dirs)) {
    try {
      if ((await fs.stat(dir)).isDirectory()) result.push(dir);
    } catch {}
  }
  return result;
}

function uniqueExistingDirsSync(dirs: string[]): string[] {
  const result: string[] = [];
  for (const dir of uniquePaths(dirs)) {
    try {
      if (fsSync.statSync(dir).isDirectory()) result.push(dir);
    } catch {}
  }
  return result;
}

export function getDefaultLauncherFileSearchRoots(homeDir: string = os.homedir()): string[] {
  return uniquePaths([
    path.join(homeDir, 'Desktop'),
    path.join(homeDir, 'Documents'),
    path.join(homeDir, 'Downloads'),
    path.join(homeDir, '.fieldtheory', 'library'),
  ]);
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function shouldSkipDirectory(name: string): boolean {
  return SKIPPED_DIRECTORY_NAMES.has(name) || (name.startsWith('.') && name !== '.fieldtheory');
}

function createLauncherFileInfo(filePath: string, isDirectory: boolean, lastModified: number): LauncherFileInfo {
  const name = path.basename(filePath);
  return {
    name,
    displayName: name,
    filePath,
    isDirectory,
    lastModified,
  };
}

async function visitIndexDir(input: {
  dir: string;
  depth: number;
  maxDepth: number;
  maxEntries: number;
  byPath: Map<string, LauncherFileInfo>;
}): Promise<void> {
  if (input.depth > input.maxDepth || input.byPath.size >= input.maxEntries) return;

  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(input.dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (input.byPath.size >= input.maxEntries) return;
    if (entry.name.startsWith('.') && entry.name !== '.fieldtheory') continue;
    const fullPath = path.join(input.dir, entry.name);

    if (entry.isDirectory() && shouldSkipDirectory(entry.name)) continue;

    let stats: { isDirectory: () => boolean; mtimeMs: number };
    try {
      stats = await fs.stat(fullPath);
    } catch {
      continue;
    }

    const isDirectory = stats.isDirectory();
    input.byPath.set(path.normalize(fullPath), createLauncherFileInfo(fullPath, isDirectory, stats.mtimeMs));

    if (isDirectory) {
      await visitIndexDir({
        ...input,
        dir: fullPath,
        depth: input.depth + 1,
      });
    }
  }
}

function scoreFile(info: LauncherFileInfo, query: string): number {
  const name = info.name.toLowerCase();
  const filePath = info.filePath.toLowerCase();
  const directoryBoost = info.isDirectory ? 40 : 0;
  if (name === query) return 1000 + directoryBoost;
  if (name.startsWith(query)) return 900 - Math.min(120, name.length - query.length) + directoryBoost;
  if (name.split(/[\s._-]+/).some(part => part.startsWith(query))) return 760 - Math.min(120, name.length - query.length) + directoryBoost;
  const nameIndex = name.indexOf(query);
  if (nameIndex >= 0) return 620 - Math.min(180, nameIndex * 5) + directoryBoost;
  const pathIndex = filePath.indexOf(query);
  if (pathIndex >= 0) return 420 - Math.min(180, pathIndex) + directoryBoost;
  return 0;
}

function searchIndex(query: string, limit: number): LauncherFileInfo[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];
  return fileIndex
    .map(file => ({ file, score: scoreFile(file, normalizedQuery) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.file.lastModified - a.file.lastModified || a.file.filePath.localeCompare(b.file.filePath))
    .slice(0, limit)
    .map(({ file }) => file);
}

export function isLauncherFileIndexing(): boolean {
  return indexingPromise !== null;
}

export async function warmLauncherFileIndex(options: FileIndexOptions = {}): Promise<void> {
  const roots = await uniqueExistingDirs(options.roots ?? getDefaultLauncherFileSearchRoots());
  const rootsKey = roots.join('\0');
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? FILE_INDEX_TTL_MS;
  if (indexingPromise) return indexingPromise;
  if (rootsKey === indexRootsKey && fileIndex.length > 0 && now - indexedAt < maxAgeMs) return;

  const generation = indexGeneration;
  indexingPromise = (async () => {
    const byPath = new Map<string, LauncherFileInfo>();
    for (const root of roots) {
      await visitIndexDir({
        dir: root,
        depth: 0,
        maxDepth: options.maxDepth ?? DEFAULT_MAX_INDEX_DEPTH,
        maxEntries: options.maxEntries ?? DEFAULT_MAX_INDEX_ENTRIES,
        byPath,
      });
      if (byPath.size >= (options.maxEntries ?? DEFAULT_MAX_INDEX_ENTRIES)) break;
    }
    if (generation === indexGeneration) {
      fileIndex = Array.from(byPath.values());
      indexRootsKey = rootsKey;
      indexedAt = Date.now();
    }
  })().finally(() => {
    if (generation === indexGeneration) {
      indexingPromise = null;
    }
  });

  return indexingPromise;
}

export async function searchLauncherFiles(
  query: string,
  options: FileIndexOptions & { limit?: number } = {},
): Promise<LauncherFileSearchResult> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    void warmLauncherFileIndex(options);
    return { files: [], indexing: isLauncherFileIndexing(), indexedAt: indexedAt || null };
  }

  void warmLauncherFileIndex(options);
  return {
    files: searchIndex(trimmedQuery, Math.max(1, Math.min(50, Math.floor(options.limit ?? 20)))),
    indexing: isLauncherFileIndexing(),
    indexedAt: indexedAt || null,
  };
}

export function resolveLauncherFilePath(filePath: string, roots: string[] = getDefaultLauncherFileSearchRoots()): string | null {
  if (!filePath) return null;
  const normalizedPath = path.normalize(filePath);
  const normalizedRoots = uniqueExistingDirsSync(roots);
  if (!normalizedRoots.some(root => isPathInside(root, normalizedPath))) return null;
  try {
    fsSync.statSync(normalizedPath);
    return normalizedPath;
  } catch {
    return null;
  }
}

export async function openLauncherFile(
  filePath: string,
  options: OpenLauncherFileOptions,
): Promise<{ success: boolean; error?: string }> {
  const resolvedPath = resolveLauncherFilePath(filePath, options.roots);
  if (!resolvedPath) return { success: false, error: 'File not found' };
  const error = await options.openPath(resolvedPath);
  if (error) return { success: false, error };
  return { success: true };
}

export function clearLauncherFileIndexForTests(): void {
  indexGeneration += 1;
  indexedAt = 0;
  indexRootsKey = '';
  fileIndex = [];
  indexingPromise = null;
}
