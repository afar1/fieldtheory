const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeUpdatePermissions } = require('./normalize-update-permissions.cjs');
test('makes copied resources writable, preserves executable bits and does not follow symlinks', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-permissions-'));
  const bundle = path.join(tmp, 'Field Theory.app');
  fs.mkdirSync(bundle);
  const license = path.join(bundle, 'FluidAudio-LICENSE.txt');
  const executable = path.join(bundle, 'helper');
  const outside = path.join(tmp, 'source-license');
  fs.writeFileSync(license, 'license', { mode: 0o444 });
  fs.writeFileSync(executable, 'executable', { mode: 0o555 });
  fs.writeFileSync(outside, 'source', { mode: 0o444 });
  fs.symlinkSync(outside, path.join(bundle, 'external-link'));
  fs.chmodSync(bundle, 0o555);
  try {
    assert.equal(normalizeUpdatePermissions(bundle), 3);
    assert.equal(fs.statSync(license).mode & 0o777, 0o644);
    assert.equal(fs.statSync(executable).mode & 0o777, 0o755);
    assert.equal(fs.statSync(bundle).mode & 0o777, 0o755);
    assert.equal(fs.statSync(outside).mode & 0o777, 0o444);
    assert.equal(fs.readFileSync(license, 'utf8'), 'license');
    assert.equal(normalizeUpdatePermissions(bundle), 0);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
