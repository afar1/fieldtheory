import { afterEach, describe, it, expect } from 'vitest';
import {
  RENDERED_EDIT_CLICK_MODE_STORAGE_KEY,
  TEXT_CURSOR_BLINK_STORAGE_KEY,
  isCommandDeleteShortcut,
  isCommandFindShortcut,
  getMarkdownFormattingShortcut,
  isImmersiveToggleShortcut,
  isKeyboardShortcutsHelpShortcut,
  isMarkdownModeToggleShortcut,
  isMarkdownTaskShortcut,
  isMarkdownTaskToggleShortcut,
  isNavSidebarToggleEnabled,
  isSearchFocusShortcut,
  isSidebarToggleShortcut,
  isThemeToggleShortcut,
  LIBRARIAN_KEYBOARD_SHORTCUTS,
  persistRenderedEditClickMode,
  persistTextCursorBlink,
  restoreRenderedEditClickMode,
  restoreTextCursorBlink,
  shouldEnterEditOnClick,
  shouldRevealFooterChrome,
} from '../utils/editorShortcuts';

function mkKey(overrides: Partial<KeyboardEvent>): KeyboardEvent {
  return new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...overrides });
}

afterEach(() => {
  document.body.innerHTML = '';
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
});

describe('isSearchFocusShortcut', () => {
  it('rejects Cmd+F so it can be reserved for in-file find', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(isSearchFocusShortcut(mkKey({ key: 'f', metaKey: true }))).toBe(false);
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

  it('rejects "/" while typing in a contenteditable editor', () => {
    const editor = document.createElement('div');
    editor.contentEditable = 'true';
    document.body.appendChild(editor);
    editor.focus();
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

  it('rejects Cmd+Period so it can toggle markdown mode', () => {
    expect(isImmersiveToggleShortcut(mkKey({ key: '.', code: 'Period', metaKey: true }))).toBe(false);
  });
});

describe('isMarkdownModeToggleShortcut', () => {
  it('accepts Cmd+Period', () => {
    expect(isMarkdownModeToggleShortcut(mkKey({ key: '.', code: 'Period', metaKey: true }))).toBe(true);
  });

  it('rejects Cmd+Shift+Period and unrelated modifiers', () => {
    expect(isMarkdownModeToggleShortcut(mkKey({ key: '>', code: 'Period', metaKey: true, shiftKey: true }))).toBe(false);
    expect(isMarkdownModeToggleShortcut(mkKey({ key: '.', code: 'Period', metaKey: true, altKey: true }))).toBe(false);
    expect(isMarkdownModeToggleShortcut(mkKey({ key: '.', code: 'Period', metaKey: true, ctrlKey: true }))).toBe(false);
  });

  it('rejects bare period and Cmd+Comma', () => {
    expect(isMarkdownModeToggleShortcut(mkKey({ key: '.', code: 'Period' }))).toBe(false);
    expect(isMarkdownModeToggleShortcut(mkKey({ key: ',', code: 'Comma', metaKey: true }))).toBe(false);
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

describe('getMarkdownFormattingShortcut', () => {
  it('maps plain Cmd+B, Cmd+I, and Cmd+U to markdown formatting actions', () => {
    expect(getMarkdownFormattingShortcut(mkKey({ key: 'b', metaKey: true }))).toBe('bold');
    expect(getMarkdownFormattingShortcut(mkKey({ key: 'I', metaKey: true }))).toBe('italic');
    expect(getMarkdownFormattingShortcut(mkKey({ key: 'u', metaKey: true }))).toBe('underline');
  });

  it('rejects shifted or unrelated modified formatting chords', () => {
    expect(getMarkdownFormattingShortcut(mkKey({ key: 'b', metaKey: true, shiftKey: true }))).toBeNull();
    expect(getMarkdownFormattingShortcut(mkKey({ key: 'i', metaKey: true, altKey: true }))).toBeNull();
    expect(getMarkdownFormattingShortcut(mkKey({ key: 'u', metaKey: true, ctrlKey: true }))).toBeNull();
    expect(getMarkdownFormattingShortcut(mkKey({ key: 'x', metaKey: true }))).toBeNull();
  });
});

describe('isSidebarToggleShortcut', () => {
  it('accepts Cmd+Comma', () => {
    expect(isSidebarToggleShortcut(mkKey({ key: ',', code: 'Comma', metaKey: true }))).toBe(true);
  });

  it('rejects bare comma, modified comma chords, and Cmd+Period', () => {
    expect(isSidebarToggleShortcut(mkKey({ key: ',', code: 'Comma' }))).toBe(false);
    expect(isSidebarToggleShortcut(mkKey({ key: '<', code: 'Comma', metaKey: true, shiftKey: true }))).toBe(false);
    expect(isSidebarToggleShortcut(mkKey({ key: ',', code: 'Comma', metaKey: true, altKey: true }))).toBe(false);
    expect(isSidebarToggleShortcut(mkKey({ key: ',', code: 'Comma', metaKey: true, ctrlKey: true }))).toBe(false);
    expect(isSidebarToggleShortcut(mkKey({ key: '.', code: 'Period', metaKey: true }))).toBe(false);
  });

  it('rejects Cmd+Slash so it can toggle focus mode', () => {
    expect(isSidebarToggleShortcut(mkKey({ key: '/', code: 'Slash', metaKey: true }))).toBe(false);
  });
});

describe('Library sidebar collapse availability', () => {
  it('allows collapse for Library with an active file, Bookmarks, or Commands', () => {
    expect(isNavSidebarToggleEnabled({
      viewMode: 'librarian',
      showSettings: false,
      librarianImmersive: false,
    })).toBe(true);
    expect(isNavSidebarToggleEnabled({
      viewMode: 'librarian',
      showSettings: false,
      librarianImmersive: false,
    })).toBe(true);
    expect(isNavSidebarToggleEnabled({
      viewMode: 'librarian',
      showSettings: false,
      librarianImmersive: false,
    })).toBe(true);
    expect(isNavSidebarToggleEnabled({
      viewMode: 'commands',
      showSettings: false,
      librarianImmersive: false,
    })).toBe(true);
  });
});

describe('shortcut reference rows', () => {
  it('documents focus mode, sidebar toggle, and rendered/markdown toggle', () => {
    expect(LIBRARIAN_KEYBOARD_SHORTCUTS).toEqual(
      expect.arrayContaining([
        { keys: 'Command+/', label: 'Toggle focus mode' },
        { keys: 'Command+,', label: 'Toggle sidebar' },
        { keys: 'Command+.', label: 'Toggle rendered/markdown' },
        { keys: 'Command+B / I / U', label: 'Bold, italic, or underline selection' },
      ])
    );
  });
});

describe('footer chrome proximity', () => {
  it('reveals controls near the bottom edge', () => {
    expect(shouldRevealFooterChrome(725, 800, 96)).toBe(true);
  });

  it('keeps controls faded away from the bottom edge', () => {
    expect(shouldRevealFooterChrome(650, 800, 96)).toBe(false);
  });

  it('rejects invalid viewport geometry', () => {
    expect(shouldRevealFooterChrome(10, 0, 96)).toBe(false);
  });
});

describe('isCommandDeleteShortcut', () => {
  it('accepts Cmd+Delete and Cmd+ForwardDelete', () => {
    expect(isCommandDeleteShortcut(mkKey({ key: 'Backspace', code: 'Backspace', metaKey: true }))).toBe(true);
    expect(isCommandDeleteShortcut(mkKey({ key: 'Delete', code: 'Delete', metaKey: true }))).toBe(true);
  });

  it('rejects delete without Command or with extra modifiers', () => {
    expect(isCommandDeleteShortcut(mkKey({ key: 'Backspace', code: 'Backspace' }))).toBe(false);
    expect(isCommandDeleteShortcut(mkKey({ key: 'Backspace', code: 'Backspace', metaKey: true, shiftKey: true }))).toBe(false);
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

describe('isKeyboardShortcutsHelpShortcut', () => {
  it('accepts Shift+?', () => {
    expect(isKeyboardShortcutsHelpShortcut(mkKey({ key: '?', code: 'Slash', shiftKey: true }))).toBe(true);
    expect(isKeyboardShortcutsHelpShortcut(mkKey({ key: '/', code: 'Slash', shiftKey: true }))).toBe(true);
  });

  it('rejects bare slash and modified variants', () => {
    expect(isKeyboardShortcutsHelpShortcut(mkKey({ key: '/', code: 'Slash' }))).toBe(false);
    expect(isKeyboardShortcutsHelpShortcut(mkKey({ key: '?', code: 'Slash', shiftKey: true, metaKey: true }))).toBe(false);
  });
});

describe('shouldEnterEditOnClick', () => {
  it('rejects a plain click on text by default', () => {
    const p = document.createElement('p');
    p.textContent = 'hi';
    document.body.appendChild(p);
    expect(shouldEnterEditOnClick({ target: p })).toBe(false);
  });

  it('allows a Cmd-click on text by default', () => {
    const p = document.createElement('p');
    p.textContent = 'hi';
    document.body.appendChild(p);
    expect(shouldEnterEditOnClick({ target: p, metaKey: true })).toBe(true);
  });

  it('allows a plain click when click mode is explicitly enabled', () => {
    const p = document.createElement('p');
    p.textContent = 'hi';
    document.body.appendChild(p);
    expect(shouldEnterEditOnClick({ target: p }, 'click')).toBe(true);
  });

  it('rejects a plain click when Command-click mode is enabled', () => {
    const p = document.createElement('p');
    p.textContent = 'hi';
    document.body.appendChild(p);
    expect(shouldEnterEditOnClick({ target: p }, 'command-click')).toBe(false);
  });

  it('allows a Cmd-click when Command-click mode is enabled', () => {
    const p = document.createElement('p');
    p.textContent = 'hi';
    document.body.appendChild(p);
    expect(shouldEnterEditOnClick({ target: p, metaKey: true }, 'command-click')).toBe(true);
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

describe('rendered edit click mode persistence', () => {
  it('defaults to Command-click mode', () => {
    const storage = { getItem: () => null };
    expect(restoreRenderedEditClickMode(storage)).toBe('command-click');
  });

  it('restores Command-click mode', () => {
    const storage = { getItem: (key: string) => key === RENDERED_EDIT_CLICK_MODE_STORAGE_KEY ? 'command-click' : null };
    expect(restoreRenderedEditClickMode(storage)).toBe('command-click');
  });

  it('restores click mode', () => {
    const storage = { getItem: (key: string) => key === RENDERED_EDIT_CLICK_MODE_STORAGE_KEY ? 'click' : null };
    expect(restoreRenderedEditClickMode(storage)).toBe('click');
  });

  it('persists the selected mode', () => {
    const values = new Map<string, string>();
    persistRenderedEditClickMode({ setItem: (key, value) => values.set(key, value) }, 'command-click');
    expect(values.get(RENDERED_EDIT_CLICK_MODE_STORAGE_KEY)).toBe('command-click');
  });
});

describe('text cursor blink persistence', () => {
  it('defaults to blinking', () => {
    const storage = { getItem: () => null };
    expect(restoreTextCursorBlink(storage)).toBe(true);
  });

  it('restores disabled blinking', () => {
    const storage = { getItem: (key: string) => key === TEXT_CURSOR_BLINK_STORAGE_KEY ? 'false' : null };
    expect(restoreTextCursorBlink(storage)).toBe(false);
  });

  it('persists the selected blink setting', () => {
    const values = new Map<string, string>();
    persistTextCursorBlink({ setItem: (key, value) => values.set(key, value) }, false);
    expect(values.get(TEXT_CURSOR_BLINK_STORAGE_KEY)).toBe('false');
  });
});
