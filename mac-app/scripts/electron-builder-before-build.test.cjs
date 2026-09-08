const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function hookFixture(t, exitCode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-builder-hook-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scripts = path.join(root, 'scripts');
  fs.mkdirSync(scripts);
  const hookPath = path.join(scripts, 'electron-builder-before-build.js');
  fs.copyFileSync(path.join(__dirname, 'electron-builder-before-build.js'), hookPath);
  fs.writeFileSync(path.join(scripts, 'check-untracked-source.sh'), `exit ${exitCode}\n`);
  return require(hookPath).default;
}

test('explicitly allows electron-builder to rebuild native dependencies after source guard passes', async t => {
  assert.equal(await hookFixture(t, 0)(), true);
});

test('rejects packaging before dependency rebuild when source guard fails', async t => {
  await assert.rejects(hookFixture(t, 1)(), /untracked source files/);
});
