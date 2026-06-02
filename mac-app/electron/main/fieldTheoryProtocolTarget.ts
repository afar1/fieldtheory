import {
  normalizeFieldTheoryMarkdownTarget,
  type FieldTheoryMarkdownTarget,
} from '../shared/fieldTheoryMarkdownTarget';

const BROWSER_LIBRARY_PROTOCOL_TARGET_KINDS = new Set([
  'wiki',
  'artifact',
  'command',
  'external',
  'bookmarks',
  'ember',
  'library',
  'commands',
]);

function normalizeBrowserLibraryProtocolTarget(target: unknown): FieldTheoryMarkdownTarget | null {
  const normalized = normalizeFieldTheoryMarkdownTarget(target);
  return normalized && BROWSER_LIBRARY_PROTOCOL_TARGET_KINDS.has(normalized.kind)
    ? normalized
    : null;
}

function parseBooleanParam(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return undefined;
}

function parseNumberParam(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function targetFromSearchParams(searchParams: URLSearchParams, defaultKind?: string): FieldTheoryMarkdownTarget | null {
  const rawTarget = searchParams.get('target');
  if (rawTarget) {
    try {
      return normalizeBrowserLibraryProtocolTarget(JSON.parse(rawTarget));
    } catch {
      return null;
    }
  }

  const kind = searchParams.get('kind') ?? defaultKind;
  if (!kind) return null;

  const target: Record<string, unknown> = { kind };
  const path = searchParams.get('path') ?? searchParams.get('file');
  const contentMode = searchParams.get('contentMode');
  const sidebarCollapsed = parseBooleanParam(searchParams.get('sidebarCollapsed'));
  const focusChrome = parseBooleanParam(searchParams.get('focusChrome'));
  const selectionStart = parseNumberParam(searchParams.get('selectionStart'));
  const selectionEnd = parseNumberParam(searchParams.get('selectionEnd'));

  if (path !== null) target.path = path;
  if (contentMode === 'rendered' || contentMode === 'markdown' || contentMode === 'typedown') target.contentMode = contentMode;
  if (sidebarCollapsed !== undefined) target.sidebarCollapsed = sidebarCollapsed;
  if (focusChrome !== undefined) target.focusChrome = focusChrome;
  if (selectionStart !== undefined) target.selectionStart = selectionStart;
  if (selectionEnd !== undefined) target.selectionEnd = selectionEnd;

  return normalizeBrowserLibraryProtocolTarget(target);
}

export function browserLibraryTargetFromProtocolUrl(parsed: URL): FieldTheoryMarkdownTarget | null {
  if (parsed.protocol !== 'fieldtheory:') return null;

  if (parsed.host === 'browser-library' && parsed.pathname === '/open') {
    return targetFromSearchParams(parsed.searchParams);
  }

  if (
    (parsed.host === 'library' ||
      parsed.host === 'commands' ||
      parsed.host === 'bookmarks' ||
      parsed.host === 'ember') &&
    (parsed.pathname === '' || parsed.pathname === '/' || parsed.pathname === '/open')
  ) {
    return targetFromSearchParams(parsed.searchParams, parsed.host);
  }

  return null;
}
