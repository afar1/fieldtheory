import {
  DEFAULT_COUNCIL_MATCHUP,
  type CouncilEvent,
  type CouncilMatchup,
  type CouncilStatus,
  type CouncilTokenUsage,
} from './types/council';

function createEmptyTokenUsage(): CouncilTokenUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
  };
}

function parseTokenCount(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function sumTokenCounts(current: number | null, next: number | null): number | null {
  if (next == null) {
    return current;
  }
  return (current ?? 0) + next;
}

export function createCouncilStatusSnapshot(overrides: Partial<CouncilStatus> = {}): CouncilStatus {
  return {
    state: overrides.state ?? 'idle',
    currentRound: overrides.currentRound ?? 0,
    topic: overrides.topic ?? null,
    repoPath: overrides.repoPath ?? null,
    error: overrides.error ?? null,
    matchup: overrides.matchup ?? DEFAULT_COUNCIL_MATCHUP,
    transcriptPath: overrides.transcriptPath ?? null,
    consensusPath: overrides.consensusPath ?? null,
    tokenUsage: overrides.tokenUsage ? { ...overrides.tokenUsage } : createEmptyTokenUsage(),
  };
}

export function applyCouncilEventToStatus(
  current: CouncilStatus,
  event: CouncilEvent,
  fallbackMatchup?: CouncilMatchup,
): CouncilStatus {
  const next = createCouncilStatusSnapshot({
    ...current,
    tokenUsage: current.tokenUsage,
  });

  switch (event.type) {
    case 'debate_start':
      next.state = 'debating';
      next.topic = event.topic;
      next.matchup = event.matchup ?? fallbackMatchup ?? current.matchup;
      next.error = null;
      break;
    case 'turn_start':
      next.state = 'debating';
      if (event.round !== 'final') {
        next.currentRound = parseInt(event.round, 10) || next.currentRound;
      }
      break;
    case 'turn_end': {
      next.tokenUsage = {
        inputTokens: sumTokenCounts(next.tokenUsage.inputTokens, parseTokenCount(event.inputTokens)),
        outputTokens: sumTokenCounts(next.tokenUsage.outputTokens, parseTokenCount(event.outputTokens)),
        totalTokens: sumTokenCounts(next.tokenUsage.totalTokens, parseTokenCount(event.totalTokens)),
      };
      break;
    }
    case 'state_change':
      if (event.to === 'FINALIZING') {
        next.state = 'finalizing';
      }
      break;
    case 'pause_requested':
      next.state = 'paused';
      break;
    case 'resume_started':
      next.state = 'debating';
      break;
    case 'transcript_written':
      next.transcriptPath = event.path;
      break;
    case 'consensus_written':
      next.consensusPath = event.path;
      break;
    case 'debate_complete':
      next.state = 'done';
      break;
    default:
      break;
  }

  return next;
}
