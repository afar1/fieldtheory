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

export type MarkdownEditorLinkHit = {
  action: LinkAction;
  start: number;
  end: number;
  displayStart: number;
  displayEnd: number;
  displayText: string;
};

export type MarkdownWikiLinkCompletion = {
  openStart: number;
  queryStart: number;
  queryEnd: number;
  replaceEnd: number;
  query: string;
};

export type MarkdownWikiLinkCompletionEdit = {
  nextValue: string;
  selectionStart: number;
  selectionEnd: number;
};

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

function getTrimmedRange(start: number, raw: string): { start: number; end: number; text: string } {
  const leading = raw.match(/^\s*/)?.[0].length ?? 0;
  const text = raw.trim();
  return {
    start: start + leading,
    end: start + leading + text.length,
    text,
  };
}

function escapeMarkdownLinkText(text: string): string {
  return text.replace(/[\[\]]/g, '\\$&');
}

function getProtectedMarkdownLinkRanges(markdown: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const match of markdown.matchAll(/!?\[[^\]\n]*\]\([^)\n]*\)/g)) {
    const start = match.index ?? -1;
    if (start >= 0) ranges.push({ start, end: start + match[0].length });
  }
  for (const match of markdown.matchAll(/<([a-z][a-z0-9+.-]*:[^<>\s]+)>/gi)) {
    const start = match.index ?? -1;
    if (start >= 0) ranges.push({ start, end: start + match[0].length });
  }
  return ranges.sort((a, b) => a.start - b.start);
}

function transformBareExternalUrls(markdown: string): string {
  const protectedRanges = getProtectedMarkdownLinkRanges(markdown);
  let protectedIndex = 0;
  let cursor = 0;
  let out = '';

  for (const match of markdown.matchAll(/\b(?:https?:\/\/|mailto:)[^\s<>()]+/gi)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    while (protectedIndex < protectedRanges.length && protectedRanges[protectedIndex].end <= start) {
      protectedIndex += 1;
    }
    const protectedRange = protectedRanges[protectedIndex];
    if (protectedRange && start >= protectedRange.start && start < protectedRange.end) {
      continue;
    }

    const href = trimBareHref(match[0]);
    const end = start + href.length;
    out += markdown.slice(cursor, start);
    out += `[${escapeMarkdownLinkText(href)}](${href})`;
    cursor = end;
  }

  return cursor === 0 ? markdown : `${out}${markdown.slice(cursor)}`;
}

export function getMarkdownEditorLinkHits(
  markdown: string,
  index: WikiIndex,
): MarkdownEditorLinkHit[] {
  const hits: MarkdownEditorLinkHit[] = [];

  for (const match of markdown.matchAll(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    const targetStart = start + 2;
    const targetRange = getTrimmedRange(targetStart, match[1]);
    const alias = match[2];
    const displayRange = alias === undefined
      ? targetRange
      : getTrimmedRange(targetStart + match[1].length + 1, alias);
    const displayText = displayRange.text || targetRange.text;
    const displayStart = displayRange.text ? displayRange.start : targetRange.start;
    hits.push({
      action: wikiLinkActionFromTarget(match[1], index),
      start,
      end: start + match[0].length,
      displayStart,
      displayEnd: displayStart + displayText.length,
      displayText,
    });
  }

  for (const match of markdown.matchAll(/!?\[([^\]\n]*)\]\(([^)\n]*)\)/g)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    const href = match[2].trim() || match[1].trim();
    const labelStart = start + (match[0].startsWith('!') ? 2 : 1);
    const labelRange = getTrimmedRange(labelStart, match[1]);
    hits.push({
      action: classifyLinkHref(href, index),
      start,
      end: start + match[0].length,
      displayStart: labelRange.start,
      displayEnd: labelRange.end,
      displayText: labelRange.text,
    });
  }

  for (const match of markdown.matchAll(/<([a-z][a-z0-9+.-]*:[^<>\s]+)>/gi)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    hits.push({
      action: classifyLinkHref(match[1], index),
      start,
      end: start + match[0].length,
      displayStart: start + 1,
      displayEnd: start + 1 + match[1].length,
      displayText: match[1],
    });
  }

  for (const match of markdown.matchAll(/\b(?:[a-z][a-z0-9+.-]*:\/\/|mailto:)[^\s<>()]+/gi)) {
    const start = match.index ?? -1;
    if (start < 0) continue;
    const href = trimBareHref(match[0]);
    hits.push({
      action: classifyLinkHref(href, index),
      start,
      end: start + href.length,
      displayStart: start,
      displayEnd: start + href.length,
      displayText: href,
    });
  }

  return hits.filter((hit) => hit.action.kind !== 'noop');
}

