import { describe, expect, it } from 'vitest';
import { getMarkdownDrawCommandEdit, insertMarkdownBlockAt } from './markdownSlashCommands';

describe('markdown slash commands', () => {
  it('removes a standalone /draw line and leaves the insertion point there', () => {
    const markdown = 'before\n/draw\nafter';
    const edit = getMarkdownDrawCommandEdit(markdown, 12, 12);

    expect(edit).toEqual({
      nextValue: 'before\nafter',
      selectionStart: 7,
      selectionEnd: 7,
    });
  });

  it('ignores /draw when it is part of a normal sentence', () => {
    expect(getMarkdownDrawCommandEdit('before /draw', 12, 12)).toBeNull();
  });

  it('inserts a drawing block with paragraph spacing when needed', () => {
    const edit = insertMarkdownBlockAt('before\nafter', 7, '![Drawing](<./.assets/drawing.png>)');

    expect(edit.nextValue).toBe('before\n![Drawing](<./.assets/drawing.png>)\n\nafter');
    expect(edit.selectionStart).toBe(edit.nextValue.indexOf('after'));
  });
});
