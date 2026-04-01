import test from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { TheoryItem } from '../src/theories.js';
import { assessTheoryIssue, refreshTheoryGitHubState, setGitHubCliForTesting } from '../src/github-theory-state.js';
import { createTheoryIssue } from '../src/timeline-actions.js';
import { loadTimelineState } from '../src/timeline-state.js';

function makeTheory(repoPath: string): TheoryItem {
  return {
    id: 'FT-197',
    kind: 'ft',
    numericId: 197,
    displayId: 'FT-197',
    date: '2026-03-31',
    createdAtMs: Date.parse('2026-03-31T12:00:00Z'),
    title: 'The bookmark matcher is weak enough that it can miss relevant tools',
    valueDollars: 22,
    sectionTitle: 'Tool & library adoption — fieldtheory',
    bookmarksLabel: '@jmdagdelen',
    whatWeFound: 'The issue spans multiple files across the repo and touches ranking plus repo metadata extraction.',
    whatToDo: 'First, improve lexical ranking and be careful about any outward-facing contract changes.',
    confidence: 'High',
    digestPath: '/tmp/source.md',
    transcriptPath: null,
    transcriptMeta: {
      type: 'Tool & library adoption',
      repoName: 'fieldtheory',
      repoPath,
      githubRepo: 'example/fieldtheory',
      bookmarkUrls: ['https://x.com/jmdagdelen/status/1647517580645765121'],
    },
    sortOrder: 197,
    modelSignature: null,
    sourceMessageId: 'message-197',
    sourceSubject: 'Theories (fieldtheory) — The bookmark matcher is weak enough',
    sourceCreatedAt: '2026-03-31T12:00:00Z',
  };
}

async function makeGitRepo(root: string, name: string, remote: string): Promise<string> {
  const repoPath = path.join(root, name);
  await mkdir(repoPath, { recursive: true });
  execSync('git init', { cwd: repoPath, stdio: 'ignore' });
  execSync(`git remote add origin ${remote}`, { cwd: repoPath, stdio: 'ignore' });
  return repoPath;
}

async function makeTheoryFixture(root: string, repoPath: string): Promise<string> {
  const theoriesRoot = path.join(root, 'theories-root');
  const digestsDir = path.join(theoriesRoot, 'digests');
  const transcriptsDir = path.join(theoriesRoot, 'transcripts');
  await mkdir(digestsDir, { recursive: true });
  await mkdir(transcriptsDir, { recursive: true });

  const transcriptPath = path.join(transcriptsDir, '2026-03-31_120000_explore.md');
  await writeFile(
    transcriptPath,
    `# Tool & library adoption — fieldtheory
**Date**: March 31, 2026
**Type**: adopt
**Repo**: fieldtheory (${repoPath})
**Bookmarks**: https://x.com/jmdagdelen/status/1647517580645765121

---
`,
    'utf8',
  );

  await writeFile(
    path.join(digestsDir, '2026-03-31-theories.md'),
    `# Theories — 2026-03-31

---

## 🔧 Tool & library adoption — fieldtheory

### FT-197 — $22

**The bookmark matcher is weak enough that it can miss relevant tools**

BOOKMARKS: @jmdagdelen

WHAT WE FOUND: The issue spans multiple files across the repo and touches ranking plus repo metadata extraction.

WHAT TO DO: First, improve lexical ranking and be careful about any outward-facing contract changes.

CONFIDENCE: High

*Full session: ${transcriptPath}*
`,
    'utf8',
  );

  await writeFile(path.join(theoriesRoot, 'state.json'), JSON.stringify({ next_id: 198 }, null, 2), 'utf8');
  return theoriesRoot;
}

test('assessTheoryIssue flags broader and potentially breaking findings', () => {
  const assessment = assessTheoryIssue(makeTheory('/tmp/fieldtheory'));

  assert.equal(assessment.isActuallyIssue, true);
  assert.equal(assessment.isBroaderIssue, true);
  assert.equal(assessment.hasBreakingChangeRisk, true);
  assert.match(assessment.proposedSolution, /improve lexical ranking/i);
});

test('refreshTheoryGitHubState persists issue and merged PR state', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'ft-gh-state-'));
  const repoPath = await makeGitRepo(cwd, 'fieldtheory', 'https://github.com/example/fieldtheory.git');
  const theory = makeTheory(repoPath);

  setGitHubCliForTesting({
    issueList: async () => [
      {
        number: 12,
        title: 'FT-197: The bookmark matcher is weak enough that it can miss relevant tools',
        url: 'https://github.com/example/fieldtheory/issues/12',
        state: 'OPEN',
      },
    ],
    prList: async () => [
      {
        number: 34,
        title: 'FT-197: Improve bookmark ranking',
        url: 'https://github.com/example/fieldtheory/pull/34',
        state: 'CLOSED',
        mergedAt: '2026-03-31T18:00:00Z',
      },
    ],
  });

  try {
    const state = await refreshTheoryGitHubState(theory, { cwd, staleMs: 0 });
    assert.equal(state.issueUrl, 'https://github.com/example/fieldtheory/issues/12');
    assert.equal(state.issueState, 'open');
    assert.equal(state.prUrl, 'https://github.com/example/fieldtheory/pull/34');
    assert.equal(state.prState, 'merged');
    assert.equal(state.mergedAt, '2026-03-31T18:00:00Z');
  } finally {
    setGitHubCliForTesting(null);
  }
});

test('createTheoryIssue returns existing issue instead of creating a duplicate', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'ft-gh-issue-'));
  const repoPath = await makeGitRepo(cwd, 'fieldtheory', 'https://github.com/example/fieldtheory.git');
  const theoriesRoot = await makeTheoryFixture(cwd, repoPath);

  setGitHubCliForTesting({
    issueList: async () => [
      {
        number: 91,
        title: 'FT-197: The bookmark matcher is weak enough that it can miss relevant tools',
        url: 'https://github.com/example/fieldtheory/issues/91',
        state: 'OPEN',
      },
    ],
    prList: async () => [],
  });

  try {
    const result = await createTheoryIssue('FT-197', { cwd, theoriesRootDir: theoriesRoot });
    const state = (await loadTimelineState(cwd)).theories['FT-197'];

    assert.equal(result.alreadyExists, true);
    assert.equal(result.created, false);
    assert.equal(result.url, 'https://github.com/example/fieldtheory/issues/91');
    assert.match(result.body, /## Assessment/);
    assert.equal(state.issueUrl, 'https://github.com/example/fieldtheory/issues/91');
    assert.equal(state.issueSource, 'existing');
  } finally {
    setGitHubCliForTesting(null);
  }
});

test('refreshTheoryGitHubState can use the recorded github repo without a local repo path', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'ft-gh-recorded-repo-'));
  const baseTheory = makeTheory('/tmp/fieldtheory');
  const theory = {
    ...baseTheory,
    transcriptMeta: {
      ...baseTheory.transcriptMeta,
      repoPath: null,
      githubRepo: 'example/fieldtheory',
    },
  };

  let seenRepo: string | null = null;
  setGitHubCliForTesting({
    issueList: async (repo) => {
      seenRepo = repo;
      return [];
    },
    prList: async () => [],
  });

  try {
    await refreshTheoryGitHubState(theory, { cwd, staleMs: 0 });
    assert.equal(seenRepo, 'example/fieldtheory');
  } finally {
    setGitHubCliForTesting(null);
  }
});
