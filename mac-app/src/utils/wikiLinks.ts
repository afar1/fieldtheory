// Obsidian-style [[wikilinks]] — pure helpers that resolve a target string to
// a wiki relPath and rewrite the body before it reaches ReactMarkdown. Unresolved
// targets get a sentinel href (wiki://!/<title>) so the renderer can style them
// differently and create the page on click.

export type WikiIndex = {
  byTitle: Map<string, string>;
  byRelPath: Set<string>;
};

export type WikiIndexInput = {
  relPath: string;
  title: string;
};

/** Canonical form for a wiki relPath: trimmed, no leading slashes, no .md
 *  extension. Every caller that persists or compares a relPath should route
 *  through this so index lookups, URL sentinels, and selection state agree. */
export function normalizeWikiRelPath(input: string): string {
  return input.trim().replace(/^\/+/, '').replace(/\.md$/i, '');
}

export function buildWikiIndex(pages: WikiIndexInput[]): WikiIndex {
  const byTitle = new Map<string, string>();
  const byRelPath = new Set<string>();
  for (const page of pages) {
    byRelPath.add(page.relPath);
    const key = page.title.trim().toLowerCase();
    if (key && !byTitle.has(key)) byTitle.set(key, page.relPath);
  }
  return { byTitle, byRelPath };
}

export function resolveWikiLink(
  target: string,
  index: WikiIndex,
): { relPath: string | null } {
  const clean = target.trim();
  if (!clean) return { relPath: null };
  const relKey = normalizeWikiRelPath(clean);
  if (relKey && index.byRelPath.has(relKey)) return { relPath: relKey };
  const hit = index.byTitle.get(clean.toLowerCase());
  if (hit) return { relPath: hit };
  return { relPath: null };
}

const UNRESOLVED_PREFIX = 'wiki://!/';
const RESOLVED_PREFIX = 'wiki://';

export function isUnresolvedWikiHref(href: string | undefined): boolean {
  return !!href && href.startsWith(UNRESOLVED_PREFIX);
}

export function decodeUnresolvedWikiHref(href: string): string {
  return decodeURIComponent(href.slice(UNRESOLVED_PREFIX.length));
}

export type LinkAction =
  | { kind: 'create'; title: string }
  | { kind: 'wiki'; relPath: string }
  | { kind: 'external'; href: string }
  | { kind: 'noop' };

// Decides what clicking a rendered <a> should do. Extracted from the renderer
// so the branching — unresolved sentinel, resolved wiki://, bare relPath that
// matches the index, everything else — is testable without React.
export function classifyLinkHref(
  href: string | undefined,
  index: WikiIndex,
): LinkAction {
  if (!href) return { kind: 'noop' };
  if (isUnresolvedWikiHref(href)) {
    return { kind: 'create', title: decodeUnresolvedWikiHref(href) };
  }
  if (href.startsWith(RESOLVED_PREFIX)) {
    const match = href.match(/^wiki:\/\/(.+)$/i);
    const relPath = match
      ? decodeURIComponent(match[1].split(/[?#]/, 1)[0] ?? '')
      : '';
    return relPath ? { kind: 'wiki', relPath } : { kind: 'noop' };
  }
  // Bare relative-looking hrefs — no protocol, no leading /, #, ? — may be
  // plain markdown links that reference wiki pages by relPath. Try the index
  // before handing off to the browser.
  const looksRelative =
    !/^[a-z][a-z0-9+.-]*:/i.test(href) &&
    !href.startsWith('/') &&
    !href.startsWith('#') &&
    !href.startsWith('?');
  if (looksRelative) {
    const { relPath } = resolveWikiLink(href, index);
    if (relPath) return { kind: 'wiki', relPath };
  }
  return { kind: 'external', href };
}

// Rewrites [[target]] and [[target|alias]] into standard markdown links so
// ReactMarkdown renders them through the existing `a` component. Skips content
// inside fenced code blocks and inline code so literal examples survive.
export function transformWikiLinks(body: string, index: WikiIndex): string {
  const parts = body.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part.replace(
        /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g,
        (_m, rawTarget: string, rawAlias?: string) => {
          const target = rawTarget.trim();
          if (!target) return _m;
          const display = (rawAlias ?? target).trim() || target;
          const escapedDisplay = display.replace(/[\[\]]/g, '\\$&');
          const { relPath } = resolveWikiLink(target, index);
          const href = relPath
            ? `${RESOLVED_PREFIX}${encodeURI(relPath)}`
            : `${UNRESOLVED_PREFIX}${encodeURIComponent(target)}`;
          return `[${escapedDisplay}](${href})`;
        },
      );
    })
    .join('');
}
