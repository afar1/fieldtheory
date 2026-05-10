import { describe, expect, it, vi } from 'vitest';
import { Compartment, EditorSelection, EditorState, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undo } from '@codemirror/commands';
import {
  MARKDOWN_CODE_EDITOR_CHECKED_TASK_LINE_CLASS,
  MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX,
  MARKDOWN_CODE_EDITOR_FILE_SWAP_USER_EVENT,
  RENDERED_MARKDOWN_EDITOR_CODE_CLASS,
  RENDERED_MARKDOWN_EDITOR_EMPHASIS_CLASS,
  RENDERED_MARKDOWN_EDITOR_HEADING_CLASS,
  RENDERED_MARKDOWN_EDITOR_LINK_CLASS,
  RENDERED_MARKDOWN_EDITOR_STRONG_CLASS,
  RENDERED_MARKDOWN_EDITOR_TASK_MARKER_CLASS,
  checkedMarkdownTaskLineExtension,
  renderedMarkdownEditorPresentationExtension,
  dispatchMarkdownCodeEditorFileSwap,
  getMarkdownCodeEditorBottomRoom,
  getMarkdownCodeEditorCursorAnimationStyle,
  getMarkdownCodeEditorCursorScrollMargin,
  getMarkdownCodeEditorSelectionSnapshot,
  getMarkdownCodeEditorSourcePosition,
  handleMarkdownCodeEditorCapturedKeyDown,
  isMarkdownCodeEditorFileSwapUpdate,
  shouldMoveCaretToDocumentEndFromClick,
} from '../MarkdownCodeEditor';

describe('MarkdownCodeEditor cursor blink', () => {
  it('leaves cursor animation enabled by default', () => {
    expect(getMarkdownCodeEditorCursorAnimationStyle(true)).toEqual({});
  });

  it('removes cursor animation when blinking is disabled', () => {
    expect(getMarkdownCodeEditorCursorAnimationStyle(false)).toEqual({ animation: 'none' });
  });
});

describe('MarkdownCodeEditor cursor scroll margin', () => {
  it('keeps a small bottom margin for caret movement', () => {
    expect(MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX).toBeGreaterThan(0);
    expect(getMarkdownCodeEditorCursorScrollMargin()).toEqual({
      x: 5,
      y: MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX,
    });
  });

  it('can remove bottom room when a caller explicitly opts out', () => {
    expect(getMarkdownCodeEditorBottomRoom(0)).toBe(0);
    expect(getMarkdownCodeEditorCursorScrollMargin(0)).toEqual({ x: 5, y: 0 });
  });
});

describe('MarkdownCodeEditor cursor telemetry', () => {
  it('reports exact source line and column for a markdown offset', () => {
    expect(getMarkdownCodeEditorSourcePosition('alpha\nbeta\ncharlie', 8)).toMatchObject({
      offset: 8,
      line: 2,
      column: 3,
      lineStart: 6,
      lineEnd: 10,
      lineLength: 4,
      before: 'be',
      after: 'ta',
    });

    expect(getMarkdownCodeEditorSourcePosition('\nfirst', 0)).toMatchObject({
      offset: 0,
      line: 1,
      column: 1,
      lineStart: 0,
    });
  });

  it('captures selection head, source position, and scroll in snapshots', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: 'alpha\nbeta',
        selection: EditorSelection.cursor(8),
      }),
      parent,
    });

    const snapshot = getMarkdownCodeEditorSelectionSnapshot(view, {
      docChanged: true,
      inputType: 'insertText',
      inputData: 'x',
    });

    expect(snapshot).toMatchObject({
      selectionStart: 8,
      selectionEnd: 8,
      selectionHead: 8,
      selectionAnchor: 8,
      isCollapsed: true,
      docChanged: true,
      inputType: 'insertText',
      inputData: 'x',
      selectionHeadSource: {
        line: 2,
        column: 3,
        before: 'be',
        after: 'ta',
      },
      scroll: {
        top: 0,
      },
    });

    view.destroy();
    parent.remove();
  });
});

