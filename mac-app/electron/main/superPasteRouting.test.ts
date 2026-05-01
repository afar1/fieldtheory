import { describe, expect, it } from 'vitest';
import {
  isFieldTheorySuperPasteBundleId,
  shouldRouteSuperPasteToLibrarian,
} from './superPasteRouting';

describe('shouldRouteSuperPasteToLibrarian', () => {
  it('requires the Field Theory markdown editor window to be focused', () => {
    expect(shouldRouteSuperPasteToLibrarian({
      editorFocused: true,
      windowVisible: true,
      windowFocused: true,
    })).toBe(true);

    expect(shouldRouteSuperPasteToLibrarian({
      editorFocused: true,
      windowVisible: true,
      windowFocused: false,
    })).toBe(false);
  });

  it('does not route image paths into Field Theory without editor focus', () => {
    expect(shouldRouteSuperPasteToLibrarian({
      editorFocused: false,
      windowVisible: true,
      windowFocused: true,
    })).toBe(false);
  });
  it('uses the same focused editor gate for text and image Super Paste routing', () => {
    expect(shouldRouteSuperPasteToLibrarian({
      editorFocused: true,
      windowVisible: true,
      windowFocused: true,
    })).toBe(true);

    expect(shouldRouteSuperPasteToLibrarian({
      editorFocused: true,
      windowVisible: false,
      windowFocused: true,
    })).toBe(false);
  });
});

describe('isFieldTheorySuperPasteBundleId', () => {
  it('matches production, experimental, and dev Field Theory bundle ids', () => {
    expect(isFieldTheorySuperPasteBundleId('com.fieldtheory.app')).toBe(true);
    expect(isFieldTheorySuperPasteBundleId('com.fieldtheory.experimental')).toBe(true);
    expect(isFieldTheorySuperPasteBundleId('com.github.Electron')).toBe(true);
  });

  it('does not treat external apps as Field Theory targets', () => {
    expect(isFieldTheorySuperPasteBundleId('com.apple.Terminal')).toBe(false);
    expect(isFieldTheorySuperPasteBundleId(null)).toBe(false);
  });
});
