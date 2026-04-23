// Obsidian-style [[wikilinks]] — pure helpers that resolve a target string to
// a wiki relPath and rewrite the body before it reaches ReactMarkdown. Unresolved
// targets get a sentinel href (wiki://!/<title>) so the renderer can style them
// differently and create the page on click.

export type WikiIndex = {
  byTitle: Map<string, WikiLinkTarget>;
  byRelPath: Set<string>;
};

export type WikiIndexInput = {
  relPath: string;
  title: string;
  artifactPath?: string;
  commandPath?: string;
};

export type WikiLinkTarget =
  | { kind: 'wiki'; relPath: string }
  | { kind: 'artifact'; path: string }
  | { kind: 'command'; path: string };

/** Canonical form for a wiki relPath: trimmed, no leading slashes, no .md
 *  extension. Every caller that persists or compares a relPath should route
 *  through this so index lookups, URL sentinels, and selection state agree. */
export function normalizeWikiRelPath(input: string): string {
  return input.trim().replace(/^\/+/, '').replace(/\.md$/i, '');
}

export function buildWikiIndex(pages: WikiIndexInput[]): WikiIndex {
  const byTitle = new Map<string, WikiLinkTarget>();
  const byRelPath = new Set<string>();
  for (const page of pages) {
    if (!page.artifactPath && !page.commandPath) byRelPath.add(page.relPath);
    const key = page.title.trim().toLowerCase();
    if (key && !byTitle.has(key)) {
      byTitle.set(key, page.artifactPath
        ? { kind: 'artifact', path: page.artifactPath }
        : page.commandPath
          ? { kind: 'command', path: page.commandPath }
          : { kind: 'wiki', relPath: page.relPath });
    }
  }
  return { byTitle, byRelPath };
}

export function resolveWikiLink(
  target: string,
  index: WikiIndex,
): { relPath: string | null; artifactPath: string | null; commandPath: string | null } {
  const clean = target.trim();
  if (!clean) return { relPath: null, artifactPath: null, commandPath: null };
  const relKey = normalizeWikiRelPath(clean);
  if (relKey && index.byRelPath.has(relKey)) return { relPath: relKey, artifactPath: null, commandPath: null };
  const hit = index.byTitle.get(clean.toLowerCase());
  if (hit?.kind === 'wiki') return { relPath: hit.relPath, artifactPath: null, commandPath: null };
  if (hit?.kind === 'artifact') return { relPath: null, artifactPath: hit.path, commandPath: null };
  if (hit?.kind === 'command') return { relPath: null, artifactPath: null, commandPath: hit.path };
  return { relPath: null, artifactPath: null, commandPath: null };
}

const UNRESOLVED_PREFIX = 'wiki://!/';
const RESOLVED_PREFIX = 'wiki://';
const ARTIFACT_PREFIX = 'artifact://';
const COMMAND_PREFIX = 'command://';

export function isUnresolvedWikiHref(href: string | undefined): boolean {
  return !!href && href.startsWith(UNRESOLVED_PREFIX);
}

export function decodeUnresolvedWikiHref(href: string): string {
  return decodeURIComponent(href.slice(UNRESOLVED_PREFIX.length));
}

export type LinkAction =
  | { kind: 'create'; title: string }
  | { kind: 'wiki'; relPath: string }
  | { kind: 'artifact'; path: string }
  | { kind: 'command'; path: string }
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
  if (href.startsWith(ARTIFACT_PREFIX)) {
    const match = href.match(/^artifact:\/\/(.+)$/i);
    const path = match
      ? decodeURIComponent(match[1].split(/[?#]/, 1)[0] ?? '')
      : '';
    return path ? { kind: 'artifact', path } : { kind: 'noop' };
  }
  if (href.startsWith(COMMAND_PREFIX)) {
    const match = href.match(/^command:\/\/(.+)$/i);
    const path = match
      ? decodeURIComponent(match[1].split(/[?#]/, 1)[0] ?? '')
      : '';
    return path ? { kind: 'command', path } : { kind: 'noop' };
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
    const { relPath, artifactPath, commandPath } = resolveWikiLink(href, index);
    if (relPath) return { kind: 'wiki', relPath };
    if (artifactPath) return { kind: 'artifact', path: artifactPath };
    if (commandPath) return { kind: 'command', path: commandPath };
  }
  return { kind: 'external', href };
}

function offsetInMatch(offset: number, start: number, text: string): boolean {
  return offset >= start && offset <= start + text.length;
}

function wikiLinkActionFromTarget(target: string, index: WikiIndex): LinkAction {
  const clean = target.trim();
  if (!clean) return { kind: 'noop' };
  const { relPath, artifactPath, commandPath } = resolveWikiLink(clean, index);
  if (relPath) return { kind: 'wiki', relPath };
  if (artifactPath) return { kind: 'artifact', path: artifactPath };
  if (commandPath) return { kind: 'command', path: commandPath };
  return { kind: 'create', title: clean };
}

function trimBareHref(href: string): string {
  return href.replace(/[.,;:!?]+$/g, '');
}

// Returns the same navigation action a rendered link would use, but for the
// markdown token under a textarea caret. This powers Command-click in edit mode.
export function getMarkdownEditorLinkActionAtOffset(
  markdown: string,
  offset: number,
  index: WikiIndex,
): LinkAction {
  const caret = Math.max(0, Math.min(offset, markdown.length));

  for (const match of markdown.matchAll(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g)) {
    const start = match.index ?? -1;
    if (start < 0 || !offsetInMatch(caret, start, match[0])) continue;
    return wikiLinkActionFromTarget(match[1], index);
  }

  for (const match of markdown.matchAll(/!?\[([^\]\n]*)\]\(([^)\n]*)\)/g)) {
    const start = match.index ?? -1;
    if (start < 0 || !offsetInMatch(caret, start, match[0])) continue;
    const href = match[2].trim() || match[1].trim();
    return classifyLinkHref(href, index);
  }

  for (const match of markdown.matchAll(/<([a-z][a-z0-9+.-]*:[^<>\s]+)>/gi)) {
    const start = match.index ?? -1;
    if (start < 0 || !offsetInMatch(caret, start, match[0])) continue;
    return classifyLinkHref(match[1], index);
  }

  for (const match of markdown.matchAll(/\b(?:[a-z][a-z0-9+.-]*:\/\/|mailto:)[^\s<>()]+/gi)) {
    const start = match.index ?? -1;
    if (start < 0 || !offsetInMatch(caret, start, match[0])) continue;
    return classifyLinkHref(trimBareHref(match[0]), index);
  }

  return { kind: 'noop' };
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
          const { relPath, artifactPath, commandPath } = resolveWikiLink(target, index);
          const href = relPath
            ? `${RESOLVED_PREFIX}${encodeURI(relPath)}`
            : artifactPath
              ? `${ARTIFACT_PREFIX}${encodeURIComponent(artifactPath)}`
              : commandPath
                ? `${COMMAND_PREFIX}${encodeURIComponent(commandPath)}`
                : `${UNRESOLVED_PREFIX}${encodeURIComponent(target)}`;
          return `[${escapedDisplay}](${href})`;
        },
      );
    })
    .join('');
}
