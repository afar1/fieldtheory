import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getPossibleIdeaBatch, listPossibleIdeaBatches } from './possibleIdeasManager';

const tempRoots: string[] = [];

function makeHome(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), 'ft-possible-'));
  tempRoots.push(home);
  return home;
}

function writeFile(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
}

function writeDotArtifact(filePath: string, id: string, title: string, axisA: number, axisB: number): void {
  writeFile(filePath, `---
{
  "type": "dot",
  "metadata": {
    "title": "${title}",
    "summary": "Short summary",
    "essay": "Longer proposal",
    "rationale": "Seed rationale",
    "repoSurface": "src/example.ts",
    "effortEstimate": "days",
    "axisAScore": ${axisA},
    "axisAJustification": "Axis A reason",
    "axisBScore": ${axisB},
    "axisBJustification": "Axis B reason",
    "exportablePrompt": "# ${title}\\n\\nDo the work.",
    "implementationPrompt": "Implement ${title}"
  },
  "id": "${id}"
}
---

# ${title}
`);
}

describe('possibleIdeasManager', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('lists idea batches from the canonical Field Theory ideas directory', () => {
    const homeDir = makeHome();
    const batchPath = path.join(homeDir, '.fieldtheory', 'ideas', 'batches', '2026-05-03', 'batch-example.md');
    writeFile(batchPath, `---
type: ideas-batch-summary
id: batch-example
created_at: 2026-05-03T19:21:26.593Z
seed_id: seed-1
seed_artifact_ids: ["bookmark-artifact-1"]
frame_id: novelty-feasibility
frame_name: "Novelty x Feasibility"
depth: standard
model: "claude/opus/effort=medium"
node_target: 3
consideration_ids: ["run-1"]
repos: ["/repo/fieldtheory"]
total_dot_count: 1
---

# Ideas batch
`);

    expect(listPossibleIdeaBatches({ homeDir, env: {} })).toEqual([
      expect.objectContaining({
        id: 'batch-example',
        batchPath,
        seedId: 'seed-1',
        frameName: 'Novelty x Feasibility',
        considerationIds: ['run-1'],
        repos: ['/repo/fieldtheory'],
      }),
    ]);
  });

  it('hydrates all dot artifacts for a batch and ignores non-dot pipeline artifacts', () => {
    const homeDir = makeHome();
    const ideasRoot = path.join(homeDir, '.fieldtheory', 'ideas');

    writeFile(path.join(ideasRoot, 'batches', '2026-05-03', 'batch-example.md'), `---
type: ideas-batch-summary
id: batch-example
created_at: 2026-05-03T19:21:26.593Z
seed_id: seed-1
seed_artifact_ids: ["bookmark-artifact-1"]
frame_id: novelty-feasibility
frame_name: "Novelty x Feasibility"
depth: standard
model: "claude/opus/effort=medium"
node_target: 3
consideration_ids: ["run-1", "run-2"]
repos: ["/repo/fieldtheory", "/repo/hatchery"]
total_dot_count: 2
---

# Ideas batch
`);

    writeFile(path.join(ideasRoot, 'seeds.json'), JSON.stringify({
      seeds: [{
        id: 'seed-1',
        title: 'Agent workflow seed',
        notes: 'strategy=search',
      }],
    }));
    writeFile(path.join(ideasRoot, 'adjacent', 'artifacts', 'bookmark-artifact-1.md'), `---
{
  "type": "bookmark",
  "metadata": {
    "kind": "bookmark-from-seed-candidate",
    "bookmarkId": "bookmark-1",
    "authorHandle": "example",
    "url": "https://x.com/example/status/bookmark-1",
    "postedAt": "2026-05-03T12:00:00.000Z",
    "bookmarkedAt": "2026-05-03T13:00:00.000Z",
    "category": "agent-workflows",
    "domain": "tools"
  },
  "id": "bookmark-artifact-1"
}
---

Agents need clear provenance trails.

Author: example
Posted: 2026-05-03T12:00:00.000Z
Source: https://x.com/example/status/bookmark-1
`);
    writeFile(path.join(ideasRoot, 'adjacent', 'considerations', 'run-1', 'manifest.json'), JSON.stringify({
      id: 'run-1',
      repo: '/repo/fieldtheory',
      outputIds: ['seed-brief', 'dot-1'],
      frame: {
        id: 'novelty-feasibility',
        name: 'Novelty x Feasibility',
        axisA: { label: 'Novelty' },
        axisB: { label: 'Feasibility' },
      },
    }));
    writeFile(path.join(ideasRoot, 'adjacent', 'considerations', 'run-2', 'manifest.json'), JSON.stringify({
      id: 'run-2',
      repo: '/repo/hatchery',
      outputIds: ['dot-2'],
    }));
    writeFile(path.join(ideasRoot, 'adjacent', 'artifacts', 'seed-brief.md'), `---
{ "type": "seed_brief", "id": "seed-brief" }
---

# Seed
`);
    writeDotArtifact(path.join(ideasRoot, 'adjacent', 'artifacts', 'dot-1.md'), 'dot-1', 'First Node', 65, 40);
    writeDotArtifact(path.join(ideasRoot, 'adjacent', 'artifacts', 'dot-2.md'), 'dot-2', 'Second Node', 35, 80);
    writeFile(path.join(homeDir, '.fieldtheory', 'library', 'Possible', 'First Node.md'), `---
type: possible-essay
dot_id: dot-1
title: "First Library Note"
---

# First Library Note
`);
    writeFile(path.join(homeDir, '.fieldtheory', 'library', 'Possible', 'Second Node.md'), `---
type: possible-essay
node_id: dot-2
---

# Second Library Note
`);

    const batch = getPossibleIdeaBatch('batch-example', { homeDir, env: {} });

    expect(batch).toEqual(expect.objectContaining({
      id: 'batch-example',
      axisA: 'Novelty',
      axisB: 'Feasibility',
      totalDotCount: 2,
      seedTitle: 'Agent workflow seed',
      seedNotes: 'strategy=search',
    }));
    expect(batch?.bookmarkSources).toEqual([
      expect.objectContaining({
        artifactId: 'bookmark-artifact-1',
        bookmarkId: 'bookmark-1',
        title: '@example',
        url: 'https://x.com/example/status/bookmark-1',
        excerpt: 'Agents need clear provenance trails.',
        artifactPath: path.join(ideasRoot, 'adjacent', 'artifacts', 'bookmark-artifact-1.md'),
      }),
    ]);
    expect(batch?.nodes).toHaveLength(2);
    expect(batch?.nodes[0]).toEqual(expect.objectContaining({
      id: 'dot-1',
      title: 'First Node',
      repo: '/repo/fieldtheory',
      repoName: 'fieldtheory',
      runId: 'run-1',
      axisAScore: 65,
      axisBScore: 40,
      rank: 1,
      libraryLinks: [
        {
          title: 'First Library Note',
          relPath: path.join('Possible', 'First Node.md'),
          path: path.join(homeDir, '.fieldtheory', 'library', 'Possible', 'First Node.md'),
        },
      ],
    }));
    expect(batch?.nodes[1]).toEqual(expect.objectContaining({
      id: 'dot-2',
      repoName: 'hatchery',
      rank: 2,
      libraryLinks: [
        {
          title: 'Second Library Note',
          relPath: path.join('Possible', 'Second Node.md'),
          path: path.join(homeDir, '.fieldtheory', 'library', 'Possible', 'Second Node.md'),
        },
      ],
    }));
  });
});
