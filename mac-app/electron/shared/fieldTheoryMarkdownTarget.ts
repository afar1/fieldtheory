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

export const BROWSER_LIBRARY_INCLUDED_TARGET_KINDS = [
  'wiki',
  'artifact',
  'command',
  'external',
  'bookmarks',
  'ember',
  'library',
  'commands',
] as const satisfies readonly FieldTheoryMarkdownTargetKind[];

const FIELD_THEORY_MARKDOWN_TARGET_KIND_SET = new Set<string>(FIELD_THEORY_MARKDOWN_TARGET_KINDS);
const FIELD_THEORY_SURFACE_TARGET_KIND_SET = new Set<string>(FIELD_THEORY_SURFACE_TARGET_KINDS);
const BROWSER_LIBRARY_INCLUDED_TARGET_KIND_SET = new Set<string>(BROWSER_LIBRARY_INCLUDED_TARGET_KINDS);

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

export function normalizeBrowserLibraryOpenTarget(target: unknown): FieldTheoryMarkdownTarget | null {
  const normalized = normalizeFieldTheoryMarkdownTarget(target);
  return normalized && BROWSER_LIBRARY_INCLUDED_TARGET_KIND_SET.has(normalized.kind)
    ? normalized
    : null;
}

function parseBrowserLibraryBooleanParam(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return undefined;
}

function parseBrowserLibraryNumberParam(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function browserLibraryTargetFromSearchParams(
  searchParams: URLSearchParams,
  defaultKind?: string,
): FieldTheoryMarkdownTarget | null {
  const rawTarget = searchParams.get('target');
  if (rawTarget) {
    try {
      return normalizeBrowserLibraryOpenTarget(JSON.parse(rawTarget));
    } catch {
      return null;
    }
  }

  const kind = searchParams.get('kind') ?? defaultKind;
  if (!kind) return null;

  const target: Record<string, unknown> = { kind };
  const path = searchParams.get('path') ?? searchParams.get('file');
  const contentMode = searchParams.get('contentMode');
  const sidebarCollapsed = parseBrowserLibraryBooleanParam(searchParams.get('sidebarCollapsed'));
  const focusChrome = parseBrowserLibraryBooleanParam(searchParams.get('focusChrome'));
  const selectionStart = parseBrowserLibraryNumberParam(searchParams.get('selectionStart'));
  const selectionEnd = parseBrowserLibraryNumberParam(searchParams.get('selectionEnd'));

  if (path !== null) target.path = path;
  if (contentMode === 'rendered' || contentMode === 'markdown' || contentMode === 'typedown') {
    target.contentMode = contentMode;
  }
  if (sidebarCollapsed !== undefined) target.sidebarCollapsed = sidebarCollapsed;
  if (focusChrome !== undefined) target.focusChrome = focusChrome;
  if (selectionStart !== undefined) target.selectionStart = selectionStart;
  if (selectionEnd !== undefined) target.selectionEnd = selectionEnd;

  return normalizeBrowserLibraryOpenTarget(target);
}
