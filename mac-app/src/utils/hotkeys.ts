/**
 * Shared hotkey utilities for capturing and displaying keyboard shortcuts.
 * Used by SettingsPanel, App, and Onboarding components.
 */

/**
 * Build a hotkey string from a keyboard event using physical key codes.
 * This ensures consistent results regardless of keyboard layout or locale.
 * 
 * Returns empty string if the event is modifier-only (no actual key pressed).
 */
export function buildHotkeyString(event: KeyboardEvent): string {
  const parts: string[] = [];
  if (event.metaKey) parts.push('Command');
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');

  // Filter out modifier-only key presses (both the base name and Left/Right variants).
  const modifierCodes = [
    'Meta', 'MetaLeft', 'MetaRight',
    'Control', 'ControlLeft', 'ControlRight',
    'Alt', 'AltLeft', 'AltRight',
    'Shift', 'ShiftLeft', 'ShiftRight'
  ];
  if (modifierCodes.includes(event.code)) {
    return '';
  }

  // Use physical key code to avoid locale-specific characters.
  let key = event.code;

  if (key.startsWith('Key')) {
    key = key.substring(3).toUpperCase();
  } else if (key.startsWith('Digit')) {
    key = key.substring(5);
  } else {
    const codeMap: Record<string, string> = {
      'Space': 'Space',
      'Backquote': '`',
      'Backslash': '\\',
      'BracketLeft': '[',
      'BracketRight': ']',
      'Comma': ',',
      'Equal': '=',
      'Minus': '-',
      'Period': '.',
      'Quote': "'",
      'Semicolon': ';',
      'Slash': '/',
      'CapsLock': 'CapsLock',
      'Escape': 'Escape',
      'Enter': 'Enter',
      'Tab': 'Tab',
      'Backspace': 'Backspace',
      'Delete': 'Delete',
      'ArrowUp': 'Up',
      'ArrowDown': 'Down',
      'ArrowLeft': 'Left',
      'ArrowRight': 'Right',
      'PageUp': 'PageUp',
      'PageDown': 'PageDown',
      'Home': 'Home',
      'End': 'End',
      'Insert': 'Insert',
      'F1': 'F1', 'F2': 'F2', 'F3': 'F3', 'F4': 'F4',
      'F5': 'F5', 'F6': 'F6', 'F7': 'F7', 'F8': 'F8',
      'F9': 'F9', 'F10': 'F10', 'F11': 'F11', 'F12': 'F12',
    };
    if (codeMap[key]) {
      key = codeMap[key];
    } else {
      const fallback = event.key;
      if (fallback && fallback.length === 1 && fallback.charCodeAt(0) < 128) {
        key = fallback.toUpperCase();
      } else {
        console.warn(`[Hotkey] Unsupported key: ${event.code} (key: ${event.key})`);
        return '';
      }
    }
  }

  return parts.length > 0 ? `${parts.join('+')}+${key}` : key;
}

export function normalizeHotkeyForComparison(hotkey: string | null | undefined): string {
  if (!hotkey) return '';

  const modifierOrder = ['Command', 'Control', 'Alt', 'Shift'];
  const aliases: Record<string, string> = {
    cmd: 'Command',
    command: 'Command',
    meta: 'Command',
    ctrl: 'Control',
    control: 'Control',
    option: 'Alt',
    alt: 'Alt',
    shift: 'Shift',
  };
  const modifiers = new Set<string>();
  const keys: string[] = [];

  for (const rawPart of hotkey.replace(/\s+/g, '').split('+')) {
    if (!rawPart) continue;
    const normalizedPart = aliases[rawPart.toLowerCase()] ?? rawPart;
    const part = normalizedPart.charAt(0).toUpperCase() + normalizedPart.slice(1);
    if (modifierOrder.includes(part)) {
      modifiers.add(part);
    } else {
      keys.push(part.length === 1 ? part.toUpperCase() : part);
    }
  }

  return [
    ...modifierOrder.filter((modifier) => modifiers.has(modifier)),
    ...keys,
  ].join('+');
}

export function hasNonShiftModifierHotkey(hotkey: string | null | undefined): boolean {
  const normalized = normalizeHotkeyForComparison(hotkey);
  if (!normalized) return false;
  return normalized.split('+').some((part) => part === 'Command' || part === 'Control' || part === 'Alt');
}

/**
 * Check if a hotkey string contains only modifier keys (no actual key).
 */
export function isModifierOnly(s: string): boolean {
  return s === 'Command' || s === 'Control' || s === 'Alt' || s === 'Shift';
}

export function isTextEntryElement(element: Element | null | undefined): boolean {
  return element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement
    || (element instanceof HTMLElement && element.isContentEditable);
}

/**
 * Let the browser/app handle Cmd+C when the user is interacting with editable
 * content or has an actual text selection.
 */
export function shouldDeferCopyShortcutToNative(): boolean {
  if (isTextEntryElement(document.activeElement)) {
    return true;
  }

  const selection = window.getSelection?.();
  if (!selection || selection.isCollapsed) {
    return false;
  }

  return selection.toString().length > 0;
}

/**
 * Format a hotkey string for display using macOS symbols.
 * e.g., "Command+\\" -> "⌘ \"
 *       "Alt+Space" -> "⌥ Space"
 *       "Command+Shift+4" -> "⌘ ⇧ 4"
 */
export function formatHotkeyDisplay(hotkey: string): string {
  if (!hotkey) return '';
  
  const symbolMap: Record<string, string> = {
    'Command': '⌘',
    'Control': '⌃',
    'Alt': '⌥',
    'Shift': '⇧',
    'Space': 'Space',
    'Escape': 'Esc',
    'Backspace': '⌫',
    'Delete': '⌦',
    'Enter': '↵',
    'Tab': '⇥',
    'Up': '↑',
    'Down': '↓',
    'Left': '←',
    'Right': '→',
  };

  const parts = hotkey.split('+');
  const formatted = parts.map(part => symbolMap[part] || part);
  
  return formatted.join(' ');
}

/**
 * Parse a display-formatted hotkey back to internal format.
 * e.g., "⌘ \" -> "Command+\\"
 */
export function parseHotkeyDisplay(display: string): string {
  if (!display) return '';
  
  const reverseMap: Record<string, string> = {
    '⌘': 'Command',
    '⌃': 'Control',
    '⌥': 'Alt',
    '⇧': 'Shift',
    'Esc': 'Escape',
    '⌫': 'Backspace',
    '⌦': 'Delete',
    '↵': 'Enter',
    '⇥': 'Tab',
    '↑': 'Up',
    '↓': 'Down',
    '←': 'Left',
    '→': 'Right',
  };

  const parts = display.split(' ').filter(Boolean);
  const parsed = parts.map(part => reverseMap[part] || part);
  
  return parsed.join('+');
}
