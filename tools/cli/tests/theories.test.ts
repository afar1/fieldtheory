import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  backfillTheoryRepoMetadataInPlace,
  formatTheoryId,
  getTheoryItem,
  listTheoryItems,
  loadTheoryState,
  normalizeTheoryId,
  parseTheoryEmailMarkdownForTest,
} from '../src/theories.js';
import { openDb, saveDb } from '../src/db.js';
import { theoryIndexPath } from '../src/paths.js';

async function makeGitRepo(root: string, name: string, remote: string): Promise<string> {
  const repoPath = path.join(root, name);
  await mkdir(repoPath, { recursive: true });
  execSync('git init', { cwd: repoPath, stdio: 'ignore' });
  execSync(`git remote add origin ${remote}`, { cwd: repoPath, stdio: 'ignore' });
  return repoPath;
}

async function makeTheoryFixture(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'ft-theories-'));
  const digestsDir = path.join(root, 'digests');
  const transcriptsDir = path.join(root, 'transcripts');
  await mkdir(digestsDir, { recursive: true });
  await mkdir(transcriptsDir, { recursive: true });
  const repoPath = await makeGitRepo(root, 'money', 'https://github.com/example/money.git');

  const transcriptPath = path.join(transcriptsDir, '2026-03-30_211305_explore.md');
  await writeFile(
    transcriptPath,
    `# Open exploration — money
**Date**: March 30, 2026
**Type**: explore
**Repo**: money (${repoPath})
**Bookmarks**: https://x.com/example/status/1
https://x.com/example/status/2

---

## Turn 1

Context here.
`,
    'utf8'
  );

  await writeFile(
    path.join(digestsDir, '2026-03-30-theories.md'),
    `# Theories — 2026-03-30

---

## 🚪 Open exploration — money

### FT-1 — $30

**First finding title**

BOOKMARKS: @levelsio

WHAT WE FOUND: First finding details.

WHAT TO DO: First next step.

CONFIDENCE: High

---

### FT-2 — $10

**Second finding title**

BOOKMARKS: @rowancheung

WHAT WE FOUND: Second finding details.

WHAT TO DO: Second next step.

CONFIDENCE: Medium

*Full session: ${transcriptPath}*
`,
    'utf8'
  );

  await writeFile(
    path.join(digestsDir, '2026-03-29-theories.md'),
    `# Theories — 2026-03-29

---

## 🔒 Security & dependency scan — fieldtheory

---

**Legacy finding title**

BOOKMARKS: None

WHAT WE FOUND: Legacy finding details.

WHAT TO DO: Legacy next step.

CONFIDENCE: High

*Full session: ${transcriptPath}*
`,
    'utf8'
  );

  await writeFile(path.join(root, 'state.json'), JSON.stringify({ next_id: 3 }, null, 2), 'utf8');
  return root;
}

test('normalizes and formats FT ids', () => {
  assert.equal(normalizeTheoryId('FT-001'), 'FT-1');
  assert.equal(normalizeTheoryId('001'), 'FT-1');
  assert.equal(formatTheoryId('FT-1'), 'FT-001');
  assert.equal(formatTheoryId(12), 'FT-012');
});

test('lists theory items from digests and transcript metadata', async () => {
  const root = await makeTheoryFixture();
  const items = await listTheoryItems({}, root);

  assert.equal(items.length, 3);
  assert.equal(items[0]?.id, 'FT-2');
  assert.equal(items[0]?.displayId, 'FT-002');
  assert.equal(items[0]?.transcriptMeta.repoName, 'money');
  assert.equal(items[0]?.transcriptMeta.repoPath, path.join(root, 'money'));
  assert.equal(items[0]?.transcriptMeta.githubRepo, 'example/money');
  assert.deepEqual(items[0]?.transcriptMeta.bookmarkUrls, [
    'https://x.com/example/status/1',
    'https://x.com/example/status/2',
  ]);
  assert.equal(items[2]?.kind, 'legacy');
  assert.equal(items[2]?.displayId, 'L-01');

  const filtered = await listTheoryItems({ confidence: 'Medium' }, root);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, 'FT-2');
});

test('finds a theory item by normalized id and loads next-id state', async () => {
  const root = await makeTheoryFixture();
  const item = await getTheoryItem('FT-002', root);
  const state = await loadTheoryState(root);

  assert.equal(item?.id, 'FT-2');
  assert.equal(item?.title, 'Second finding title');
  assert.equal(state.next_id, 3);
});

test('finds legacy theory items by their explicit id', async () => {
  const root = await makeTheoryFixture();
  const item = await getTheoryItem('LEGACY-20260329-01', root);

  assert.equal(item?.kind, 'legacy');
  assert.equal(item?.title, 'Legacy finding title');
});

