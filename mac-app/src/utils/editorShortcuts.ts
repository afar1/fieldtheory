import type { MarkdownFormattingKind } from './markdownFormatting';

/** Shared keyboard + click helpers for library-style reader/editor views.
 *  Extracted from LibrarianView + CommandsView so both views behave the same. */

export function isActiveElementEditable(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLInputElement
    || el instanceof HTMLTextAreaElement
    || el instanceof HTMLSelectElement
    || (el instanceof HTMLElement && el.isContentEditable);
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

export function isCopyFilePathShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return (e.key.toLowerCase() === 'c' || e.code === 'KeyC') && e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey;
}

export function isImmersiveToggleShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return (e.key === '/' || e.code === 'Slash') && e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey;
}

export function isMarkdownModeToggleShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return (e.key === ';' || e.code === 'Semicolon') && e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey;
}

export function isLineNumbersToggleShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  const isK = e.key.toLowerCase() === 'k' || e.code === 'KeyK';
  return isK && e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey;
}

export function isFadedLineNumbersShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  const isR = e.key.toLowerCase() === 'r' || e.code === 'KeyR';
  return isR && e.metaKey && e.altKey && !e.shiftKey && !e.ctrlKey;
}

export function isMarkdownTaskShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  const isZeroKey = e.key === '0' || e.key === ')' || e.code === 'Digit0' || e.code === 'Numpad0';
  return isZeroKey && e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey;
}

export function isMarkdownTaskToggleShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return e.key === 'Enter' && e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey;
}

export function getMarkdownListShortcutKind(e: KeyboardEvent | React.KeyboardEvent): 'ordered' | 'unordered' | null {
  if (!e.metaKey || !e.shiftKey || e.ctrlKey || e.altKey) return null;
  if (e.code === 'Digit7' || e.key === '7' || e.key === '&') return 'ordered';
  if (e.code === 'Digit8' || e.key === '8' || e.key === '*' || e.key === '•') return 'unordered';
  return null;
}

export function getMarkdownFormattingShortcut(e: KeyboardEvent | React.KeyboardEvent): MarkdownFormattingKind | null {
  if (!e.metaKey || e.shiftKey || e.ctrlKey || e.altKey) return null;
  switch (e.key.toLowerCase()) {
    case 'b':
      return 'bold';
    case 'i':
      return 'italic';
    case 'u':
      return 'underline';
    default:
      return null;
  }
}

export function isSidebarToggleShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return (e.key === ',' || e.code === 'Comma') && e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey;
}

export function isNavSidebarToggleEnabled(input: {
  viewMode: string;
  showSettings: boolean;
  librarianImmersive: boolean;
}): boolean {
  if (input.showSettings) return false;
  if (input.viewMode === 'commands') return true;
  if (input.viewMode !== 'librarian') return false;
  return true;
}

export function isCommandDeleteShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return (e.key === 'Backspace' || e.key === 'Delete') && e.metaKey && !e.shiftKey && !e.ctrlKey && !e.altKey;
}

export function isThemeToggleShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return e.key.toLowerCase() === 'l' && e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey;
}

export const DEFAULT_SHARED_FILE_TOGGLE_HOTKEY = 'Command+Shift+S';
export const SHARED_FILE_TOGGLE_HOTKEY_STORAGE_KEY = 'fieldtheory-shared-file-toggle-hotkey';

type HotkeyEventLike = Pick<KeyboardEvent | React.KeyboardEvent, 'key' | 'code' | 'metaKey' | 'shiftKey' | 'ctrlKey' | 'altKey'>;

function normalizeHotkeyToken(token: string): string {
  const normalized = token.trim().toLowerCase();
  if (normalized === 'cmd' || normalized === 'command' || normalized === 'meta') return 'command';
  if (normalized === 'cmdorctrl' || normalized === 'commandorcontrol') return 'command';
  if (normalized === 'control' || normalized === 'ctrl') return 'control';
  if (normalized === 'option' || normalized === 'alt') return 'option';
  if (normalized === 'shift') return 'shift';
  return normalized.length === 1 ? normalized : normalized.replace(/^key/i, '').toLowerCase();
}

