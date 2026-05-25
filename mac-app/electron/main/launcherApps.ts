import fs from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import * as plist from 'plist';

type LauncherAppBundleInfo = {
  displayName?: string;
  bundleId?: string;
  iconFile?: string;
  iconName?: string;
};

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
