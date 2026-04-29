/** Shared keyboard + click helpers for library-style reader/editor views.
 *  Extracted from LibrarianView + CommandsView so both views behave the same. */

export function isActiveElementEditable(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

/** True when a keydown event should focus the sidebar search input.
 *  Cmd+F fires anywhere; `/` is a bare-key alternative and is suppressed
 *  while the user is typing in an input or holds a modifier. */
export function isSearchFocusShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  if (e.key === 'f' && e.metaKey) return true;
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

/** True when a click on the rendered markdown body should switch to edit
 *  mode. Clicks on interactive elements and clicks that terminate a text
 *  selection are excluded. */
export function shouldEnterEditOnClick(e: { target: EventTarget | null; metaKey?: boolean }): boolean {
  if (!e.metaKey) return false;
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  if (target.closest('a, button, input, textarea, select, img, code')) return false;
  if ((window.getSelection()?.toString() ?? '').trim() !== '') return false;
  return true;
}
