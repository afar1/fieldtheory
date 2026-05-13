import fs from 'fs';
import { execFileSync } from 'child_process';
import os from 'os';
import path from 'path';
import * as plist from 'plist';

export interface LauncherAppInfo {
  name: string;
  displayName: string;
  appPath: string;
  bundleId?: string;
  lastModified: number;
}

export interface LaunchLauncherAppOptions {
  roots?: string[];
  openPath: (appPath: string) => Promise<string>;
  beforeLaunch?: (appPath: string) => void | Promise<void>;
}

type LauncherAppCache = {
  rootsKey: string;
  scannedAt: number;
  apps: LauncherAppInfo[];
};

type LauncherAppBundleInfo = {
  displayName?: string;
  bundleId?: string;
  iconFile?: string;
  iconName?: string;
};

const LAUNCHER_APP_CACHE_TTL_MS = 60_000;
const MAX_APP_SCAN_DEPTH = 4;

let cache: LauncherAppCache | null = null;

function uniqueExistingDirs(dirs: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const dir of dirs) {
    const normalized = path.normalize(dir);
    if (seen.has(normalized) || !fs.existsSync(normalized)) continue;
    try {
      if (!fs.statSync(normalized).isDirectory()) continue;
    } catch {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

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

export function getDefaultLauncherAppRoots(homeDir: string = os.homedir()): string[] {
  return uniquePaths([
    '/Applications',
    path.join(homeDir, 'Applications'),
    '/System/Applications',
  ]);
}

function appNameFromPath(appPath: string): string {
  return path.basename(appPath).replace(/\.app$/i, '');
}

function parseLauncherAppBundleInfo(parsed: Record<string, unknown>): LauncherAppBundleInfo {
  return {
    displayName: typeof parsed.CFBundleDisplayName === 'string'
      ? parsed.CFBundleDisplayName
      : typeof parsed.CFBundleName === 'string'
        ? parsed.CFBundleName
        : undefined,
    bundleId: typeof parsed.CFBundleIdentifier === 'string'
      ? parsed.CFBundleIdentifier
      : undefined,
    iconFile: typeof parsed.CFBundleIconFile === 'string'
      ? parsed.CFBundleIconFile
      : undefined,
    iconName: typeof parsed.CFBundleIconName === 'string'
      ? parsed.CFBundleIconName
      : undefined,
  };
}

function readBinaryPlistInfo(infoPath: string): LauncherAppBundleInfo {
  try {
    const raw = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', infoPath], {
      encoding: 'utf8',
      maxBuffer: 512 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parseLauncherAppBundleInfo(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return {};
  }
}

function readAppBundleInfo(appPath: string, options: { allowBinaryPlist?: boolean } = {}): LauncherAppBundleInfo {
  const infoPath = path.join(appPath, 'Contents', 'Info.plist');
  if (!fs.existsSync(infoPath)) return {};

  try {
    const raw = fs.readFileSync(infoPath, 'utf8');
    if (raw.startsWith('bplist')) {
      return options.allowBinaryPlist ? readBinaryPlistInfo(infoPath) : {};
    }
    return parseLauncherAppBundleInfo(plist.parse(raw) as Record<string, unknown>);
  } catch {
    return {};
  }
}

function candidateLauncherAppIconNames(info: LauncherAppBundleInfo): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const rawName of [info.iconFile, info.iconName]) {
    const name = rawName?.trim();
    if (!name) continue;
    const nameWithExtension = path.extname(name) ? name : `${name}.icns`;
    for (const candidate of [name, nameWithExtension]) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      names.push(candidate);
    }
  }
  return names;
}

export function resolveLauncherAppIconPath(appPath: string): string | null {
  if (!appPath || !/\.app$/i.test(appPath)) return null;
  const normalizedPath = path.normalize(appPath);
  try {
    if (!fs.statSync(normalizedPath).isDirectory()) return null;
  } catch {
    return null;
  }

  const resourcesDir = path.join(normalizedPath, 'Contents', 'Resources');
  const info = readAppBundleInfo(normalizedPath, { allowBinaryPlist: true });
  for (const iconName of candidateLauncherAppIconNames(info)) {
    const iconPath = path.join(resourcesDir, iconName);
    try {
      if (fs.statSync(iconPath).isFile()) return iconPath;
    } catch {}
  }
  return null;
}

function createLauncherAppInfo(appPath: string): LauncherAppInfo | null {
  try {
    const stats = fs.statSync(appPath);
    if (!stats.isDirectory()) return null;
    const pathName = appNameFromPath(appPath);
    const info = readAppBundleInfo(appPath);
    return {
      name: pathName,
      displayName: info.displayName || pathName,
      appPath,
      bundleId: info.bundleId,
      lastModified: stats.mtimeMs,
    };
  } catch {
    return null;
  }
}

function visitAppDir(dir: string, depth: number, byPath: Map<string, LauncherAppInfo>): void {
  if (depth > MAX_APP_SCAN_DEPTH) return;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (/\.app$/i.test(entry.name)) {
      const appInfo = createLauncherAppInfo(fullPath);
      if (appInfo) byPath.set(path.normalize(fullPath), appInfo);
      continue;
    }
    visitAppDir(fullPath, depth + 1, byPath);
  }
}

export function listLauncherApps(options: {
  roots?: string[];
  now?: number;
  maxAgeMs?: number;
} = {}): LauncherAppInfo[] {
  const roots = uniqueExistingDirs(options.roots ?? getDefaultLauncherAppRoots());
  const rootsKey = roots.join('\0');
  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? LAUNCHER_APP_CACHE_TTL_MS;
  if (cache && cache.rootsKey === rootsKey && now - cache.scannedAt < maxAgeMs) {
    return cache.apps;
  }

  const byPath = new Map<string, LauncherAppInfo>();
  for (const root of roots) {
    visitAppDir(root, 0, byPath);
  }
  const apps = Array.from(byPath.values())
    .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.appPath.localeCompare(b.appPath));
  cache = { rootsKey, scannedAt: now, apps };
  return apps;
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

export function resolveLauncherAppPath(appPath: string, roots: string[] = getDefaultLauncherAppRoots()): string | null {
  if (!appPath || !/\.app$/i.test(appPath)) return null;
  const normalizedPath = path.normalize(appPath);
  const normalizedRoots = uniqueExistingDirs(roots);
  if (!normalizedRoots.some(root => isPathInside(root, normalizedPath))) return null;
  try {
    const stats = fs.statSync(normalizedPath);
    return stats.isDirectory() ? normalizedPath : null;
  } catch {
    return null;
  }
}

export async function launchLauncherApp(
  appPath: string,
  options: LaunchLauncherAppOptions,
): Promise<{ success: boolean; error?: string }> {
  const resolvedPath = resolveLauncherAppPath(appPath, options.roots);
  if (!resolvedPath) return { success: false, error: 'App not found' };
  await options.beforeLaunch?.(resolvedPath);
  const error = await options.openPath(resolvedPath);
  if (error) return { success: false, error };
  return { success: true };
}

export function clearLauncherAppCacheForTests(): void {
  cache = null;
}
