import fs from 'fs';
import path from 'path';
import { ideasDir, libraryDir, type FieldTheoryPathOptions } from './fieldTheoryPaths';

export interface PossibleIdeaFrame {
  id: string;
  name: string;
  axisA?: { label?: string; rubricSentence?: string };
  axisB?: { label?: string; rubricSentence?: string };
  quadrantLabels?: {
    highHigh?: string;
    highLow?: string;
    lowHigh?: string;
    lowLow?: string;
  };
}

export interface PossibleIdeaBatchSummary {
  id: string;
  batchPath: string;
  createdAt: string;
  seedId: string;
  seedArtifactIds: string[];
  frameId: string;
  frameName: string;
  depth: string;
  model: string;
  nodeTarget: number;
  totalDotCount: number;
  considerationIds: string[];
  repos: string[];
}

export interface PossibleIdeaLibraryLink {
  title: string;
  relPath: string;
  path: string;
}

export interface PossibleIdeaBookmarkSource {
  artifactId: string;
  bookmarkId: string;
  authorHandle: string;
  url: string;
  postedAt: string;
  bookmarkedAt: string;
  category: string;
  domain: string;
  title: string;
  excerpt: string;
  artifactPath: string;
}

export interface PossibleIdeaNode {
  id: string;
  title: string;
  summary: string;
  essay: string;
  rationale: string;
  repoSurface: string;
  effortEstimate: string;
  axisAScore: number;
  axisAJustification: string;
  axisBScore: number;
  axisBJustification: string;
  exportablePrompt: string;
  implementationPrompt: string;
  repo: string;
  repoName: string;
  runId: string;
  artifactPath: string;
  rank: number;
  libraryLinks: PossibleIdeaLibraryLink[];
}

export interface PossibleIdeaBatch extends PossibleIdeaBatchSummary {
  axisA: string;
  axisB: string;
  frame: PossibleIdeaFrame | null;
  seedTitle: string;
  seedNotes: string;
  bookmarkSources: PossibleIdeaBookmarkSource[];
  nodes: PossibleIdeaNode[];
}

interface FrontmatterParts {
  frontmatter: string;
  body: string;
}

function splitFrontmatter(raw: string): FrontmatterParts | null {
  if (!raw.startsWith('---')) return null;
  const closing = raw.indexOf('\n---', 3);
  if (closing === -1) return null;

  const bodyStart = raw[closing + 4] === '\n' ? closing + 5 : closing + 4;
  return {
    frontmatter: raw.slice(4, closing).trim(),
    body: raw.slice(bodyStart),
  };
}

function parseBatchFrontmatter(frontmatter: string): Record<string, unknown> {
  const parsed: Record<string, unknown> = {};

  for (const rawLine of frontmatter.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    const rawValue = match[2].trim();
    if (!rawValue) {
      parsed[key] = '';
      continue;
    }

    if (rawValue.startsWith('[') || rawValue.startsWith('{') || rawValue.startsWith('"')) {
      try {
        parsed[key] = JSON.parse(rawValue);
        continue;
      } catch {
        // Fall through to plain string parsing.
      }
    }

    if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
      parsed[key] = Number(rawValue);
      continue;
    }

    parsed[key] = rawValue;
  }

  return parsed;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function repoName(repo: string): string {
  const trimmed = repo.replace(/[\\/]+$/, '');
  return path.basename(trimmed) || repo;
}

function titleFromMarkdownBody(body: string, filePath: string): string {
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || path.basename(filePath, '.md');
}

function excerptFromBookmarkBody(body: string): string {
  const contentLines = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^(Author|Posted|Source):\s/.test(line));

  return contentLines.join(' ').replace(/\s+/g, ' ').trim();
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return null;
  }
}

function findMarkdownFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) return [];

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...findMarkdownFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

function parseBatchSummary(filePath: string): PossibleIdeaBatchSummary | null {
  try {
    const parts = splitFrontmatter(fs.readFileSync(filePath, 'utf-8'));
    if (!parts) return null;
    const frontmatter = parseBatchFrontmatter(parts.frontmatter);
    const id = asString(frontmatter.id) || path.basename(filePath, '.md');

    return {
      id,
      batchPath: filePath,
      createdAt: asString(frontmatter.created_at),
      seedId: asString(frontmatter.seed_id),
      seedArtifactIds: asStringArray(frontmatter.seed_artifact_ids),
      frameId: asString(frontmatter.frame_id),
      frameName: asString(frontmatter.frame_name),
      depth: asString(frontmatter.depth),
      model: asString(frontmatter.model),
      nodeTarget: asNumber(frontmatter.node_target),
      totalDotCount: asNumber(frontmatter.total_dot_count),
      considerationIds: asStringArray(frontmatter.consideration_ids),
      repos: asStringArray(frontmatter.repos),
    };
  } catch {
    return null;
  }
}

