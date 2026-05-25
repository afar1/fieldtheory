import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
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
});
