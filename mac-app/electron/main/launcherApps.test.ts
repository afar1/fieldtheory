import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  clearLauncherAppCacheForTests,
  getDefaultLauncherAppRoots,
  launchLauncherApp,
  listLauncherApps,
  resolveLauncherAppPath,
  resolveLauncherAppIconPath,
} from './launcherApps';

function makeTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-apps-test-'));
}

function makeApp(root: string, relativePath: string, infoPlist: string): string {
  const appPath = path.join(root, relativePath);
  fs.mkdirSync(path.join(appPath, 'Contents'), { recursive: true });
  fs.writeFileSync(path.join(appPath, 'Contents', 'Info.plist'), infoPlist);
  return appPath;
}

describe('launcher app indexing', () => {
  afterEach(() => {
    clearLauncherAppCacheForTests();
  });

  it('lists .app bundles from supplied roots with plist display names and bundle ids', () => {
    const root = makeTempRoot();
    try {
      const appPath = makeApp(root, 'Utilities/Example.app', `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>Example Browser</string>
  <key>CFBundleIdentifier</key>
  <string>com.example.browser</string>
</dict>
</plist>
`);

      const apps = listLauncherApps({ roots: [root], now: 1, maxAgeMs: 0 });

      expect(apps).toEqual([
        expect.objectContaining({
          name: 'Example',
          displayName: 'Example Browser',
          appPath,
          bundleId: 'com.example.browser',
        }),
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('falls back to the bundle filename when Info.plist is unavailable or binary', () => {
    const root = makeTempRoot();
    try {
      const appPath = makeApp(root, 'BinaryOnly.app', 'bplist00...');

      const [app] = listLauncherApps({ roots: [root], now: 1, maxAgeMs: 0 });

      expect(app).toEqual(expect.objectContaining({
        name: 'BinaryOnly',
        displayName: 'BinaryOnly',
        appPath,
      }));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('resolves launch targets only when they are .app directories under allowed roots', () => {
    const root = makeTempRoot();
    const outside = makeTempRoot();
    try {
      const appPath = makeApp(root, 'Allowed.app', '<plist version="1.0"><dict></dict></plist>');
      const outsideAppPath = makeApp(outside, 'Outside.app', '<plist version="1.0"><dict></dict></plist>');
      fs.writeFileSync(path.join(root, 'NotAnApp.app'), 'nope');

      expect(resolveLauncherAppPath(appPath, [root])).toBe(appPath);
      expect(resolveLauncherAppPath(outsideAppPath, [root])).toBeNull();
      expect(resolveLauncherAppPath(path.join(root, 'NotAnApp.app'), [root])).toBeNull();
      expect(resolveLauncherAppPath(path.join(root, 'plain.txt'), [root])).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('resolves the bundle icon file for app row icons', () => {
    const root = makeTempRoot();
    try {
      const appPath = makeApp(root, 'Iconic.app', `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>CFBundleIconFile</key>
  <string>app</string>
</dict>
</plist>
`);
      const iconPath = path.join(appPath, 'Contents', 'Resources', 'app.icns');
      fs.mkdirSync(path.dirname(iconPath), { recursive: true });
      fs.writeFileSync(iconPath, 'icon');

      expect(resolveLauncherAppIconPath(appPath)).toBe(iconPath);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('launches resolved app targets through the provided opener', async () => {
    const root = makeTempRoot();
    const outside = makeTempRoot();
    try {
      const appPath = makeApp(root, 'Allowed.app', '<plist version="1.0"><dict></dict></plist>');
      const outsideAppPath = makeApp(outside, 'Outside.app', '<plist version="1.0"><dict></dict></plist>');
      const opened: string[] = [];
      const hidden: string[] = [];

      const result = await launchLauncherApp(appPath, {
        roots: [root],
        beforeLaunch: async (resolvedPath) => {
          hidden.push(resolvedPath);
        },
        openPath: async (resolvedPath) => {
          opened.push(resolvedPath);
          return '';
        },
      });
      const rejected = await launchLauncherApp(outsideAppPath, {
        roots: [root],
        openPath: async (resolvedPath) => {
          opened.push(resolvedPath);
          return '';
        },
      });

      expect(result).toEqual({ success: true });
      expect(rejected).toEqual({ success: false, error: 'App not found' });
      expect(opened).toEqual([appPath]);
      expect(hidden).toEqual([appPath]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it('returns opener errors when app launching fails', async () => {
    const root = makeTempRoot();
    try {
      const appPath = makeApp(root, 'Broken.app', '<plist version="1.0"><dict></dict></plist>');

      const result = await launchLauncherApp(appPath, {
        roots: [root],
        openPath: async () => 'Launch Services refused this app',
      });

      expect(result).toEqual({ success: false, error: 'Launch Services refused this app' });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('includes the normal user and system application roots', () => {
    const roots = getDefaultLauncherAppRoots('/Users/tester');

    expect(roots).toEqual(expect.arrayContaining(['/Applications', '/System/Applications']));
  });
});
