import { describe, expect, it } from 'vitest';
import { getMarkdownTaskShortcutEdit, getMarkdownTaskToggleEdit } from '../utils/markdownTasks';

describe('getMarkdownTaskShortcutEdit', () => {
  it('turns the current plain line into an unchecked task', () => {
    expect(getMarkdownTaskShortcutEdit('before\nwrite tests\nafter', 12, 12)).toEqual({
      nextValue: 'before\n- [ ] write tests\nafter',
      selectionStart: 24,
      selectionEnd: 24,
    });
  });

  it('turns selected plain lines into unchecked tasks', () => {
    expect(getMarkdownTaskShortcutEdit('alpha\nbeta', 0, 10)).toEqual({
      nextValue: '- [ ] alpha\n- [ ] beta',
      selectionStart: 0,
      selectionEnd: 22,
    });
  });

  it('cycles unchecked tasks to checked tasks', () => {
    expect(getMarkdownTaskShortcutEdit('- [ ] alpha', 0, 0)?.nextValue).toBe('- [x] alpha');
  });

  it('cycles bare unchecked tasks without adding a bullet marker', () => {
    expect(getMarkdownTaskShortcutEdit('[] alpha', 0, 0)?.nextValue).toBe('[x] alpha');
    expect(getMarkdownTaskShortcutEdit('[ ] alpha', 0, 0)?.nextValue).toBe('[x] alpha');
  });

  it('cycles checked tasks back to plain text', () => {
    expect(getMarkdownTaskShortcutEdit('- [x] alpha', 0, 0)?.nextValue).toBe('alpha');
    expect(getMarkdownTaskShortcutEdit('[x] alpha', 0, 0)?.nextValue).toBe('alpha');
  });

  it('advances each selected line one step', () => {
    expect(getMarkdownTaskShortcutEdit('alpha\n- [ ] beta\n- [x] gamma', 0, 28)?.nextValue).toBe(
      '- [ ] alpha\n- [x] beta\ngamma',
    );
  });

  it('cycles selected lines backward one step', () => {
    expect(getMarkdownTaskShortcutEdit('alpha\n- [ ] beta\n- [x] gamma', 0, 28, 'backward')?.nextValue).toBe(
      '- [x] alpha\nbeta\n- [ ] gamma',
    );
  });

  it('does not include a trailing unselected line when the selection ends at a newline', () => {
    expect(getMarkdownTaskShortcutEdit('alpha\nbeta\ngamma', 0, 11)).toEqual({
      nextValue: '- [ ] alpha\n- [ ] beta\ngamma',
      selectionStart: 0,
      selectionEnd: 22,
    });
  });

  it('preserves indentation and strips ordinary list markers when creating tasks', () => {
    expect(getMarkdownTaskShortcutEdit('  - nested', 4, 4)?.nextValue).toBe('  - [ ] nested');
  });
});

describe('getMarkdownTaskToggleEdit', () => {
  it('checks and unchecks bullet task lines', () => {
    expect(getMarkdownTaskToggleEdit('- [ ] alpha', 0, 0)?.nextValue).toBe('- [x] alpha');
    expect(getMarkdownTaskToggleEdit('- [x] alpha', 0, 0)?.nextValue).toBe('- [ ] alpha');
  });

  it('checks and unchecks bare task lines', () => {
    expect(getMarkdownTaskToggleEdit('[] alpha', 0, 0)?.nextValue).toBe('[x] alpha');
    expect(getMarkdownTaskToggleEdit('[ ] alpha', 0, 0)?.nextValue).toBe('[x] alpha');
    expect(getMarkdownTaskToggleEdit('[x] alpha', 0, 0)?.nextValue).toBe('[ ] alpha');
  });

  it('toggles selected task lines without changing plain lines', () => {
    expect(getMarkdownTaskToggleEdit('- [ ] alpha\nplain\n[x] beta', 0, 25)?.nextValue).toBe(
      '- [x] alpha\nplain\n[ ] beta',
    );
  });

  it('does nothing when the current line is not a task', () => {
    expect(getMarkdownTaskToggleEdit('plain', 0, 0)).toBeNull();
  });
});
