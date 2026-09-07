// Exercise the actual vendored worker with fake HTTP and forbid credential subprocesses.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-worker-verify-'));
try {
  const archive = path.resolve(__dirname, '../../vendor/fieldtheory-1.3.23-local.2.tgz');
  assert.equal(spawnSync('/usr/bin/tar', ['-xzf', archive, '-C', root]).status, 0);
  const dependencies = path.resolve(__dirname, '../../node_modules');
  const modules = path.join(root, 'package/node_modules'); fs.mkdirSync(modules);
  for (const name of Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'package/package.json'), 'utf8')).dependencies)) {
    const nested = path.join(dependencies, 'fieldtheory/node_modules', name);
    const destination = path.join(modules, name); fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.symlinkSync(fs.existsSync(nested) ? nested : path.join(dependencies, name), destination);
  }
  const preload = path.join(root, 'guard.mjs');
  fs.writeFileSync(preload, `import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
for (const name of ['execFileSync', 'spawnSync', 'execSync', 'execFile', 'spawn', 'exec']) cp[name] = () => { throw new Error('FORBIDDEN_CREDENTIAL_SUBPROCESS'); };
syncBuiltinESMExports();
globalThis.fetch = async () => new Response('{}', { status: 401 });
`);
  const run = input => spawnSync(process.execPath, ['--import', preload, path.join(root, 'package/bin/ft.mjs'), 'sync', '--quick', '--json', '--credentials-stdin'], {
    input, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, HOME: root, FIELD_THEORY_HOME: root, FT_DATA_DIR: path.join(root, 'data') },
  });
  for (const input of ['', '{}', JSON.stringify({ csrfToken: '', cookieHeader: 'ct0=; auth_token=' }), JSON.stringify({ csrfToken: 'fakecsrf', cookieHeader: 'ct0=fakecsrf; auth_token=fakeauth' })]) {
    const result = run(input);
    assert.ok(!result.error, String(result.error));
    assert.ok(!`${result.stdout}${result.stderr}`.includes('FORBIDDEN_CREDENTIAL_SUBPROCESS'));
    assert.ok(!`${result.stdout}${result.stderr}`.includes('fakeauth'));
    assert.ok(result.stdout, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.ok(['auth_required', 'error'].includes(output.status));
    if (input.includes('fakecsrf')) assert.equal(output.status, 'auth_required');
  }
  console.log('Vendored worker: malformed/missing/expired credentials never fall back to browser extraction; credentials absent output.');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
