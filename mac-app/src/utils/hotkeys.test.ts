import { beforeEach, describe, expect, it } from 'vitest';

import { buildHotkeyString, formatHotkeyDisplay, normalizeHotkeyForComparison, shouldDeferCopyShortcutToNative } from './hotkeys';

describe('buildHotkeyString', () => {
  it('builds hotkeys from physical key codes', () => {
    const event = new KeyboardEvent('keydown', {
      code: 'KeyK',
      key: 'k',
      metaKey: true,
      shiftKey: true,
    });

    expect(buildHotkeyString(event)).toBe('Command+Shift+K');
  });

  it('returns an empty string for modifier-only presses', () => {
    const event = new KeyboardEvent('keydown', {
      code: 'MetaLeft',
      key: 'Meta',
      metaKey: true,
    });

    expect(buildHotkeyString(event)).toBe('');
  });
});

describe('formatHotkeyDisplay', () => {
  it('formats macOS modifiers for display', () => {
    expect(formatHotkeyDisplay('Command+Shift+K')).toBe('⌘ ⇧ K');
  });
});

describe('normalizeHotkeyForComparison', () => {
  it('normalizes modifier aliases and order', () => {
    expect(normalizeHotkeyForComparison('Control+Option+Command+Space')).toBe('Command+Control+Alt+Space');
    expect(normalizeHotkeyForComparison('cmd+ctrl+option+space')).toBe('Command+Control+Alt+Space');
  });
});

describe('shouldDeferCopyShortcutToNative', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.getSelection()?.removeAllRanges();
  });

  it('defers when an input is focused', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    expect(shouldDeferCopyShortcutToNative()).toBe(true);
  });

  it('defers when a contentEditable element is focused', () => {
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    editable.textContent = 'editable';
    document.body.appendChild(editable);
    editable.focus();

    expect(shouldDeferCopyShortcutToNative()).toBe(true);
  });

  it('defers when text is selected in non-editable content', () => {
    const text = document.createElement('div');
    text.textContent = 'copy this text';
    document.body.appendChild(text);

    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(shouldDeferCopyShortcutToNative()).toBe(true);
  });

  it('does not defer when there is no editable target or text selection', () => {
    const div = document.createElement('div');
    div.textContent = 'plain';
    document.body.appendChild(div);

    expect(shouldDeferCopyShortcutToNative()).toBe(false);
  });
});
