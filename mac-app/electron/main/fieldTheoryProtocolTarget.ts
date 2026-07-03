import {
  browserLibraryTargetFromSearchParams,
  type FieldTheoryMarkdownTarget,
} from '../shared/fieldTheoryMarkdownTarget';

export function browserLibraryTargetFromProtocolUrl(parsed: URL): FieldTheoryMarkdownTarget | null {
  if (parsed.protocol !== 'fieldtheory:') return null;

  if (parsed.host === 'browser-library' && parsed.pathname === '/open') {
    return browserLibraryTargetFromSearchParams(parsed.searchParams);
  }

  if (
    (parsed.host === 'library' ||
      parsed.host === 'commands' ||
      parsed.host === 'bookmarks' ||
      parsed.host === 'ember') &&
    (parsed.pathname === '' || parsed.pathname === '/' || parsed.pathname === '/open')
  ) {
    return browserLibraryTargetFromSearchParams(parsed.searchParams, parsed.host);
  }

  return null;
}
