/** Shared keyboard + click helpers for library-style reader/editor views.
 *  Extracted from LibrarianView + CommandsView so both views behave the same. */

export function isActiveElementEditable(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

/** True when a keydown event should focus the sidebar search input.
 *  `/` is suppressed while the user is typing in an input or holds a modifier. */
export function isSearchFocusShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isActiveElementEditable()) return true;
  return false;
}

export function isCommandFindShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return e.key === 'f' && e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey;
}

export function isImmersiveToggleShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return (e.key === '/' || e.code === 'Slash') && e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey;
}

export function isMarkdownModeToggleShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return (e.key === ',' || e.code === 'Comma') && e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey;
}

export function isMarkdownTaskShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  const isZeroKey = e.key === '0' || e.key === ')' || e.code === 'Digit0' || e.code === 'Numpad0';
  return isZeroKey && e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey;
}

export function isMarkdownTaskToggleShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return e.key === 'Enter' && e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey;
}

export function isSidebarToggleShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return (e.key === '.' || e.code === 'Period') && e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey;
}

export function isThemeToggleShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return e.key.toLowerCase() === 'l' && e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey;
}

export type RenderedEditClickMode = 'click' | 'command-click';

export const RENDERED_EDIT_CLICK_MODE_STORAGE_KEY = 'fieldtheory-rendered-edit-click-mode';
export const RENDERED_EDIT_CLICK_MODE_CHANGED_EVENT = 'fieldtheory:rendered-edit-click-mode-changed';

export function restoreRenderedEditClickMode(storage: Pick<Storage, 'getItem'>): RenderedEditClickMode {
  return storage.getItem(RENDERED_EDIT_CLICK_MODE_STORAGE_KEY) === 'command-click' ? 'command-click' : 'click';
}

export function persistRenderedEditClickMode(storage: Pick<Storage, 'setItem'>, mode: RenderedEditClickMode): void {
  storage.setItem(RENDERED_EDIT_CLICK_MODE_STORAGE_KEY, mode);
}

/** True when a click on the rendered markdown body should switch to edit
 *  mode. Clicks on interactive elements and clicks that terminate a text
 *  selection are excluded. */
export function shouldEnterEditOnClick(
  e: { target: EventTarget | null; metaKey?: boolean },
  mode: RenderedEditClickMode = 'click',
): boolean {
  if (mode === 'command-click' && !e.metaKey) return false;
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  if (target.closest('a, button, input, textarea, select, img, code')) return false;
  if ((window.getSelection()?.toString() ?? '').trim() !== '') return false;
  return true;
}
