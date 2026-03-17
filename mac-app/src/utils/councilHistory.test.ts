import { describe, expect, it } from 'vitest';

import {
  buildCouncilHistoryEntries,
  extractCouncilTranscriptMeta,
  humanizeCouncilSlug,
  parseCouncilArtifactPath,
} from './councilHistory';

describe('parseCouncilArtifactPath', () => {
  it('parses transcript and consensus council artifacts', () => {
    expect(parseCouncilArtifactPath('/tmp/2026-03-16_18-33-17_offline-eye-tracking-foundation.md')).toEqual({
      id: '2026-03-16_18-33-17_offline-eye-tracking-foundation',
      slug: 'offline-eye-tracking-foundation',
      isConsensus: false,
    });

    expect(parseCouncilArtifactPath('/tmp/2026-03-16_18-33-17_offline-eye-tracking-foundation_consensus.md')).toEqual({
      id: '2026-03-16_18-33-17_offline-eye-tracking-foundation',
      slug: 'offline-eye-tracking-foundation',
      isConsensus: true,
    });
  });

  it('ignores non-council handoff files', () => {
    expect(parseCouncilArtifactPath('/tmp/fieldtheory-mac-app-2026-03-16-183317-handoff.md')).toBeNull();
  });
});

describe('buildCouncilHistoryEntries', () => {
  it('groups transcript and consensus files into a single debate entry', () => {
    const entries = buildCouncilHistoryEntries([
      {
        name: '2026-03-16_18-33-17_offline-eye-tracking-foundation',
        filePath: '/tmp/2026-03-16_18-33-17_offline-eye-tracking-foundation.md',
        lastModified: 100,
      },
      {
        name: '2026-03-16_18-33-17_offline-eye-tracking-foundation_consensus',
        filePath: '/tmp/2026-03-16_18-33-17_offline-eye-tracking-foundation_consensus.md',
        lastModified: 120,
      },
      {
        name: 'fieldtheory-mac-app-2026-03-16-183317-handoff',
        filePath: '/tmp/fieldtheory-mac-app-2026-03-16-183317-handoff.md',
        lastModified: 999,
      },
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: '2026-03-16_18-33-17_offline-eye-tracking-foundation',
      topicPreview: 'Offline Eye Tracking Foundation',
      transcriptPath: '/tmp/2026-03-16_18-33-17_offline-eye-tracking-foundation.md',
      consensusPath: '/tmp/2026-03-16_18-33-17_offline-eye-tracking-foundation_consensus.md',
      lastModified: 120,
    });
  });

  it('sorts newest debates first', () => {
    const entries = buildCouncilHistoryEntries([
      {
        name: '2026-03-16_18-33-17_first-debate',
        filePath: '/tmp/2026-03-16_18-33-17_first-debate.md',
        lastModified: 100,
      },
      {
        name: '2026-03-16_19-02-10_second-debate',
        filePath: '/tmp/2026-03-16_19-02-10_second-debate.md',
        lastModified: 200,
      },
    ]);

    expect(entries.map((entry) => entry.slug)).toEqual(['second-debate', 'first-debate']);
  });
});

describe('humanizeCouncilSlug', () => {
  it('turns slug fragments into readable labels', () => {
    expect(humanizeCouncilSlug('offline-eye-tracking-foundation')).toBe('Offline Eye Tracking Foundation');
  });
});

describe('extractCouncilTranscriptMeta', () => {
  it('reads topic and matchup from the transcript header', () => {
    const meta = extractCouncilTranscriptMeta(`
# Council Debate
**Topic**: Is the current eye tracking branch the right foundation?
**Date**: March 16, 2026 at 06:33 PM
**Mode**: Open-ended (max 8 turns)
**Matchup**: opus-vs-codex
    `.trim());

    expect(meta).toEqual({
      topic: 'Is the current eye tracking branch the right foundation?',
      matchup: 'opus-vs-codex',
    });
  });
});