export function isHotkeyEvent(e: HotkeyEventLike, hotkey: string): boolean {
  const tokens = hotkey.split('+').map(normalizeHotkeyToken).filter(Boolean);
  const keyToken = tokens.find((token) => token !== 'command' && token !== 'control' && token !== 'option' && token !== 'shift');
  if (!keyToken) return false;

  const eventKey = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  const eventCode = e.code.replace(/^Key/i, '').toLowerCase();
  const keyMatches = eventKey === keyToken || eventCode === keyToken;
  if (!keyMatches) return false;

  const wantsCommand = tokens.includes('command');
  const wantsControl = tokens.includes('control');
  const wantsOption = tokens.includes('option');
  const wantsShift = tokens.includes('shift');

  return e.metaKey === wantsCommand
    && e.ctrlKey === wantsControl
    && e.altKey === wantsOption
    && e.shiftKey === wantsShift;
}

export function restoreSharedFileToggleHotkey(storage: Pick<Storage, 'getItem'>): string {
  const stored = storage.getItem(SHARED_FILE_TOGGLE_HOTKEY_STORAGE_KEY)?.trim();
  return stored || DEFAULT_SHARED_FILE_TOGGLE_HOTKEY;
}

export function persistSharedFileToggleHotkey(storage: Pick<Storage, 'setItem'>, hotkey: string): void {
  storage.setItem(SHARED_FILE_TOGGLE_HOTKEY_STORAGE_KEY, hotkey.trim() || DEFAULT_SHARED_FILE_TOGGLE_HOTKEY);
}

export function isSharedFileToggleShortcut(e: HotkeyEventLike, hotkey = DEFAULT_SHARED_FILE_TOGGLE_HOTKEY): boolean {
  return isHotkeyEvent(e, hotkey);
}

export function isKeyboardShortcutsHelpShortcut(e: KeyboardEvent | React.KeyboardEvent): boolean {
  return (e.key === '?' || (e.key === '/' && e.shiftKey)) && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey;
}

export function shouldRevealFooterChrome(
  cursorClientY: number,
  viewportHeight: number,
  revealDistancePx = 96,
): boolean {
  if (!Number.isFinite(cursorClientY) || !Number.isFinite(viewportHeight)) return false;
  if (viewportHeight <= 0) return false;
  return cursorClientY <= viewportHeight && cursorClientY >= viewportHeight - Math.max(0, revealDistancePx);
}

export const COLLAPSED_SIDEBAR_HOVER_STRIP_WIDTH = 30;
export const COLLAPSED_SIDEBAR_AFFORDANCE_PROXIMITY_WIDTH = 96;

export function getCollapsedSidebarAffordanceOpacity(input: {
  currentClientX: number;
  hoverStripWidth: number;
  proximityWidth: number;
}): number {
  const stripWidth = Math.max(0, input.hoverStripWidth);
  const proximityWidth = Math.max(stripWidth, input.proximityWidth);
  if (!Number.isFinite(input.currentClientX) || proximityWidth <= 0) return 0;
  if (input.currentClientX < 0 || input.currentClientX > proximityWidth) return 0;
  if (input.currentClientX <= stripWidth) return 1;
  if (proximityWidth === stripWidth) return 1;
  return 1 - ((input.currentClientX - stripWidth) / (proximityWidth - stripWidth));
}

export const LIBRARIAN_KEYBOARD_SHORTCUTS: Array<{ keys: string; label: string }> = [
  { keys: 'Command+[ / ]', label: 'Back or forward' },
  { keys: 'Command+B / I / U', label: 'Bold, italic, or underline selection' },
  { keys: 'Command+W', label: 'Close Field Theory' },
  { keys: 'Command+Shift+C', label: 'Copy file path' },
  { keys: 'Command+C', label: 'Copy selected text or file path' },
  { keys: 'Shift+Tab', label: 'Cycle note task state backward' },
  { keys: 'Tab', label: 'Cycle note task state forward' },
  { keys: 'Command+Shift+0', label: 'Cycle task line' },
  { keys: 'Command+Backspace', label: 'Delete selected sidebar file' },
  { keys: 'Esc', label: 'Exit edit, focus, fullscreen, or close' },
  { keys: 'Command+F', label: 'Find in file' },
  { keys: '/', label: 'Focus library search' },
  { keys: 'J / K', label: 'Move through files' },
  { keys: '↑ / ↓', label: 'Move through files' },
  { keys: 'Command+N', label: 'New file' },
  { keys: 'Command+Shift+N', label: 'New folder' },
  { keys: 'Command+S', label: 'Save and render markdown' },
  { keys: 'Command+Option+R', label: 'Show faded line numbers' },
  { keys: 'Shift+?', label: 'Show keyboard shortcuts' },
  { keys: 'Command+/', label: 'Toggle focus mode' },
  { keys: 'Command+Shift+K', label: 'Toggle line numbers' },
  { keys: 'Command+;', label: 'Toggle rendered/markdown' },
  { keys: 'Command+Shift+S', label: 'Toggle River sharing' },
  { keys: 'Command+,', label: 'Toggle sidebar' },
  { keys: 'Command+Enter', label: 'Toggle task checkbox line' },
  { keys: 'Command+.', label: 'Toggle terminal panel' },
];

