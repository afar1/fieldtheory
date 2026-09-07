#!/usr/bin/env node
// Developer-side preparation. Runtime verification runs only inside Electron.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(toolDir, '../..');
const appDir = path.join(repo, 'mac-app');
const args = process.argv.slice(2);
assert(args.length === 2 && args[0] === '--packaged-app' && path.isAbsolute(args[1]),
  'Usage: node tools/voice-package-verification/run.mjs --packaged-app /absolute/path/to/notarized/Field-Theory.app');
const packagedApp = fs.realpathSync(args[1]);
assert(packagedApp.endsWith('.app') && !packagedApp.split(path.sep).includes('node_modules'),
  'Select an explicitly approved notarized Field Theory app; developer Electron runtimes are prohibited.');
const appArchive = path.join(packagedApp, 'Contents/Resources/app.asar');
assert(fs.existsSync(appArchive), 'The selected app has no packaged app.asar.');
function verifiedCommand(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0,
    `Packaged app verification failed; do not launch or bypass macOS security. ${result.stderr || result.stdout || result.error?.message || result.signal}`);
  return { command, args: commandArgs, stdout: result.stdout, stderr: result.stderr };
}
const plist = path.join(packagedApp, 'Contents/Info.plist');
const bundleId = verifiedCommand('/usr/libexec/PlistBuddy', ['-c', 'Print:CFBundleIdentifier', plist]).stdout.trim();
assert(['com.fieldtheory.app', 'com.fieldtheory.experimental'].includes(bundleId), 'The selected app is not a packaged Field Theory app.');
const executableName = verifiedCommand('/usr/libexec/PlistBuddy', ['-c', 'Print:CFBundleExecutable', plist]).stdout.trim();
assert(executableName && executableName === path.basename(executableName), 'Invalid packaged executable name.');
const electron = fs.realpathSync(path.join(packagedApp, 'Contents/MacOS', executableName));
assert(electron.startsWith(`${packagedApp}/Contents/MacOS/`), 'Packaged executable resolves outside the verified app.');
const appVerification = [
  verifiedCommand('/usr/bin/codesign', ['--verify', '--deep', '--strict', packagedApp]),
  verifiedCommand('/usr/bin/xcrun', ['stapler', 'validate', packagedApp]),
  verifiedCommand('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', packagedApp]),
];
assert(/source=Notarized Developer ID/.test(appVerification[2].stderr + appVerification[2].stdout),
  'Gatekeeper did not identify the selected app as notarized. Stop; do not bypass security.');
const appRequire = createRequire(path.join(appDir, 'package.json'));
const ts = appRequire('typescript');
const asar = appRequire('@electron/asar');
const runDir = path.join(toolDir, 'output', new Date().toISOString().replace(/[:.]/g, '-'));
const staging = path.join(runDir, 'staging');
fs.mkdirSync(staging, { recursive: true });
fs.mkdirSync(path.join(runDir, 'empty-path'));
fs.mkdirSync(path.join(runDir, 'tmp'));
const sources = ['main/voiceWorkManager.ts', 'main/voiceCodexRunner.ts', 'shared/voiceWork.ts'];
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceHashes = Object.fromEntries(sources.map(file => [file, hash(path.join(appDir, 'electron', file))]));
const configPath = path.join(appDir, 'tsconfig.electron.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
assert(!config.error, 'Cannot read Electron TypeScript configuration.');
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, appDir);
const program = ts.createProgram(sources.map(file => path.join(appDir, 'electron', file)), {
  ...parsed.options, outDir: path.join(staging, 'electron-dist'), noEmit: false,
});
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCurrentDirectory: () => repo, getCanonicalFileName: file => file, getNewLine: () => '\n',
}));
assert(!program.emit().emitSkipped, 'Voice module compilation was skipped.');
for (const file of sources) assert.equal(hash(path.join(appDir, 'electron', file)), sourceHashes[file], 'Source changed during compilation; rerun after coordination.');
const compiled = sources.map(file => `electron-dist/${file.replace(/\.ts$/, '.js')}`);
const compiledHashes = Object.fromEntries(compiled.map(file => [file, hash(path.join(staging, file))]));
fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify({
  name: 'field-theory-voice-verification-fixture', private: true, version: '0.0.0',
  description: 'Verification-only ASAR containing compiled production Voice modules; not a Field Theory app distribution.',
}));
const archive = path.join(runDir, 'voice-worker-fixture.asar');
await asar.createPackage(staging, archive);
for (const [file, expected] of Object.entries(compiledHashes)) {
  assert.equal(createHash('sha256').update(asar.extractFile(archive, file)).digest('hex'), expected);
}
const git = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' }).stdout.trim();
const provenance = {
  kind: 'compiled-production-voice-modules-in-fixture-asar', fullAppPackage: false,
  createdAt: new Date().toISOString(), revision: git(['rev-parse', 'HEAD']),
  branch: git(['branch', '--show-current']), sourceHashes, compiledHashes,
  archive, archiveSha256: hash(archive), electronExecutable: electron,
  packagedApp, bundleId, packagedAppArchiveSha256: hash(appArchive), appVerification,
  scope: 'Fixture Supabase and scripted Codex JSON-RPC; no account, model, full app, or native helper verification.',
};
fs.writeFileSync(path.join(runDir, 'provenance.json'), JSON.stringify(provenance, null, 2));
const result = spawnSync(electron, [path.join(toolDir, 'verify.cjs'), archive, runDir], {
  cwd: runDir, encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
  env: {
    PATH: path.join(runDir, 'empty-path'), ELECTRON_RUN_AS_NODE: '1',
    TMPDIR: path.join(runDir, 'tmp'), LANG: 'en_US.UTF-8',
  },
});
fs.writeFileSync(path.join(runDir, 'runtime.stdout.log'), result.stdout ?? '');
fs.writeFileSync(path.join(runDir, 'runtime.stderr.log'), result.stderr ?? '');
fs.writeFileSync(path.join(runDir, 'runtime-exit.json'), JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.message }, null, 2));
if (result.status !== 0) throw new Error(`Electron verification failed: status=${result.status}, signal=${result.signal}, error=${result.error?.message ?? 'none'}\n${result.stderr || result.stdout}\nArtifacts: ${runDir}`);
process.stdout.write(result.stdout);
console.log(`Evidence: ${runDir}`);
