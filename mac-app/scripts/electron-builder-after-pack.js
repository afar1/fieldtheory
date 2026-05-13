const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const productFilename = context.packager.appInfo.productFilename;
  const appPath = path.join(context.appOutDir, `${productFilename}.app`);
  const macOSDir = path.join(appPath, 'Contents', 'MacOS');
  const infoPlist = path.join(appPath, 'Contents', 'Info.plist');
  const launcherSource = path.join(context.packager.projectDir, 'electron', 'native', 'build', 'FieldTheoryLauncher');
  const launcherTarget = path.join(macOSDir, productFilename);
  const electronTarget = path.join(macOSDir, `${productFilename} Electron`);

  if (!fs.existsSync(launcherSource)) {
    throw new Error(`Native launcher missing at ${launcherSource}. Run npm run build:native before packaging.`);
  }

  if (!fs.existsSync(electronTarget)) {
    if (!fs.existsSync(launcherTarget)) {
      throw new Error(`Electron executable missing at ${launcherTarget}`);
    }
    fs.renameSync(launcherTarget, electronTarget);
  }

  fs.copyFileSync(launcherSource, launcherTarget);
  fs.chmodSync(launcherTarget, 0o755);

  const plistResult = spawnSync('/usr/libexec/PlistBuddy', [
    '-c',
    `Set :CFBundleExecutable ${productFilename}`,
    infoPlist,
  ], { stdio: 'inherit' });

  if (plistResult.error) throw plistResult.error;
  if (plistResult.status !== 0) {
    throw new Error(`Failed to update CFBundleExecutable in ${infoPlist}`);
  }

  console.log(`Installed native launcher ${launcherTarget}; Electron executable moved to ${electronTarget}`);
};
