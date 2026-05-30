import type { LibraryDocument, LibraryViewState } from '../types';

export const normalizeWikiTitle = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');

export const getDisplayTitle = (doc: LibraryDocument) => doc.title.trim() || 'Untitled';

const folderForDocument = (doc: LibraryDocument) => doc.folderPath?.trim() || 'scratchpad';

const trimMarkdownExtension = (value: string) => value.replace(/\.md$/i, '');

const createMarkdownSlug = (title: string) =>
  title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-_]/g, '')
    .replace(/\s+/g, '-') || 'untitled';

export const fileNameForLibraryTitle = (title: string) => `${createMarkdownSlug(title)}.md`;

const isUntitledMarkdownFileName = (value: string) => /^untitled(?:[-_\s]\d+)?\.md$/i.test(value.trim());

export const shouldRetitleMobileFileName = (doc: LibraryDocument, nextTitle: string) => {
  const cleanTitle = nextTitle.trim();
  if (doc.sourceKind !== 'mobile') return false;
  if (!cleanTitle || cleanTitle.toLowerCase() === 'untitled') return false;
  const currentFileName = doc.fileName?.trim();
  return !currentFileName || isUntitledMarkdownFileName(currentFileName);
};

const sourcePathForDocument = (doc: LibraryDocument) => {
  const folder = folderForDocument(doc);
  const fileName = doc.fileName?.trim();
  return fileName ? `${folder}/${fileName}` : null;
};

const wikiIdentityCandidatesForDocument = (doc: LibraryDocument) => {
  const sourcePath = sourcePathForDocument(doc);
  return [
    getDisplayTitle(doc),
    trimMarkdownExtension(doc.fileName?.trim() ?? ''),
    sourcePath ?? '',
    sourcePath ? trimMarkdownExtension(sourcePath) : '',
  ].filter(Boolean);
};

export const wikiTargetForDocument = (doc: LibraryDocument) => {
  const sourcePath = sourcePathForDocument(doc);
  return sourcePath ? trimMarkdownExtension(sourcePath) : getDisplayTitle(doc);
};

export const parseWikiLinkTarget = (value: string) => {
  const [targetPart, ...labelParts] = value.split('|');
  const target = targetPart.trim();
  const label = labelParts.join('|').trim() || target.split('/').pop()?.trim() || target;
  return { target, label };
};

export const documentDraftFromWikiTarget = (value: string, fallbackFolder = 'scratchpad') => {
  const { target } = parseWikiLinkTarget(value);
  const rawParts = target.split('/').map((part) => part.trim()).filter(Boolean);
  const rawFileName = rawParts.pop() ?? target.trim();
  const title = trimMarkdownExtension(rawFileName).trim() || 'Untitled';
  return {
    title,
    folderPath: rawParts.join('/') || fallbackFolder,
    fileName: /\.md$/i.test(rawFileName) ? rawFileName : undefined,
  };
};

export type WikiDocumentDraft = { title: string; folderPath: string; fileName?: string };

export const wikiTargetForDocumentDraft = (draft: WikiDocumentDraft) => {
  const fileTarget = draft.fileName ? trimMarkdownExtension(draft.fileName.trim()) : draft.title.trim();
  return [draft.folderPath.trim(), fileTarget].filter(Boolean).join('/');
};

