const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Script } = require('node:vm');
const asar = require('@electron/asar');
const { normalizeUpdatePermissions } = require('./normalize-update-permissions.cjs');

// Inspect the packaged bytes, never require or execute the application's modules.
function verifyPackagedArchive(archivePath) {
  asar.uncache(archivePath);
  const { header } = asar.getRawHeader(archivePath);
  let files = 0;
  let scripts = 0;
  const failures = [];
  const visit = (directory, prefix = '') => {
    for (const [name, entry] of Object.entries(directory.files ?? {})) {
      const file = `${prefix}${name}`;
      if (/(^|\/)(\.vite|\.vitest|\.cache)(\/|$)/.test(file)) {
        failures.push(`${file}: build/test cache must not be packaged`);
        continue;
      }
      if (entry.files) { visit(entry, `${file}/`); continue; }
      if (entry.link) continue; // The linked target is verified at its own archive path.
      files += 1;
      try {
        const bytes = asar.extractFile(archivePath, file);
        if (bytes.length !== entry.size) throw new Error('file size mismatch');
        if (entry.integrity?.algorithm !== 'SHA256' || !entry.integrity.hash) throw new Error('missing SHA256 integrity metadata');
        const hash = createHash('sha256').update(bytes).digest('hex');
        if (hash !== entry.integrity.hash) throw new Error('SHA256 mismatch (archive offsets or content changed during packaging)');
        if (file.startsWith('electron-dist/') && file.endsWith('.js')) {
          new Script(bytes.toString('utf8'), { filename: file });
          scripts += 1;
        }
      } catch (error) {
        failures.push(`${file}: ${error.message}`);
      }
    }
  };
  visit(header);
  try {
    const metadata = JSON.parse(asar.extractFile(archivePath, 'package.json').toString('utf8'));
    if (metadata.main !== 'electron-dist/main/index.js') throw new Error('unexpected main entrypoint');
    asar.statFile(archivePath, metadata.main);
    if (!scripts) throw new Error('no Electron scripts were checked');
    if (metadata.fieldTheoryBuildChannel === 'production') {
      const auth = JSON.parse(asar.extractFile(archivePath, 'electron-dist/main/public-runtime-config.json').toString('utf8'));
      if (typeof auth.supabaseUrl !== 'string' || !auth.supabaseUrl.startsWith('https://')
        || typeof auth.supabasePublishableKey !== 'string' || !auth.supabasePublishableKey.trim()) {
        throw new Error('production package is missing public account configuration; regenerate public-runtime-config.json after building Electron');
      }
    }
  } catch (error) { failures.push(`entrypoint: ${error.message}`); }
  if (failures.length) throw new Error(`Packaged archive verification failed (${failures.length} failures):\n${failures.slice(0, 8).join('\n')}`);
  return { files, scripts };
}

exports.verifyPackagedArchive = verifyPackagedArchive;

function verifyPackagedNativePayload(archivePath, { platform = process.platform, arch = process.arch } = {}) {
  const requireUnpacked = (name, candidates, executable = false) => {
    const file = candidates.find(candidate => {
      try { return !asar.statFile(archivePath, candidate).files; } catch { return false; }
    });
    if (!file) throw new Error(`Packaged native dependency missing: ${name} (${platform}-${arch})`);
    if (!asar.statFile(archivePath, file).unpacked) throw new Error(`Native dependency must be unpacked: ${file}`);
    const installedPath = path.join(`${archivePath}.unpacked`, file);
    if (!fs.statSync(installedPath).isFile() || fs.statSync(installedPath).size === 0) throw new Error(`Native dependency is empty: ${file}`);
    if (executable) fs.accessSync(installedPath, fs.constants.X_OK);
    return file;
  };
  const sqlite = requireUnpacked('better-sqlite3', [
    'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  ]);
  const pty = requireUnpacked('node-pty', [
    'node_modules/node-pty/build/Release/pty.node',
    `node_modules/node-pty/prebuilds/${platform}-${arch}/pty.node`,
  ]);
  const files = [sqlite, pty];
  if (platform !== 'win32') files.push(requireUnpacked('node-pty spawn helper', [
    path.posix.join(path.posix.dirname(pty), 'spawn-helper'),
  ], true));
  return { platform, arch, files };
}

exports.verifyPackagedNativePayload = verifyPackagedNativePayload;
exports.default = async function afterPack(context) {
  const resources = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  if (context.electronPlatformName === 'darwin') {
    const changed = normalizeUpdatePermissions(path.resolve(resources, '..', '..'));
    console.log(`Prepared ${changed} bundle entries for updater quarantine handling before signing`);
  }
  const result = verifyPackagedArchive(path.join(resources, 'app.asar'));
  const native = verifyPackagedNativePayload(path.join(resources, 'app.asar'), {
    platform: context.electronPlatformName,
    arch: require('builder-util').Arch[context.arch],
  });
  console.log(`Packaged archive verified before signing: ${result.files} file hashes, ${result.scripts} JavaScript syntax checks`);
  console.log(`Packaged native payload verified: ${native.files.length} files for ${native.platform}-${native.arch}`);
};

if (require.main === module) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/verify-packaged-archive.cjs /path/to/app.asar');
  const archivePath = path.resolve(process.argv[2]);
  console.log(JSON.stringify({ ...verifyPackagedArchive(archivePath), native: verifyPackagedNativePayload(archivePath) }));
}
