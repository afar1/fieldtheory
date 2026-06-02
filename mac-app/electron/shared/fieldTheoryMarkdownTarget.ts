export type FieldTheoryMarkdownTargetKind =
  | 'wiki'
  | 'artifact'
  | 'command'
  | 'external'
  | 'bookmarks'
  | 'ember'
  | 'library'
  | 'commands'
  | 'clipboard';

export type FieldTheoryMarkdownTarget = Record<string, unknown> & {
  kind: FieldTheoryMarkdownTargetKind;
  path: string;
};

export const FIELD_THEORY_MARKDOWN_TARGET_KINDS = [
  'wiki',
  'artifact',
  'command',
  'external',
  'bookmarks',
  'ember',
  'library',
  'commands',
  'clipboard',
] as const;

export const FIELD_THEORY_SURFACE_TARGET_KINDS = [
  'bookmarks',
  'ember',
  'library',
  'commands',
  'clipboard',
] as const;

const FIELD_THEORY_MARKDOWN_TARGET_KIND_SET = new Set<string>(FIELD_THEORY_MARKDOWN_TARGET_KINDS);
const FIELD_THEORY_SURFACE_TARGET_KIND_SET = new Set<string>(FIELD_THEORY_SURFACE_TARGET_KINDS);

export function isFieldTheoryMarkdownTargetKind(value: unknown): value is FieldTheoryMarkdownTargetKind {
  return typeof value === 'string' && FIELD_THEORY_MARKDOWN_TARGET_KIND_SET.has(value);
}

export function isFieldTheorySurfaceTargetKind(value: unknown): boolean {
  return typeof value === 'string' && FIELD_THEORY_SURFACE_TARGET_KIND_SET.has(value);
}

export function normalizeFieldTheoryMarkdownTarget(target: unknown): FieldTheoryMarkdownTarget | null {
  if (!target || typeof target !== 'object') return null;
  const rawTarget = target as Record<string, unknown>;
  const kind = rawTarget.kind;
  if (!isFieldTheoryMarkdownTargetKind(kind)) return null;

  const rawPath = rawTarget.path;
  const path = typeof rawPath === 'string' && rawPath.trim().length > 0
    ? rawPath
    : isFieldTheorySurfaceTargetKind(kind)
      ? kind
      : null;

  if (!path) return null;
  return { ...rawTarget, kind, path };
}
