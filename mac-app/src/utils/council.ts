export const DEFAULT_COUNCIL_MATCHUP: CouncilMatchup = 'opus-vs-codex';
export const DEFAULT_COUNCIL_MAX_TURNS = 6;
export const MIN_COUNCIL_MAX_TURNS = 0;
export const MAX_COUNCIL_MAX_TURNS = 20;
export const COUNCIL_STALL_WARNING_MS = 45_000;
export const COUNCIL_STALL_ERROR_MS = 120_000;

export const COUNCIL_MATCHUP_OPTIONS: Array<{ value: CouncilMatchup; label: string }> = [
  { value: 'opus-vs-codex', label: 'Opus vs Codex' },
  { value: 'opus-vs-opus', label: 'Opus vs Opus' },
  { value: 'opus-vs-sonnet', label: 'Opus vs Sonnet' },
  { value: 'sonnet-vs-opus', label: 'Sonnet vs Opus' },
  { value: 'sonnet-vs-codex', label: 'Sonnet vs Codex' },
  { value: 'codex-vs-codex', label: 'Codex vs Codex' },
  { value: 'codex-vs-opus', label: 'Codex vs Opus' },
  { value: 'codex-vs-sonnet', label: 'Codex vs Sonnet' },
  { value: 'sonnet-vs-sonnet', label: 'Sonnet vs Sonnet' },
];

const COUNCIL_SPEAKER_COLORS = {
  Opus: { bg: '#1e3a5f', text: '#93c5fd', border: '#3b82f6' },
  Sonnet: { bg: '#4a3415', text: '#fcd34d', border: '#f59e0b' },
  Codex: { bg: '#1a3d2e', text: '#86efac', border: '#22c55e' },
} as const;

export const DEFAULT_COUNCIL_SPEAKER_COLOR = {
  bg: '#2d2d2d',
  text: '#e5e5e5',
  border: '#525252',
};

const COUNCIL_WARMUP_PHRASES = [
  'Reticulating splines',
  'Scanning the repo',
  'Pressure-testing assumptions',
  'Walking the code paths',
  'Comparing implementation options',
  'Gathering its case',
];

const COUNCIL_STREAMING_PHRASES = [
  'Streaming its turn',
  'Comparing tradeoffs',
  'Cross-checking evidence',
  'Sharpening the argument',
  'Working through the edge cases',
  'Writing up the response',
];

export type CouncilTurnActivityTone = 'working' | 'quiet' | 'warning' | 'error';

export interface CouncilTurnActivityState {
  tone: CouncilTurnActivityTone;
  headline: string;
  detail: string;
}

interface CouncilTurnProgressInput {
  phase: 'attempt_start' | 'waiting' | 'streaming' | 'retrying';
  detail: string;
  updatedAtMs: number;
}

export function formatCouncilMatchup(matchup: string): string {
  return COUNCIL_MATCHUP_OPTIONS.find((option) => option.value === matchup)?.label
    ?? matchup.split('-vs-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' vs ');
}

export function clampCouncilMaxTurns(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_COUNCIL_MAX_TURNS;
  }
  return Math.max(MIN_COUNCIL_MAX_TURNS, Math.min(MAX_COUNCIL_MAX_TURNS, Math.round(value)));
}

export function getCouncilSpeakerColor(speaker: string) {
  const normalized = speaker.replace(/\s+[AB]$/, '');
  return COUNCIL_SPEAKER_COLORS[normalized as keyof typeof COUNCIL_SPEAKER_COLORS] ?? DEFAULT_COUNCIL_SPEAKER_COLOR;
}

export function formatCouncilElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 10) {
    return `${minutes}m ${seconds}s`;
  }
  return `${minutes}m`;
}

