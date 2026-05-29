import type { ViewMode } from '../types/clipboard';

export const FIELD_THEORY_VIEW_STORAGE_KEY = 'fieldTheoryView';
export const FIELD_THEORY_LAST_SURFACE_STORAGE_KEY = 'fieldTheoryLastSurface';
export const SHOULD_SHOW_FIELDS_ON_OPEN_STORAGE_KEY = 'shouldShowFieldsOnOpen';
export const APP_NAVIGATION_HISTORY_LIMIT = 30;

const RESTORABLE_VIEW_MODES = new Set<ViewMode>([
  'clipboard',
  'todo',
  'feedback',
  'possible',
  'librarian',
]);

type StorageReader = Pick<Storage, 'getItem'>;
type StorageWriter = Pick<Storage, 'setItem' | 'removeItem'>;

export interface ClipboardRestoreState {
  viewMode: ViewMode;
  showSettings: boolean;
}

export type AppNavigationSurface = ViewMode | 'settings';

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

export function getAppNavigationSurface(state: { viewMode: ViewMode; showSettings: boolean }): AppNavigationSurface {
  return state.showSettings ? 'settings' : state.viewMode;
}

export function shouldKeepLibrarianMounted(state: { viewMode: ViewMode; librarianEverRendered: boolean }): boolean {
  return state.librarianEverRendered || state.viewMode === 'librarian';
}

export function isLibrarianSurfaceVisible(state: { viewMode: ViewMode; showSettings: boolean }): boolean {
  return !state.showSettings && state.viewMode === 'librarian';
}

export function getAppBracketNavigationDirection(event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'shiftKey' | 'altKey' | 'ctrlKey'>): -1 | 1 | null {
  if (!event.metaKey || event.shiftKey || event.altKey || event.ctrlKey) return null;
  if (event.key === '[' || event.code === 'BracketLeft') return -1;
  if (event.key === ']' || event.code === 'BracketRight') return 1;
  return null;
}

export function getAppNumberTabSurface(event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'shiftKey' | 'altKey' | 'ctrlKey'>): 'librarian' | 'clipboard' | null {
  if (!event.metaKey || event.shiftKey || event.altKey || event.ctrlKey) return null;
  if (event.key === '1' || event.code === 'Digit1') return 'librarian';
  if (event.key === '2' || event.code === 'Digit2') return 'clipboard';
  return null;
}

export function pushAppNavigationHistory(
  backHistory: AppNavigationSurface[],
  current: AppNavigationSurface,
  next: AppNavigationSurface,
): AppNavigationSurface[] {
  if (current === next) return backHistory;
  if (current === 'settings' || next === 'settings') return backHistory;
  return [...backHistory, current].slice(-APP_NAVIGATION_HISTORY_LIMIT);
}

export function popAppBackHistory(input: {
  backHistory: AppNavigationSurface[];
  forwardHistory: AppNavigationSurface[];
  current: AppNavigationSurface;
}): {
  target: AppNavigationSurface | null;
  backHistory: AppNavigationSurface[];
  forwardHistory: AppNavigationSurface[];
} {
  const lastNavigableIndex = input.backHistory.findLastIndex((surface) => surface !== 'settings');
  const target = lastNavigableIndex >= 0 ? input.backHistory[lastNavigableIndex] : null;
  if (!target) return { ...input, target: null };
  const backHistory = input.backHistory.slice(0, lastNavigableIndex);
  return {
    target,
    backHistory,
    forwardHistory: [input.current, ...input.forwardHistory].slice(0, APP_NAVIGATION_HISTORY_LIMIT),
  };
}

export function popAppForwardHistory(input: {
  backHistory: AppNavigationSurface[];
  forwardHistory: AppNavigationSurface[];
  current: AppNavigationSurface;
}): {
  target: AppNavigationSurface | null;
  backHistory: AppNavigationSurface[];
  forwardHistory: AppNavigationSurface[];
} {
  const firstNavigableIndex = input.forwardHistory.findIndex((surface) => surface !== 'settings');
  const target = firstNavigableIndex >= 0 ? input.forwardHistory[firstNavigableIndex] : null;
  if (!target) return { ...input, target: null };
  const restForward = input.forwardHistory.slice(firstNavigableIndex + 1);
  return {
    target,
    backHistory: [...input.backHistory, input.current].slice(-APP_NAVIGATION_HISTORY_LIMIT),
    forwardHistory: restForward,
  };
}