export const splitRichContent = (doc: LibraryDocument) => {
  const lines = doc.content.split('\n');
  const firstLine = lines[0] ?? '';
  const heading = firstLine.match(/^#\s+(.+)$/);
  return {
    title: heading?.[1]?.trim() || getDisplayTitle(doc),
    body: heading ? lines.slice(1).join('\n').replace(/^\n/, '') : doc.content,
  };
};

export const buildRichContent = (title: string, body: string) => `# ${title.trim() || 'Untitled'}\n\n${body.replace(/^\n+/, '')}`;

export const applyRichTitleInputChange = (nextTitle: string, currentBody: string) => {
  if (!nextTitle.includes('\n')) {
    return { title: nextTitle, body: currentBody, bodySelection: null };
  }

  const [titleLine = '', ...bodyLines] = nextTitle.split('\n');
  const insertedBody = bodyLines.join('\n').replace(/^\n+/, '');
  const body = insertedBody
    ? `${insertedBody}${currentBody ? `\n${currentBody}` : ''}`
    : currentBody;
  const cursor = insertedBody.length;

  return {
    title: titleLine,
    body,
    bodySelection: { start: cursor, end: cursor },
  };
};

export const bodySelectionForMarkdownLine = (content: string, lineNumber: number): TextSelection => {
  const targetLineNumber = Math.max(1, Math.floor(lineNumber));
  const lines = content.split('\n');
  const hasTitleHeading = /^#\s+(.+)$/.test(lines[0] ?? '');
  const bodySourceStartIndex = hasTitleHeading ? 1 : 0;
  const bodyLinesBeforeTrim = lines.slice(bodySourceStartIndex);
  const trimFirstBlankBodyLine = hasTitleHeading && bodyLinesBeforeTrim[0] === '';
  const bodySourceLineNumber = bodySourceStartIndex + (trimFirstBlankBodyLine ? 2 : 1);

  if (targetLineNumber <= bodySourceLineNumber) {
    return { start: 0, end: 0 };
  }

  const bodyLines = trimFirstBlankBodyLine ? bodyLinesBeforeTrim.slice(1) : bodyLinesBeforeTrim;
  const targetBodyIndex = Math.min(targetLineNumber - bodySourceLineNumber, bodyLines.length);
  const offset = bodyLines
    .slice(0, targetBodyIndex)
    .reduce((total, line) => total + line.length + 1, 0);

  return { start: offset, end: offset };
};

export const wikiLinksFromContent = (content: string) =>
  (content.match(/\[\[([^\]]+)\]\]/g) ?? [])
    .map((link) => parseWikiLinkTarget(link.slice(2, -2)))
    .filter((link) => Boolean(link.target));

export const wikiLinkTitlesFromContent = (content: string) =>
  wikiLinksFromContent(content).map((link) => link.target);

export type MarkdownInlineSegment =
  | { type: 'text'; text: string }
  | { type: 'wiki'; text: string; target: string }
  | { type: 'url'; text: string; url: string }
  | { type: 'strong'; text: string }
  | { type: 'emphasis'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strike'; text: string };

export type MarkdownReaderBlock =
  | { type: 'blank'; key: string; lineNumber: number }
  | { type: 'heading'; key: string; lineNumber: number; level: 1 | 2 | 3 | 4 | 5 | 6; segments: MarkdownInlineSegment[] }
  | { type: 'list'; key: string; lineNumber: number; indent: number; marker: string; segments: MarkdownInlineSegment[] }
  | { type: 'quote'; key: string; lineNumber: number; segments: MarkdownInlineSegment[] }
  | { type: 'rule'; key: string; lineNumber: number }
  | { type: 'image'; key: string; lineNumber: number; alt: string; url: string }
  | {
      type: 'table';
      key: string;
      lineNumber: number;
      headers: string[];
      headerSegments: MarkdownInlineSegment[][];
      rows: string[][];
      rowSegments: MarkdownInlineSegment[][][];
    }
  | { type: 'codeBlock'; key: string; lineNumber: number; language: string | null; text: string }
  | { type: 'paragraph'; key: string; lineNumber: number; segments: MarkdownInlineSegment[] };

export type TextSelection = { start: number; end: number };
export type RichInlineFormat = 'wiki' | 'strong' | 'emphasis' | 'code' | 'strike';
export type RichBlockFormat = 'heading2' | 'bullet' | 'numbered' | 'task' | 'quote';
export type LibrarySyncTone = 'syncing' | 'saving' | 'local' | 'synced' | 'offline' | 'error';

export type LibrarySyncStatus = {
  tone: LibrarySyncTone;
  label: string;
  detail: string;
};

const INLINE_MARKDOWN_PATTERN = /(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|\[\[[^\]\n]+\]\]|<https?:\/\/[^\s>]+>|https?:\/\/[^\s<>\]]+|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~|\*[^*\n]+\*|_[^_\n]+_)/g;
const TRAILING_URL_PUNCTUATION = /[.,;:!?]+$/;

