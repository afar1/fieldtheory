import { describe, expect, it } from 'vitest';
import {
  getActiveMarkdownSlashCommandCompletion,
  getMarkdownDrawCommandEdit,
  insertMarkdownBlockAt,
  rankMarkdownSlashCommandSuggestions,
  removeActiveMarkdownSlashCommandCompletion,
} from './markdownSlashCommands';

describe('markdown slash commands', () => {
  it('detects a slash command query at the start of a line', () => {
    expect(getActiveMarkdownSlashCommandCompletion('before\n/d', 9, 9)).toEqual({
      triggerStart: 7,
      queryStart: 8,
      queryEnd: 9,
      query: 'd',
    });
  });

  it('ignores slash commands inside normal sentences', () => {
    expect(getActiveMarkdownSlashCommandCompletion('before /d', 9, 9)).toBeNull();
  });

  it('ranks the draw command by prefix', () => {
    expect(rankMarkdownSlashCommandSuggestions('dr').map((item) => item.name)).toEqual(['draw']);
  });

  it('removes a standalone /draw line and leaves the insertion point there', () => {
    const markdown = 'before\n/draw\nafter';
    const edit = getMarkdownDrawCommandEdit(markdown, 12, 12);

    expect(edit).toEqual({
      nextValue: 'before\nafter',
      selectionStart: 7,
      selectionEnd: 7,
    });
  });

  it('removes the active slash command completion line', () => {
    const markdown = 'before\n/d\nafter';
    const completion = getActiveMarkdownSlashCommandCompletion(markdown, 9, 9);
    expect(completion).not.toBeNull();

    expect(removeActiveMarkdownSlashCommandCompletion(markdown, completion!)).toEqual({
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
