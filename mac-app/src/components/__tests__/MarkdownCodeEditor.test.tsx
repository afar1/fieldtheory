import { describe, expect, it, vi } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  MARKDOWN_CODE_EDITOR_CHECKED_TASK_LINE_CLASS,
  MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX,
  checkedMarkdownTaskLineExtension,
  getMarkdownCodeEditorBottomRoom,
  getMarkdownCodeEditorCursorAnimationStyle,
  getMarkdownCodeEditorCursorScrollMargin,
  handleMarkdownCodeEditorCapturedKeyDown,
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

  it('can remove bottom room when focus chrome should sit flush to the footer', () => {
    expect(getMarkdownCodeEditorBottomRoom(0)).toBe(0);
    expect(getMarkdownCodeEditorCursorScrollMargin(0)).toEqual({ x: 5, y: 0 });
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