function parseAxisLabels(summary: PossibleIdeaBatchSummary, frame: PossibleIdeaFrame | null): { axisA: string; axisB: string } {
  const frameAxisA = frame?.axisA?.label;
  const frameAxisB = frame?.axisB?.label;
  if (frameAxisA || frameAxisB) {
    return {
      axisA: frameAxisA || 'Axis A',
      axisB: frameAxisB || 'Axis B',
    };
  }

  const labels = summary.frameName.split(/\s*[xX\u00d7]\s*/).map((label) => label.trim()).filter(Boolean);
  return {
    axisA: labels[0] || 'Axis A',
    axisB: labels[1] || 'Axis B',
  };
}

type PossibleRunManifest = {
  id?: string;
  outputIds?: string[];
  frame?: PossibleIdeaFrame;
  repo?: string;
};

type DotArtifactFrontmatter = {
  type?: string;
  metadata?: Record<string, unknown>;
  id?: string;
};

type PossibleSeedStore = {
  seeds?: Array<{
    id?: string;
    title?: string;
    notes?: string;
  }>;
};

function parseBookmarkSource(artifactId: string, artifactPath: string): PossibleIdeaBookmarkSource | null {
  try {
    const parts = splitFrontmatter(fs.readFileSync(artifactPath, 'utf-8'));
    if (!parts) return null;

    const frontmatter = JSON.parse(parts.frontmatter) as DotArtifactFrontmatter;
    if (frontmatter.type !== 'bookmark') return null;

    const metadata = frontmatter.metadata ?? {};
    const url = asString(metadata.url);
    const authorHandle = asString(metadata.authorHandle);
    const excerpt = excerptFromBookmarkBody(parts.body);
    const title = authorHandle
      ? `@${authorHandle}`
      : hostFromUrl(url) || asString(metadata.bookmarkId) || artifactId;

    return {
      artifactId: asString(frontmatter.id) || artifactId,
      bookmarkId: asString(metadata.bookmarkId),
      authorHandle,
      url,
      postedAt: asString(metadata.postedAt),
      bookmarkedAt: asString(metadata.bookmarkedAt),
      category: asString(metadata.category),
      domain: asString(metadata.domain),
      title,
      excerpt,
      artifactPath,
    };
  } catch {
    return null;
  }
}

function readSeedInfo(seedId: string, options?: FieldTheoryPathOptions): { title: string; notes: string } {
  if (!seedId) return { title: '', notes: '' };

  const store = readJsonFile<PossibleSeedStore>(path.join(ideasDir(options), 'seeds.json'));
  const seed = store?.seeds?.find((item) => item.id === seedId);
  return {
    title: asString(seed?.title),
    notes: asString(seed?.notes),
  };
}

function readBookmarkSources(seedArtifactIds: string[], options?: FieldTheoryPathOptions): PossibleIdeaBookmarkSource[] {
  const baseIdeasDir = ideasDir(options);
  return seedArtifactIds
    .map((artifactId) => parseBookmarkSource(
      artifactId,
      path.join(baseIdeasDir, 'adjacent', 'artifacts', `${artifactId}.md`),
    ))
    .filter((source): source is PossibleIdeaBookmarkSource => source !== null);
}

function parseDotArtifact(
  artifactId: string,
  artifactPath: string,
  repo: string,
  runId: string,
): PossibleIdeaNode | null {
  try {
    const parts = splitFrontmatter(fs.readFileSync(artifactPath, 'utf-8'));
    if (!parts) return null;

    const frontmatter = JSON.parse(parts.frontmatter) as DotArtifactFrontmatter;
    if (frontmatter.type !== 'dot') return null;

    const metadata = frontmatter.metadata ?? {};

    return {
      id: asString(frontmatter.id) || artifactId,
      title: asString(metadata.title),
      summary: asString(metadata.summary),
      essay: asString(metadata.essay),
      rationale: asString(metadata.rationale),
      repoSurface: asString(metadata.repoSurface),
      effortEstimate: asString(metadata.effortEstimate),
      axisAScore: asNumber(metadata.axisAScore),
      axisAJustification: asString(metadata.axisAJustification),
      axisBScore: asNumber(metadata.axisBScore),
      axisBJustification: asString(metadata.axisBJustification),
      exportablePrompt: asString(metadata.exportablePrompt) || parts.body.trim(),
      implementationPrompt: asString(metadata.implementationPrompt),
      repo,
      repoName: repoName(repo),
      runId,
      artifactPath,
      rank: 0,
      libraryLinks: [],
    };
  } catch {
    return null;
  }
}