describe('MarkdownCodeEditor blank-space clicks', () => {
  const buildView = ({
    scrollTop = 0,
    clientHeight = 400,
    scrollHeight = 400,
    lastLineBottom = 120,
  }: {
    scrollTop?: number;
    clientHeight?: number;
    scrollHeight?: number;
    lastLineBottom?: number;
  } = {}) => ({
    scrollDOM: {
      scrollTop,
      clientHeight,
      scrollHeight,
    },
    contentDOM: {
      querySelector: () => ({
        getBoundingClientRect: () => ({ bottom: lastLineBottom }),
      }),
    },
  }) as unknown as EditorView;

  it('moves the caret to the document end when clicking blank space below the last line', () => {
    const event = new MouseEvent('mousedown', {
      button: 0,
      clientY: 180,
    });

    expect(shouldMoveCaretToDocumentEndFromClick(buildView(), event)).toBe(true);
  });

  it('still treats the configured bottom room as end-of-document space', () => {
    const event = new MouseEvent('mousedown', {
      button: 0,
      clientY: 180,
    });

    expect(shouldMoveCaretToDocumentEndFromClick(buildView({
      scrollHeight: 400 + MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX,
    }), event)).toBe(true);
  });

  it('leaves normal line clicks alone', () => {
    const event = new MouseEvent('mousedown', {
      button: 0,
      clientY: 80,
    });

    expect(shouldMoveCaretToDocumentEndFromClick(buildView(), event)).toBe(false);
  });

  it('leaves blank-space clicks alone while there is more content below the viewport', () => {
    const event = new MouseEvent('mousedown', {
      button: 0,
      clientY: 180,
    });

    expect(shouldMoveCaretToDocumentEndFromClick(buildView({ scrollHeight: 800 }), event)).toBe(false);
  });
});

describe('MarkdownCodeEditor checked task decorations', () => {
  it('adds the checked task class to checked source lines only', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: '- [x] done\n- [ ] todo\n[x] bare done\n[] bare todo',
        extensions: [checkedMarkdownTaskLineExtension],
      }),
      parent,
    });

    const lines = Array.from(parent.querySelectorAll('.cm-line'));
    expect(lines).toHaveLength(4);
    expect(lines[0].classList.contains(MARKDOWN_CODE_EDITOR_CHECKED_TASK_LINE_CLASS)).toBe(true);
    expect(lines[1].classList.contains(MARKDOWN_CODE_EDITOR_CHECKED_TASK_LINE_CLASS)).toBe(false);
    expect(lines[2].classList.contains(MARKDOWN_CODE_EDITOR_CHECKED_TASK_LINE_CLASS)).toBe(true);
    expect(lines[3].classList.contains(MARKDOWN_CODE_EDITOR_CHECKED_TASK_LINE_CLASS)).toBe(false);

    view.destroy();
    parent.remove();
  });
});

