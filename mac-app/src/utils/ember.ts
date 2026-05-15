import { parseMarkdownFrontmatter } from '../../electron/shared/markdownFrontmatter';

export const EMBER_FOLDER_NAME = 'Ember';
export const EMBER_VISIBLE_PERSON_LIMIT = 7;

export type EmberTimingPreset = '1w' | '2w' | '90d' | '60d' | '1m' | '6m' | 'random';

export const EMBER_TIMING_PRESETS: Array<{ id: EmberTimingPreset; label: string }> = [
  { id: '1w', label: '1 week' },
  { id: '2w', label: '2 weeks' },
  { id: '90d', label: '90 days' },
  { id: '60d', label: '60 days' },
  { id: '1m', label: '1 month' },
  { id: '6m', label: '6 months' },
  { id: 'random', label: 'Random' },
];

export interface EmberPerson {
  relPath: string;
  absPath: string;
  title: string;
  content: string;
  nextAt: number;
  lastResetAt: number | null;
  frequency: string | null;
  urgencyProgress: number;
  due: boolean;
  daysUntil: number;
  opacity: number;
  documentVersion: DocumentVersion;
}

function parseDateMs(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function emberDelayDaysForPreset(
  preset: EmberTimingPreset,
  random: () => number = Math.random,
): number {
  if (preset === '1w') return 7;
  if (preset === '2w') return 14;
  if (preset === '90d') return 90;
  if (preset === '60d') return 60;
  if (preset === '1m') return 30;
  if (preset === '6m') return 180;
  return 30 + Math.floor(Math.max(0, Math.min(0.999999, random())) * 151);
}

export function isEmberTimingPreset(value: string | null | undefined): value is EmberTimingPreset {
  return value === '1w'
    || value === '2w'
    || value === '90d'
    || value === '60d'
    || value === '1m'
    || value === '6m'
    || value === 'random';
}

export function emberUrgencyProgress(lastResetAt: number | null, nextAt: number, nowMs: number): number {
  if (nextAt <= nowMs) return 1;
  if (lastResetAt === null) return 0;
  if (nextAt <= lastResetAt) return 1;
  return Math.max(0, Math.min(1, (nowMs - lastResetAt) / (nextAt - lastResetAt)));
}

export function buildEmberFrontmatterUpdate(
  content: string,
  preset: EmberTimingPreset,
  nowMs: number = Date.now(),
  random: () => number = Math.random,
): string {
  const parsed = parseMarkdownFrontmatter(content);
  const body = parsed.raw === null ? content : parsed.body;
  const retainedLines = parsed.raw?.trim()
    ? parsed.lines.filter((line) => !/^\s*ember(_kind|_frequency|_next_at|_last_reset_at)?\s*:/i.test(line))
    : [];
  const delayDays = emberDelayDaysForPreset(preset, random);
  const nextAt = nowMs + delayDays * 24 * 60 * 60 * 1000;
  const nextLines = [
    ...retainedLines,
    ...(retainedLines.length > 0 ? [''] : []),
    'ember: true',
    'ember_kind: person',
    `ember_frequency: ${preset}`,
    `ember_last_reset_at: ${isoDate(nowMs)}`,
    `ember_next_at: ${isoDate(nextAt)}`,
  ];
  return `---\n${nextLines.join('\n')}\n---\n\n${body}`;
}

export function createEmberPersonContent(title: string, nowMs: number = Date.now()): string {
  const today = isoDate(nowMs);
  return [
    '---',
    'ember: true',
    'ember_kind: person',
    `ember_last_reset_at: ${today}`,
    `ember_next_at: ${today}`,
    '---',
    '',
    `# ${title.trim() || 'New person'}`,
    '',
  ].join('\n');
}

export function emberPersonFromPage(page: WikiPage, nowMs: number = Date.now(), index = 0): EmberPerson {
  const parsed = parseMarkdownFrontmatter(page.content);
  const nextAt = parseDateMs(parsed.meta.ember_next_at) ?? nowMs;
  const lastResetAt = parseDateMs(parsed.meta.ember_last_reset_at);
  const urgencyProgress = emberUrgencyProgress(lastResetAt, nextAt, nowMs);
  const msUntil = nextAt - nowMs;
  const daysUntil = Math.ceil(msUntil / (24 * 60 * 60 * 1000));
  return {
    relPath: page.relPath,
    absPath: page.absPath,
    title: page.title,
    content: page.content,
    nextAt,
    lastResetAt,
    frequency: parsed.meta.ember_frequency ?? null,
    urgencyProgress,
    due: nextAt <= nowMs,
    daysUntil,
    opacity: emberOpacityForProgress(urgencyProgress, index),
    documentVersion: page.documentVersion,
  };
}

export function sortEmberPeople(people: EmberPerson[]): EmberPerson[] {
  return [...people].sort((a, b) => {
    const byProgress = b.urgencyProgress - a.urgencyProgress;
    if (byProgress !== 0) return byProgress;
    const byNextAt = a.nextAt - b.nextAt;
    if (byNextAt !== 0) return byNextAt;
    return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  }).map((person, index) => ({
    ...person,
    opacity: emberOpacityForProgress(person.urgencyProgress, index),
  }));
}

export function emberOpacityForProgress(progress: number, index: number): number {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  if (clampedProgress >= 1 && index === 0) return 1;
  return Math.max(0.28, Math.min(0.99, 0.28 + clampedProgress * 0.71 - index * 0.01));
}
