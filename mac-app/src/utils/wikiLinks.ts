// Obsidian-style [[wikilinks]] — pure helpers that resolve a target string to
// a wiki relPath and rewrite the body before it reaches ReactMarkdown. Unresolved
// targets get a sentinel href (wiki://!/<title>) so the renderer can style them
// differently and create the page on click.

export type WikiIndex = {
  byTitle: Map<string, WikiLinkTarget>;
  byRelPath: Set<string>;
  byFilePath?: Map<string, MarkdownWikiLinkPasteTarget>;
};

export type WikiIndexInput = {
  relPath: string;
  title: string;
  absPath?: string;
  artifactPath?: string;
  commandPath?: string;
};

export type WikiLinkTarget =
  | { kind: 'wiki'; relPath: string }
  | { kind: 'artifact'; path: string }
  | { kind: 'command'; path: string }
  | { kind: 'bookmarks' };

export type MarkdownWikiLinkPasteTarget = {
  title: string;
};

/** Canonical form for a wiki relPath: trimmed, no leading slashes, no .md
 *  extension. Every caller that persists or compares a relPath should route
 *  through this so index lookups, URL sentinels, and selection state agree. */
export function normalizeWikiRelPath(input: string): string {
  return input.trim().replace(/^\/+/, '').replace(/\.md$/i, '');
}

function stripPastedFilePathWrapper(input: string): string {
  let clean = input.trim();
  while (clean.length >= 2) {
    const first = clean[0];
    const last = clean[clean.length - 1];
    if ((first === '<' && last === '>')
      || (first === '"' && last === '"')
      || (first === "'" && last === "'")
      || (first === '`' && last === '`')) {
      clean = clean.slice(1, -1).trim();
      continue;
    }
    break;
  }
  return clean;
}

