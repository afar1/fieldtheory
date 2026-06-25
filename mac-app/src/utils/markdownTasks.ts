export type MarkdownTaskShortcutEdit = {
  nextValue: string;
  selectionStart: number;
  selectionEnd: number;
};

export type MarkdownTaskLine = {
  indentation: string;
  bullet: string | null;
  checked: boolean;
  text: string;
  spacing: string;
};

export function parseMarkdownTaskLine(line: string): MarkdownTaskLine | null {
  const task = line.match(/^(\s*)(?:([-*+])\s*)?(\[( |x|X)?\])(\s+)(.*)$/);
  if (!task) return null;
  return {
    indentation: task[1],
    bullet: task[2] ?? null,
    checked: task[4]?.toLowerCase() === 'x',
    spacing: task[5],
    text: task[6],
  };
}

export function isCheckedMarkdownTaskLine(line: string): boolean {
  return parseMarkdownTaskLine(line)?.checked === true;
}

function selectedLineBounds(value: string, selectionStart: number, selectionEnd: number): { start: number; end: number } {
  const start = value.lastIndexOf('\n', Math.max(0, selectionStart - 1)) + 1;
  const endSearch = selectionEnd > selectionStart && value[selectionEnd - 1] === '\n'
    ? selectionEnd - 1
    : selectionEnd;
  const nextNewline = value.indexOf('\n', endSearch);
  return {
    start,
    end: nextNewline === -1 ? value.length : nextNewline,
  };
}

type MarkdownTaskCycleDirection = 'forward' | 'backward';

function cycleTaskLine(line: string, direction: MarkdownTaskCycleDirection): string {
  if (!line.trim()) return line;

  const task = parseMarkdownTaskLine(line);
  if (task) {
    if (direction === 'backward') {
      if (task.checked) return task.bullet ? `${task.indentation}${task.bullet} [ ] ${task.text}` : `${task.indentation}[ ] ${task.text}`;
      return `${task.indentation}${task.text}`;
    }
    if (task.checked) return `${task.indentation}${task.text}`;
    return task.bullet ? `${task.indentation}${task.bullet} [x] ${task.text}` : `${task.indentation}[x] ${task.text}`;
  }

  const list = line.match(/^(\s*)(?:[-*+]|\d+\.)\s*(.*)$/);
  if (list) return `${list[1]}- [${direction === 'backward' ? 'x' : ' '}] ${list[2]}`;

  const plain = line.match(/^(\s*)(.*)$/);
  return plain ? `${plain[1]}- [${direction === 'backward' ? 'x' : ' '}] ${plain[2]}` : line;
}

function toggleTaskCheckLine(line: string): string | null {
  const task = parseMarkdownTaskLine(line);
  if (!task) return null;
  const nextMarker = task.checked ? '[ ]' : '[x]';
  const prefix = task.bullet ? `${task.indentation}${task.bullet} ` : task.indentation;
  return `${prefix}${nextMarker}${task.spacing}${task.text}`;
}

export function getMarkdownTaskToggleEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number,
): MarkdownTaskShortcutEdit | null {
  const { start, end } = selectedLineBounds(value, selectionStart, selectionEnd);
  const block = value.slice(start, end);
  if (!block.trim()) return null;

  let changed = false;
  const nextBlock = block.split('\n').map((line) => {
    const nextLine = toggleTaskCheckLine(line);
    if (!nextLine) return line;
    changed = true;
    return nextLine;
  }).join('\n');
  if (!changed || nextBlock === block) return null;

  const nextValue = `${value.slice(0, start)}${nextBlock}${value.slice(end)}`;
  if (selectionStart === selectionEnd) {
    const nextSelection = Math.min(nextValue.length, selectionStart + (nextBlock.length - block.length));
    return { nextValue, selectionStart: nextSelection, selectionEnd: nextSelection };
  }

  return {
    nextValue,
    selectionStart: start,
    selectionEnd: start + nextBlock.length,
  };
}

export function getMarkdownTaskShortcutEdit(
  value: string,
  selectionStart: number,
  selectionEnd: number,
  direction: MarkdownTaskCycleDirection = 'forward',
): MarkdownTaskShortcutEdit | null {
  const { start, end } = selectedLineBounds(value, selectionStart, selectionEnd);
  const block = value.slice(start, end);
  if (!block.trim()) return null;

  const nextBlock = block.split('\n').map((line) => cycleTaskLine(line, direction)).join('\n');
  if (nextBlock === block) return null;

  const nextValue = `${value.slice(0, start)}${nextBlock}${value.slice(end)}`;
  if (selectionStart === selectionEnd) {
    const nextSelection = start + nextBlock.length;
    return { nextValue, selectionStart: nextSelection, selectionEnd: nextSelection };
  }

  return {
    nextValue,
    selectionStart: start,
    selectionEnd: start + nextBlock.length,
  };
}
