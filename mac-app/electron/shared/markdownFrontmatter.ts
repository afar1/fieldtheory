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
