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

  return parts.length > 0 ? `${parts.join('+')}+${key}` : key;
}

/**
 * Check if a hotkey string contains only modifier keys (no actual key).
 */
export function isModifierOnly(s: string): boolean {
  return s === 'Command' || s === 'Control' || s === 'Alt' || s === 'Shift';
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
