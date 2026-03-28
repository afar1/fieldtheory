import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildCli } from '../src/cli.js';
import { datasetLatestPath, datasetManifestPath, twitterBookmarksCachePath, twitterBookmarksMetaPath } from '../src/paths.js';
import { buildDatasetJobName, buildDatasetJobPrompt } from '../src/jobs.js';

async function runCli(argv: string[], cwd: string): Promise<{ logs: string[]; errors: string[] }> {
  const logs: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  const originalCwd = process.cwd();

  console.log = (...args) => logs.push(args.join(' '));
  console.error = (...args) => errors.push(args.join(' '));
  process.chdir(cwd);

  try {
    await buildCli().exitOverride().parseAsync(['node', 'field', ...argv]);
    return { logs, errors };
  } catch (error: any) {
    if (error?.code === 'commander.executeSubCommandAsync') throw error;
    if (error?.code === 'commander.helpDisplayed') return { logs, errors };
    throw error;
  } finally {
    process.chdir(originalCwd);
    console.log = originalLog;
    console.error = originalError;
  }
}

test('dataset add-repo creates manifest and state structure', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'field-cli-'));
  const { logs } = await runCli(['dataset', 'add-repo', '--id', 'demo', '--path', '/tmp/demo', '--git-notes'], cwd);

  assert.match(logs[0] ?? '', /Created .*demo\.yaml/);

  const manifest = await readFile(datasetManifestPath('demo', cwd), 'utf8');
  assert.match(manifest, /kind: repo/);
  assert.match(manifest, /gitNotes: true/);

  const latest = await readFile(datasetLatestPath('demo', cwd), 'utf8');
  assert.match(latest, /No runs yet/);
});

test('dataset list shows created datasets', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'field-cli-'));
  await runCli(['dataset', 'add-files', '--id', 'notes', '--path', '/tmp/notes'], cwd);
  const { logs } = await runCli(['dataset', 'list'], cwd);
  assert.deepEqual(logs, ['notes']);
});

test('dataset show prints manifest path and parsed summary', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'field-cli-'));
  await runCli(['dataset', 'add-bookmarks', '--id', 'x-bookmarks', '--twitter'], cwd);
  const { logs } = await runCli(['dataset', 'show', '--id', 'x-bookmarks'], cwd);

  assert.match(logs[0] ?? '', /automation\/datasets\/x-bookmarks\.yaml$/);
  assert.match(logs[1] ?? '', /"kind": "bookmarks"/);
  assert.match(logs[1] ?? '', /Review the full bookmark corpus/);
});

test('artifacts latest prints expected latest path', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'field-cli-'));
  await runCli(['dataset', 'add-files', '--id', 'notes', '--path', '/tmp/notes'], cwd);
  const { logs } = await runCli(['artifacts', 'latest', '--id', 'notes'], cwd);
  assert.match(logs[0] ?? '', /automation\/dataset-state\/notes\/latest\.md$/);
});

test('job prompt includes dataset-specific state and worthwhile-only instructions', () => {
  const prompt = buildDatasetJobPrompt('density-atlas');
  assert.match(prompt, /automation\/datasets\/density-atlas\.yaml/);
  assert.match(prompt, /automation\/dataset-state\/density-atlas\//);
  assert.match(prompt, /Only surface something if it is genuinely worth the user’s attention/);
});

test('job name maps cleanly from dataset id', () => {
  assert.equal(buildDatasetJobName('density-atlas'), 'field:density-atlas');
});

test('bookmarks full sync creates cache and meta files', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'field-cli-'));
  const { logs } = await runCli(['bookmarks', 'sync', '--full'], cwd);

  assert.match(logs[0] ?? '', /Synced 2 bookmarks/);

  const cache = await readFile(twitterBookmarksCachePath(cwd), 'utf8');
  assert.match(cache, /bookmark_demo_1/);

  const meta = await readFile(twitterBookmarksMetaPath(cwd), 'utf8');
  assert.match(meta, /"totalBookmarks": 2/);
});

test('bookmarks status reports cache metadata', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'field-cli-'));
  await runCli(['bookmarks', 'sync', '--full'], cwd);
  const { logs } = await runCli(['bookmarks', 'status'], cwd);
  assert.match(logs[0] ?? '', /"provider": "twitter"/);
  assert.match(logs[0] ?? '', /"totalBookmarks": 2/);
});
