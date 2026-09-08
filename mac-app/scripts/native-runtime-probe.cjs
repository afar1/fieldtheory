const path = require('node:path');
const os = require('node:os');

// Run by the packaged Electron executable in Node mode; never load the app entrypoint.
async function probe(archivePath) {
  if (!process.versions.electron) throw new Error('Native verification requires the packaged Electron runtime.');
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

probe(path.resolve(process.argv[2])).then(
  result => { process.stdout.write(`${JSON.stringify(result)}\n`); },
  error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; },
);
