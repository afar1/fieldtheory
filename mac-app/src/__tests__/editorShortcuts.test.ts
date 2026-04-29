import { afterEach, describe, it, expect } from 'vitest';
import { isCommandFindShortcut, isImmersiveToggleShortcut, isMarkdownModeToggleShortcut, isMarkdownTaskShortcut, isMarkdownTaskToggleShortcut, isSearchFocusShortcut, isSidebarToggleShortcut, isThemeToggleShortcut, shouldEnterEditOnClick } from '../utils/editorShortcuts';

function mkKey(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...overrides });
}

afterEach(() => {
  document.body.innerHTML = '';
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
});

describe('isSearchFocusShortcut', () => {
  it('accepts Cmd+F even while an input is focused', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(isSearchFocusShortcut(mkKey({ key: 'f', metaKey: true }))).toBe(true);
  });

  it('accepts bare "/" when focus is on the body', () => {
    expect(isSearchFocusShortcut(mkKey({ key: '/' }))).toBe(true);
  });

  it('rejects "/" while typing in an input', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(isSearchFocusShortcut(mkKey({ key: '/' }))).toBe(false);
  });

  it('rejects "/" while typing in a textarea', () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    expect(isSearchFocusShortcut(mkKey({ key: '/' }))).toBe(false);
  });

  it('rejects "/" with any modifier so chorded shortcuts still work', () => {
    expect(isSearchFocusShortcut(mkKey({ key: '/', metaKey: true }))).toBe(false);
    expect(isSearchFocusShortcut(mkKey({ key: '/', ctrlKey: true }))).toBe(false);
    expect(isSearchFocusShortcut(mkKey({ key: '/', altKey: true }))).toBe(false);
  });

  it('rejects unrelated keys', () => {
    expect(isSearchFocusShortcut(mkKey({ key: 'a' }))).toBe(false);
    expect(isSearchFocusShortcut(mkKey({ key: 'f' }))).toBe(false); // no metaKey
  });
});

describe('isCommandFindShortcut', () => {
  it('accepts plain Cmd+F', () => {
    expect(isCommandFindShortcut(mkKey({ key: 'f', metaKey: true }))).toBe(true);
  });

  it('rejects modified Cmd+F variants', () => {
    expect(isCommandFindShortcut(mkKey({ key: 'f', metaKey: true, shiftKey: true }))).toBe(false);
    expect(isCommandFindShortcut(mkKey({ key: 'f', metaKey: true, ctrlKey: true }))).toBe(false);
    expect(isCommandFindShortcut(mkKey({ key: 'f', metaKey: true, altKey: true }))).toBe(false);
    expect(isCommandFindShortcut(mkKey({ key: 'f' }))).toBe(false);
  });
});

describe('isImmersiveToggleShortcut', () => {
  it('accepts Cmd+Slash', () => {
    expect(isImmersiveToggleShortcut(mkKey({ key: '/', code: 'Slash', metaKey: true }))).toBe(true);
  });

  it('rejects bare slash and modified slash chords', () => {
    expect(isImmersiveToggleShortcut(mkKey({ key: '/', code: 'Slash' }))).toBe(false);
    expect(isImmersiveToggleShortcut(mkKey({ key: '/', code: 'Slash', metaKey: true, shiftKey: true }))).toBe(false);
    expect(isImmersiveToggleShortcut(mkKey({ key: '/', code: 'Slash', metaKey: true, altKey: true }))).toBe(false);
    expect(isImmersiveToggleShortcut(mkKey({ key: '/', code: 'Slash', metaKey: true, ctrlKey: true }))).toBe(false);
  });

  it('rejects Cmd+Period so it can toggle the sidebar', () => {
    expect(isImmersiveToggleShortcut(mkKey({ key: '.', code: 'Period', metaKey: true }))).toBe(false);
  });
});

describe('isMarkdownModeToggleShortcut', () => {
  it('accepts Cmd+Comma', () => {
    expect(isMarkdownModeToggleShortcut(mkKey({ key: ',', code: 'Comma', metaKey: true }))).toBe(true);
  });

  it('rejects Cmd+Shift+Comma and unrelated modifiers', () => {
    expect(isMarkdownModeToggleShortcut(mkKey({ key: '<', code: 'Comma', metaKey: true, shiftKey: true }))).toBe(false);
    expect(isMarkdownModeToggleShortcut(mkKey({ key: ',', code: 'Comma', metaKey: true, altKey: true }))).toBe(false);
    expect(isMarkdownModeToggleShortcut(mkKey({ key: ',', code: 'Comma', metaKey: true, ctrlKey: true }))).toBe(false);
  });

  it('rejects bare Comma', () => {
    expect(isMarkdownModeToggleShortcut(mkKey({ key: ',', code: 'Comma' }))).toBe(false);
  });
});

