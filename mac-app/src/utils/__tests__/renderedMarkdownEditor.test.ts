import { describe, expect, it } from 'vitest';
import {
  getTrustedRenderedCaretSourceOffset,
  RENDERED_BLANK_LINE_ATTR,
  RENDERED_TRAILING_SPACE_ATTR,
  getRenderedBeforeInputType,
  getRenderedBeforeInputData,
  getRenderedMarkdownInputEditAtSourceOffset,
  getRenderedMarkdownInputEditFromSelection,
  getRenderedMarkdownRangeFromSelection,
  getRenderedMarkdownTextNodeSourceRanges,
  resolveMarkdownCaretOffsetFromRenderedTextNode,
  setRenderedMarkdownSelectionAtOffset,
  setRenderedMarkdownSelectionFromPoint,
  shouldHandleRenderedKeyDownEdit,
} from '../renderedMarkdownEditor';

function selectText(root: HTMLElement, startNode: Text, startOffset: number, endNode = startNode, endOffset = startOffset): Selection {
  const range = document.createRange();
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const selection = root.ownerDocument.getSelection();
  if (!selection) throw new Error('Selection API unavailable');
  selection.removeAllRanges();
  selection.addRange(range);
  return selection;
}

describe('rendered markdown source mapping', () => {
  it('maps repeated rendered text nodes by DOM order', () => {
    const root = document.createElement('div');
    const first = document.createElement('p');
    const second = document.createElement('p');
    first.textContent = 'Do: review';
    second.textContent = 'Do: test';
    root.append(first, second);

    const ranges = getRenderedMarkdownTextNodeSourceRanges(root, 'Do: review\nDo: test');

    expect(ranges.map((range) => ({ text: range.text, start: range.start, end: range.end }))).toEqual([
      { text: 'Do: review', start: 0, end: 10 },
      { text: 'Do: test', start: 11, end: 19 },
    ]);
  });

  it('resolves a clicked repeated rendered text node to its own markdown range', () => {
    const root = document.createElement('div');
    const first = document.createElement('p');
    const second = document.createElement('p');
    first.textContent = 'Do: review';
    second.textContent = 'Do: test';
    root.append(first, second);

    expect(resolveMarkdownCaretOffsetFromRenderedTextNode(
      root,
      'Do: review\nDo: test',
      second.firstChild as Text,
      4,
    )).toBe(15);
  });

  it('ignores non-editable rendered chrome when mapping text nodes', () => {
    const root = document.createElement('div');
    const body = document.createElement('p');
    const linked = document.createElement('section');
    body.textContent = 'Body';
    linked.textContent = 'Body';
    linked.contentEditable = 'false';
    root.append(body, linked);

    const ranges = getRenderedMarkdownTextNodeSourceRanges(root, 'Body');

    expect(ranges).toHaveLength(1);
    expect(ranges[0].node).toBe(body.firstChild);
  });

  it('maps rendered blank-line placeholders to their source caret point', () => {
    const root = document.createElement('div');
    const first = document.createElement('p');
    const blank = document.createElement('p');
    const second = document.createElement('p');
    first.textContent = 'First';
    blank.textContent = '\u00A0';
    blank.setAttribute(RENDERED_BLANK_LINE_ATTR, 'true');
    second.textContent = 'Second';
    root.append(first, blank, second);

    const ranges = getRenderedMarkdownTextNodeSourceRanges(root, 'First\n\nSecond');

    expect(ranges.map((range) => ({ text: range.text, start: range.start, end: range.end }))).toEqual([
      { text: 'First', start: 0, end: 5 },
      { text: '\u00A0', start: 6, end: 6 },
      { text: 'Second', start: 7, end: 13 },
    ]);
  });

  it('maps rendered spaces-only placeholders back to source spaces', () => {
    const root = document.createElement('div');
    const blank = document.createElement('p');
    blank.textContent = '\u00A0\u00A0';
    blank.setAttribute(RENDERED_BLANK_LINE_ATTR, 'true');
    root.append(blank);

    const ranges = getRenderedMarkdownTextNodeSourceRanges(root, '  ');

    expect(ranges.map((range) => ({ text: range.text, start: range.start, end: range.end }))).toEqual([
      { text: '\u00A0\u00A0', start: 0, end: 2 },
    ]);
  });

  it('ignores generated newline text nodes when mapping text nodes', () => {
    const root = document.createElement('div');
    const first = document.createElement('p');
    const second = document.createElement('p');
    const generatedNewline = document.createTextNode('\n');
    first.textContent = 'First';
    second.textContent = 'Second';
    root.append(first, generatedNewline, second);

    const ranges = getRenderedMarkdownTextNodeSourceRanges(root, 'First\nSecond');

    expect(ranges.map((range) => ({ text: range.text, start: range.start, end: range.end }))).toEqual([
      { text: 'First', start: 0, end: 5 },
      { text: 'Second', start: 6, end: 12 },
    ]);
  });

  it('maps rendered trailing-space placeholders back to source spaces', () => {
    const root = document.createElement('div');
    const paragraph = document.createElement('p');
    const trailing = document.createElement('span');
    paragraph.append('hello');
    trailing.setAttribute(RENDERED_TRAILING_SPACE_ATTR, 'true');
    trailing.textContent = '\u00A0';
    paragraph.append(trailing);
    root.append(paragraph);

    const ranges = getRenderedMarkdownTextNodeSourceRanges(root, 'hello ');

    expect(ranges.map((range) => ({ text: range.text, start: range.start, end: range.end }))).toEqual([
      { text: 'hello', start: 0, end: 5 },
      { text: '\u00A0', start: 5, end: 6 },
    ]);
  });
});

