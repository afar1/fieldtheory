export interface VoiceInboxNotePresentation {
  notePath: string;
  transcriptId: string;
  /** Synced transcript creation time; legacy filename fallback, or unknown. */
  createdAtMs: number | null;
  /** Only a destination backed by a confirmed dispatch in this account's ledger. */
  threadId?: string;
  title: string;
  wordCount: number;
}

export interface VoiceInboxPresentation {
  folderPath: string | null;
  notes: VoiceInboxNotePresentation[];
  truncated: boolean;
}

export function summarizeVoiceInboxTranscript(text: string): { title: string; wordCount: number } {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  const characters = Array.from(words.join(' '));
  return { title: characters.length > 180 ? `${characters.slice(0, 179).join('').trimEnd()}…`
    : characters.join('') || 'Voice transcript', wordCount: words.length };
}

/** Local time by default; an explicit zone makes tests and previews deterministic. */
export function formatVoiceInboxTime(createdAtMs: number | null, timeZone?: string): string {
  if (createdAtMs === null || !Number.isFinite(new Date(createdAtMs).getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true,
    ...(timeZone ? { timeZone } : {}) }).formatToParts(createdAtMs);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value ?? '';
  return `${part('hour')}:${part('minute')} ${part('dayPeriod') === 'AM' ? 'a.m.' : 'p.m.'}`;
}
