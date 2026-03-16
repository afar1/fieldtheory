export const DEFAULT_COUNCIL_MATCHUP: CouncilMatchup = 'opus-vs-codex';
export const DEFAULT_COUNCIL_MAX_TURNS = 6;
export const MIN_COUNCIL_MAX_TURNS = 0;
export const MAX_COUNCIL_MAX_TURNS = 20;

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