test('parses emailed FT findings and infers repo path from markdown file links', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'ft-theory-email-'));
  const repoRoot = path.join(sandbox, 'routines');
  const filePath = path.join(repoRoot, 'apps', 'api', 'route.ts');
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, 'export const ok = true;\n', 'utf8');
  execSync('git init', { cwd: repoRoot, stdio: 'ignore' });
  execSync('git remote add origin https://github.com/example/routines.git', { cwd: repoRoot, stdio: 'ignore' });

  const items = await parseTheoryEmailMarkdownForTest(
    `# Theories — 2026-03-31

---

## 🔒 Security & dependency scan — routines

---

### FT-42 — $15

**Replay attacks are still possible**

BOOKMARKS: @packet_storm

WHAT WE FOUND: The bug is in [\`apps/api/route.ts:1\`](${filePath}#L1).

WHAT TO DO: Add freshness checks.

CONFIDENCE: High
`,
    {
      messageId: 'message-42',
      subject: 'Theories (routines) — Replay attacks are still possible',
      createdAt: '2026-03-31T12:00:00Z',
    },
    path.join(sandbox, 'source.md'),
  );

  assert.equal(items.length, 1);
  assert.equal(items[0]?.id, 'FT-42');
  assert.equal(items[0]?.displayId, 'FT-042');
  assert.equal(items[0]?.transcriptMeta.repoName, 'routines');
  assert.equal(items[0]?.transcriptMeta.repoPath, repoRoot);
  assert.equal(items[0]?.transcriptMeta.githubRepo, 'example/routines');
  assert.equal(items[0]?.sourceMessageId, 'message-42');
});

test('backfills theory repo metadata in place without rebuilding the cache', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'ft-theory-cache-upgrade-'));
  const repoPath = await makeGitRepo(cwd, 'routines', 'https://github.com/example/routines.git');
  const dbPath = theoryIndexPath(cwd);
  const db = await openDb(dbPath);

  try {
    db.run(`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)`);
    db.run(`CREATE TABLE theories (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      numeric_id INTEGER NOT NULL,
      display_id TEXT NOT NULL,
      date TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      title TEXT NOT NULL,
      value_dollars INTEGER,
      section_title TEXT,
      bookmarks_label TEXT,
      what_we_found TEXT NOT NULL,
      what_to_do TEXT NOT NULL,
      confidence TEXT,
      digest_path TEXT NOT NULL,
      transcript_path TEXT,
      transcript_type TEXT,
      transcript_repo_name TEXT,
      transcript_repo_path TEXT,
      bookmark_urls_json TEXT,
      sort_order INTEGER NOT NULL,
      model_signature TEXT,
      source_message_id TEXT,
      source_subject TEXT,
      source_created_at TEXT
    )`);
    db.run(`INSERT INTO meta(key, value) VALUES (?, ?)`, ['schema_version', '2']);
    db.run(`INSERT INTO meta(key, value) VALUES (?, ?)`, ['latest_source_message_id', 'message-99']);
    db.run(
      `INSERT INTO theories VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        'FT-99',
        'ft',
        99,
        'FT-099',
        '2026-03-31',
        Date.parse('2026-03-31T12:00:00Z'),
        'Repo metadata was not stored',
        10,
        'Security & dependency scan — routines',
        '@packet_storm',
        'The finding references the routines repo.',
        'Store the repo metadata locally.',
        'High',
        '/tmp/source.md',
        null,
        'Security & dependency scan',
        'routines',
        repoPath,
        JSON.stringify(['https://x.com/packet_storm/status/1']),
        99,
        null,
        'message-99',
        'Theories (routines) — Repo metadata was not stored',
        '2026-03-31T12:00:00Z',
      ],
    );
    saveDb(db, dbPath);
  } finally {
    db.close();
  }

  const updated = await backfillTheoryRepoMetadataInPlace(cwd);
  const upgradedDb = await openDb(dbPath);
  try {
    const count = Number(upgradedDb.exec(`SELECT COUNT(*) FROM theories`)[0]?.values?.[0]?.[0] ?? 0);
    const row = upgradedDb.exec(
      `SELECT transcript_repo_path, transcript_repo_github FROM theories WHERE id = ?`,
      ['FT-99'],
    )[0]?.values?.[0];
    const schemaVersion = String(upgradedDb.exec(`SELECT value FROM meta WHERE key = 'schema_version'`)[0]?.values?.[0]?.[0] ?? '');
    const latestSourceMessageId = String(upgradedDb.exec(`SELECT value FROM meta WHERE key = 'latest_source_message_id'`)[0]?.values?.[0]?.[0] ?? '');

    assert.equal(updated, 1);
    assert.equal(count, 1);
    assert.equal(row?.[0], repoPath);
    assert.equal(row?.[1], 'example/routines');
    assert.equal(schemaVersion, '3');
    assert.equal(latestSourceMessageId, 'message-99');
  } finally {
    upgradedDb.close();
  }
});