describe('isMarkdownTaskShortcut', () => {
  it('accepts Shift+Cmd+0 from the main keyboard', () => {
    expect(isMarkdownTaskShortcut(mkKey({ key: ')', code: 'Digit0', metaKey: true, shiftKey: true }))).toBe(true);
    expect(isMarkdownTaskShortcut(mkKey({ key: '0', code: 'Digit0', metaKey: true, shiftKey: true }))).toBe(true);
  });

  it('accepts Shift+Cmd+0 from the numpad', () => {
    expect(isMarkdownTaskShortcut(mkKey({ key: '0', code: 'Numpad0', metaKey: true, shiftKey: true }))).toBe(true);
  });

  it('rejects unshifted and unrelated modified zero chords', () => {
    expect(isMarkdownTaskShortcut(mkKey({ key: '0', code: 'Digit0', metaKey: true }))).toBe(false);
    expect(isMarkdownTaskShortcut(mkKey({ key: ')', code: 'Digit0', metaKey: true, shiftKey: true, altKey: true }))).toBe(false);
    expect(isMarkdownTaskShortcut(mkKey({ key: ')', code: 'Digit0', metaKey: true, shiftKey: true, ctrlKey: true }))).toBe(false);
  });
});

describe('isMarkdownTaskToggleShortcut', () => {
  it('accepts Cmd+Enter', () => {
    expect(isMarkdownTaskToggleShortcut(mkKey({ key: 'Enter', code: 'Enter', metaKey: true }))).toBe(true);
  });

  it('rejects shifted or unrelated Enter chords', () => {
    expect(isMarkdownTaskToggleShortcut(mkKey({ key: 'Enter', code: 'Enter' }))).toBe(false);
    expect(isMarkdownTaskToggleShortcut(mkKey({ key: 'Enter', code: 'Enter', metaKey: true, shiftKey: true }))).toBe(false);
    expect(isMarkdownTaskToggleShortcut(mkKey({ key: 'Enter', code: 'Enter', metaKey: true, altKey: true }))).toBe(false);
    expect(isMarkdownTaskToggleShortcut(mkKey({ key: 'Enter', code: 'Enter', metaKey: true, ctrlKey: true }))).toBe(false);
  });
});

describe('isSidebarToggleShortcut', () => {
  it('accepts Cmd+Period', () => {
    expect(isSidebarToggleShortcut(mkKey({ key: '.', code: 'Period', metaKey: true }))).toBe(true);
  });

  it('rejects bare period and modified period chords', () => {
    expect(isSidebarToggleShortcut(mkKey({ key: '.', code: 'Period' }))).toBe(false);
    expect(isSidebarToggleShortcut(mkKey({ key: '>', code: 'Period', metaKey: true, shiftKey: true }))).toBe(false);
    expect(isSidebarToggleShortcut(mkKey({ key: '.', code: 'Period', metaKey: true, altKey: true }))).toBe(false);
    expect(isSidebarToggleShortcut(mkKey({ key: '.', code: 'Period', metaKey: true, ctrlKey: true }))).toBe(false);
  });

  it('rejects Cmd+Slash so it can toggle focus mode', () => {
    expect(isSidebarToggleShortcut(mkKey({ key: '/', code: 'Slash', metaKey: true }))).toBe(false);
  });
});

describe('isThemeToggleShortcut', () => {
  it('accepts Shift+Cmd+L', () => {
    expect(isThemeToggleShortcut(mkKey({ key: 'L', code: 'KeyL', metaKey: true, shiftKey: true }))).toBe(true);
  });

  it('rejects unshifted and unrelated modified L chords', () => {
    expect(isThemeToggleShortcut(mkKey({ key: 'l', code: 'KeyL', metaKey: true }))).toBe(false);
    expect(isThemeToggleShortcut(mkKey({ key: 'L', code: 'KeyL', metaKey: true, shiftKey: true, altKey: true }))).toBe(false);
    expect(isThemeToggleShortcut(mkKey({ key: 'L', code: 'KeyL', metaKey: true, shiftKey: true, ctrlKey: true }))).toBe(false);
  });

  it('rejects Shift+Cmd+D so it does not collide with debug console', () => {
    expect(isThemeToggleShortcut(mkKey({ key: 'D', code: 'KeyD', metaKey: true, shiftKey: true }))).toBe(false);
  });
});

describe('shouldEnterEditOnClick', () => {
  it('allows a Cmd-click on text', () => {
    const p = document.createElement('p');
    p.textContent = 'hi';
    document.body.appendChild(p);
    expect(shouldEnterEditOnClick({ target: p, metaKey: true })).toBe(true);
  });

  it('rejects a plain click on text', () => {
    const p = document.createElement('p');
    p.textContent = 'hi';
    document.body.appendChild(p);
    expect(shouldEnterEditOnClick({ target: p })).toBe(false);
  });

  it('rejects clicks that land on interactive elements', () => {
    for (const tag of ['a', 'button', 'input', 'textarea', 'select', 'img', 'code']) {
      const el = document.createElement(tag);
      document.body.appendChild(el);
      expect(shouldEnterEditOnClick({ target: el, metaKey: true })).toBe(false);
      el.remove();
    }
  });

  it('rejects clicks on descendants of interactive elements', () => {
    const a = document.createElement('a');
    const span = document.createElement('span');
    a.appendChild(span);
    document.body.appendChild(a);
    expect(shouldEnterEditOnClick({ target: span, metaKey: true })).toBe(false);
  });

  it('rejects when the click terminates an active text selection', () => {
    const p = document.createElement('p');
    p.textContent = 'some text';
    document.body.appendChild(p);
    const range = document.createRange();
    range.selectNodeContents(p);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    expect(shouldEnterEditOnClick({ target: p, metaKey: true })).toBe(false);
  });

  it('returns false when the event has no target', () => {
    expect(shouldEnterEditOnClick({ target: null })).toBe(false);
  });
});