export const parseMarkdownInlineSegments = (line: string): MarkdownInlineSegment[] => {
  const segments: MarkdownInlineSegment[] = [];
  let cursor = 0;

  for (const match of line.matchAll(INLINE_MARKDOWN_PATTERN)) {
    const raw = match[0];
    const index = match.index ?? 0;
    if (index > cursor) {
      segments.push({ type: 'text', text: line.slice(cursor, index) });
    }

    if (raw.startsWith('[') && !raw.startsWith('[[')) {
      const markdownLink = raw.match(/^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (markdownLink) {
        segments.push({ type: 'url', text: markdownLink[1], url: markdownLink[2] });
      }
    } else if (raw.startsWith('[[')) {
      const { label, target } = parseWikiLinkTarget(raw.slice(2, -2));
      segments.push({ type: 'wiki', text: label, target });
    } else if (raw.startsWith('<http://') || raw.startsWith('<https://')) {
      const url = raw.slice(1, -1);
      segments.push({ type: 'url', text: url, url });
    } else if (raw.startsWith('http://') || raw.startsWith('https://')) {
      const url = raw.replace(TRAILING_URL_PUNCTUATION, '');
      const trailingText = raw.slice(url.length);
      segments.push({ type: 'url', text: url, url });
      if (trailingText) {
        segments.push({ type: 'text', text: trailingText });
      }
    } else if (raw.startsWith('**') || raw.startsWith('__')) {
      segments.push({ type: 'strong', text: raw.slice(2, -2) });
    } else if (raw.startsWith('~~')) {
      segments.push({ type: 'strike', text: raw.slice(2, -2) });
    } else if (raw.startsWith('`')) {
      segments.push({ type: 'code', text: raw.slice(1, -1) });
    } else {
      segments.push({ type: 'emphasis', text: raw.slice(1, -1) });
    }
    cursor = index + raw.length;
  }

  if (cursor < line.length) {
    segments.push({ type: 'text', text: line.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ type: 'text', text: line }];
};

const parseReaderLineSegments = (text: string) => {
  return { segments: parseMarkdownInlineSegments(text) };
};

const markdownIndentWidth = (indent: string) => indent.replace(/\t/g, '    ').length;

const parseMarkdownTableRow = (line: string) => {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return null;
  const inner = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  const cells = inner.split('|').map((cell) => cell.trim());
  return cells.length >= 2 ? cells : null;
};

const isMarkdownTableDivider = (cells: string[]) =>
  cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));

export const previewMarkdownReaderContent = (content: string, maxLines = 120) => {
  if (maxLines <= 0) return '';

  let cursor = -1;
  for (let line = 0; line < maxLines; line += 1) {
    const nextCursor = content.indexOf('\n', cursor + 1);
    if (nextCursor === -1) return content;
    cursor = nextCursor;
  }

  return content.slice(0, cursor);
};

export const toggleMarkdownTaskAtLine = (content: string, lineNumber: number) => {
  const targetIndex = Math.max(0, Math.floor(lineNumber) - 1);
  const lines = content.split('\n');
  const line = lines[targetIndex];
  if (line === undefined) return null;

  const task = line.match(/^(\s*)- \[([ xX])\](.*)$/);
  if (!task) return null;

  const nextMark = task[2].toLowerCase() === 'x' ? ' ' : 'x';
  lines[targetIndex] = `${task[1]}- [${nextMark}]${task[3]}`;
  return lines.join('\n');
};

