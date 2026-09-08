const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const fs = require('node:fs');

function restrictModuleResolution(archivePath) {
  const canonical = fs.realpathSync(archivePath);
  const roots = [canonical, `${canonical}.unpacked`];
  const builtins = new Set(Module.builtinModules.map(name => name.replace(/^node:/, '')));
  const original = Module._resolveFilename;
  Module._resolveFilename = function (...args) {
    const resolved = original.apply(this, args);
    if (!builtins.has(resolved.replace(/^node:/, '')) && !roots.some(root => {
      const relative = path.relative(root, resolved);
      return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    })) throw new Error(`Native verification resolved outside the packaged app: ${resolved}`);
    return resolved;
  };
  return () => { Module._resolveFilename = original; };
}

// Run by the packaged Electron executable in Node mode; never load the app entrypoint.
async function probe(archivePath) {
  if (!process.versions.electron) throw new Error('Native verification requires the packaged Electron runtime.');
  restrictModuleResolution(archivePath);
  const Database = require(path.join(archivePath, 'node_modules/better-sqlite3'));
  const database = new Database(':memory:');
  try {
    if (database.prepare('select 23 + 19 as answer').get().answer !== 42) throw new Error('Packaged SQLite query failed.');
  } finally { database.close(); }

  const pty = require(path.join(archivePath, 'node_modules/node-pty'));
  await new Promise((resolve, reject) => {
    const child = pty.spawn('/bin/sh', ['-c', 'printf field-theory-native-ok'], {
      cwd: os.tmpdir(), env: { PATH: '/usr/bin:/bin' }, cols: 80, rows: 24,
    });
    let output = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Packaged terminal helper timed out.')); }, 5000);
    child.onData(data => { output = (output + data).slice(-1024); });
    child.onExit(event => {
      clearTimeout(timeout);
      if (event.exitCode !== 0 || output !== 'field-theory-native-ok') reject(new Error('Packaged terminal helper failed.'));
      else resolve();
    });
  });
  return { electron: process.versions.electron, modules: process.versions.modules, arch: process.arch, sqlite: 'passed', terminal: 'passed' };
}

exports.restrictModuleResolution = restrictModuleResolution;
if (require.main === module) {
  probe(path.resolve(process.argv[2])).then(
    result => { process.stdout.write(`${JSON.stringify(result)}\n`); },
    error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; },
  );
}