export type RenderedEditClickMode = 'click' | 'command-click';
export type RenderedTextCursorStyle = 'bar' | 'block';

export const DEFAULT_RENDERED_TEXT_CURSOR_STYLE: RenderedTextCursorStyle = 'block';
export const DEFAULT_RENDERED_BLOCK_CURSOR_OPACITY = 0.5;
export const RENDERED_EDIT_CLICK_MODE_STORAGE_KEY = 'fieldtheory-rendered-edit-click-mode';
export const RENDERED_EDIT_CLICK_MODE_CHANGED_EVENT = 'fieldtheory:rendered-edit-click-mode-changed';
export const TEXT_CURSOR_BLINK_STORAGE_KEY = 'fieldtheory-text-cursor-blink';
export const TEXT_CURSOR_BLINK_CHANGED_EVENT = 'fieldtheory:text-cursor-blink-changed';
export const RENDERED_TEXT_CURSOR_STYLE_STORAGE_KEY = 'fieldtheory-rendered-text-cursor-style';
export const RENDERED_TEXT_CURSOR_STYLE_CHANGED_EVENT = 'fieldtheory:rendered-text-cursor-style-changed';
export const RENDERED_BLOCK_CURSOR_OPACITY_STORAGE_KEY = 'fieldtheory-rendered-block-cursor-opacity';
export const RENDERED_BLOCK_CURSOR_OPACITY_CHANGED_EVENT = 'fieldtheory:rendered-block-cursor-opacity-changed';
export const LINE_NUMBERS_STORAGE_KEY = 'fieldtheory-line-numbers';

export function restoreRenderedEditClickMode(storage: Pick<Storage, 'getItem'>): RenderedEditClickMode {
  return storage.getItem(RENDERED_EDIT_CLICK_MODE_STORAGE_KEY) === 'click' ? 'click' : 'command-click';
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

export function restoreRenderedTextCursorStyle(storage: Pick<Storage, 'getItem'>): RenderedTextCursorStyle {
  const saved = storage.getItem(RENDERED_TEXT_CURSOR_STYLE_STORAGE_KEY);
  return saved === 'bar' || saved === 'block' ? saved : DEFAULT_RENDERED_TEXT_CURSOR_STYLE;
}

export function persistRenderedTextCursorStyle(storage: Pick<Storage, 'setItem'>, style: RenderedTextCursorStyle): void {
  storage.setItem(RENDERED_TEXT_CURSOR_STYLE_STORAGE_KEY, style);
}

export function restoreRenderedBlockCursorOpacity(storage: Pick<Storage, 'getItem'>): number {
  const saved = Number.parseFloat(storage.getItem(RENDERED_BLOCK_CURSOR_OPACITY_STORAGE_KEY) ?? '');
  return Number.isFinite(saved) ? Math.max(0.2, Math.min(1, saved)) : DEFAULT_RENDERED_BLOCK_CURSOR_OPACITY;
}

export function persistRenderedBlockCursorOpacity(storage: Pick<Storage, 'setItem'>, opacity: number): void {
  storage.setItem(RENDERED_BLOCK_CURSOR_OPACITY_STORAGE_KEY, String(Math.max(0.2, Math.min(1, opacity))));
}

/** True when a click on the rendered markdown body should switch to edit
 *  mode. Clicks on interactive elements and clicks that terminate a text
 *  selection are excluded. */
export function shouldEnterEditOnClick(
  e: { target: EventTarget | null; metaKey?: boolean },
  mode: RenderedEditClickMode = 'command-click',
): boolean {
  if (mode === 'command-click' && !e.metaKey) return false;
  const target = e.target as HTMLElement | null;
  if (!target) return false;
  if (target.closest('a, button, input, textarea, select, img, code')) return false;
  if ((window.getSelection()?.toString() ?? '').trim() !== '') return false;
  return true;
}
