/**
 * IPC channels and types for Council debate feature.
 */

export const CouncilIPCChannels = {
  START: 'council:start',
  STOP: 'council:stop',
  GET_STATUS: 'council:getStatus',
  SHOW_WINDOW: 'council:showWindow',
  EVENT: 'council:event',
  STATUS_CHANGED: 'council:statusChanged',
} as const;

export interface CouncilConfig {
  topic: string;
  maxTurns?: number;
  repoPath?: string;
  opusVsOpus?: boolean;
}

export type CouncilState = 'idle' | 'starting' | 'debating' | 'finalizing' | 'done' | 'error';

export interface CouncilStatus {
  state: CouncilState;
  currentRound: number;
  topic: string | null;
  error: string | null;
}

export type CouncilEvent =
  | { type: 'debate_start'; topic: string; maxTurns: string }
  | { type: 'turn_start'; speaker: string; round: string }
  | { type: 'turn_chunk'; speaker: string; content: string }
  | { type: 'turn_end'; speaker: string; round: string; convergence: string; action: string }
  | { type: 'state_change'; from: string; to: string; reason: string }
  | { type: 'error'; speaker: string; message: string }
  | { type: 'stderr'; speaker: string; content: string }
  | { type: 'transcript_written'; path: string }
  | { type: 'debate_complete'; totalRounds: string; outcome: string };
