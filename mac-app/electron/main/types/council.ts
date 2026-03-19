/**
 * IPC channels and types for Council debate feature.
 */

export const CouncilIPCChannels = {
  START: 'council:start',
  STOP: 'council:stop',
  GET_STATUS: 'council:getStatus',
  GET_PREFERENCES: 'council:getPreferences',
  SAVE_PREFERENCES: 'council:savePreferences',
  SHOW_WINDOW: 'council:showWindow',
  EVENT: 'council:event',
  STATUS_CHANGED: 'council:statusChanged',
} as const;

export type CouncilMatchup =
  | 'opus-vs-opus'
  | 'opus-vs-sonnet'
  | 'opus-vs-codex'
  | 'sonnet-vs-opus'
  | 'sonnet-vs-sonnet'
  | 'sonnet-vs-codex'
  | 'codex-vs-opus'
  | 'codex-vs-sonnet'
  | 'codex-vs-codex';

export const COUNCIL_MATCHUPS: CouncilMatchup[] = [
  'opus-vs-opus',
  'opus-vs-sonnet',
  'opus-vs-codex',
  'sonnet-vs-opus',
  'sonnet-vs-sonnet',
  'sonnet-vs-codex',
  'codex-vs-opus',
  'codex-vs-sonnet',
  'codex-vs-codex',
];

export const DEFAULT_COUNCIL_MATCHUP: CouncilMatchup = 'opus-vs-codex';
export const DEFAULT_COUNCIL_MAX_TURNS = 6;

export function isCouncilMatchup(value: string | undefined | null): value is CouncilMatchup {
  return value != null && COUNCIL_MATCHUPS.includes(value as CouncilMatchup);
}

export interface CouncilConfig {
  topic: string;
  maxTurns?: number;
  repoPath?: string;
  matchup?: CouncilMatchup;
  opusVsOpus?: boolean;
}

export interface CouncilTokenUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export type CouncilState = 'idle' | 'starting' | 'debating' | 'paused' | 'finalizing' | 'done' | 'error';

export interface CouncilStatus {
  state: CouncilState;
  currentRound: number;
  topic: string | null;
  repoPath: string | null;
  error: string | null;
  matchup: CouncilMatchup;
  transcriptPath: string | null;
  consensusPath: string | null;
  tokenUsage: CouncilTokenUsage;
}

export interface CouncilPreferences {
  defaultMatchup: CouncilMatchup;
  defaultMaxTurns: number;
  autoOpenWindow: boolean;
  autoPasteConsensus: boolean;
}

export type CouncilEvent =
  | { type: 'debate_start'; topic: string; maxTurns: string; matchup?: CouncilMatchup }
  | { type: 'turn_start'; speaker: string; round: string }
  | { type: 'turn_chunk'; speaker: string; content: string }
  | {
      type: 'turn_status';
      speaker: string;
      round: string;
      phase: 'attempt_start' | 'waiting' | 'streaming' | 'retrying';
      attempt?: string;
      detail: string;
    }
  | {
      type: 'turn_end';
      speaker: string;
      round: string;
      convergence: string;
      action: string;
      inputTokens?: string;
      outputTokens?: string;
      totalTokens?: string;
    }
  | { type: 'pause_requested'; reason: string; round: string; stateFilePath: string }
  | { type: 'resume_started'; round: string; stateFilePath: string; hasHumanInput: string }
  | { type: 'state_change'; from: string; to: string; reason: string }
  | { type: 'error'; speaker: string; message: string }
  | { type: 'stderr'; speaker: string; content: string }
  | { type: 'transcript_written'; path: string }
  | { type: 'consensus_written'; path: string }
  | { type: 'debate_complete'; totalRounds: string; outcome: string };