export function getCouncilTurnActivityState(input: {
  speaker: string;
  startedAtMs: number;
  lastOutputAtMs: number | null;
  hasOutput: boolean;
  latestError?: string | null;
  latestProgress?: CouncilTurnProgressInput | null;
  nowMs?: number;
}): CouncilTurnActivityState {
  const nowMs = Number.isFinite(input.nowMs) ? Math.round(input.nowMs as number) : Date.now();
  const elapsedMs = Math.max(0, nowMs - input.startedAtMs);
  const quietMs = Math.max(0, nowMs - (input.lastOutputAtMs ?? input.startedAtMs));
  const elapsedLabel = formatCouncilElapsed(elapsedMs);
  const quietLabel = formatCouncilElapsed(quietMs);
  const latestProgressAgeMs = input.latestProgress
    ? Math.max(0, nowMs - input.latestProgress.updatedAtMs)
    : Number.POSITIVE_INFINITY;
  const hasFreshProgress = latestProgressAgeMs <= 20_000;

  if (input.latestError) {
    return {
      tone: 'error',
      headline: `${input.speaker} hit an error`,
      detail: input.latestError,
    };
  }

  if (hasFreshProgress && input.latestProgress) {
    if (input.latestProgress.phase === 'retrying') {
      return {
        tone: 'warning',
        headline: `Retrying ${input.speaker}'s turn`,
        detail: `${input.latestProgress.detail} ${elapsedLabel} elapsed.`,
      };
    }

    if (!input.hasOutput) {
      return {
        tone: elapsedMs < COUNCIL_STALL_ERROR_MS ? 'working' : 'quiet',
        headline: `${input.speaker} is still processing`,
        detail: `${input.latestProgress.detail} ${elapsedLabel} elapsed.`,
      };
    }

    return {
      tone: 'working',
      headline: `${input.speaker} is still processing`,
      detail: `${input.latestProgress.detail} ${elapsedLabel} total for this turn.`,
    };
  }

  if (!input.hasOutput) {
    if (elapsedMs < 12_000) {
      return {
        tone: 'working',
        headline: pickCouncilPhrase(input.speaker, elapsedMs, COUNCIL_WARMUP_PHRASES),
        detail: `Waiting for first output. ${elapsedLabel} elapsed.`,
      };
    }

    if (elapsedMs < COUNCIL_STALL_WARNING_MS) {
      return {
        tone: 'quiet',
        headline: `${input.speaker} is still working`,
        detail: `No output yet. ${elapsedLabel} elapsed.`,
      };
    }

    if (elapsedMs < COUNCIL_STALL_ERROR_MS) {
      return {
        tone: 'warning',
        headline: `${input.speaker} is taking longer than usual`,
        detail: `Still no output after ${elapsedLabel}. This may be normal on larger prompts, but keep an eye on it.`,
      };
    }

    return {
      tone: 'error',
      headline: `Possible stall while waiting on ${input.speaker}`,
      detail: `No output for ${elapsedLabel}. The turn is still running, but it may be blocked or hung.`,
    };
  }

  if (quietMs < 12_000) {
    return {
      tone: 'working',
      headline: pickCouncilPhrase(input.speaker, quietMs, COUNCIL_STREAMING_PHRASES),
      detail: `Last output ${quietLabel} ago.`,
    };
  }

  if (quietMs < COUNCIL_STALL_WARNING_MS) {
    return {
      tone: 'quiet',
      headline: `${input.speaker} went quiet between bursts`,
      detail: `Last output ${quietLabel} ago. ${elapsedLabel} total for this turn.`,
    };
  }

  if (quietMs < COUNCIL_STALL_ERROR_MS) {
    return {
      tone: 'warning',
      headline: `${input.speaker} may be slowing down`,
      detail: `No new output for ${quietLabel}. The turn is still active, but this is slower than normal.`,
    };
  }

  return {
    tone: 'error',
    headline: `Possible stall during ${input.speaker}'s turn`,
    detail: `No new output for ${quietLabel}. Consider stopping if this does not recover.`,
  };
}

function pickCouncilPhrase(speaker: string, elapsedMs: number, phrases: string[]): string {
  const bucket = Math.floor(Math.max(0, elapsedMs) / 3500);
  const seed = `${speaker}:${bucket}`.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return phrases[seed % phrases.length];
}