const parseMarkdownReaderLine = (line: string, index: number): MarkdownReaderBlock => {
  const key = `line-${index}`;
  const lineNumber = index + 1;
  if (!line.trim()) {
    return { type: 'blank', key, lineNumber };
  }

  if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
    return { type: 'rule', key, lineNumber };
  }

  const image = line.match(/^\s*!\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)\s*$/);
  if (image) {
    return {
      type: 'image',
      key,
      lineNumber,
      alt: image[1],
      url: image[2],
    };
  }

  const heading = line.match(/^(#{1,6})\s+(.+)$/);
  if (heading) {
    return {
      type: 'heading',
      key,
      lineNumber,
      level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
      ...parseReaderLineSegments(heading[2]),
    };
  }

  const list = line.match(/^(\s*)(- \[[ xX]\]|[-*]|\d+\.)\s+(.+)$/);
  if (list) {
    return {
      type: 'list',
      key,
      lineNumber,
      indent: markdownIndentWidth(list[1]),
      marker: list[2],
      ...parseReaderLineSegments(list[3]),
    };
  }

  const quote = line.match(/^>\s?(.+)$/);
  if (quote) {
    return {
      type: 'quote',
      key,
      lineNumber,
      ...parseReaderLineSegments(quote[1]),
    };
  }

  return {
    type: 'paragraph',
    key,
    lineNumber,
    ...parseReaderLineSegments(line),
  };
};

const isMarkdownTableStart = (lines: string[], index: number) => {
  const tableHeaders = parseMarkdownTableRow(lines[index] ?? '');
  const tableDivider = parseMarkdownTableRow(lines[index + 1] ?? '');
  return Boolean(tableHeaders && tableDivider && isMarkdownTableDivider(tableDivider));
};

const isMarkdownParagraphLine = (lines: string[], index: number) => {
  const line = lines[index] ?? '';
  if (index >= lines.length) return false;
  if (!line.trim()) return false;
  if (isMarkdownTableStart(lines, index)) return false;
  if (/^```([\w-]+)?\s*$/.test(line)) return false;
  if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) return false;
  if (/^\s*!\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)\s*$/.test(line)) return false;
  if (/^(#{1,6})\s+(.+)$/.test(line)) return false;
  if (/^(\s*)(- \[[ xX]\]|[-*]|\d+\.)\s+(.+)$/.test(line)) return false;
  if (/^>\s?(.+)$/.test(line)) return false;
  return true;
};

const joinMarkdownParagraphLines = (lines: string[]) =>
  lines
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ');

export const parseMarkdownReaderBlocks = (content: string): MarkdownReaderBlock[] => {
  const lines = content.split('\n');
  const blocks: MarkdownReaderBlock[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isMarkdownTableStart(lines, index)) {
      const tableHeaders = parseMarkdownTableRow(line) ?? [];
      const startIndex = index;
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length) {
        const row = parseMarkdownTableRow(lines[index]);
        if (!row) break;
        rows.push(row);
        index += 1;
      }
      index -= 1;
      blocks.push({
        type: 'table',
        key: `line-${startIndex}`,
        lineNumber: startIndex + 1,
        headers: tableHeaders,
        headerSegments: tableHeaders.map(parseMarkdownInlineSegments),
        rows,
        rowSegments: rows.map((row) => row.map(parseMarkdownInlineSegments)),
      });
      continue;
    }

    if (isMarkdownParagraphLine(lines, index)) {
      const startIndex = index;
      const paragraphLines = [line];
      while (isMarkdownParagraphLine(lines, index + 1)) {
        index += 1;
        paragraphLines.push(lines[index]);
      }
      blocks.push({
        type: 'paragraph',
        key: `line-${startIndex}`,
        lineNumber: startIndex + 1,
        ...parseReaderLineSegments(joinMarkdownParagraphLines(paragraphLines)),
      });
      continue;
    }

    const fence = line.match(/^```([\w-]+)?\s*$/);
    if (fence) {
      const startIndex = index;
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      blocks.push({
        type: 'codeBlock',
        key: `line-${startIndex}`,
        lineNumber: startIndex + 1,
        language: fence[1]?.trim() || null,
        text: codeLines.join('\n'),
      });
      continue;
    }

    blocks.push(parseMarkdownReaderLine(line, index));
  }

  return blocks;
};

export const formatMarkdownListMarker = (marker: string) => {
  if (/^\d+\.$/.test(marker)) return marker;
  if (/^- \[[xX]\]$/.test(marker)) return '[x]';
  if (/^- \[ \]$/.test(marker)) return '[ ]';
  return '•';
};

const richInlineFormatSpec: Record<RichInlineFormat, { left: string; right: string; placeholder: string }> = {
  wiki: { left: '[[', right: ']]', placeholder: 'Link' },
  strong: { left: '**', right: '**', placeholder: 'bold' },
  emphasis: { left: '*', right: '*', placeholder: 'italic' },
  code: { left: '`', right: '`', placeholder: 'code' },
  strike: { left: '~~', right: '~~', placeholder: 'text' },
};

export const applyRichInlineFormat = (
  body: string,
  selection: TextSelection,
  format: RichInlineFormat,
) => {
  const spec = richInlineFormatSpec[format];
  const start = Math.max(0, Math.min(selection.start, selection.end, body.length));
  const end = Math.max(0, Math.min(Math.max(selection.start, selection.end), body.length));
  const selectedText = body.slice(start, end) || spec.placeholder;
  const insertedText = `${spec.left}${selectedText}${spec.right}`;
  const nextBody = `${body.slice(0, start)}${insertedText}${body.slice(end)}`;
  const innerStart = start + spec.left.length;
  const innerEnd = innerStart + selectedText.length;

  return {
    body: nextBody,
    selection: end > start
      ? { start: start + insertedText.length, end: start + insertedText.length }
      : { start: innerStart, end: innerEnd },
  };
};

