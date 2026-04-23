import { afterEach, describe, it, expect } from 'vitest';
import { isImmersiveToggleShortcut, isSearchFocusShortcut, shouldEnterEditOnClick } from '../utils/editorShortcuts';

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

describe('isImmersiveToggleShortcut', () => {
  it('accepts Cmd+Period', () => {
    expect(isImmersiveToggleShortcut(mkKey({ key: '.', code: 'Period', metaKey: true }))).toBe(true);
  });

  it('rejects Cmd+Shift+Period and unrelated modifiers', () => {
    expect(isImmersiveToggleShortcut(mkKey({ key: '>', code: 'Period', metaKey: true, shiftKey: true }))).toBe(false);
    expect(isImmersiveToggleShortcut(mkKey({ key: '.', code: 'Period', metaKey: true, altKey: true }))).toBe(false);
    expect(isImmersiveToggleShortcut(mkKey({ key: '.', code: 'Period', metaKey: true, ctrlKey: true }))).toBe(false);
  });

  it('rejects bare Period', () => {
    expect(isImmersiveToggleShortcut(mkKey({ key: '.', code: 'Period' }))).toBe(false);
  });
});

describe('shouldEnterEditOnClick', () => {
  it('allows a plain click on text', () => {
    const p = document.createElement('p');
    p.textContent = 'hi';
    document.body.appendChild(p);
    expect(shouldEnterEditOnClick({ target: p })).toBe(true);
  });

  it('rejects clicks that land on interactive elements', () => {
    for (const tag of ['a', 'button', 'input', 'textarea', 'select', 'img', 'code']) {
      const el = document.createElement(tag);
      document.body.appendChild(el);
      expect(shouldEnterEditOnClick({ target: el })).toBe(false);
      el.remove();
    }
  });

  it('rejects clicks on descendants of interactive elements', () => {
    const a = document.createElement('a');
    const span = document.createElement('span');
    a.appendChild(span);
    document.body.appendChild(a);
    expect(shouldEnterEditOnClick({ target: span })).toBe(false);
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
    expect(shouldEnterEditOnClick({ target: p })).toBe(false);
  });

  it('returns false when the event has no target', () => {
    expect(shouldEnterEditOnClick({ target: null })).toBe(false);
  });
});
