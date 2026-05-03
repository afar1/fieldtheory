import { describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import {
  MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX,
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
  it('keeps bottom room for the caret above the footer', () => {
    expect(MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX).toBeGreaterThan(0);
    expect(getMarkdownCodeEditorCursorScrollMargin()).toEqual({
      x: 5,
      y: MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX,
    });
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
