import { describe, expect, it } from 'vitest';
import {
  getBrowserLibraryNativeFocusHandoff,
  shouldPromoteBrowserLibraryClientContext,
  shouldTargetBrowserLibraryNavigation,
} from './browserLibraryActiveContext';

describe('shouldPromoteBrowserLibraryClientContext', () => {
  it('does not let a Browser Library heartbeat steal local-command context from the focused native editor', () => {
    expect(shouldPromoteBrowserLibraryClientContext({
      nativeMarkdownEditorFocused: true,
    })).toBe(false);
  });

  it('allows Browser Library to become the local-command context when the native editor is not focused', () => {
    expect(shouldPromoteBrowserLibraryClientContext({
      nativeMarkdownEditorFocused: false,
    })).toBe(true);
  });

  it('does not route incoming markdown navigation to Browser while the native editor is focused', () => {
    expect(shouldTargetBrowserLibraryNavigation({
      nativeMarkdownEditorFocused: true,
    })).toBe(false);
  });

  it('allows Browser Library navigation targeting after native editor focus is released', () => {
    expect(shouldTargetBrowserLibraryNavigation({
      nativeMarkdownEditorFocused: false,
    })).toBe(true);
  });

  it('clears both Browser editor and navigation owners when the native editor focuses', () => {
    expect(getBrowserLibraryNativeFocusHandoff(true)).toEqual({
      clearBrowserMarkdownEditorOwner: true,
      clearBrowserNavigationOwner: true,
      promoteBrowserNavigationOwner: false,
    });
  });

  it('allows Browser navigation owner promotion after the native editor blurs', () => {
    expect(getBrowserLibraryNativeFocusHandoff(false)).toEqual({
      clearBrowserMarkdownEditorOwner: false,
      clearBrowserNavigationOwner: false,
      promoteBrowserNavigationOwner: true,
    });
  });
});
