export type MarkdownTodoState = 'open' | 'done';

export type ParsedMarkdownFrontmatter = {
  body: string;
  raw: string | null;
  lines: string[];
  meta: Record<string, string>;
};

function stripYamlScalar(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function parseMarkdownFrontmatter(content: string): ParsedMarkdownFrontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { body: content, raw: null, lines: [], meta: {} };

  const raw = match[1];
  const meta: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const field = line.match(/^([A-Za-z][\w-]*):\s*(.*?)\s*$/);
    if (field) meta[field[1].replace(/-/g, '_').toLowerCase()] = stripYamlScalar(field[2]);
  }

  return { body: match[2].replace(/^\n+/, ''), raw, lines, meta };
}

function normalizeMarkdownTodoState(value: string | undefined): MarkdownTodoState | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'open') return 'open';
  if (normalized === 'done') return 'done';
  return null;
}

function isTruthyYamlScalar(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'true' || normalized === 'yes' || normalized === '1';
}

function isFalsyYamlScalar(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'false' || normalized === 'no' || normalized === '0';
}

export function getMarkdownTodoState(meta: Record<string, string>): MarkdownTodoState | null {
  const declaredTodo = meta.todo ?? meta.task;
  if (isFalsyYamlScalar(declaredTodo)) return null;

  const state = normalizeMarkdownTodoState(meta.todo_state ?? meta.task_state)
    ?? normalizeMarkdownTodoState(declaredTodo);
  if (state) return state;

  return isTruthyYamlScalar(declaredTodo) ? 'open' : null;
}

export function parseMarkdownTodoState(content: string): MarkdownTodoState | null {
  return getMarkdownTodoState(parseMarkdownFrontmatter(content).meta);
}

export function getMarkdownArchivedState(meta: Record<string, string>): boolean {
  return isTruthyYamlScalar(meta.archived);
}

export function parseMarkdownArchivedState(content: string): boolean {
  return getMarkdownArchivedState(parseMarkdownFrontmatter(content).meta);
}

export function parseMarkdownContentEditedAt(content: string): number | null {
  const value = parseMarkdownFrontmatter(content).meta.content_edited_at;
  if (!value) return null;
  const numeric = Number.parseInt(value, 10);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsedDate = Date.parse(value);
  return Number.isFinite(parsedDate) ? parsedDate : null;
}

export function setMarkdownContentEditedAt(content: string, timestamp = Date.now()): string {
  const parsed = parseMarkdownFrontmatter(content);
  const body = parsed.raw === null ? content : parsed.body;
  const frontmatterLines = parsed.raw?.trim()
    ? parsed.lines.filter((line) => !/^\s*content_edited_at\s*:/i.test(line))
    : [];
  const nextLines = [
    ...frontmatterLines,
    ...(frontmatterLines.length > 0 ? [''] : []),
    `content_edited_at: ${Math.max(0, Math.floor(timestamp))}`,
  ];
  return `---\n${nextLines.join('\n')}\n---\n\n${body}`;
}

export function stampMarkdownContentEditIfBodyChanged(
  previousContent: string,
  nextContent: string,
  timestamp = Date.now(),
): string {
  const previousBody = parseMarkdownFrontmatter(previousContent).body;
  const nextBody = parseMarkdownFrontmatter(nextContent).body;
  if (previousBody === nextBody) return nextContent;
  return setMarkdownContentEditedAt(nextContent, timestamp);
}

export function setMarkdownTodoState(content: string, nextState: MarkdownTodoState | null): string {
  const parsed = parseMarkdownFrontmatter(content);
  const body = parsed.raw === null ? content : parsed.body;
  const frontmatterLines = parsed.raw?.trim()
    ? parsed.lines.filter((line) => !/^\s*(todo|task|todo_state|task_state)\s*:/i.test(line))
    : [];
  const retainedLines = frontmatterLines.filter((line) => line.trim().length > 0);

  if (!nextState) {
    if (retainedLines.length === 0) return body;
    return `---\n${frontmatterLines.join('\n')}\n---\n\n${body}`;
  }

  const nextLines = [
    ...frontmatterLines,
    ...(frontmatterLines.length > 0 ? [''] : []),
    'todo: true',
    `todo_state: ${nextState}`,
  ];
  return `---\n${nextLines.join('\n')}\n---\n\n${body}`;
}

export function setMarkdownArchivedState(content: string, archived: boolean): string {
  const parsed = parseMarkdownFrontmatter(content);
  const body = parsed.raw === null ? content : parsed.body;
  const frontmatterLines = parsed.raw?.trim()
    ? parsed.lines.filter((line) => !/^\s*archived\s*:/i.test(line))
    : [];
  const retainedLines = frontmatterLines.filter((line) => line.trim().length > 0);

  if (!archived) {
    if (retainedLines.length === 0) return body;
    return `---\n${frontmatterLines.join('\n')}\n---\n\n${body}`;
  }

  const nextLines = [
    ...frontmatterLines,
    ...(frontmatterLines.length > 0 ? [''] : []),
    'archived: true',
  ];
  return `---\n${nextLines.join('\n')}\n---\n\n${body}`;
}
