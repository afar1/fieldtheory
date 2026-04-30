export type MarkdownTaskShortcutEdit = {
  nextValue: string;
  selectionStart: number;
  selectionEnd: number;
};

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

  const task = line.match(/^(\s*)(?:([-*+])\s*)?(\[( |x|X)?\])\s+(.+)$/);
  if (task) {
    const checked = task[4]?.toLowerCase() === 'x';
    if (direction === 'backward') {
      if (checked) return task[2] ? `${task[1]}${task[2]} [ ] ${task[5]}` : `${task[1]}[ ] ${task[5]}`;
      return `${task[1]}${task[5]}`;
    }
    if (checked) return `${task[1]}${task[5]}`;
    return task[2] ? `${task[1]}${task[2]} [x] ${task[5]}` : `${task[1]}[x] ${task[5]}`;
  }

  const list = line.match(/^(\s*)(?:[-*+]|\d+\.)\s+(.+)$/);
  if (list) return `${list[1]}- [${direction === 'backward' ? 'x' : ' '}] ${list[2]}`;

  const plain = line.match(/^(\s*)(.*)$/);
  return plain ? `${plain[1]}- [${direction === 'backward' ? 'x' : ' '}] ${plain[2]}` : line;
}

function toggleTaskCheckLine(line: string): string | null {
  const task = line.match(/^(\s*)(?:([-*+])\s*)?(\[( |x|X)?\])(\s+.*)$/);
  if (!task) return null;
  const checked = task[4]?.toLowerCase() === 'x';
  const nextMarker = checked ? '[ ]' : '[x]';
  const prefix = task[2] ? `${task[1]}${task[2]} ` : task[1];
  return `${prefix}${nextMarker}${task[5]}`;
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
