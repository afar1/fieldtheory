export function shouldRouteSuperPasteToLibrarian(input: {
  editorFocused: boolean;
  windowVisible: boolean;
  windowFocused: boolean;
}): boolean {
  return input.editorFocused && input.windowVisible && input.windowFocused;
}

export function isFieldTheorySuperPasteBundleId(bundleId: string | null | undefined): boolean {
  return bundleId === 'com.fieldtheory.app'
    || bundleId === 'com.fieldtheory.experimental'
    || bundleId === 'com.github.Electron';
}