describe('trusted rendered caret source offsets', () => {
  it('normalizes approximate restores to the nearest real DOM source offset', () => {
    expect(getTrustedRenderedCaretSourceOffset({
      approximate: true,
      domSourceOffset: 235,
    }, 237)).toBe(235);
  });

  it('keeps exact restores at the requested source offset', () => {
    expect(getTrustedRenderedCaretSourceOffset({
      approximate: false,
      domSourceOffset: 235,
    }, 237)).toBe(237);
  });
});

describe('rendered markdown native text-field edits', () => {
  const textSelection = {
    exists: true,
    rangeCount: 1,
    isCollapsed: true,
    startNodeType: 3,
    endNodeType: 3,
  };
  const boundarySelection = {
    exists: true,
    rangeCount: 1,
    isCollapsed: true,
    startNodeType: 1,
    endNodeType: 1,
  };

  it('infers insertText when Electron beforeinput omits inputType', () => {
    expect(getRenderedBeforeInputType({ data: 'a' })).toBe('insertText');
    expect(getRenderedBeforeInputType({ data: ' ' })).toBe('insertText');
    expect(getRenderedBeforeInputType({ key: ' ' })).toBe('insertText');
    expect(getRenderedBeforeInputType({ data: '\n' })).toBe('insertParagraph');
    expect(getRenderedBeforeInputType({ data: null, key: 'Backspace' })).toBe('deleteContentBackward');
    expect(getRenderedBeforeInputType({ key: 'Backspace', altKey: true })).toBe('deleteWordBackward');
    expect(getRenderedBeforeInputType({ key: 'Backspace', metaKey: true })).toBe('deleteHardLineBackward');
    expect(getRenderedBeforeInputType({ key: 'Delete', altKey: true })).toBe('deleteWordForward');
    expect(getRenderedBeforeInputType({ key: 'Delete', metaKey: true })).toBe('deleteHardLineForward');
    expect(getRenderedBeforeInputType({ key: 'Enter', shiftKey: true })).toBe('insertLineBreak');
  });

  it('reads pasted text from dataTransfer when beforeinput data is empty', () => {
    expect(getRenderedBeforeInputData({
      data: '',
      dataTransferText: ' pasted',
      fallbackKey: null,
    })).toBe(' pasted');
    expect(getRenderedBeforeInputData({
      data: null,
      dataTransferText: '',
      fallbackKey: 'x',
    })).toBe('x');
  });

  it('intercepts rendered delete keys including macOS modified deletes', () => {
    expect(shouldHandleRenderedKeyDownEdit({
      inputType: 'deleteContentBackward',
      selection: textSelection,
    })).toBe(true);
    expect(shouldHandleRenderedKeyDownEdit({
      inputType: 'deleteHardLineBackward',
      selection: boundarySelection,
      metaKey: true,
    })).toBe(true);
    expect(shouldHandleRenderedKeyDownEdit({
      inputType: 'deleteWordBackward',
      selection: textSelection,
      altKey: true,
    })).toBe(true);
  });

  it('leaves ordinary command shortcuts to the platform', () => {
    expect(shouldHandleRenderedKeyDownEdit({
      inputType: 'insertText',
      selection: textSelection,
      metaKey: true,
    })).toBe(false);
    expect(shouldHandleRenderedKeyDownEdit({
      inputType: 'insertText',
      selection: boundarySelection,
      metaKey: true,
    })).toBe(false);
  });

  it('leaves printable rendered text to beforeinput source transactions', () => {
    expect(shouldHandleRenderedKeyDownEdit({
      inputType: 'insertText',
      selection: textSelection,
    })).toBe(false);
    expect(shouldHandleRenderedKeyDownEdit({
      inputType: 'insertText',
      selection: boundarySelection,
    })).toBe(false);
  });

  it('inserts typed text from the editable DOM selection', () => {
    const root = document.createElement('div');
    const paragraph = document.createElement('p');
    const strong = document.createElement('strong');
    strong.textContent = 'world';
    paragraph.append('hello ', strong);
    root.append(paragraph);
    const selection = selectText(root, strong.firstChild as Text, 3);

    expect(getRenderedMarkdownInputEditFromSelection(
      'hello **world**',
      root,
      selection,
      'insertText',
      '!',
    )).toEqual({
      nextValue: 'hello **wor!ld**',
      selectionStart: 12,
      selectionEnd: 12,
    });
  });

  it('treats Space as rendered source input', () => {
    const root = document.createElement('div');
    const paragraph = document.createElement('p');
    paragraph.textContent = 'hello';
    root.append(paragraph);
    const selection = selectText(root, paragraph.firstChild as Text, 3);

    expect(getRenderedMarkdownInputEditFromSelection(
      'hello',
      root,
      selection,
      'insertText',
      ' ',
    )).toEqual({
      nextValue: 'hel lo',
      selectionStart: 4,
      selectionEnd: 4,
    });
  });

  it('pastes plain text through the rendered source input path', () => {
    const root = document.createElement('div');
    const paragraph = document.createElement('p');
    paragraph.textContent = 'hello';
    root.append(paragraph);
    const selection = selectText(root, paragraph.firstChild as Text, 5);

    expect(getRenderedMarkdownInputEditFromSelection(
      'hello',
      root,
      selection,
      'insertFromPaste',
      ' world',
    )).toEqual({
      nextValue: 'hello world',
      selectionStart: 11,
      selectionEnd: 11,
    });
  });

  it('can apply native input from the last trusted source caret', () => {
    expect(getRenderedMarkdownInputEditAtSourceOffset(
      '*hello* world',
      6,
      'insertText',
      '!',
    )).toEqual({
      nextValue: '*hello!* world',
      selectionStart: 7,
      selectionEnd: 7,
    });
  });

  it('keeps source-offset typing after hidden trailing whitespace', () => {
    expect(getRenderedMarkdownInputEditAtSourceOffset(
      'hello \nworld',
      6,
      'insertText',
      'v',
    )).toEqual({
      nextValue: 'hello v\nworld',
      selectionStart: 7,
      selectionEnd: 7,
    });
  });

  it('deletes selected rendered text without relying on a keydown shim', () => {
    const root = document.createElement('div');
    const paragraph = document.createElement('p');
    paragraph.textContent = 'hello';
    root.append(paragraph);
    const selection = selectText(root, paragraph.firstChild as Text, 1, paragraph.firstChild as Text, 4);

    expect(getRenderedMarkdownInputEditFromSelection(
      'hello',
      root,
      selection,
      'deleteContentBackward',
    )).toEqual({
      nextValue: 'ho',
      selectionStart: 1,
      selectionEnd: 1,
    });
  });

  it('joins a rendered line with the previous line when Backspace starts the line', () => {
    const root = document.createElement('div');
    const first = document.createElement('p');
    const second = document.createElement('p');
    first.textContent = 'hello';
    second.textContent = 'world';
    root.append(first, second);
    const selection = selectText(root, second.firstChild as Text, 0);

    expect(getRenderedMarkdownInputEditFromSelection(
      'hello\nworld',
      root,
      selection,
      'deleteContentBackward',
    )).toEqual({
      nextValue: 'helloworld',
      selectionStart: 5,
      selectionEnd: 5,
    });
  });

  it('does not let Backspace delete markdown syntax before a rendered text node', () => {
    const root = document.createElement('div');
    const heading = document.createElement('h1');
    heading.textContent = 'Title';
    root.append(heading);
    const selection = selectText(root, heading.firstChild as Text, 0);

    expect(getRenderedMarkdownInputEditFromSelection(
      '# Title',
      root,
      selection,
      'deleteContentBackward',
    )).toBeNull();
  });

  it('types inside a rendered markdown link label without touching the target', () => {
    const root = document.createElement('div');
    const paragraph = document.createElement('p');
    const link = document.createElement('a');
    link.href = 'https://field.test';
    link.textContent = 'Field Theory';
    paragraph.append(link);
    root.append(paragraph);
    const selection = selectText(root, link.firstChild as Text, 5);

    expect(getRenderedMarkdownInputEditFromSelection(
      '[Field Theory](https://field.test)',
      root,
      selection,
      'insertText',
      'ed',
    )).toEqual({
      nextValue: '[Fielded Theory](https://field.test)',
      selectionStart: 8,
      selectionEnd: 8,
    });
  });

  it('does not let Backspace delete the markdown list marker before a rendered item', () => {
    const root = document.createElement('div');
    const list = document.createElement('ul');
    const item = document.createElement('li');
    item.textContent = 'First item';
    list.append(item);
    root.append(list);
    const selection = selectText(root, item.firstChild as Text, 0);

    expect(getRenderedMarkdownInputEditFromSelection(
      '- First item',
      root,
      selection,
      'deleteContentBackward',
    )).toBeNull();
  });

  it('deletes the previous word from a rendered source caret', () => {
    expect(getRenderedMarkdownInputEditAtSourceOffset(
      'hello brave world',
      12,
      'deleteWordBackward',
    )).toEqual({
      nextValue: 'hello world',
      selectionStart: 6,
      selectionEnd: 6,
    });
  });

  it('deletes the previous word and its trailing space from a rendered trailing-space caret', () => {
    const root = document.createElement('div');
    const paragraph = document.createElement('p');
    const trailing = document.createElement('span');
    paragraph.append('hello brave');
    trailing.setAttribute(RENDERED_TRAILING_SPACE_ATTR, 'true');
    trailing.textContent = '\u00A0';
    paragraph.append(trailing);
    root.append(paragraph);
    const selection = selectText(root, trailing.firstChild as Text, 1);

    expect(getRenderedMarkdownInputEditFromSelection(
      'hello brave ',
      root,
      selection,
      'deleteWordBackward',
    )).toEqual({
      nextValue: 'hello',
      selectionStart: 5,
      selectionEnd: 5,
    });
  });

  it('inserts text from a rendered blank-line caret', () => {
    const root = document.createElement('div');
    const first = document.createElement('p');
    const blank = document.createElement('p');
    first.textContent = 'hello';
    blank.setAttribute(RENDERED_BLANK_LINE_ATTR, 'true');
    blank.textContent = '\u00A0';
    root.append(first, blank);

    expect(setRenderedMarkdownSelectionAtOffset(root, 'hello\n', 6)).toMatchObject({
      sourceOffset: 6,
      domSourceOffset: 6,
      restoreTarget: 'exact',
    });
    expect(root.ownerDocument.getSelection()?.focusNode).toBe(blank.firstChild);

    expect(getRenderedMarkdownInputEditFromSelection(
      'hello\n',
      root,
      root.ownerDocument.getSelection(),
      'insertText',
      'x',
    )).toEqual({
      nextValue: 'hello\nx',
      selectionStart: 7,
      selectionEnd: 7,
    });
  });

  it('inserts text after leading spaces on a rendered blank page', () => {
    const root = document.createElement('div');
    const blank = document.createElement('p');
    blank.setAttribute(RENDERED_BLANK_LINE_ATTR, 'true');
    blank.textContent = '\u00A0\u00A0';
    root.append(blank);

    expect(setRenderedMarkdownSelectionAtOffset(root, '  ', 2)).toMatchObject({
      sourceOffset: 2,
      domSourceOffset: 2,
      approximate: false,
    });
    expect(root.ownerDocument.getSelection()?.focusNode).toBe(blank.firstChild);
    expect(root.ownerDocument.getSelection()?.focusOffset).toBe(2);

    expect(getRenderedMarkdownInputEditFromSelection(
      '  ',
      root,
      root.ownerDocument.getSelection(),
      'insertText',
      'x',
    )).toEqual({
      nextValue: '  x',
      selectionStart: 3,
      selectionEnd: 3,
    });
  });

  it('deletes to the start of the rendered line from a DOM selection', () => {
    const root = document.createElement('div');
    const paragraph = document.createElement('p');
    paragraph.textContent = 'first line\nsecond line';
    root.append(paragraph);
    const selection = selectText(root, paragraph.firstChild as Text, 17);

    expect(getRenderedMarkdownInputEditFromSelection(
      'first line\nsecond line',
      root,
      selection,
      'deleteHardLineBackward',
    )).toEqual({
      nextValue: 'first line\n line',
      selectionStart: 11,
      selectionEnd: 11,
    });
  });

  it('deletes to the end of the rendered line from a source caret', () => {
    expect(getRenderedMarkdownInputEditAtSourceOffset(
      'first line\nsecond line',
      17,
      'deleteHardLineForward',
    )).toEqual({
      nextValue: 'first line\nsecond',
      selectionStart: 17,
      selectionEnd: 17,
    });
  });

  it('maps line deletion from a rendered element-boundary selection', () => {
    const root = document.createElement('div');
    const first = document.createElement('p');
    const second = document.createElement('p');
    first.textContent = 'first line';
    second.textContent = 'second line';
    root.append(first, second);
    const range = document.createRange();
    range.setStart(root, 2);
    range.collapse(true);
    const selection = root.ownerDocument.getSelection();
    if (!selection) throw new Error('Selection API unavailable');
    selection.removeAllRanges();
    selection.addRange(range);

    expect(getRenderedMarkdownInputEditFromSelection(
      'first line\nsecond line',
      root,
      selection,
      'deleteHardLineBackward',
    )).toEqual({
      nextValue: 'first line\n',
      selectionStart: 11,
      selectionEnd: 11,
    });
  });

  it('falls back from rendered text offsets when markdown syntax splits the source', () => {
    const root = document.createElement('div');
    const paragraph = document.createElement('p');
    paragraph.textContent = 'hello world';
    root.append(paragraph);
    const selection = selectText(root, paragraph.firstChild as Text, 5);

    expect(getRenderedMarkdownInputEditFromSelection(
      '*hello* world',
      root,
      selection,
      'insertText',
      '!',
    )).toEqual({
      nextValue: '*hello!* world',
      selectionStart: 7,
      selectionEnd: 7,
    });
  });

  it('uses rendered offset fallback for selected text across markdown syntax', () => {
    const root = document.createElement('div');
    const paragraph = document.createElement('p');
    paragraph.textContent = 'hello world';
    root.append(paragraph);
    const selection = selectText(root, paragraph.firstChild as Text, 0, paragraph.firstChild as Text, 5);

    expect(getRenderedMarkdownInputEditFromSelection(
      '*hello* world',
      root,
      selection,
      'insertText',
      'hi',
    )).toEqual({
      nextValue: '*hi* world',
      selectionStart: 3,
      selectionEnd: 3,
    });
  });

  it('maps a rendered selection range even when selected text repeats', () => {
    const root = document.createElement('div');
    const first = document.createElement('p');
    const second = document.createElement('p');
    first.textContent = 'hello';
    second.textContent = 'hello';
    root.append(first, second);
    const selection = selectText(root, second.firstChild as Text, 0, second.firstChild as Text, 5);

    expect(getRenderedMarkdownRangeFromSelection('hello\n\nhello', root, selection)).toMatchObject({
      start: 7,
      end: 12,
    });
  });

  it('restores native selection near markdown line boundaries', () => {
    const root = document.createElement('div');
    const first = document.createElement('p');
    const second = document.createElement('p');
    first.textContent = 'One';
    second.textContent = 'Two';
    root.append(first, second);

    expect(setRenderedMarkdownSelectionAtOffset(root, 'One\nTwo', 4)).toMatchObject({
      sourceOffset: 4,
      domSourceOffset: 4,
      approximate: false,
    });
  });

  it('restores approximate selections to the nearest rendered boundary', () => {
    const root = document.createElement('div');
    const heading = document.createElement('h1');
    const body = document.createElement('p');
    heading.textContent = 'Title';
    body.textContent = 'Body';
    root.append(heading, body);

    expect(setRenderedMarkdownSelectionAtOffset(root, '# Title\n\nBody', 8)).toMatchObject({
      sourceOffset: 8,
      domSourceOffset: 7,
      approximate: true,
      restoreTarget: 'previous-boundary',
      sourceDistance: 1,
    });
    expect(root.ownerDocument.getSelection()?.focusNode).toBe(heading.firstChild);
    expect(root.ownerDocument.getSelection()?.focusOffset).toBe(5);
  });

  it('restores native selection into rendered trailing-space placeholders', () => {
    const root = document.createElement('div');
    const paragraph = document.createElement('p');
    const trailing = document.createElement('span');
    paragraph.append('hello');
    trailing.setAttribute(RENDERED_TRAILING_SPACE_ATTR, 'true');
    trailing.textContent = '\u00A0';
    paragraph.append(trailing);
    root.append(paragraph);

    expect(setRenderedMarkdownSelectionAtOffset(root, 'hello ', 6)).toMatchObject({
      sourceOffset: 6,
      domSourceOffset: 6,
      approximate: false,
    });
    expect(root.ownerDocument.getSelection()?.focusNode).toBe(trailing.firstChild);
    expect(root.ownerDocument.getSelection()?.focusOffset).toBe(1);
  });

  it('restores native selection into rendered blank-line placeholders', () => {
    const root = document.createElement('div');
    const first = document.createElement('p');
    const blank = document.createElement('p');
    const second = document.createElement('p');
    first.textContent = 'First';
    blank.textContent = '\u00A0';
    blank.setAttribute(RENDERED_BLANK_LINE_ATTR, 'true');
    second.textContent = 'Second';
    root.append(first, blank, second);

    expect(setRenderedMarkdownSelectionAtOffset(root, 'First\n\nSecond', 6)).toMatchObject({
      domSourceOffset: 6,
      restoreTarget: 'exact',
    });
    expect(root.ownerDocument.getSelection()?.focusNode).toBe(blank.firstChild);
  });

  it('does not restore native selection into generated newline text nodes', () => {
    const root = document.createElement('div');
    const first = document.createElement('p');
    const second = document.createElement('p');
    const generatedNewline = document.createTextNode('\n');
    first.textContent = 'First';
    second.textContent = 'Second';
    root.append(first, generatedNewline, second);

    expect(setRenderedMarkdownSelectionAtOffset(root, 'First\nSecond', 6)).not.toBeNull();
    expect(root.ownerDocument.getSelection()?.focusNode).toBe(second.firstChild);
  });

  it('restores native selection inside rendered text whose source has markdown syntax', () => {
    const root = document.createElement('div');
    const paragraph = document.createElement('p');
    paragraph.textContent = 'hello! world';
    root.append(paragraph);

    expect(setRenderedMarkdownSelectionAtOffset(root, '*hello!* world', 7)).not.toBeNull();
    expect(root.ownerDocument.getSelection()?.focusNode).toBe(paragraph.firstChild);
    expect(root.ownerDocument.getSelection()?.focusOffset).toBe(6);
  });

  it('sets native selection from a click point using the document caret range', () => {
    const root = document.createElement('div');
    const paragraph = document.createElement('p');
    paragraph.textContent = 'hello';
    root.append(paragraph);
    const doc = root.ownerDocument as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null };
    const originalCaretRangeFromPoint = doc.caretRangeFromPoint;
    doc.caretRangeFromPoint = () => {
      const range = document.createRange();
      range.setStart(paragraph.firstChild as Text, 2);
      range.collapse(true);
      return range;
    };

    try {
      expect(setRenderedMarkdownSelectionFromPoint(root, 'hello', 1, 1)).toMatchObject({
        sourceOffset: 2,
      });
      expect(root.ownerDocument.getSelection()?.focusNode).toBe(paragraph.firstChild);
      expect(root.ownerDocument.getSelection()?.focusOffset).toBe(2);
    } finally {
      doc.caretRangeFromPoint = originalCaretRangeFromPoint;
    }
  });
});
