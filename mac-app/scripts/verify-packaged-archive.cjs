const { createHash } = require('node:crypto');
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
  } catch (error) { failures.push(`entrypoint: ${error.message}`); }
  if (failures.length) throw new Error(`Packaged archive verification failed (${failures.length} failures):\n${failures.slice(0, 8).join('\n')}`);
  return { files, scripts };
}

exports.verifyPackagedArchive = verifyPackagedArchive;
exports.default = async function afterPack(context) {
  const resources = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  if (context.electronPlatformName === 'darwin') {
    const changed = normalizeUpdatePermissions(path.resolve(resources, '..', '..'));
    console.log(`Prepared ${changed} bundle entries for updater quarantine handling before signing`);
  }
  const result = verifyPackagedArchive(path.join(resources, 'app.asar'));
  console.log(`Packaged archive verified before signing: ${result.files} file hashes, ${result.scripts} JavaScript syntax checks`);
};

if (require.main === module) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/verify-packaged-archive.cjs /path/to/app.asar');
  console.log(JSON.stringify(verifyPackagedArchive(path.resolve(process.argv[2]))));
}