const formatWikiLink = (target: string, label: string) => {
  const cleanTarget = target.trim();
  const cleanLabel = label.trim();
  if (!cleanTarget) return '';
  if (!cleanLabel || normalizeWikiTitle(cleanLabel) === normalizeWikiTitle(cleanTarget)) {
    return `[[${cleanTarget}]]`;
  }
  return `[[${cleanTarget}|${cleanLabel}]]`;
};

export const applyRichWikiLink = (
  body: string,
  selection: TextSelection,
  target: string,
  label: string,
) => {
  const start = Math.max(0, Math.min(selection.start, selection.end, body.length));
  const end = Math.max(0, Math.min(Math.max(selection.start, selection.end), body.length));
  const selectedText = body.slice(start, end).trim();
  const linkText = formatWikiLink(target, selectedText || label);
  const isCursorInsert = start === end;
  const leadingSpace = isCursorInsert && start > 0 && !/\s/.test(body[start - 1]) ? ' ' : '';
  const trailingSpace = isCursorInsert && end < body.length && !/\s/.test(body[end]) ? ' ' : '';
  const insertedText = `${leadingSpace}${linkText}${trailingSpace}`;
  const nextBody = `${body.slice(0, start)}${insertedText}${body.slice(end)}`;
  const cursor = start + insertedText.length;

  return {
    body: nextBody,
    selection: { start: cursor, end: cursor },
  };
};

const lineRangeForSelection = (body: string, selection: TextSelection) => {
  const start = Math.max(0, Math.min(selection.start, selection.end, body.length));
  const end = Math.max(0, Math.min(Math.max(selection.start, selection.end), body.length));
  const lineStart = body.lastIndexOf('\n', start - 1) + 1;
  const nextBreak = body.indexOf('\n', end);
  const lineEnd = nextBreak === -1 ? body.length : nextBreak;
  return { start, end, lineStart, lineEnd };
};