export function getActiveMarkdownWikiLinkCompletion(
  markdown: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownWikiLinkCompletion | null {
  if (selectionStart !== selectionEnd) return null;
  const caret = Math.max(0, Math.min(selectionStart, markdown.length));
  const openStart = markdown.lastIndexOf('[[', caret);
  if (openStart < 0) return null;
  const previousClose = markdown.lastIndexOf(']]', Math.max(0, caret - 1));
  if (previousClose > openStart) return null;

  const queryStart = openStart + 2;
  const closeStart = markdown.indexOf(']]', caret);
  const nextNewline = markdown.indexOf('\n', queryStart);
  const replaceEnd = closeStart >= 0 && (nextNewline < 0 || closeStart < nextNewline)
    ? closeStart
    : caret;
  const textBeforeCaret = markdown.slice(queryStart, caret);
  const textToReplace = markdown.slice(queryStart, replaceEnd);
  if (textBeforeCaret.includes('\n') || textToReplace.includes('\n')) return null;
  if (textBeforeCaret.includes(']') || textToReplace.includes(']')) return null;
  if (textBeforeCaret.includes('|') || textToReplace.includes('|')) return null;

  return {
    openStart,
    queryStart,
    queryEnd: caret,
    replaceEnd,
    query: textBeforeCaret,
  };
}

export function getMarkdownWikiLinkCompletionReplacement(
  markdown: string,
  completion: MarkdownWikiLinkCompletion,
  title: string,
): MarkdownWikiLinkCompletionEdit | null {
  const cleanTitle = title.trim();
  if (!cleanTitle) return null;
  const hasClosingBrackets = markdown.slice(completion.replaceEnd, completion.replaceEnd + 2) === ']]';
  const insertedClose = hasClosingBrackets ? '' : ']]';
  const nextValue = `${markdown.slice(0, completion.queryStart)}${cleanTitle}${insertedClose}${markdown.slice(completion.replaceEnd)}`;
  const selection = completion.queryStart + cleanTitle.length + 2;
  return {
    nextValue,
    selectionStart: selection,
    selectionEnd: selection,
  };
}

export function getMarkdownWikiLinkAutoCloseEdit(
  markdown: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownWikiLinkCompletionEdit | null {
  if (selectionStart !== selectionEnd) return null;
  const caret = Math.max(0, Math.min(selectionStart, markdown.length));
  if (caret < 2 || markdown.slice(caret - 2, caret) !== '[[') return null;
  if (markdown[caret - 3] === '[') return null;
  if (markdown.slice(caret, caret + 2) === ']]') return null;

  const nextValue = `${markdown.slice(0, caret)}]]${markdown.slice(caret)}`;
  return {
    nextValue,
    selectionStart: caret,
    selectionEnd: caret,
  };
}

// Returns the same navigation action a rendered link would use, but for the
// markdown token under a textarea caret. This powers Command-click in edit mode.
export function getMarkdownEditorLinkActionAtOffset(
  markdown: string,
  offset: number,
  index: WikiIndex,
): LinkAction {
  const caret = Math.max(0, Math.min(offset, markdown.length));
  for (const hit of getMarkdownEditorLinkHits(markdown, index)) {
    if (offsetInMatch(caret, hit.start, markdown.slice(hit.start, hit.end))) {
      return hit.action;
    }
  }

  return { kind: 'noop' };
}

// Rewrites [[target]] and [[target|alias]] into standard markdown links so
// ReactMarkdown renders them through the existing `a` component. Also wraps
// bare external URLs in standard markdown links. Skips content inside fenced
// code blocks and inline code so literal examples survive.
export function transformWikiLinks(body: string, index: WikiIndex): string {
  const parts = body.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      const withWikiLinks = part.replace(
        /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g,
        (_m, rawTarget: string, rawAlias?: string) => {
          const target = rawTarget.trim();
          if (!target) return _m;
          const display = (rawAlias ?? target).trim() || target;
          const escapedDisplay = escapeMarkdownLinkText(display);
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
      return transformBareExternalUrls(withWikiLinks);
    })
    .join('');
}
