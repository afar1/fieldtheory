import { describe, expect, it } from 'vitest';

import { applyCouncilEventToStatus, createCouncilStatusSnapshot } from './councilStatusSnapshot';

describe('councilStatusSnapshot', () => {
  it('creates an idle snapshot by default', () => {
    expect(createCouncilStatusSnapshot()).toEqual({
      state: 'idle',
      currentRound: 0,
      topic: null,
      repoPath: null,
      error: null,
      matchup: 'opus-vs-codex',
      transcriptPath: null,
      consensusPath: null,
      tokenUsage: {
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
      },
    });
  });

  it('advances kickoff-like council status through the main event lifecycle', () => {
    let status = createCouncilStatusSnapshot({
      state: 'starting',
      topic: 'Kickoff topic',
      matchup: 'codex-vs-codex',
    });

    status = applyCouncilEventToStatus(
      status,
      { type: 'debate_start', topic: 'Real topic', maxTurns: '6', matchup: 'opus-vs-codex' },
      'codex-vs-codex',
    );
    expect(status.state).toBe('debating');
    expect(status.topic).toBe('Real topic');
    expect(status.matchup).toBe('opus-vs-codex');

    status = applyCouncilEventToStatus(status, {
      type: 'turn_start',
      speaker: 'Opus',
      round: '2',
    });
    expect(status.currentRound).toBe(2);

    status = applyCouncilEventToStatus(status, {
      type: 'turn_end',
      speaker: 'Opus',
      round: '2',
      convergence: 'medium',
      action: 'continue',
      inputTokens: '120',
      outputTokens: '45',
      totalTokens: '165',
    });
    expect(status.tokenUsage).toEqual({
      inputTokens: 120,
      outputTokens: 45,
      totalTokens: 165,
    });

    status = applyCouncilEventToStatus(status, {
      type: 'state_change',
      from: 'DEBATING',
      to: 'FINALIZING',
      reason: 'converged',
    });
    expect(status.state).toBe('finalizing');

    status = applyCouncilEventToStatus(status, {
      type: 'transcript_written',
      path: '/tmp/transcript.md',
    });
    status = applyCouncilEventToStatus(status, {
      type: 'consensus_written',
      path: '/tmp/consensus.md',
    });
    status = applyCouncilEventToStatus(status, {
      type: 'debate_complete',
      totalRounds: '2',
      outcome: 'FINALIZING',
    });

    expect(status).toMatchObject({
      state: 'done',
      transcriptPath: '/tmp/transcript.md',
      consensusPath: '/tmp/consensus.md',
    });
  });
});