function buildLibraryLinksByNodeId(options?: FieldTheoryPathOptions): Map<string, PossibleIdeaLibraryLink[]> {
  const baseLibraryDir = libraryDir(options);
  const possibleDir = path.join(baseLibraryDir, 'Possible');
  const linksByNodeId = new Map<string, PossibleIdeaLibraryLink[]>();

  for (const filePath of findMarkdownFiles(possibleDir)) {
    try {
      const parts = splitFrontmatter(fs.readFileSync(filePath, 'utf-8'));
      if (!parts) continue;

      const frontmatter = parseBatchFrontmatter(parts.frontmatter);
      const ids = [asString(frontmatter.dot_id), asString(frontmatter.node_id)].filter(Boolean);
      if (ids.length === 0) continue;

      const link: PossibleIdeaLibraryLink = {
        title: asString(frontmatter.title) || titleFromMarkdownBody(parts.body, filePath),
        relPath: path.relative(baseLibraryDir, filePath),
        path: filePath,
      };

      for (const id of ids) {
        const current = linksByNodeId.get(id) ?? [];
        current.push(link);
        linksByNodeId.set(id, current);
      }
    } catch {
      // Ignore malformed Library notes; Possible should still load the batch.
    }
  }

  for (const links of linksByNodeId.values()) {
    links.sort((a, b) => a.title.localeCompare(b.title));
  }

  return linksByNodeId;
}

export function listPossibleIdeaBatches(options?: FieldTheoryPathOptions): PossibleIdeaBatchSummary[] {
  const batchesDir = path.join(ideasDir(options), 'batches');
  return findMarkdownFiles(batchesDir)
    .map(parseBatchSummary)
    .filter((summary): summary is PossibleIdeaBatchSummary => summary !== null)
    .sort((a, b) => {
      const bTime = Date.parse(b.createdAt);
      const aTime = Date.parse(a.createdAt);
      return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
    });
}

export function getPossibleIdeaBatch(batchId?: string, options?: FieldTheoryPathOptions): PossibleIdeaBatch | null {
  const summaries = listPossibleIdeaBatches(options);
  const summary = batchId ? summaries.find((item) => item.id === batchId) : summaries[0];
  if (!summary) return null;

  const baseIdeasDir = ideasDir(options);
  const nodes: PossibleIdeaNode[] = [];
  let frame: PossibleIdeaFrame | null = null;

  summary.considerationIds.forEach((runId, runIndex) => {
    const manifestPath = path.join(baseIdeasDir, 'adjacent', 'considerations', runId, 'manifest.json');
    const manifest = readJsonFile<PossibleRunManifest>(manifestPath);
    if (!manifest) return;

    if (!frame && manifest.frame) {
      frame = manifest.frame;
    }

    const repo = manifest.repo || summary.repos[runIndex] || '';
    for (const outputId of manifest.outputIds ?? []) {
      const artifactPath = path.join(baseIdeasDir, 'adjacent', 'artifacts', `${outputId}.md`);
      const node = parseDotArtifact(outputId, artifactPath, repo, runId);
      if (node) nodes.push(node);
    }
  });

  const linksByNodeId = buildLibraryLinksByNodeId(options);
  const rankedNodes = nodes.map((node, index) => ({
    ...node,
    rank: index + 1,
    libraryLinks: linksByNodeId.get(node.id) ?? [],
  }));
  const labels = parseAxisLabels(summary, frame);
  const seedInfo = readSeedInfo(summary.seedId, options);

  return {
    ...summary,
    axisA: labels.axisA,
    axisB: labels.axisB,
    frame,
    seedTitle: seedInfo.title,
    seedNotes: seedInfo.notes,
    bookmarkSources: readBookmarkSources(summary.seedArtifactIds, options),
    nodes: rankedNodes,
    totalDotCount: summary.totalDotCount || rankedNodes.length,
  };
}
