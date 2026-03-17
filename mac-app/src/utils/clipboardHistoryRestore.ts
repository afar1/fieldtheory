import type { ViewMode } from '../types/clipboard';

export const FIELD_THEORY_VIEW_STORAGE_KEY = 'fieldTheoryView';
export const FIELD_THEORY_LAST_SURFACE_STORAGE_KEY = 'fieldTheoryLastSurface';
export const SHOULD_SHOW_FIELDS_ON_OPEN_STORAGE_KEY = 'shouldShowFieldsOnOpen';

const RESTORABLE_VIEW_MODES = new Set<ViewMode>([
  'clipboard',
  'todo',
  'feedback',
  'commands',
  'council',
  'librarian',
]);

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem' | 'removeItem'>;

export interface ClipboardRestoreState {
  viewMode: ViewMode;
  showSettings: boolean;
}

export function isRestorableViewMode(value: string | null): value is ViewMode {
  return value !== null && RESTORABLE_VIEW_MODES.has(value as ViewMode);
}

export function getStoredViewMode(storage: StorageReader): ViewMode {
  const savedView = storage.getItem(FIELD_THEORY_VIEW_STORAGE_KEY);
  return isRestorableViewMode(savedView) ? savedView : 'clipboard';
}

export function resolveClipboardRestoreState(storage: StorageReader & StorageWriter): ClipboardRestoreState {
  const shouldShowFields = storage.getItem(SHOULD_SHOW_FIELDS_ON_OPEN_STORAGE_KEY) === 'true';
  if (shouldShowFields) {
    storage.removeItem(SHOULD_SHOW_FIELDS_ON_OPEN_STORAGE_KEY);
    storage.setItem(FIELD_THEORY_VIEW_STORAGE_KEY, 'clipboard');
    storage.setItem(FIELD_THEORY_LAST_SURFACE_STORAGE_KEY, 'clipboard');
    return {
      viewMode: 'clipboard',
      showSettings: false,
    };
  }

  const viewMode = getStoredViewMode(storage);
  const savedSurface = storage.getItem(FIELD_THEORY_LAST_SURFACE_STORAGE_KEY);

  if (savedSurface === 'settings') {
    return {
      viewMode,
      showSettings: true,
    };
  }

  if (isRestorableViewMode(savedSurface)) {
    return {
      viewMode: savedSurface,
      showSettings: false,
    };
  }

  return {
    viewMode,
    showSettings: false,
  };
}

export function persistClipboardSurface(
  storage: Pick<Storage, 'setItem'>,
  state: { viewMode: ViewMode; showSettings: boolean }
): void {
  if (state.viewMode !== 'sketch') {
    storage.setItem(FIELD_THEORY_VIEW_STORAGE_KEY, state.viewMode);
  }

  if (state.showSettings) {
    storage.setItem(FIELD_THEORY_LAST_SURFACE_STORAGE_KEY, 'settings');
    return;
  }

  if (state.viewMode !== 'sketch') {
    storage.setItem(FIELD_THEORY_LAST_SURFACE_STORAGE_KEY, state.viewMode);
  }
}
