const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

function verifyPackagedNativeRuntime(appPath) {
  const name = path.basename(appPath, '.app');
  const executable = path.join(appPath, 'Contents', 'MacOS', name);
  const archive = path.join(appPath, 'Contents', 'Resources', 'app.asar');
  const result = spawnSync(executable, [path.join(__dirname, 'native-runtime-probe.cjs'), archive], {
    env: { ELECTRON_RUN_AS_NODE: '1', PATH: '/usr/bin:/bin', TMPDIR: os.tmpdir() },
    encoding: 'utf8', timeout: 15000, maxBuffer: 64 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Packaged native runtime verification failed: ${result.stderr.trim() || result.signal || result.status}`);
  const receipt = JSON.parse(result.stdout.trim());
  if (!receipt.electron || receipt.sqlite !== 'passed' || receipt.terminal !== 'passed' || receipt.watcher !== 'passed') throw new Error('Packaged native runtime did not report successful checks.');
  return receipt;
}

exports.verifyPackagedNativeRuntime = verifyPackagedNativeRuntime;
if (require.main === module) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/verify-packaged-native-runtime.cjs /path/to/Field Theory.app');
  console.log(JSON.stringify(verifyPackagedNativeRuntime(path.resolve(process.argv[2]))));
}