const stripBlockMarker = (line: string) => {
  const indent = line.match(/^\s*/)?.[0] ?? '';
  const rest = line.slice(indent.length);
  return {
    indent,
    text: rest
      .replace(/^#{1,6}\s+/, '')
      .replace(/^- \[[ xX]\]\s+/, '')
      .replace(/^[-*]\s+/, '')
      .replace(/^\d+\.\s+/, '')
      .replace(/^>\s?/, ''),
  };
};

const applyRichBlockFormatToLine = (line: string, format: RichBlockFormat, lineIndex: number) => {
  const { indent, text } = stripBlockMarker(line);
  const trimmed = text.trimStart();
  const leading = text.slice(0, text.length - trimmed.length);

  if (format === 'heading2') {
    return /^##\s+/.test(line.trimStart()) ? `${indent}${trimmed}` : `${indent}## ${trimmed}`;
  }
  if (format === 'bullet') {
    return /^[-*]\s+(?!\[[ xX]\]\s+)/.test(line.trimStart()) ? `${indent}${trimmed}` : `${indent}- ${leading}${trimmed}`;
  }
  if (format === 'numbered') {
    return /^\d+\.\s+/.test(line.trimStart()) ? `${indent}${trimmed}` : `${indent}${lineIndex + 1}. ${leading}${trimmed}`;
  }
  if (format === 'task') {
    return /^- \[[ xX]\]\s+/.test(line.trimStart()) ? `${indent}${trimmed}` : `${indent}- [ ] ${leading}${trimmed}`;
  }
  return /^>\s?/.test(line.trimStart()) ? `${indent}${trimmed}` : `${indent}> ${leading}${trimmed}`;
};

export const applyRichBlockFormat = (
  body: string,
  selection: TextSelection,
  format: RichBlockFormat,
) => {
  const { lineStart, lineEnd } = lineRangeForSelection(body, selection);
  const selectedLines = body.slice(lineStart, lineEnd);
  const transformed = selectedLines
    .split('\n')
    .map((line, index) => applyRichBlockFormatToLine(line, format, index))
    .join('\n');
  const nextBody = `${body.slice(0, lineStart)}${transformed}${body.slice(lineEnd)}`;
  const cursor = lineStart + transformed.length;

  return {
    body: nextBody,
    selection: { start: cursor, end: cursor },
  };
};

const findSingleInsertedText = (previousBody: string, nextBody: string) => {
  if (nextBody.length <= previousBody.length) return null;

  let prefixLength = 0;
  while (
    prefixLength < previousBody.length
    && prefixLength < nextBody.length
    && previousBody[prefixLength] === nextBody[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < previousBody.length - prefixLength
    && suffixLength < nextBody.length - prefixLength
    && previousBody[previousBody.length - 1 - suffixLength] === nextBody[nextBody.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  return {
    index: prefixLength,
    text: nextBody.slice(prefixLength, nextBody.length - suffixLength),
  };
};

const continuationForRichEditorLine = (lineBeforeCursor: string) => {
  const task = lineBeforeCursor.match(/^(\s*)- \[[ xX]\]\s*(.*)$/);
  if (task) {
    return {
      markerStart: task[1].length,
      markerText: `${task[1]}- [ ] `,
      shouldExit: task[2].trim().length === 0,
    };
  }

  const bullet = lineBeforeCursor.match(/^(\s*)([-*])\s+(.*)$/);
  if (bullet) {
    return {
      markerStart: bullet[1].length,
      markerText: `${bullet[1]}${bullet[2]} `,
      shouldExit: bullet[3].trim().length === 0,
    };
  }

  const numbered = lineBeforeCursor.match(/^(\s*)(\d+)\.\s+(.*)$/);
  if (numbered) {
    return {
      markerStart: numbered[1].length,
      markerText: `${numbered[1]}${Number(numbered[2]) + 1}. `,
      shouldExit: numbered[3].trim().length === 0,
    };
  }

  const quote = lineBeforeCursor.match(/^(\s*)>\s?(.*)$/);
  if (quote) {
    return {
      markerStart: quote[1].length,
      markerText: `${quote[1]}> `,
      shouldExit: quote[2].trim().length === 0,
    };
  }

  return null;
};

export const applyRichEditorInputChange = (
  previousBody: string,
  nextBody: string,
) => {
  const inserted = findSingleInsertedText(previousBody, nextBody);
  if (!inserted || inserted.text !== '\n') {
    return { body: nextBody, selection: null };
  }

  const lineStart = previousBody.lastIndexOf('\n', inserted.index - 1) + 1;
  const lineBeforeCursor = previousBody.slice(lineStart, inserted.index);
  const continuation = continuationForRichEditorLine(lineBeforeCursor);
  if (!continuation) {
    return { body: nextBody, selection: null };
  }

  if (continuation.shouldExit) {
    const body = `${previousBody.slice(0, lineStart + continuation.markerStart)}\n${previousBody.slice(inserted.index)}`;
    const cursor = lineStart + continuation.markerStart + 1;
    return { body, selection: { start: cursor, end: cursor } };
  }

  const insertionPoint = inserted.index + 1;
  const body = `${nextBody.slice(0, insertionPoint)}${continuation.markerText}${nextBody.slice(insertionPoint)}`;
  const cursor = insertionPoint + continuation.markerText.length;
  return { body, selection: { start: cursor, end: cursor } };
};

const pluralizeNotes = (count: number) => `${count} local ${count === 1 ? 'change' : 'changes'}`;

export const formatLibrarySyncTime = (timestamp?: number | null, now = Date.now()) => {
  if (!timestamp) return 'not synced yet';
  const elapsedMs = now - timestamp;
  if (elapsedMs < 60_000) return 'just now';
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(timestamp));
};

const formatPendingSyncDetail = (lastSyncedAt?: number | null, now?: number) => {
  const lastSync = formatLibrarySyncTime(lastSyncedAt, now);
  return `${lastSyncedAt ? `Last synced ${lastSync}` : 'Not synced yet'}. Will sync in the background.`;
};

export const getLibrarySyncStatus = ({
  isSyncing,
  isSignedIn,
  syncError,
  hasPendingDraft,
  hasSavedDraft,
  unsyncedCount,
  lastSyncedAt,
  now,
}: {
  isSyncing?: boolean;
  isSignedIn: boolean;
  syncError?: string | null;
  hasPendingDraft?: boolean;
  hasSavedDraft?: boolean;
  unsyncedCount: number;
  lastSyncedAt?: number | null;
  now?: number;
}): LibrarySyncStatus => {
  if (hasPendingDraft) {
    return { tone: 'saving', label: 'Saving locally', detail: 'Your edit is being written on this device.' };
  }
  if (isSyncing) {
    return { tone: 'syncing', label: 'Syncing Library', detail: 'Reading and typing stay local while sync runs.' };
  }
  if (syncError) {
    return { tone: 'error', label: 'Sync needs attention', detail: syncError };
  }
  if (hasSavedDraft && unsyncedCount > 0) {
    return {
      tone: isSignedIn ? 'local' : 'offline',
      label: 'Saved locally',
      detail: isSignedIn
        ? formatPendingSyncDetail(lastSyncedAt, now)
        : 'Sign in to sync this Library with your other devices.',
    };
  }
  if (!isSignedIn) {
    return {
      tone: 'offline',
      label: unsyncedCount > 0 ? `${pluralizeNotes(unsyncedCount)} on device` : 'Local only',
      detail: 'Sign in to sync this Library with your other devices.',
    };
  }
  if (unsyncedCount > 0) {
    return {
      tone: 'local',
      label: pluralizeNotes(unsyncedCount),
      detail: formatPendingSyncDetail(lastSyncedAt, now),
    };
  }
  return {
    tone: 'synced',
    label: `Synced ${formatLibrarySyncTime(lastSyncedAt, now)}`,
    detail: 'This device has the latest synced Library state.',
  };
};

export const findDocumentByWikiTitle = (documents: LibraryDocument[], title: string) => {
  const target = normalizeWikiTitle(title);
  return documents.find((doc) =>
    wikiIdentityCandidatesForDocument(doc).some((candidate) => normalizeWikiTitle(candidate) === target),
  ) ?? null;
};

export const findDocumentForWikiDraft = (documents: LibraryDocument[], draft: WikiDocumentDraft) =>
  findDocumentByWikiTitle(documents, wikiTargetForDocumentDraft(draft))
  ?? findDocumentByWikiTitle(documents, draft.title);

export type LibrarySearchRow = {
  doc: LibraryDocument;
  titleText: string;
  pathText: string;
  folderText: string;
  bodyText: string;
};

export const buildLibrarySearchRows = (documents: LibraryDocument[]): LibrarySearchRow[] =>
  documents.map((doc) => ({
    doc,
    titleText: normalizeWikiTitle(getDisplayTitle(doc)),
    pathText: normalizeWikiTitle([
      doc.fileName?.trim() ?? '',
      sourcePathForDocument(doc) ?? '',
    ].filter(Boolean).join(' ')),
    folderText: normalizeWikiTitle(folderForDocument(doc)),
    bodyText: normalizeWikiTitle(doc.content),
  }));

export const searchLibraryDocuments = (
  rows: LibrarySearchRow[],
  query: string,
  limit = 24,
) => {
  const needle = normalizeWikiTitle(query);
  if (!needle) return rows.slice(0, limit).map((row) => row.doc);

  return rows
    .flatMap((row) => {
      if (row.titleText.startsWith(needle)) return [{ row, score: 0 }];
      if (row.titleText.includes(needle)) return [{ row, score: 1 }];
      if (row.pathText.includes(needle)) return [{ row, score: 2 }];
      if (row.folderText.includes(needle)) return [{ row, score: 3 }];
      if (row.bodyText.includes(needle)) return [{ row, score: 4 }];
      return [];
    })
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return b.row.doc.updatedAt - a.row.doc.updatedAt;
    })
    .slice(0, limit)
    .map((match) => match.row.doc);
};

export const getSwitcherDocuments = ({
  documents,
  rows,
  query,
  indexReady,
  limit = 24,
}: {
  documents: LibraryDocument[];
  rows: LibrarySearchRow[];
  query: string;
  indexReady: boolean;
  limit?: number;
}) => {
  const needle = normalizeWikiTitle(query);
  if (!indexReady) {
    if (!needle) return documents.slice(0, limit);
    return documents
      .flatMap((doc) => {
        const titleText = normalizeWikiTitle(getDisplayTitle(doc));
        const pathText = normalizeWikiTitle([
          doc.fileName?.trim() ?? '',
          sourcePathForDocument(doc) ?? '',
        ].filter(Boolean).join(' '));
        const folderText = normalizeWikiTitle(folderForDocument(doc));
        if (titleText.startsWith(needle)) return [{ doc, score: 0 }];
        if (titleText.includes(needle)) return [{ doc, score: 1 }];
        if (pathText.includes(needle)) return [{ doc, score: 2 }];
        if (folderText.includes(needle)) return [{ doc, score: 3 }];
        return [];
      })
      .sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return b.doc.updatedAt - a.doc.updatedAt;
      })
      .slice(0, limit)
      .map((match) => match.doc);
  }
  return searchLibraryDocuments(rows, query, limit);
};

