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
  return (e.key === '.' || e.code === 'Period') && e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey;
}

export function isMarkdownTaskShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  const isZeroKey = e.key === '0' || e.key === ')' || e.code === 'Digit0' || e.code === 'Numpad0';
  return isZeroKey && e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey;
}

export function isMarkdownTaskToggleShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return e.key === 'Enter' && e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey;
}

export function isSidebarToggleShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return (e.key === ',' || e.code === 'Comma') && e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey;
}

export function isCommandDeleteShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return (e.key === 'Backspace' || e.key === 'Delete') && e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey;
}

export function isThemeToggleShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return e.key.toLowerCase() === 'l' && e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey;
}

export function isKeyboardShortcutsHelpShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return (e.key === '?' || (e.key === '/' && e.shiftKey)) && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
}

export const LIBRARIAN_KEYBOARD_SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: '/', label: 'Focus library search' },
  { keys: 'Esc', label: 'Exit edit, focus, fullscreen, or close' },
  { keys: '↑ / ↓', label: 'Move through files' },
  { keys: 'J / K', label: 'Move through files' },
  { keys: 'Tab', label: 'Cycle note task state forward' },
  { keys: 'Shift+Tab', label: 'Cycle note task state backward' },
  { keys: 'Command+Enter', label: 'Toggle task checkbox line' },
  { keys: 'Command+Shift+0', label: 'Cycle task line' },
  { keys: 'Command+.', label: 'Toggle markdown source' },
  { keys: 'Command+/', label: 'Toggle focus chrome' },
  { keys: 'Command+F', label: 'Find in file' },
  { keys: 'Command+C', label: 'Copy selected text or file path' },
  { keys: 'Command+Shift+C', label: 'Copy file path' },
  { keys: 'Command+N', label: 'New file' },
  { keys: 'Command+Shift+N', label: 'New folder' },
  { keys: 'Command+[ / ]', label: 'Back or forward' },
  { keys: 'Command+S', label: 'Save and render markdown' },
  { keys: 'Command+W', label: 'Close Field Theory' },
  { keys: 'Command+Backspace', label: 'Delete selected sidebar file' },
  { keys: 'Shift+?', label: 'Show keyboard shortcuts' },
];

export type RenderedEditClickMode = 'click' | 'command-click';

export const RENDERED_EDIT_CLICK_MODE_STORAGE_KEY = 'fieldtheory-rendered-edit-click-mode';
export const RENDERED_EDIT_CLICK_MODE_CHANGED_EVENT = 'fieldtheory:rendered-edit-click-mode-changed';
export const TEXT_CURSOR_BLINK_STORAGE_KEY = 'fieldtheory-text-cursor-blink';
export const TEXT_CURSOR_BLINK_CHANGED_EVENT = 'fieldtheory:text-cursor-blink-changed';

export function restoreRenderedEditClickMode(storage: Pick<Storage, 'getItem'>): RenderedEditClickMode {
  return storage.getItem(RENDERED_EDIT_CLICK_MODE_STORAGE_KEY) === 'command-click' ? 'command-click' : 'click';
}

export function persistRenderedEditClickMode(storage: Pick<Storage, 'setItem'>, mode: RenderedEditClickMode): void {
  storage.setItem(RENDERED_EDIT_CLICK_MODE_STORAGE_KEY, mode);
}

export function restoreTextCursorBlink(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(TEXT_CURSOR_BLINK_STORAGE_KEY) !== 'false';
}

export function persistTextCursorBlink(storage: Pick<Storage, 'setItem'>, enabled: boolean): void {
  storage.setItem(TEXT_CURSOR_BLINK_STORAGE_KEY, enabled ? 'true' : 'false');
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
