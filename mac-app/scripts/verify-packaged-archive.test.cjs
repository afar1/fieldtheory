const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const asar = require('@electron/asar');
const { verifyPackagedArchive, verifyPackagedNativePayload } = require('./verify-packaged-archive.cjs');

async function fixture(t, entries = {}, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ft-archive-test-'));
  t.after(() => { asar.uncacheAll(); fs.rmSync(root, { recursive: true, force: true }); });
  const source = path.join(root, 'source');
  const archive = path.join(root, 'app.asar');
  const files = {
    'package.json': JSON.stringify({ main: 'electron-dist/main/index.js' }),
    'electron-dist/main/index.js': '"use strict"; globalThis.__archiveModuleExecuted = true;',
    'electron-dist/preload.js': '"use strict"; exports.ready = true;',
    ...entries,
  };
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(source, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  await asar.createPackageWithOptions(source, archive, options);
  return archive;
}

test('checks the packaged scripts and hashes without executing application code', async t => {
  const archive = await fixture(t);
  assert.deepEqual(verifyPackagedArchive(archive), { files: 3, scripts: 2 });
  assert.equal(globalThis.__archiveModuleExecuted, undefined);
});

test('rejects syntactically invalid JavaScript even when file hashes match', async t => {
  const archive = await fixture(t, { 'electron-dist/main/index.js': 'use strict";' });
  assert.throws(() => verifyPackagedArchive(archive), /Unexpected identifier 'strict'/);
});

test('rejects the one-byte archive shift from a file changing while being packaged', async t => {
  const archive = await fixture(t, { 'first.txt': 'some changing content' });
  const { headerSize } = asar.getRawHeader(archive);
  const entry = asar.statFile(archive, 'first.txt');
  const position = 8 + headerSize + Number(entry.offset);
  const original = fs.readFileSync(archive);
  fs.writeFileSync(archive, Buffer.concat([original.subarray(0, position), original.subarray(position + 1)]));
  assert.throws(() => verifyPackagedArchive(archive), /SHA256 mismatch/);
});

test('rejects development caches even if their archived hashes are valid', async t => {
  const archive = await fixture(t, { 'node_modules/.vite/vitest/results.json': '{}' });
  assert.throws(() => verifyPackagedArchive(archive), /build\/test cache must not be packaged/);
});

test('also verifies unpacked runtime dependencies', async t => {
  const archive = await fixture(t, { 'worker/payload.bin': 'original' }, { unpack: '*.bin' });
  verifyPackagedArchive(archive);
  fs.writeFileSync(path.join(`${archive}.unpacked`, 'worker/payload.bin'), 'modified');
  assert.throws(() => verifyPackagedArchive(archive), /SHA256 mismatch/);
});

test('both release channels require archive verification and cache exclusions', () => {
  for (const file of ['package.json', 'electron-builder.experimental.json']) {
    const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
    const config = data.build ?? data;
    assert.equal(config.afterPack, 'scripts/verify-packaged-archive.cjs');
    for (const cache of ['.vite', '.vitest', '.cache']) assert.ok(config.files.includes(`!**/node_modules/${cache}{,/**/*}`));
  }
});

const nativeFiles = {
  'node_modules/better-sqlite3/build/Release/better_sqlite3.node': 'sqlite fixture',
  'node_modules/node-pty/prebuilds/darwin-arm64/pty.node': 'pty fixture',
  'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper': 'helper fixture',
};
const nativeTarget = { platform: 'darwin', arch: 'arm64' };
const unpackNative = { unpack: '{*.node,spawn-helper}' };

test('rejects the delivered defect even though archive hashes and scripts pass', async t => {
  const archive = await fixture(t);
  verifyPackagedArchive(archive);
  assert.throws(() => verifyPackagedNativePayload(archive, nativeTarget), /native dependency missing: better-sqlite3/);
});

test('accepts unpacked native payloads for the target architecture and executable helper', async t => {
  const archive = await fixture(t, nativeFiles, unpackNative);
  fs.chmodSync(path.join(`${archive}.unpacked`, 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper'), 0o755);
  assert.equal(verifyPackagedNativePayload(archive, nativeTarget).files.length, 3);
});

test('rejects native binaries embedded inside the archive', async t => {
  const archive = await fixture(t, nativeFiles);
  assert.throws(() => verifyPackagedNativePayload(archive, nativeTarget), /must be unpacked/);
});

test('rejects missing or nonexecutable terminal spawn helper', async t => {
  const archive = await fixture(t, nativeFiles, unpackNative);
  const helper = path.join(`${archive}.unpacked`, 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper');
  fs.chmodSync(helper, 0o644);
  assert.throws(() => verifyPackagedNativePayload(archive, nativeTarget), /EACCES/);
  fs.rmSync(helper);
  assert.throws(() => verifyPackagedNativePayload(archive, nativeTarget), /ENOENT/);
});

test('rejects another architecture prebuild and empty SQLite payloads', async t => {
  const archive = await fixture(t, nativeFiles, unpackNative);
  assert.throws(() => verifyPackagedNativePayload(archive, { platform: 'darwin', arch: 'x64' }), /native dependency missing: node-pty/);
  fs.writeFileSync(path.join(`${archive}.unpacked`, 'node_modules/better-sqlite3/build/Release/better_sqlite3.node'), '');
  assert.throws(() => verifyPackagedNativePayload(archive, nativeTarget), /Native dependency is empty/);
});
