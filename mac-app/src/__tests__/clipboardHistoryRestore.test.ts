import { describe, expect, it } from 'vitest';

import {
  FIELD_THEORY_LAST_SURFACE_STORAGE_KEY,
  FIELD_THEORY_VIEW_STORAGE_KEY,
  SHOULD_SHOW_FIELDS_ON_OPEN_STORAGE_KEY,
  persistClipboardSurface,
  resolveClipboardRestoreState,
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
  it('restores settings as the last surface while keeping the stored base view', () => {
    const storage = createStorage({
      [FIELD_THEORY_VIEW_STORAGE_KEY]: 'commands',
      [FIELD_THEORY_LAST_SURFACE_STORAGE_KEY]: 'settings',
    });

    expect(resolveClipboardRestoreState(storage)).toEqual({
      viewMode: 'commands',
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
});
