const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { restrictModuleResolution } = require('./native-runtime-probe.cjs');

function fixture(t, entries) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-native-boundary-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'app.asar'));
  for (const [name, value] of Object.entries(entries)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  }
  return root;
}

test('rejects transitive dependency fallback into surrounding node_modules before executing it', t => {
  const root = fixture(t, {
    'app.asar/node_modules/sqlite-fixture/index.js': 'module.exports = require("outside-native-helper");',
    'node_modules/outside-native-helper/index.js': 'globalThis.__outsideNativeHelperRan = true;',
  });
  const restore = restrictModuleResolution(path.join(root, 'app.asar'));
  try {
    assert.throws(() => require(path.join(root, 'app.asar/node_modules/sqlite-fixture')), /outside the packaged app/);
    assert.equal(globalThis.__outsideNativeHelperRan, undefined);
  } finally { restore(); }
});

test('allows builtins and packaged or unpacked dependencies', t => {
  const root = fixture(t, {
    'app.asar/node_modules/fixture/index.js': 'module.exports = require("node:path").basename("/packaged/result");',
    'app.asar.unpacked/node_modules/fixture/index.js': 'module.exports = 42;',
  });
  const restore = restrictModuleResolution(path.join(root, 'app.asar'));
  try {
    assert.equal(require(path.join(root, 'app.asar/node_modules/fixture')), 'result');
    assert.equal(require(path.join(root, 'app.asar.unpacked/node_modules/fixture')), 42);
  } finally { restore(); }
});

test('rejects a sibling path that merely shares the archive name prefix', t => {
  const root = fixture(t, { 'app.asar-wrong/module.js': 'module.exports = 42;' });
  const restore = restrictModuleResolution(path.join(root, 'app.asar'));
  try { assert.throws(() => require(path.join(root, 'app.asar-wrong/module.js')), /outside the packaged app/); }
  finally { restore(); }
});
