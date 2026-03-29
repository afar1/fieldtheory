import path from 'node:path';

export function workspaceRoot(cwd = process.cwd()): string {
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

export function localStateDir(cwd = process.cwd()): string {
  return path.join(workspaceRoot(cwd), '.local');
}

