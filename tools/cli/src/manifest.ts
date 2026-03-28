import { z } from 'zod';
import { ensureDir, readYaml, writeYaml } from './fs.js';
import { datasetArtifactsDir, datasetLatestPath, datasetManifestPath, datasetStateDir, datasetStatePath, datasetsDir } from './paths.js';
import type { DatasetManifest } from './types.js';

const manifestSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['repo', 'files', 'mixed', 'bookmarks']),
  source: z.record(z.string(), z.unknown()),
  schedule: z.object({ cron: z.string().optional() }).optional(),
  context: z.string().optional(),
  initiative: z.enum(['observe', 'suggest', 'prototype', 'improve']).optional(),
  budget: z.object({ effort: z.enum(['low', 'medium', 'high']).optional() }).optional(),
  delivery: z.object({ onlyWhenWorthwhile: z.boolean().optional(), channel: z.literal('email').optional() }).optional(),
  gitNotes: z.boolean().optional(),
});

export async function createDatasetManifest(manifest: DatasetManifest, cwd = process.cwd()): Promise<string> {
  manifestSchema.parse(manifest);
  await ensureDir(datasetsDir(cwd));
  await ensureDir(datasetStateDir(manifest.id, cwd));
  await ensureDir(datasetArtifactsDir(manifest.id, cwd));
  await writeYaml(datasetManifestPath(manifest.id, cwd), manifest);
  const statePath = datasetStatePath(manifest.id, cwd);
  const latestPath = datasetLatestPath(manifest.id, cwd);
  await writeYaml(statePath, { datasetId: manifest.id, recentConclusions: [], openQuestions: [], exploredPaths: [], recentArtifacts: [] });
  await writeYaml(latestPath, { title: `${manifest.id} latest`, status: 'No runs yet.' });
  return datasetManifestPath(manifest.id, cwd);
}

export async function loadDatasetManifest(id: string, cwd = process.cwd()): Promise<DatasetManifest> {
  const manifest = await readYaml<DatasetManifest>(datasetManifestPath(id, cwd));
  manifestSchema.parse(manifest);
  return manifest;
}
