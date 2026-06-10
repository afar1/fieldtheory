export const BROWSER_LIBRARY_RENDERER_STORAGE_KEYS = [
  'library-sort-mode',
  'wiki-expanded-folders',
  'wiki-recent-collapsed',
  'library-pinned-item-ids',
  'library-sidebar-icon-color-indices',
  'library-sidebar-icon-color-order',
  'library-new-doc-location',
  'librarian-last-selection',
  'librarian-immersive',
  'librarian-editor-session',
  'fieldtheory.libraryRenameTrace',
  'fieldtheory.contentToolbar.pinnedActions.v2',
  'librarian-text-size',
  'librarian-typography-preset',
  'librarian-line-height',
  'librarian-unordered-list-marker',
  'librarian-todo-marker',
  'librarian-maxwell-items',
  'librarian-html-layout-by-path',
  'fieldtheory-line-numbers',
  'fieldtheory-rendered-edit-click-mode',
  'fieldtheory-text-cursor-blink',
  'fieldtheory-rendered-text-cursor-style',
  'fieldtheory-rendered-block-cursor-opacity',
  'fieldtheory-shared-file-toggle-hotkey',
  'librarian-sidebar-width',
  'librarian-sidebar-collapsed',
  'bookmarks-view-mode',
  'bookmarks-show-text',
  'commands-text-size',
  'commands-sidebar-width',
  'darkMode',
  'glassEffect',
  'accentPreset',
  'darkModeIntensity',
  'fieldtheory-rendered-editor-debug',
] as const;

export type BrowserLibraryRendererStorageKey = typeof BROWSER_LIBRARY_RENDERER_STORAGE_KEYS[number];

export type BrowserLibraryRendererStorageSnapshot = {
  available?: boolean;
  values?: Record<string, string | null>;
};

export type BrowserLibraryRendererStorageLocalStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

export function hydrateMissingBrowserLibraryRendererStorage(
  storage: BrowserLibraryRendererStorageLocalStorage,
  snapshot: BrowserLibraryRendererStorageSnapshot | null | undefined,
): void {
  if (!snapshot?.available || !snapshot.values) return;
  for (const key of BROWSER_LIBRARY_RENDERER_STORAGE_KEYS) {
    if (storage.getItem(key) !== null) continue;
    const value = snapshot.values[key];
    if (typeof value === 'string') {
      storage.setItem(key, value);
    }
  }
}

export function readBrowserLibraryRendererStorageValues(
  storage: Pick<BrowserLibraryRendererStorageLocalStorage, 'getItem'>,
): Record<string, string | null> {
  return Object.fromEntries(
    BROWSER_LIBRARY_RENDERER_STORAGE_KEYS.map((key) => [key, storage.getItem(key)]),
  );
}
