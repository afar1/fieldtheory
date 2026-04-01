import path from 'node:path';
import fs from 'node:fs';

function findCliRoot(start: string): string | null {
  // Look for the tools/cli directory that contains automation/sources
  let dir = start;
  while (true) {
    // Direct match: we're inside tools/cli
    if (fs.existsSync(path.join(dir, 'automation', 'sources')) &&
        fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    // Repo root: tools/cli is a subdirectory
    const cliDir = path.join(dir, 'tools', 'cli');
    if (fs.existsSync(path.join(cliDir, 'automation', 'sources'))) {
      return cliDir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function workspaceRoot(cwd = process.cwd()): string {
  const found = findCliRoot(cwd);
  if (found) return found;
  return cwd;
}

export function automationDir(cwd = process.cwd()): string {
  return path.join(workspaceRoot(cwd), 'automation');
}

export function datasetsDir(cwd = process.cwd()): string {
  return path.join(automationDir(cwd), 'datasets');
}

export function datasetManifestPath(id: string, cwd = process.cwd()): string {
  return path.join(datasetsDir(cwd), `${id}.yaml`);
}

export function datasetStateDir(id: string, cwd = process.cwd()): string {
  return path.join(automationDir(cwd), 'dataset-state', id);
}

export function datasetArtifactsDir(id: string, cwd = process.cwd()): string {
  return path.join(datasetStateDir(id, cwd), 'artifacts');
}

export function datasetLatestPath(id: string, cwd = process.cwd()): string {
  return path.join(datasetStateDir(id, cwd), 'latest.md');
}

export function datasetStatePath(id: string, cwd = process.cwd()): string {
  return path.join(datasetStateDir(id, cwd), 'state.json');
}

export function sourcesDir(cwd = process.cwd()): string {
  return path.join(automationDir(cwd), 'sources');
}

export function twitterBookmarksCachePath(cwd = process.cwd()): string {
  return path.join(sourcesDir(cwd), 'x-bookmarks.jsonl');
}

export function twitterBookmarksMetaPath(cwd = process.cwd()): string {
  return path.join(sourcesDir(cwd), 'x-bookmarks.meta.json');
}

export function twitterOauthTokenPath(cwd = process.cwd()): string {
  return path.join(sourcesDir(cwd), 'x-oauth-token.json');
}

export function twitterBackfillStatePath(cwd = process.cwd()): string {
  return path.join(sourcesDir(cwd), 'x-bookmarks-backfill-state.json');
}

export function bookmarkMediaDir(cwd = process.cwd()): string {
  return path.join(sourcesDir(cwd), 'x-bookmarks-media');
}

export function bookmarkMediaManifestPath(cwd = process.cwd()): string {
  return path.join(sourcesDir(cwd), 'x-bookmarks-media-manifest.json');
}

export function twitterBookmarksIndexPath(cwd = process.cwd()): string {
  return path.join(sourcesDir(cwd), 'x-bookmarks.db');
}

export function localStateDir(cwd = process.cwd()): string {
  return path.join(workspaceRoot(cwd), '.local');
}

export function timelineStatePath(cwd = process.cwd()): string {
  return path.join(localStateDir(cwd), 'timeline-state.json');
}

export function theoryIndexPath(cwd = process.cwd()): string {
  return path.join(localStateDir(cwd), 'theories.db');
}

export function theoryMailCacheDir(cwd = process.cwd()): string {
  return path.join(localStateDir(cwd), 'theory-mail-cache');
}
