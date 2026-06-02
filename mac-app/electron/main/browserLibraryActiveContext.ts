export interface BrowserLibraryActiveContextState {
  nativeMarkdownEditorFocused: boolean;
}

export function shouldPromoteBrowserLibraryClientContext(
  state: BrowserLibraryActiveContextState,
): boolean {
  return !state.nativeMarkdownEditorFocused;
}

export function shouldTargetBrowserLibraryNavigation(
  state: BrowserLibraryActiveContextState,
): boolean {
  return !state.nativeMarkdownEditorFocused;
}

export function getBrowserLibraryNativeFocusHandoff(focused: boolean): {
  clearBrowserMarkdownEditorOwner: boolean;
  clearBrowserNavigationOwner: boolean;
  promoteBrowserNavigationOwner: boolean;
} {
  return {
    clearBrowserMarkdownEditorOwner: focused,
    clearBrowserNavigationOwner: focused,
    promoteBrowserNavigationOwner: !focused,
  };
}
