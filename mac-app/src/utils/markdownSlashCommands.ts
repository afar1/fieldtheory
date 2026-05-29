export interface MarkdownSlashCommandEdit {
  nextValue: string;
  selectionStart: number;
  selectionEnd: number;
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

  const removeEnd = nextNewline === -1 ? lineEnd : lineEnd + 1;
  return {
    nextValue: `${markdown.slice(0, lineStart)}${markdown.slice(removeEnd)}`,
    selectionStart: lineStart,
    selectionEnd: lineStart,
  };
}

export function insertMarkdownBlockAt(
  markdown: string,
  offset: number,
  block: string,
): MarkdownSlashCommandEdit {
  const insertion = Math.max(0, Math.min(offset, markdown.length));
  const needsLeadingBreak = insertion > 0 && markdown[insertion - 1] !== '\n';
  const needsTrailingBreak = insertion < markdown.length && markdown[insertion] !== '\n';
  const text = `${needsLeadingBreak ? '\n\n' : ''}${block.trim()}\n${needsTrailingBreak ? '\n' : ''}`;
  const selection = insertion + text.length;
  return {
    nextValue: `${markdown.slice(0, insertion)}${text}${markdown.slice(insertion)}`,
    selectionStart: selection,
    selectionEnd: selection,
  };
}