describe('MarkdownCodeEditor rendered presentation', () => {
  it('hides common markdown syntax behind styled editable text', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: '# Title\n\nHello **bold** *em* `code` [Link](wiki://target)\n- [x] done',
        extensions: [renderedMarkdownEditorPresentationExtension],
      }),
      parent,
    });

    const content = parent.querySelector('.cm-content');
    expect(content?.textContent).toContain('Title');
    expect(content?.textContent).toContain('Hello bold em code Link');
    expect(content?.textContent).not.toContain('#');
    expect(content?.textContent).not.toContain('**');
    expect(content?.textContent).not.toContain('wiki://target');
    expect(parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_HEADING_CLASS}-1`)?.textContent).toBe('Title');
    expect(parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_STRONG_CLASS}`)?.textContent).toBe('bold');
    expect(parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_EMPHASIS_CLASS}`)?.textContent).toBe('em');
    expect(parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_CODE_CLASS}`)?.textContent).toBe('code');
    expect(parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_LINK_CLASS}`)?.textContent).toBe('Link');
    expect(parent.querySelector(`.${RENDERED_MARKDOWN_EDITOR_TASK_MARKER_CLASS}`)?.textContent).toBe('[x]');

    view.destroy();
    parent.remove();
  });
});

describe('MarkdownCodeEditor file swaps', () => {
  it('does not report swap transactions as user edits', () => {
    const state = EditorState.create({ doc: 'File A' });
    const swap = state.update({
      changes: { from: 0, to: state.doc.length, insert: 'File B' },
      annotations: Transaction.userEvent.of(MARKDOWN_CODE_EDITOR_FILE_SWAP_USER_EVENT),
    });
    const input = state.update({
      changes: { from: state.doc.length, insert: ' typed' },
      annotations: Transaction.userEvent.of('input.type'),
    });

    expect(isMarkdownCodeEditorFileSwapUpdate({ transactions: [swap] })).toBe(true);
    expect(isMarkdownCodeEditorFileSwapUpdate({ transactions: [input] })).toBe(false);
  });

  it('drops the previous file history when swapping documents', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const historyCompartment = new Compartment();
    const view = new EditorView({
      state: EditorState.create({
        doc: 'File A',
        extensions: [historyCompartment.of(history())],
      }),
      parent,
    });

    view.dispatch({ changes: { from: view.state.doc.length, insert: ' typed' } });
    expect(view.state.doc.toString()).toBe('File A typed');

    dispatchMarkdownCodeEditorFileSwap(view, historyCompartment, 'File B');
    expect(view.state.doc.toString()).toBe('File B');
    expect(undo(view)).toBe(false);
    expect(view.state.doc.toString()).toBe('File B');

    view.destroy();
    parent.remove();
  });

  it('keeps file swaps out of the parent onChange path', () => {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const historyCompartment = new Compartment();
    const onChange = vi.fn();
    const view = new EditorView({
      state: EditorState.create({
        doc: 'File A',
        extensions: [
          historyCompartment.of(history()),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !isMarkdownCodeEditorFileSwapUpdate(update)) {
              onChange(update.state.doc.toString());
            }
          }),
        ],
      }),
      parent,
    });

    dispatchMarkdownCodeEditorFileSwap(view, historyCompartment, 'File B');
    expect(onChange).not.toHaveBeenCalled();

    view.dispatch({ changes: { from: view.state.doc.length, insert: ' typed' } });
    expect(onChange).toHaveBeenCalledWith('File B typed');

    view.destroy();
    parent.remove();
  });
});

describe('MarkdownCodeEditor captured keydown', () => {
  it('stops CodeMirror keymaps when the app handles a shortcut', () => {
    const event = new KeyboardEvent('keydown', {
      key: '/',
      code: 'Slash',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    const stopImmediatePropagation = vi.spyOn(event, 'stopImmediatePropagation');

    expect(handleMarkdownCodeEditorCapturedKeyDown(event, () => true)).toBe(true);

    expect(event.defaultPrevented).toBe(true);
    expect(stopImmediatePropagation).toHaveBeenCalledTimes(1);
  });

  it('lets the app capture Escape before it can bubble into window close handling', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    const stopImmediatePropagation = vi.spyOn(event, 'stopImmediatePropagation');

    expect(handleMarkdownCodeEditorCapturedKeyDown(event, () => true)).toBe(true);

    expect(event.defaultPrevented).toBe(true);
    expect(stopImmediatePropagation).toHaveBeenCalledTimes(1);
  });

  it('leaves unhandled keys available to CodeMirror', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'a',
      bubbles: true,
      cancelable: true,
    });
    const stopImmediatePropagation = vi.spyOn(event, 'stopImmediatePropagation');

    expect(handleMarkdownCodeEditorCapturedKeyDown(event, () => false)).toBe(false);

    expect(event.defaultPrevented).toBe(false);
    expect(stopImmediatePropagation).not.toHaveBeenCalled();
  });
});