export const buildLibraryFolderGroups = (
  documents: LibraryDocument[],
  seededFolders: readonly string[],
  defaultFolder = 'scratchpad',
) => {
  const groups = new Map<string, LibraryDocument[]>();
  seededFolders.forEach((folder) => groups.set(folder, []));

  documents.forEach((doc) => {
    const folder = folderForDocument(doc) || defaultFolder;
    const docs = groups.get(folder);
    if (docs) {
      docs.push(doc);
    } else {
      groups.set(folder, [doc]);
    }
  });

  return Array.from(groups.entries()).sort(([a], [b]) => {
    if (a === defaultFolder) return -1;
    if (b === defaultFolder) return 1;
    return a.localeCompare(b);
  });
};

export const getBacklinkDocuments = (
  documents: LibraryDocument[],
  selectedDoc: LibraryDocument | null,
  limit = 8,
) => {
  if (!selectedDoc) return [];
  const targets = new Set(wikiIdentityCandidatesForDocument(selectedDoc).map(normalizeWikiTitle));
  return documents
    .filter((doc) => doc.id !== selectedDoc.id)
    .filter((doc) => wikiLinkTitlesFromContent(doc.content).some((title) => targets.has(normalizeWikiTitle(title))))
    .slice(0, limit);
};

export const getRecentDocuments = (
  documents: LibraryDocument[],
  recentIds: string[],
  selectedId: string | null,
  limit = 5,
) =>
  recentIds
    .map((id) => documents.find((doc) => doc.id === id))
    .filter((doc): doc is LibraryDocument => Boolean(doc))
    .filter((doc) => doc.id !== selectedId)
    .slice(0, limit);

