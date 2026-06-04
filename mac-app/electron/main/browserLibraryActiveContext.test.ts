import { describe, expect, it } from 'vitest';
import {
  getBrowserLibraryMarkdownCommandTargetClientId,
  getBrowserLibraryNativeFocusHandoff,
  shouldPromoteBrowserLibraryClientContext,
  shouldTargetBrowserLibraryNavigation,
} from './browserLibraryActiveContext';

describe('shouldPromoteBrowserLibraryClientContext', () => {
  it('does not let a Browser Library heartbeat steal local-command context from the focused native editor', () => {
    expect(shouldPromoteBrowserLibraryClientContext({
      nativeMarkdownEditorFocused: true,
      browserMarkdownEditorFocused: true,
      activeBrowserMarkdownClientId: 'focused-client',
      candidateClientId: 'focused-client',
    })).toBe(false);
  });

  it('does not let active Browser Library navigation steal local-command context without editor focus', () => {
    expect(shouldPromoteBrowserLibraryClientContext({
      nativeMarkdownEditorFocused: false,
      browserMarkdownEditorFocused: false,
      activeBrowserMarkdownClientId: null,
      candidateClientId: 'active-surface-client',
    })).toBe(false);
  });

  it('allows Browser Library to become the local-command context only for its focused editor client', () => {
    expect(shouldPromoteBrowserLibraryClientContext({
      nativeMarkdownEditorFocused: false,
      browserMarkdownEditorFocused: true,
      activeBrowserMarkdownClientId: 'focused-client',
      candidateClientId: 'focused-client',
    })).toBe(true);
  });

  it('does not promote a non-focused Browser Library client as local-command context', () => {
    expect(shouldPromoteBrowserLibraryClientContext({
      nativeMarkdownEditorFocused: false,
      browserMarkdownEditorFocused: true,
      activeBrowserMarkdownClientId: 'focused-client',
      candidateClientId: 'active-surface-client',
    })).toBe(false);
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

describe('getBrowserLibraryMarkdownCommandTargetClientId', () => {
  it('returns the focused Browser Library markdown editor client', () => {
    expect(getBrowserLibraryMarkdownCommandTargetClientId({
      browserMarkdownEditorFocused: true,
      activeBrowserMarkdownClientId: 'focused-client',
    })).toBe('focused-client');
  });

  it('keeps live command events on the focused editor client', () => {
    expect(getBrowserLibraryMarkdownCommandTargetClientId({
      browserMarkdownEditorFocused: true,
      activeBrowserMarkdownClientId: 'focused-client',
    })).toBe('focused-client');
  });

  it('does not target Browser Library markdown when no browser editor is focused', () => {
    expect(getBrowserLibraryMarkdownCommandTargetClientId({
      browserMarkdownEditorFocused: false,
      activeBrowserMarkdownClientId: 'focused-client',
    })).toBeNull();
  });
});
