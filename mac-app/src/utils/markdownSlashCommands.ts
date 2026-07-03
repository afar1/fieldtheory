export interface MarkdownSlashCommandEdit {
  nextValue: string;
  selectionStart: number;
  selectionEnd: number;
}

export interface MarkdownSlashCommandCompletion {
  triggerStart: number;
  queryStart: number;
  queryEnd: number;
  query: string;
}

export interface MarkdownSlashCommandSuggestion {
  name: 'draw';
  description: string;
}

export const MARKDOWN_SLASH_COMMAND_SUGGESTIONS: MarkdownSlashCommandSuggestion[] = [
  { name: 'draw', description: 'Insert a drawing' },
];

function isSlashBoundary(char: string): boolean {
  return !char || char === '\n';
}

export function getActiveMarkdownSlashCommandCompletion(
  markdown: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownSlashCommandCompletion | null {
  if (selectionStart !== selectionEnd) return null;
  const caret = Math.max(0, Math.min(selectionStart, markdown.length));
  const lineStart = markdown.lastIndexOf('\n', Math.max(0, caret - 1)) + 1;
  const beforeCaret = markdown.slice(lineStart, caret);
  const match = beforeCaret.match(/^\/([a-zA-Z0-9_-]{0,32})$/);
  if (!match) return null;
  const triggerStart = lineStart;
  if (!isSlashBoundary(markdown[triggerStart - 1] ?? '')) return null;
  return {
    triggerStart,
    queryStart: triggerStart + 1,
    queryEnd: caret,
    query: match[1],
  };
}

export function rankMarkdownSlashCommandSuggestions(
  query: string,
  items: MarkdownSlashCommandSuggestion[] = MARKDOWN_SLASH_COMMAND_SUGGESTIONS,
): MarkdownSlashCommandSuggestion[] {
  const normalizedQuery = query.trim().toLowerCase();
  return items.filter((item) => item.name.startsWith(normalizedQuery));
}

export function removeActiveMarkdownSlashCommandCompletion(
  markdown: string,
  completion: MarkdownSlashCommandCompletion,
): MarkdownSlashCommandEdit {
  const nextNewline = markdown.indexOf('\n', completion.queryEnd);
  const removeEnd = nextNewline === -1 ? completion.queryEnd : nextNewline + 1;
  return {
    nextValue: `${markdown.slice(0, completion.triggerStart)}${markdown.slice(removeEnd)}`,
    selectionStart: completion.triggerStart,
    selectionEnd: completion.triggerStart,
  };
}

export function getMarkdownDrawCommandEdit(
  markdown: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownSlashCommandEdit | null {
  if (selectionStart !== selectionEnd) return null;
  const lineStart = markdown.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
  const nextNewline = markdown.indexOf('\n', selectionStart);
  const lineEnd = nextNewline === -1 ? markdown.length : nextNewline;
  const line = markdown.slice(lineStart, lineEnd);
  if (line.trim() !== '/draw') return null;

  return removeActiveMarkdownSlashCommandCompletion(markdown, {
    triggerStart: lineStart,
    queryStart: lineStart + 1,
    queryEnd: lineEnd,
    query: 'draw',
  });
}

export function insertMarkdownBlockAt(
  markdown: string,
  offset: number,
  block: string,
): MarkdownSlashCommandEdit {
  const insertion = Math.max(0, Math.min(offset, markdown.length));
  const needsLeadingBreak = insertion > 0 && markdown[insertion - 1] !== '\n';
  const text = `${needsLeadingBreak ? '\n\n' : ''}${block.trim()}\n\n`;
  const selection = insertion + text.length;
  return {
    nextValue: `${markdown.slice(0, insertion)}${text}${markdown.slice(insertion)}`,
    selectionStart: selection,
    selectionEnd: selection,
  };
}
