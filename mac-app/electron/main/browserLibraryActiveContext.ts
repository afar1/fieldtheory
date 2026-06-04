export interface BrowserLibraryActiveContextState {
  nativeMarkdownEditorFocused: boolean;
}

export function shouldPromoteBrowserLibraryClientContext(
  state: BrowserLibraryActiveContextState & {
    browserMarkdownEditorFocused: boolean;
    activeBrowserMarkdownClientId?: string | null;
    candidateClientId?: string | null;
  },
): boolean {
  return !state.nativeMarkdownEditorFocused
    && state.browserMarkdownEditorFocused
    && Boolean(state.candidateClientId)
    && state.candidateClientId === state.activeBrowserMarkdownClientId;
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

export function getBrowserLibraryMarkdownCommandTargetClientId(input: {
  browserMarkdownEditorFocused: boolean;
  activeBrowserMarkdownClientId?: string | null;
}): string | null {
  if (!input.browserMarkdownEditorFocused || !input.activeBrowserMarkdownClientId) return null;
  return input.activeBrowserMarkdownClientId;
}
