import { describe, expect, it } from 'vitest';
import { getMarkdownFormattingEdit } from '../utils/markdownFormatting';

describe('getMarkdownFormattingEdit', () => {
  it('wraps selected text in bold markdown markers', () => {
    expect(getMarkdownFormattingEdit('hello world', 0, 5, 'bold')).toEqual({
      nextValue: '**hello** world',
      selectionStart: 2,
      selectionEnd: 7,
    });
  });

	  it('inserts paired italic markers at the caret', () => {
	    expect(getMarkdownFormattingEdit('hello', 5, 5, 'italic')).toEqual({
	      nextValue: 'hello**',
	      selectionStart: 6,
	      selectionEnd: 6,
	    });
	  });

	  it('removes empty formatting placeholders when the same shortcut is pressed again', () => {
	    expect(getMarkdownFormattingEdit('hello ****', 8, 8, 'bold')).toEqual({
	      nextValue: 'hello ',
	      selectionStart: 6,
	      selectionEnd: 6,
	    });
	    expect(getMarkdownFormattingEdit('hello **', 7, 7, 'italic')).toEqual({
	      nextValue: 'hello ',
	      selectionStart: 6,
	      selectionEnd: 6,
	    });
	    expect(getMarkdownFormattingEdit('hello <u></u>', 9, 9, 'underline')).toEqual({
	      nextValue: 'hello ',
	      selectionStart: 6,
	      selectionEnd: 6,
	    });
	  });

	  it('uses inline HTML for underline because markdown has no native underline marker', () => {
	    expect(getMarkdownFormattingEdit('mark me', 0, 4, 'underline')).toEqual({
      nextValue: '<u>mark</u> me',
      selectionStart: 3,
      selectionEnd: 7,
    });
  });

  it('unwraps text when the selection is already surrounded by the same markers', () => {
    expect(getMarkdownFormattingEdit('**hello** world', 2, 7, 'bold')).toEqual({
      nextValue: 'hello world',
      selectionStart: 0,
      selectionEnd: 5,
    });
  });

  it('unwraps text when the selected range includes its markers', () => {
    expect(getMarkdownFormattingEdit('**hello** world', 0, 9, 'bold')).toEqual({
      nextValue: 'hello world',
      selectionStart: 0,
      selectionEnd: 5,
    });
  });

  it('adds italic markers around bold text instead of peeling off one bold marker', () => {
    expect(getMarkdownFormattingEdit('**hello**', 2, 7, 'italic')).toEqual({
      nextValue: '***hello***',
      selectionStart: 3,
      selectionEnd: 8,
    });
  });
});