function fileUrlToPath(input: string): string | null {
  if (!/^file:\/\//i.test(input)) return null;
  try {
    const url = new URL(input);
    if (url.protocol !== 'file:') return null;
    return decodeURIComponent(url.pathname);
  } catch {
    return input.replace(/^file:\/\//i, '');
  }
}

function normalizeWikiFilePathKey(input: string): string {
  const clean = stripPastedFilePathWrapper(input);
  if (!clean) return '';
  const filePath = fileUrlToPath(clean) ?? clean;
  try {
    return decodeURIComponent(filePath).replace(/\/+$/g, '');
  } catch {
    return filePath.replace(/\/+$/g, '');
  }
}

function addWikiFilePathTarget(
  byFilePath: Map<string, MarkdownWikiLinkPasteTarget>,
  path: string | undefined,
  title: string,
): void {
  if (!path || !title.trim()) return;
  const key = normalizeWikiFilePathKey(path);
  if (key && !byFilePath.has(key)) byFilePath.set(key, { title: title.trim() });
}

function addWikiTitleTarget(
  byTitle: Map<string, WikiLinkTarget>,
  title: string | undefined,
  target: WikiLinkTarget,
): void {
  const key = title?.trim().toLowerCase();
  if (key && !byTitle.has(key)) byTitle.set(key, target);
}

function wikiRelPathBasename(relPath: string): string {
  const normalized = normalizeWikiRelPath(relPath);
  return normalized.split('/').pop()?.trim() ?? '';
}

export function buildWikiIndex(pages: WikiIndexInput[]): WikiIndex {
  const byTitle = new Map<string, WikiLinkTarget>();
  const byRelPath = new Set<string>();
  const byFilePath = new Map<string, MarkdownWikiLinkPasteTarget>();
  for (const page of pages) {
    const isWikiPage = !page.artifactPath && !page.commandPath;
    if (isWikiPage) byRelPath.add(page.relPath);
    const target: WikiLinkTarget = page.artifactPath
      ? { kind: 'artifact', path: page.artifactPath }
      : page.commandPath
        ? { kind: 'command', path: page.commandPath }
        : { kind: 'wiki', relPath: page.relPath };
    addWikiTitleTarget(byTitle, page.title, target);
    if (isWikiPage) addWikiTitleTarget(byTitle, wikiRelPathBasename(page.relPath), target);
    addWikiFilePathTarget(byFilePath, page.absPath, page.title);
    addWikiFilePathTarget(byFilePath, page.artifactPath, page.title);
    addWikiFilePathTarget(byFilePath, page.commandPath, page.title);
    addWikiFilePathTarget(byFilePath, page.relPath, page.title);
    if (!page.relPath.endsWith('.md')) addWikiFilePathTarget(byFilePath, `${page.relPath}.md`, page.title);
  }
  return { byTitle, byRelPath, byFilePath };
}

export function resolveWikiLink(
  target: string,
  index: WikiIndex,
): { relPath: string | null; artifactPath: string | null; commandPath: string | null; bookmarks: boolean } {
  const clean = target.trim();
  if (!clean) return { relPath: null, artifactPath: null, commandPath: null, bookmarks: false };
  const relKey = normalizeWikiRelPath(clean);
  if (relKey.toLowerCase() === 'bookmarks') return { relPath: null, artifactPath: null, commandPath: null, bookmarks: true };
  if (relKey.startsWith('.meetings/')) return { relPath: relKey, artifactPath: null, commandPath: null, bookmarks: false };
  if (relKey && index.byRelPath.has(relKey)) return { relPath: relKey, artifactPath: null, commandPath: null, bookmarks: false };
  const hit = index.byTitle.get(clean.toLowerCase());
  if (hit?.kind === 'wiki') return { relPath: hit.relPath, artifactPath: null, commandPath: null, bookmarks: false };
  if (hit?.kind === 'artifact') return { relPath: null, artifactPath: hit.path, commandPath: null, bookmarks: false };
  if (hit?.kind === 'command') return { relPath: null, artifactPath: null, commandPath: hit.path, bookmarks: false };
  if (hit?.kind === 'bookmarks') return { relPath: null, artifactPath: null, commandPath: null, bookmarks: true };
  return { relPath: null, artifactPath: null, commandPath: null, bookmarks: false };
}

function getPastedFilePathCandidates(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  return lines.length > 1 ? lines : [trimmed];
}

function formatPastedWikiLinkTitle(title: string): string | null {
  const clean = title.trim();
  if (!clean || /[\r\n\[\]]/.test(clean)) return null;
  return `[[${clean}]]`;
}

export function getMarkdownWikiLinkPasteText(
  pastedText: string,
  index: WikiIndex,
): string | null {
  const byFilePath = index.byFilePath;
  if (!byFilePath) return null;

  const links: string[] = [];
  for (const candidate of getPastedFilePathCandidates(pastedText)) {
    const target = byFilePath.get(normalizeWikiFilePathKey(candidate));
    if (!target) return null;
    const link = formatPastedWikiLinkTitle(target.title);
    if (!link) return null;
    links.push(link);
  }

  return links.length > 0 ? links.join('\n') : null;
}

const UNRESOLVED_PREFIX = 'wiki://!/';
const RESOLVED_PREFIX = 'wiki://';
const ARTIFACT_PREFIX = 'artifact://';
const COMMAND_PREFIX = 'command://';
const BOOKMARKS_PREFIX = 'bookmarks://';

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
  | { kind: 'bookmarks' }
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

export type MarkdownWikiLinkCompletionDeleteKey = 'Backspace' | 'Delete';

export type WikiBacklinkInput = {
  relPath: string;
  title: string;
  content: string;
};

export type MarkdownLinkRelationDocument = {
  target: WikiLinkTarget;
  title: string;
  content: string;
  linkHits?: MarkdownEditorLinkHit[];
};

export type WikiBacklink = {
  relPath: string;
  title: string;
  excerpt: string;
};

export type MarkdownBacklink = {
  target: WikiLinkTarget;
  title: string;
  excerpt: string;
};

export type WikiOutboundLink = {
  relPath: string;
  title: string;
  excerpt: string;
};

export type MarkdownOutboundLink = MarkdownBacklink;

export type WikiLinkedPage = {
  relPath: string;
  title: string;
  excerpt: string;
  direction: 'outbound' | 'inbound' | 'bidirectional';
};

export type MarkdownLinkedDocument = {
  target: WikiLinkTarget;
  title: string;
  excerpt: string;
  direction: 'outbound' | 'inbound' | 'bidirectional';
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
  if (href.startsWith(BOOKMARKS_PREFIX)) return { kind: 'bookmarks' };
  // Bare relative-looking hrefs — no protocol, no leading /, #, ? — may be
  // plain markdown links that reference wiki pages by relPath. Try the index
  // before handing off to the browser.
  const looksRelative =
    !/^[a-z][a-z0-9+.-]*:/i.test(href) &&
    !href.startsWith('/') &&
    !href.startsWith('#') &&
    !href.startsWith('?');
  if (looksRelative) {
    const { relPath, artifactPath, commandPath, bookmarks } = resolveWikiLink(href, index);
    if (relPath) return { kind: 'wiki', relPath };
    if (artifactPath) return { kind: 'artifact', path: artifactPath };
    if (commandPath) return { kind: 'command', path: commandPath };
    if (bookmarks) return { kind: 'bookmarks' };
  }
  return { kind: 'external', href };
}

function offsetInMatch(offset: number, start: number, text: string): boolean {
  return offset >= start && offset <= start + text.length;
}

function wikiLinkActionFromTarget(target: string, index: WikiIndex): LinkAction {
  const clean = target.trim();
  if (!clean) return { kind: 'noop' };
  const { relPath, artifactPath, commandPath, bookmarks } = resolveWikiLink(clean, index);
  if (relPath) return { kind: 'wiki', relPath };
  if (artifactPath) return { kind: 'artifact', path: artifactPath };
  if (commandPath) return { kind: 'command', path: commandPath };
  if (bookmarks) return { kind: 'bookmarks' };
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

function getMarkdownLinkRelationDocumentHits(
  document: MarkdownLinkRelationDocument,
  index: WikiIndex,
): MarkdownEditorLinkHit[] {
  return document.linkHits ?? getMarkdownEditorLinkHits(document.content, index);
}

function getLineExcerptAtOffset(markdown: string, offset: number): string {
  const safeOffset = Math.max(0, Math.min(offset, markdown.length));
  const lineStart = markdown.lastIndexOf('\n', Math.max(0, safeOffset - 1)) + 1;
  const lineEndIndex = markdown.indexOf('\n', safeOffset);
  const lineEnd = lineEndIndex === -1 ? markdown.length : lineEndIndex;
  return markdown.slice(lineStart, lineEnd).trim();
}

export function getWikiLinkTargetKey(target: WikiLinkTarget): string {
  switch (target.kind) {
    case 'wiki':
      return `wiki:${normalizeWikiRelPath(target.relPath)}`;
    case 'artifact':
      return `artifact:${target.path}`;
    case 'command':
      return `command:${target.path}`;
    case 'bookmarks':
      return 'bookmarks:root';
  }
}

export function refreshMarkdownLinkRelationDocumentHits(
  documents: MarkdownLinkRelationDocument[],
  index: WikiIndex,
): MarkdownLinkRelationDocument[] {
  return documents.map((document) => ({
    ...document,
    linkHits: getMarkdownEditorLinkHits(document.content, index),
  }));
}

export function upsertMarkdownLinkRelationDocument(
  documents: MarkdownLinkRelationDocument[],
  document: MarkdownLinkRelationDocument,
): MarkdownLinkRelationDocument[] {
  const targetKey = getWikiLinkTargetKey(document.target);
  let found = false;
  const next = documents.map((existing) => {
    if (getWikiLinkTargetKey(existing.target) !== targetKey) return existing;
    found = true;
    return document;
  });
  return found ? next : [...next, document];
}

function getLinkTargetFromAction(action: LinkAction): WikiLinkTarget | null {
  switch (action.kind) {
    case 'wiki':
      return { kind: 'wiki', relPath: normalizeWikiRelPath(action.relPath) };
    case 'artifact':
      return { kind: 'artifact', path: action.path };
    case 'command':
      return { kind: 'command', path: action.path };
    case 'bookmarks':
      return { kind: 'bookmarks' };
    default:
      return null;
  }
}

function wikiBacklinkInputsToRelationDocuments(pages: WikiBacklinkInput[]): MarkdownLinkRelationDocument[] {
  return pages.map((page) => ({
    target: { kind: 'wiki', relPath: page.relPath },
    title: page.title,
    content: page.content,
  }));
}

export function getMarkdownBacklinks(
  target: WikiLinkTarget | null,
  documents: MarkdownLinkRelationDocument[],
  index: WikiIndex,
): MarkdownBacklink[] {
  if (!target) return [];
  const targetKey = getWikiLinkTargetKey(target);
  if (!targetKey) return [];

  const backlinks: MarkdownBacklink[] = [];
  const seen = new Set<string>();

  for (const document of documents) {
    const sourceKey = getWikiLinkTargetKey(document.target);
    if (!sourceKey || sourceKey === targetKey || seen.has(sourceKey)) continue;

    const hit = getMarkdownLinkRelationDocumentHits(document, index)
      .find((candidate) => {
        const candidateTarget = getLinkTargetFromAction(candidate.action);
        return candidateTarget && getWikiLinkTargetKey(candidateTarget) === targetKey;
      });
    if (!hit) continue;

    seen.add(sourceKey);
    backlinks.push({
      target: document.target,
      title: document.title,
      excerpt: getLineExcerptAtOffset(document.content, hit.start),
    });
  }

  return backlinks.sort((a, b) => a.title.localeCompare(b.title));
}

export function getMarkdownOutboundLinks(
  source: WikiLinkTarget | null,
  content: string,
  documents: MarkdownLinkRelationDocument[],
  index: WikiIndex,
): MarkdownOutboundLink[] {
  const sourceKey = source ? getWikiLinkTargetKey(source) : '';
  const documentByTargetKey = new Map(
    documents.map((document) => [getWikiLinkTargetKey(document.target), document]),
  );
  const links: MarkdownOutboundLink[] = [];
  const seen = new Set<string>();

  for (const hit of getMarkdownEditorLinkHits(content, index)) {
    const target = getLinkTargetFromAction(hit.action);
    if (!target) continue;
    const targetKey = getWikiLinkTargetKey(target);
    if (!targetKey || targetKey === sourceKey || seen.has(targetKey)) continue;
    const document = documentByTargetKey.get(targetKey);
    if (!document) continue;

    seen.add(targetKey);
    links.push({
      target: document.target,
      title: document.title,
      excerpt: getLineExcerptAtOffset(content, hit.start),
    });
  }

  return links.sort((a, b) => a.title.localeCompare(b.title));
}

export function getMarkdownLinkedDocuments(
  source: WikiLinkTarget | null,
  content: string,
  documents: MarkdownLinkRelationDocument[],
  index: WikiIndex,
): MarkdownLinkedDocument[] {
  const merged = new Map<string, {
    target: WikiLinkTarget;
    title: string;
    outbound: boolean;
    inbound: boolean;
    excerpt: string;
  }>();

  for (const link of getMarkdownOutboundLinks(source, content, documents, index)) {
    merged.set(getWikiLinkTargetKey(link.target), {
      target: link.target,
      title: link.title,
      outbound: true,
      inbound: false,
      excerpt: link.excerpt,
    });
  }

  if (source) {
    for (const backlink of getMarkdownBacklinks(source, documents, index)) {
      const key = getWikiLinkTargetKey(backlink.target);
      const existing = merged.get(key);
      if (existing) {
        existing.inbound = true;
      } else {
        merged.set(key, {
          target: backlink.target,
          title: backlink.title,
          outbound: false,
          inbound: true,
          excerpt: backlink.excerpt,
        });
      }
    }
  }

  return Array.from(merged.values())
    .map((link) => {
      const direction: MarkdownLinkedDocument['direction'] = link.outbound && link.inbound
        ? 'bidirectional'
        : link.outbound
          ? 'outbound'
          : 'inbound';
      return {
        target: link.target,
        title: link.title,
        excerpt: link.excerpt,
        direction,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export function getWikiBacklinks(
  targetRelPath: string,
  pages: WikiBacklinkInput[],
  index: WikiIndex,
): WikiBacklink[] {
  return getMarkdownBacklinks(
    { kind: 'wiki', relPath: targetRelPath },
    wikiBacklinkInputsToRelationDocuments(pages),
    index,
  ).flatMap((link) => link.target.kind === 'wiki'
    ? [{
      relPath: normalizeWikiRelPath(link.target.relPath),
      title: link.title,
      excerpt: link.excerpt,
    }]
    : []);
}

export function getWikiOutboundLinks(
  sourceRelPath: string | null,
  content: string,
  pages: WikiBacklinkInput[],
  index: WikiIndex,
): WikiOutboundLink[] {
  return getMarkdownOutboundLinks(
    sourceRelPath ? { kind: 'wiki', relPath: sourceRelPath } : null,
    content,
    wikiBacklinkInputsToRelationDocuments(pages),
    index,
  ).flatMap((link) => link.target.kind === 'wiki'
    ? [{
      relPath: normalizeWikiRelPath(link.target.relPath),
      title: link.title,
      excerpt: link.excerpt,
    }]
    : []);
}

export function getWikiLinkedPages(
  sourceRelPath: string | null,
  content: string,
  pages: WikiBacklinkInput[],
  index: WikiIndex,
): WikiLinkedPage[] {
  return getMarkdownLinkedDocuments(
    sourceRelPath ? { kind: 'wiki', relPath: sourceRelPath } : null,
    content,
    wikiBacklinkInputsToRelationDocuments(pages),
    index,
  ).flatMap((link) => link.target.kind === 'wiki'
    ? [{
      relPath: normalizeWikiRelPath(link.target.relPath),
      title: link.title,
      excerpt: link.excerpt,
      direction: link.direction,
    }]
    : []);
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

export function getMarkdownWikiLinkCompletionCommitEdit(
  markdown: string,
  completion: MarkdownWikiLinkCompletion,
): MarkdownWikiLinkCompletionEdit | null {
  const currentTitle = markdown.slice(completion.queryStart, completion.replaceEnd).trim();
  return getMarkdownWikiLinkCompletionReplacement(markdown, completion, currentTitle);
}

export function getMarkdownWikiLinkCompletionDeleteEdit(
  markdown: string,
  completion: MarkdownWikiLinkCompletion,
  key: MarkdownWikiLinkCompletionDeleteKey,
): MarkdownWikiLinkCompletionEdit | null {
  const caret = Math.max(completion.openStart, Math.min(completion.queryEnd, markdown.length));
  const replaceEnd = Math.max(completion.queryStart, Math.min(completion.replaceEnd, markdown.length));
  if (key === 'Backspace') {
    if (caret <= completion.openStart) return null;
    if (
      caret === completion.queryStart
      && completion.queryStart === completion.replaceEnd
      && markdown.slice(completion.openStart, completion.queryStart) === '[['
      && markdown.slice(completion.replaceEnd, completion.replaceEnd + 2) === ']]'
    ) {
      const selection = completion.openStart + 1;
      return {
        nextValue: `${markdown.slice(0, selection)}${markdown.slice(completion.replaceEnd + 2)}`,
        selectionStart: selection,
        selectionEnd: selection,
      };
    }
    return {
      nextValue: `${markdown.slice(0, caret - 1)}${markdown.slice(caret)}`,
      selectionStart: caret - 1,
      selectionEnd: caret - 1,
    };
  }

  if (caret >= replaceEnd) return null;
  return {
    nextValue: `${markdown.slice(0, caret)}${markdown.slice(caret + 1)}`,
    selectionStart: caret,
    selectionEnd: caret,
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
          const { relPath, artifactPath, commandPath, bookmarks } = resolveWikiLink(target, index);
          const href = relPath
            ? `${RESOLVED_PREFIX}${encodeURI(relPath)}`
            : artifactPath
              ? `${ARTIFACT_PREFIX}${encodeURIComponent(artifactPath)}`
              : commandPath
                ? `${COMMAND_PREFIX}${encodeURIComponent(commandPath)}`
                : bookmarks
                  ? `${BOOKMARKS_PREFIX}root`
                  : `${UNRESOLVED_PREFIX}${encodeURIComponent(target)}`;
          return `[${escapedDisplay}](${href})`;
        },
      );
      return transformBareExternalUrls(withWikiLinks);
    })
    .join('');
}
