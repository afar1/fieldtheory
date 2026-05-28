import { describe, expect, it } from 'vitest';

import {
  getAppBracketNavigationDirection,
  getAppNavigationSurface,
  getAppNumberTabSurface,
  FIELD_THEORY_LAST_SURFACE_STORAGE_KEY,
  FIELD_THEORY_VIEW_STORAGE_KEY,
  isLibrarianSurfaceVisible,
  popAppBackHistory,
  popAppForwardHistory,
  SHOULD_SHOW_FIELDS_ON_OPEN_STORAGE_KEY,
  persistClipboardSurface,
  pushAppNavigationHistory,
  resolveClipboardRestoreState,
  shouldKeepLibrarianMounted,
} from '../utils/clipboardHistoryRestore';

function createStorage(initial: Record<string, string> = {}) {
  const state = { ...initial };

  return {
    state,
    getItem(key: string) {
      return state[key] ?? null;
    },
    setItem(key: string, value: string) {
      state[key] = value;
    },
    removeItem(key: string) {
      delete state[key];
    },
  };
}

describe('clipboardHistoryRestore', () => {
  it('restores settings while dropping the retired Commands surface as the base view', () => {
    const storage = createStorage({
      [FIELD_THEORY_VIEW_STORAGE_KEY]: 'commands',
      [FIELD_THEORY_LAST_SURFACE_STORAGE_KEY]: 'settings',
    });

    expect(resolveClipboardRestoreState(storage)).toEqual({
      viewMode: 'clipboard',
      showSettings: true,
    });
  });

  it('clears a stale transcription override without losing the previous surface', () => {
    const storage = createStorage({
      [FIELD_THEORY_VIEW_STORAGE_KEY]: 'feedback',
      [FIELD_THEORY_LAST_SURFACE_STORAGE_KEY]: 'settings',
      [SHOULD_SHOW_FIELDS_ON_OPEN_STORAGE_KEY]: 'true',
    });

    expect(resolveClipboardRestoreState(storage)).toEqual({
      viewMode: 'feedback',
      showSettings: true,
    });
    expect(storage.state[SHOULD_SHOW_FIELDS_ON_OPEN_STORAGE_KEY]).toBeUndefined();
    expect(storage.state[FIELD_THEORY_VIEW_STORAGE_KEY]).toBe('feedback');
    expect(storage.state[FIELD_THEORY_LAST_SURFACE_STORAGE_KEY]).toBe('settings');
  });

  it('falls back to the stored base view when no last surface is recorded yet', () => {
    const storage = createStorage({
      [FIELD_THEORY_VIEW_STORAGE_KEY]: 'feedback',
    });

    expect(resolveClipboardRestoreState(storage)).toEqual({
      viewMode: 'feedback',
      showSettings: false,
    });
  });

  it('restores Possible as a normal Field Theory surface', () => {
    const storage = createStorage({
      [FIELD_THEORY_VIEW_STORAGE_KEY]: 'possible',
    });

    expect(resolveClipboardRestoreState(storage)).toEqual({
      viewMode: 'possible',
      showSettings: false,
    });
  });


  it('persists settings as the last surface without losing the base view', () => {
    const storage = createStorage({
      [FIELD_THEORY_VIEW_STORAGE_KEY]: 'clipboard',
      [FIELD_THEORY_LAST_SURFACE_STORAGE_KEY]: 'clipboard',
    });

    persistClipboardSurface(storage, { viewMode: 'feedback', showSettings: true });

    expect(storage.state[FIELD_THEORY_VIEW_STORAGE_KEY]).toBe('feedback');
    expect(storage.state[FIELD_THEORY_LAST_SURFACE_STORAGE_KEY]).toBe('settings');
  });

  it('does not overwrite the last restorable surface while sketch is active', () => {
    const storage = createStorage({
      [FIELD_THEORY_VIEW_STORAGE_KEY]: 'librarian',
      [FIELD_THEORY_LAST_SURFACE_STORAGE_KEY]: 'settings',
    });

    persistClipboardSurface(storage, { viewMode: 'sketch', showSettings: false });

    expect(storage.state[FIELD_THEORY_VIEW_STORAGE_KEY]).toBe('librarian');
    expect(storage.state[FIELD_THEORY_LAST_SURFACE_STORAGE_KEY]).toBe('settings');
  });

  it('resolves the app navigation surface from view state', () => {
    expect(getAppNavigationSurface({ viewMode: 'clipboard', showSettings: false })).toBe('clipboard');
    expect(getAppNavigationSurface({ viewMode: 'librarian', showSettings: true })).toBe('settings');
  });

  it('keeps the Library mounted while settings temporarily covers it', () => {
    expect(shouldKeepLibrarianMounted({ viewMode: 'librarian', librarianEverRendered: false })).toBe(true);
    expect(shouldKeepLibrarianMounted({ viewMode: 'clipboard', librarianEverRendered: true })).toBe(true);
    expect(isLibrarianSurfaceVisible({ viewMode: 'librarian', showSettings: false })).toBe(true);
    expect(isLibrarianSurfaceVisible({ viewMode: 'librarian', showSettings: true })).toBe(false);
  });

  it('recognizes plain Command bracket navigation only', () => {
    expect(getAppBracketNavigationDirection({ key: '[', code: 'BracketLeft', metaKey: true, shiftKey: false, altKey: false, ctrlKey: false })).toBe(-1);
    expect(getAppBracketNavigationDirection({ key: ']', code: 'BracketRight', metaKey: true, shiftKey: false, altKey: false, ctrlKey: false })).toBe(1);
    expect(getAppBracketNavigationDirection({ key: 'å', code: 'BracketLeft', metaKey: true, shiftKey: false, altKey: false, ctrlKey: false })).toBe(-1);
    expect(getAppBracketNavigationDirection({ key: '[', code: 'BracketLeft', metaKey: true, shiftKey: true, altKey: false, ctrlKey: false })).toBeNull();
    expect(getAppBracketNavigationDirection({ key: '[', code: 'BracketLeft', metaKey: false, shiftKey: false, altKey: false, ctrlKey: false })).toBeNull();
  });

  it('maps Command number shortcuts to primary app tabs', () => {
    expect(getAppNumberTabSurface({ key: '1', code: 'Digit1', metaKey: true, shiftKey: false, altKey: false, ctrlKey: false })).toBe('librarian');
    expect(getAppNumberTabSurface({ key: '2', code: 'Digit2', metaKey: true, shiftKey: false, altKey: false, ctrlKey: false })).toBe('clipboard');
    expect(getAppNumberTabSurface({ key: '1', code: 'Digit1', metaKey: true, shiftKey: true, altKey: false, ctrlKey: false })).toBeNull();
    expect(getAppNumberTabSurface({ key: '3', code: 'Digit3', metaKey: true, shiftKey: false, altKey: false, ctrlKey: false })).toBeNull();
  });

  it('tracks app-level back and forward surfaces', () => {
    const backHistory = pushAppNavigationHistory([], 'librarian', 'clipboard');
    expect(backHistory).toEqual(['librarian']);

    const back = popAppBackHistory({
      backHistory,
      forwardHistory: [],
      current: 'clipboard',
    });
    expect(back.target).toBe('librarian');
    expect(back.backHistory).toEqual([]);
    expect(back.forwardHistory).toEqual(['clipboard']);

    const forward = popAppForwardHistory({
      backHistory: back.backHistory,
      forwardHistory: back.forwardHistory,
      current: 'librarian',
    });
    expect(forward.target).toBe('clipboard');
    expect(forward.backHistory).toEqual(['librarian']);
    expect(forward.forwardHistory).toEqual([]);
  });

  it('tracks sketch as an overlay that can return to the previous surface', () => {
    const back = popAppBackHistory({
      backHistory: ['librarian'],
      forwardHistory: [],
      current: 'sketch',
    });

    expect(back.target).toBe('librarian');
    expect(back.backHistory).toEqual([]);
    expect(back.forwardHistory).toEqual(['sketch']);
  });
});
