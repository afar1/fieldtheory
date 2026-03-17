export interface CouncilHistoryFileInfo {
  name: string;
  filePath: string;
  lastModified: number;
}

export interface CouncilHistoryEntry {
  id: string;
  slug: string;
  topicPreview: string;
  lastModified: number;
  transcriptPath: string | null;
  transcriptLastModified: number | null;
  consensusPath: string | null;
  consensusLastModified: number | null;
}

export interface CouncilTranscriptMeta {
  topic: string | null;
  matchup: string | null;
}

const COUNCIL_ARTIFACT_BASENAME = /^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_.+?)(?:_consensus)?$/i;
const COUNCIL_TRANSCRIPT_TOPIC = /^\*\*Topic\*\*:\s+(.+)$/m;
const COUNCIL_TRANSCRIPT_MATCHUP = /^\*\*Matchup\*\*:\s+(.+)$/m;

export function parseCouncilArtifactPath(filePath: string): { id: string; slug: string; isConsensus: boolean } | null {
  const fileName = filePath.split('/').pop() ?? filePath;
  const basename = fileName.replace(/\.(md|markdown)$/i, '');
  const match = basename.match(COUNCIL_ARTIFACT_BASENAME);

  if (!match) {
    return null;
  }

  const isConsensus = basename.endsWith('_consensus');
  const id = match[1];
  const slug = id.replace(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_/, '');

  return {
    id,
    slug,
    isConsensus,
  };
}

export function humanizeCouncilSlug(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function buildCouncilHistoryEntries(files: CouncilHistoryFileInfo[]): CouncilHistoryEntry[] {
  const entries = new Map<string, CouncilHistoryEntry>();

  for (const file of files) {
    const parsed = parseCouncilArtifactPath(file.filePath);
    if (!parsed) {
      continue;
    }

    const existing = entries.get(parsed.id) ?? {
      id: parsed.id,
      slug: parsed.slug,
      topicPreview: humanizeCouncilSlug(parsed.slug),
      lastModified: file.lastModified,
      transcriptPath: null,
      transcriptLastModified: null,
      consensusPath: null,
      consensusLastModified: null,
    };

    existing.lastModified = Math.max(existing.lastModified, file.lastModified);
    if (parsed.isConsensus) {
      existing.consensusPath = file.filePath;
      existing.consensusLastModified = file.lastModified;
    } else {
      existing.transcriptPath = file.filePath;
      existing.transcriptLastModified = file.lastModified;
    }

    entries.set(parsed.id, existing);
  }

  return Array.from(entries.values()).sort((a, b) => b.lastModified - a.lastModified);
}

export function extractCouncilTranscriptMeta(content: string): CouncilTranscriptMeta {
  const topic = content.match(COUNCIL_TRANSCRIPT_TOPIC)?.[1]?.trim() ?? null;
  const matchup = content.match(COUNCIL_TRANSCRIPT_MATCHUP)?.[1]?.trim() ?? null;

  return { topic, matchup };
}