export const nextRecentIds = (currentIds: string[], docId: string | null, limit = 12) => {
  if (!docId) return currentIds.slice(0, limit);
  return [docId, ...currentIds.filter((id) => id !== docId)].slice(0, limit);
};

export const reconcileLibraryViewState = (
  documents: LibraryDocument[],
  savedState: LibraryViewState | null,
) => {
  const documentIds = new Set(documents.map((doc) => doc.id));
  const savedSelectedId = savedState?.selectedDocumentId ?? null;
  const selectedId = savedSelectedId && documentIds.has(savedSelectedId)
    ? savedSelectedId
    : documents[0]?.id ?? null;
  const recentIds = [
    ...(selectedId ? [selectedId] : []),
    ...(savedState?.recentDocumentIds ?? []),
  ].filter((id, index, ids) => documentIds.has(id) && ids.indexOf(id) === index).slice(0, 12);
  const readerScrollOffsets = Object.fromEntries(
    Object.entries(savedState?.readerScrollOffsets ?? {})
      .filter(([id, offset]) => documentIds.has(id) && Number.isFinite(offset) && offset >= 0),
  );

  return { selectedId, recentIds, readerScrollOffsets };
};

export const nextNavigationBackIds = (
  currentBackIds: string[],
  currentId: string | null,
  targetId: string | null,
  limit = 24,
) => {
  if (!currentId || !targetId || currentId === targetId) return currentBackIds.slice(0, limit);
  return [
    currentId,
    ...currentBackIds.filter((id) => id !== currentId && id !== targetId),
  ].slice(0, limit);
};

export const resolveNavigationBackTarget = (
  documents: LibraryDocument[],
  backIds: string[],
) => {
  const documentIds = new Set(documents.map((doc) => doc.id));
  const remainingIds = backIds.filter((id) => documentIds.has(id));
  const previousDoc = remainingIds.length > 0
    ? documents.find((doc) => doc.id === remainingIds[0]) ?? null
    : null;

  return {
    previousDoc,
    remainingIds: previousDoc ? remainingIds.slice(1) : [],
  };
};
