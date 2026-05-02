import { describe, expect, it } from 'vitest';
import {
  MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX,
  getMarkdownCodeEditorCursorAnimationStyle,
  getMarkdownCodeEditorCursorScrollMargin,
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
  it('keeps the caret flush with the bottom edge', () => {
    expect(getMarkdownCodeEditorCursorScrollMargin()).toEqual({
      x: 5,
      y: MARKDOWN_CODE_EDITOR_CARET_BOTTOM_ROOM_PX,
    });
  });
});
